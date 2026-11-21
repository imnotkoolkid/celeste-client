const { app, BrowserWindow, Menu, ipcMain, protocol, shell, session, webContents } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const settingsManager = require('./components/settingsManager');
const drpc = require('./components/drpc');
const { initResourceSwapper, getSwapperFolder } = require('./components/swapper');
const proxyGate = require('./components/proxyGate');

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

let mainWindow;
let splashWindow;
let _updateDownloaded = false;
let _availableUpdate = null;
const _incognitoSettings = new Map();

let _proxyConnectionFailed = false;
const _incognitoProxyFailed = new Map();
const _incognitoSessions = new Map();
let _incognitoSeq = 0;

const PROXY_KEYS = ['proxy mode', 'proxy protocol', 'proxy host', 'proxy port', 'proxy username', 'proxy password', 'proxy url'];
const PROXY_ERR_CODES = new Set([-100, -101, -102, -104, -105, -107, -109, -111, -115, -118, -120, -121, -124, -127, -130, -136, -324, -336]);

const PROXY_SCHEMES = {
  http: 'http',
  https: 'https',
  socks: 'socks5',
  socks5: 'socks5',
  socks5h: 'socks5',
  socks4: 'socks4',
  socks4a: 'socks4'
};

function buildProxyConfig(rawProtocol, host, port, username, password) {
  const protocol = PROXY_SCHEMES[String(rawProtocol || 'http').toLowerCase()];
  if (!protocol) return null;
  return {
    proxyRules: protocol === 'http' ? `${host}:${port}` : `${protocol}://${host}:${port}`,
    protocol,
    host,
    port: String(port),
    username: username || '',
    password: password || ''
  };
}

function safeDecode(val) {
  if (!val) return '';
  try {
    return decodeURIComponent(val);
  } catch (_) {
    return val;
  }
}

function splitHostPortStr(str) {
  const m = str.match(/^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/);
  return m ? [m[1], m[2] || ''] : ['', ''];
}

function parseProxyUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let str = raw.trim().replace(/^["']|["']$/g, '');
  if (!str) return null;

  try {
    let protocol = 'http';
    const protoMatch = str.match(/^([a-zA-Z0-9]+):\/\//);
    if (protoMatch) {
      protocol = protoMatch[1].toLowerCase();
      str = str.slice(protoMatch[0].length).trim();
    }

    let host = '', port = '', username = '', password = '';
    if (str.includes('@')) {
      const atIdx = str.lastIndexOf('@');
      const auth = str.slice(0, atIdx);
      const colon = auth.indexOf(':');
      username = safeDecode(colon !== -1 ? auth.slice(0, colon) : auth);
      password = colon !== -1 ? safeDecode(auth.slice(colon + 1)) : '';
      [host, port] = splitHostPortStr(str.slice(atIdx + 1).replace(/\/.*$/, ''));
    } else {
      const m = str.replace(/\/.*$/, '').match(/^(\[[^\]]+\]|[^:]+):(\d{1,5})(?::([^:]+):(.*))?$/);
      if (!m) return null;
      host = m[1];
      port = m[2];
      username = safeDecode(m[3]);
      password = safeDecode(m[4]);
    }

    host = host.trim();
    const portNum = parseInt(port, 10);
    if (!host || isNaN(portNum) || portNum < 1 || portNum > 65535) return null;

    return buildProxyConfig(protocol, host, String(portNum), username ? username.trim() : '', password);
  } catch (e) {
    console.error('Failed to parse proxy URL:', e);
    return null;
  }
}

function getManualProxyConfig(settings) {
  if (!settings) return null;
  let host = (settings['proxy host'] || '').trim().replace(/^[a-zA-Z0-9]+:\/\//, '').replace(/\/.*$/, '');
  let port = String(settings['proxy port'] || '').trim();
  const protocol = (settings['proxy protocol'] || 'http').toLowerCase();
  const username = (settings['proxy username'] || '').trim();
  const password = settings['proxy password'] || '';

  if (!port && host.includes(':') && !host.startsWith('[')) {
    const pIdx = host.lastIndexOf(':');
    port = host.slice(pIdx + 1);
    host = host.slice(0, pIdx);
  }

  if (!host) return null;
  const portNum = parseInt(port, 10);
  if (isNaN(portNum) || portNum < 1 || portNum > 65535 || !/^\d+$/.test(port)) return null;

  return buildProxyConfig(protocol, host, portNum, username, password);
}

function getUrlProxyConfig(settings) {
  if (!settings) return null;
  const proxyUrl = settings['proxy url'] || '';
  return parseProxyUrl(proxyUrl);
}

function getProxyConfig(settings) {
  if (!settings) return null;
  const mode = settings['proxy mode'] || 'manual';
  return mode === 'url' ? getUrlProxyConfig(settings) : getManualProxyConfig(settings);
}

const _sessionRoutes = new WeakMap();
const _proxyQueues = new WeakMap();

const BLOCKED_PROXY_RULES = 'http://127.0.0.1:1';

function setWebRtcPolicy(wc, masked) {
  try {
    wc.setWebRTCIPHandlingPolicy(masked ? 'disable_non_proxied_udp' : 'default');
  } catch (_) {}
}

async function setSessionRoute(ses, settings) {
  const wantMask = !!(settings && settings['mask ip']);
  const config = wantMask ? getProxyConfig(settings) : null;
  const prev = _sessionRoutes.get(ses);

  let proxyRules = '';
  let routeKey = 'direct';
  let gateKey = null;

  if (config) {
    proxyRules = config.proxyRules;
    if (proxyGate.SUPPORTED.has(config.protocol)) {
      try {
        const gate = await proxyGate.acquire(config);
        proxyRules = `127.0.0.1:${gate.port}`;
        gateKey = gate.key;
      } catch (err) {
        console.error('Failed to start proxy gate:', err);
      }
    }
    routeKey = `${proxyRules}|${config.username}|${config.password}`;
  } else if (wantMask) {
    if (prev && prev.routeKey === 'blocked') return { masked: prev.masked, changed: false };
    proxyRules = BLOCKED_PROXY_RULES;
    routeKey = 'blocked';
  }

  const masked = routeKey !== 'direct';

  try {
    await ses.setProxy(masked ? { mode: 'fixed_servers', proxyRules } : { mode: 'direct' });
  } catch (err) {
    console.error('Failed to set proxy:', err);
  }

  if (prev && prev.gateKey) proxyGate.release(prev.gateKey);
  _sessionRoutes.set(ses, { routeKey, gateKey, masked });

  for (const wc of webContents.getAllWebContents()) {
    if (!wc.isDestroyed() && wc.session === ses) setWebRtcPolicy(wc, masked);
  }

  return { masked, changed: (prev ? prev.routeKey : 'direct') !== routeKey };
}

const _pageRoutes = new Map();

function currentRouteKey(ses) {
  const route = _sessionRoutes.get(ses);
  return route ? route.routeKey : 'direct';
}

function needsReloadForProxy(wc) {
  if (!wc || wc.isDestroyed() || !/^https?:/i.test(wc.getURL() || '')) return false;
  return _pageRoutes.has(wc.id) && _pageRoutes.get(wc.id) !== currentRouteKey(wc.session);
}

function applyProxyToSession(ses, settings) {
  const run = () => setSessionRoute(ses, settings);
  const next = (_proxyQueues.get(ses) || Promise.resolve()).then(run, run);
  _proxyQueues.set(ses, next);
  return next;
}

function applyProxySettings(settings) {
  return applyProxyToSession(session.defaultSession, settings);
}

app.on('web-contents-created', (_, wc) => {
  const route = _sessionRoutes.get(wc.session);
  if (route && route.masked) setWebRtcPolicy(wc, true);

  const id = wc.id;
  wc.on('did-start-navigation', (details, _url, isInPlace, isMainFrame) => {
    const mainFrame = details.isMainFrame ?? isMainFrame;
    const sameDocument = details.isSameDocument ?? isInPlace;
    if (mainFrame && !sameDocument) _pageRoutes.set(id, currentRouteKey(wc.session));
  });
  wc.once('destroyed', () => _pageRoutes.delete(id));
});

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

function getProxyConfigForLogin(wc, authInfo) {
  if (wc && wc.id) return getProxyConfig(getSettingsForWebContents(wc));

  const askingHost = String(authInfo.host || '').replace(/^\[|\]$/g, '').toLowerCase();
  for (const s of [settingsManager.settings, ..._incognitoSettings.values()]) {
    if (!s || !s['mask ip']) continue;
    const config = getProxyConfig(s);
    if (!config || !config.username) continue;
    const host = config.host.replace(/^\[|\]$/g, '').toLowerCase();
    if (host === askingHost && String(config.port) === String(authInfo.port)) return config;
  }
  return getProxyConfig(settingsManager.settings);
}

async function createIncognitoWindow(useCurrentSettings = false) {
  const baseSettings = useCurrentSettings
    ? JSON.parse(JSON.stringify(settingsManager.settings))
    : JSON.parse(JSON.stringify(settingsManager.defaults));

  const alwaysMask = !!settingsManager.get('incognito always mask ip');
  if (alwaysMask || settingsManager.get('mask ip')) {
    baseSettings['mask ip'] = true;
    for (const k of PROXY_KEYS) {
      baseSettings[k] = settingsManager.get(k) ?? baseSettings[k];
    }
  }

  const shouldMask = !!baseSettings['mask ip'];
  const cfg = getProxyConfig(baseSettings);


  const partition = `incognito-${Date.now()}-${++_incognitoSeq}`;
  const incognitoSession = session.fromPartition(partition);

  await applyProxyToSession(incognitoSession, baseSettings);

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
      partition,
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
  _incognitoSettings.set(wcId, baseSettings);
  _incognitoSessions.set(wcId, incognitoWin.webContents.session);
  _incognitoProxyFailed.set(wcId, false);

  const handleIncognitoLoadFailure = (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    if (validatedURL && validatedURL.includes('blank.html')) return;
    if (errorCode === -3) return;

    const maskedNow = !!_incognitoSettings.get(wcId)?.['mask ip'];
    const isProxyErr = maskedNow && (errorCode < 0 || PROXY_ERR_CODES.has(errorCode));

    if (isProxyErr) {
      _incognitoProxyFailed.set(wcId, true);
      incognitoWin.loadFile(path.join(__dirname, 'assets', 'html', 'blank.html')).then(() => {
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
    _incognitoProxyFailed.delete(wcId);

    const route = _sessionRoutes.get(incognitoSession);
    if (route && route.gateKey) proxyGate.release(route.gateKey);
    _sessionRoutes.delete(incognitoSession);
    incognitoSession.closeAllConnections().catch(() => {});
    incognitoSession.clearStorageData().catch(() => {});
    incognitoSession.clearCache().catch(() => {});
  });

  incognitoWin.webContents.on('did-finish-load', () => {
    incognitoWin.webContents.setZoomLevel(baseSettings['zoom level'] || 0);
  });

  if (shouldMask && !cfg) {
    _incognitoProxyFailed.set(wcId, true);
    incognitoWin.loadFile(path.join(__dirname, 'assets', 'html', 'blank.html')).then(() => {
      setTimeout(() => {
        if (!incognitoWin.isDestroyed()) incognitoWin.webContents.send('show-proxy-error-popup');
      }, 150);
    }).catch(console.error);
  } else {
    incognitoWin.loadURL('https://kirka.io/');
  }
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

function configureAndCheckUpdater() {
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = null;

    autoUpdater.on('update-available', info => {
      _availableUpdate = {
        available: true,
        version: info?.version || ''
      };
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-status-changed', _availableUpdate);
      }
    });

    autoUpdater.on('download-progress', progress => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-download-progress', Math.round(progress?.percent || 0));
      }
    });

    autoUpdater.on('update-downloaded', () => {
      _updateDownloaded = true;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-downloaded');
      }
      autoUpdater.quitAndInstall(true, true);
    });

    autoUpdater.on('error', err => {
      console.log('Update check error:', err?.message || err);
    });

    autoUpdater.checkForUpdates().catch(() => {});
  } catch (err) {
    console.error('Updater configuration error:', err);
  }
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
    drpc.init(settingsManager.settings);
  };

  ipcMain.once('loading-done', showMainWindow);
  mainWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) showMainWindow();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  const shouldMask = !!settingsManager.get('mask ip');
  const proxyCfg = getProxyConfig(settingsManager.settings);

  if (shouldMask && !proxyCfg) {
    _proxyConnectionFailed = true;
    mainWindow.loadFile(path.join(__dirname, 'assets', 'html', 'blank.html')).then(() => {
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
    const isProxyErr = maskedNow && (errorCode < 0 || PROXY_ERR_CODES.has(errorCode));

    if (isProxyErr) {
      _proxyConnectionFailed = true;
      mainWindow.loadFile(path.join(__dirname, 'assets', 'html', 'blank.html')).then(() => {
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
}

app.whenReady().then(async () => {
  try { os.setPriority(os.constants.priority.PRIORITY_HIGH); } catch (_) {}

  try {
    app.configureHostResolver({ secureDnsMode: 'off', enableAdditionalDnsQueryTypes: false });
  } catch (err) {
    console.error('Failed to configure host resolver:', err);
  }

  await initResourceSwapper(settingsManager.get('swapper enabled') !== false);
  await applyProxySettings(settingsManager.settings); 
  createSplash();
  createWindow();

  boostProcessPriorities();

  if (app.isPackaged) {
    setTimeout(configureAndCheckUpdater, 3000);
  }

  ipcMain.handle('get-update-status', () => _availableUpdate || { available: false, version: '' });

  ipcMain.on('action-install-update', () => {
    try {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.downloadUpdate().catch(err => {
        console.error('Failed to download update:', err);
      });
    } catch (err) {
      console.error('Install update error:', err);
    }
  });

  ipcMain.on('action-open-incognito', (_, useCurrentSettings) => createIncognitoWindow(useCurrentSettings));

  ipcMain.handle('get-settings', e => isIncognito(e.sender) ? _incognitoSettings.get(e.sender.id) : settingsManager.settings);

  ipcMain.handle('update-setting', async (e, key, value) => {
    if (isIncognito(e.sender)) {
      const s = _incognitoSettings.get(e.sender.id);
      if (s) {
        s[key] = value;
        if (key === 'mask ip' && !value) {
          _incognitoProxyFailed.set(e.sender.id, false);
        }
        if (key === 'mask ip' || key.startsWith('proxy')) {
          const ses = _incognitoSessions.get(e.sender.id);
          if (ses) await applyProxyToSession(ses, s);
        }
      }
      return { success: true };
    }
    settingsManager.settings[key] = value;
    settingsManager.scheduleSave();
    if (key === 'mask ip' && !value) {
      _proxyConnectionFailed = false;
    }
    if (key === 'mask ip' || key.startsWith('proxy')) {
      await applyProxySettings(settingsManager.settings);
    }
    if (key === 'show rpc' || key === 'rpc match info') {
      drpc.init(settingsManager.settings);
    }
    return { success: true };
  });

  ipcMain.handle('update-settings-bulk', async (e, newSettings) => {
    const target = isIncognito(e.sender) ? _incognitoSettings.get(e.sender.id) : settingsManager.settings;
    if (target) {
      Object.keys(target).forEach(k => delete target[k]);
      Object.assign(target, newSettings);
      if (!isIncognito(e.sender)) {
        settingsManager.scheduleSave();
        await applyProxySettings(settingsManager.settings);
        drpc.init(settingsManager.settings);
      } else {
        const ses = _incognitoSessions.get(e.sender.id);
        if (ses) await applyProxyToSession(ses, target);
      }
    }
    return { success: true };
  });

  ipcMain.handle('action-apply-proxy', async (e, proxySettings) => {
    const isIncog = isIncognito(e.sender);
    const win = BrowserWindow.fromWebContents(e.sender);

    if (isIncog) {
      const s = _incognitoSettings.get(e.sender.id) || {};
      if (proxySettings) Object.assign(s, proxySettings);
      const config = getProxyConfig(s);
      const ses = _incognitoSessions.get(e.sender.id);

      if (!ses) return { success: false, error: 'Session not found' };

      await applyProxyToSession(ses, s);

      if (s['mask ip'] && !config) {
        _incognitoProxyFailed.set(e.sender.id, true);
        return { success: false, error: "Couldn't connect to proxy" };
      }

      _incognitoProxyFailed.set(e.sender.id, false);
      if (win && !win.isDestroyed()) {
        const curUrl = win.webContents.getURL() || '';
        if (curUrl.includes('blank.html')) {
          win.loadURL('https://kirka.io/');
        }
      }
      return { success: true, reloadNeeded: needsReloadForProxy(e.sender) };
    } else {
      if (proxySettings) {
        Object.assign(settingsManager.settings, proxySettings);
        settingsManager.scheduleSave();
      }
      const config = getProxyConfig(settingsManager.settings);
      if (settingsManager.settings['mask ip'] && !config) {
        await applyProxySettings(settingsManager.settings);
        _proxyConnectionFailed = true;
        return { success: false, error: "Couldn't connect to proxy" };
      }
      await applyProxySettings(settingsManager.settings);
      _proxyConnectionFailed = false;
      if (mainWindow && !mainWindow.isDestroyed()) {
        const curUrl = mainWindow.webContents.getURL() || '';
        if (curUrl.includes('blank.html')) {
          mainWindow.loadURL('https://kirka.io/');
        }
      }
      return { success: true, reloadNeeded: needsReloadForProxy(e.sender) };
    }
  });

  ipcMain.handle('get-proxy-status', e => {
    if (isIncognito(e.sender)) {
      return { failed: !!_incognitoProxyFailed.get(e.sender.id) };
    }
    return { failed: _proxyConnectionFailed };
  });

  ipcMain.handle('action-proxy-normal-network', async e => {
    const isIncog = isIncognito(e.sender);
    const win = BrowserWindow.fromWebContents(e.sender);
    if (isIncog) {
      _incognitoProxyFailed.set(e.sender.id, false);
      const s = _incognitoSettings.get(e.sender.id);
      if (s) s['mask ip'] = false;
      const ses = _incognitoSessions.get(e.sender.id);
      if (ses) await applyProxyToSession(ses, s || { 'mask ip': false });
      if (win && !win.isDestroyed()) {
        win.loadURL('https://kirka.io/');
      }
    } else {
      _proxyConnectionFailed = false;
      settingsManager.settings['mask ip'] = false;
      settingsManager.scheduleSave();
      await applyProxySettings(settingsManager.settings);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL('https://kirka.io/');
      }
    }
    return { success: true };
  });

  ipcMain.on('action-quit', e => {
    if (isIncognito(e.sender)) {
      const win = BrowserWindow.fromWebContents(e.sender);
      if (win && !win.isDestroyed()) {
        win.close();
      }
    } else {
      app.quit();
    }
  });

  const MAX_CACHE = 256;
  const resourceCache = new Map();
  ipcMain.handle('fetch-resource', async (e, url) => {
    if (resourceCache.has(url)) return resourceCache.get(url);
    if (!url.startsWith('http://') && !url.startsWith('https://')) return '';
    try {
      const res = await e.sender.session.fetch(url);
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

  ipcMain.on('action-quick-restart', () => {
    settingsManager.saveSync();
    app.relaunch();
    app.exit();
  });

  ipcMain.on('action-zoom', (e, dir) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
    const isIncog = isIncognito(e.sender);
    let level = win.webContents.getZoomLevel() || 0;
    if (dir === 'reset') level = 0;
    else if (dir === 'in') level += 1;
    else if (dir === 'out') level -= 1;
    win.webContents.setZoomLevel(level);
    if (isIncog) {
      const s = _incognitoSettings.get(e.sender.id);
      if (s) s['zoom level'] = level;
    } else {
      settingsManager.settings['zoom level'] = level;
      settingsManager.scheduleSave();
    }
  });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => {
  settingsManager.saveSync();
  drpc.destroy();
  proxyGate.closeAll();
});
app.on('activate', () => { if (!mainWindow) createWindow(); });

app.on('login', (event, webContents, details, authInfo, callback) => {
  if (authInfo.isProxy) {
    const isIncog = isIncognito(webContents);
    const config = getProxyConfigForLogin(webContents, authInfo);

    if (!config || !config.username) {
      console.warn('Proxy authentication requested but no credentials configured.');
      event.preventDefault();
      if (isIncog && webContents && webContents.id) {
        _incognitoProxyFailed.set(webContents.id, true);
      } else {
        _proxyConnectionFailed = true;
      }
      if (webContents && !webContents.isDestroyed()) {
        webContents.send('show-proxy-error-popup');
      }
      return;
    }

    if (details && details.firstAuthAttempt === false) {
      console.warn('Proxy authentication failed: invalid credentials rejected by server.');
      event.preventDefault();
      if (isIncog && webContents && webContents.id) {
        _incognitoProxyFailed.set(webContents.id, true);
      } else {
        _proxyConnectionFailed = true;
      }
      if (webContents && !webContents.isDestroyed()) {
        webContents.send('show-proxy-error-popup');
      }
      return;
    }

    event.preventDefault();
    callback(config.username, config.password || '');
  }
});
