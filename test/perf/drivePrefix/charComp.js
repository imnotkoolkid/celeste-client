// @ts-check

const { benchmark } = require("../drivePrefix.js");

/**
 * @param {string} p
 * @returns {boolean}
 */
function charComp(p) {
    const c = p[0];
    return (('A' <= c && c <= 'Z') || ('a' <= c && c <= 'z')) && p[1] === '/';
}

benchmark(charComp);
