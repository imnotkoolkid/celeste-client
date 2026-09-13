/**
 * Usage: node --test --test-isolation=process ./test/perf/assetsPrefix/*.js
 *
 * Benchmarks on Void Linux 6.18.48_1, Node.js v26.5.0
 *   baseline    ~80 ms
 *   regexMatch  ~75 ms
 */

/**
 * IMPORTANT: While regexMatch is technically faster, the baseline approach is
 * already trivial and performant, making the optimization negligible.
 */

// @ts-check

const { createBenchmark } = require("./benchmark.js");

/**
 * Original implementation from src/components/swapper.js to compare against.
 * @param {string} relPath
 * @returns {boolean}
 */
function baseline(relPath) {
    return !relPath.startsWith('assets/media/') && !relPath.startsWith('assets/img/');
}

/** @type {[string][]} */
const cases = [
    ["assets/media/sound.wav"],
    ["assets/media/ambient"],
    ["assets/bad/path.jpg"],
    ["assets/img/texture.png"],
    ["assets/img/thumbnail"],
    ["foo/bar/baz"],
];

const iterations = 1_000_000;

const benchmark = createBenchmark(baseline, cases, iterations);

module.exports = { benchmark, baseline };
