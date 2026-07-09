'use strict';

// scripts/probe-app-loopback.js — run: node scripts/probe-app-loopback.js <pid>
//
// Play continuous audio in the target app first (e.g. a YouTube tab PID or a
// Zoom test call), then run this against that PID. Confirms the bytes/sec
// rate matches the format documented in src/main/recording/AppLoopbackCapture.js
// (48000 Hz / 2ch / 16-bit PCM → 192000 B/s), which was determined from the
// upstream C++ source rather than guessed.
const { startAudioCapture, stopAudioCapture } = require('application-loopback');

const pid = process.argv[2];
if (!pid) {
  console.error('Usage: node scripts/probe-app-loopback.js <pid>');
  process.exit(1);
}

let bytes = 0;
const start = Date.now();
startAudioCapture(String(pid), {
  onData: (c) => {
    bytes += c.length;
  },
});

setTimeout(() => {
  stopAudioCapture(String(pid));
  const secs = (Date.now() - start) / 1000;
  const rate = bytes / secs;
  console.log(`bytes/sec ≈ ${Math.round(rate)}`);
  console.log('Candidates: 192000=48k/2ch/16-bit int (expected), 384000=48k/2ch/float32, 176400=44.1k/2ch/16-bit int');
}, 5000);
