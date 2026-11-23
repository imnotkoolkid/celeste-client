const { contextBridge, ipcRenderer, webFrame } = require('electron');
const fs = require('fs');
const path = require('path');

try {
    const skinScript = fs.readFileSync(path.join(__dirname, 'assets', 'scripts', 'customSkin.js'), 'utf8');
    webFrame.executeJavaScript(skinScript);
} catch (e) {
    console.error('Failed to load customSkin.js:', e);
}

try {
    webFrame.executeJavaScript(`(() => {
        if (window.__celesteRawInputInitialized) return;
        window.__celesteRawInputInitialized = true;
        const origRequestPointerLock = Element.prototype.requestPointerLock;
        if (typeof origRequestPointerLock === 'function') {
            Element.prototype.requestPointerLock = function(options) {
                const opts = { unadjustedMovement: true, ...(typeof options === 'object' && options ? options : {}) };
                try {
                    const res = origRequestPointerLock.call(this, opts);
                    if (res && typeof res.catch === 'function') {
                        return res.catch(() => origRequestPointerLock.call(this, options));
                    }
                    return res;
                } catch (_) {
                    return origRequestPointerLock.call(this, options);
                }
            };
        }
    })();`);
} catch (e) {
    console.error('Failed to initialize raw mouse input:', e);
}

let currentSettings = {};
const assetCache = new Map();
let _fontBlobUrl = null;
let _menuOpen = false;
let _menuShadowRoot = null;

function getDeepActiveElement() {
    let el = document.activeElement;
    if (el && el.id === 'celeste-menu-host' && _menuShadowRoot) {
        return _menuShadowRoot.activeElement || el;
    }
    while (el && el.shadowRoot && el.shadowRoot.activeElement) {
        el = el.shadowRoot.activeElement;
    }
    return el;
}

function getAssetSync(assetPath, encoding) {
    const key = `${assetPath}_${encoding || 'utf8'}`;
    if (assetCache.has(key)) return assetCache.get(key);
    try {
        const data = fs.readFileSync(assetPath, encoding === 'base64' ? { encoding: 'base64' } : 'utf8');
        assetCache.set(key, data);
        return data;
    } catch {
        return null;
    }
}

function getFontBlobUrl() {
    if (!_fontBlobUrl) {
        try {
            const fontBytes = fs.readFileSync(path.join(__dirname, 'assets', 'font', 'forza.ttf'));
            _fontBlobUrl = URL.createObjectURL(new Blob([fontBytes], { type: 'font/ttf' }));
        } catch (e) {
            console.error('Failed to create font blob URL:', e);
        }
    }
    return _fontBlobUrl;
}

const _styleEls = {};
function setStyle(id, css, enabled = true) {
    let el = _styleEls[id] || document.getElementById(id);
    if (!enabled) {
        if (el) { el.remove(); delete _styleEls[id]; }
        return null;
    }
    if (!el) {
        el = document.createElement('style');
        el.id = id;
        document.head.appendChild(el);
        _styleEls[id] = el;
    }
    if (el.textContent !== css) el.textContent = css;
    return el;
}

function applyTheme(isCeleste) {
    setStyle('celeste-custom-css', '');
    const themeCss = isCeleste ? getAssetSync(path.join(__dirname, 'assets', 'css', 'celeste.css')) : '';
    setStyle('celeste-theme-css', themeCss, !!isCeleste);
}

function applyUIScaleAndOpacity(opacity = 100, scale = 100) {
    let css = '';
    if (opacity !== 100) css += `opacity: ${opacity}% !important; `;
    if (scale !== 100) css += `transform: scale(${scale / 100}) !important; `;
    setStyle('celeste-ui-scale-opacity', css ? `.team-score, .desktop-game-interface { ${css} }` : '', true);
}

