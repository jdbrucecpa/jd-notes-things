const TranscriptParser = require('./src/main/import/TranscriptParser');
const parser = new TranscriptParser();

async function test() {
  console.log('Testing Krisp transcript format...\n');

  try {
    const result = await parser.parseFile('./test-transcripts/krisp-transcript.txt');

    console.log('Format:', result.format);
    console.log('Total entries:', result.entries.length);
    console.log('Has speakers:', result.hasSpeakers);
    console.log('Has timestamps:', result.hasTimestamps);

    const speakers = parser.getSpeakers(result);
    console.log('\nUnique speakers found:');
    speakers.forEach(speaker => {
      const count = result.entries.filter(e => e.speaker === speaker).length;
      console.log(`  - ${speaker}: ${count} entries`);
    });

    console.log('\nFirst 10 entries:');
    result.entries.slice(0, 10).forEach((entry, i) => {
      const timestamp = entry.timestamp ? `[${entry.timestamp}s]` : '';
      console.log(`  ${i + 1}. ${entry.speaker}${timestamp}: ${entry.text.substring(0, 50)}...`);
    });

    // Check for issues
    const unknownCount = result.entries.filter(e => e.speaker === 'Unknown').length;
    if (unknownCount > 0) {
      console.log(`\n⚠️  Warning: ${unknownCount} entries with "Unknown" speaker`);
    }

    console.log('\n✅ Test completed!');

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

test();
