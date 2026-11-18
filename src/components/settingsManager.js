const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const ALWAYS_SAFE_GPU_SWITCHES = [
    'ignore-gpu-blacklist',
    'ignore-gpu-blocklist',
    'force-high-performance-gpu',
    'enable-gpu-rasterization',
    'enable-zero-copy',
    ['enable-features', 'CanvasOopRasterization,UseSkiaRenderer,VaapiVideoDecodeLinuxGL'],
    ['enable-hardware-overlays', 'single-fullscreen,single-on-top,underlay'],
    ['num-raster-threads', require('os').cpus().length.toString()],
];

const UNCAP_FPS_SWITCHES = [
    'disable-frame-rate-limit',
    'disable-gpu-vsync',
];

class SettingsManager {
    constructor() {
        this.settingsPath = path.join(app.getPath('userData'), 'settings.json');
        this.defaultSettingsPath = path.join(__dirname, '..', 'assets', 'default.json');
        this.settings = {};
        this.defaults = {};
        this.saveTimeout = null;
    }
    scheduleSave() {
        if (this.saveTimeout) clearTimeout(this.saveTimeout);
        this.saveTimeout = setTimeout(() => {
            fs.promises.writeFile(this.settingsPath, JSON.stringify(this.settings, null, 2))
                .catch(err => console.error('Failed to save settings:', err));
        }, 150);
    }
    init() {
        try {
            this.defaults = JSON.parse(fs.readFileSync(this.defaultSettingsPath, 'utf8'));
        } catch (e) {
            console.error('Error reading default.json', e);
        }

        try {
            if (fs.existsSync(this.settingsPath)) {
                const saved = JSON.parse(fs.readFileSync(this.settingsPath, 'utf8'));
                this.settings = { ...this.defaults, ...saved };
                if (this.defaults.keybinds) {
                    this.settings.keybinds = { ...this.defaults.keybinds, ...(saved.keybinds || {}) };
                }
            } else {
                this.settings = { ...this.defaults };
                this.scheduleSave();
            }
        } catch (e) {
            console.error('Error loading settings', e);
            this.settings = { ...this.defaults };
            this.scheduleSave();
        }

        for (const sw of ALWAYS_SAFE_GPU_SWITCHES) {
            Array.isArray(sw) ? app.commandLine.appendSwitch(...sw) : app.commandLine.appendSwitch(sw);
        }

        if (process.platform === 'win32') {
            setImmediate(() => {
                exec(
                    `reg add "HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences" /v "${process.execPath}" /t REG_SZ /d "GpuPreference=2;" /f`,
                    err => { if (err) console.error('Failed to set high performance GPU preference:', err); }
                );
            });
        }

        const angleBackend = this.settings['angle backend'] || 'default';
        if (process.platform === 'win32') {
            app.commandLine.appendSwitch('use-gl', 'angle');
            app.commandLine.appendSwitch('use-angle', angleBackend !== 'default' ? angleBackend : 'd3d11');
        } else if (process.platform === 'linux') {
            if (angleBackend === 'vulkan' || angleBackend === 'opengl') {
                app.commandLine.appendSwitch('use-gl', 'angle');
                app.commandLine.appendSwitch('use-angle', angleBackend);
            }
        } else if (process.platform === 'darwin') {
            if (angleBackend === 'metal' || angleBackend === 'opengl') {
                app.commandLine.appendSwitch('use-gl', 'angle');
                app.commandLine.appendSwitch('use-angle', angleBackend);
            }
        }

        if (this.settings['unlimited fps']) {
            for (const sw of UNCAP_FPS_SWITCHES) {
                Array.isArray(sw) ? app.commandLine.appendSwitch(...sw) : app.commandLine.appendSwitch(sw);
            }
        }

        if (this.settings['mask ip'] || this.settings['incognito always mask ip']) {
            app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');
        }
    }
    get(key) { return this.settings[key]; }
}
module.exports = new SettingsManager();
