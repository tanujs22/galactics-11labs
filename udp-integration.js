// Updated udp-integration.js with multi-call support using SessionManager
const SessionManager = require('./sessionManager'); // ✅ Corrected typo
require('dotenv').config();

const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || '100', 10);
const BASE_PORT = parseInt(process.env.BASE_PORT || '5100', 10);
const AGENT_ID = process.env.ELEVENLABS_AGENT_ID;

class UdpElevenLabsAsteriskBridge {
  constructor() {
    console.log('*********************************************************');
    console.log('* MULTI-CALL ELEVENLABS BRIDGE WITH UDP-BASED SIP CLIENT *');
    console.log('* Supports concurrent calls to extension 222             *');
    console.log('*********************************************************');

    this.sessionManager = new SessionManager({
      basePort: BASE_PORT,
      maxSessions: MAX_SESSIONS,
      agentId: AGENT_ID
    });
  }

  async initialize() {
    console.log(`[INIT] SIP Server: ${process.env.SIP_SERVER || 'default'}`);
    console.log(`[INIT] SIP Base Port: ${BASE_PORT}`);
    console.log(`[INIT] Max Sessions: ${MAX_SESSIONS}`);
    console.log(`[INIT] ElevenLabs Agent ID: ${AGENT_ID}`);
    console.log('[INIT] Session Manager initialized. Ready for incoming calls.');
    return true;
  }

  async handleIncomingCall(inviteRequest) {
    try {
      const callId = inviteRequest?.headers?.['call-id'];
      const toUri = inviteRequest?.headers?.to?.uri || '';
      const extension = toUri.match(/\d+/)?.[0] || '7001';

      if (!callId) {
        console.warn('[WARN] Incoming call has no call-id, skipping');
        return;
      }

      console.log(`[CALL] New incoming call: Call-ID=${callId}, Extension=${extension}`);
      await this.sessionManager.handleNewCall({ callId, extension });
    } catch (err) {
      console.error('[ERROR] Failed to handle incoming call:', err);
    }
  }

  async shutdown() {
    await this.sessionManager.shutdownAll();
    console.log('[SHUTDOWN] All active sessions have been terminated');
  }
}

// Runner
async function main() {
  const bridge = new UdpElevenLabsAsteriskBridge();

  process.on('SIGINT', async () => {
    console.log('[SIGINT] Shutting down gracefully...');
    await bridge.shutdown();
    process.exit(0);
  });

  const initialized = await bridge.initialize();
  if (!initialized) {
    console.error('[FATAL] Failed to initialize bridge. Exiting...');
    process.exit(1);
  }

  // Manual test or integration point with your SIP dispatcher
  // Example:
  // bridge.handleIncomingCall({ headers: { 'call-id': 'abc123', to: { uri: 'sip:222@yourdomain.com' } } });

  console.log('[READY] Bridge initialized. Awaiting incoming calls...');
}

if (require.main === module) {
  main().catch(err => {
    console.error('[FATAL] Unhandled error in bridge runtime:', err);
    process.exit(1);
  });
}

module.exports = UdpElevenLabsAsteriskBridge;