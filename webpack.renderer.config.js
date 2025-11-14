const rules = require('./webpack.rules');
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');

rules.push({
  test: /\.css$/,
  use: [{ loader: 'style-loader' }, { loader: 'css-loader' }],
});

// Add rule for Monaco Editor TTF files
rules.push({
  test: /\.ttf$/,
  type: 'asset/resource',
});

module.exports = {
  // Put your normal webpack config below here
  module: {
    rules,
  },
  entry: {
    renderer: './src/renderer.js',
    'note-editor/renderer': './src/pages/note-editor/renderer.js',
  },
  plugins: [
    new MonacoWebpackPlugin({
      // Available languages: https://github.com/microsoft/monaco-editor/tree/main/src/basic-languages
      languages: ['yaml', 'json', 'markdown', 'plaintext'],
      features: ['coreCommands', 'find'],
    }),
  ],
};
