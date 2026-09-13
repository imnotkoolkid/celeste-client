// @ts-check

const { benchmark } = require("../fileParse.js");

/**
 * @typedef {import("../fileParse.js").MockRequest} MockRequest
 */

/**
 * @param {MockRequest} request
 * @returns {string}
 */
function stringSlice(request) {
    const filePrefix = 'file:///';
    let p = request.url.slice(filePrefix.length);
    if (process.platform === 'win32' && p.startsWith('/')) p = p.slice(1);
    return decodeURIComponent(p);
}

benchmark(stringSlice);
