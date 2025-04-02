// UDP-based SIP integration with ElevenLabs
const SipClientAlternative = require('./sip-client-alternative');
const { startCallingStream } = require('./calling');
require('dotenv').config();

class UdpElevenLabsAsteriskBridge {
  constructor() {
    // Print banner to indicate which implementation is running
    console.log('*********************************************************');
    console.log('* STARTING ELEVENLABS BRIDGE WITH UDP-BASED SIP CLIENT *');
    console.log('* For calls to extension 222 on Asterisk               *');
    console.log('*********************************************************');
    
    this.sipClient = new SipClientAlternative();
    this.elevenlabsConnection = null;
    this.callActive = false;
  }

  async initialize() {
    try {
      // Initialize SIP client
      console.log('Initializing UDP SIP client...');
      
      // Environment info
      console.log(`SIP Server: ${process.env.SIP_SERVER || 'default'}`);
      console.log(`Local Port: ${process.env.LOCAL_PORT || '5080'}`);
      console.log(`SIP Extension: ${process.env.SIP_USERNAME || '7001'}`);
      
      // Initialize with extended debug
      const initResult = await this.sipClient.initialize();
      if (!initResult) {
        throw new Error('SIP client initialization failed');
      }
      
      // Set up SIP client event handlers
      this.setupSipEventHandlers();
      
      console.log('Initialization complete. Ready for calls.');
      console.log('Call this extension from Zoiper/Asterisk: 222');
      return true;
    } catch (error) {
      console.error('Initialization error:', error);
      return false;
    }
  }

  setupSipEventHandlers() {
    // Handle incoming calls
    this.sipClient.onCallReceived = (invitation) => {
      console.log('***** INCOMING CALL RECEIVED *****');
      console.log('Call info:', JSON.stringify(invitation));
      
      // Ensure we're not already connected
      this.disconnectFromElevenLabs();
      
      console.log('Connecting to ElevenLabs for incoming call...');
      this.connectToElevenLabs();
    };
    
    // Handle call end
    this.sipClient.onCallEnded = () => {
      console.log('Call ended, disconnecting from ElevenLabs...');
      this.disconnectFromElevenLabs();
    };
    
    // Handle audio from the SIP call
    this.sipClient.onAudioReceived = (audioData) => {
      // Simple log for receiving audio
      if (!this.receivedAudioCount) {
        this.receivedAudioCount = 0;
        console.log('[BRIDGE] FIRST audio packet received from SIP call');
      }
      this.receivedAudioCount++;
      
      // Only log occasionally to avoid flooding
      if (this.receivedAudioCount % 50 === 0) {
        console.log(`[BRIDGE] Audio received from SIP call (packet #${this.receivedAudioCount})`);
      }
      
      if (!this.elevenlabsConnection) {
        console.warn('[BRIDGE] Received audio but ElevenLabs connection not available');
        return;
      }
      
      if (!this.elevenlabsConnection.handleIncomingAudio) {
        console.warn('[BRIDGE] Received audio but ElevenLabs handler not available');
        return;
      }
      
      try {
        // Send audio from Asterisk to ElevenLabs without any processing
        if (this.receivedAudioCount % 50 === 0) {
          console.log(`[BRIDGE] Forwarding audio to ElevenLabs (packet #${this.receivedAudioCount})`);
        }
        this.elevenlabsConnection.handleIncomingAudio({
          media: { payload: audioData }
        });
      } catch (err) {
        console.error('[BRIDGE] Error sending audio to ElevenLabs:', err);
      }
    };
  }

