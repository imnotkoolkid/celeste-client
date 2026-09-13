// @ts-check

const { benchmark } = require("../assetsPrefix.js");

/**
 * @param {string} relPath
 * @returns {boolean}
 */

function regexMatch(relPath) {
    return !/^assets\/(?:media|img)\//.test(relPath);
}

benchmark(regexMatch);
