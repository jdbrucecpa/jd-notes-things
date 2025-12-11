/**
 * JD Notes Recording - Stream Deck Plugin
 * v1.0.0
 *
 * This plugin connects to JD Notes via WebSocket and allows
 * controlling meeting recording from the Stream Deck.
 */

// WebSocket connection to JD Notes
let jdNotesSocket = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY = 5000;
const JD_NOTES_WS_URL = 'ws://localhost:13373/streamdeck';

// Plugin state
let isRecording = false;
let currentMeetingTitle = null;
let recordingStartTime = null;

// Stream Deck connection
let websocket = null;
let pluginUUID = null;

// Track action contexts for state updates
const actionContexts = {
  toggle: new Set(),
  status: new Set()
};

/**
 * Connect to Stream Deck
 */
function connectToStreamDeck(inPort, inPluginUUID, inRegisterEvent, inInfo) {
  pluginUUID = inPluginUUID;

  websocket = new WebSocket(`ws://127.0.0.1:${inPort}`);

  websocket.onopen = () => {
    console.log('[StreamDeck] Connected');
    const json = {
      event: inRegisterEvent,
      uuid: inPluginUUID
    };
    websocket.send(JSON.stringify(json));

    // Connect to JD Notes
    connectToJDNotes();
  };

  websocket.onmessage = (evt) => {
    const jsonObj = JSON.parse(evt.data);
    handleStreamDeckEvent(jsonObj);
  };

  websocket.onclose = () => {
    console.log('[StreamDeck] Disconnected');
  };

  websocket.onerror = (error) => {
    console.error('[StreamDeck] Error:', error);
  };
}

/**
 * Connect to JD Notes WebSocket server
 */
