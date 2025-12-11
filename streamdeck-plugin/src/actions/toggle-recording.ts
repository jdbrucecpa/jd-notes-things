/**
 * Toggle Recording Action
 * Starts or stops recording when pressed
 */
import {
  action,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
  WillDisappearEvent,
} from "@elgato/streamdeck";
import { jdNotesClient, RecordingStatus } from "../jd-notes-client";

@action({ UUID: "com.jdnotes.recording.toggle" })
export class ToggleRecordingAction extends SingletonAction {
  private statusHandler: ((status: RecordingStatus) => void) | null = null;
  private connectionHandler: (() => void) | null = null;
  private disconnectionHandler: (() => void) | null = null;

  override onWillAppear(ev: WillAppearEvent): void {
    // Set up event listeners
    this.statusHandler = (status: RecordingStatus) => {
      this.updateButton(ev, status);
    };

    this.connectionHandler = () => {
      this.updateButton(ev, jdNotesClient.status);
    };

    this.disconnectionHandler = () => {
      ev.action.setTitle("Offline");
      ev.action.setState(0);
    };

    jdNotesClient.on("statusChanged", this.statusHandler);
    jdNotesClient.on("connected", this.connectionHandler);
    jdNotesClient.on("disconnected", this.disconnectionHandler);

    // Update button with current state
    if (jdNotesClient.isConnected) {
      this.updateButton(ev, jdNotesClient.status);
    } else {
      ev.action.setTitle("Offline");
      ev.action.setState(0);
    }
  }

  override onWillDisappear(ev: WillDisappearEvent): void {
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
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    if (!jdNotesClient.isConnected) {
      // Try to connect if not connected
      jdNotesClient.connect();
      return;
    }

    // Toggle recording
    jdNotesClient.toggleRecording();
  }

  private updateButton(
    ev: WillAppearEvent,
    status: RecordingStatus
  ): void {
    if (!jdNotesClient.isConnected) {
      ev.action.setTitle("Offline");
      ev.action.setState(0);
      return;
    }

    if (status.isRecording) {
      ev.action.setTitle("Stop");
      ev.action.setState(1);
    } else {
      ev.action.setTitle("Record");
      ev.action.setState(0);
    }
  }
}
