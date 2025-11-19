const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
const fs = require('fs-extra');
const path = require('path');

module.exports = {
  packagerConfig: {
    executableName: 'JDNotesThings',
    asar: {
      unpack: '**/{@recallai,@sindresorhus,@szmarczak,@types,buffer-crc32,cacheable-lookup,cacheable-request,clone-response,debug,decompress-response,defer-to-connect,end-of-stream,extract-zip,fd-slicer,get-stream,got,hpagent,http-cache-semantics,http2-wrapper,json-buffer,keytar,keyv,lodash.clonedeep,lowercase-keys,mimic-response,ms,ngrok,normalize-url,once,p-cancelable,pend,pump,quick-lru,resolve-alpn,responselike,undici-types,uuid,wrappy,yaml,yauzl}/**',
    },
    afterCopy: [(buildPath, electronVersion, platform, arch, callback) => {
      // Manually copy ngrok and its dependencies to node_modules (will be unpacked)
      // Complete dependency tree for ngrok (recursively resolved)
      const modulesToCopy = [
        '@sindresorhus/is',
        '@szmarczak/http-timer',
        '@types/cacheable-request',
        '@types/http-cache-semantics',
        '@types/keyv',
        '@types/node',
        '@types/responselike',
        '@types/yauzl',
        'buffer-crc32',
        'cacheable-lookup',
        'cacheable-request',
        'clone-response',
        'debug',
        'decompress-response',
        'defer-to-connect',
        'end-of-stream',
        'extract-zip',
        'fd-slicer',
        'get-stream',
        'got',
        'hpagent',
        'http-cache-semantics',
        'http2-wrapper',
        'json-buffer',
        'keytar',
        'keyv',
        'lodash.clonedeep',
        'lowercase-keys',
        'mimic-response',
        'ms',
        'ngrok',
        'normalize-url',
        'once',
        'p-cancelable',
        'pend',
        'pump',
        'quick-lru',
        'resolve-alpn',
        'responselike',
        'undici-types',
        'uuid',
        'wrappy',
        'yaml',
        'yauzl'
      ];

      console.log('[Build] Copying ngrok and dependencies...');

      const copyPromises = modulesToCopy.map(moduleName => {
        const source = path.join(__dirname, 'node_modules', moduleName);
        const dest = path.join(buildPath, 'node_modules', moduleName);

        // Check if module exists before copying
        if (fs.existsSync(source)) {
          console.log(`[Build] Copying ${moduleName}...`);
          return fs.copy(source, dest, { overwrite: true });
        } else {
          console.log(`[Build] Skipping ${moduleName} (not found)`);
          return Promise.resolve();
        }
      });

      Promise.all(copyPromises)
        .then(() => {
          console.log('[Build] All modules copied successfully');
          callback();
        })
        .catch(err => {
          console.error('[Build] Failed to copy modules:', err);
          callback(err);
        });
    }],
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
  rebuildConfig: {},
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
          ],
        },
      },
    },
    {
      name: '@timfish/forge-externals-plugin',
      config: {
        externals: ['@recallai/desktop-sdk'],
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
