const path = require('path');
const fs = require('fs');
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');
const express = require('express');

const DEFAULT_PLUGINS_DIR = path.join(__dirname, '..', 'plugins');
const DEFAULT_DATA_DIR = path.join(__dirname, '..', 'data', 'hub');
const DEFAULT_SDK_PATH = path.join(__dirname, '..', 'sdk', 'index.js');
const HUB_PORT = Number(process.env.USAGI_HUB_PORT) || 5178;

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    return 'manifest must be an object';
  }
  if (typeof manifest.id !== 'string' || !manifest.id) {
    return 'manifest.id (string) is required';
  }
  if (typeof manifest.name !== 'string' || !manifest.name) {
    return 'manifest.name (string) is required';
  }
  if (typeof manifest.version !== 'string' || !manifest.version) {
    return 'manifest.version (string) is required';
  }
  if (!Number.isInteger(manifest.sdkVersion)) {
    return 'manifest.sdkVersion (integer) is required';
  }
  const command = manifest.entry && manifest.entry.command;
  if (!Array.isArray(command) || command.length === 0 || !command.every((c) => typeof c === 'string')) {
    return 'manifest.entry.command (non-empty string array) is required';
  }
  const healthPath = manifest.health && manifest.health.path;
  if (typeof healthPath !== 'string' || !healthPath.startsWith('/')) {
    return 'manifest.health.path (string starting with /) is required';
  }
  return null;
}

function log(...args) {
  console.log('[usagi]', ...args);
}

function pickFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const p = probe.address().port;
      probe.close(() => resolve(p));
    });
  });
}

function waitForUrl(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = async () => {
      if (Date.now() > deadline) {
        return reject(new Error(`timed out waiting for ${url}`));
      }
      try {
        const res = await fetch(url);
        if (res.ok) {
          return resolve();
        }
      } catch {
        // not up yet
      }
      setTimeout(tick, 250);
    };
    tick();
  });
}

class PluginManager {
  constructor({ pluginsDir, dataDir }) {
    this.pluginsDir = pluginsDir;
    this.dataDir = dataDir;
    this.plugins = new Map();
  }

