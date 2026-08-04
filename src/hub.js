const path = require('path');
const fs = require('fs');
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');
const express = require('express');
const { readPluginManifest } = require('./manifest');
const { Registry } = require('./registry');

const DEFAULT_PLUGINS_DIR = path.join(__dirname, '..', 'plugins');
const DEFAULT_DATA_DIR = path.join(__dirname, '..', 'data', 'hub');
const DEFAULT_SDK_PATH = path.join(__dirname, '..', 'sdk', 'index.js');
const HUB_PORT = Number(process.env.USAGI_HUB_PORT) || 5178;
const RAW = 'https://raw.githubusercontent.com';

function log(...args) {
  console.log('[usagi]', ...args);
}

function sendError(res, error) {
  res.status(500).json({ ok: false, error: error.message, reason: error.reason || null });
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
    let names;
    try {
      names = fs.readdirSync(this.pluginsDir);
    } catch {
      return;
    }
    for (const name of names) {
      if (name.startsWith('.')) {
        continue;
      }
      const dir = path.join(this.pluginsDir, name);
      let stat;
      try {
        stat = fs.statSync(dir);
      } catch {
        continue;
      }
      if (!stat.isDirectory() || !fs.existsSync(path.join(dir, 'plugin.json'))) {
        continue;
      }
      let manifest;
      try {
        manifest = readPluginManifest(dir);
      } catch (error) {
        log(`skipping ${name}: ${error.message}`);
        continue;
      }
      const existing = this.plugins.get(manifest.id);
      if (existing) {
        if (existing.dir === dir && existing.manifest.version === manifest.version) {
          continue;
        }
        existing.dir = dir;
        existing.manifest = manifest;
        if (!existing.proc) {
          existing.status = existing.status === 'crashed' ? 'crashed' : 'stopped';
        }
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

  async remove(id) {
    await this.stop(id);
    this.plugins.delete(id);
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

  readAllHistory() {
    const root = path.join(this.dataDir, 'history');
    if (!fs.existsSync(root)) {
      return [];
    }
    return fs
      .readdirSync(root)
      .map((pluginId) => {
        const dir = path.join(root, pluginId);
        if (!fs.statSync(dir).isDirectory()) {
          return null;
        }
        const runtime = this.plugins.get(pluginId);
        const schemas = fs
          .readdirSync(dir)
          .filter((file) => file.endsWith('.jsonl'))
          .map((file) => {
            const schema = file.slice(0, -'.jsonl'.length);
            return { schema, records: this.readHistory(pluginId, schema) };
          });
        return {
          plugin: pluginId,
          name: (runtime && runtime.manifest.name) || pluginId,
          schemas
        };
      })
      .filter(Boolean);
  }
}

function createHub(options = {}) {
  const manager = new PluginManager({
    pluginsDir: options.pluginsDir || DEFAULT_PLUGINS_DIR,
    dataDir: options.dataDir || DEFAULT_DATA_DIR
  });
  const registry = new Registry({
    pluginsDir: manager.pluginsDir,
    cacheDir: options.registryCacheDir,
    stateFile: options.registryStateFile
  });
  manager.scan();

  const app = express();
  app.use(express.json({ limit: '2mb' }));

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

  app.get('/api/repos', async (_req, res) => {
    try {
      res.json({ ok: true, repos: await registry.listRepos() });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/repos/:owner/:repo', async (req, res) => {
    try {
      res.json({ ok: true, repo: await registry.repoDetail(req.params.owner, req.params.repo) });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/repos/:owner/:repo/install', async (req, res) => {
    try {
      const result = await registry.install({
        owner: req.params.owner,
        repo: req.params.repo,
        tag: (req.body && req.body.tag) || undefined
      });
      manager.scan();
      res.json({ ok: true, ...result });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/repos/:owner/:repo/update', async (req, res) => {
    try {
      const record = registry.state.repos[req.params.repo];
      if (record && record.pluginId) {
        await manager.stop(record.pluginId);
      }
      const result = await registry.update({
        owner: req.params.owner,
        repo: req.params.repo,
        tag: (req.body && req.body.tag) || undefined
      });
      manager.scan();
      res.json({ ok: true, ...result });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/repos/:owner/:repo/repair', async (req, res) => {
    try {
      const record = registry.state.repos[req.params.repo];
      if (record && record.pluginId) {
        await manager.stop(record.pluginId);
      }
      const result = await registry.repair({
        owner: req.params.owner,
        repo: req.params.repo
      });
      manager.scan();
      res.json({ ok: true, ...result });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/repos/:owner/:repo/uninstall', async (req, res) => {
    try {
      const record = registry.state.repos[req.params.repo];
      const result = await registry.uninstall({
        owner: req.params.owner,
        repo: req.params.repo
      });
      if (record && record.pluginId) {
        await manager.remove(record.pluginId);
      }
      manager.scan();
      res.json({ ok: true, ...result });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/repos/:owner/:repo/raw/:tag/*', async (req, res) => {
    try {
      const { owner, repo, tag } = req.params;
      const filePath = String(req.params[0] || '').replace(/^\/+/, '');
      if (!filePath || filePath.split(/[\\/]/).includes('..')) {
        res.status(400).json({ ok: false, error: 'invalid path' });
        return;
      }
      const url = `${RAW}/${owner}/${repo}/${encodeURIComponent(tag)}/${filePath}`;
      const upstream = await fetch(url);
      if (!upstream.ok) {
        res.status(upstream.status).json({ ok: false, error: `upstream ${upstream.status}` });
        return;
      }
      const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.set('content-type', contentType);
      res.set('cache-control', 'public, max-age=3600');
      res.send(buffer);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/history', (_req, res) => {
    res.json({ ok: true, history: manager.readAllHistory() });
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

  app.use('/bus', requirePlugin);

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
