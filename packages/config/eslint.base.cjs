/* Shared ESLint base. App-specific configs compose on top of this. */
/** @type {import('eslint').Linter.Config} */
module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'import', 'simple-import-sort'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  settings: {
    'import/resolver': {
      typescript: {
        project: ['./tsconfig.json'],
      },
      node: true,
    },
  },
  rules: {
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'no-debugger': 'error',
    'eqeqeq': ['error', 'always', { null: 'ignore' }],
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/consistent-type-imports': [
      'warn',
      { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
    ],
    'import/order': 'off',
    'simple-import-sort/imports': [
      'warn',
      {
        groups: [
          ['^node:'],
          ['^@?\\w'],
          ['^@ecc/'],
          ['^@/'],
          ['^\\.\\.(/|$)'],
          ['^\\.(/|$)'],
          ['^\\u0000'],
        ],
      },
    ],
    'import/first': 'error',
    'import/newline-after-import': 'warn',
    'import/no-duplicates': 'error',
  },
  ignorePatterns: ['dist', 'build', '.next', '.expo', '.turbo', 'node_modules', 'coverage'],
};