function applyGameChat(chatMode) {
    const css = chatMode === 'simplified'
        ? `#bottom-left .chat .input-wrapper input { opacity: 0 !important; margin: 0 !important; }
           #bottom-left .chat .input-wrapper input:focus { opacity: 1 !important; }
           #bottom-left .chat .messages.messages-cont { background-color: #fff0 !important; overflow: hidden !important; word-break: break-word !important; }
           .desktop-game-interface .chat>.info, .desktop-game-interface .chat .info-key-cont.enter { display: none !important; }`
        : chatMode === 'hidden'
            ? `#bottom-left .chat .input-wrapper input, #bottom-left .chat .messages.messages-cont, .desktop-game-interface .chat>.info, .desktop-game-interface .chat .info-key-cont.enter { display: none !important; }`
            : '';
    setStyle('celeste-game-chat', css, true);
}

function applyGameCustomizations(hitmarker, killicon) {
    let css = '';
    window._customHitmarkerLink = hitmarker?.trim() || null;
    if (window._customHitmarkerLink) css += `.hitmark { content: url("${window._customHitmarkerLink}") !important; }\n`;
    if (window._hitmarkObserver) { window._hitmarkObserver.disconnect(); window._hitmarkObserver = null; }
    if (killicon?.trim()) {
        css += `.animate-cont::before { content: ""; background: url("${killicon.trim()}") center / contain no-repeat; width: 10rem; height: 10rem; margin-bottom: 2rem; display: inline-block; }\n.animate-cont svg { display: none !important; }\n`;
    }
    setStyle('celeste-game-customizations', css, true);
}

function applyUIAnimations(enabled) {
    setStyle('celeste-ui-animations', '* { transition: none !important; animation: none !important; }', !enabled);
}

function applyTabInfo(enabled) {
    const tabCss = enabled ? getAssetSync(path.join(__dirname, 'assets', 'css', 'tablist-shown.css')) : '';
    setStyle('celeste-tab-info-css', tabCss, !!enabled);
}

function applySkipLoadingScreen(enabled) {
    setStyle('celeste-skip-loading-css', '.loading-scene { display: none !important; }', !!enabled);
}

function applyCustomSkin(s) {
    if (!s) return;
    window.dispatchEvent(new CustomEvent('celeste-update-skin-config', {
        detail: {
            enabled: !!s['custom skin enabled'],
            ingameOnly: s['custom skin ingame only'] !== false,
            mode: s['custom skin mode'] || 'color',
            head: s['custom skin head'] || '#ff00ff',
            body: s['custom skin body'] || '#00ff00',
            url: s['custom skin url'] || ''
        }
    }));
}

function buildCombo(e) {
    const parts = [];
    if (e.ctrlKey && !['ControlLeft', 'ControlRight'].includes(e.code)) parts.push('Ctrl');
    if (e.shiftKey && !['ShiftLeft', 'ShiftRight'].includes(e.code)) parts.push('Shift');
    if (e.altKey && !['AltLeft', 'AltRight'].includes(e.code)) parts.push('Alt');
    parts.push(e.code);
    return parts.join('+');
}

const _activeCustomStyles = {};
function applyCustomStyles(styles) {
    const activeKeys = new Set();
    if (Array.isArray(styles)) {
        for (let i = 0; i < styles.length; i++) {
            const style = styles[i];
            if (!style.enabled) continue;
            const styleKey = `custom-style-${i}-${style.name || 'unnamed'}`;
            activeKeys.add(styleKey);
            let el = _activeCustomStyles[styleKey];
            if (!el) {
                el = document.createElement('style');
                el.id = styleKey;
                document.head.appendChild(el);
                _activeCustomStyles[styleKey] = el;
                if (style.mode === 'code') {
                    el.textContent = style.content;
                } else if (style.mode === 'url' && style.content) {
                    ipcRenderer.invoke('fetch-resource', style.content).then(cssCode => {
                        if (cssCode && _activeCustomStyles[styleKey]) el.textContent = cssCode;
                    }).catch(console.error);
                }
            } else if (style.mode === 'code' && el.textContent !== style.content) {
                el.textContent = style.content;
            }
        }
    }
    for (const key in _activeCustomStyles) {
        if (!activeKeys.has(key)) {
            _activeCustomStyles[key].remove();
            delete _activeCustomStyles[key];
        }
    }
}

