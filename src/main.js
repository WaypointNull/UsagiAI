const path = require('path');
const { app, BrowserWindow, Menu } = require('electron');
const { createHub } = require('./hub');

let hub = null;
let win = null;

function log(...args) {
  console.log('[usagi]', ...args);
}

async function bootstrap() {
  hub = await createHub({
    pluginsDir: path.join(__dirname, '..', 'plugins'),
    dataDir: path.join(app.getPath('userData'), 'history')
  });

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
      sandbox: true
    }
  });

  win.loadURL(`http://127.0.0.1:${hub.port}`);
  win.on('closed', () => {
    win = null;
  });
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
