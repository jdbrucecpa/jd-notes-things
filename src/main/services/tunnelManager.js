const localtunnel = require('localtunnel');
require('dotenv').config();

class TunnelManager {
  constructor() {
    this.tunnel = null;
    this.url = null;
    this.connected = false;
  }

  /**
   * Start localtunnel tunnel
   * @param {number} port - Local port to expose
   * @returns {Promise<string>} Public URL
   */
  async start(port = 13373) {
    try {
      console.log('[Tunnel] Starting localtunnel...');

      // Note: Localtunnel assigns a random subdomain each time
      // Custom subdomain option exists but is not reliably supported
      const subdomain = process.env.TUNNEL_SUBDOMAIN;

      const options = { port };
      if (subdomain) {
        options.subdomain = subdomain;
        console.log(`[Tunnel] Requesting subdomain: ${subdomain} (may not be honored)`);
      }

      // Start tunnel - much simpler than ngrok!
      this.tunnel = await localtunnel(options);
      this.url = this.tunnel.url;
      this.connected = true;

      console.log(`[Tunnel] ✓ Tunnel established: ${this.url}`);
      console.log(`[Tunnel] Webhook URL: ${this.url}/webhook/recall`);

      // Handle tunnel close event
      this.tunnel.on('close', () => {
        console.log('[Tunnel] Tunnel closed');
        this.connected = false;
        this.url = null;
      });

      // Handle tunnel errors
      this.tunnel.on('error', err => {
        console.error('[Tunnel] Tunnel error:', err.message);
      });

      return this.url;
    } catch (error) {
      console.error('[Tunnel] Failed to start tunnel:', error.message);
      console.error('[Tunnel] Full error:', error);
      this.connected = false;
      throw error;
    }
  }

  /**
   * Stop tunnel
   */
  async stop() {
    if (this.tunnel && this.connected) {
      console.log('[Tunnel] Closing tunnel...');

      try {
        this.tunnel.close();
        console.log('[Tunnel] ✓ Tunnel closed');
      } catch (error) {
        console.log('[Tunnel] Close error (ignoring):', error.message);
      }

      // Always clean up state
      this.connected = false;
      this.url = null;
      this.tunnel = null;
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
module.exports = new TunnelManager();
