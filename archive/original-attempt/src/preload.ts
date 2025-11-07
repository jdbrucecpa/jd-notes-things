/**
 * Preload script for JD Notes Things
 * Exposes a safe API to the renderer process via contextBridge
 *
 * See the Electron documentation for details on how to use preload scripts:
 * https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
 */

import { contextBridge, ipcRenderer } from 'electron';
import { IPCChannel, RecordingSession } from './shared/types';

// Type definitions for the exposed API
export interface ElectronAPI {
  // Recording controls
  startRecording: () => Promise<{ success: boolean; session?: RecordingSession; error?: string }>;
  stopRecording: () => Promise<{ success: boolean; session?: RecordingSession; error?: string }>;
  pauseRecording: () => Promise<{ success: boolean; session?: RecordingSession; error?: string }>;
  resumeRecording: () => Promise<{ success: boolean; session?: RecordingSession; error?: string }>;

  // Event listeners
  onRecordingStarted: (callback: (session: RecordingSession) => void) => () => void;
  onRecordingStopped: (callback: (session: RecordingSession) => void) => () => void;
  onRecordingError: (callback: (error: string) => void) => () => void;
  onTranscriptionComplete: (callback: (data: any) => void) => () => void;
  onTranscriptionError: (callback: (error: string) => void) => () => void;
}

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Recording controls - invoke handlers
  startRecording: () => ipcRenderer.invoke(IPCChannel.START_RECORDING),
  stopRecording: () => ipcRenderer.invoke(IPCChannel.STOP_RECORDING),
  pauseRecording: () => ipcRenderer.invoke(IPCChannel.PAUSE_RECORDING),
  resumeRecording: () => ipcRenderer.invoke(IPCChannel.RESUME_RECORDING),

  // Event listeners - return cleanup functions
  onRecordingStarted: (callback: (session: RecordingSession) => void) => {
    const listener = (_event: any, session: RecordingSession) => callback(session);
    ipcRenderer.on(IPCChannel.RECORDING_STARTED, listener);
    return () => ipcRenderer.removeListener(IPCChannel.RECORDING_STARTED, listener);
  },

  onRecordingStopped: (callback: (session: RecordingSession) => void) => {
    const listener = (_event: any, session: RecordingSession) => callback(session);
    ipcRenderer.on(IPCChannel.RECORDING_STOPPED, listener);
    return () => ipcRenderer.removeListener(IPCChannel.RECORDING_STOPPED, listener);
  },

  onRecordingError: (callback: (error: string) => void) => {
    const listener = (_event: any, error: string) => callback(error);
    ipcRenderer.on(IPCChannel.RECORDING_ERROR, listener);
    return () => ipcRenderer.removeListener(IPCChannel.RECORDING_ERROR, listener);
  },

  onTranscriptionComplete: (callback: (data: any) => void) => {
    const listener = (_event: any, data: any) => callback(data);
    ipcRenderer.on(IPCChannel.TRANSCRIPTION_COMPLETE, listener);
    return () => ipcRenderer.removeListener(IPCChannel.TRANSCRIPTION_COMPLETE, listener);
  },

  onTranscriptionError: (callback: (error: string) => void) => {
    const listener = (_event: any, error: string) => callback(error);
    ipcRenderer.on(IPCChannel.TRANSCRIPTION_ERROR, listener);
    return () => ipcRenderer.removeListener(IPCChannel.TRANSCRIPTION_ERROR, listener);
  },
} as ElectronAPI);

console.log('[Preload] Electron API exposed to renderer');
