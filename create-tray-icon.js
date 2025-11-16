/**
 * Simple script to create a basic tray icon
 * Run: node create-tray-icon.js
 */

const fs = require('fs');
const path = require('path');

// Minimal valid 16x16 PNG icon (solid blue/gray square for tray)
// This is a properly encoded minimal PNG
const base64Icon = `iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGklEQVR42mNgYGD4z0AEYBpVPqp8VPmo
8uEqBwAdAgH+Ax6DwgAAAABJRU5ErkJggg==`;

// Convert base64 to buffer
const iconBuffer = Buffer.from(base64Icon.replace(/\s/g, ''), 'base64');

// Write to file
const outputPath = path.join(__dirname, 'src', 'assets', 'tray-icon.png');
fs.writeFileSync(outputPath, iconBuffer);

console.log(`✓ Tray icon created at: ${outputPath}`);
console.log('  Size: 16x16 pixels');
console.log('  Format: PNG');
console.log('  Note: This is a simple placeholder. Replace with a custom icon for production.');
