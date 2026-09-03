/* Legacy ESLint config. */
const base = require('@ecc/config/eslint.react.cjs');

module.exports = {
  ...base,
  ignorePatterns: ['.expo', 'android', 'ios', 'dist', 'node_modules', '*.tsbuildinfo'],
};