  scan() {
    for (const name of fs.readdirSync(this.pluginsDir)) {
      const dir = path.join(this.pluginsDir, name);
      const manifestPath = path.join(dir, 'plugin.json');
      if (!fs.statSync(dir).isDirectory() || !fs.existsSync(manifestPath)) {
        continue;
      }
      let manifest;
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      } catch (error) {
        log(`skipping ${name}: invalid plugin.json (${error.message})`);
        continue;
      }
      const manifestError = validateManifest(manifest);
      if (manifestError) {
        log(`skipping ${name}: ${manifestError}`);
        continue;
      }
      this.plugins.set(manifest.id, {
        manifest,
        dir,
        token: crypto.randomBytes(24).toString('hex'),
        status: 'stopped',
        port: null,
        url: null,
        proc: null,
        stderr: '',
        exitInfo: null,
        sdkReady: false
      });
    }
  }

  byToken(token) {
    for (const runtime of this.plugins.values()) {
      if (runtime.token === token) {
        return runtime;
      }
    }
    return null;
  }

  list() {
    return [...this.plugins.values()].map((p) => ({
      id: p.manifest.id,
      name: p.manifest.name,
      version: p.manifest.version,
      status: p.status,
      url: p.url,
      exitInfo: p.exitInfo,
      theme: p.manifest.theme || null,
      io: p.manifest.io || null,
      sdkReady: p.sdkReady
    }));
  }

  async start(id) {
    const runtime = this.plugins.get(id);
    if (!runtime) {
      throw new Error(`unknown plugin: ${id}`);
    }
    if (runtime.status === 'running') {
      return runtime;
    }

    const port = await pickFreePort();
    const dataDir = path.join(this.dataDir, id);
    fs.mkdirSync(dataDir, { recursive: true });
    const cwd = path.resolve(runtime.dir, runtime.manifest.entry.cwd || '.');
    const [cmd, ...args] = runtime.manifest.entry.command;

    log(`starting ${id} on ${port} (cwd ${cwd}, data ${dataDir})`);

    const proc = spawn(cmd, args, {
      cwd,
      env: {
        ...process.env,
        AKUMU_PORT: String(port),
        AKUMU_DATA_DIR: dataDir,
        USAGI_HUB_URL: `http://127.0.0.1:${HUB_PORT}`,
        USAGI_PLUGIN_TOKEN: runtime.token,
        USAGI_SDK_PATH: DEFAULT_SDK_PATH
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    runtime.proc = proc;
    runtime.status = 'starting';
    runtime.port = port;
    runtime.url = `http://127.0.0.1:${port}`;
    runtime.stderr = '';
    runtime.exitInfo = null;
    runtime.sdkReady = false;

    proc.stderr.on('data', (chunk) => {
      runtime.stderr += chunk;
    });
    proc.on('exit', (code, signal) => {
      runtime.proc = null;
      runtime.port = null;
      runtime.url = null;
      if (runtime.status !== 'stopping') {
        runtime.status = 'crashed';
      } else {
        runtime.status = 'stopped';
      }
      runtime.exitInfo = { code, signal, stderr: runtime.stderr.slice(-2000) };
      log(`${id} exited (${runtime.exitInfo.code})`);
    });

    const healthPath = runtime.manifest.health?.path || '/api/health';
    try {
      await waitForUrl(runtime.url + healthPath, 180000);
    } catch (error) {
      runtime.status = 'crashed';
      runtime.exitInfo = { error: error.message, stderr: runtime.stderr.slice(-2000) };
      proc.kill();
      throw new Error(`plugin ${id} never became healthy: ${runtime.exitInfo.stderr || error.message}`);
    }

    runtime.status = 'running';
    log(`${id} is healthy at ${runtime.url}`);
    return runtime;
  }

  async stop(id) {
    const runtime = this.plugins.get(id);
    if (!runtime) {
      return;
    }
    if (!runtime.proc) {
      runtime.status = 'stopped';
      return;
    }
    log(`stopping ${id}`);
    runtime.status = 'stopping';
    const proc = runtime.proc;
    proc.kill();
    if (proc.exitCode === null) {
      await new Promise((resolve) => proc.once('exit', resolve));
    }
    runtime.status = 'stopped';
  }

  stopAll() {
    for (const runtime of this.plugins.values()) {
      if (runtime.proc) {
        runtime.status = 'stopping';
        runtime.proc.kill();
      }
    }
  }

  appendRecord(pluginId, { schema, input, output }) {
    if (typeof schema !== 'string' || !schema) {
      throw new Error('schema is required');
    }
    const record = {
      schema,
      id: crypto.randomUUID(),
      plugin: pluginId,
      createdAt: new Date().toISOString(),
      input: input || {},
      output: output || {}
    };
    const file = path.join(this.dataDir, 'history', pluginId, `${schema}.jsonl`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(record) + '\n');
    return record;
  }

  readHistory(pluginId, schema) {
    const file = path.join(this.dataDir, 'history', pluginId, `${schema}.jsonl`);
    if (!fs.existsSync(file)) {
      return [];
    }
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }
}

function createHub(options = {}) {
  const manager = new PluginManager({
    pluginsDir: options.pluginsDir || DEFAULT_PLUGINS_DIR,
    dataDir: options.dataDir || DEFAULT_DATA_DIR
  });
  manager.scan();

  const app = express();

  app.get('/api/plugins', (_req, res) => {
    res.json({ ok: true, plugins: manager.list() });
  });

  app.post('/api/plugins/:id/start', async (req, res) => {
    try {
      await manager.start(req.params.id);
      res.json({ ok: true, plugin: manager.list().find((p) => p.id === req.params.id) });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post('/api/plugins/:id/stop', async (req, res) => {
    try {
      await manager.stop(req.params.id);
      res.json({ ok: true, plugin: manager.list().find((p) => p.id === req.params.id) });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  // --- hub bus (loopback, token-protected) ---

  function requirePlugin(req, res, next) {
    const token = req.get('x-usagi-token');
    const runtime = token ? manager.byToken(token) : null;
    if (!runtime) {
      res.status(401).json({ ok: false, error: 'invalid plugin token' });
      return;
    }
    req.runtime = runtime;
    next();
  }

  app.use('/bus', express.json({ limit: '2mb' }), requirePlugin);

  app.post('/bus/ready', (req, res) => {
    req.runtime.sdkReady = true;
    log(`${req.runtime.manifest.id} signalled ready via SDK`);
    res.json({ ok: true, plugin: req.runtime.manifest.id });
  });

  app.post('/bus/history', (req, res) => {
    try {
      const { schema, input, output } = req.body || {};
      const record = manager.appendRecord(req.runtime.manifest.id, { schema, input, output });
      res.json({ ok: true, record });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.get('/bus/history/latest', (req, res) => {
    const { from, schema } = req.query;
    if (!from || !schema) {
      res.status(400).json({ ok: false, error: 'from and schema are required' });
      return;
    }
    const records = manager.readHistory(from, schema);
    res.json({ ok: true, record: records[records.length - 1] || null });
  });

  app.get('/bus/history', (req, res) => {
    const { plugin, schema } = req.query;
    if (!plugin || !schema) {
      res.status(400).json({ ok: false, error: 'plugin and schema are required' });
      return;
    }
    res.json({ ok: true, records: manager.readHistory(plugin, schema) });
  });

  app.use(express.static(path.join(__dirname, '..', 'client', 'dist')));

  return new Promise((resolve) => {
    const server = app.listen(HUB_PORT, '127.0.0.1', () => {
      resolve({
        port: HUB_PORT,
        manager,
        server,
        stopAll: () => {
          manager.stopAll();
          server.close();
        }
      });
    });
  });
}

if (require.main === module) {
  createHub()
    .then((hub) => {
      log(`UsagiAI hub running at http://127.0.0.1:${hub.port}`);
      log(`Plugins: ${hub.manager.list().map((p) => `${p.id} (${p.status})`).join(', ')}`);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { createHub };
