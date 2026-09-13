// @ts-check

const { benchmark } = require("../httpParse.js");

/**
 * @typedef {import("../httpParse.js").MockDetails} MockDetails
 */

/**
 * @param {MockDetails} details
 * @returns {string}
 */
function singlePassConcat(details) {
    // Start loop after the http/https prefix.
    const prefixLength = details.url.startsWith('https') ? 5 : 4;
    let cleanedUrl = '';
    for (let i = prefixLength; i < details.url.length; i++) {
        const c = details.url[i];
        if (c === '_') continue;
        if (c === '?' || c === '#') break;
        cleanedUrl += c;
    }
    return cleanedUrl;
}

benchmark(singlePassConcat);
