/* ESLint config for the Expo / React Native mobile app. */
const base = require('./eslint.base.cjs');

module.exports = {
  ...base,
  env: { ...(base.env ?? {}), es2022: true },
};
