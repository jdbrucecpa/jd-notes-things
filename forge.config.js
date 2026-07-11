const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
// Bundle ffmpeg with the app so recording/enumeration never depends on a
// system ffmpeg being on PATH. This path is copied into resources/ at package
// time and resolved at runtime via process.resourcesPath (see ffmpegPath.js).
const ffmpegStatic = require('ffmpeg-static');

module.exports = {
  packagerConfig: {
    executableName: 'JDNotesThings',
    asar: {
      unpack: '**/{@recallai,better-sqlite3}/**',
    },
    extraResource: ['./config', ffmpegStatic].filter(Boolean),
    osxSign: {
      continueOnError: false,
      optionsForFile: _ => {
        // Here, we keep it simple and return a single entitlements.plist file.
        // You can use this callback to map different sets of entitlements
        // to specific files in your packaged app.
        return {
          entitlements: './Entitlements.plist',
        };
      },
    },
    icon: './src/assets/jd-notes-things',
    extendInfo: {
      NSUserNotificationAlertStyle: 'alert',
    },
  },
  // Only better-sqlite3 needs an Electron-ABI native rebuild. native-recorder-nodejs
  // ships an ABI-stable N-API prebuild that loads under Electron as-is, and its
  // cmake-js source build is broken upstream (fails to link node.lib), so it must
  // NOT be rebuilt here. Restrict the rebuild to better-sqlite3 to avoid touching it.
  rebuildConfig: { onlyModules: ['better-sqlite3'] },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'JDNotesThings',
        authors: 'JD Knows Things',
        description: 'AI Meeting Notetaker for Zoom, Teams, and Google Meet',
        exe: 'JDNotesThings.exe',
      },
    },
    {
      name: '@electron-forge/maker-dmg',
    },
    // {
    //   name: '@electron-forge/maker-zip',
    //   platforms: ['darwin'],
    // },
    // {
    //   name: '@electron-forge/maker-deb',
    //   config: {},
    // },
    // {
    //   name: '@electron-forge/maker-rpm',
    //   config: {},
    // },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    {
      name: '@electron-forge/plugin-webpack',
      config: {
        devContentSecurityPolicy:
          "default-src * 'unsafe-inline' 'unsafe-eval' data: blob: filesystem: mediastream: file:;",
        mainConfig: './webpack.main.config.js',
        renderer: {
          config: './webpack.renderer.config.js',
          entryPoints: [
            {
              html: './src/index.html',
              js: './src/renderer.js',
              name: 'main_window',
              preload: {
                js: './src/preload.js',
              },
            },
            {
              html: './src/widget.html',
              js: './src/widget.js',
              name: 'recording_widget',
              preload: {
                js: './src/widgetPreload.js',
              },
            },
            {
              html: './src/stopConfirm.html',
              js: './src/stopConfirm.js',
              name: 'stop_confirm',
              preload: {
                js: './src/stopConfirmPreload.js',
              },
            },
          ],
        },
      },
    },
    {
      name: '@timfish/forge-externals-plugin',
      config: {
        externals: [
          '@recallai/desktop-sdk',
          'better-sqlite3',
          'application-loopback',
          'native-recorder-nodejs',
        ],
        includeDeps: true,
      },
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
