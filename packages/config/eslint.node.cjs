/* ESLint config for Node / NestJS apps. */
const base = require('./eslint.base.cjs');

module.exports = {
  ...base,
  env: { ...(base.env ?? {}), node: true, es2022: true },
  rules: {
    ...(base.rules ?? {}),
    'no-process-exit': 'error',
  },
};
