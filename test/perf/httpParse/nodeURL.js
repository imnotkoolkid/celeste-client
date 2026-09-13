// @ts-check

const { benchmark } = require("../httpParse.js");

/**
 * @typedef {import("../httpParse.js").MockDetails} MockDetails
 */

/**
 * @param {MockDetails} details
 * @returns {string}
 */
function nodeURL(details) {
    const url = new URL(details.url);
    const cleanedUrl = `://${url.host}${url.pathname.replaceAll('_', '')}`;
    return cleanedUrl;
}

benchmark(nodeURL);
