// File: elevenlabs/index.js
const WebSocket = require('ws');

class JitterBuffer {
  constructor(bufferSize = 20) {
    this.buffer = [];
    this.bufferSize = bufferSize;
  }

  push(chunk) {
    if (this.buffer.length >= this.bufferSize) {
      this.buffer.shift();
    }
    this.buffer.push(chunk);
  }

  pop() {
    return this.buffer.length > 0 ? this.buffer.shift() : null;
  }

  isReady(minSize = 3) {
    return this.buffer.length >= minSize;
  }
}

const startCallingStream = ({ socket, agentId, voiceId, firstMessage, promptText, onSend }) => {
  const ws = new WebSocket(`wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${agentId}`, {
    headers: {}
  });

  const buffer = new JitterBuffer(20);
  let streamId = null;
  let sessionClosed = false;

  ws.on('open', () => {
    console.log('[WebSocket Connected]');
  });

  let sentInit = false;

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);

      // Log all events from ElevenLabs (omit large data)
      // Clone the data to avoid modifying the original
      const logData = { ...data };
      
      // Omit large base64 data from logs
      if (logData.audio_event?.audio_base_64) {
        logData.audio_event.audio_base_64 = '[BASE64_AUDIO_DATA_OMITTED]';
      }
      
      console.log('[ElevenLabs Event]', logData);

      // Handle ping events
      if (data.type === 'ping' && data.ping_event && data.ping_event.event_id) {
        ws.send(JSON.stringify({
          type: 'pong',
          event_id: data.ping_event.event_id
        }));
        console.log('[ElevenLabs Response] Sent pong with event_id:', data.ping_event.event_id);
        return;
      }

      if (data.conversation_initiation_metadata_event && !sentInit) {
        console.log('[Conversation Started]', data.conversation_initiation_metadata_event);

        const override = {};
        if (voiceId) override.tts = { voice_id: voiceId };
        if (firstMessage || promptText) {
          override.agent = {};
          if (firstMessage) override.agent.first_message = firstMessage;
          if (promptText) override.agent.prompt = { prompt: promptText };
        }

        const initData = {
          type: 'conversation_initiation_client_data',
          conversation_config_override: override
        };
        
        ws.send(JSON.stringify(initData));
        console.log('[ElevenLabs Response] Sent:', initData);
        sentInit = true;
      }

      if (data.audio_event?.audio_base_64) {
        console.log('[ElevenLabs Audio] Received audio chunk');
        // Store the audio streamId if provided
        if (data.streamId) {
          streamId = data.streamId;
        }
        
        // Pass along the audio to the client
        onSend?.({
          event: 'media',
          media: { payload: data.audio_event.audio_base_64 },
          streamSid: streamId || 'elevenlabs-audio'
        });
        
        // Keep track of how many chunks we've received for debugging
        if (!ws.audioChunksReceived) ws.audioChunksReceived = 0;
        ws.audioChunksReceived++;
        
        // Log every 10 chunks to avoid flooding logs
        if (ws.audioChunksReceived % 10 === 0) {
          console.log(`[ElevenLabs Audio] Processed ${ws.audioChunksReceived} chunks so far`);
        }
      }

      if (data.agent_response_event?.agent_response) {
        console.log('[Agent Text]', data.agent_response_event.agent_response);
      }
    } catch (err) {
      console.error('[WebSocket Error]', err);
    }
  });

  ws.on('close', (code, reason) => {
    sessionClosed = true;
    console.log(`[WebSocket Closed] Code: ${code}, Reason: ${reason}`);
  });

  ws.on('error', (err) => {
    console.error('[WebSocket Error]', err);
  });

  const interval = setInterval(() => {
    if (sessionClosed || ws.readyState !== WebSocket.OPEN) return;
    
    // Check if buffer has chunks, but with a modified isReady requirement
    // Only require 1 chunk instead of the default minimum (which was 3)
    // This ensures audio flows even when sparse
    if (buffer.buffer.length > 0) {
      const chunk = buffer.pop();
      if (chunk) {
        try {
          ws.send(JSON.stringify({ user_audio_chunk: chunk }));
          
          // Track sent chunks
          if (!ws.sentAudioChunks) ws.sentAudioChunks = 0;
          ws.sentAudioChunks++;
          
          // Log every 20 chunks to avoid flooding
          if (ws.sentAudioChunks % 20 === 0) {
            console.log(`[JitterBuffer] Sent chunk #${ws.sentAudioChunks}, remaining: ${buffer.buffer.length}`);
          } else {
            console.log('[JitterBuffer] Sent buffered audio chunk');
          }
        } catch (err) {
          console.error('[JitterBuffer Send Error]', err);
        }
      }
    }
  }, 20);

  const handleIncomingAudio = (payloadObj) => {
    try {
      const base64Audio = payloadObj.media?.payload || payloadObj.payload;
      if (!base64Audio) {
        console.warn('[Audio Warning] Received empty audio payload');
        return;
      }

      // Update streamId if provided
      if (payloadObj.streamId || payloadObj.streamSid) {
        streamId = payloadObj.streamId || payloadObj.streamSid;
      }
      
      // Push audio chunk to jitter buffer
      buffer.push(base64Audio);
      
      // Keep track of audio chunks for debugging
      if (!ws.clientAudioChunks) ws.clientAudioChunks = 0;
      ws.clientAudioChunks++;
      
      // Log every 20 chunks to avoid flooding
      if (ws.clientAudioChunks % 20 === 0) {
        console.log(`[JitterBuffer] Added chunk #${ws.clientAudioChunks}, buffer size: ${buffer.buffer.length}`);
      } else {
        console.log('[JitterBuffer] Added audio chunk to buffer');
      }
    } catch (e) {
      console.error('[Audio Parse Error]', e);
    }
  }

  function closeSession() {
    sessionClosed = true;
    clearInterval(interval);
    ws.close();
  }

  return {
    ws,
    handleIncomingAudio,
    closeSession
  };
}


module.exports = { startCallingStream };
