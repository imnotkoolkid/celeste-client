// @ts-check

const assert = require("node:assert/strict");
const test = require("node:test");

/**
 * @template {unknown[]} T
 * @template R
 * @param {(...args: T) => R} baseline
 * @param {T[]} cases
 * @param {number} iterations
 * @returns {(fn: (...args: T) => R) => void}
 */
function createBenchmark(baseline, cases, iterations) {
    /**
     * @param {(...args: T) => R} fn
     * @returns {void}
     * @throws {AssertionError}
     */
    function validate(fn) {
        for (const args of cases) {
            const actual = fn(...args);
            const expected = baseline(...args);
            assert.strictEqual(actual, expected);
        }
    }

    /**
     * @param {(...args: T) => R} fn
     * @returns {void}
     */
    return function (fn) {
        test(fn.name, () => {
            validate(fn);

            const start = performance.mark(fn.name);
            for (let i = 0; i < iterations; ++i) {
                const args = cases[i % cases.length] ?? [];
                fn(...args);
            }
            const measure = performance.measure(fn.name, start);

            console.log(measure);
        });
    }
}

module.exports = { createBenchmark };
