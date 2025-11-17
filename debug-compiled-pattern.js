const fs = require('fs');
const path = require('path');

// Import the actual PatternConfigLoader
const PatternConfigLoader = require('./src/main/import/PatternConfigLoader');

async function test() {
  console.log('Loading config via PatternConfigLoader...');
  const config = await PatternConfigLoader.loadConfig();

  console.log('Getting enabled patterns...');
  const patterns = await PatternConfigLoader.getEnabledPatterns();

  const pipePattern = patterns.find(p => p.id === 'pipe-table-timestamp');
  console.log('\\nPipe table pattern:', pipePattern);
  console.log('\\nCompiled regex:', pipePattern.compiledRegex);
  console.log('Regex source:', pipePattern.compiledRegex.source);
  console.log('Regex flags:', pipePattern.compiledRegex.flags);

  // Test the compiled regex
  const testLine = "| 00:00:05 | Alex M.    | Welcome, everyone. Let's use this session to finalize the rollout.    |";
  console.log('\\nTest line:', testLine);

  const match = pipePattern.compiledRegex.exec(testLine);
  if (match) {
    console.log('✓ MATCH!');
    console.log('  Speaker (group 1):', match[1]);
    console.log('  Text (group 2):', match[2]);
  } else {
    console.log('✗ NO MATCH');
  }

  // Also test inline patterns to see priority order
  console.log('\\n\\nAll inline patterns in order:');
  const inlinePatterns = patterns.filter(p => p.type === 'inline');
  inlinePatterns.forEach((p, i) => {
    console.log(`${i + 1}. [Priority ${p.priority}] ${p.id}`);
  });
}

test().catch(console.error);
