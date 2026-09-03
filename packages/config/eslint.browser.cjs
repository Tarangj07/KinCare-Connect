/* ESLint config for the Next.js web app. */
const base = require('./eslint.base.cjs');

module.exports = {
  ...base,
  env: { ...(base.env ?? {}), browser: true, es2022: true },
};
