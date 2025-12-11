/**
 * JD Notes Recording - Stream Deck Plugin
 * Main entry point
 */
import streamDeck, { LogLevel } from "@elgato/streamdeck";
import { ToggleRecordingAction } from "./actions/toggle-recording";
import { StatusAction } from "./actions/status";
import { jdNotesClient } from "./jd-notes-client";

// Set log level for debugging
streamDeck.logger.setLevel(LogLevel.DEBUG);

// Log startup
console.log("[Plugin] JD Notes Recording plugin starting...");

// Register actions
streamDeck.actions.registerAction(new ToggleRecordingAction());
streamDeck.actions.registerAction(new StatusAction());

// Connect to JD Notes when plugin starts
jdNotesClient.connect();

// Handle JD Notes connection events
jdNotesClient.on("connected", () => {
  console.log("[Plugin] Connected to JD Notes");
});

jdNotesClient.on("disconnected", () => {
  console.log("[Plugin] Disconnected from JD Notes");
});

jdNotesClient.on("error", (error: string) => {
  console.error("[Plugin] JD Notes error:", error);
});

// Connect to Stream Deck
streamDeck.connect();

console.log("[Plugin] JD Notes Recording plugin initialized");
