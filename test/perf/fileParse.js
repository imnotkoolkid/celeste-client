/**
 * Usage: node --test --test-isolation=process ./test/perf/fileParse/*.js
 *
 * Benchmark different approaches to converting file URLs into file paths.
 *
 * Benchmarks on Void Linux 6.18.48_1, Node.js v26.5.0
 *   baseline           ~355 ms
 *   nodeFileURLToPath  ~890 ms
 *   stringSlice        ~290 ms *
 */

// @ts-check

const { createBenchmark } = require("./benchmark.js");

/**
 * @typedef {{ url: string }} MockRequest
 */

/**
 * Original implementation from src/components/swapper.js to compare against.
 * @param {MockRequest} request
 * @returns {string}
 */
function baseline(request) {
    let p = request.url.replace(/^file:\/\/\//i, '');
    if (process.platform === 'win32' && p.startsWith('/')) p = p.slice(1);
    return decodeURIComponent(p);
}

// NOTE: These paths are safe to test on any platform because the
// implementations only parse URL strings. They do not access the filesystem
// or verify that the resulting paths exist.
/** @type {[MockRequest][]} */
const cases = [
    [{ url: "file:///C:/Documents/project/assets/img/image.png" }],
    [{ url: "file:///C:/Documents/project/assets/img/My%20File.webp" }],
    [{ url: "file:///C:/Documents/project/assets/img/Test.jpg" }],
    [{ url: "file:///home/user/Documents/project/assets/img/image.png" }],
    [{ url: "file:///home/user/Documents/project/assets/img/My%20File.webp" }],
    [{ url: "file:///home/user/Documents/project/assets/img/Test.jpg" }],
];

const iterations = 1_000_000;

const benchmark = createBenchmark(baseline, cases, iterations);

module.exports = { benchmark, baseline };
