// @ts-check

const { benchmark } = require("../drivePrefix.js");

const A = 'A'.charCodeAt(0);
const Z = 'Z'.charCodeAt(0);
const a = 'a'.charCodeAt(0);
const z = 'z'.charCodeAt(0);

/**
 * @param {string} p
 * @returns {boolean}
 */
function charCodeAt(p) {
    const c = p.charCodeAt(0);
    return ((A <= c && c <= Z) || (a <= c && c <= z)) && p[1] === '/';
}

benchmark(charCodeAt);
