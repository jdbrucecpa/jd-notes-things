const yaml = require('yaml');
const fs = require('fs');
const path = require('path');

// Load the actual config
const configPath = path.join(process.env.APPDATA, 'jd-notes-things', 'config', 'transcript-patterns.yaml');
const yamlContent = fs.readFileSync(configPath, 'utf8');
const config = yaml.parse(yamlContent);

// Find the pipe-table pattern
const pattern = config.patterns.find(p => p.id === 'pipe-table-timestamp');
console.log('Pattern found:', pattern);
console.log('');

// Test with exact sample lines
const testLines = [
  '# Meeting Transcript',
  '',
  '| Time     | Who        | Text                                                                  |',
  '|----------|------------|-----------------------------------------------------------------------|',
  '| 00:00:05 | Alex M.    | Welcome, everyone. Let\'s use this session to finalize the rollout.    |',
  '| 00:00:18 | Priya      | Sounds good. I still have concerns about phase two of the launch.     |',
];

console.log('Testing regex:', pattern.regex);
console.log('');

const regex = new RegExp(pattern.regex);

testLines.forEach((line, i) => {
  const match = regex.exec(line);
  console.log(`Line ${i + 1}: "${line}"`);
  if (match) {
    console.log(`  ✓ MATCH - Speaker: "${match[1]}", Text: "${match[2]}"`);
  } else {
    console.log(`  ✗ NO MATCH`);
  }
  console.log('');
});
