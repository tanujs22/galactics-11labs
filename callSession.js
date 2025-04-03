// File: CallSession.js
const SipClientAlternative = require('./sip-client-alternative');
const { startCallingStream } = require('./calling');
const crypto = require('crypto');

class CallSession {
  constructor({ sipPort, extension, agentId, onEnd }) {
    this.sessionId = crypto.randomUUID();
    this.sipPort = sipPort;
    this.extension = extension;
    this.agentId = agentId;
    this.onEnd = onEnd;
    this.callActive = false;
    this.sipClient = null;
    this.elevenlabsConnection = null;
    this.audioPacketCount = 0;
    this.elAudioPacketCount = 0;
  }

  async start() {
    console.log(`\n[SESSION ${this.sessionId}] Starting CallSession for extension ${this.extension} on port ${this.sipPort}`);

    this.sipClient = new SipClientAlternative();

    // Override the SIP port
    this.sipClient.config.localPort = this.sipPort;

    // Attach SIP event hooks
    this.sipClient.onCallReceived = this.handleCallReceived.bind(this);
    this.sipClient.onCallEnded = this.handleCallEnded.bind(this);
    this.sipClient.onAudioReceived = this.handleSipAudio.bind(this);

    const initialized = await this.sipClient.initialize();
    if (!initialized) {
      console.error(`[SESSION ${this.sessionId}] Failed to initialize SIP client`);
      this.cleanup();
      return;
    }

    console.log(`[SESSION ${this.sessionId}] SIP client ready, waiting for INVITE...`);
  }

  async handleCallReceived(invite) {
    console.log(`[SESSION ${this.sessionId}] Incoming call received`);
    await this.connectToElevenLabs();
  }

  async handleCallEnded() {
    console.log(`[SESSION ${this.sessionId}] SIP call ended, cleaning up`);
    await this.cleanup();
  }

  async handleSipAudio(base64Audio) {
    if (!this.elevenlabsConnection?.handleIncomingAudio) {
      console.warn(`[SESSION ${this.sessionId}] Audio received but ElevenLabs not connected`);
      return;
    }

    this.audioPacketCount++;
    if (this.audioPacketCount % 50 === 0) {
      console.log(`[SESSION ${this.sessionId}] Forwarding audio packet #${this.audioPacketCount} to ElevenLabs`);
    }

    this.elevenlabsConnection.handleIncomingAudio({
      media: { payload: base64Audio }
    });
  }

  async connectToElevenLabs() {
    console.log(`[SESSION ${this.sessionId}] Connecting to ElevenLabs...`);

    const { ws, handleIncomingAudio, closeSession } = startCallingStream({
      agentId: this.agentId,
      onSend: (payload) => {
        if (payload.event === 'media') {
          this.elAudioPacketCount++;
          if (this.elAudioPacketCount <= 5 || this.elAudioPacketCount % 100 === 0) {
            console.log(`[SESSION ${this.sessionId}] Audio from ElevenLabs #${this.elAudioPacketCount}`);
          }
          this.sipClient.sendAudio(payload.media.payload);
        } else if (payload.event === 'agent_response') {
          console.log(`[SESSION ${this.sessionId}] ElevenLabs agent response: ${payload.agent_response_event.agent_response}`);
        } else if (payload.event === 'interruption') {
          console.log(`[SESSION ${this.sessionId}] User speaking — clearing audio buffer`);
          this.sipClient.audio = Buffer.alloc(0);
        }
      }
    });

    this.elevenlabsConnection = { ws, handleIncomingAudio, closeSession };
    this.callActive = true;
    console.log(`[SESSION ${this.sessionId}] ElevenLabs connection established`);
  }

  async cleanup() {
    if (this.callActive) {
      this.callActive = false;

      // End ElevenLabs connection
      try {
        this.elevenlabsConnection?.closeSession?.();
      } catch (err) {
        console.error(`[SESSION ${this.sessionId}] Error closing ElevenLabs session`, err);
      }

      // End SIP call
      try {
        await this.sipClient?.endCall();
      } catch (err) {
        console.error(`[SESSION ${this.sessionId}] Error ending SIP call`, err);
      }

      // Shutdown SIP client
      try {
        await this.sipClient?.shutdown();
      } catch (err) {
        console.error(`[SESSION ${this.sessionId}] Error shutting down SIP client`, err);
      }

      console.log(`[SESSION ${this.sessionId}] Session cleaned up`);
    }

    // Notify manager
    if (this.onEnd) this.onEnd(this.sessionId);
  }
}

module.exports = CallSession;