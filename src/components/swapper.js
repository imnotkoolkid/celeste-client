'use strict';

const { app, session, protocol, net } = require('electron');
const path = require('path');
const fs   = require('fs');
const url  = require('url');

const SWAP_FOLDER = path.join(app.getPath('documents'), 'CelesteClient', 'swapper');
const swapperFolder = path.join(SWAP_FOLDER, 'assets');
const getSwapperFolder = () => swapperFolder;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*'
};

let _swapperEnabled = true;
const setSwapperEnabled = (enabled) => { _swapperEnabled = !!enabled; };

const initResourceSwapper = async (enabled) => {
  _swapperEnabled = enabled !== false;
  const swapMap = new Map();
  const wildcards = [];

  ['media', 'img'].forEach(folder => {
    const dir = path.join(swapperFolder, folder);
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    }
  });

  protocol.handle('celeste', async (request) => {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const key = request.url.replace(/^celeste:\/\//i, '').replace(/(\?.*)|(#.*)|_/g, '');
    let entry = swapMap.get(key);
    if (!entry) {
      const name = key.slice(key.lastIndexOf('/') + 1);
      for (const [k, rec] of swapMap) {
        if (k.endsWith('/' + name)) { entry = rec; break; }
      }
    }

    if (!entry) return new Response('Not Found', { status: 404 });

    try {
      const res = await net.fetch(entry.fileUrl);
      const headers = new Headers(res.headers);
      Object.entries(CORS_HEADERS).forEach(([k, v]) => headers.set(k, v));
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    } catch (err) {
      console.error('Swapper file serve error:', entry.fileUrl, err);
      return new Response('Internal Server Error', { status: 500 });
    }
  });

  if (!_swapperEnabled) return;

  function scanDir(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(full);
      } else {
        const rel = path.relative(SWAP_FOLDER, full).replace(/\\/g, '/');
        if (rel.startsWith('assets/media/') || rel.startsWith('assets/img/')) {
          const normKey = `kirka.io/${rel.replace(/_/g, '')}`;
          const fileUrl = url.pathToFileURL(full).toString();
          const record = { key: normKey, fileUrl };
          swapMap.set(normKey, record);

          const lastSlash = normKey.lastIndexOf('/');
          const fileName = normKey.slice(lastSlash + 1);
          const dot = fileName.lastIndexOf('.');
          if (dot !== -1) {
            const base = fileName.slice(0, dot);
            const ext = fileName.slice(dot + 1);
            wildcards.push({ regex: new RegExp(`/${base}[^/]*\\.${ext}`, 'i'), record });
          }
        }
      }
    }
  }

  scanDir(SWAP_FOLDER);
  if (swapMap.size === 0) return;

  session.defaultSession.webRequest.onBeforeRequest(
    { urls: [
      '*://kirka.io/assets/media/*',
      '*://kirka.io/assets/img/*',
      '*://*.kirka.io/assets/media/*',
      '*://*.kirka.io/assets/img/*'
    ] },
    (details, callback) => {
      if (!_swapperEnabled) return callback({});
      const cleaned = details.url.replace(/^https?:\/\//i, '').replace(/(\?.*)|(#.*)|_/g, '');
      const match = swapMap.get(cleaned) || wildcards.find(w => w.regex.test(details.url))?.record;
      callback(match ? { redirectURL: `celeste://${match.key}` } : {});
    }
  );
};

module.exports = { initResourceSwapper, getSwapperFolder, setSwapperEnabled };
