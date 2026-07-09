const { app, BrowserWindow, Menu, ipcMain, net, protocol, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const settingsManager          = require('./components/settingsManager');
const drpc                     = require('./components/drpc');
const { initResourceSwapper, getSwapperFolder } = require('./components/swapper');
app.setName('Celeste Client');
app.setAppUserModelId('dev.imnotkoolkid.celesteclient');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096 --turbo-fast-api-calls --future');
protocol.registerSchemesAsPrivileged([
  { scheme: 'celeste', privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true } }
]);
settingsManager.init();
drpc.init(settingsManager.settings);

let mainWindow;
let splashWindow;
let _updateDownloaded = false;


function configureUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null; 

  autoUpdater.on('update-downloaded', () => {
    _updateDownloaded = true;
    autoUpdater.quitAndInstall(true, true);
  });

  autoUpdater.on('error', () => {});
}


function splashProgress(step) {
  if (!splashWindow || splashWindow.isDestroyed()) return;
  try {
    splashWindow.webContents.executeJavaScript(
      `window.__celesteProgress && window.__celesteProgress(${step});`
    ).catch(() => {});
  } catch (_) {}
}

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 680,
    height: 340,
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: false,
    center: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  splashWindow.loadFile(path.join(__dirname, 'assets', 'html', 'loading.html'));
  
  let fakeStep = 1;
  let progressTimer = null;

  splashWindow.once('ready-to-show', () => {
    splashWindow.show();
    splashProgress(fakeStep);
    
    progressTimer = setInterval(() => {
      if (!splashWindow || splashWindow.isDestroyed()) {
        clearInterval(progressTimer);
        return;
      }
      if (fakeStep < 6) {
        fakeStep++;
        splashProgress(fakeStep);
      } else {
        clearInterval(progressTimer);
      }
    }, 500);

    splashWindow.progressTimer = progressTimer;
  });
}

function closeSplash() {
  if (!splashWindow || splashWindow.isDestroyed()) return;
  if (splashWindow.progressTimer) clearInterval(splashWindow.progressTimer);
  splashProgress(7);
  splashWindow.close();
  splashWindow = null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    minWidth: 900,
    minHeight: 540,
    title: 'Celeste',
    backgroundColor: '#1e1e1e',
    icon: path.join(__dirname, 'assets/img/icon.png'),
    show: false,
    fullscreen: settingsManager.get('start fullscreen') === true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
      spellcheck: false
    }
  });
  Menu.setApplicationMenu(null);
  mainWindow.on('page-title-updated', e => e.preventDefault());

  ipcMain.once('loading-done',   () => {
    if (!settingsManager.get('start fullscreen')) mainWindow.maximize();
    mainWindow.show();
    closeSplash();
  });

  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow.webContents.setZoomLevel(settingsManager.get('zoom level') || 0);
  });

  mainWindow.once('ready-to-show', () => {

    if (splashWindow && !splashWindow.isDestroyed()) {
      if (!settingsManager.get('start fullscreen')) mainWindow.maximize();
      mainWindow.show();
      closeSplash();
    }
  });

  mainWindow.loadURL('https://kirka.io/');
  const onNavigate = (_, url) => drpc.setState(url);
  mainWindow.webContents.on('did-navigate', onNavigate);
  mainWindow.webContents.on('did-navigate-in-page', onNavigate);
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.setZoomLevel(settingsManager.get('zoom level') || 0);
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  const os = require('os');
  try {
    os.setPriority(os.constants.priority.PRIORITY_HIGH);
  } catch (e) {
    console.error('Failed to set process priority:', e);
  }

  initResourceSwapper(settingsManager.get('swapper enabled') !== false);

  createSplash();

  configureUpdater();
  if (app.isPackaged) {
    autoUpdater.checkForUpdates().catch(() => {}).finally(() => {
      if (!_updateDownloaded) createWindow();
    });
  } else {
    createWindow();
  }

  const fs = require('fs');
  const MAX_CACHE = 256;
  class LRUCache {
    constructor(max) { this.max = max; this.map = new Map(); }
    has(key) { return this.map.has(key); }
    get(key) {
      if (!this.map.has(key)) return undefined;
      const val = this.map.get(key);
      this.map.delete(key);
      this.map.set(key, val);
      return val;
    }
    set(key, val) {
      if (this.map.has(key)) this.map.delete(key);
      else if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value);
      this.map.set(key, val);
    }
  }
  const resourceCache = new LRUCache(MAX_CACHE);
  ipcMain.handle('fetch-resource', (_, url) => new Promise(resolve => {
    if (resourceCache.has(url)) return resolve(resourceCache.get(url));
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      fs.readFile(url, 'utf8', (err, data) => {
        const body = err ? '' : data;
        resourceCache.set(url, body);
        resolve(body);
      });
      return;
    }
    try {
      const req = net.request(url);
      const chunks = [];
      req.on('response', res => {
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          resourceCache.set(url, body);
          resolve(body);
        });
      });
      req.on('error', err => { console.error('Fetch resource error:', err); resolve(''); });
      req.end();
    } catch (err) {
      console.error('Fetch resource exception:', err);
      resolve('');
    }
  }));
  ipcMain.on('action-fullscreen', e => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win) win.setFullScreen(!win.isFullScreen());
  });
  ipcMain.on('action-devtools', e => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win) win.webContents.toggleDevTools();
  });
  ipcMain.on('action-open-swapper-folder', () => {
    const folder = getSwapperFolder();
    const fs = require('fs');
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
    shell.openPath(folder);
  });
  ipcMain.on('action-quick-restart', () => { app.relaunch(); app.exit(); });
  let _zoomLevel = settingsManager.get('zoom level') || 0;
  ipcMain.on('action-zoom', (e, dir) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
    if (dir === 'reset') _zoomLevel = 0;
    else if (dir === 'in') _zoomLevel += 1;
    else if (dir === 'out') _zoomLevel -= 1;
    win.webContents.setZoomLevel(_zoomLevel);
    settingsManager.settings['zoom level'] = _zoomLevel;
    settingsManager.scheduleSave();
  });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!mainWindow) createWindow(); });