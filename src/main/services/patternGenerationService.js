/**
 * Pattern Generation Service - Phase 10.8.3
 * AI-assisted pattern generation from sample transcripts
 *
 * Uses LLM to analyze transcript samples and generate regex patterns + YAML config
 */

const yaml = require('yaml');
const logger = require('../../shared/logger').scope('PatternGeneration');

class PatternGenerationService {
  constructor(llmService) {
    this.llmService = llmService;
  }

  /**
   * Generate a transcript pattern from a sample
   * @param {string} sampleText - Sample transcript (5-10 lines minimum)
   * @param {Object} previousAttempt - Optional previous failed attempt with pattern and test results
   * @returns {Promise<{pattern: Object, yaml: string, cost: number}>}
   */
  async generatePatternFromSample(sampleText, previousAttempt = null) {
    logger.info('Generating pattern from sample...');

    if (!sampleText || sampleText.trim().length < 20) {
      throw new Error('Sample text must be at least 20 characters');
    }

    const lines = sampleText.trim().split('\n').filter(l => l.trim());
    if (lines.length < 3) {
      throw new Error('Sample must contain at least 3 lines');
    }

    try {
      // Generate pattern using LLM
      const systemPrompt = this._buildSystemPrompt();
      const userPrompt = this._buildUserPrompt(sampleText, previousAttempt);

      const result = await this.llmService.generateCompletion({
        systemPrompt,
        userPrompt,
        maxTokens: 1000,
        temperature: 0.3, // Lower temperature for more deterministic regex generation
      });

      logger.info('LLM generation complete');

      // Extract YAML from response
      const yamlContent = this._extractYaml(result.content);

      // Parse and validate YAML (handle multiple documents)
      let pattern;
      try {
        // Try parsing as single document first
        pattern = yaml.parse(yamlContent);
      } catch (error) {
        if (error.message.includes('multiple documents')) {
          // If multiple documents, parse all and take the first
          logger.info('[PatternGeneration] Multiple documents detected, taking first');
          const documents = yaml.parseAllDocuments(yamlContent);
          if (documents.length === 0) {
            throw new Error('No valid YAML documents found');
          }
          pattern = documents[0].toJSON();
        } else {
          throw error;
        }
      }

      this._validatePattern(pattern);

      // Test pattern against sample
      const testResult = this._testPattern(pattern, sampleText);

      logger.info(
        `Pattern generated successfully: ${pattern.id} (${testResult.matchRate}% match rate)`
      );

      return {
        pattern,
        yaml: yamlContent,
        testResult,
        model: result.model,
      };
    } catch (error) {
      logger.error('Failed to generate pattern:', error);
      throw new Error(`Pattern generation failed: ${error.message}`);
    }
  }

  /**
   * Build system prompt for pattern generation
   */
  _buildSystemPrompt() {
    return `You are an expert at analyzing transcript formats and creating regex patterns to parse them.

Your task is to analyze a sample transcript and generate a YAML configuration that defines how to extract speaker names and their dialogue.

CRITICAL: Choose the pattern type carefully:

TYPE 1 - "inline": Speaker and text on SAME line
  Examples:
  - "John: Hello there" → speaker=John, text=Hello there
  - "| 10:23 | John | Hello |" → speaker=John, text=Hello
  - '"Hello there," said John.' → speaker=John, text=Hello there
  - '[00:01:42] "Hello," Morgan added.' → speaker=Morgan, text=Hello

  Required capture groups:
    speaker: <group number>  (the speaker's name)
    text: <group number>     (what they said)

TYPE 2 - "header": Speaker on OWN line, text follows
  Examples:
  - Line 1: "John:"
    Line 2: "Hello there"

  Required capture groups:
    speaker: <group number>  (ONLY - no text group!)

TYPE 3 - "timestamp": Timestamp + text, NO speaker on line
  Examples:
  - "[10:23:45] Hello there" (speaker comes from previous line)
  - "10:23 - Good morning" (speaker comes from previous line)

  Required capture groups:
    timestamp: <group number>  (NOT speaker!)
    text: <group number>

KEY DECISION: If the speaker is ON THE SAME LINE (even with timestamp), use type: "inline"!

Rules:
1. Output ONLY ONE YAML document - no additional text, markdown, explanations, or multiple examples
2. The regex must be JavaScript-compatible (no named groups, use numbered capture groups)
3. Use non-capturing groups (?:...) for alternatives that aren't speaker/text
4. For dialogue attribution ("said X", "replied Y"), use: (?:said|replied|asked|responded|added|muttered|etc)
5. Test your regex mentally against the sample to ensure it works
6. Set priority based on specificity (more specific patterns = higher priority, range 1-100)
7. Escape special regex characters properly: \\| \\[ \\] \\( \\) \\. \\? \\* \\+ \\{

YAML Schema (output exactly this structure):
---
id: string (kebab-case)
name: string (human-readable)
description: string (brief explanation)
type: "inline" | "header" | "timestamp"
regex: string (JavaScript regex)
captureGroups:
  speaker: number (for inline/header types) OR timestamp: number (for timestamp type)
  text: number (for inline/timestamp types)
enabled: true
priority: number (1-100, higher = more specific)

Example 1 - Dialogue attribution:
---
id: dialogue-said-by
name: Dialogue with "said Speaker"
description: Matches "text," said Speaker.
type: inline
regex: ^"(.+?)," (?:said|replied|asked) ([A-Za-z\\s]+)\\.$
captureGroups:
  speaker: 2
  text: 1
enabled: true
priority: 65

Example 2 - Timestamp + dialogue:
---
id: timestamp-dialogue-inline
name: Timestamp with Dialogue Attribution
description: '[HH:MM:SS] "text," said Speaker.'
type: inline
regex: ^\\[(\\d{2}:\\d{2}:\\d{2})\\]\\s+"(.+?)," (?:said|replied) ([A-Za-z\\s]+)\\.$
captureGroups:
  speaker: 3
  text: 2
enabled: true
priority: 75`;
  }