function connectToJDNotes() {
  if (jdNotesSocket && jdNotesSocket.readyState === WebSocket.OPEN) {
    return;
  }

  console.log(`[JDNotes] Connecting to ${JD_NOTES_WS_URL}...`);

  jdNotesSocket = new WebSocket(JD_NOTES_WS_URL);

  jdNotesSocket.onopen = () => {
    console.log('[JDNotes] Connected');
    reconnectAttempts = 0;

    // Request current status
    sendToJDNotes({ action: 'getStatus' });

    // Update all status buttons to show connected state
    updateAllButtons();
  };

  jdNotesSocket.onmessage = (evt) => {
    try {
      const data = JSON.parse(evt.data);
      handleJDNotesMessage(data);
    } catch (e) {
      console.error('[JDNotes] Parse error:', e);
    }
  };

  jdNotesSocket.onclose = () => {
    console.log('[JDNotes] Disconnected');
    isRecording = false;
    updateAllButtons();

    // Attempt to reconnect
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      console.log(`[JDNotes] Reconnecting in ${RECONNECT_DELAY/1000}s (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
      setTimeout(connectToJDNotes, RECONNECT_DELAY);
    }
  };

  jdNotesSocket.onerror = (error) => {
    console.error('[JDNotes] Error:', error);
  };
}

/**
 * Send message to JD Notes
 */
function sendToJDNotes(data) {
  if (jdNotesSocket && jdNotesSocket.readyState === WebSocket.OPEN) {
    jdNotesSocket.send(JSON.stringify(data));
  } else {
    console.warn('[JDNotes] Not connected, cannot send:', data);
  }
}

/**
 * Handle messages from JD Notes
 */
function handleJDNotesMessage(data) {
  console.log('[JDNotes] Received:', data);

  switch (data.event) {
    case 'connected':
      console.log('[JDNotes] Connection confirmed');
      break;

    case 'status':
      isRecording = data.data?.isRecording || false;
      currentMeetingTitle = data.data?.meetingTitle || null;
      recordingStartTime = data.data?.recordingStartTime || null;
      updateAllButtons();
      break;

    case 'recordingStarted':
      isRecording = true;
      currentMeetingTitle = data.data?.meetingTitle || null;
      recordingStartTime = data.data?.startTime || Date.now();
      updateAllButtons();
      break;

    case 'recordingStopped':
      isRecording = false;
      currentMeetingTitle = null;
      recordingStartTime = null;
      updateAllButtons();
      break;

    case 'error':
      console.error('[JDNotes] Error:', data.error);
      break;
  }
}

/**
 * Handle Stream Deck events
 */
function handleStreamDeckEvent(event) {
  const action = event.action;
  const context = event.context;

  switch (event.event) {
    case 'willAppear':
      // Track this action context
      if (action === 'com.jdnotes.recording.toggle') {
        actionContexts.toggle.add(context);
      } else if (action === 'com.jdnotes.recording.status') {
        actionContexts.status.add(context);
      }
      updateButton(action, context);
      break;

    case 'willDisappear':
      // Remove this action context
      if (action === 'com.jdnotes.recording.toggle') {
        actionContexts.toggle.delete(context);
      } else if (action === 'com.jdnotes.recording.status') {
        actionContexts.status.delete(context);
      }
      break;

    case 'keyDown':
      handleKeyDown(action, context);
      break;

    case 'keyUp':
      // Optional: handle key up
      break;
  }
}

/**
 * Handle key press
 */
function handleKeyDown(action, context) {
  if (action === 'com.jdnotes.recording.toggle') {
    // Toggle recording
    if (isRecording) {
      sendToJDNotes({ action: 'stopRecording' });
    } else {
      sendToJDNotes({ action: 'startRecording' });
    }
  } else if (action === 'com.jdnotes.recording.status') {
    // Status button pressed - request current status
    sendToJDNotes({ action: 'getStatus' });
  }
}

/**
 * Update all buttons with current state
 */
function updateAllButtons() {
  actionContexts.toggle.forEach(context => {
    updateButton('com.jdnotes.recording.toggle', context);
  });

  actionContexts.status.forEach(context => {
    updateButton('com.jdnotes.recording.status', context);
  });
}

/**
 * Update a specific button
 */
function updateButton(action, context) {
  if (!websocket || websocket.readyState !== WebSocket.OPEN) return;

  const connected = jdNotesSocket && jdNotesSocket.readyState === WebSocket.OPEN;

  if (action === 'com.jdnotes.recording.toggle') {
    // Update state (0 = not recording, 1 = recording)
    setButtonState(context, isRecording ? 1 : 0);

    // Update title
    if (!connected) {
      setButtonTitle(context, 'Offline');
    } else if (isRecording) {
      setButtonTitle(context, 'Stop');
    } else {
      setButtonTitle(context, 'Record');
    }
  } else if (action === 'com.jdnotes.recording.status') {
    // Update state (0 = idle, 1 = recording)
    setButtonState(context, isRecording ? 1 : 0);

    // Update title with duration if recording
    if (!connected) {
      setButtonTitle(context, 'Offline');
    } else if (isRecording && recordingStartTime) {
      const duration = formatDuration(Date.now() - recordingStartTime);
      setButtonTitle(context, duration);
    } else {
      setButtonTitle(context, 'Ready');
    }
  }
}

/**
 * Set button state
 */
function setButtonState(context, state) {
  websocket.send(JSON.stringify({
    event: 'setState',
    context: context,
    payload: { state: state }
  }));
}

/**
 * Set button title
 */
function setButtonTitle(context, title) {
  websocket.send(JSON.stringify({
    event: 'setTitle',
    context: context,
    payload: { title: title }
  }));
}

/**
 * Format duration in MM:SS or HH:MM:SS
 */
function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Update status display every second when recording
setInterval(() => {
  if (isRecording) {
    actionContexts.status.forEach(context => {
      updateButton('com.jdnotes.recording.status', context);
    });
  }
}, 1000);

// Entry point - called by Stream Deck
function connectElgatoStreamDeckSocket(inPort, inPluginUUID, inRegisterEvent, inInfo) {
  connectToStreamDeck(inPort, inPluginUUID, inRegisterEvent, inInfo);
}
