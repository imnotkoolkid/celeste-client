'use strict';

const { app, session, protocol } = require('electron');
const path = require('path');
const fs   = require('fs');
const fsp  = fs.promises;

const SWAP_FOLDER = path.join(app.getPath('documents'), 'CelesteClient', 'swapper');
const swapperFolder = path.join(SWAP_FOLDER, 'assets');
const getSwapperFolder = () => swapperFolder;

const initResourceSwapper = async (enabled) => {
    const swapFiles = {};

    protocol.registerFileProtocol('celeste', (request, callback) => {
        const cleanedUrl = request.url.slice('celeste://'.length);
        let p = swapFiles[cleanedUrl];
        if (!p) return callback({});
        if (p.startsWith('/')) p = p.slice(1);
        if (process.platform === 'win32' && /^[a-zA-Z]\//.test(p)) {
            p = p.charAt(0) + ':' + p.slice(1);
        }
        callback({ path: decodeURIComponent(p) });
    });
    const subFolders  = ['media', 'img'];

    subFolders.forEach(folder => {
        const dir = path.join(SWAP_FOLDER, 'assets', folder);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });

    if (!enabled) return;

    // try {
    //     protocol.registerFileProtocol('file', (request, callback) => {
    //         let p = request.url.slice('file:///'.length);
    //         if (process.platform === 'win32' && p.startsWith('/')) p = p.slice(1);
    //         callback(decodeURIComponent(p));
    //     });
    // } catch (_) {}

    async function collectSwapFiles(dir) {
        let entries;
        try {
            entries = await fsp.readdir(dir, { withFileTypes: true });
        } catch (_) {
            return;
        }
        await Promise.all(entries.map(async entry => {
            const filePath = path.join(dir, entry.name);
            if (entry.isDirectory()) return collectSwapFiles(filePath);
            const relPath = path.relative(SWAP_FOLDER, filePath).replace(/\\/g, '/');
            if (!relPath.startsWith('assets/media/') && !relPath.startsWith('assets/img/')) return;
            const cleanedKey = `://kirka.io/${relPath}`.replace(/_/g, '');
            swapFiles[cleanedKey] = filePath.replace(/\\/g, '/');
        }));
    }

    await collectSwapFiles(SWAP_FOLDER);

    session.defaultSession.webRequest.onBeforeRequest(
        { urls: ['*://kirka.io/*', '*://*.kirka.io/*'], types: ['image', 'media'] },
        (details, callback) => {
            if (Object.keys(swapFiles).length === 0) return callback({}); 
            const cleanedUrl = details.url.replace(/^https?|(\?.*)|(\#.*)|\_/gi, '');
            callback(cleanedUrl in swapFiles ? { redirectURL: 'celeste://' + cleanedUrl } : {});
        }
    );
};

module.exports = { initResourceSwapper, getSwapperFolder };