  connectToElevenLabs() {
    try {
      console.log('Connecting to ElevenLabs...');
      
      const agentId = process.env.ELEVENLABS_AGENT_ID || "gjaoeyb4H5TTw7NA0mub";
      console.log(`Using ElevenLabs Agent ID: ${agentId}`);
      
      const { ws, handleIncomingAudio, closeSession } = startCallingStream({
        agentId,
        onSend: (responsePayload) => {
          try {
            if (responsePayload.event === 'media') {
              // Send audio from ElevenLabs to Asterisk
              if (!responsePayload.media || !responsePayload.media.payload) {
                console.warn('[BRIDGE] Received media event from ElevenLabs but no payload');
                return;
              }
              
              const audioPayload = responsePayload.media.payload;
              
              // Simple counter for ElevenLabs audio packets with minimal logging
              if (!this.elAudioCount) {
                this.elAudioCount = 0;
                console.log(`[BRIDGE] FIRST AUDIO PACKET FROM ELEVENLABS`);
              }
              this.elAudioCount++;
              
              // Only log very occasionally to avoid impacting real-time performance
              if (this.elAudioCount % 1000 === 0) {
                console.log(`[BRIDGE] Processed ${this.elAudioCount} audio packets from ElevenLabs`);
              }
              
              // Send the audio directly to Asterisk without any processing or logging
              // This is the critical real-time audio path
              this.sipClient.sendAudio(audioPayload);
            } else if (responsePayload.event === 'agent_response') {
              // Log the agent's text response
              console.log(`[ElevenLabs Agent] ${responsePayload.agent_response_event?.agent_response || '[No text]'}`);
            } else if (responsePayload.event !== 'ping') {
              // Log other non-ping events
              console.log(`[ElevenLabs Event] ${responsePayload.event}`);
            }
          } catch (err) {
            console.error('[BRIDGE] Error handling ElevenLabs response:', err);
            console.error(err.stack);
          }
        }
      });
      
      // Store the connection
      this.elevenlabsConnection = {
        ws,
        handleIncomingAudio,
        closeSession
      };
      
      console.log('==== Successfully Connected to ElevenLabs ====');
      console.log('Call is now active - audio should flow between Asterisk and ElevenLabs');
      this.callActive = true;
      
      // Send a test message to ElevenLabs to get it to start talking
      // This simulates the first audio from the user to kickstart the conversation
      setTimeout(() => {
        // Create a simple text message for ElevenLabs
        console.log('[BRIDGE] Sending simulated greeting to ElevenLabs to start conversation');
        
        // We can't directly send text to ElevenLabs through the current API
        // But we can simulate receiving audio from the user
        // In a real system, you might want to use a different approach
        const testAudioPayload = Buffer.from("Hello ElevenLabs, this is a test call.").toString('base64');
        
        // Send the test audio to ElevenLabs
        if (this.elevenlabsConnection && this.elevenlabsConnection.handleIncomingAudio) {
          this.elevenlabsConnection.handleIncomingAudio({
            media: { payload: testAudioPayload }
          });
          console.log('[BRIDGE] Sent initial greeting to ElevenLabs');
        }
      }, 1000); // Wait 1 second to make sure connection is fully established
      
      return true;
    } catch (error) {
      console.error('Error connecting to ElevenLabs:', error);
      return false;
    }
  }

  disconnectFromElevenLabs() {
    if (!this.elevenlabsConnection) {
      console.log('No active ElevenLabs connection to disconnect');
      return;
    }
    
    try {
      console.log('Disconnecting from ElevenLabs...');
      
      if (this.elevenlabsConnection.closeSession) {
        this.elevenlabsConnection.closeSession();
      }
      
      this.elevenlabsConnection = null;
      this.callActive = false;
      
      console.log('Disconnected from ElevenLabs');
    } catch (error) {
      console.error('Error disconnecting from ElevenLabs:', error);
    }
  }

  async makeCall(destination) {
    if (this.callActive) {
      console.warn('Call already in progress');
      return false;
    }
    
    try {
      console.log(`Making call to ${destination}...`);
      
      // Make the call
      const callResult = await this.sipClient.makeCall(destination);
      
      if (callResult) {
        console.log('Call connected, connecting to ElevenLabs...');
        this.connectToElevenLabs();
      }
      
      return callResult;
    } catch (error) {
      console.error('Error making call:', error);
      return false;
    }
  }

  async endCurrentCall() {
    try {
      console.log('Ending current call...');
      
      // Disconnect from ElevenLabs
      this.disconnectFromElevenLabs();
      
      // End the SIP call
      await this.sipClient.endCall();
      
      console.log('Call ended');
      return true;
    } catch (error) {
      console.error('Error ending call:', error);
      return false;
    }
  }

  async shutdown() {
    try {
      // End any active call
      if (this.callActive) {
        await this.endCurrentCall();
      }
      
      // Shut down SIP client
      await this.sipClient.shutdown();
      
      console.log('Shutdown complete');
    } catch (error) {
      console.error('Error during shutdown:', error);
    }
  }
}

// Example usage
async function main() {
  const bridge = new UdpElevenLabsAsteriskBridge();
  
  // Handle shutdown signals
  process.on('SIGINT', async () => {
    console.log('Shutting down...');
    await bridge.shutdown();
    process.exit(0);
  });
  
  // Initialize the bridge
  const initialized = await bridge.initialize();
  
  if (!initialized) {
    console.error('Failed to initialize, exiting...');
    process.exit(1);
  }
  
  console.log('Bridge initialized and ready for calls');
  
  // If a destination is provided as a command line argument, make a call
  const destination = process.argv[2];
  if (destination) {
    console.log(`Making call to ${destination}...`);
    await bridge.makeCall(destination);
  } else {
    console.log('Waiting for incoming calls...');
  }
}

// Run the main function
if (require.main === module) {
  main().catch(err => {
    console.error('Unhandled error:', err);
    process.exit(1);
  });
}

module.exports = UdpElevenLabsAsteriskBridge;