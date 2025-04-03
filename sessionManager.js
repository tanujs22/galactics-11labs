// File: sessionManager.js
const SipClientAlternative = require('./sip-client-alternative');
const { startCallingStream } = require('./calling');

class SessionManager {
  constructor({ basePort = 5100, maxSessions = 100, agentId }) {
    this.basePort = basePort;
    this.maxSessions = maxSessions;
    this.agentId = agentId;
    this.sessions = new Map(); // key = call-id
    this.portPool = new Set();

    for (let i = 0; i < maxSessions; i++) {
      this.portPool.add(basePort + i);
    }
  }

  allocatePort() {
    const port = [...this.portPool][0];
    if (port === undefined) return null;
    this.portPool.delete(port);
    return port;
  }

  releasePort(port) {
    this.portPool.add(port);
  }

  async handleNewCall({ callId, extension }) {
    if (this.sessions.has(callId)) {
      console.warn(`[SessionManager] Session already exists for callId: ${callId}`);
      return;
    }

    const port = this.allocatePort();
    if (!port) {
      console.error('[SessionManager] Max sessions reached. Cannot allocate port.');
      return;
    }

    console.log(`[SessionManager] Allocated port ${port} for call ${callId}`);

    const sipClient = new SipClientAlternative({ overridePort: port });
    const session = {
      sipClient,
      callId,
      elevenlabsConnection: null,
      receivedAudioCount: 0,
      elAudioCount: 0
    };

    this.sessions.set(callId, session);

    await sipClient.initialize();

    sipClient.onCallReceived = (invitation) => {
      console.log(`[SessionManager] Incoming call for ${callId} on extension ${extension}`);
      this._connectToElevenLabs(session);
    };

    sipClient.onCallEnded = () => {
      console.log(`[SessionManager] Call ended for ${callId}`);
      this._disconnectFromElevenLabs(session);
      this._cleanupSession(callId);
    };

    sipClient.onAudioReceived = (audioData) => {
      const { elevenlabsConnection } = session;
      if (!elevenlabsConnection?.handleIncomingAudio) return;

      session.receivedAudioCount++;
      elevenlabsConnection.handleIncomingAudio({ media: { payload: audioData } });
    };
  }

  _connectToElevenLabs(session) {
    const { sipClient } = session;

    const { ws, handleIncomingAudio, closeSession } = startCallingStream({
      agentId: this.agentId,
      onSend: (responsePayload) => {
        if (responsePayload.event === 'media') {
          const audioPayload = responsePayload.media.payload;
          session.elAudioCount++;
          sipClient.sendAudio(audioPayload);
        } else if (responsePayload.event === 'agent_response') {
          console.log(`[ElevenLabs][${session.callId}]`, responsePayload.agent_response_event?.agent_response);
        } else if (responsePayload.event === 'interruption') {
          console.log(`[ElevenLabs][${session.callId}] Interruption detected`);
          sipClient.audio = Buffer.alloc(0);
        }
      }
    });

    session.elevenlabsConnection = { ws, handleIncomingAudio, closeSession };
  }

  _disconnectFromElevenLabs(session) {
    try {
      session.elevenlabsConnection?.closeSession?.();
      session.sipClient.rtpSequence = 0;
      session.sipClient.rtpTimestamp = 0;
    } catch (err) {
      console.error(`[SessionManager] Error disconnecting ElevenLabs for callId ${session.callId}:`, err);
    }
  }

  async _cleanupSession(callId) {
    const session = this.sessions.get(callId);
    if (!session) return;

    await session.sipClient.shutdown();
    this.releasePort(session.sipClient.config.localPort);
    this.sessions.delete(callId);
    console.log(`[SessionManager] Cleaned up session for callId ${callId}`);
  }

  async shutdownAll() {
    for (const [callId] of this.sessions) {
      await this._cleanupSession(callId);
    }
  }
}

module.exports = SessionManager;
