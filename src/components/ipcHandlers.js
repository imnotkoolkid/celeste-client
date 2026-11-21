const { ipcMain, app, BrowserWindow, shell } = require('electron');
const fs = require('fs');
const settingsManager = require('./settingsManager');
const proxyManager = require('./proxyManager');
const windowManager = require('./windowManager');
const drpc = require('./drpc');
const { getSwapperFolder } = require('./swapper');

function registerIpcHandlers(updaterOpts = {}) {
  const { getUpdateStatus = () => ({ available: false, version: '' }), installUpdate = () => {} } = updaterOpts;

  ipcMain.handle('get-update-status', () => getUpdateStatus());

  ipcMain.on('action-install-update', () => {
    installUpdate();
  });

  ipcMain.on('action-open-incognito', (_, useCurrentSettings) => {
    windowManager.createIncognitoWindow(useCurrentSettings);
  });

  ipcMain.handle('get-settings', e => {
    return windowManager.getSettingsForWebContents(e.sender);
  });

  ipcMain.handle('update-setting', async (e, key, value) => {
    if (windowManager.isIncognito(e.sender)) {
      const s = windowManager.getIncognitoSettings(e.sender.id);
      if (s) {
        s[key] = value;
        if (key === 'mask ip' && !value) {
          proxyManager.setProxyFailed(true, e.sender.id, false);
        }
        if (key === 'mask ip' || key.startsWith('proxy')) {
          const ses = windowManager.getIncognitoSession(e.sender.id);
          if (ses) await proxyManager.applyProxyToSession(ses, s);
        }
      }
      return { success: true };
    }

    settingsManager.settings[key] = value;
    settingsManager.scheduleSave();
    if (key === 'mask ip' && !value) {
      proxyManager.setProxyFailed(false, null, false);
    }
    if (key === 'mask ip' || key.startsWith('proxy')) {
      await proxyManager.applyProxySettings(settingsManager.settings);
    }
    if (key === 'show rpc' || key === 'rpc match info') {
      drpc.init(settingsManager.settings);
    }
    return { success: true };
  });

  ipcMain.handle('update-settings-bulk', async (e, newSettings) => {
    const isIncog = windowManager.isIncognito(e.sender);
    const target = isIncog ? windowManager.getIncognitoSettings(e.sender.id) : settingsManager.settings;
    if (target) {
      Object.keys(target).forEach(k => delete target[k]);
      Object.assign(target, newSettings);
      if (!isIncog) {
        settingsManager.scheduleSave();
        await proxyManager.applyProxySettings(settingsManager.settings);
        drpc.init(settingsManager.settings);
      } else {
        const ses = windowManager.getIncognitoSession(e.sender.id);
        if (ses) await proxyManager.applyProxyToSession(ses, target);
      }
    }
    return { success: true };
  });

  ipcMain.handle('action-apply-proxy', async (e, proxySettings) => {
    const isIncog = windowManager.isIncognito(e.sender);
    const win = BrowserWindow.fromWebContents(e.sender);

    if (isIncog) {
      const s = windowManager.getIncognitoSettings(e.sender.id) || {};
      if (proxySettings) Object.assign(s, proxySettings);
      const config = proxyManager.getProxyConfig(s);
      const ses = windowManager.getIncognitoSession(e.sender.id);

      if (!ses) return { success: false, error: 'Session not found' };

      await proxyManager.applyProxyToSession(ses, s);

      if (s['mask ip'] && !config) {
        proxyManager.setProxyFailed(true, e.sender.id, true);
        return { success: false, error: "Couldn't connect to proxy" };
      }

      proxyManager.setProxyFailed(true, e.sender.id, false);
      if (win && !win.isDestroyed()) {
        const curUrl = win.webContents.getURL() || '';
        if (curUrl.includes('blank.html')) {
          win.loadURL('https://kirka.io/');
        }
      }
      return { success: true, reloadNeeded: proxyManager.needsReloadForProxy(e.sender) };
    } else {
      if (proxySettings) {
        Object.assign(settingsManager.settings, proxySettings);
        settingsManager.scheduleSave();
      }
      const config = proxyManager.getProxyConfig(settingsManager.settings);
      if (settingsManager.settings['mask ip'] && !config) {
        await proxyManager.applyProxySettings(settingsManager.settings);
        proxyManager.setProxyFailed(false, null, true);
        return { success: false, error: "Couldn't connect to proxy" };
      }
      await proxyManager.applyProxySettings(settingsManager.settings);
      proxyManager.setProxyFailed(false, null, false);
      const mainWindow = windowManager.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        const curUrl = mainWindow.webContents.getURL() || '';
        if (curUrl.includes('blank.html')) {
          mainWindow.loadURL('https://kirka.io/');
        }
      }
      return { success: true, reloadNeeded: proxyManager.needsReloadForProxy(e.sender) };
    }
  });

  ipcMain.handle('get-proxy-status', e => {
    return proxyManager.getProxyStatus(windowManager.isIncognito(e.sender), e.sender.id);
  });

  ipcMain.handle('action-proxy-normal-network', async e => {
    const isIncog = windowManager.isIncognito(e.sender);
    const win = BrowserWindow.fromWebContents(e.sender);
    if (isIncog) {
      proxyManager.setProxyFailed(true, e.sender.id, false);
      const s = windowManager.getIncognitoSettings(e.sender.id);
      if (s) s['mask ip'] = false;
      const ses = windowManager.getIncognitoSession(e.sender.id);
      if (ses) await proxyManager.applyProxyToSession(ses, s || { 'mask ip': false });
      if (win && !win.isDestroyed()) {
        win.loadURL('https://kirka.io/');
      }
    } else {
      proxyManager.setProxyFailed(false, null, false);
      settingsManager.settings['mask ip'] = false;
      settingsManager.scheduleSave();
      await proxyManager.applyProxySettings(settingsManager.settings);
      const mainWindow = windowManager.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL('https://kirka.io/');
      }
    }
    return { success: true };
  });

  ipcMain.on('action-quit', e => {
    if (windowManager.isIncognito(e.sender)) {
      const win = BrowserWindow.fromWebContents(e.sender);
      if (win && !win.isDestroyed()) win.close();
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
    windowManager.toggleFullscreen(e.sender);
  });

  ipcMain.on('action-devtools', e => {
    windowManager.toggleDevTools(e.sender);
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
    windowManager.handleZoom(e.sender, dir);
  });
}

module.exports = {
  registerIpcHandlers
};
