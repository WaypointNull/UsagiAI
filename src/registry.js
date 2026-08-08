const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { readPluginManifest } = require('./manifest');

const DEFAULT_CACHE_DIR = path.join(__dirname, 'registryCache');
const DEFAULT_STATE_FILE = path.join(__dirname, 'plugins.json');

const DEFAULT_REPO_OWNER = 'WaypointNull';
const DEFAULT_REPOS = [{ owner: 'WaypointNull', repo: 'Akumu' }];
const DISCOVER_TTL_MS = 5 * 60 * 1000;

const GITHUB_API = 'https://api.github.com';
const CODELOAD = 'https://codeload.github.com';
const RAW = 'https://raw.githubusercontent.com';

function log(...args) {
  console.log('[usagi]', ...args);
}

function createError(message, reason) {
  const error = new Error(message);
  error.reason = reason;
  return error;
}

function classifyError(error, fallback = 'network') {
  if (error && error.reason) {
    return error;
  }
  const wrapped = createError((error && error.message) || String(error), fallback);
  wrapped.cause = error;
  return wrapped;
}

function reasonForStatus(status) {
  if (status === 401 || status === 403) {
    return 'auth';
  }
  if (status === 404) {
    return 'notFound';
  }
  return 'network';
}

function parseVersion(value) {
  const s = String(value).replace(/^v/i, '');
  return s.split(/[.\-+]/).map((x) => (x === '' || isNaN(Number(x)) ? x : Number(x)));
}

function compareVersions(a, b) {
  const A = parseVersion(a);
  const B = parseVersion(b);
  const n = Math.max(A.length, B.length);
  for (let i = 0; i < n; i += 1) {
    const x = A[i] === undefined ? 0 : A[i];
    const y = B[i] === undefined ? 0 : B[i];
    if (typeof x === 'number' && typeof y === 'number') {
      if (x !== y) {
        return x < y ? -1 : 1;
      }
    } else {
      const xs = String(x);
      const ys = String(y);
      if (xs !== ys) {
        return xs < ys ? -1 : 1;
      }
    }
  }
  return 0;
}

