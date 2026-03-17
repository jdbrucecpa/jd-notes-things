/**
 * MCP Server - Import and startup validation
 *
 * Verifies the standalone MCP server can load its dependencies
 * and exits cleanly with a helpful error when given a bad DB path.
 */

const { execFileSync } = require('child_process');
const path = require('path');

const MCP_SERVER_PATH = path.join(__dirname, '..', '..', 'src', 'mcp-server.js');

describe('MCP Server', () => {
  it('exits with usage error when no --db-path is given', () => {
    try {
      execFileSync('node', [MCP_SERVER_PATH], {
        timeout: 10_000,
        encoding: 'utf8',
      });
      expect.unreachable('Expected process to exit with non-zero code');
    } catch (error) {
      expect(error.status).toBe(1);
      expect(error.stderr).toContain('Usage:');
    }
  });

  it('exits with database error when given a non-existent DB path', () => {
    try {
      execFileSync('node', [MCP_SERVER_PATH, '--db-path', '/nonexistent/path/fake.db'], {
        timeout: 10_000,
        encoding: 'utf8',
      });
      expect.unreachable('Expected process to exit with non-zero code');
    } catch (error) {
      expect(error.status).toBe(1);
      expect(error.stderr).toContain('Failed to open database');
    }
  });

  it('imports McpServer and StdioServerTransport without module errors', () => {
    // If the imports are wrong, this will throw MODULE_NOT_FOUND
    const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
    const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');

    expect(typeof McpServer).toBe('function');
    expect(typeof StdioServerTransport).toBe('function');
  });
});
