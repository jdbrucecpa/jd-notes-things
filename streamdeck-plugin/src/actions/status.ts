/**
 * Status Action
 * Shows current recording status and duration (display only - no button action)
 */
import {
  action,
  SingletonAction,
  WillAppearEvent,
  WillDisappearEvent,
} from "@elgato/streamdeck";
import { jdNotesClient, RecordingStatus } from "../jd-notes-client";

@action({ UUID: "com.jdnotes.recording.status" })
export class StatusAction extends SingletonAction {
  private statusHandler: ((status: RecordingStatus) => void) | null = null;
  private connectionHandler: (() => void) | null = null;
  private disconnectionHandler: (() => void) | null = null;
  private durationTimer: NodeJS.Timeout | null = null;
  private currentEvent: WillAppearEvent | null = null;

  override onWillAppear(ev: WillAppearEvent): void {
    this.currentEvent = ev;

    // Set up event listeners
    this.statusHandler = (status: RecordingStatus) => {
      this.updateButton(ev, status);
      this.manageDurationTimer(ev, status);
    };

    this.connectionHandler = () => {
      this.updateButton(ev, jdNotesClient.status);
      this.manageDurationTimer(ev, jdNotesClient.status);
    };

    this.disconnectionHandler = () => {
      this.stopDurationTimer();
      ev.action.setTitle("Offline");
      ev.action.setState(0);
    };

    jdNotesClient.on("statusChanged", this.statusHandler);
    jdNotesClient.on("connected", this.connectionHandler);
    jdNotesClient.on("disconnected", this.disconnectionHandler);

    // Update button with current state
    if (jdNotesClient.isConnected) {
      this.updateButton(ev, jdNotesClient.status);
      this.manageDurationTimer(ev, jdNotesClient.status);
    } else {
      ev.action.setTitle("Offline");
      ev.action.setState(0);
    }
  }

  override onWillDisappear(_ev: WillDisappearEvent): void {
    this.currentEvent = null;

    // Clean up event listeners
    if (this.statusHandler) {
      jdNotesClient.off("statusChanged", this.statusHandler);
    }
    if (this.connectionHandler) {
      jdNotesClient.off("connected", this.connectionHandler);
    }
    if (this.disconnectionHandler) {
      jdNotesClient.off("disconnected", this.disconnectionHandler);
    }

    this.stopDurationTimer();
  }

  // No onKeyDown - this is a display-only button

  private updateButton(ev: WillAppearEvent, status: RecordingStatus): void {
    if (!jdNotesClient.isConnected) {
      ev.action.setTitle("Offline");
      ev.action.setState(0);
      return;
    }

    if (status.isRecording) {
      const duration = this.formatDuration(status.recordingStartTime);
      ev.action.setTitle(duration);
      ev.action.setState(1);
    } else {
      ev.action.setTitle("Ready");
      ev.action.setState(0);
    }
  }

  private manageDurationTimer(
    ev: WillAppearEvent,
    status: RecordingStatus
  ): void {
    if (status.isRecording && status.recordingStartTime) {
      this.startDurationTimer(ev, status.recordingStartTime);
    } else {
      this.stopDurationTimer();
    }
  }

  private startDurationTimer(
    ev: WillAppearEvent,
    startTime: number
  ): void {
    this.stopDurationTimer();

    // Update every second
    this.durationTimer = setInterval(() => {
      if (this.currentEvent && jdNotesClient.status.isRecording) {
        const duration = this.formatDuration(startTime);
        ev.action.setTitle(duration);
      }
    }, 1000);
  }

  private stopDurationTimer(): void {
    if (this.durationTimer) {
      clearInterval(this.durationTimer);
      this.durationTimer = null;
    }
  }

  private formatDuration(startTime?: number): string {
    if (!startTime) return "0:00";

    const ms = Date.now() - startTime;
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }
}
