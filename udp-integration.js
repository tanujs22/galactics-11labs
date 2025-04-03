const SipClientAlternative = require('./sip-client-alternative');
const SessionManager = require('./sessionManager');
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

    this.listenerClient = new SipClientAlternative({ overridePort: BASE_PORT - 1 });
  }

  async initialize() {
    console.log(`[INIT] SIP Server: ${process.env.SIP_SERVER}`);
    console.log(`[INIT] SIP Base Port: ${BASE_PORT}`);
    console.log(`[INIT] Max Sessions: ${MAX_SESSIONS}`);
    console.log(`[INIT] ElevenLabs Agent ID: ${AGENT_ID}`);

    // Register persistent SIP listener
    const ok = await this.listenerClient.initialize();
    if (!ok) {
      console.error('[ERROR] Failed to initialize SIP listener client.');
      return false;
    }

    // Set up to forward INVITE to SessionManager
    this.listenerClient.onCallReceived = async (invite) => {
      const callId = invite.headers['call-id'];
      const extension = invite.headers.to.uri.match(/\d+/)?.[0] || '7001';
      console.log(`[BRIDGE] Incoming call received. Call-ID: ${callId}, Extension: ${extension}`);
      await this.sessionManager.handleNewCall({ callId, extension });
    };

    this.listenerClient.onCallEnded = () => {
      console.log('[BRIDGE] Listener call ended');
    };

    console.log('[INIT] Session Manager initialized. Ready for incoming calls.');
    return true;
  }

  async shutdown() {
    await this.sessionManager.shutdownAll();
    await this.listenerClient.shutdown();
    console.log('[SHUTDOWN] All sessions and listener client shut down');
  }
}

async function main() {
  const bridge = new UdpElevenLabsAsteriskBridge();

  process.on('SIGINT', async () => {
    console.log('[SHUTDOWN] Caught SIGINT, shutting down...');
    await bridge.shutdown();
    process.exit(0);
  });

  const initialized = await bridge.initialize();
  if (!initialized) {
    console.error('[FATAL] Initialization failed');
    process.exit(1);
  }

  console.log('[READY] Bridge initialized. Awaiting incoming calls...');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[FATAL ERROR] uncaught error:', err);
    process.exit(1);
  });
}


main().catch((err) => {
  console.error('[FATAL ERROR] uncaught error:', err);
  process.exit(1);
});


module.exports = UdpElevenLabsAsteriskBridge;