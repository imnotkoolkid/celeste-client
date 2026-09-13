// @ts-check

const { fileURLToPath } = require("node:url");
const { benchmark } = require("../fileParse.js");

/**
 * @typedef {import("../fileParse.js").MockRequest} MockRequest
 */

/**
 * @param {MockRequest} request
 * @returns {string}
 */
function nodeFileURLToPath(request) {
    let p = fileURLToPath(request.url);
    if (p.startsWith('/')) p = p.slice(1);
    return p;
}

benchmark(nodeFileURLToPath);
