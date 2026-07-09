'use strict';

const { app, session, protocol } = require('electron');
const path = require('path');
const fs   = require('fs');

const getSwapperFolder = () =>
    path.join(app.getPath('documents'), 'CelesteClient', 'swapper', 'assets');

const initResourceSwapper = (enabled) => {
    protocol.registerFileProtocol('celeste', (request, callback) => {
        let p = request.url.replace(/^celeste:\/\//i, '');
        if (p.startsWith('/')) p = p.slice(1);
        if (process.platform === 'win32' && /^[a-zA-Z]\//.test(p)) {
            p = p.charAt(0) + ':' + p.slice(1);
        }
        callback({ path: decodeURIComponent(p) });
    });

    try {
        protocol.registerFileProtocol('file', (request, callback) => {
            let p = request.url.replace(/^file:\/\/\//i, '');
            if (process.platform === 'win32' && p.startsWith('/')) p = p.slice(1);
            callback(decodeURIComponent(p));
        });
    } catch (_) {}

    const SWAP_FOLDER = path.join(app.getPath('documents'), 'CelesteClient', 'swapper');
    const subFolders  = ['media', 'img'];
    const swapFiles   = {};

    subFolders.forEach(folder => {
        const dir = path.join(SWAP_FOLDER, 'assets', folder);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });

    if (!enabled) return;

    const allFilesSync = (dir) => {
        if (!fs.existsSync(dir)) return;
        fs.readdirSync(dir).forEach(file => {
            const filePath = path.join(dir, file);
            if (fs.statSync(filePath).isDirectory()) {
                allFilesSync(filePath);
            } else {
                const relPath = path.relative(SWAP_FOLDER, filePath).replace(/\\/g, '/');
                if (!relPath.startsWith('assets/media/') && !relPath.startsWith('assets/img/')) return;
                const cleanedKey = `://kirka.io/${relPath}`.replace(/\_/g, '');
                swapFiles[cleanedKey] = filePath.replace(/\\/g, '/');
            }
        });
    };

    allFilesSync(SWAP_FOLDER);

    session.defaultSession.webRequest.onBeforeRequest(
        { urls: ['*://kirka.io/*', '*://*.kirka.io/*'] },
        (details, callback) => {
            const cleanedUrl = details.url.replace(/https|http|(\?.*)|(\#.*)|\_/gi, '');
            const localFile  = swapFiles[cleanedUrl];
            if (localFile) {
                callback({ redirectURL: 'celeste://' + localFile });
            } else {
                callback({});
            }
        }
    );
};

module.exports = { initResourceSwapper, getSwapperFolder };
