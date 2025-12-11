import resolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

export default {
  input: "src/plugin.ts",
  output: {
    file: "com.jdnotes.recording.sdPlugin/bin/plugin.js",
    format: "es",
    sourcemap: true,
  },
  plugins: [
    resolve({
      exportConditions: ["node"],
    }),
    typescript({
      tsconfig: "./tsconfig.json",
    }),
  ],
  external: [
    // Node.js built-ins
    "events",
    "https",
    "http",
    "path",
    "os",
    "fs",
    "url",
    "util",
    "stream",
    "buffer",
    "crypto",
    "net",
    "tls",
    "zlib",
  ],
};
