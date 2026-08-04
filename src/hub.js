const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');
const express = require('express');

const DEFAULT_PLUGINS_DIR = path.join(__dirname, '..', 'plugins');
const DEFAULT_DATA_DIR = path.join(__dirname, '..', 'data', 'hub');
const HUB_PORT = Number(process.env.USAGI_HUB_PORT) || 5178;

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
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      this.plugins.set(manifest.id, {
        manifest,
        dir,
        status: 'stopped',
        port: null,
        url: null,
        proc: null,
        stderr: '',
        exitInfo: null
      });
    }
  }

  list() {
    return [...this.plugins.values()].map((p) => ({
      id: p.manifest.id,
      name: p.manifest.name,
      version: p.manifest.version,
      status: p.status,
      url: p.url,
      exitInfo: p.exitInfo,
      theme: p.manifest.theme || null
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
        AKUMU_DATA_DIR: dataDir
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    runtime.proc = proc;
    runtime.status = 'starting';
    runtime.port = port;
    runtime.url = `http://127.0.0.1:${port}`;
    runtime.stderr = '';
    runtime.exitInfo = null;

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
