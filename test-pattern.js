// Test the AI-generated pattern
const regex = /^\|\s*\d{2}:\d{2}:\d{2}\s*\|\s*([^\|]+?)\s*\|\s*(.+?)\s*\|$/;

const testLines = [
  '| 00:00:05 | Alex M.    | Welcome, everyone. Let\'s use this session to finalize the rollout.    |',
  '| 00:00:18 | Priya      | Sounds good. I still have concerns about phase two of the launch.     |',
  '| 00:00:32 | A. Johnson | Same here; support doesn\'t have the new scripts ready yet.           |',
  '| 00:02:10 | System     | *Screen sharing started by Alex M.*                                   |',
];

console.log('Testing pattern:', regex.toString());
console.log('');

testLines.forEach((line, i) => {
  const match = regex.exec(line);
  console.log(`Line ${i + 1}: ${line}`);
  if (match) {
    console.log(`  ✓ MATCH - Speaker: "${match[1]}", Text: "${match[2]}"`);
  } else {
    console.log(`  ✗ NO MATCH`);
  }
  console.log('');
});
