const path = require('path');
const { app, BrowserWindow, Menu } = require('electron');
const { setupAutoUpdate } = require('@waypointnull/auto-update');
const { createHub } = require('./hub');

let hub = null;
let win = null;

function log(...args) {
  console.log('[usagi]', ...args);
}

async function bootstrap() {
  const userData = app.getPath('userData');
  const options = {
    pluginsDir: path.join(__dirname, '..', 'plugins'),
    dataDir: path.join(userData, 'history')
  };
  if (app.isPackaged) {
    options.pluginsDir = path.join(userData, 'plugins');
    options.registryCacheDir = path.join(userData, 'registryCache');
    options.registryStateFile = path.join(userData, 'plugins.json');
    options.sdkPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'sdk', 'index.js');
  }
  hub = await createHub(options);

  Menu.setApplicationMenu(null);

  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: 'UsagiAI',
    icon: path.join(__dirname, '..', 'client', 'public', 'icon.png'),
    backgroundColor: '#0e0d18',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  win.loadURL(`http://127.0.0.1:${hub.port}`);
  win.on('closed', () => {
    win = null;
  });

  setupAutoUpdate({ onError: (error) => log('auto-update:', (error && error.message) || error) });
}

app.whenReady()
  .then(bootstrap)
  .catch((error) => {
    log('fatal:', error);
    app.exit(1);
  });

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  if (hub) {
    hub.stopAll();
  }
});
