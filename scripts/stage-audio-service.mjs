// Stages the shippable subset of audio-service/ into vendor/stage/ for
// forge's extraResource (which copies directories wholesale).
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const stage = path.resolve('vendor/stage/audio-service');
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync('audio-service/src', path.join(stage, 'src'), {
  recursive: true,
  filter: src => !src.includes('__pycache__'),
});
for (const f of ['pyproject.toml', 'uv.lock', '.python-version']) {
  cpSync(path.join('audio-service', f), path.join(stage, f));
}
console.log(`Staged audio-service -> ${stage}`);
