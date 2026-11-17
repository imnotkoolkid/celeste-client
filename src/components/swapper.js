'use strict';

const { app, session, protocol, net } = require('electron');
const path = require('path');
const fs   = require('fs');
const fsp  = fs.promises;

const SWAP_FOLDER = path.join(app.getPath('documents'), 'CelesteClient', 'swapper');
const swapperFolder = path.join(SWAP_FOLDER, 'assets');
const getSwapperFolder = () => swapperFolder;

const initResourceSwapper = async (enabled) => {
    const swapFiles = {};

    protocol.handle('celeste', (request) => {
        let key = request.url.replace(/^celeste:\/\//i, '').replace(/(\?.*)|(#.*)/g, '');
        let p = swapFiles[key];
        if (!p) return new Response(null, { status: 404 });
        if (p.startsWith('/')) p = p.slice(1);
        if (process.platform === 'win32' && /^[a-zA-Z]\//.test(p)) {
            p = p.charAt(0) + ':' + p.slice(1);
        }
        return net.fetch('file:///' + decodeURIComponent(p));
    });

    ['media', 'img'].forEach(folder => {
        const dir = path.join(swapperFolder, folder);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });

    if (!enabled) return;

    async function collectSwapFiles(dir) {
        let entries;
        try {
            entries = await fsp.readdir(dir, { withFileTypes: true });
        } catch (_) {
            return;
        }
        await Promise.all(entries.map(entry => {
            const filePath = path.join(dir, entry.name);
            if (entry.isDirectory()) return collectSwapFiles(filePath);
            const relPath = path.relative(SWAP_FOLDER, filePath).replace(/\\/g, '/');
            if (relPath.startsWith('assets/media/') || relPath.startsWith('assets/img/')) {
                swapFiles[`kirka.io/${relPath}`.replace(/_/g, '')] = filePath.replace(/\\/g, '/');
            }
        }));
    }

    await collectSwapFiles(SWAP_FOLDER);

    if (Object.keys(swapFiles).length === 0) return;

    session.defaultSession.webRequest.onBeforeRequest(
        { urls: ['*://kirka.io/*', '*://*.kirka.io/*'], types: ['image', 'media'] },
        (details, callback) => {
            const cleanedUrl = details.url.replace(/^https?:\/\//i, '').replace(/(\?.*)|(#.*)|_/g, '');
            callback(swapFiles[cleanedUrl] ? { redirectURL: 'celeste://' + cleanedUrl } : {});
        }
    );
};

module.exports = { initResourceSwapper, getSwapperFolder };
