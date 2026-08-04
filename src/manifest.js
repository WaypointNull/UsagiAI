const fs = require('fs');
const path = require('path');

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

function readPluginManifest(dir) {
  const manifestPath = path.join(dir, 'plugin.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`no plugin.json at ${manifestPath}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const error = validateManifest(manifest);
  if (error) {
    throw new Error(`invalid plugin.json: ${error}`);
  }
  return manifest;
}

module.exports = { validateManifest, readPluginManifest };
