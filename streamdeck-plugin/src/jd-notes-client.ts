/**
 * WebSocket client for communicating with JD Notes Electron app
 */
import WebSocket from "ws";
import { EventEmitter } from "events";

const JD_NOTES_WS_URL = "ws://localhost:13373/streamdeck";
const RECONNECT_DELAY = 5000;
const MAX_RECONNECT_ATTEMPTS = 10;

export interface RecordingStatus {
  isRecording: boolean;
  meetingTitle?: string;
  recordingStartTime?: number;
}

export interface JDNotesMessage {
  event: string;
  data?: RecordingStatus;
  error?: string;
}

export class JDNotesClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private _isConnected = false;
  private _status: RecordingStatus = { isRecording: false };

  constructor() {
    super();
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  get status(): RecordingStatus {
    return this._status;
  }

  /**
   * Connect to JD Notes WebSocket server
   */
  connect(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    console.log(`[JDNotes] Connecting to ${JD_NOTES_WS_URL}...`);

    try {
      this.ws = new WebSocket(JD_NOTES_WS_URL);

      this.ws.on("open", () => {
        console.log("[JDNotes] Connected");
        this._isConnected = true;
        this.reconnectAttempts = 0;

        // Request current status
        this.send({ action: "getStatus" });

        this.emit("connected");
      });

      this.ws.on("message", (data: WebSocket.Data) => {
        try {
          const message: JDNotesMessage = JSON.parse(data.toString());
          this.handleMessage(message);
        } catch (e) {
          console.error("[JDNotes] Parse error:", e);
        }
      });

      this.ws.on("close", () => {
        console.log("[JDNotes] Disconnected");
        this._isConnected = false;
        this._status = { isRecording: false };
        this.emit("disconnected");
        this.scheduleReconnect();
      });

      this.ws.on("error", (error: Error) => {
        console.error("[JDNotes] Error:", error.message);
        // Don't emit error here, let close handler deal with reconnect
      });
    } catch (error) {
      console.error("[JDNotes] Connection error:", error);
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect from JD Notes
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this._isConnected = false;
  }

  /**
   * Send a message to JD Notes
   */
  send(data: { action: string; [key: string]: unknown }): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.warn("[JDNotes] Not connected, cannot send:", data);
    }
  }

  /**
   * Toggle recording state
   */
  toggleRecording(): void {
    if (this._status.isRecording) {
      this.send({ action: "stopRecording" });
    } else {
      this.send({ action: "startRecording" });
    }
  }

  /**
   * Start recording
   */
  startRecording(): void {
    this.send({ action: "startRecording" });
  }

  /**
   * Stop recording
   */
  stopRecording(): void {
    this.send({ action: "stopRecording" });
  }

  /**
   * Request current status
   */
  requestStatus(): void {
    this.send({ action: "getStatus" });
  }

  /**
   * Handle incoming messages from JD Notes
   */
  private handleMessage(message: JDNotesMessage): void {
    console.log("[JDNotes] Received:", message);

    switch (message.event) {
      case "connected":
        console.log("[JDNotes] Connection confirmed by server");
        // Request status after connection confirmed
        this.requestStatus();
        break;

      case "status":
      case "statusUpdate":
        this._status = {
          isRecording: message.data?.isRecording || false,
          meetingTitle: message.data?.meetingTitle,
          recordingStartTime: message.data?.recordingStartTime || (message.data?.isRecording ? Date.now() : undefined),
        };
        this.emit("statusChanged", this._status);
        break;

      case "recordingStarted":
        this._status = {
          isRecording: true,
          meetingTitle: message.data?.meetingTitle,
          recordingStartTime: message.data?.recordingStartTime || Date.now(),
        };
        this.emit("recordingStarted", this._status);
        this.emit("statusChanged", this._status);
        break;

      case "recordingStopped":
        this._status = { isRecording: false };
        this.emit("recordingStopped");
        this.emit("statusChanged", this._status);
        break;

      case "error":
        console.error("[JDNotes] Server error:", message.error);
        this.emit("error", message.error);
        break;
    }
  }

  /**
   * Schedule a reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.log("[JDNotes] Max reconnection attempts reached");
      return;
    }

    this.reconnectAttempts++;
    console.log(
      `[JDNotes] Reconnecting in ${RECONNECT_DELAY / 1000}s (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`
    );

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, RECONNECT_DELAY);
  }
}

// Singleton instance
export const jdNotesClient = new JDNotesClient();