if (!window._celesteInjectedScripts) window._celesteInjectedScripts = new Set();
function applyCustomScripts(scripts) {
    if (!Array.isArray(scripts)) return;
    for (const script of scripts) {
        if (!script.enabled) continue;
        const scriptKey = `${script.mode}:${script.content}`;
        if (window._celesteInjectedScripts.has(scriptKey)) continue;
        window._celesteInjectedScripts.add(scriptKey);
        if (script.mode === 'code') {
            const el = document.createElement('script');
            el.textContent = script.content;
            document.head.appendChild(el);
        } else if (script.mode === 'url' && script.content) {
            ipcRenderer.invoke('fetch-resource', script.content).then(jsCode => {
                if (jsCode) {
                    const el = document.createElement('script');
                    el.textContent = jsCode;
                    document.head.appendChild(el);
                }
            }).catch(console.error);
        }
    }
}

let _keystrokeHost = null;
let _keystrokeKeyMap = null;
function _buildKeyMap(shadow) {
    _keystrokeKeyMap = new Map();
    shadow.querySelectorAll('.nlc-key-default[data-code]').forEach(el => {
        _keystrokeKeyMap.set(el.getAttribute('data-code'), el);
    });
}

function applyKeystrokeOverlay(enabled, editMode, xOffset, yOffset, scale, removedKeys) {
    if (!enabled) {
        _keystrokeHost?.remove();
        _keystrokeHost = null;
        _keystrokeKeyMap = null;
        return;
    }
    if (!_keystrokeHost) {
        const overlayHtml = getAssetSync(path.join(__dirname, 'assets', 'html', 'keystrokeOverlay.html'));
        if (!overlayHtml) return;
        const fontUrl = getFontBlobUrl();

        _keystrokeHost = Object.assign(document.createElement('div'), { id: 'celeste-keystroke-host' });
        _keystrokeHost.style.cssText = 'position:fixed;z-index:99998;pointer-events:none;top:0;left:0;';
        const shadow = _keystrokeHost.attachShadow({ mode: 'open' });
        const fontFaceCSS = fontUrl ? `@font-face { font-family: 'forza'; src: url('${fontUrl}') format('truetype'); }` : '';
        const baseStyle = document.createElement('style');
        baseStyle.textContent = `${fontFaceCSS}
            :host { all: initial; }
            * { box-sizing: border-box; font-family: 'forza', sans-serif !important; }
            #nlc-overlay-wrapper { position: fixed; top: 0; left: 0; pointer-events: none; }
            #nlc-overlay-wrapper.edit-mode { pointer-events: all; cursor: default; }
            .nlc-key-default.nlc-key-active { color: black !important; background: white !important; border-color: white !important; }`;
        shadow.appendChild(baseStyle);

        const wrapper = document.createElement('div');
        wrapper.id = 'nlc-overlay-wrapper';
        wrapper.innerHTML = overlayHtml;
        shadow.appendChild(wrapper);
        _buildKeyMap(shadow);

        wrapper.querySelector('#keys-overlay')?.addEventListener('click', e => {
            const wrap = shadow.getElementById('nlc-overlay-wrapper');
            if (!wrap?.classList.contains('edit-mode')) return;
            const keyEl = e.target.closest('.nlc-key-default[data-code]');
            if (!keyEl) return;
            const code = keyEl.getAttribute('data-code');
            let rKeys = currentSettings['keystroke overlay removed keys'] || [];
            if (rKeys.includes(code)) {
                rKeys = rKeys.filter(k => k !== code);
                keyEl.classList.remove('nlc-key-disabled');
            } else {
                rKeys.push(code);
                keyEl.classList.add('nlc-key-disabled');
            }
            currentSettings['keystroke overlay removed keys'] = rKeys;
            ipcRenderer.invoke('update-setting', 'keystroke overlay removed keys', rKeys);
            reapplyKeystroke();
        });
        document.body.appendChild(_keystrokeHost);
    }

    const shadow = _keystrokeHost.shadowRoot;
    const wrapper = shadow.getElementById('nlc-overlay-wrapper');
    const keysOverlay = shadow.getElementById('keys-overlay');
    if (!wrapper || !keysOverlay) return;

    wrapper.style.top = `${Number(yOffset) || 0}px`;
    wrapper.style.left = `${Number(xOffset) || 0}px`;
    const scaleVal = (Number(scale) || 100) / 100;
    keysOverlay.style.transform = scaleVal !== 1 ? `scale(${scaleVal})` : '';
    keysOverlay.style.transformOrigin = 'top left';

    const rKeys = removedKeys || [];
    if (_keystrokeKeyMap) {
        _keystrokeKeyMap.forEach((el, code) => el.classList.toggle('nlc-key-disabled', rKeys.includes(code)));
    } else {
        keysOverlay.querySelectorAll('.nlc-key-default[data-code]').forEach(el => {
            el.classList.toggle('nlc-key-disabled', rKeys.includes(el.getAttribute('data-code')));
        });
    }
    keysOverlay.classList.toggle('edit', !!editMode);
    wrapper.classList.toggle('edit-mode', !!editMode);
}

