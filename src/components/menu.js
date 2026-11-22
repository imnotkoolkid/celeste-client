const tabs = root.querySelectorAll('.menu-tabs .tab');
const panes = root.querySelectorAll('.tab-pane');
const tabByPane = new Map();
const paneMap = new Map();

tabs.forEach(t => tabByPane.set(t.dataset.target, t));
panes.forEach(p => paneMap.set(p.id, p));

let _activeTab = root.querySelector('.menu-tabs .tab.active');
let _activePane = root.querySelector('.tab-pane.active');

const switchTab = id => {
    const tab = tabByPane.get(id);
    const pane = paneMap.get(id);
    if (!tab || !pane || _activeTab === tab) return;
    _activeTab?.classList.remove('active');
    _activePane?.classList.remove('active');
    tab.classList.add('active');
    pane.classList.add('active');
    _activeTab = tab;
    _activePane = pane;
};

tabs.forEach(tab => tab.addEventListener('click', () => switchTab(tab.dataset.target)));

if (!window.api) return;

window.api.getSettings().then(settings => {
    const $ = id => root.getElementById(id);

    function showToast({ title, message, actions = [], duration = 2500, type = 'info' }) {
        const container = $('celeste-toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `celeste-toast ${type}`;

        const actionsHtml = actions.length
            ? `<div class="celeste-toast-actions">` +
              actions.map((act, i) => `<button class="toast-action-btn ${act.primary ? 'active' : ''}" data-idx="${i}">${act.label}</button>`).join('') +
              `</div>`
            : '';

        toast.innerHTML = `
            <div class="celeste-toast-header">
                <span class="celeste-toast-title">${title || ''}</span>
            </div>
            ${message ? `<div class="celeste-toast-message">${message}</div>` : ''}
            ${actionsHtml}
        `;

        container.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('slide-in'));

        let dismissTimer = null;
        const dismiss = () => {
            clearTimeout(dismissTimer);
            toast.classList.remove('slide-in');
            toast.classList.add('slide-out');
            setTimeout(() => toast.remove(), 350);
        };

        if (actions.length) {
            toast.querySelectorAll('.toast-action-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const act = actions[parseInt(btn.dataset.idx, 10)];
                    act?.onClick?.();
                    dismiss();
                });
            });
        }

        if (duration > 0) dismissTimer = setTimeout(dismiss, duration);
        return { dismiss };
    }

    window.celesteToast = showToast;
    window.api.onShowToast?.(opts => showToast(opts));

    let _activeProxyErrorToast = null;
    const showProxyErrorPopup = (msg) => {
        if (_activeProxyErrorToast) return;
        _activeProxyErrorToast = showToast({
            title: "Couldn't connect to proxy",
            message: msg || "Begin with normal network?",
            type: 'error',
            duration: null,
            actions: [
                {
                    label: 'YES',
                    primary: true,
                    onClick: () => {
                        _activeProxyErrorToast = null;
                        const maskToggle = $('toggle-mask-ip');
                        if (maskToggle) maskToggle.checked = false;
                        settings['mask ip'] = false;
                        window.api.updateSetting?.('mask ip', false);
                        updateProxyVisibility();
                        window.api.actionProxyNormalNetwork?.();
                    }
                },
                {
                    label: 'EXIT',
                    onClick: () => {
                        _activeProxyErrorToast = null;
                        window.api.actionQuit?.();
                    }
                },
                {
                    label: 'TRY DIFF PROXY',
                    onClick: () => {
                        _activeProxyErrorToast = null;
                        const overlay = $('celeste-menu-overlay');
                        if (overlay) overlay.style.display = 'flex';
                        switchTab('tab-client');
                        $('cat-proxy')?.scrollIntoView({ behavior: 'smooth' });
                        const isUrlMode = $('proxy-mode-group')?.querySelector('.active')?.dataset.val === 'url';
                        (isUrlMode ? $('input-proxy-url') : $('input-proxy-host'))?.focus();
                    }
                }
            ]
        });
    };

    let _activeProxyReloadToast = null;
    const updateProxyReloadToast = (needed) => {
        if (!needed) {
            _activeProxyReloadToast?.dismiss();
            _activeProxyReloadToast = null;
            return;
        }
        if (_activeProxyReloadToast) return;
        _activeProxyReloadToast = showToast({
            title: 'Proxy changed',
            message: 'Your current game connection is still on the old route. Reload to switch it.',
            duration: null,
            actions: [
                {
                    label: 'RELOAD NOW',
                    primary: true,
                    onClick: () => {
                        _activeProxyReloadToast = null;
                        location.reload();
                    }
                },
                {
                    label: 'LATER',
                    onClick: () => {
                        _activeProxyReloadToast = null;
                    }
                }
            ]
        });
    };

    window.api.onShowProxyErrorPopup?.((msg) => showProxyErrorPopup(msg));
    window.api.getProxyStatus?.().then(st => { if (st?.failed) showProxyErrorPopup(); });

    const updateProxyVisibility = () => {
        const isMaskOn = !!$('toggle-mask-ip')?.checked;
        const display = isMaskOn ? 'flex' : 'none';
        root.querySelectorAll('.proxy-row').forEach(r => r.style.display = display);
        if (isMaskOn) {
            const mode = $('proxy-mode-group')?.querySelector('.active')?.dataset.val || 'manual';
            const manualContainer = $('proxy-manual-container');
            const urlContainer = $('proxy-url-container');
            if (manualContainer) manualContainer.style.display = mode === 'manual' ? 'block' : 'none';
            if (urlContainer) urlContainer.style.display = mode === 'url' ? 'block' : 'none';
        }
    };

    const updateSliderBg = el => {
        const pct = ((el.value - (el.min || 0)) / ((el.max || 100) - (el.min || 0))) * 100;
        el.style.background = `linear-gradient(to right, var(--accent) ${pct}%, var(--bg1) ${pct}%)`;
    };

    const showContainers = (val, urlId, codeId) => {
        const u = $(urlId), c = $(codeId);
        if (u) u.style.display = val === 'url' ? 'flex' : 'none';
        if (c) c.style.display = val === 'code' ? 'flex' : 'none';
    };

    const updateUI = s => {
        const togglePairs = [
            ['toggle-unlimited-fps', 'unlimited fps'],
            ['toggle-start-fullscreen', 'start fullscreen'],
            ['toggle-celeste-theme', 'celeste theme'],
            ['toggle-show-rpc', 'show rpc'],
            ['toggle-rpc-match-info', 'rpc match info'],
            ['toggle-ui-animations', 'ui animations'],
            ['toggle-keystroke-overlay', 'keystroke overlay'],
            ['toggle-keystroke-edit', 'keystroke overlay edit mode'],
            ['toggle-show-tab-info', 'show tab info'],
            ['toggle-skip-loading-screen', 'skip loading screen'],
            ['toggle-swapper-enabled', 'swapper enabled'],
            ['toggle-custom-skin-enabled', 'custom skin enabled'],
            ['toggle-custom-skin-ingame-only', 'custom skin ingame only'],
            ['toggle-incognito-current-settings', 'incognito use current settings'],
            ['toggle-incognito-always-mask-ip', 'incognito always mask ip'],
            ['toggle-mask-ip', 'mask ip'],
        ];
        for (const [id, key] of togglePairs) {
            const el = $(id);
            if (el) el.checked = !!(key === 'rpc match info' || key === 'ui animations' || key === 'custom skin ingame only' ? s[key] !== false : s[key]);
        }

        for (const [id, key] of [
            ['input-hitmarker', 'custom hitmarker'],
            ['input-killicon', 'custom kill icon'],
            ['input-keystroke-x', 'keystroke overlay x'],
            ['input-keystroke-y', 'keystroke overlay y'],
            ['input-frame-cap', 'custom frame cap'],
            ['input-custom-skin-url', 'custom skin url'],
        ]) {
            const el = $(id);
            if (el) el.value = s[key] ?? '';
        }

        const proxyMode = s['proxy mode'] || 'manual';
        $('proxy-mode-group')?.querySelectorAll('.btn-box').forEach(b => b.classList.toggle('active', b.dataset.val === proxyMode));

        const proxyProto = s['proxy protocol'] || 'http';
        $('proxy-protocol-group')?.querySelectorAll('.btn-box').forEach(b => b.classList.toggle('active', b.dataset.val === proxyProto));

        for (const [id, key] of [
            ['input-proxy-host', 'proxy host'],
            ['input-proxy-port', 'proxy port'],
            ['input-proxy-username', 'proxy username'],
            ['input-proxy-password', 'proxy password'],
            ['input-proxy-url', 'proxy url'],
        ]) {
            const el = $(id);
            if (el) el.value = s[key] ?? '';
        }

        updateProxyVisibility();

        const chatMode = s['game chat'] || 'default';
        $('group-chat-mode')?.querySelectorAll('.btn-box').forEach(b => b.classList.toggle('active', b.dataset.val === chatMode));

        const maxPending = String(s['max pending frames'] || '1');
        $('group-max-pending-frames')?.querySelectorAll('.btn-box').forEach(b => b.classList.toggle('active', b.dataset.val === maxPending));

        const skinHead = $('input-custom-skin-head');
        if (skinHead) skinHead.value = s['custom skin head'] || '#ff00ff';
        const skinBody = $('input-custom-skin-body');
        if (skinBody) skinBody.value = s['custom skin body'] || '#00ff00';

        const skinMode = s['custom skin mode'] || 'color';
        $('custom-skin-mode-group')?.querySelectorAll('.btn-box').forEach(b => b.classList.toggle('active', b.dataset.val === skinMode));
        const skinColorCont = $('custom-skin-color-container');
        const skinUrlCont = $('custom-skin-url-container');
        if (skinColorCont) skinColorCont.style.display = skinMode === 'color' ? 'block' : 'none';
        if (skinUrlCont) skinUrlCont.style.display = skinMode === 'url' ? 'block' : 'none';

        for (const [iId, vId, key] of [
            ['input-ui-opacity', 'val-ui-opacity', 'in-game ui opacity'],
            ['input-ui-scale', 'val-ui-scale', 'in-game ui scale'],
            ['input-keystroke-scale', 'val-keystroke-scale', 'keystroke overlay scale'],
        ]) {
            const input = $(iId), valEl = $(vId);
            if (!input || !valEl) continue;
            input.value = s[key] ?? 100;
            valEl.textContent = input.value;
            updateSliderBg(input);
        }

        root.querySelectorAll('.hotkey-value').forEach(el => {
            const key = el.dataset.keybind;
            if (key && s.keybinds?.[key]) el.textContent = s.keybinds[key].replace(/Key|Digit/g, '');
        });

        const dropdown = $('dropdown-angle-backend');
        if (dropdown) {
            const val = s['angle backend'] || 'default';
            const opt = dropdown.querySelector(`[data-val="${val}"]`) || dropdown.querySelector('[data-val="default"]');
            if (opt) {
                dropdown.querySelector('.custom-dropdown-label').textContent = opt.textContent;
                dropdown.querySelectorAll('.custom-dropdown-option').forEach(o => o.classList.toggle('active', o === opt));
            }
        }
    };

    const backendDropdown = $('dropdown-angle-backend');
    if (backendDropdown) {
        const plat = window.api.platform;
        if (plat !== 'win32') backendDropdown.querySelectorAll('.win-only').forEach(el => el.remove());
        if (plat !== 'darwin') backendDropdown.querySelectorAll('.mac-only').forEach(el => el.remove());
        const def = backendDropdown.querySelector('[data-val="default"]');
        if (def && plat === 'darwin') def.textContent = 'System Default (Metal)';
        else if (def && plat === 'linux') def.textContent = 'System Default';

        const trigger = backendDropdown.querySelector('.custom-dropdown-trigger');
        const menu = backendDropdown.querySelector('.custom-dropdown-menu');

        trigger?.addEventListener('click', e => {
            e.stopPropagation();
            const isOpen = backendDropdown.classList.toggle('open');
            if (isOpen && trigger && menu) {
                const rect = trigger.getBoundingClientRect();
                menu.style.top = `${rect.bottom + 4}px`;
                menu.style.right = `${window.innerWidth - rect.right}px`;
                menu.style.minWidth = `${rect.width}px`;
            }
        });

        backendDropdown.querySelectorAll('.custom-dropdown-option').forEach(opt => {
            opt.addEventListener('click', e => {
                e.stopPropagation();
                settings['angle backend'] = opt.dataset.val;
                window.api.updateSetting('angle backend', opt.dataset.val);
                updateUI(settings);
                backendDropdown.classList.remove('open');
            });
        });

        const closeDropdown = () => backendDropdown.classList.remove('open');
        root.addEventListener('click', closeDropdown);
        document.addEventListener('click', closeDropdown);
        root.querySelector('.menu-content')?.addEventListener('scroll', closeDropdown);
        window.addEventListener('resize', closeDropdown);
    }

    updateUI(settings);

    const bindToggle = (id, key) => $(id)?.addEventListener('change', e => window.api.updateSetting(key, e.target.checked));
    [
        ['toggle-unlimited-fps', 'unlimited fps'],
        ['toggle-start-fullscreen', 'start fullscreen'],
        ['toggle-celeste-theme', 'celeste theme'],
        ['toggle-show-rpc', 'show rpc'],
        ['toggle-rpc-match-info', 'rpc match info'],
        ['toggle-ui-animations', 'ui animations'],
        ['toggle-keystroke-overlay', 'keystroke overlay'],
        ['toggle-keystroke-edit', 'keystroke overlay edit mode'],
        ['toggle-show-tab-info', 'show tab info'],
        ['toggle-skip-loading-screen', 'skip loading screen'],
        ['toggle-swapper-enabled', 'swapper enabled'],
        ['toggle-custom-skin-enabled', 'custom skin enabled'],
        ['toggle-custom-skin-ingame-only', 'custom skin ingame only'],
        ['toggle-incognito-current-settings', 'incognito use current settings'],
        ['toggle-incognito-always-mask-ip', 'incognito always mask ip'],
    ].forEach(([id, key]) => bindToggle(id, key));

    $('toggle-mask-ip')?.addEventListener('change', e => {
        const isChecked = e.target.checked;
        settings['mask ip'] = isChecked;
        window.api.updateSetting?.('mask ip', isChecked);
        updateProxyVisibility();
        saveAndApplyProxyDebounced(0);
    });

    $('btn-open-swapper-folder')?.addEventListener('click', () => window.api.actionOpenSwapperFolder());

    const bindInput = (id, key) => $(id)?.addEventListener('input', e => window.api.updateSetting(key, e.target.value));
    bindInput('input-hitmarker', 'custom hitmarker');
    bindInput('input-killicon', 'custom kill icon');
    bindInput('input-custom-skin-url', 'custom skin url');

    const bindColorInput = (id, key) => {
        const el = $(id);
        if (!el) return;
        const onColor = e => {
            settings[key] = e.target.value;
            window.api.updateSetting(key, e.target.value);
        };
        el.addEventListener('input', onColor);
        el.addEventListener('change', onColor);
    };
    bindColorInput('input-custom-skin-head', 'custom skin head');
    bindColorInput('input-custom-skin-body', 'custom skin body');

    let proxyDebounceTimer = null;
    let _lastProxyHint = 0;
    const showProxyHint = () => {
        if (Date.now() - _lastProxyHint < 5000) return;
        _lastProxyHint = Date.now();
        showToast({
            title: 'Mask IP is not active yet',
            message: 'Enter a proxy below to start masking.',
            duration: 5000
        });
    };

    const saveAndApplyProxyDebounced = (delay = 700, typing = false) => {
        clearTimeout(proxyDebounceTimer);
        proxyDebounceTimer = setTimeout(async () => {
            const isMaskOn = !!$('toggle-mask-ip')?.checked;
            const proxySettings = {
                'mask ip': isMaskOn,
                'proxy mode': $('proxy-mode-group')?.querySelector('.active')?.dataset.val || 'manual',
                'proxy protocol': $('proxy-protocol-group')?.querySelector('.active')?.dataset.val || 'http',
                'proxy host': $('input-proxy-host')?.value.trim() || '',
                'proxy port': $('input-proxy-port')?.value.trim() || '',
                'proxy username': $('input-proxy-username')?.value.trim() || '',
                'proxy password': $('input-proxy-password')?.value || '',
                'proxy url': $('input-proxy-url')?.value.trim() || ''
            };
            Object.assign(settings, proxySettings);
            const res = await window.api.actionApplyProxy(proxySettings);
            if (isMaskOn && res && !res.success) {
                const entered = proxySettings['proxy mode'] === 'url'
                    ? !!proxySettings['proxy url']
                    : !!(proxySettings['proxy host'] && proxySettings['proxy port']);
                if (!typing) {
                    if (!entered) showProxyHint();
                    else showProxyErrorPopup('The proxy details look wrong. Begin with normal network?');
                }
            } else if (!isMaskOn || res?.success) {
                _activeProxyErrorToast?.dismiss();
                _activeProxyErrorToast = null;
            }
            updateProxyReloadToast(!!res?.success && !!res.reloadNeeded);
        }, delay);
    };

    const bindProxyInput = (id, key) => {
        const el = $(id);
        if (!el) return;
        el.addEventListener('input', e => { settings[key] = e.target.value; saveAndApplyProxyDebounced(700, true); });
        el.addEventListener('change', e => { settings[key] = e.target.value; saveAndApplyProxyDebounced(0); });
    };
    bindProxyInput('input-proxy-host', 'proxy host');
    bindProxyInput('input-proxy-port', 'proxy port');
    $('input-proxy-port')?.addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, ''); });
    bindProxyInput('input-proxy-username', 'proxy username');
    bindProxyInput('input-proxy-password', 'proxy password');
    bindProxyInput('input-proxy-url', 'proxy url');

    const bindButtonGroup = (groupId, onSelect) => {
        const group = $(groupId);
        if (!group) return;
        const boxes = group.querySelectorAll('.btn-box');
        boxes.forEach(box => box.addEventListener('click', () => {
            boxes.forEach(b => b.classList.remove('active'));
            box.classList.add('active');
            onSelect(box.dataset.val);
        }));
    };
    bindButtonGroup('group-chat-mode', val => window.api.updateSetting('game chat', val));
    bindButtonGroup('custom-skin-mode-group', val => {
        settings['custom skin mode'] = val;
        window.api.updateSetting('custom skin mode', val);
        const skinColorCont = $('custom-skin-color-container');
        const skinUrlCont = $('custom-skin-url-container');
        if (skinColorCont) skinColorCont.style.display = val === 'color' ? 'block' : 'none';
        if (skinUrlCont) skinUrlCont.style.display = val === 'url' ? 'block' : 'none';
    });
    bindButtonGroup('group-max-pending-frames', val => {
        const num = parseInt(val, 10) || 1;
        settings['max pending frames'] = num;
        window.api.updateSetting('max pending frames', num);
    });
    bindButtonGroup('proxy-mode-group', val => {
        settings['proxy mode'] = val;
        window.api.updateSetting('proxy mode', val);
        updateProxyVisibility();
        saveAndApplyProxyDebounced(0);
    });
    bindButtonGroup('proxy-protocol-group', val => {
        settings['proxy protocol'] = val;
        window.api.updateSetting('proxy protocol', val);
        saveAndApplyProxyDebounced(0);
    });

    const bindSlider = (inputId, valId, key) => {
        const input = $(inputId), valEl = $(valId);
        if (!input || !valEl) return;
        input.addEventListener('input', e => {
            valEl.textContent = e.target.value;
            updateSliderBg(e.target);
            window.api.updateSetting(key, parseInt(e.target.value, 10));
        });
    };
    bindSlider('input-ui-opacity', 'val-ui-opacity', 'in-game ui opacity');
    bindSlider('input-ui-scale', 'val-ui-scale', 'in-game ui scale');
    bindSlider('input-keystroke-scale', 'val-keystroke-scale', 'keystroke overlay scale');

    const sanitizeInt = val => (val.startsWith('-') ? '-' : '') + val.replace(/[^0-9]/g, '');
    const bindIntInput = (id, key) => {
        const el = $(id);
        if (!el) return;
        el.addEventListener('input', e => {
            e.target.value = sanitizeInt(e.target.value);
            const v = parseInt(e.target.value, 10);
            window.api.updateSetting(key, isNaN(v) ? 0 : v);
        });
        el.addEventListener('change', e => {
            const v = parseInt(e.target.value, 10) || 0;
            e.target.value = v;
            window.api.updateSetting(key, v);
        });
    };
    bindIntInput('input-keystroke-x', 'keystroke overlay x');
    bindIntInput('input-keystroke-y', 'keystroke overlay y');
    bindIntInput('input-frame-cap', 'custom frame cap');

    let activeKeybindHandler = null;
    let activeKeybindUpHandler = null;
    let activeKeybindEl = null;
    let candidateModifier = null;

    const cancelKeybindListening = () => {
        if (activeKeybindHandler) {
            document.removeEventListener('keydown', activeKeybindHandler, true);
            activeKeybindHandler = null;
        }
        if (activeKeybindUpHandler) {
            document.removeEventListener('keyup', activeKeybindUpHandler, true);
            activeKeybindUpHandler = null;
        }
        candidateModifier = null;
        if (activeKeybindEl) {
            const orig = settings.keybinds?.[activeKeybindEl.dataset.keybind] || '';
            activeKeybindEl.textContent = orig.replace(/Key|Digit/g, '') || 'None';
            activeKeybindEl.style.opacity = '1';
            activeKeybindEl = null;
        }
    };

    const commitKeybind = (el, combo) => {
        if (!settings.keybinds) settings.keybinds = {};
        settings.keybinds[el.dataset.keybind] = combo;
        window.api.updateSetting('keybinds', settings.keybinds);

        el.textContent = combo.replace(/Key|Digit/g, '');
        el.style.opacity = '1';

        if (activeKeybindHandler) {
            document.removeEventListener('keydown', activeKeybindHandler, true);
            activeKeybindHandler = null;
        }
        if (activeKeybindUpHandler) {
            document.removeEventListener('keyup', activeKeybindUpHandler, true);
            activeKeybindUpHandler = null;
        }
        candidateModifier = null;
        activeKeybindEl = null;
    };

    root.querySelectorAll('.hotkey-value').forEach(el => {
        el.addEventListener('click', e => {
            e.stopPropagation();
            if (activeKeybindEl === el) { cancelKeybindListening(); return; }
            cancelKeybindListening();

            activeKeybindEl = el;
            candidateModifier = null;
            el.textContent = 'Listening...';
            el.style.opacity = '0.7';

            activeKeybindHandler = ev => {
                ev.preventDefault();
                ev.stopPropagation();

                if (ev.code === 'Escape') { cancelKeybindListening(); return; }

                const isModifier = ['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(ev.code);
                if (isModifier) {
                    candidateModifier = ev.code;
                    return;
                }

                candidateModifier = null;
                const combo = window.api.buildCombo(ev.ctrlKey, ev.shiftKey, ev.altKey, ev.code);
                commitKeybind(el, combo);
            };

            activeKeybindUpHandler = ev => {
                if (candidateModifier && candidateModifier === ev.code) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    const combo = candidateModifier;
                    commitKeybind(el, combo);
                }
            };

            document.addEventListener('keydown', activeKeybindHandler, true);
            document.addEventListener('keyup', activeKeybindUpHandler, true);
        });
    });

    root.addEventListener('click', cancelKeybindListening);

    $('btn-open-incognito')?.addEventListener('click', () => {
        window.api.actionOpenIncognito(!!$('toggle-incognito-current-settings')?.checked);
    });

    const resetBtn = $('btn-reset-settings');
    let undoTimeout = null, countdownInterval = null, backupSettings = null;
    if (resetBtn) {
        resetBtn.addEventListener('click', async () => {
            if (resetBtn.classList.contains('undo-mode')) {
                clearTimeout(undoTimeout);
                clearInterval(countdownInterval);
                resetBtn.classList.remove('undo-mode');
                resetBtn.textContent = 'Reset';
                if (backupSettings) {
                    const defaults = window.api.getDefaults();
                    for (const k in settings) delete settings[k];
                    Object.assign(settings, backupSettings);
                    if (defaults.keybinds) settings.keybinds = { ...defaults.keybinds, ...(backupSettings.keybinds || {}) };
                    await window.api.updateSettingsBulk(settings).catch(console.error);
                    updateUI(settings);
                    backupSettings = null;
                }
            } else {
                backupSettings = JSON.parse(JSON.stringify(settings));
                const defaults = window.api.getDefaults();
                for (const k in settings) delete settings[k];
                Object.assign(settings, defaults);
                await window.api.updateSettingsBulk(settings).catch(console.error);
                updateUI(settings);
                resetBtn.classList.add('undo-mode');
                let timeLeft = 3;
                resetBtn.textContent = `Undo (${timeLeft}s)`;
                countdownInterval = setInterval(() => {
                    resetBtn.textContent = `Undo (${--timeLeft}s)`;
                    if (timeLeft <= 0) clearInterval(countdownInterval);
                }, 1000);
                undoTimeout = setTimeout(() => {
                    resetBtn.classList.remove('undo-mode');
                    resetBtn.textContent = 'Reset';
                    backupSettings = null;
                }, 3000);
            }
        });
    }

    root.querySelectorAll('.plugin-dropdown-toggle').forEach(el => {
        el.addEventListener('click', () => {
            const target = $(el.dataset.target);
            if (!target) return;
            const isOpen = target.style.display !== 'none' && target.style.display !== '';
            target.style.display = isOpen ? 'none' : 'block';
            el.classList.toggle('open', !isOpen);
        });
    });

    bindButtonGroup('plugin-script-mode-group', val => showContainers(val, 'plugin-script-url-container', 'plugin-script-code-container'));
    bindButtonGroup('plugin-css-mode-group', val => showContainers(val, 'plugin-css-url-container', 'plugin-css-code-container'));

    const renderPluginList = (key, listId, labelPrefix) => {
        const list = $(listId);
        if (!list) return;
        list.innerHTML = '';
        const items = settings[key] || [];
        if (!items.length) return;

        const frag = document.createDocumentFragment();
        items.forEach((item, idx) => {
            const row = document.createElement('div');
            row.className = 'plugin-script-item';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'setting-label';
            nameSpan.textContent = item.name || `${labelPrefix} ${idx + 1}`;

            const controls = document.createElement('div');
            controls.style.cssText = 'display:flex;align-items:center;gap:8px;';

            const delBtn = document.createElement('button');
            delBtn.className = 'plugin-btn-remove';
            delBtn.textContent = 'Remove';

            const label = document.createElement('label');
            label.className = 'toggle-switch';
            const chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.checked = !!item.enabled;
            const slider = document.createElement('span');
            slider.className = 'slider';
            label.append(chk, slider);

            controls.append(delBtn, label);
            row.append(nameSpan, controls);

            let undoTimer = null, countTimer = null;
            delBtn.addEventListener('click', () => {
                if (delBtn.classList.contains('undo-mode')) {
                    clearTimeout(undoTimer);
                    clearInterval(countTimer);
                    delBtn.classList.remove('undo-mode');
                    delBtn.textContent = 'Remove';
                } else {
                    delBtn.classList.add('undo-mode');
                    let t = 3;
                    delBtn.textContent = `Undo (${t}s)`;
                    countTimer = setInterval(() => {
                        delBtn.textContent = `Undo (${--t}s)`;
                        if (t <= 0) clearInterval(countTimer);
                    }, 1000);
                    undoTimer = setTimeout(() => {
                        const i = settings[key].indexOf(item);
                        if (i !== -1) {
                            settings[key].splice(i, 1);
                            window.api.updateSetting(key, settings[key]);
                        }
                        renderPluginList(key, listId, labelPrefix);
                    }, 3000);
                }
            });

            chk.addEventListener('change', e => {
                item.enabled = e.target.checked;
                window.api.updateSetting(key, settings[key]);
            });

            frag.appendChild(row);
        });
        list.appendChild(frag);
    };

    const bindPluginAdd = (btnId, key, groupModeId, nameInputId, urlInputId, codeInputId, labelPrefix, renderFn) => {
        $(btnId)?.addEventListener('click', () => {
            const mode = $(groupModeId)?.querySelector('.active')?.dataset.val ?? 'url';
            const nameInput = $(nameInputId);
            const name = nameInput.value.trim() || `${labelPrefix} ${(settings[key] || []).length + 1}`;
            const content = (mode === 'url' ? $(urlInputId) : $(codeInputId))?.value.trim();
            if (!content) return;
            if (!settings[key]) settings[key] = [];
            settings[key].push({ name, mode, content, enabled: true });
            window.api.updateSetting(key, settings[key]);
            nameInput.value = '';
            const u = $(urlInputId), c = $(codeInputId);
            if (u) u.value = '';
            if (c) c.value = '';
            renderFn();
        });
    };

    const renderCSS = () => renderPluginList('custom css list', 'manage-css-list', 'CSS');
    const renderScripts = () => renderPluginList('custom scripts', 'manage-scripts-list', 'Script');

    renderCSS();
    renderScripts();

    bindPluginAdd('btn-add-plugin-css', 'custom css list', 'plugin-css-mode-group', 'input-plugin-css-name', 'input-plugin-css-url', 'input-plugin-css-code', 'CSS', renderCSS);
    bindPluginAdd('btn-add-plugin-script', 'custom scripts', 'plugin-script-mode-group', 'input-plugin-script-name', 'input-plugin-script-url', 'input-plugin-script-code', 'Script', renderScripts);

    const searchInput = $('menu-search-input');
    if (searchInput) {
        const allItems = [...root.querySelectorAll('.setting-item')];
        const allCats = [...root.querySelectorAll('.setting-category')];
        const itemMeta = allItems.map(item => ({
            el: item,
            label: (item.querySelector('.setting-label')?.textContent || '').toLowerCase(),
            cat: item.closest('.setting-category'),
            pane: item.closest('.tab-pane'),
        }));
        const catMeta = allCats.map(cat => ({
            el: cat,
            header: (cat.querySelector('.category-header')?.textContent || '').toLowerCase(),
            items: [...cat.querySelectorAll('.setting-item')],
        }));

        let searchTimeout;
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                const q = searchInput.value.trim().toLowerCase();
                if (!q) {
                    itemMeta.forEach(({ el }) => { el.style.display = ''; });
                    catMeta.forEach(({ el }) => { el.style.display = ''; });
                    updateUI(settings);
                    return;
                }
                const matchingCats = new Set();
                for (const { el, header } of catMeta) {
                    if (header.includes(q)) matchingCats.add(el);
                }
                let bestScore = -1, bestPaneId = null;
                for (const { el, label, cat, pane } of itemMeta) {
                    let score = (cat && matchingCats.has(cat)) ? 2 : (label === q ? 3 : label.startsWith(q) ? 2 : label.includes(q) ? 1 : -1);
                    el.style.display = score >= 0 ? '' : 'none';
                    if (score > bestScore) { bestScore = score; bestPaneId = pane?.id || null; }
                }
                for (const { el, items } of catMeta) {
                    el.style.display = (matchingCats.has(el) || items.some(i => i.style.display !== 'none')) ? '' : 'none';
                    if (matchingCats.has(el)) items.forEach(i => { i.style.display = ''; });
                }

                showContainers($('plugin-script-mode-group')?.querySelector('.active')?.dataset.val ?? 'url', 'plugin-script-url-container', 'plugin-script-code-container');
                showContainers($('plugin-css-mode-group')?.querySelector('.active')?.dataset.val ?? 'url', 'plugin-css-url-container', 'plugin-css-code-container');
                updateProxyVisibility();
                if (bestPaneId) switchTab(bestPaneId);
            }, 80);
        });
    }

    const updateItem = $('item-update-available');
    const updateBtn = $('btn-install-update');
    const updateVerLabel = $('update-version-label');

    const showUpdateUI = (info) => {
        if (!updateItem) return;
        updateItem.style.display = (info?.available) ? 'flex' : 'none';
        if (info?.available && info.version && updateVerLabel) {
            updateVerLabel.textContent = `Version ${info.version} is ready`;
        }
    };

    window.api.getUpdateStatus?.().then(showUpdateUI);
    window.api.onUpdateStatusChanged?.(showUpdateUI);

    window.api.onUpdateDownloadProgress?.(percent => {
        if (updateBtn) {
            updateBtn.textContent = `Downloading ${percent}%`;
            updateBtn.disabled = true;
        }
    });

    window.api.onUpdateDownloaded?.(() => {
        if (updateBtn) updateBtn.textContent = 'Restarting...';
    });

    updateBtn?.addEventListener('click', () => {
        updateBtn.disabled = true;
        updateBtn.textContent = 'Downloading...';
        window.api.installUpdate?.();
    });
}).catch(err => console.error('Failed to load settings:', err));
