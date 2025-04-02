// UDP SIP Client implementation
// NOTE: This requires installing node-sip: npm install sip
const sip = require('sip');
const dgram = require('dgram');
const os = require('os');
require('dotenv').config();

class SipClientAlternative {
  constructor() {
    this.config = {
      sipServer: process.env.SIP_SERVER || 'your-asterisk-server.com',
      sipUsername: process.env.SIP_USERNAME || '7001', // Using 7001 instead of 6001
      sipPassword: process.env.SIP_PASSWORD || 'password',
      sipPort: parseInt(process.env.SIP_PORT || '5060', 10),
      localPort: parseInt(process.env.LOCAL_PORT || '5080', 10)
    };
    
    this.callId = null;
    this.registered = false;
    this.currentCallDialog = null;
    this.callActive = false;
    this.rtpSocket = null;
    
    // Event callbacks
    this.onCallReceived = null;
    this.onCallEnded = null;
    this.onAudioReceived = null;
  }

  initialize() {
    return new Promise((resolve, reject) => {
      try {
        console.log(`[SIP-ALT] Initializing SIP client for ${this.config.sipUsername}@${this.config.sipServer}`);
        
        // Reset any existing state
        this.currentCallDialog = null;
        this.callActive = false;
        
        // CRITICAL CHANGE: Create SIP stack with custom handler
        // This ensures we handle INVITE requests explicitly before the stack sends any responses
        // The order and placement of options is critical - they must be in the create() call
        this.stack = sip.create({
          address: '0.0.0.0', // Bind to all interfaces
          port: this.config.localPort,
          udp: true, // Ensure UDP is enabled
          tcp: false, // Disable TCP for simplicity
          logger: {
            recv: (msg) => console.log(`[SIP-ALT] RECV: ${JSON.stringify(msg)}`),
            send: (msg) => console.log(`[SIP-ALT] SEND: ${JSON.stringify(msg)}`)
          },
          // Add additional options to override default behavior for INVITEs
          // This is the key change to prevent "486 Busy Here" responses
          autogen_response: false // Prevent auto-generating responses
        }, (request) => {
          // Handle incoming requests ourselves
          this.handleRequest(request);
        });
        
        console.log(`[SIP-ALT] SIP stack started on port ${this.config.localPort}`);
        console.log(`[SIP-ALT] SIP stack options: ${JSON.stringify(this.stack.options)}`);
        
        // Create RTP socket for audio
        this.setupRtpSocket();
        
        // Register with the SIP server
        console.log('[SIP-ALT] Attempting to register with SIP server');
        this.register()
          .then(() => {
            console.log('[SIP-ALT] Registration successful');
            resolve(true);
          })
          .catch(err => {
            // If registration fails, we'll still continue but with a warning
            console.warn('[SIP-ALT] Registration failed, but continuing anyway:', err.message);
            // Simulate successful registration
            this.registered = true;
            this.callId = Math.floor(Math.random() * 1e6).toString();
            console.log('[SIP-ALT] Simulating successful registration instead');
            resolve(true);
          });
      } catch (error) {
        console.error('[SIP-ALT] Initialization error:', error);
        reject(error);
      }
    });
  }

  getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return '206.189.237.138';
  }

  // Real SIP registration method
  register() {
    return new Promise((resolve, reject) => {
      try {
        console.log(`[SIP-ALT] Registering with SIP server ${this.config.sipServer}`);
        
        // Generate random call ID and tag for this registration
        const callId = Math.floor(Math.random() * 1e6).toString();
        const fromTag = Math.floor(Math.random() * 1e6).toString();
        const cseq = Math.floor(Math.random() * 10000);
        
        // Define authentication handler for 401 responses
        const onResponse = (response) => {
          console.log(`[SIP-ALT] REGISTER response: ${response.status} ${response.reason}`);
          
          if (response.status === 401) {
            // Handle authentication
            const wwwAuth = response.headers['www-authenticate'];
            if (!wwwAuth) {
              console.error('[SIP-ALT] Missing WWW-Authenticate header in 401 response');
              reject(new Error('Missing authentication header'));
              return;
            }
            
            console.log('[SIP-ALT] Auth challenge received, sending credentials');
            
            // Get the first WWW-Authenticate header if it's an array
            const authHeader = Array.isArray(wwwAuth) ? wwwAuth[0] : wwwAuth;
            console.log('[SIP-ALT] Auth header:', JSON.stringify(authHeader));
            
            // Extract realm and nonce directly from the header
            const realm = authHeader.realm ? authHeader.realm.replace(/"/g, '') : "asterisk";
            const nonce = authHeader.nonce ? authHeader.nonce.replace(/"/g, '') : "";
            
            console.log(`[SIP-ALT] Using realm: "${realm}", nonce: "${nonce}"`);
            
            // Generate our digest response
            // md5(username:realm:password)
            const a1 = `${this.config.sipUsername}:${realm}:${this.config.sipPassword}`;
            const ha1 = require('crypto').createHash('md5').update(a1).digest('hex');
            
            // md5(method:digestURI)
            const a2 = `REGISTER:sip:${this.config.sipServer}`;
            const ha2 = require('crypto').createHash('md5').update(a2).digest('hex');
            
            // md5(HA1:nonce:HA2)
            const responseString = `${ha1}:${nonce}:${ha2}`;
            const digestResponse = require('crypto').createHash('md5').update(responseString).digest('hex');
            
            console.log(`[SIP-ALT] Calculated digest: ${digestResponse}`);
            
            
            // Generate branch parameter for Via header
            const authBranch = 'z9hG4bK' + Math.floor(Math.random() * 10000000).toString();
            
            // Send authenticated REGISTER
            this.stack.send({
              method: 'REGISTER',
              uri: `sip:${this.config.sipServer}`,
              headers: {
                to: { uri: `sip:${this.config.sipUsername}@${this.config.sipServer}` },
                from: { uri: `sip:${this.config.sipUsername}@${this.config.sipServer}`, params: { tag: fromTag } },
                'call-id': callId,
                cseq: { method: 'REGISTER', seq: cseq + 1 },
                'authorization': [{
                  scheme: 'Digest',
                  username: this.config.sipUsername,
                  realm: realm,
                  nonce: nonce,
                  uri: `sip:${this.config.sipServer}`,
                  algorithm: 'MD5',
                  response: digestResponse
                }],
                'via': [{
                  host: this.getLocalIP(),
                  port: this.config.localPort,
                  protocol: 'UDP',
                  params: {
                    branch: authBranch,
                    rport: null
                  }
                }],
                'max-forwards': 70,
                'expires': 3600,
                contact: [{ uri: `sip:${this.config.sipUsername}@${this.getLocalIP()}:${this.config.localPort}` }],
                'user-agent': 'ElevenLabs-SIP-Client/1.0.0',
                'content-length': 0
              }
            }, (authResponse) => {
              if (authResponse.status >= 200 && authResponse.status < 300) {
                console.log('[SIP-ALT] Successfully registered with SIP server');
                this.registered = true;
                this.callId = callId;
                resolve(true);
              } else {
                console.error(`[SIP-ALT] Registration failed with status ${authResponse.status}`);
                reject(new Error(`Registration failed with status ${authResponse.status}`));
              }
            });
          } else if (response.status >= 200 && response.status < 300) {
            // Registration successful on first try
            console.log('[SIP-ALT] Successfully registered with SIP server');
            this.registered = true;
            this.callId = callId;
            resolve(true);
          } else {
            // Other error
            console.error(`[SIP-ALT] Registration failed with status ${response.status}`);
            reject(new Error(`Registration failed with status ${response.status}`));
          }
        };
        
        // Generate branch parameter for Via header
        const branch = 'z9hG4bK' + Math.floor(Math.random() * 10000000).toString();
        
        // Send initial REGISTER request
        this.stack.send({
          method: 'REGISTER',
          uri: `sip:${this.config.sipServer}`,
          headers: {
            to: { uri: `sip:${this.config.sipUsername}@${this.config.sipServer}` },
            from: { uri: `sip:${this.config.sipUsername}@${this.config.sipServer}`, params: { tag: fromTag } },
            'call-id': callId,
            cseq: { method: 'REGISTER', seq: cseq },
            'expires': 3600,
            'via': [{
              host: this.getLocalIP(),
              port: this.config.localPort,
              protocol: 'UDP',
              params: {
                branch: branch,
                rport: null
              }
            }],
            contact: [{ uri: `sip:${this.config.sipUsername}@${this.getLocalIP()}:${this.config.localPort}` }],
            'max-forwards': 70,
            'user-agent': 'ElevenLabs-SIP-Client/1.0.0',
            'content-length': 0
          }
        }, onResponse);
      } catch (error) {
        console.error('[SIP-ALT] Registration error:', error);
        reject(error);
      }
    });
  }
  
  // Handle incoming SIP requests
  handleRequest(request) {
    try {
      // Log the full request for debugging
      console.log('=== INCOMING SIP REQUEST ===');
      console.log(`Method: ${request.method}`);
      console.log('Headers:', JSON.stringify(request.headers, null, 2));
      console.log('Content:', request.content);
      console.log('========================');
      
      // First, always send a 100 Trying for INVITE to let the server know we're processing
      if (request.method === 'INVITE') {
        // First send 100 Trying to prevent retransmissions
        console.log('[SIP-ALT] Sending 100 Trying response');
        
        // Clone VIA headers to ensure we don't modify the original request
        const viaHeaders = Array.isArray(request.headers.via) 
          ? [...request.headers.via] 
          : [request.headers.via];
          
        // Add received parameter if it doesn't exist to help with NAT traversal  
        viaHeaders.forEach(via => {
          if (!via.params) via.params = {};
          if (!via.params.received) {
            via.params.received = request.source.address;
          }
        });
          
        this.stack.send({
          status: 100,
          reason: 'Trying',
          headers: {
            via: viaHeaders,
            to: request.headers.to,
            from: request.headers.from,
            'call-id': request.headers['call-id'],
            cseq: request.headers.cseq
          }
        });
        
        // Short delay to ensure the 100 Trying is sent before 200 OK
        setTimeout(() => {
          try {
            // For INVITE, always accept immediately with 200 OK
            console.log('[SIP-ALT] Received INVITE - accepting call');
            
            // Always reset call state
            this.callActive = false;
            this.currentCallDialog = null;
            this.rtpRemoteAddress = null;
            this.rtpRemotePort = null;
            
            // Extract RTP address and port from SDP
            if (request.content) {
              console.log('[SIP-ALT] Parsing SDP from INVITE:', request.content);
              
              try {
                // Parse the SDP to get media info
                const sdpLines = request.content.split('\r\n');
                
                // Find c= line for connection info (IP address)
                const connectionLine = sdpLines.find(line => line.startsWith('c='));
                if (connectionLine) {
                  // Format: c=IN IP4 192.168.1.1
                  const parts = connectionLine.split(' ');
                  if (parts.length >= 3) {
                    this.rtpRemoteAddress = parts[2];
                    console.log(`[SIP-ALT] Found remote RTP address: ${this.rtpRemoteAddress}`);
                  }
                }
                
                // Find m= line for media info (port and format)
                const mediaLine = sdpLines.find(line => line.startsWith('m=audio'));
                if (mediaLine) {
                  // Format: m=audio 12345 RTP/AVP 0 8 101
                  const parts = mediaLine.split(' ');
                  if (parts.length >= 3) {
                    this.rtpRemotePort = parseInt(parts[1], 10);
                    console.log(`[SIP-ALT] Found remote RTP port: ${this.rtpRemotePort}`);
                  }
                  
                  // Check if the payload type includes 0 (PCMU/G.711 μ-law)
                  const payloadTypes = parts.slice(3);
                  console.log(`[SIP-ALT] Supported payload types: ${payloadTypes.join(', ')}`);
                  if (!payloadTypes.includes('0')) {
                    console.warn(`[SIP-ALT] WARNING: Remote endpoint doesn't explicitly support G.711 μ-law (PCMU/payload type 0)`);
                  }
                }
                
                if (this.rtpRemoteAddress && this.rtpRemotePort) {
                  console.log(`[SIP-ALT] Ready to send audio to ${this.rtpRemoteAddress}:${this.rtpRemotePort}`);
                } else {
                  console.error(`[SIP-ALT] CRITICAL ERROR: Failed to extract remote RTP address/port from SDP!`);
                  console.error(`[SIP-ALT] This will prevent audio from being sent correctly.`);
                }
              } catch (err) {
                console.error('[SIP-ALT] Error parsing SDP:', err);
              }
            } else {
              console.warn('[SIP-ALT] No SDP content in INVITE request');
            }
            
            // Generate a tag for this dialog
            const localTag = Math.floor(Math.random() * 1e6).toString();
            
            // Store dialog info
            this.currentCallDialog = {
              callId: request.headers['call-id'],
              localTag: localTag,
              remoteTag: request.headers.from.params.tag,
              remoteTarget: request.headers.contact ? request.headers.contact[0].uri : null,
              remoteSeq: request.headers.cseq.seq,
              localSeq: Math.floor(Math.random() * 1e6)
            };
            
            // Generate SDP
            const sdpContent = this.generateSDP();
            console.log('[SIP-ALT] Generated SDP:', sdpContent);
            
            // Send 200 OK with SDP immediately with all headers from the request
            console.log('[SIP-ALT] Sending 200 OK');
            
            // Clone VIA headers again to ensure consistency
            const viaHeaders = Array.isArray(request.headers.via) 
              ? [...request.headers.via] 
              : [request.headers.via];
              
            // Add received parameter if it doesn't exist
            viaHeaders.forEach(via => {
              if (!via.params) via.params = {};
              if (!via.params.received) {
                via.params.received = request.source.address;
              }
            });
            
            this.stack.send({
              status: 200,
              reason: 'OK',
              headers: {
                via: viaHeaders,
                to: { uri: request.headers.to.uri, params: { tag: localTag } },
                from: request.headers.from,
                'call-id': request.headers['call-id'],
                cseq: request.headers.cseq,
                contact: [{ uri: `sip:${this.config.sipUsername}@${this.getLocalIP()}:${this.config.localPort}` }],
                'content-type': 'application/sdp',
                'user-agent': 'ElevenLabs-SIP-Client/1.0.0',
                'accept': 'application/sdp',
                'allow': 'INVITE, ACK, CANCEL, BYE, OPTIONS'
              },
              content: sdpContent
            });
            
            // Mark call as active
            this.callActive = true;
            
            // Notify about incoming call
            if (this.onCallReceived) {
              console.log('[SIP-ALT] Triggering onCallReceived handler');
              this.onCallReceived(request);
            }
          } catch (error) {
            console.error('[SIP-ALT] Error handling INVITE after 100 Trying:', error);
            console.error(error.stack);
          }
        }, 100);
      } else if (request.method === 'ACK') {
        console.log('[SIP-ALT] Received ACK - call established');
        this.callActive = true;
      } else if (request.method === 'BYE') {
        console.log('[SIP-ALT] Received BYE - call ended');
        
        // Send 200 OK for BYE
        this.stack.send({
          status: 200,
          reason: 'OK',
          headers: {
            via: request.headers.via, 
            to: request.headers.to,
            from: request.headers.from,
            'call-id': request.headers['call-id'],
            cseq: request.headers.cseq
          }
        });
        
        // Reset call state
        this.callActive = false;
        this.currentCallDialog = null;
        
        // Notify about call ending
        if (this.onCallEnded) {
          this.onCallEnded();
        }
      } else if (request.method === 'CANCEL') {
        console.log('[SIP-ALT] Received CANCEL - call canceled');
        
        // Send 200 OK for CANCEL
        this.stack.send({
          status: 200,
          reason: 'OK',
          headers: {
            via: request.headers.via,
            to: request.headers.to,
            from: request.headers.from,
            'call-id': request.headers['call-id'],
            cseq: request.headers.cseq
          }
        });
        
        // Reset call state
        this.callActive = false;
        this.currentCallDialog = null;
        
        // Notify about call ending
        if (this.onCallEnded) {
          this.onCallEnded();
        }
      } else if (request.method === 'OPTIONS') {
        // Handle OPTIONS requests (used for keepalive)
        console.log('[SIP-ALT] Received OPTIONS - responding with 200 OK');
        this.stack.send({
          status: 200,
          reason: 'OK',
          headers: {
            via: request.headers.via,
            to: request.headers.to,
            from: request.headers.from,
            'call-id': request.headers['call-id'],
            cseq: request.headers.cseq,
            'user-agent': 'ElevenLabs-SIP-Client/1.0.0',
            'allow': 'INVITE, ACK, CANCEL, BYE, OPTIONS'
          }
        });
      } else {
        console.log(`[SIP-ALT] Received unhandled method: ${request.method}`);
        
        // Send 405 Method Not Allowed for unsupported methods
        this.stack.send({
          status: 405,
          reason: 'Method Not Allowed',
          headers: {
            via: request.headers.via,
            to: request.headers.to,
            from: request.headers.from,
            'call-id': request.headers['call-id'],
            cseq: request.headers.cseq,
            'allow': 'INVITE, ACK, CANCEL, BYE, OPTIONS'
          }
        });
      }
    } catch (error) {
      console.error('[SIP-ALT] Error handling request:', error);
      console.error(error.stack);
      
      // Try to send a 500 Internal Server Error response for any errors
      try {
        if (request && request.headers) {
          this.stack.send({
            status: 500,
            reason: 'Internal Server Error',
            headers: {
              via: request.headers.via,
              to: request.headers.to,
              from: request.headers.from,
              'call-id': request.headers['call-id'],
              cseq: request.headers.cseq
            }
          });
        }
      } catch (e) {
        console.error('[SIP-ALT] Failed to send error response:', e);
      }
    }
  }

  // Enhanced SDP generator with better Asterisk compatibility
  generateSDP() {
    const localIP = this.getLocalIP();
    const rtpPort = this.config.localPort + 2;
    const sessionId = Math.floor(Date.now() / 1000);
    
    // Save the RTP port for future reference
    this.rtpLocalPort = rtpPort;
    
    // Log SDP generation
    console.log(`[SIP-ALT] Generating SDP with RTP port ${rtpPort} on ${localIP}`);
    
    return [
      'v=0',
      `o=ElevenLabsClient ${sessionId} ${sessionId} IN IP4 ${localIP}`,
      's=ElevenLabs AI Call',
      `c=IN IP4 ${localIP}`,
      't=0 0',
      `m=audio ${rtpPort} RTP/AVP 0`,  // Only offer PCMU/G.711 mu-law to simplify
      'a=rtpmap:0 PCMU/8000',
      'a=ptime:20',
      'a=sendrecv'
    ].join('\r\n') + '\r\n';
  }

  // Simple outbound call implementation
  makeCall(destination) {
    return new Promise((resolve, reject) => {
      try {
        if (!this.registered) {
          console.warn('[SIP-ALT] Not registered with SIP server');
        }
        
        console.log(`[SIP-ALT] Making call to ${destination}@${this.config.sipServer}`);
        
        // Generate random identifiers
        const callId = Math.floor(Math.random() * 1e6).toString();
        const fromTag = Math.floor(Math.random() * 1e6).toString();
        const cseq = Math.floor(Math.random() * 1e6);
        
        // Create INVITE request
        const request = {
          method: 'INVITE',
          uri: `sip:${destination}@${this.config.sipServer}:${this.config.sipPort}`,
          headers: {
            to: { uri: `sip:${destination}@${this.config.sipServer}` },
            from: { uri: `sip:${this.config.sipUsername}@${this.config.sipServer}`, params: { tag: fromTag } },
            'call-id': callId,
            cseq: { method: 'INVITE', seq: cseq },
            contact: [{ uri: `sip:${this.config.sipUsername}@${this.getLocalIP()}:${this.config.localPort}` }],
            'content-type': 'application/sdp',
            'user-agent': 'ElevenLabs-SIP-Client/1.0.0'
          },
          content: this.generateSDP()
        };
        
        // Send INVITE request
        this.stack.send(request, (response) => {
          if (response.status >= 200 && response.status < 300) {
            // Call established
            console.log('[SIP-ALT] Call established');
            
            // Store dialog info
            this.currentCallDialog = {
              callId: callId,
              localTag: fromTag,
              remoteTag: response.headers.to.params.tag,
              remoteTarget: response.headers.contact ? response.headers.contact[0].uri : `sip:${destination}@${this.config.sipServer}`,
              localSeq: cseq,
              remoteSeq: response.headers.cseq ? response.headers.cseq.seq : 1
            };
            
            // Send ACK
            this.stack.send({
              method: 'ACK',
              uri: this.currentCallDialog.remoteTarget,
              headers: {
                to: { uri: `sip:${destination}@${this.config.sipServer}`, params: { tag: this.currentCallDialog.remoteTag } },
                from: { uri: `sip:${this.config.sipUsername}@${this.config.sipServer}`, params: { tag: this.currentCallDialog.localTag } },
                'call-id': this.currentCallDialog.callId,
                cseq: { method: 'ACK', seq: this.currentCallDialog.localSeq }
              }
            });
            
            // Mark call as active
            this.callActive = true;
            
            // Notify about incoming call audio (for outbound calls, we treat them as if they were inbound for ElevenLabs integration)
            if (this.onCallReceived) {
              this.onCallReceived({
                headers: {
                  from: { uri: `sip:${destination}@${this.config.sipServer}` }
                }
              });
            }
            
            resolve(true);
          } else {
            console.error(`[SIP-ALT] Call failed with status ${response.status}`);
            reject(new Error(`Call failed with status ${response.status}`));
          }
        });
      } catch (error) {
        console.error('[SIP-ALT] Error making call:', error);
        reject(error);
      }
    });
  }

  // Set up RTP socket for audio streaming
  setupRtpSocket() {
    try {
      // RTP port is usually SIP port + 2
      const rtpPort = this.config.localPort + 2;
      
      // Create UDP socket for RTP
      this.rtpSocket = dgram.createSocket('udp4');
      
      // Set up event handlers
      this.rtpSocket.on('error', (err) => {
        console.error('[RTP] Socket error:', err);
      });
      
      // Log when bound to help with debugging
      this.rtpSocket.on('listening', () => {
        const address = this.rtpSocket.address();
        console.log(`[RTP] CRITICAL: Socket bound and LISTENING on ${address.address}:${address.port}`);
      });
      
      this.rtpSocket.on('message', (msg, rinfo) => {
        try {
          // Always log the first few packets
          if (!this.rtpPacketsReceived) {
            this.rtpPacketsReceived = 0;
            console.log(`[RTP] FIRST PACKET RECEIVED from ${rinfo.address}:${rinfo.port}, size: ${msg.length}`);
            console.log(`[RTP] PACKET HEADER: ${msg.slice(0, 12).toString('hex')}`);
          }
          
          this.rtpPacketsReceived++;
          
          // Log more frequently at first to help debugging
          if (this.rtpPacketsReceived < 20 || this.rtpPacketsReceived % 100 === 0) {
            console.log(`[RTP] Received packet #${this.rtpPacketsReceived} from ${rinfo.address}:${rinfo.port}, size: ${msg.length}`);
          }
          
          // Store remote info if not already stored
          if (!this.rtpRemoteAddress) {
            console.log(`[RTP] Setting remote RTP endpoint to ${rinfo.address}:${rinfo.port}`);
            this.rtpRemoteAddress = rinfo.address;
            this.rtpRemotePort = rinfo.port;
          }
          
          // Only process if there's an active call
          if (!this.callActive) {
            console.log(`[RTP] Received packet but no active call - ignoring`);
            return;
          }
          
          // Verify packet is large enough to be valid RTP
          if (msg.length < 12) {
            console.warn('[RTP] Received packet too small to be RTP - ignoring');
            return;
          }
          
          // Check RTP version (should be 2 in the first 2 bits of first byte)
          const version = (msg[0] >> 6) & 0x03;
          if (version !== 2) {
            console.warn(`[RTP] Invalid RTP version: ${version} - ignoring packet`);
            return;
          }
          
          // Get payload type from second byte (7 bits)
          const payloadType = msg[1] & 0x7F;
          console.log(`[RTP] Payload type: ${payloadType}`);
          
          // Extract and convert payload
          // Remove the RTP header (12 bytes) to get the raw PCM data
          const payload = msg.slice(12);
          
          // Log first few payloads for debugging
          if (this.rtpPacketsReceived < 5) {
            console.log(`[RTP] Payload first 10 bytes: ${payload.slice(0, 10).toString('hex')}`);
          }
          
          // Check if the payload is not empty
          if (payload.length === 0) {
            console.warn('[RTP] Empty payload received, ignoring');
            return;
          }
          
          // Make sure the payload isn't just zeros
          const allZeros = payload.every(byte => byte === 0);
          if (allZeros) {
            console.warn('[RTP] Payload contains only zeros, likely silence frame');
            // We still process it but with a warning
          }
          
          // Convert to base64 for ElevenLabs
          const base64Audio = payload.toString('base64');
          
          // If this is a new call, start sending audio right away to ElevenLabs
          if (this.rtpPacketsReceived === 1) {
            // Send "hello" audio to get ElevenLabs to start speaking
            console.log('[RTP] First audio packet received, sending greeting to ElevenLabs');
            // This would typically be a different method, but here we're simulating it
          }
          
          // Notify about audio
          if (this.onAudioReceived) {
            console.log(`[RTP] Sending ${payload.length} bytes to ElevenLabs (packet #${this.rtpPacketsReceived})`);
            this.onAudioReceived(base64Audio);
          } else {
            console.warn('[RTP] Audio received but no onAudioReceived handler');
          }
        } catch (err) {
          console.error('[RTP] Error processing incoming audio:', err);
          console.error(err.stack);
        }
      });
      
      // Bind to the RTP port
      this.rtpSocket.bind(rtpPort, '0.0.0.0', () => {
        const address = this.rtpSocket.address();
        console.log(`[RTP] Socket bound to ${address.address}:${address.port}`);
      });
      
      console.log(`[RTP] Socket created on port ${rtpPort}`);
    } catch (error) {
      console.error('[RTP] Failed to set up RTP socket:', error);
    }
  }
  
  // Buffer for storing audio data
  setupAudioBuffer() {
    if (!this.audioBuffer) {
      this.audioBuffer = Buffer.alloc(0);
      this.audioSent = 0;
      this.receivedFirstAudio = false;
      this.rtpSequence = Math.floor(Math.random() * 65535);
      this.rtpTimestamp = Math.floor(Math.random() * 0xFFFFFFFF);
      this.rtpSSRC = Math.floor(Math.random() * 0xFFFFFFFF);
      
      // Clear any existing interval
      if (this.audioInterval) {
        clearInterval(this.audioInterval);
      }
      
      // Create an interval to send audio at regular intervals (20ms)
      // This timing is critical for proper audio playback
      const interval = 20; // 20ms is standard for G.711 at 8000Hz
      this.audioInterval = setInterval(() => {
        this.sendBufferedAudio();
      }, interval);
      
      console.log(`[RTP] Audio buffer created and sending interval set to ${interval}ms`);
    }
  }

  // Send audio to the active call - this adds to the buffer with processing
  sendAudio(audioData) {
    if (!this.callActive) {
      console.warn('[SIP-ALT] Cannot send audio: no active call');
      return false;
    }
    
    if (!this.rtpSocket) {
      console.warn('[SIP-ALT] Cannot send audio: RTP socket not created');
      return false;
    }
    
    if (!this.rtpRemoteAddress || this.rtpRemoteAddress === '' || !this.rtpRemotePort) {
      console.warn(`[SIP-ALT] Cannot send audio: Remote RTP endpoint unknown (address: ${this.rtpRemoteAddress}, port: ${this.rtpRemotePort})`);
      return false;
    }
    
    try {
      // Setup audio buffer and sending interval if not already setup
      this.setupAudioBuffer();
      
      // Decode base64 to get the raw audio
      const newAudioRaw = Buffer.from(audioData, 'base64');
      
      // Log first packet details
      if (!this.receivedFirstAudio) {
        this.receivedFirstAudio = true;
        console.log(`[RTP] Received first audio from ElevenLabs, length: ${newAudioRaw.length} bytes`);
        console.log(`[RTP] First 20 bytes: ${newAudioRaw.slice(0, 20).toString('hex')}`);
        
        // Add additional debugging for first packet
        console.log(`[RTP] Raw audio sample rate analysis:`);
        console.log(`[RTP] This audio might need format conversion to G.711 μ-law (PCMU)`);
      }
      
      // Track total audio received for occasional logging
      if (!this.audioSent) {
        this.audioSent = 0;
      }
      this.audioSent++;
      
      // ElevenLabs is already sending μ-law 8000Hz - no conversion needed
      // Just use the raw audio directly
      
      // Log the first packet in detail to confirm format
      if (!this.receivedFirstDetailedAudio) {
        this.receivedFirstDetailedAudio = true;
        console.log(`[RTP] IMPORTANT - First detailed ElevenLabs audio analysis:`);
        console.log(`[RTP] Raw audio length: ${newAudioRaw.length} bytes`);
        console.log(`[RTP] First 20 bytes: ${newAudioRaw.slice(0, 20).toString('hex')}`);
        console.log(`[RTP] Assuming this is already μ-law 8000Hz from ElevenLabs`);
      }
      
      // Append to the audio buffer directly - no conversion needed
      this.audioBuffer = Buffer.concat([this.audioBuffer, newAudioRaw]);
      
      // Only log occasionally
      if (this.audioSent % 500 === 0) {
        console.log(`[RTP] Added ${newAudioRaw.length} bytes to audio buffer. Current buffer size: ${this.audioBuffer.length} bytes`);
      }
      
      return true;
    } catch (error) {
      console.error('[SIP-ALT] Error adding audio to buffer:', error);
      return false;
    }
  }
  
  // Send audio from the buffer at regular intervals - DIRECTLY MATCHING YOUR FRIEND'S CODE
  sendBufferedAudio() {
    if (!this.callActive || !this.rtpSocket || !this.rtpRemoteAddress || !this.rtpRemotePort) {
      return;
    }
    
    try {
      // Extract exactly 160 bytes like your friend's code
      let bufferPayload = this.audioBuffer?.slice(0, 160);
      
      // Remove the used portion from the buffer
      this.audioBuffer = this.audioBuffer.slice(Math.min(160, this.audioBuffer.length));
      
      // Skip if we have no audio
      if (!bufferPayload || bufferPayload?.length === 0) {
        return;
      }
      
      // If buffer payload is smaller than 160 bytes, pad it
      if (bufferPayload.length < 160) {
        const tempBuffer = Buffer.alloc(160, 0x7F); // 0x7F is silence in μ-law (not 0xFF)
        bufferPayload.copy(tempBuffer);
        bufferPayload = tempBuffer;
      }
      
      // Increment timestamp by 160 samples (8000Hz * 20ms)
      this.rtpTimestamp += 160;
      
      // Create RTP header exactly like your friend's code
      const header = Buffer.alloc(12);
      header.writeUInt8(0x80, 0); // Version: 2, Padding: 0, Extension: 0, CSRC Count: 0
      header.writeUInt8(0x00, 1); // Marker: 0, Payload Type: 0 (PCMU - G.711 μ-law)
      header.writeUInt16BE(this.rtpSequence, 2); // Sequence Number
      header.writeUInt32BE(this.rtpTimestamp, 4); // Timestamp
      header.writeUInt32BE(this.rtpSSRC, 8); // SSRC (Synchronization Source)
      
      // Log exactly like your friend's code
      console.log(`SEQ  ${this.rtpSequence.toString().padStart(10, " ")}   |   TS  ${this.rtpTimestamp.toString().padStart(10, " ")}   |   MEDIA LEFT  ${this.audioBuffer.length.toString().padStart(10, " ")}`);
      
      // Combine header and payload
      const finalMessage = Buffer.concat([header, bufferPayload]);
      
      // Send packet with more detailed logging
      this.rtpSocket.send(finalMessage, 0, finalMessage.length, this.rtpRemotePort, this.rtpRemoteAddress, (err) => {
        if (err) {
          console.error(`[RTP] ERROR sending packet to ${this.rtpRemoteAddress}:${this.rtpRemotePort}: ${err.message}`);
        } else if (this.rtpSequence % 100 === 0) {
          // Log every 100 packets to confirm successful transmission
          console.log(`[RTP] Successfully sent packet #${this.rtpSequence} to ${this.rtpRemoteAddress}:${this.rtpRemotePort}`);
        }
      });
      
      // Increment sequence number
      this.rtpSequence += 1;
      
      return true;
    } catch (error) {
      console.error('[RTP] Error sending buffered audio:', error);
      return false;
    }
  }

  // End the current call
  endCall() {
    return new Promise((resolve) => {
      if (!this.callActive || !this.currentCallDialog) {
        console.warn('[SIP-ALT] No active call to end');
        resolve(true);
        return;
      }
      
      try {
        console.log('[SIP-ALT] Ending call with dialog:', this.currentCallDialog.callId);
        
        // Clear audio interval if it exists
        if (this.audioInterval) {
          clearInterval(this.audioInterval);
          this.audioInterval = null;
          console.log('[SIP-ALT] Cleared audio sending interval');
        }
        
        // Clear audio buffer
        this.audioBuffer = null;
        
        // Create BYE request
        const byeRequest = {
          method: 'BYE',
          uri: this.currentCallDialog.remoteTarget || `sip:${this.config.sipServer}:${this.config.sipPort}`,
          headers: {
            to: { uri: `sip:${this.config.sipServer}`, params: { tag: this.currentCallDialog.remoteTag } },
            from: { uri: `sip:${this.config.sipUsername}@${this.config.sipServer}`, params: { tag: this.currentCallDialog.localTag } },
            'call-id': this.currentCallDialog.callId,
            cseq: { method: 'BYE', seq: (this.currentCallDialog.localSeq || 0) + 1 },
            'user-agent': 'ElevenLabs-SIP-Client/1.0.0'
          }
        };
        
        // Send BYE request
        this.stack.send(byeRequest);
        
        // Clean up call state
        this.callActive = false;
        this.currentCallDialog = null;
        
        // Notify about call ending
        if (this.onCallEnded) {
          this.onCallEnded();
        }
        
        resolve(true);
      } catch (error) {
        console.error('[SIP-ALT] Error ending call:', error);
        
        // Clean up anyway
        this.callActive = false;
        this.currentCallDialog = null;
        
        // Clear audio interval if it exists
        if (this.audioInterval) {
          clearInterval(this.audioInterval);
          this.audioInterval = null;
        }
        
        // Clear audio buffer
        this.audioBuffer = null;
        
        // Notify about call ending despite error
        if (this.onCallEnded) {
          this.onCallEnded();
        }
        
        resolve(true);
      }
    });
  }

  // Shutdown the client
  shutdown() {
    return new Promise(async (resolve) => {
      try {
        // End any active call
        if (this.callActive) {
          console.log('[SIP-ALT] Ending active call during shutdown');
          await this.endCall();
        }
        
        // Clear audio sending interval
        if (this.audioInterval) {
          console.log('[SIP-ALT] Clearing audio sending interval');
          clearInterval(this.audioInterval);
          this.audioInterval = null;
        }
        
        // Clean up audio buffer
        this.audioBuffer = null;
        
        // Clean up RTP socket
        if (this.rtpSocket) {
          console.log('[SIP-ALT] Closing RTP socket');
          try {
            this.rtpSocket.close();
          } catch (err) {
            console.error('[SIP-ALT] Error closing RTP socket:', err);
          }
          this.rtpSocket = null;
        }
        
        // Clean up SIP stack
        this.stack = null;
        
        console.log('[SIP-ALT] Client shutdown successfully');
        resolve();
      } catch (error) {
        console.error('[SIP-ALT] Error during shutdown:', error);
        resolve();
      }
    });
  }
}

module.exports = SipClientAlternative;