function highlightKeystrokeKey(code, active) {
    _keystrokeKeyMap?.get(code)?.classList.toggle('nlc-key-active', active);
}

const KEYSTROKE_KEYS = new Set([
    'keystroke overlay', 'keystroke overlay edit mode',
    'keystroke overlay x', 'keystroke overlay y', 'keystroke overlay scale', 'keystroke overlay removed keys'
]);

function reapplyKeystroke() {
    applyKeystrokeOverlay(
        currentSettings['keystroke overlay'],
        currentSettings['keystroke overlay edit mode'],
        currentSettings['keystroke overlay x'],
        currentSettings['keystroke overlay y'],
        currentSettings['keystroke overlay scale'],
        currentSettings['keystroke overlay removed keys']
    );
}

function applyAllSettings(s) {
    applyTheme(s['celeste theme']);
    applyCustomStyles(s['custom css list']);
    applyUIScaleAndOpacity(s['in-game ui opacity'], s['in-game ui scale']);
    applyGameChat(s['game chat']);
    applyGameCustomizations(s['custom hitmarker'], s['custom kill icon']);
    applyUIAnimations(s['ui animations']);
    applyTabInfo(s['show tab info']);
    applySkipLoadingScreen(s['skip loading screen']);
    applyCustomSkin(s);
    applyKeystrokeOverlay(
        s['keystroke overlay'], s['keystroke overlay edit mode'],
        s['keystroke overlay x'], s['keystroke overlay y'],
        s['keystroke overlay scale'],
        s['keystroke overlay removed keys']
    );
}

