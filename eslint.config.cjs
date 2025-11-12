// ESLint flat config for ESLint 9+ (CommonJS format)
const js = require('@eslint/js');
const globals = require('globals');
const reactPlugin = require('eslint-plugin-react');
const prettier = require('eslint-config-prettier');

module.exports = [
  // Ignore patterns
  {
    ignores: [
      'node_modules/**',
      '.webpack/**',
      'out/**',
      'dist/**',
      'vault/**',
    ],
  },
  // Base recommended rules
  js.configs.recommended,
  // Main configuration
  {
    files: ['**/*.js', '**/*.jsx'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
      },
    },
    plugins: {
      react: reactPlugin,
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'warn',
    },
  },
  // Main process specific config
  {
    files: ['src/main.js', 'src/main/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        // Webpack DefinePlugin globals injected by Electron Forge
        MAIN_WINDOW_WEBPACK_ENTRY: 'readonly',
        MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: 'readonly',
      },
    },
  },
  // Disable conflicting Prettier rules
  prettier,
];
