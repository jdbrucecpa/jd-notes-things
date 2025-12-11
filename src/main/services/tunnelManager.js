const localtunnel = require('localtunnel');
require('dotenv').config();
const { SERVER_PORT } = require('../../shared/constants');

class TunnelManager {
  constructor() {
    this.tunnel = null;
    this.url = null;
    this.connected = false;
    this.port = SERVER_PORT;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 5000; // 5 seconds
    this.isReconnecting = false;
    this.errorCount = 0;
    this.lastErrorTime = null;
  }

  /**
   * Start localtunnel tunnel
   * @param {number} port - Local port to expose
   * @returns {Promise<string>} Public URL
   */
  async start(port = SERVER_PORT) {
    this.port = port;
    return this._createTunnel();
  }

  /**
   * Create or recreate the tunnel connection
   * @returns {Promise<string>} Public URL
   */
  async _createTunnel() {
    try {
      console.log('[Tunnel] Starting localtunnel...');

      // Note: Localtunnel assigns a random subdomain each time
      // Custom subdomain option exists but is not reliably supported
      const subdomain = process.env.TUNNEL_SUBDOMAIN;

      const options = {
        port: this.port,
        local_host: '127.0.0.1', // Explicitly use IPv4 localhost
      };
      if (subdomain) {
        options.subdomain = subdomain;
        console.log(`[Tunnel] Requesting subdomain: ${subdomain} (may not be honored)`);
      }

      // Start tunnel - much simpler than ngrok!
      this.tunnel = await localtunnel(options);
      this.url = this.tunnel.url;
      this.connected = true;
      this.reconnectAttempts = 0;
      this.errorCount = 0;

      console.log(`[Tunnel] ✓ Tunnel established: ${this.url}`);
      console.log(`[Tunnel] Webhook URL: ${this.url}/webhook/recall`);

      // Update global webhook URL
      if (global.webhookUrl !== `${this.url}/webhook/recall`) {
        global.webhookUrl = `${this.url}/webhook/recall`;
        console.log(`[Tunnel] Updated global webhook URL`);
      }

      // Handle tunnel close event
      this.tunnel.on('close', () => {
        console.log('[Tunnel] Tunnel closed');
        this.connected = false;
        this.url = null;
        // Attempt to reconnect
        this._scheduleReconnect();
      });

      // Handle tunnel errors - track frequency and reconnect if needed
      this.tunnel.on('error', err => {
        const now = Date.now();
        const errorMsg = err.message || '';

        // Only log if it's been more than 10 seconds since last error (reduce spam)
        if (!this.lastErrorTime || now - this.lastErrorTime > 10000) {
          console.warn('[Tunnel] Tunnel error:', errorMsg);
        }

        this.lastErrorTime = now;
        this.errorCount++;

        // Connection refused errors mean the tunnel is dead - reconnect immediately
        if (errorMsg.includes('connection refused')) {
          console.error('[Tunnel] Connection refused - tunnel is dead, reconnecting...');
          this.errorCount = 0;
          this.connected = false;
          this._scheduleReconnect();
          return;
        }

        // If we get many errors in quick succession, the tunnel is likely dead
        if (this.errorCount > 10) {
          console.error('[Tunnel] Too many errors, reconnecting...');
          this.errorCount = 0;
          this._scheduleReconnect();
        }
      });

      return this.url;
    } catch (error) {
      console.error('[Tunnel] Failed to start tunnel:', error.message);
      this.connected = false;

      // Schedule reconnect on failure
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this._scheduleReconnect();
      }

      throw error;
    }
  }

  /**
   * Schedule a reconnection attempt
   */
  _scheduleReconnect() {
    if (this.isReconnecting) {
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(
        `[Tunnel] Max reconnect attempts (${this.maxReconnectAttempts}) reached. Giving up.`
      );
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;

    const delay = this.reconnectDelay * this.reconnectAttempts; // Exponential backoff
    console.log(
      `[Tunnel] Scheduling reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay / 1000}s...`
    );

    setTimeout(async () => {
      this.isReconnecting = false;

      try {
        // Close existing tunnel if any
        if (this.tunnel) {
          try {
            this.tunnel.close();
          } catch {
            // Ignore close errors
          }
          this.tunnel = null;
        }

        await this._createTunnel();
        console.log('[Tunnel] ✓ Reconnected successfully');
      } catch (error) {
        console.error('[Tunnel] Reconnect failed:', error.message);
      }
    }, delay);
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

  /**
   * Force reconnect - useful when tunnel appears dead
   * @returns {Promise<string>} New public URL
   */
  async forceReconnect() {
    console.log('[Tunnel] Force reconnecting...');

    // Reset reconnect state
    this.reconnectAttempts = 0;
    this.isReconnecting = false;
    this.errorCount = 0;

    // Close existing tunnel
    if (this.tunnel) {
      try {
        this.tunnel.close();
      } catch {
        // Ignore
      }
      this.tunnel = null;
    }

    this.connected = false;
    this.url = null;

    return this._createTunnel();
  }

  /**
   * Get tunnel status info
   * @returns {Object} Status info
   */
  getStatus() {
    return {
      connected: this.connected,
      url: this.url,
      webhookUrl: this.getWebhookUrl(),
      reconnectAttempts: this.reconnectAttempts,
      isReconnecting: this.isReconnecting,
      errorCount: this.errorCount,
    };
  }
}

// Export singleton instance
module.exports = new TunnelManager();
