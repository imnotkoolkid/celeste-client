const { BrowserWindow, Menu, shell, session, ipcMain } = require('electron');
const path = require('path');
const settingsManager = require('./settingsManager');
const proxyManager = require('./proxyManager');
const drpc = require('./drpc');

let mainWindow = null;
let splashWindow = null;
let devtools = null;

const _incognitoSettings = new Map();
const _incognitoSessions = new Map();
let _incognitoSeq = 0;

function isIncognito(wc) {
  if (!wc || !wc.id) return false;
  if (_incognitoSettings.has(wc.id)) return true;
  for (const s of _incognitoSessions.values()) {
    if (wc.session === s) return true;
  }
  return false;
}

function getSettingsForWebContents(wc) {
  if (!wc || !wc.id) return settingsManager.settings;
  if (_incognitoSettings.has(wc.id)) return _incognitoSettings.get(wc.id);
  for (const [id, s] of _incognitoSessions.entries()) {
    if (wc.session === s) return _incognitoSettings.get(id);
  }
  return settingsManager.settings;
}

function getIncognitoSettings(wcId) {
  return _incognitoSettings.get(wcId);
}

function getIncognitoSession(wcId) {
  return _incognitoSessions.get(wcId);
}

function getAllIncognitoSettings() {
  return [..._incognitoSettings.values()];
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

  splashWindow.loadFile(path.join(__dirname, '..', 'assets', 'html', 'loading.html'));

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

function applyFrameCapToWindow(win, capVal) {
  if (!win || win.isDestroyed() || typeof win.setFrameCap !== 'function') return;
  const num = parseInt(capVal, 10) || 0;
  try {
    win.setFrameCap(num > 0 ? num : 0);
  } catch (err) {
    console.error('Failed to set frame cap on window:', err);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    minWidth: 900,
    minHeight: 540,
    title: 'Celeste',
    backgroundColor: '#1e1e1e',
    icon: path.join(__dirname, '..', 'assets', 'img', 'icon.png'),
    show: false,
    fullscreen: settingsManager.get('start fullscreen') === true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, '..', 'preload.js'),
      backgroundThrottling: false,
      spellcheck: false,
    }
  });

  Menu.setApplicationMenu(null);
  mainWindow.on('page-title-updated', e => e.preventDefault());
  applyFrameCapToWindow(mainWindow, settingsManager.get('custom frame cap'));

  let isWindowShown = false;
  const showMainWindow = () => {
    if (isWindowShown) return;
    isWindowShown = true;
    if (!settingsManager.get('start fullscreen')) mainWindow.maximize();
    mainWindow.show();
    closeSplash();
    drpc.init(settingsManager.settings);
  };

  ipcMain.once('loading-done', showMainWindow);
  mainWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) showMainWindow();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        shell.openExternal(url);
      }
    } catch (_) {}
    return { action: 'deny' };
  });

  const shouldMask = !!settingsManager.get('mask ip');
  const proxyCfg = proxyManager.getProxyConfig(settingsManager.settings);

  if (shouldMask && !proxyCfg) {
    proxyManager.setProxyFailed(false, null, true);
    mainWindow.loadFile(path.join(__dirname, '..', 'assets', 'html', 'blank.html')).then(() => {
      showMainWindow();
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('show-proxy-error-popup');
        }
      }, 150);
    }).catch(err => console.error('Failed to load blank.html:', err));
  } else {
    mainWindow.loadURL('https://kirka.io/');
  }

  const onNavigate = (_, url) => drpc.setState(url);
  mainWindow.webContents.on('did-navigate', onNavigate);
  mainWindow.webContents.on('did-navigate-in-page', onNavigate);

  const handleLoadFailure = (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    if (validatedURL && validatedURL.includes('blank.html')) return;
    if (errorCode === -3) return;

    const maskedNow = !!settingsManager.get('mask ip');
    const isProxyErr = proxyManager.isProxyError(errorCode, maskedNow);

    if (isProxyErr) {
      proxyManager.setProxyFailed(false, null, true);
      mainWindow.loadFile(path.join(__dirname, '..', 'assets', 'html', 'blank.html')).then(() => {
        showMainWindow();
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('show-proxy-error-popup');
          }
        }, 150);
      }).catch(err => console.error('Failed to load blank.html:', err));
    }
  };

  mainWindow.webContents.on('did-fail-load', handleLoadFailure);

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.setZoomLevel(settingsManager.get('zoom level') || 0);
  });

  mainWindow.on('closed', () => { mainWindow = null; });
  return mainWindow;
}

