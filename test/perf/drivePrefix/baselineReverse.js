// @ts-check

const { benchmark } = require("../drivePrefix.js");

/**
 * @param {string} p
 * @returns {boolean}
 */
function baselineReverse(p) {
    return /^[A-Za-z]\//.test(p);
}

benchmark(baselineReverse);