function extractTarball(tarballPath, destDir) {
  return new Promise((resolve, reject) => {
    execFile('tar', ['-xzf', tarballPath, '-C', destDir], (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

async function githubJson(url) {
  let res;
  try {
    res = await fetch(url, {
      headers: {
        'user-agent': 'usagi-ai',
        accept: 'application/vnd.github+json'
      }
    });
  } catch (error) {
    throw createError(`GitHub request failed: ${error.message}`, 'network');
  }
  if (!res.ok) {
    throw createError(`GitHub request failed: ${res.status} ${res.statusText}`, reasonForStatus(res.status));
  }
  return res.json();
}

class Registry {
  constructor({ pluginsDir, cacheDir = DEFAULT_CACHE_DIR, stateFile = DEFAULT_STATE_FILE } = {}) {
    this.pluginsDir = pluginsDir;
    this.cacheDir = cacheDir;
    this.stateFile = stateFile;
    this.state = { repos: {} };
    this.compatCache = new Map();
    this.discovered = [];
    this.discoveredAt = 0;
    this.loadState();
  }

  loadState() {
    if (!fs.existsSync(this.stateFile)) {
      return;
    }
    try {
      this.state = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      if (!this.state || typeof this.state !== 'object' || !this.state.repos) {
        this.state = { repos: {} };
      }
    } catch {
      this.state = { repos: {} };
    }
  }

  saveState() {
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2));
  }

  async fetchReleases(owner, repo) {
    const list = await githubJson(`${GITHUB_API}/repos/${owner}/${repo}/releases`);
    if (!Array.isArray(list)) {
      throw new Error('unexpected GitHub releases response');
    }
    return list
      .filter((r) => !r.draft)
      .map((r) => ({
        tag: r.tag_name,
        name: r.name,
        body: r.body || '',
        publishedAt: r.published_at,
        prerelease: Boolean(r.prerelease)
      }));
  }

  async fetchReadme(owner, repo, tag) {
    const url = `${RAW}/${owner}/${repo}/${encodeURIComponent(tag)}/README.md`;
    let res;
    try {
      res = await fetch(url);
    } catch {
      return null;
    }
    if (!res.ok) {
      return null;
    }
    const text = await res.text();
    return text.length > 200000 ? text.slice(0, 200000) : text;
  }

  async hasPluginJson(owner, repo, tag) {
    const key = `${owner}/${repo}/${tag}`;
    if (this.compatCache.has(key)) {
      return this.compatCache.get(key);
    }
    let found = false;
    const rootUrl = `${RAW}/${owner}/${repo}/${encodeURIComponent(tag)}/plugin.json`;
    let res;
    try {
      res = await fetch(rootUrl);
    } catch {
      res = null;
    }
    if (res && res.ok) {
      found = true;
    } else if (!res || res.status === 404) {
      try {
        const items = await githubJson(`${GITHUB_API}/repos/${owner}/${repo}/contents/plugins?ref=${encodeURIComponent(tag)}`);
        found = Array.isArray(items) && items.some((item) => item.type === 'dir');
      } catch {
        found = false;
      }
    }
    this.compatCache.set(key, found);
    return found;
  }

  async discoverRepos(owner) {
    if (this.discoveredAt && Date.now() - this.discoveredAt < DISCOVER_TTL_MS) {
      return this.discovered;
    }
    let list = null;
    try {
      list = await githubJson(`${GITHUB_API}/users/${owner}/repos?per_page=100&sort=updated`);
    } catch (error) {
      if (error && error.reason === 'notFound') {
        try {
          list = await githubJson(`${GITHUB_API}/orgs/${owner}/repos?per_page=100&sort=updated`);
        } catch {
          list = null;
        }
      } else {
        log(`discover ${owner} failed: ${error.message}; using cached/fallback list`);
        return this.discovered;
      }
    }
    const found = [];
    for (const item of Array.isArray(list) ? list : []) {
      if (item.fork) {
        continue;
      }
      const ref = item.default_branch || 'main';
      try {
        if (await this.hasPluginJson(owner, item.name, ref)) {
          found.push({ owner, repo: item.name });
        }
      } catch {
        // repo we can't inspect: skip
      }
    }
    this.discovered = found;
    this.discoveredAt = Date.now();
    log(`discovered ${found.length} plugin repo(s) under ${owner}`);
    return found;
  }

  async listRepos() {
    const repos = [];
    const seen = new Set();
    const withUpdate = async (owner, repo, record) => {
      let latest = null;
      let updateAvailable = false;
      if (record) {
        try {
          const releases = await this.fetchReleases(owner, repo);
          const l = releases.find((r) => !r.prerelease) || releases[0];
          latest = l ? l.tag : null;
          updateAvailable = Boolean(latest && compareVersions(latest, record.tag) > 0);
        } catch {
          latest = null;
          updateAvailable = false;
        }
      }
      return {
        owner,
        repo,
        installed: Boolean(record),
        installedVersion: record ? record.tag : null,
        pluginName: record ? record.pluginName : null,
        latest,
        updateAvailable
      };
    };
    let seed = DEFAULT_REPOS;
    try {
      const discovered = await this.discoverRepos(DEFAULT_REPO_OWNER);
      if (discovered.length) {
        seed = discovered;
      }
    } catch {
      // fall back to DEFAULT_REPOS
    }
    for (const { owner, repo } of seed) {
      seen.add(repo);
      repos.push(await withUpdate(owner, repo, this.state.repos[repo] || null));
    }
    for (const [repo, record] of Object.entries(this.state.repos)) {
      if (!seen.has(repo)) {
        seen.add(repo);
        repos.push(await withUpdate(record.owner, repo, record));
      }
    }
    return repos;
  }

  async repoDetail(owner, repo) {
    const record = this.state.repos[repo] || null;
    const base = {
      owner,
      repo,
      installed: Boolean(record),
      installedVersion: record ? record.tag : null,
      pluginName: record ? record.pluginName : null,
      copyName: record ? record.copyName : null,
      duplicateFolders: record ? this.findDuplicateFolders(record.pluginId, record.copyName) : []
    };

    let releases;
    try {
      releases = await this.fetchReleases(owner, repo);
    } catch (error) {
      return {
        ...base,
        latest: null,
        updateAvailable: false,
        releases: [],
        readme: null,
        unavailable: { reason: error.reason || 'network', message: error.message }
      };
    }

    if (!releases.length) {
      return {
        ...base,
        latest: null,
        updateAvailable: false,
        releases: [],
        readme: null,
        unavailable: { reason: 'branch', message: 'no tagged releases yet' }
      };
    }

    const latest = releases.find((r) => !r.prerelease) || releases[0];
    let readme = null;
    if (latest) {
      readme = await this.fetchReadme(owner, repo, latest.tag);
    }

    let anyCompatible = Boolean(record);
    for (const release of releases.slice(0, 10)) {
      let compatible = true;
      try {
        compatible = await this.hasPluginJson(owner, repo, release.tag);
      } catch {
        compatible = true;
      }
      release.compatible = compatible;
      if (compatible) {
        anyCompatible = true;
      }
    }

    return {
      ...base,
      latest: latest.tag,
      updateAvailable: Boolean(record && compareVersions(latest.tag, record.tag) > 0),
      releases,
      readme,
      unavailable: anyCompatible
        ? null
        : { reason: 'compatibility', message: 'Created before UsagiAI' }
    };
  }

  async ensureRepo({ owner, repo, tag }) {
    const cacheDir = path.join(this.cacheDir, repo);
    const marker = path.join(cacheDir, '.source-tag');
    if (fs.existsSync(cacheDir) && fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').trim() === tag) {
      return cacheDir;
    }

    const tmp = path.join(this.cacheDir, `.tmp-${repo}-${Date.now()}`);
    fs.mkdirSync(tmp, { recursive: true });
    const tarballPath = path.join(tmp, 'download.tar.gz');
    const url = `${CODELOAD}/${owner}/${repo}/tar.gz/refs/tags/${encodeURIComponent(tag)}`;
    log(`downloading ${url}`);
    let res;
    try {
      res = await fetch(url);
    } catch (error) {
      fs.rmSync(tmp, { recursive: true, force: true });
      throw createError(`download ${url} failed: ${error.message}`, 'network');
    }
    if (!res.ok) {
      fs.rmSync(tmp, { recursive: true, force: true });
      throw createError(`download ${url} failed: ${res.status} ${res.statusText}`, reasonForStatus(res.status));
    }
    fs.writeFileSync(tarballPath, Buffer.from(await res.arrayBuffer()));
    await extractTarball(tarballPath, tmp);
    const entries = fs.readdirSync(tmp).filter((n) => n !== 'download.tar.gz');
    const top = entries.find((n) => fs.statSync(path.join(tmp, n)).isDirectory());
    if (!top) {
      fs.rmSync(tmp, { recursive: true, force: true });
      throw new Error(`tarball for ${repo}@${tag} had no top-level folder`);
    }
    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.cpSync(path.join(tmp, top), cacheDir, { recursive: true });
    fs.writeFileSync(marker, tag);
    fs.rmSync(tmp, { recursive: true, force: true });
    return cacheDir;
  }

  resolvePluginFolder(cacheDir, repo) {
    if (fs.existsSync(path.join(cacheDir, 'plugin.json'))) {
      return cacheDir;
    }
    const pluginsSub = path.join(cacheDir, 'plugins');
    if (fs.existsSync(pluginsSub)) {
      for (const name of fs.readdirSync(pluginsSub)) {
        const dir = path.join(pluginsSub, name);
        if (fs.statSync(dir).isDirectory() && fs.existsSync(path.join(dir, 'plugin.json'))) {
          return dir;
        }
      }
    }
    throw new Error(`no plugin.json at repo root or plugins/ in ${repo}`);
  }

  pickCopyName(repo) {
    let name = repo;
    let suffix = 2;
    while (fs.existsSync(path.join(this.pluginsDir, name))) {
      name = `${repo}-${suffix}`;
      suffix += 1;
    }
    return name;
  }

  findDuplicateFolders(pluginId, exceptCopyName) {
    const matches = [];
    if (!fs.existsSync(this.pluginsDir)) {
      return matches;
    }
    for (const name of fs.readdirSync(this.pluginsDir)) {
      if (name.startsWith('.') || name === exceptCopyName) {
        continue;
      }
      const dir = path.join(this.pluginsDir, name);
      if (!fs.statSync(dir).isDirectory() || !fs.existsSync(path.join(dir, 'plugin.json'))) {
        continue;
      }
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'));
        if (manifest && manifest.id === pluginId) {
          matches.push(name);
        }
      } catch {
        // unreadable manifest: ignore
      }
    }
    return matches;
  }

  async copyToPlugins({ repo, cacheDir, tag }) {
    const pluginDir = this.resolvePluginFolder(cacheDir, repo);
    const manifest = readPluginManifest(pluginDir);
    const existing = this.state.repos[repo];
    const copyName = (existing && existing.copyName) || this.pickCopyName(repo);
    const target = path.join(this.pluginsDir, copyName);
    log(`installing ${repo}@${tag} as ${copyName}`);
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(pluginDir, target, { recursive: true });
    return { manifest, copyName };
  }

  async runBuild(pluginDir, manifest, onProgress) {
    const steps = manifest.build && manifest.build.steps;
    const progress = onProgress || (() => {});
    if (!Array.isArray(steps) || steps.length === 0) {
      return;
    }
    const base = 0.4;
    const span = 0.55;
    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i];
      const command = step && step.command;
      if (!Array.isArray(command) || command.length === 0 || !command.every((c) => typeof c === 'string')) {
        throw createError(`invalid build step in ${path.basename(pluginDir)}`, 'build');
      }
      const cwd = path.resolve(pluginDir, step.cwd || '.');
      const commandLine = command.map((part) => (/\s/.test(part) ? `"${part}"` : part)).join(' ');
      progress(`Build step ${i + 1}/${steps.length}: ${commandLine}`, base + (span * i) / steps.length);
      log(`building ${path.basename(pluginDir)}: ${commandLine}`);
      await new Promise((resolve, reject) => {
        const proc = spawn(commandLine, { cwd, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        proc.stdout.on('data', (chunk) => {
          output += chunk;
        });
        proc.stderr.on('data', (chunk) => {
          output += chunk;
        });
        const fail = (reason) => reject(createError(`build step "${commandLine}" failed: ${reason}\n${output.slice(-400)}`, 'build'));
        const timer = setTimeout(() => {
          proc.kill();
          fail('timed out after 10 minutes');
        }, 600000);
        proc.on('error', (error) => {
          clearTimeout(timer);
          fail(error.message);
        });
        proc.on('exit', (code) => {
          clearTimeout(timer);
          if (code === 0) {
            resolve();
          } else {
            fail(`exit code ${code}`);
          }
        });
      });
      progress(`Finished build step ${i + 1}/${steps.length}`, base + (span * (i + 1)) / steps.length);
    }
  }

  async findCompatibleRelease({ owner, repo, releases }) {
    for (const release of releases.slice(0, 10)) {
      try {
        const cacheDir = await this.ensureRepo({ owner, repo, tag: release.tag });
        this.resolvePluginFolder(cacheDir, repo);
        return release;
      } catch (error) {
        if (error && error.message && error.message.includes('no plugin.json')) {
          log(`${repo}@${release.tag}: no plugin.json, skipping`);
          continue;
        }
        throw error;
      }
    }
    return null;
  }

  async install({ owner, repo, tag, onProgress }) {
    const progress = onProgress || (() => {});
    if (this.state.repos[repo]) {
      throw createError(`${repo} is already installed; use update or repair`, 'alreadyInstalled');
    }
    progress('Fetching releases', 0.05);
    let releases;
    try {
      releases = await this.fetchReleases(owner, repo);
    } catch (error) {
      throw classifyError(error);
    }
    let selected = null;
    if (tag) {
      selected = releases.find((r) => r.tag === tag);
      if (!selected) {
        throw createError(`no release ${tag} for ${owner}/${repo}`, 'notFound');
      }
    } else {
      try {
        selected = await this.findCompatibleRelease({ owner, repo, releases });
      } catch (error) {
        throw classifyError(error);
      }
      if (!selected) {
        throw createError(`no release of ${repo} contains a plugin.json yet`, 'compatibility');
      }
    }
    progress(`Downloading ${selected.tag}`, 0.15);
    let cacheDir;
    try {
      cacheDir = await this.ensureRepo({ owner, repo, tag: selected.tag });
    } catch (error) {
      throw classifyError(error);
    }
    progress('Preparing files', 0.3);
    try {
      this.resolvePluginFolder(cacheDir, repo);
    } catch {
      throw createError(`release ${selected.tag} of ${repo} has no plugin.json; try a different version`, 'compatibility');
    }
    const { manifest, copyName } = await this.copyToPlugins({ repo, cacheDir, tag: selected.tag });
    progress('Installing files', 0.4);
    try {
      await this.runBuild(path.join(this.pluginsDir, copyName), manifest, onProgress);
    } catch (error) {
      fs.rmSync(path.join(this.pluginsDir, copyName), { recursive: true, force: true });
      throw error;
    }
    progress('Finalizing', 0.98);

    const duplicateFolders = this.findDuplicateFolders(manifest.id, copyName);
    this.state.repos[repo] = {
      owner,
      repo,
      tag: selected.tag,
      pluginId: manifest.id,
      pluginName: manifest.name,
      copyName,
      installedAt: new Date().toISOString()
    };
    this.saveState();
    return {
      repo,
      tag: selected.tag,
      copyName,
      plugin: { id: manifest.id, name: manifest.name, version: manifest.version },
      duplicateFolders
    };
  }

  async update({ owner, repo, tag, onProgress }) {
    const progress = onProgress || (() => {});
    const existing = this.state.repos[repo];
    if (!existing) {
      throw createError(`${owner}/${repo} is not installed`, 'notInstalled');
    }
    progress('Fetching releases', 0.05);
    let releases;
    try {
      releases = await this.fetchReleases(owner, repo);
    } catch (error) {
      throw classifyError(error);
    }
    let selected = null;
    if (tag) {
      selected = releases.find((r) => r.tag === tag);
      if (!selected) {
        throw createError(`no release ${tag} for ${owner}/${repo}`, 'notFound');
      }
    } else {
      try {
        selected = await this.findCompatibleRelease({ owner, repo, releases });
      } catch (error) {
        throw classifyError(error);
      }
      if (!selected) {
        throw createError(`no release of ${repo} contains a plugin.json yet`, 'compatibility');
      }
    }
    if (selected.tag === existing.tag) {
      return {
        repo,
        tag: selected.tag,
        copyName: existing.copyName,
        noop: true,
        plugin: { id: existing.pluginId, name: existing.pluginName, version: existing.tag }
      };
    }
    progress(`Downloading ${selected.tag}`, 0.15);
    const cacheDir = await this.ensureRepo({ owner, repo, tag: selected.tag });
    progress('Preparing files', 0.3);
    const { manifest, copyName } = await this.copyToPlugins({ repo, cacheDir, tag: selected.tag });
    progress('Installing files', 0.4);
    try {
      await this.runBuild(path.join(this.pluginsDir, copyName), manifest, onProgress);
    } catch (error) {
      fs.rmSync(path.join(this.pluginsDir, copyName), { recursive: true, force: true });
      throw error;
    }
    progress('Finalizing', 0.98);
    this.state.repos[repo] = {
      ...existing,
      tag: selected.tag,
      pluginId: manifest.id,
      pluginName: manifest.name,
      installedAt: new Date().toISOString()
    };
    this.saveState();
    return {
      repo,
      tag: selected.tag,
      copyName,
      plugin: { id: manifest.id, name: manifest.name, version: manifest.version }
    };
  }

  async repair({ owner, repo, onProgress }) {
    const progress = onProgress || (() => {});
    const existing = this.state.repos[repo];
    if (!existing) {
      throw createError(`${owner}/${repo} is not installed`, 'notInstalled');
    }
    progress(`Restoring ${existing.tag}`, 0.15);
    let cacheDir;
    try {
      cacheDir = await this.ensureRepo({ owner, repo, tag: existing.tag });
    } catch (error) {
      throw classifyError(error);
    }
    progress('Preparing files', 0.3);
    const { manifest, copyName } = await this.copyToPlugins({ repo, cacheDir, tag: existing.tag });
    progress('Installing files', 0.4);
    try {
      await this.runBuild(path.join(this.pluginsDir, copyName), manifest, onProgress);
    } catch (error) {
      fs.rmSync(path.join(this.pluginsDir, copyName), { recursive: true, force: true });
      throw error;
    }
    progress('Finalizing', 0.98);
    this.state.repos[repo] = {
      ...existing,
      pluginId: manifest.id,
      pluginName: manifest.name,
      installedAt: new Date().toISOString()
    };
    this.saveState();
    return {
      repo,
      tag: existing.tag,
      copyName,
      plugin: { id: manifest.id, name: manifest.name, version: manifest.version }
    };
  }

  async uninstall({ owner, repo }) {
    const existing = this.state.repos[repo];
    if (!existing) {
      throw createError(`${owner}/${repo} is not installed`, 'notInstalled');
    }
    const target = path.join(this.pluginsDir, existing.copyName);
    log(`uninstalling ${repo} (${existing.copyName})`);
    fs.rmSync(target, { recursive: true, force: true });
    delete this.state.repos[repo];
    this.saveState();
    return { repo, removed: true, copyName: existing.copyName, pluginId: existing.pluginId };
  }
}

module.exports = { Registry, DEFAULT_REPOS, compareVersions };
