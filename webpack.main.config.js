const CopyWebpackPlugin = require('copy-webpack-plugin');
const path = require('path');

module.exports = {
  /**
   * This is the main entry point for your application, it's the first file
   * that runs in the main process.
   */
  entry: './src/main.js',
  // Put your normal webpack config below here
  module: {
    rules: require('./webpack.rules'),
  },
  externals: {
    '@recallai/desktop-sdk': 'commonjs @recallai/desktop-sdk',
    'better-sqlite3': 'commonjs better-sqlite3',
    // keytar kept as external to suppress webpack warning from optional migration require
    keytar: 'commonjs keytar',
    // Optional dependency for unzipper S3 support - not used
    '@aws-sdk/client-s3': 'commonjs @aws-sdk/client-s3',
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        {
          from: path.resolve(__dirname, 'src', 'assets'),
          to: path.resolve(__dirname, '.webpack', 'main', 'assets'),
        },
      ],
    }),
  ],
};
