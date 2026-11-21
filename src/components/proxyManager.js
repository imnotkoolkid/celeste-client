const { session, webContents } = require('electron');
const proxyGate = require('./proxyGate');

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

const BLOCKED_PROXY_RULES = 'http://127.0.0.1:1';

const _sessionRoutes = new WeakMap();
const _proxyQueues = new WeakMap();
const _pageRoutes = new Map();
let _proxyConnectionFailed = false;
const _incognitoProxyFailed = new Map();

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

function trackWebContents(wc) {
  const route = _sessionRoutes.get(wc.session);
  if (route && route.masked) setWebRtcPolicy(wc, true);

  const id = wc.id;
  wc.on('did-start-navigation', (details, _url, isInPlace, isMainFrame) => {
    const mainFrame = details.isMainFrame ?? isMainFrame;
    const sameDocument = details.isSameDocument ?? isInPlace;
    if (mainFrame && !sameDocument) _pageRoutes.set(id, currentRouteKey(wc.session));
  });
  wc.once('destroyed', () => _pageRoutes.delete(id));
}

function releaseSession(ses) {
  const route = _sessionRoutes.get(ses);
  if (route && route.gateKey) proxyGate.release(route.gateKey);
  _sessionRoutes.delete(ses);
}

function isProxyError(errorCode, maskedNow) {
  return !!(maskedNow && (errorCode < 0 || PROXY_ERR_CODES.has(errorCode)));
}

function setProxyFailed(isIncog, wcId, failed) {
  if (isIncog) {
    _incognitoProxyFailed.set(wcId, failed);
  } else {
    _proxyConnectionFailed = failed;
  }
}

function getProxyStatus(isIncog, wcId) {
  if (isIncog) {
    return { failed: !!_incognitoProxyFailed.get(wcId) };
  }
  return { failed: _proxyConnectionFailed };
}

function clearIncognitoProxy(wcId) {
  _incognitoProxyFailed.delete(wcId);
}

function getProxyConfigForLogin(wc, authInfo, currentSettings, allSettingsList = []) {
  if (wc && wc.id && currentSettings) return getProxyConfig(currentSettings);

  const askingHost = String(authInfo.host || '').replace(/^\[|\]$/g, '').toLowerCase();
  for (const s of allSettingsList) {
    if (!s || !s['mask ip']) continue;
    const config = getProxyConfig(s);
    if (!config || !config.username) continue;
    const host = config.host.replace(/^\[|\]$/g, '').toLowerCase();
    if (host === askingHost && String(config.port) === String(authInfo.port)) return config;
  }
  return getProxyConfig(currentSettings);
}

function handleProxyLogin(event, wc, details, authInfo, callback, isIncog, currentSettings, allSettingsList) {
  const config = getProxyConfigForLogin(wc, authInfo, currentSettings, allSettingsList);

  if (!config || !config.username) {
    console.warn('Proxy authentication requested but no credentials configured.');
    event.preventDefault();
    setProxyFailed(isIncog, wc?.id, true);
    if (wc && !wc.isDestroyed()) wc.send('show-proxy-error-popup');
    return;
  }

  if (details && details.firstAuthAttempt === false) {
    console.warn('Proxy authentication failed: invalid credentials rejected by server.');
    event.preventDefault();
    setProxyFailed(isIncog, wc?.id, true);
    if (wc && !wc.isDestroyed()) wc.send('show-proxy-error-popup');
    return;
  }

  event.preventDefault();
  callback(config.username, config.password || '');
}

function closeAll() {
  proxyGate.closeAll();
}

module.exports = {
  PROXY_KEYS,
  PROXY_ERR_CODES,
  PROXY_SCHEMES,
  BLOCKED_PROXY_RULES,
  buildProxyConfig,
  parseProxyUrl,
  getManualProxyConfig,
  getUrlProxyConfig,
  getProxyConfig,
  setWebRtcPolicy,
  setSessionRoute,
  applyProxyToSession,
  applyProxySettings,
  currentRouteKey,
  needsReloadForProxy,
  trackWebContents,
  releaseSession,
  isProxyError,
  setProxyFailed,
  getProxyStatus,
  clearIncognitoProxy,
  getProxyConfigForLogin,
  handleProxyLogin,
  closeAll
};
