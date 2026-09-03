/* Legacy ESLint config. */
const base = require('@ecc/config/eslint.react.cjs');

module.exports = {
  ...base,
  ignorePatterns: ['dist', 'node_modules', '*.tsbuildinfo'],
};