async function createIncognitoWindow(useCurrentSettings = false) {
  const baseSettings = useCurrentSettings
    ? JSON.parse(JSON.stringify(settingsManager.settings))
    : JSON.parse(JSON.stringify(settingsManager.defaults));

  const alwaysMask = !!settingsManager.get('incognito always mask ip');
  if (alwaysMask || settingsManager.get('mask ip')) {
    baseSettings['mask ip'] = true;
    for (const k of proxyManager.PROXY_KEYS) {
      baseSettings[k] = settingsManager.get(k) ?? baseSettings[k];
    }
  }

  const shouldMask = !!baseSettings['mask ip'];
  const cfg = proxyManager.getProxyConfig(baseSettings);

  const partition = `incognito-${Date.now()}-${++_incognitoSeq}`;
  const incognitoSession = session.fromPartition(partition);

  await proxyManager.applyProxyToSession(incognitoSession, baseSettings);

  const incognitoWin = new BrowserWindow({
    minWidth: 900,
    minHeight: 540,
    title: 'Celeste - Incognito',
    backgroundColor: '#0d0d1a',
    icon: path.join(__dirname, '..', 'assets', 'img', 'icon.png'),
    show: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, '..', 'preload.js'),
      backgroundThrottling: false,
      spellcheck: false,
      partition,
    }
  });

  Menu.setApplicationMenu(null);
  incognitoWin.maximize();
  incognitoWin.on('page-title-updated', e => e.preventDefault());
  incognitoWin.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        shell.openExternal(url);
      }
    } catch (_) {}
    return { action: 'deny' };
  });

  const wcId = incognitoWin.webContents.id;
  _incognitoSettings.set(wcId, baseSettings);
  _incognitoSessions.set(wcId, incognitoWin.webContents.session);
  proxyManager.setProxyFailed(true, wcId, false);

  const handleIncognitoLoadFailure = (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    if (validatedURL && validatedURL.includes('blank.html')) return;
    if (errorCode === -3) return;

    const maskedNow = !!_incognitoSettings.get(wcId)?.['mask ip'];
    const isProxyErr = proxyManager.isProxyError(errorCode, maskedNow);

    if (isProxyErr) {
      proxyManager.setProxyFailed(true, wcId, true);
      incognitoWin.loadFile(path.join(__dirname, '..', 'assets', 'html', 'blank.html')).then(() => {
        setTimeout(() => {
          if (!incognitoWin.isDestroyed()) incognitoWin.webContents.send('show-proxy-error-popup');
        }, 150);
      }).catch(console.error);
    }
  };

  incognitoWin.webContents.on('did-fail-load', handleIncognitoLoadFailure);

  incognitoWin.on('closed', () => {
    _incognitoSettings.delete(wcId);
    _incognitoSessions.delete(wcId);
    proxyManager.clearIncognitoProxy(wcId);
    proxyManager.releaseSession(incognitoSession);
    incognitoSession.closeAllConnections().catch(() => {});
    incognitoSession.clearStorageData().catch(() => {});
    incognitoSession.clearCache().catch(() => {});
  });

  incognitoWin.webContents.on('did-finish-load', () => {
    incognitoWin.webContents.setZoomLevel(baseSettings['zoom level'] || 0);
  });
  applyFrameCapToWindow(incognitoWin, baseSettings['custom frame cap']);

  if (shouldMask && !cfg) {
    proxyManager.setProxyFailed(true, wcId, true);
    incognitoWin.loadFile(path.join(__dirname, '..', 'assets', 'html', 'blank.html')).then(() => {
      setTimeout(() => {
        if (!incognitoWin.isDestroyed()) incognitoWin.webContents.send('show-proxy-error-popup');
      }, 150);
    }).catch(console.error);
  } else {
    incognitoWin.loadURL('https://kirka.io/');
  }

  return incognitoWin;
}

function handleZoom(wc, dir) {
  const win = BrowserWindow.fromWebContents(wc);
  if (!win) return;
  const isIncog = isIncognito(wc);
  let level = win.webContents.getZoomLevel() || 0;
  if (dir === 'reset') level = 0;
  else if (dir === 'in') level += 1;
  else if (dir === 'out') level -= 1;
  win.webContents.setZoomLevel(level);
  if (isIncog) {
    const s = _incognitoSettings.get(wc.id);
    if (s) s['zoom level'] = level;
  } else {
    settingsManager.settings['zoom level'] = level;
    settingsManager.scheduleSave();
  }
}

function toggleFullscreen(wc) {
  const win = BrowserWindow.fromWebContents(wc);
  if (win) win.setFullScreen(!win.isFullScreen());
}

function toggleDevTools(wc) {
  const win = BrowserWindow.fromWebContents(wc);
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
}

function getMainWindow() {
  return mainWindow;
}

module.exports = {
  isIncognito,
  getSettingsForWebContents,
  getIncognitoSettings,
  getIncognitoSession,
  getAllIncognitoSettings,
  createSplash,
  closeSplash,
  splashProgress,
  createWindow,
  createIncognitoWindow,
  handleZoom,
  toggleFullscreen,
  toggleDevTools,
  getMainWindow,
  applyFrameCapToWindow
};
