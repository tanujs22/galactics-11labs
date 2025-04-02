# ElevenLabs Asterisk Integration

This project implements a SIP client that connects to Asterisk/ViciDial and relays audio to ElevenLabs, enabling AI-powered voice calls.

## Features

- UDP-based SIP client that connects directly to Asterisk
- Bidirectional audio relay between Asterisk and ElevenLabs
- Supports µ-law 8000Hz audio format
- Works similar to a softphone like Zoiper

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Create a `.env` file based on `.env.example`:
   ```
   cp .env.example .env
   ```

3. Configure your environment variables in `.env`:
   - SIP_SERVER: Your Asterisk/ViciDial server
   - SIP_USERNAME: Your SIP extension
   - SIP_PASSWORD: Your SIP password
   - ELEVENLABS_AGENT_ID: Your ElevenLabs agent ID

## Usage

### Waiting for incoming calls:
```
npm run udp
```

### Making an outgoing call:
```
npm run udp 1234  # Replace 1234 with the destination number
```

## Architecture

The application has three main components:

1. **SIP Client** (`sip-client-alternative.js`): Handles SIP communication with Asterisk using UDP
2. **ElevenLabs Integration** (`calling.js`): Manages WebSocket communication with ElevenLabs
3. **Bridge** (`udp-integration.js`): Connects the SIP client and ElevenLabs, relaying audio between them

## Audio Flow

1. **Incoming Call to Asterisk**:
   - Asterisk → SIP Client → ElevenLabs → SIP Client → Asterisk

2. **Outgoing Call from Asterisk**:
   - SIP Client → Asterisk → SIP Client → ElevenLabs → SIP Client → Asterisk

## Notes

- This implementation focuses on establishing SIP connections over UDP
- Full RTP audio implementation requires additional development
- For a production deployment, you would need to implement the complete RTP handling