/**
 * Usage: node --test --test-isolation=process ./test/perf/httpParse/*.js
 *
 * Benchmark different approaches to cleaning URLs.
 *
 * Benchmarks on Void Linux 6.18.48_1, Node.js v26.5.0
 *   baseline             ~170 ms *
 *   nodeURL              ~600 ms
 *   singlePassConcat     ~345 ms
 *   singlePassSlice      ~200 ms
 *   singlePassSubstring  ~190 ms
 */

/**
 * IMPORTANT: The alternative implementations do not handle case-sensitivity
 * like the original implementation. However, Electron is unlikely to use
 * capital letters in the `details.url` protocol.
 */

// @ts-check

const { createBenchmark } = require("./benchmark.js");

/**
 * @typedef {{ url: string }} MockDetails
 */

/**
 * Original implementation from src/components/swapper.js to compare against.
 * @param {MockDetails} details
 * @returns {string}
 */
function baseline(details) {
    const cleanedUrl = details.url.replace(/https|http|(\?.*)|(\#.*)|\_/gi, '');
    return cleanedUrl;
}

/** @type {[MockDetails][]} */
const cases = [
    [{ url: "http://www.example.com/assets/media/sound.mp4" }],
    [{ url: "https://api.example.com/assets/img/texture.png" }],
    [{ url: "https://example.com/assets/media/__sound__" }],
    [{ url: "http://example.io/assets/img/__texture__.webp?v=123" }],
    [{ url: "https://example.io/assets/img/Texture.123.png#foo_bar" }],
    [{ url: "https://example.io/assets/media/Foo_Bar?v=123#fragment" }],
];

const iterations = 1_000_000;

const benchmark = createBenchmark(baseline, cases, iterations);

module.exports = { benchmark, baseline };