const api = {
    getSettings: async () => {
        currentSettings = await ipcRenderer.invoke('get-settings');
        return currentSettings;
    },
    getDefaults: () => {
        try {
            return JSON.parse(getAssetSync(path.join(__dirname, 'assets', 'default.json')));
        } catch (e) {
            console.error('Failed to read default.json', e);
            return {};
        }
    },
    updateSetting: (key, value) => {
        currentSettings[key] = value;
        if (key === 'celeste theme') applyTheme(value);
        else if (key === 'custom css list') applyCustomStyles(value);
        else if (key === 'in-game ui opacity' || key === 'in-game ui scale')
            applyUIScaleAndOpacity(currentSettings['in-game ui opacity'], currentSettings['in-game ui scale']);
        else if (key === 'game chat') applyGameChat(value);
        else if (key === 'custom hitmarker' || key === 'custom kill icon')
            applyGameCustomizations(currentSettings['custom hitmarker'], currentSettings['custom kill icon']);
        else if (key === 'ui animations') applyUIAnimations(value);
        else if (key === 'show tab info') applyTabInfo(value);
        else if (key === 'skip loading screen') applySkipLoadingScreen(value);
        else if (KEYSTROKE_KEYS.has(key)) reapplyKeystroke();
        else if (key.startsWith('custom skin')) applyCustomSkin(currentSettings);
        return ipcRenderer.invoke('update-setting', key, value);
    },
    updateSettingsBulk: async (newSettings) => {
        currentSettings = { ...newSettings };
        applyAllSettings(currentSettings);
        return ipcRenderer.invoke('update-settings-bulk', newSettings);
    },
    actionFullscreen: () => ipcRenderer.send('action-fullscreen'),
    actionDevtools: () => ipcRenderer.send('action-devtools'),
    actionQuickRestart: () => ipcRenderer.send('action-quick-restart'),
    actionZoom: dir => ipcRenderer.send('action-zoom', dir),
    actionOpenSwapperFolder: () => ipcRenderer.send('action-open-swapper-folder'),
    actionOpenIncognito: (useCurrentSettings = false) => ipcRenderer.send('action-open-incognito', useCurrentSettings),
    actionApplyProxy: proxySettings => ipcRenderer.invoke('action-apply-proxy', proxySettings),
    actionProxyNormalNetwork: () => ipcRenderer.invoke('action-proxy-normal-network'),
    actionQuit: () => ipcRenderer.send('action-quit'),
    getProxyStatus: () => ipcRenderer.invoke('get-proxy-status'),
    onShowProxyErrorPopup: cb => ipcRenderer.on('show-proxy-error-popup', (_, msg) => cb(msg)),
    onShowToast: cb => ipcRenderer.on('show-toast', (_, opts) => cb(opts)),
    buildCombo: (ctrlKey, shiftKey, altKey, code) => buildCombo({ ctrlKey, shiftKey, altKey, code }),
    platform: process.platform,
    getUpdateStatus: () => ipcRenderer.invoke('get-update-status'),
    installUpdate: () => ipcRenderer.send('action-install-update'),
    onUpdateStatusChanged: cb => ipcRenderer.on('update-status-changed', (_, info) => cb(info)),
    onUpdateDownloadProgress: cb => ipcRenderer.on('update-download-progress', (_, percent) => cb(percent)),
    onUpdateDownloaded: cb => ipcRenderer.on('update-downloaded', () => cb())
};

window.api = api;

try {
    contextBridge.exposeInMainWorld('api', {
        getSettings: async () => {
            const s = await ipcRenderer.invoke('get-settings');
            const safe = { ...s };
            delete safe['proxy password'];
            delete safe['proxy url'];
            return safe;
        },
        buildCombo: (ctrlKey, shiftKey, altKey, code) => buildCombo({ ctrlKey, shiftKey, altKey, code }),
        platform: process.platform,
        getUpdateStatus: () => ipcRenderer.invoke('get-update-status')
    });
} catch (_) {}

