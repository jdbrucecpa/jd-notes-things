import React, { useState } from 'react';
import './index.css';

export const App: React.FC = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);

  const handleStartRecording = () => {
    // TODO: Implement start recording via IPC
    console.log('Start recording');
    setIsRecording(true);
  };

  const handleStopRecording = () => {
    // TODO: Implement stop recording via IPC
    console.log('Stop recording');
    setIsRecording(false);
    setRecordingTime(0);
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
            <div className={`status-indicator ${isRecording ? 'recording' : 'idle'}`}>
              {isRecording ? '● Recording' : '○ Ready'}
            </div>
            {isRecording && (
              <div className="recording-timer">
                {Math.floor(recordingTime / 60)}:{(recordingTime % 60).toString().padStart(2, '0')}
              </div>
            )}
          </div>

          <div className="recording-controls">
            {!isRecording ? (
              <button onClick={handleStartRecording} className="btn btn-primary">
                Start Recording
              </button>
            ) : (
              <button onClick={handleStopRecording} className="btn btn-danger">
                Stop Recording
              </button>
            )}
          </div>

          <div className="info">
            <p>Click "Start Recording" to begin capturing system audio.</p>
            <p>Transcription will be processed after recording stops.</p>
          </div>
        </div>
      </main>
    </div>
  );
};
