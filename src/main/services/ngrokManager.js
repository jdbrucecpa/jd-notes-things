const ngrok = require('ngrok');
require('dotenv').config();

class NgrokManager {
  constructor() {
    this.url = null;
    this.connected = false;
  }

  /**
   * Start ngrok tunnel
   * @param {number} port - Local port to expose
   * @returns {Promise<string>} Public URL
   */
  async start(port = 13373) {
    try {
      console.log('[ngrok] Starting tunnel...');

      const authtoken = process.env.NGROK_AUTHTOKEN;
      const domain = process.env.NGROK_DOMAIN;

      if (!authtoken) {
        throw new Error('NGROK_AUTHTOKEN not found in .env file');
      }

      // For ngrok 4.x, first set the authtoken, then connect
      console.log('[ngrok] Setting authtoken...');
      await ngrok.authtoken(authtoken);
      console.log('[ngrok] Authtoken set successfully');

      // Connect with options (ngrok v3 API via npm package v4.x)
      // Configure for Electron production builds
      const options = {
        addr: port,
        proto: 'http',
        // Fix for Electron ASAR packaging - ngrok binary location
        binPathReplacer: ['app.asar/node_modules/ngrok/bin', 'app.asar.unpacked/node_modules/ngrok/bin'],
      };

      if (domain) {
        // Strip protocol if present
        const cleanDomain = domain.replace(/^https?:\/\//, '');

        // The ngrok npm package expects 'domain' for static/reserved domains
        options.domain = cleanDomain;
        console.log(`[ngrok] Using domain: ${cleanDomain}`);
      } else {
        console.log('[ngrok] No domain configured - using random URL');
      }

      console.log('[ngrok] Connecting with options:', JSON.stringify(options, null, 2));
      this.url = await ngrok.connect(options);
      this.connected = true;

      console.log(`[ngrok] ✓ Tunnel established: ${this.url}`);
      console.log(`[ngrok] Webhook URL: ${this.url}/webhook/recall`);

      return this.url;
    } catch (error) {
      console.error('[ngrok] Failed to start tunnel:', error.message);
      console.error('[ngrok] Full error:', error);
      console.error('[ngrok] Error stack:', error.stack);
      this.connected = false;
      throw error;
    }
  }

  /**
   * Stop ngrok tunnel
   */
  async stop() {
    if (this.connected) {
      console.log('[ngrok] Disconnecting tunnel...');

      // Try to disconnect the specific URL first (more reliable)
      if (this.url) {
        try {
          await ngrok.disconnect(this.url);
        } catch (error) {
          // Ignore disconnect errors - tunnel may already be closed
          console.log('[ngrok] Disconnect returned error (ignoring):', error.message);
        }
      }

      // Kill the ngrok process
      try {
        await ngrok.kill();
        console.log('[ngrok] ✓ Tunnel disconnected');
      } catch (error) {
        // Ignore kill errors - process may already be terminated
        console.log('[ngrok] Kill returned error (ignoring):', error.message);
      }

      // Always clean up state
      this.connected = false;
      this.url = null;
    }
  }

  /**
   * Get the current public URL
   * @returns {string|null}
   */
  getUrl() {
    return this.url;
  }

  /**
   * Get the webhook URL
   * @returns {string|null}
   */
  getWebhookUrl() {
    return this.url ? `${this.url}/webhook/recall` : null;
  }

  /**
   * Check if tunnel is connected
   * @returns {boolean}
   */
  isConnected() {
    return this.connected;
  }
}

// Export singleton instance
module.exports = new NgrokManager();
