// Downloads a pinned uv.exe into vendor/uv/ for bundling as an Electron
// extra resource. Idempotent: skips when the pinned version is present.
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

const UV_VERSION = '0.12.5'; // pinned in Step 1
const DIR = path.resolve('vendor/uv');
const EXE = path.join(DIR, 'uv.exe');
const STAMP = path.join(DIR, 'VERSION');
const URL = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-x86_64-pc-windows-msvc.zip`;

if (existsSync(EXE) && existsSync(STAMP) && readFileSync(STAMP, 'utf8').trim() === UV_VERSION) {
  console.log(`uv ${UV_VERSION} already present`);
  process.exit(0);
}
mkdirSync(DIR, { recursive: true });
const res = await fetch(URL, { redirect: 'follow' });
if (!res.ok) throw new Error(`uv download failed: ${res.status} ${URL}`);
const zipPath = path.join(DIR, 'uv.zip');
await pipeline(res.body, createWriteStream(zipPath));
// Extract with PowerShell (no unzip dep on Windows)
const { execSync } = await import('node:child_process');
execSync(`powershell -NoProfile -Command "Expand-Archive -Force '${zipPath}' '${DIR}'"`);
writeFileSync(STAMP, UV_VERSION);
console.log(`Fetched uv ${UV_VERSION} -> ${EXE}`);
