// @ts-check

const { benchmark, app } = require("../assetsPath.js");
const path = require("path");

const swapperFolder = path.join(app.getPath('documents'), 'CelesteClient', 'swapper', 'assets');

/**
 * @returns {string}
 */
const eager = () => swapperFolder;

benchmark(eager);