  /**
   * Build user prompt with sample text
   */
  _buildUserPrompt(sampleText, previousAttempt = null) {
    let prompt = `Analyze this transcript sample and generate the YAML pattern configuration:

\`\`\`
${sampleText}
\`\`\`
`;

    // If this is a retry, include feedback about what went wrong
    if (previousAttempt && previousAttempt.testResult && previousAttempt.yaml) {
      const { pattern, testResult, yaml } = previousAttempt;
      prompt += `

IMPORTANT - PREVIOUS ATTEMPT FAILED:
Your previous pattern had a ${testResult.matchRate}% match rate (${testResult.matches}/${testResult.totalLines} lines matched).
This is ${testResult.matchRate < 60 ? 'TOO LOW and indicates the pattern does not work well' : 'suboptimal'}.

Previous pattern you generated:
\`\`\`yaml
${yaml}
\`\`\`

The user is asking you to try again with a DIFFERENT approach. Please:
1. Analyze what went wrong with the previous pattern
2. Look more carefully at the transcript format
3. Try a different regex pattern or pattern type
4. Ensure your new pattern matches MORE lines from the sample
`;
    }

    prompt += `

Instructions:
- Look at ALL lines carefully - samples may contain MULTIPLE formats
- If you see multiple formats (e.g., some with timestamps, some without), pick the MOST COMMON one
- If speaker appears on the same line (like "said John" or "Morgan added"), use type: "inline"
- Output ONLY ONE YAML document (starting with ---) - DO NOT include multiple patterns or examples
- No markdown code fences, no explanations, no multiple documents
- Make the regex as specific as possible to this format
- Test your regex mentally against multiple sample lines to verify it works`;

    return prompt;
  }

  /**
   * Extract YAML from LLM response (handles markdown code blocks and multiple documents)
   */
  _extractYaml(content) {
    // Remove markdown code fences if present
    let yaml = content.trim();

    // Remove ```yaml or ``` wrapping
    yaml = yaml.replace(/^```(?:yaml)?\s*\n/, '');
    yaml = yaml.replace(/\n```\s*$/, '');

    // If there are multiple YAML documents (multiple ---), take only the first one
    // Split on document separator and find the first valid document
    const documents = yaml.split(/\n---\s*\n/);

    if (documents.length > 1) {
      logger.info('[PatternGeneration] Multiple YAML documents detected, taking first one');
      // If first element is empty/whitespace, take second
      if (!documents[0].trim() && documents[1]) {
        yaml = '---\n' + documents[1];
      } else {
        yaml = documents[0].startsWith('---') ? documents[0] : '---\n' + documents[0];
      }
    }

    // Ensure it starts with ---
    if (!yaml.startsWith('---')) {
      yaml = '---\n' + yaml;
    }

    return yaml.trim();
  }

  /**
   * Validate pattern structure
   */
  _validatePattern(pattern) {
    const required = ['id', 'name', 'type', 'regex', 'captureGroups'];
    for (const field of required) {
      if (!pattern[field]) {
        throw new Error(`Pattern missing required field: ${field}`);
      }
    }

    if (!['inline', 'header', 'timestamp'].includes(pattern.type)) {
      throw new Error(`Invalid pattern type: ${pattern.type}`);
    }

    if (typeof pattern.captureGroups.speaker !== 'number') {
      throw new Error('captureGroups.speaker must be a number');
    }

    if (typeof pattern.captureGroups.text !== 'number') {
      throw new Error('captureGroups.text must be a number');
    }

    // Test regex is valid
    try {
      new RegExp(pattern.regex, pattern.flags || 'gm');
    } catch (error) {
      throw new Error(`Invalid regex pattern: ${error.message}`);
    }
  }

  /**
   * Test pattern against sample text
   */
  _testPattern(pattern, sampleText) {
    const lines = sampleText.split('\n').filter(l => l.trim());
    let matches = 0;
    let totalLines = lines.length;

    const regex = new RegExp(pattern.regex, pattern.flags || 'gm');

    for (const line of lines) {
      const match = regex.exec(line);
      if (match) {
        matches++;
        regex.lastIndex = 0; // Reset for next line
      }
    }

    const matchRate = totalLines > 0 ? ((matches / totalLines) * 100).toFixed(1) : 0;

    return {
      matches,
      totalLines,
      matchRate: parseFloat(matchRate),
      success: matches > 0 && matchRate >= 60, // At least 60% match rate
    };
  }
}

module.exports = PatternGenerationService;
