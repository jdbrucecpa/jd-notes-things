import React, { useState, useEffect } from 'react';
import './index.css';

export const App: React.FC = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Set up event listeners for IPC events
  useEffect(() => {
    const cleanupRecordingStarted = window.electronAPI.onRecordingStarted((session) => {
      console.log('[Renderer] Recording started:', session);
      setIsRecording(true);
      setError(null);
      setStatusMessage('Recording in progress...');
    });

    const cleanupRecordingStopped = window.electronAPI.onRecordingStopped((session) => {
      console.log('[Renderer] Recording stopped:', session);
      setIsRecording(false);
      setIsProcessing(true);
      setStatusMessage('Processing... Transcribing audio...');
    });

    const cleanupRecordingError = window.electronAPI.onRecordingError((errorMsg) => {
      console.error('[Renderer] Recording error:', errorMsg);
      setError(errorMsg);
      setIsRecording(false);
      setIsProcessing(false);
      setStatusMessage('');
    });

    const cleanupTranscriptionComplete = window.electronAPI.onTranscriptionComplete((data) => {
      console.log('[Renderer] Transcription complete:', data);
      setIsProcessing(false);
      setStatusMessage(`Transcript saved to: ${data.transcriptPath}`);
    });

    const cleanupTranscriptionError = window.electronAPI.onTranscriptionError((errorMsg) => {
      console.error('[Renderer] Transcription error:', errorMsg);
      setError(`Transcription failed: ${errorMsg}`);
      setIsProcessing(false);
      setStatusMessage('');
    });

    // Cleanup all listeners on unmount
    return () => {
      cleanupRecordingStarted();
      cleanupRecordingStopped();
      cleanupRecordingError();
      cleanupTranscriptionComplete();
      cleanupTranscriptionError();
    };
  }, []);

  // Timer effect
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;

    if (isRecording) {
      interval = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } else {
      setRecordingTime(0);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRecording]);

  const handleStartRecording = async () => {
    setError(null);
    setStatusMessage('Starting recording...');

    const result = await window.electronAPI.startRecording();
    if (!result.success) {
      setError(result.error || 'Failed to start recording');
      setStatusMessage('');
    }
  };

  const handleStopRecording = async () => {
    setStatusMessage('Stopping recording...');

    const result = await window.electronAPI.stopRecording();
    if (!result.success) {
      setError(result.error || 'Failed to stop recording');
      setStatusMessage('');
      setIsProcessing(false);
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>JD Notes Things</h1>
        <p>AI Meeting Notetaker - Phase 1: Core Recording & Transcription</p>
      </header>

      <main className="app-main">
        <div className="recording-widget">
          <div className="recording-status">
            <div className={`status-indicator ${isRecording ? 'recording' : isProcessing ? 'processing' : 'idle'}`}>
              {isRecording ? '● Recording' : isProcessing ? '◐ Processing' : '○ Ready'}
            </div>
            {isRecording && (
              <div className="recording-timer">
                {Math.floor(recordingTime / 60)}:{(recordingTime % 60).toString().padStart(2, '0')}
              </div>
            )}
          </div>

          <div className="recording-controls">
            {!isRecording && !isProcessing ? (
              <button onClick={handleStartRecording} className="btn btn-primary">
                Start Recording
              </button>
            ) : isRecording ? (
              <button onClick={handleStopRecording} className="btn btn-danger">
                Stop Recording
              </button>
            ) : (
              <button disabled className="btn btn-secondary">
                Processing...
              </button>
            )}
          </div>

          {error && (
            <div className="error-message">
              <strong>Error:</strong> {error}
            </div>
          )}

          {statusMessage && !error && (
            <div className="status-message">
              {statusMessage}
            </div>
          )}

          <div className="info">
            <p>Click "Start Recording" to begin capturing system audio.</p>
            <p>Transcription will be processed after recording stops.</p>
            <p><strong>Note:</strong> Recall.ai SDK integration pending. Recording simulation active.</p>
          </div>
        </div>
      </main>
    </div>
  );
};
