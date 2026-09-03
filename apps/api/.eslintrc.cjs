/* Legacy ESLint config. */
const base = require('@ecc/config/eslint.node.cjs');

module.exports = {
  ...base,
  ignorePatterns: ['dist', 'node_modules', '*.tsbuildinfo', 'coverage'],
};
