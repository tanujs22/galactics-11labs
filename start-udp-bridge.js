#!/usr/bin/env node
// Start script for the UDP-based SIP to ElevenLabs bridge
require('dotenv').config();
console.log("Loading environment from .env file...");
console.log("Current working directory:", process.cwd());

// Check if environment variables are loaded correctly
const envVars = [
  "SIP_SERVER", "SIP_USERNAME", "SIP_PASSWORD", "SIP_PORT", "LOCAL_PORT", "ELEVENLABS_AGENT_ID", "PORT"
];

console.log("Environment variables check:");
envVars.forEach(varName => {
  if (process.env[varName]) {
    console.log(`✓ ${varName} is defined: ${varName === "SIP_PASSWORD" ? "********" : process.env[varName]}`);
  } else {
    console.log(`✗ ${varName} is NOT defined!`);
  }
});

const UdpElevenLabsAsteriskBridge = require('./udp-integration');

async function main() {
  // Create banner
  console.log('\n===========================================================');
  console.log('          SIP TO ELEVENLABS BRIDGE - UDP VERSION');
  console.log('===========================================================');
  console.log('This script connects Asterisk SIP calls to ElevenLabs AI.');
  console.log('Call extension 222 to be connected to ElevenLabs.');
  console.log('Press Ctrl+C to exit.\n');
  
  // Create and initialize bridge
  const bridge = new UdpElevenLabsAsteriskBridge();
  
  // Handle shutdown signals
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await bridge.shutdown();
    process.exit(0);
  });
  
  // Initialize the bridge
  console.log('Initializing SIP <-> ElevenLabs bridge...');
  const initialized = await bridge.initialize();
  
  if (!initialized) {
    console.error('Failed to initialize bridge, exiting...');
    process.exit(1);
  }
  
  console.log('\n✓ Bridge initialized and ready for calls');
  console.log('Make a call to extension 222 on your Asterisk server');
  console.log('It should be routed to extension 7001 (this client)');
  console.log('The call will be connected to ElevenLabs AI');
}

// Run the main function
main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});