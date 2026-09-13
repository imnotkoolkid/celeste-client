/**
 * Usage: node --test --test-isolation=process ./test/perf/assetsPath/*.js
 *
 * Benchmark different approaches to constructing the assets path.
 *
 * Benchmarks on Void Linux 6.18.48_1, Node.js v26.5.0
 *   baseline  ~550 ms
 *   eager     ~75  ms *
 */

// @ts-check

const { createBenchmark } = require("./benchmark.js");
const path = require("path");

// Mock the application documents path.
const app = {
    /**
     * @param {string} name
     * @returns {string}
     */
    getPath: function (name) {
        if (name === "documents") {
            return "C:\\Users\\Username\\Documents";
        }

        throw new Error(`Unexpected path: ${name}`);
    },
};

/**
 * Original implementation from src/components/swapper.js to compare against.
 * @returns {string}
 */
const baseline = () =>
    path.join(app.getPath('documents'), 'CelesteClient', 'swapper', 'assets');

const cases = [];

const iterations = 1_000_000;

const benchmark = createBenchmark(baseline, cases, iterations);

module.exports = { benchmark, baseline, app };
