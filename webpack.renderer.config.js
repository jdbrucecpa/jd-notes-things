const rules = require('./webpack.rules');
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const path = require('path');

rules.push({
  test: /\.css$/,
  use: [{ loader: 'style-loader' }, { loader: 'css-loader' }],
});

// Add rule for Monaco Editor TTF files
rules.push({
  test: /\.ttf$/,
  type: 'asset/resource',
});

// Add rule for image files
rules.push({
  test: /\.(png|jpg|jpeg|gif|svg)$/,
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
      // Include colorization features for proper syntax highlighting
      features: ['coreCommands', 'find', 'colorPicker', 'bracketMatching', 'wordHighlighter', 'folding'],
    }),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: path.resolve(__dirname, 'src', 'assets'),
          to: path.resolve(__dirname, '.webpack', 'renderer', 'assets'),
        },
      ],
    }),
  ],
};
