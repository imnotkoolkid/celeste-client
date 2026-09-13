// @ts-check

const { benchmark } = require("../httpParse.js");

/**
 * @typedef {import("../httpParse.js").MockDetails} MockDetails
 */

/**
 * @param {MockDetails} details
 * @returns {string}
 */
function singlePassSlice(details) {
    // Start loop after the http/https prefix.
    const prefixLength = details.url.startsWith('https') ? 5 : 4;
    let cleanedUrl = '';
    let start = prefixLength;
    for (let i = prefixLength; i < details.url.length; i++) {
        const c = details.url[i];
        if (c === '_') {
            cleanedUrl += details.url.slice(start, i);
            start = i + 1;
            continue;
        }
        if (c === '?' || c === '#') {
            return cleanedUrl + details.url.slice(start, i);
        }
    }
    // Append the remaining portion after the last underscore.
    return cleanedUrl + details.url.slice(start);
}

benchmark(singlePassSlice);
