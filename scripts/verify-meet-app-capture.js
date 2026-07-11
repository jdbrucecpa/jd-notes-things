'use strict';

// scripts/verify-meet-app-capture.js
// Usage: node scripts/verify-meet-app-capture.js <chrome-main-pid> [seconds]
//
// Empirically answers the open question in the Google Meet local-recording spec:
// does the precompiled application-loopback native module capture Chrome's whole
// PROCESS TREE (audio actually renders in a child utility/renderer process) when
// bound to Chrome's MAIN process PID, or only the single PID?
//
// HOW TO RUN
//   1. Open Chrome and play continuous audible audio in a tab (e.g. an unmuted
//      YouTube video, volume up). A live Meet call also works.
//   2. Find Chrome's MAIN process PID (the parent browser process, not a
//      renderer). In PowerShell the earliest-started chrome.exe is the parent:
//        Get-Process chrome | Sort-Object StartTime | Select-Object -First 1 Id, StartTime
//   3. node scripts/verify-meet-app-capture.js <that-pid> 8
//
// INTERPRETING RESULTS
//   NON-SILENT  -> tree capture WORKS. Meet gets the full app-isolation track
//                  against the main Chrome PID. No code change needed.
//   SILENT      -> single-PID capture only. The main Chrome PID renders no audio,
//                  so LocalProvider's existing system-submix fallback covers the
//                  app track. Add the CLAUDE.md limitation note (Task 3 Step 3).

const { startAudioCapture, stopAudioCapture } = require('application-loopback');

const pid = process.argv[2];
const seconds = Number(process.argv[3] || 8);
if (!pid) {
  console.error('Usage: node scripts/verify-meet-app-capture.js <chrome-main-pid> [seconds]');
  process.exit(1);
}

// application-loopback emits 48 kHz / 2ch / 16-bit signed PCM (format confirmed
// from upstream C++ in src/main/recording/AppLoopbackCapture.js) and emits
// NOTHING during silence (buffers below -70 dB are skipped by the native binary).
// So a total absence of bytes is itself the "silent" signal; when bytes DO
// arrive we compute RMS to confirm they carry real signal, not a faint tick.
let totalBytes = 0;
let sumSquares = 0;
let sampleCount = 0;
let peak = 0;

startAudioCapture(String(pid), {
  onData: (chunk) => {
    totalBytes += chunk.length;
    const buf = Buffer.from(chunk);
    for (let i = 0; i + 1 < buf.length; i += 2) {
      const s = buf.readInt16LE(i);
      sumSquares += s * s;
      sampleCount += 1;
      const a = Math.abs(s);
      if (a > peak) peak = a;
    }
  },
});

console.log(`Capturing pid=${pid} for ${seconds}s — make sure audio is PLAYING in a Chrome tab...`);

setTimeout(() => {
  try {
    stopAudioCapture(String(pid));
  } catch {
    /* already stopped */
  }
  const rms = sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : 0;
  const rmsDbfs = rms > 0 ? 20 * Math.log10(rms / 32768) : -Infinity;
  const peakDbfs = peak > 0 ? 20 * Math.log10(peak / 32768) : -Infinity;
  console.log('--- result ---');
  console.log(`bytes captured : ${totalBytes}`);
  console.log(`samples        : ${sampleCount}`);
  console.log(`RMS            : ${rms.toFixed(1)} (${rmsDbfs.toFixed(1)} dBFS)`);
  console.log(`peak           : ${peak} (${peakDbfs.toFixed(1)} dBFS)`);
  // -50 dBFS RMS is a generous noise floor: real playback sits well above it,
  // true silence (no bytes) sits at -Infinity.
  const NONSILENT_RMS_DBFS = -50;
  if (totalBytes > 0 && rmsDbfs > NONSILENT_RMS_DBFS) {
    console.log('\nVERDICT: NON-SILENT audio captured from the main Chrome PID.');
    console.log('=> Tree capture WORKS. Meet app-isolation track is viable. No code change needed.');
  } else {
    console.log('\nVERDICT: SILENT (no meaningful audio from the main Chrome PID).');
    console.log('=> Single-PID capture only. Meet app track falls back to the system submix');
    console.log('   (already handled in LocalProvider). Add the CLAUDE.md v2.0 limitation note.');
  }
  process.exit(0);
}, seconds * 1000);