function loadCelesteMenu() {
    const fontUrl = getFontBlobUrl();
    Promise.all([
        fs.promises.readFile(path.join(__dirname, 'styles', 'menu.css'), 'utf8').catch(() => null),
        fs.promises.readFile(path.join(__dirname, 'menu.html'), 'utf8').catch(() => null),
        fs.promises.readFile(path.join(__dirname, 'components', 'menu.js'), 'utf8').catch(() => null),
    ]).then(([cssContentRaw, htmlContent, jsContent]) => {
        if (!htmlContent) return;

        let styleEl = null;
        if (cssContentRaw) {
            let cssContent = cssContentRaw;
            if (fontUrl) {
                cssContent = cssContent.replace('../assets/font/forza.ttf', fontUrl);
                if (!document.getElementById('celeste-global-font')) {
                    const globalFontEl = document.createElement('style');
                    globalFontEl.id = 'celeste-global-font';
                    globalFontEl.textContent = `@font-face { font-family: 'forza'; src: url('${fontUrl}') format('truetype'); }`;
                    document.head.appendChild(globalFontEl);
                }
            }
            styleEl = document.createElement('style');
            styleEl.textContent = cssContent;
        }

        const host = document.createElement('div');
        host.id = 'celeste-menu-host';
        host.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;overflow:visible;z-index:99999;';
        const shadowRoot = host.attachShadow({ mode: 'closed' });
        _menuShadowRoot = shadowRoot;
        if (styleEl) shadowRoot.appendChild(styleEl);
        const wrapper = document.createElement('div');
        wrapper.innerHTML = htmlContent;
        shadowRoot.appendChild(wrapper);
        document.body.appendChild(host);

        if (jsContent) {
            try {
                (new Function('root', 'api', jsContent))(_menuShadowRoot, api);
            } catch (err) {
                console.error('Failed to execute Celeste menu script:', err);
            }
        }
    }).catch(err => console.error('Failed to load Celeste menu:', err));
}

window.addEventListener('DOMContentLoaded', async () => {
    try {
        currentSettings = await ipcRenderer.invoke('get-settings');
        applyAllSettings(currentSettings);
        applyCustomScripts(currentSettings['custom scripts']);
        ipcRenderer.send('loading-done');
        loadCelesteMenu();
    } catch (e) {
        console.error('Failed to initialize settings:', e);
        ipcRenderer.send('loading-done');
    }

    let _menuOverlay = null;
    const getMenuOverlay = () => {
        if (!_menuOverlay && _menuShadowRoot) {
            _menuOverlay = _menuShadowRoot.getElementById('celeste-menu-overlay');
        }
        return _menuOverlay;
    };

    document.addEventListener('keydown', e => {
        highlightKeystrokeKey(e.code, true);
        if (e.repeat) return;
        const ae = getDeepActiveElement();
        const isInput = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
        if (isInput) {
            const combo = buildCombo(e);
            const kb = currentSettings.keybinds || {};
            if (combo === kb['toggle menu']) {
                const menu = getMenuOverlay();
                if (menu) {
                    const opening = menu.style.display === 'none';
                    menu.style.display = opening ? 'flex' : 'none';
                    _menuOpen = opening;
                }
            }
            return;
        }

        const combo = buildCombo(e);
        const kb = currentSettings.keybinds || {};

        const actions = {
            [kb['toggle menu']]: () => {
                const menu = getMenuOverlay();
                if (menu) {
                    const opening = menu.style.display === 'none';
                    menu.style.display = opening ? 'flex' : 'none';
                    _menuOpen = opening;
                }
            },
            [kb['copy url']]: () => navigator.clipboard.writeText(window.location.href),
            [kb['return main page']]: () => { window.location.href = 'https://kirka.io'; },
            [kb['reload']]: () => location.reload(),
            [kb['fullscreen']]: () => ipcRenderer.send('action-fullscreen'),
            [kb['devtools']]: () => ipcRenderer.send('action-devtools'),
            [kb['quick restart']]: () => ipcRenderer.send('action-quick-restart'),
            [kb['open incognito'] || 'Ctrl+Shift+KeyN']: () => ipcRenderer.send('action-open-incognito', !!currentSettings['incognito use current settings']),
            [kb['zoom in']]: () => ipcRenderer.send('action-zoom', 'in'),
            [kb['zoom out']]: () => ipcRenderer.send('action-zoom', 'out'),
            [kb['zoom reset']]: () => ipcRenderer.send('action-zoom', 'reset'),
        };

        actions[combo]?.();
    });

    document.addEventListener('keyup', e => highlightKeystrokeKey(e.code, false));

    window.addEventListener('blur', () => {
        if (_keystrokeKeyMap) {
            _keystrokeKeyMap.forEach(el => el.classList.remove('nlc-key-active'));
        }
    });
});
