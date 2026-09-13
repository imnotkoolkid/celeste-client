/**
 * Usage: node --test --test-isolation=process ./test/perf/drivePrefix/*.js
 *
 * Benchmarks on Void Linux 6.18.48_1, Node.js v26.5.0
 *   baseline         ~75 ms
 *   baselineReverse  ~75 ms
 *   charCodeAt       ~50 ms
 *   charComp         ~50 ms
 */

/**
 * IMPORTANT: While character comparison is technically faster, the baseline
 * approach is already performant, making the optimization negligible.
 */

// @ts-check

const { createBenchmark } = require("./benchmark.js");

/**
 * Original implementation from src/components/swapper.js to compare against.
 * @param {string} p
 * @returns {boolean}
 */
function baseline(p) {
    return /^[a-zA-Z]\//.test(p);
}

/** @type {[string][]} */
const cases = [
    ["C/Users/Username/Documents/example/file.txt"],
    ["D/Users/Username/Documents/example/file.txt"],
    ["1/Users/Username/Documents/example/file.txt"],
    ["2:/Users/Username/Documents/example/file.txt"],
    ["E:/Users/Username/Documents/example/file.txt"],
    ["Bad/Users/Username/Documents/example/file.txt"],
];

const iterations = 1_000_000;

const benchmark = createBenchmark(baseline, cases, iterations);

module.exports = { benchmark, baseline };
