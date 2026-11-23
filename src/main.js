const { app, protocol } = require('electron');
const os = require('os');
const settingsManager = require('./components/settingsManager');
const proxyManager = require('./components/proxyManager');
const windowManager = require('./components/windowManager');
const { registerIpcHandlers } = require('./components/ipcHandlers');
const drpc = require('./components/drpc');
const { initResourceSwapper } = require('./components/swapper');

app.setName('Celeste Client');
app.setAppUserModelId('dev.imnotkoolkid.celesteclient');

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

let _updateDownloaded = false;
let _availableUpdate = null;

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
      const mainWindow = windowManager.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-status-changed', _availableUpdate);
      }
    });

    autoUpdater.on('download-progress', progress => {
      const mainWindow = windowManager.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-download-progress', Math.round(progress?.percent || 0));
      }
    });

    autoUpdater.on('update-downloaded', () => {
      _updateDownloaded = true;
      const mainWindow = windowManager.getMainWindow();
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

function installUpdate() {
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.downloadUpdate().catch(err => {
      console.error('Failed to download update:', err);
    });
  } catch (err) {
    console.error('Install update error:', err);
  }
}

app.on('web-contents-created', (_, wc) => {
  proxyManager.trackWebContents(wc);
  setTimeout(boostProcessPriorities, 500);
});

app.on('gpu-process-crashed', (_event, _killed) => {
  setTimeout(boostProcessPriorities, 1000);
});

app.whenReady().then(async () => {
  try { os.setPriority(os.constants.priority.PRIORITY_HIGH); } catch (_) {}

  try {
    app.configureHostResolver({ secureDnsMode: 'off', enableAdditionalDnsQueryTypes: false });
  } catch (err) {
    console.error('Failed to configure host resolver:', err);
  }

  await initResourceSwapper(settingsManager.get('swapper enabled') !== false);
  await proxyManager.applyProxySettings(settingsManager.settings);
  windowManager.createSplash();
  const mainWin = windowManager.createWindow();


  boostProcessPriorities();
  mainWin.webContents.once('did-finish-load', boostProcessPriorities);

  if (app.isPackaged) {
    setTimeout(configureAndCheckUpdater, 3000);
  }

  registerIpcHandlers({
    getUpdateStatus: () => _availableUpdate || { available: false, version: '' },
    installUpdate
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  settingsManager.saveSync();
  drpc.destroy();
  proxyManager.closeAll();
});

app.on('activate', () => {
  if (!windowManager.getMainWindow()) windowManager.createWindow();
});

app.on('login', (event, webContents, details, authInfo, callback) => {
  if (authInfo.isProxy) {
    const isIncog = windowManager.isIncognito(webContents);
    const curSettings = windowManager.getSettingsForWebContents(webContents);
    const allSettings = [settingsManager.settings, ...windowManager.getAllIncognitoSettings()];
    proxyManager.handleProxyLogin(event, webContents, details, authInfo, callback, isIncog, curSettings, allSettings);
  }
});
