const { app, BrowserWindow, Menu, ipcMain, net, protocol, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const os = require('os');
const settingsManager = require('./components/settingsManager');
const drpc = require('./components/drpc');
const { initResourceSwapper, getSwapperFolder } = require('./components/swapper');

app.setName('Celeste Client');
app.setAppUserModelId('dev.imnotkoolkid.celesteclient');

app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-ipc-flooding-protection');
app.commandLine.appendSwitch('force-color-profile', 'srgb');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');

protocol.registerSchemesAsPrivileged([
  { scheme: 'celeste', privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true } }
]);
settingsManager.init();
drpc.init(settingsManager.settings);

let mainWindow;
let splashWindow;
let _updateDownloaded = false;
const _incognitoSettings = new Map();

function isIncognito(wc) {
  return _incognitoSettings.has(wc.id);
}

function createIncognitoWindow(useCurrentSettings = false) {
  const baseSettings = useCurrentSettings
    ? { ...settingsManager.settings }
    : { ...settingsManager.defaults };

  const incognitoWin = new BrowserWindow({
    minWidth: 900,
    minHeight: 540,
    title: 'Celeste - Incognito',
    backgroundColor: '#0d0d1a',
    icon: path.join(__dirname, 'assets/img/icon.png'),
    show: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
      spellcheck: false,
      partition: 'incognito',
    }
  });

  Menu.setApplicationMenu(null);
  incognitoWin.maximize();
  incognitoWin.on('page-title-updated', e => e.preventDefault());
  incognitoWin.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  const wcId = incognitoWin.webContents.id;
  _incognitoSettings.set(wcId, { ...baseSettings });
  incognitoWin.loadURL('https://kirka.io/');
  incognitoWin.on('closed', () => { _incognitoSettings.delete(wcId); });
}

function boostProcessPriorities() {
  try {
    for (const proc of app.getAppMetrics()) {
      if (proc.type === 'GPU' || proc.type === 'Tab' || proc.type === 'Renderer') {
        try { os.setPriority(proc.pid, os.constants.priority.PRIORITY_HIGH); } catch (_) {}
      }
    }
  } catch (_) {}
}

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
  splashWindow.webContents.executeJavaScript(`window.__celesteProgress?.(${step});`).catch(() => {});
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
      sandbox: process.platform !== 'linux',
    },
  });
  splashWindow.loadFile(path.join(__dirname, 'assets', 'html', 'loading.html'));

  let fakeStep = 1;
  splashWindow.once('ready-to-show', () => {
    if (!splashWindow || splashWindow.isDestroyed()) return;
    splashWindow.show();
    splashProgress(fakeStep);

    splashWindow.progressTimer = setInterval(() => {
      if (!splashWindow || splashWindow.isDestroyed()) {
        clearInterval(splashWindow?.progressTimer);
        return;
      }
      if (++fakeStep <= 6) {
        splashProgress(fakeStep);
      } else {
        clearInterval(splashWindow.progressTimer);
      }
    }, 500);
  });
}

function closeSplash() {
  if (!splashWindow || splashWindow.isDestroyed()) return;
  if (splashWindow.progressTimer) clearInterval(splashWindow.progressTimer);
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
      spellcheck: false,
    }
  });
  Menu.setApplicationMenu(null);
  mainWindow.on('page-title-updated', e => e.preventDefault());

  let isWindowShown = false;
  const showMainWindow = () => {
    if (isWindowShown) return;
    isWindowShown = true;
    if (!settingsManager.get('start fullscreen')) mainWindow.maximize();
    mainWindow.show();
    closeSplash();
  };

  ipcMain.once('loading-done', showMainWindow);
  mainWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) showMainWindow();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
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

app.whenReady().then(async () => {
  try { os.setPriority(os.constants.priority.PRIORITY_HIGH); } catch (_) {}

  await initResourceSwapper(settingsManager.get('swapper enabled') !== false);
  createSplash();
  configureUpdater();

  if (app.isPackaged) {
    const updateCheck = autoUpdater.checkForUpdates().catch(() => {});
    await Promise.race([updateCheck, new Promise(r => setTimeout(r, 5000))]);
    if (!_updateDownloaded) createWindow();
  } else {
    createWindow();
  }

  boostProcessPriorities();

  ipcMain.on('action-open-incognito', (_, useCurrentSettings) => createIncognitoWindow(useCurrentSettings));

  ipcMain.handle('get-settings', e => isIncognito(e.sender) ? _incognitoSettings.get(e.sender.id) : settingsManager.settings);

  ipcMain.handle('update-setting', (e, key, value) => {
    if (isIncognito(e.sender)) {
      const s = _incognitoSettings.get(e.sender.id);
      if (s) s[key] = value;
      return { success: true };
    }
    settingsManager.settings[key] = value;
    settingsManager.scheduleSave();
    return { success: true };
  });

  ipcMain.handle('update-settings-bulk', (e, newSettings) => {
    const target = isIncognito(e.sender) ? _incognitoSettings.get(e.sender.id) : settingsManager.settings;
    if (target) {
      Object.keys(target).forEach(k => delete target[k]);
      Object.assign(target, newSettings);
      if (!isIncognito(e.sender)) settingsManager.scheduleSave();
    }
    return { success: true };
  });

  const MAX_CACHE = 256;
  const resourceCache = new Map();
  ipcMain.handle('fetch-resource', async (_, url) => {
    if (resourceCache.has(url)) return resourceCache.get(url);
    if (!url.startsWith('http://') && !url.startsWith('https://')) return '';
    try {
      const res = await net.fetch(url);
      if (!res.ok) return '';
      const body = await res.text();
      if (resourceCache.size >= MAX_CACHE) resourceCache.delete(resourceCache.keys().next().value);
      resourceCache.set(url, body);
      return body;
    } catch (err) {
      console.error('Fetch resource error:', err);
      return '';
    }
  });

  ipcMain.on('action-fullscreen', e => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win) win.setFullScreen(!win.isFullScreen());
  });

  let devtools = undefined;
  ipcMain.on('action-devtools', e => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
    if (process.platform !== 'linux') {
      win.webContents.toggleDevTools();
    } else {
      if (!devtools || devtools.isDestroyed()) {
        devtools = new BrowserWindow({ parent: win, width: 800, height: 600 });
        win.webContents.setDevToolsWebContents(devtools.webContents);
        win.webContents.openDevTools({ mode: 'detach' });
      } else {
        devtools.close();
      }
    }
  });

  ipcMain.on('action-open-swapper-folder', () => {
    const folder = getSwapperFolder();
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
app.on('before-quit', () => drpc.destroy());
app.on('activate', () => { if (!mainWindow) createWindow(); });
