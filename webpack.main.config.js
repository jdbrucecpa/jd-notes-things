const CopyWebpackPlugin = require('copy-webpack-plugin');
const webpack = require('webpack');
const path = require('path');

// When MOCK_SDK is set, swap the real Recall.ai SDK for the test double.
// This uses NormalModuleReplacementPlugin so main.js doesn't need any
// conditional logic — webpack handles the swap at build time.
const isMockSdk = !!process.env.MOCK_SDK;

const externals = {
  'better-sqlite3': 'commonjs better-sqlite3',
  // keytar kept as external to suppress webpack warning from optional migration require
  keytar: 'commonjs keytar',
  // Optional dependency for unzipper S3 support - not used
  '@aws-sdk/client-s3': 'commonjs @aws-sdk/client-s3',
  // Native N-API module for WASAPI loopback audio capture (v2.0 mixer)
  'native-recorder-nodejs': 'commonjs native-recorder-nodejs',
};

// Only externalize the real SDK when NOT in mock mode.
// In mock mode, the MockRecallSdk gets bundled directly.
if (!isMockSdk) {
  externals['@recallai/desktop-sdk'] = 'commonjs @recallai/desktop-sdk';
}

const plugins = [
  new CopyWebpackPlugin({
    patterns: [
      {
        from: path.resolve(__dirname, 'src', 'assets'),
        to: path.resolve(__dirname, '.webpack', 'main', 'assets'),
      },
    ],
  }),
  // Expose MOCK_SDK to runtime code for conditional logic (e.g. mock API tokens)
  new webpack.DefinePlugin({
    'process.env.MOCK_SDK': JSON.stringify(process.env.MOCK_SDK || ''),
    'process.env.MOCK_SCENARIO': JSON.stringify(process.env.MOCK_SCENARIO || ''),
    'process.env.MOCK_SPEED': JSON.stringify(process.env.MOCK_SPEED || ''),
    'process.env.MOCK_AUTO_RECORD': JSON.stringify(process.env.MOCK_AUTO_RECORD || ''),
    'process.env.MOCK_SKIP_AUDIO': JSON.stringify(process.env.MOCK_SKIP_AUDIO || ''),
  }),
];

// In mock mode, replace @recallai/desktop-sdk with MockRecallSdk at build time
if (isMockSdk) {
  plugins.push(
    new webpack.NormalModuleReplacementPlugin(
      /@recallai\/desktop-sdk/,
      path.resolve(__dirname, 'tests', 'mocks', 'MockRecallSdk.js')
    )
  );
  console.log('[Webpack] MOCK_SDK enabled — replacing @recallai/desktop-sdk with MockRecallSdk');
}

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
  externals,
  plugins,
};
