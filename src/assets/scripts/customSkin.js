(() => {
    if (window.__celesteCustomSkinInitialized) return;
    window.__celesteCustomSkinInitialized = true;

    const DEFAULT_SKIN_TEMPLATE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAAXNSR0IArs4c6QAAANJJREFUeF7t2EEKBDEIBdF4/0M7MAeIi0HmQ15v022LaJWkTp8+l6frenz79HtWXeM7//x/KYAOMAIY8E8ITYTchjAIPm+BPv2b6KceDj8vBdABRgADwjm1mh4IPm+BaRFa7b+A4OMqHJDjagoKYASGG6HV/gsIbgSMgBG4X4oGjOlqChiAARiAAW9fiGAABmAABqyuWuHBbYIswAIswALhoF5NjwVYgAVYgAVWMRsenAVYgAVYgAXCQb2aHguwAAuwAAusYjY8OAuwAAuwwNMW+AByY7e5Jy8jiwAAAABJRU5ErkJggg==";
    const muzzleImg = "https://kirka.io/assets/img/__shooting-fire__.effa20af.png";
    const muzzleImg2 = "shooting-fire";

    let _config = {
        enabled: false,
        ingameOnly: true,
        mode: 'color',
        head: '#ff00ff',
        body: '#00ff00',
        url: ''
    };

    let _currentSkinDataUrl = null;
    let _skinTemplatePixels = null;
    let _skinCanvas = null;
    let _cachedUrl = '';
    let _cachedUrlData = '';
    const _patchedTextures = new Map();

    function hexToRgb(hex) {
        if (!hex) return { r: 0, g: 0, b: 0 };
        const clean = hex.replace('#', '');
        const r = parseInt(clean.substring(0, 2), 16) || 0;
        const g = parseInt(clean.substring(2, 4), 16) || 0;
        const b = parseInt(clean.substring(4, 6), 16) || 0;
        return { r, g, b };
    }

    async function fetchImageAsBase64(url) {
        try {
            const response = await fetch(url);
            const contentType = response.headers.get("content-type");
            if (!contentType || !contentType.startsWith("image")) {
                throw new Error("URL does not point to an image");
            }
            const blob = await response.blob();
            return await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        } catch (error) {
            console.warn("Custom Skin: fetchImageAsBase64 fallback to direct URL:", error);
            return url;
        }
    }

    function renderColorSkin(callback) {
        if (!_skinCanvas) {
            _skinCanvas = document.createElement('canvas');
            _skinCanvas.width = 64;
            _skinCanvas.height = 64;
        }
        const ctx = _skinCanvas.getContext('2d');
        const head = hexToRgb(_config.head || '#ff00ff');
        const body = hexToRgb(_config.body || '#00ff00');

        const doRender = () => {
            const imgData = ctx.createImageData(64, 64);
            const data = imgData.data;
            for (let i = 0; i < _skinTemplatePixels.length; i++) {
                const p = _skinTemplatePixels[i];
                const idx = (p.y * 64 + p.x) * 4;
                const color = p.isBody ? body : head;
                data[idx] = color.r;
                data[idx + 1] = color.g;
                data[idx + 2] = color.b;
                data[idx + 3] = p.a;
            }
            ctx.putImageData(imgData, 0, 0);
            _currentSkinDataUrl = _skinCanvas.toDataURL();
            if (callback) callback(_currentSkinDataUrl);
        };

        if (_skinTemplatePixels) {
            doRender();
            return;
        }

        const img = new Image();
        img.src = DEFAULT_SKIN_TEMPLATE;
        img.onload = () => {
            ctx.drawImage(img, 0, 0);
            const raw = ctx.getImageData(0, 0, 64, 64).data;
            _skinTemplatePixels = [];
            for (let i = 0; i < raw.length; i += 4) {
                const a = raw[i + 3];
                if (a > 0) {
                    const x = (i / 4) % 64;
                    const y = Math.floor(i / 4 / 64);
                    // Green channel indicates body pixel in SheriffCarry's template
                    const isBody = raw[i + 1] === 255;
                    _skinTemplatePixels.push({ x, y, a, isBody });
                }
            }
            doRender();
        };
    }

    function getActiveSkinUrl() {
        if (!_config.enabled) return null;
        if (_config.ingameOnly && !document.querySelector('.desktop-game-interface')) {
            return null;
        }
        if (_config.mode === 'url') {
            return _cachedUrlData || _config.url || null;
        }
        return _currentSkinDataUrl || DEFAULT_SKIN_TEMPLATE;
    }

    function syncAllTextures() {
        const activeUrl = getActiveSkinUrl();
        for (const [texture, origSrc] of _patchedTextures.entries()) {
            if (activeUrl) {
                if (texture.image && texture.image.src !== activeUrl) {
                    texture.image.src = activeUrl;
                    texture.needsUpdate = true;
                }
            } else {
                if (texture.image && texture.image.src !== origSrc) {
                    texture.image.src = origSrc;
                    texture.needsUpdate = true;
                }
                _patchedTextures.delete(texture);
            }
        }
    }

    function updateConfig(newConfig) {
        Object.assign(_config, newConfig);

        if (_config.mode === 'url' && _config.url) {
            if (_config.url !== _cachedUrl) {
                _cachedUrl = _config.url;
                if (_config.url.startsWith('http://') || _config.url.startsWith('https://')) {
                    fetchImageAsBase64(_config.url).then(b64 => {
                        _cachedUrlData = b64;
                        syncAllTextures();
                    });
                } else {
                    _cachedUrlData = _config.url;
                    syncAllTextures();
                }
            } else {
                syncAllTextures();
            }
        } else if (_config.mode === 'color') {
            renderColorSkin(() => syncAllTextures());
        } else {
            syncAllTextures();
        }
    }

    // Three.js texture hook
    const oldIsArr = Array.isArray;
    Array.isArray = function(...args) {
        const arg = args[0];
        if (!arg || !arg.map || !arg.map.image) return oldIsArr.apply(Array, args);

        const texture = arg.map;
        const image = texture.image;
        const width = image.width;
        const height = image.height;

        const isSkinTexture = (width === 128 || width === 64 || width === 42) &&
                              (height === 128 || height === 64 || height === 42 || height === 32);

        if (isSkinTexture && image.src !== muzzleImg && !image.src.includes(muzzleImg2)) {
            const activeUrl = getActiveSkinUrl();
            if (activeUrl) {
                if (image.src !== activeUrl) {
                    if (!_patchedTextures.has(texture)) _patchedTextures.set(texture, image.src);
                    image.src = activeUrl;
                    texture.needsUpdate = true;
                }
            } else if (_patchedTextures.has(texture)) {
                image.src = _patchedTextures.get(texture);
                _patchedTextures.delete(texture);
                texture.needsUpdate = true;
            }
        }

        return oldIsArr.apply(Array, args);
    };

    // Check for match enter/exit state transitions when ingameOnly is active
    setInterval(() => {
        if (_config.enabled && _config.ingameOnly) {
            syncAllTextures();
        }
    }, 500);

    window.addEventListener('celeste-update-skin-config', (e) => {
        if (e.detail) updateConfig(e.detail);
    });
})();
