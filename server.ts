import express from 'express';
import path from 'path';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import dgram from 'dgram';
import { createServer as createViteServer } from 'vite';

const PORT = 3000;
const app = express();
const httpServer = http.createServer(app);

// Use a single UDP socket for all outgoing streams
const udpSocket = dgram.createSocket('udp4');

// Bind error handler to the UDP client to prevent system crashes
udpSocket.on('error', (err) => {
  console.error('UDP Socket error:', err.message);
});

// Art-Net sequence counter
let artnetSeq = 0;
let ddpSeq = 0;
let e131Seq = 0;

// Set up WebSocket server attached to the HTTP server
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws: WebSocket) => {
  console.log('Client connected to WLED Video Sync WebSocket');

  ws.on('message', (message: string) => {
    try {
      const data = JSON.parse(message);
      const { ip, port, protocol, pixels } = data;

      if (!ip || !pixels || !Array.isArray(pixels)) return;

      const targetPort = Number(port) || (protocol === 'DDP' ? 4048 : protocol === 'Art-Net' ? 6454 : protocol === 'E1.31' ? 5568 : 21324);
      let buffer: Buffer;

      if (protocol === 'DDP') {
        // Build DDP Packet
        // Header is 10 bytes:
        // Byte 0: flags (0x40 means DDP Frame, no timecode. 0x01 in lower indicates sequence is present) -> 0x41
        // Byte 1: sequence number (1-15 loop)
        // Byte 2: control/type (0x01 means RGB)
        // Byte 3: destination ID (0x01)
        // Byte 4-7: offset in bytes (0) -> [0, 0, 0, 0]
        // Byte 8-9: length of RGB data in bytes (big endian)
        const ddpHeader = Buffer.alloc(10);
        ddpSeq = (ddpSeq + 1) % 15;
        if (ddpSeq === 0) ddpSeq = 1;

        ddpHeader.writeUInt8(0x41, 0); // Flags
        ddpHeader.writeUInt8(ddpSeq, 1); // Sequence
        ddpHeader.writeUInt8(0x01, 2); // Data type (RGB)
        ddpHeader.writeUInt8(0x01, 3); // Destination ID
        ddpHeader.writeUInt32BE(0, 4); // Pixel offset

        const len = pixels.length;
        ddpHeader.writeUInt16BE(len, 8); // Data length

        const rgbData = Buffer.from(pixels);
        buffer = Buffer.concat([ddpHeader, rgbData]);

      } else if (protocol === 'DRGB') {
        // Build DRGB Packet (port 21324)
        // Byte 0: 0x02 (DRGB identifier)
        // Byte 1: Timeout in seconds (default 2)
        // Bytes 2+: raw RGB pixels
        const header = Buffer.alloc(2);
        header.writeUInt8(0x02, 0);
        header.writeUInt8(0x02, 1); // 2 seconds timeout

        const rgbData = Buffer.from(pixels);
        buffer = Buffer.concat([header, rgbData]);

      } else if (protocol === 'WARLS') {
        // Build WARLS Packet (port 21324)
        // Byte 0: 0x01 (WARLS identifier)
        // Byte 1: Timeout (2 seconds)
        // Bytes 2+: triplets of [index, R, G, B]
        // Note: WLED indexes up to 255.
        const header = Buffer.alloc(2);
        header.writeUInt8(0x01, 0);
        header.writeUInt8(0x02, 1);

        const ledCount = Math.min(Math.floor(pixels.length / 3), 256);
        const warlsData = Buffer.alloc(ledCount * 4);
        for (let i = 0; i < ledCount; i++) {
          const offset = i * 4;
          const pxOffset = i * 3;
          warlsData.writeUInt8(i, offset); // LED Index
          warlsData.writeUInt8(pixels[pxOffset], offset + 1); // Red
          warlsData.writeUInt8(pixels[pxOffset + 1], offset + 2); // Green
          warlsData.writeUInt8(pixels[pxOffset + 2], offset + 3); // Blue
        }

        buffer = Buffer.concat([header, warlsData]);

      } else if (protocol === 'Art-Net') {
        // Build ArtDmx Packet (port 6454)
        // Bytes 0-7: "Art-Net\0"
        // Bytes 8-9: Opcode 0x5000 (little endian: [0x00, 0x50])
        // Bytes 10-11: Protocol version (0x00, 0x0E) (version 14)
        // Byte 12: Sequence (0x01-0xFF, or 0x00 to disable sequence check)
        // Byte 13: Physical (0x00)
        // Bytes 14-15: Universe (0-15, e.g. 0)
        // Bytes 16-17: Quantity of registers / Length of DMX channels (2 to 512, big-endian)
        // Bytes 18+: raw DMX bytes (mapped to R, G, B, R, G, B...)
        const artHeader = Buffer.alloc(18);
        artnetSeq = (artnetSeq + 1) & 0xFF;

        artHeader.write('Art-Net\0', 0, 'ascii'); // Header
        artHeader.writeUInt16LE(0x5000, 8); // Opcode ArtDmx
        artHeader.writeUInt16BE(14, 10); // Proto Version
        artHeader.writeUInt8(artnetSeq, 12); // Sequence
        artHeader.writeUInt8(0, 13); // Physical port
        artHeader.writeUInt16LE(0, 14); // Universe index (0)

        // Art-Net universes support up to 512 channels. Crop the channels to 512.
        const channelCount = Math.min(pixels.length, 512);
        artHeader.writeUInt16BE(channelCount, 16); // Content length

        const dmxData = Buffer.from(pixels.slice(0, channelCount));
        buffer = Buffer.concat([artHeader, dmxData]);
      } else if (protocol === 'E1.31') {
        // Build sACN (E1.31) Data Packet (port 5568)
        // Total header is 126 bytes
        const e131Header = Buffer.alloc(126);
        e131Seq = (e131Seq + 1) & 0xFF;

        const channels = Math.min(pixels.length, 512);

        // --- Root Layer ---
        e131Header.writeUInt16BE(0x0010, 0); // Preamble size
        e131Header.writeUInt16BE(0x0000, 2); // Post-amble size
        e131Header.write('ASC-E1.17\0\0\0', 4, 12, 'ascii'); // Packet Identifier
        e131Header.writeUInt16BE(0x7000 | (110 + channels), 16); // Flags & Length (Root Layer)
        e131Header.writeUInt32BE(0x00000004, 18); // Vector (Root Vector for Data Packet)
        
        // CID (Component Identifier - 16 bytes unique ID)
        const cid = Buffer.from([0x2d, 0x8a, 0x48, 0x11, 0xe0, 0x9c, 0x4d, 0x9e, 0xb8, 0xd0, 0xa1, 0x58, 0xd4, 0x07, 0xf0, 0x36]);
        cid.copy(e131Header, 22);

        // --- Framing Layer ---
        e131Header.writeUInt16BE(0x7000 | (88 + channels), 38); // Flags & Length (Framing Layer)
        e131Header.writeUInt32BE(0x00000002, 40); // Vector (sACN vector)
        e131Header.write('WLED Video Sync', 44, 64, 'ascii'); // Source Name (max 64 bytes)
        e131Header.writeUInt8(100, 108); // Priority (0-200, default 100)
        e131Header.writeUInt16BE(0x0000, 109); // Synchronization Address (0 to disable)
        e131Header.writeUInt8(e131Seq, 111); // Sequence Number
        e131Header.writeUInt8(0, 112); // Options
        e131Header.writeUInt16BE(1, 113); // Universe (Default inside WLED is 1)

        // --- DMP Layer ---
        e131Header.writeUInt16BE(0x7000 | (11 + channels), 115); // Flags & Length (DMP Layer)
        e131Header.writeUInt8(0x02, 117); // Vector
        e131Header.writeUInt8(0xa1, 118); // Address Type & Data Type
        e131Header.writeUInt16BE(0x0000, 119); // First Property Address
        e131Header.writeUInt16BE(0x0001, 121); // Address Increment
        e131Header.writeUInt16BE(channels + 1, 123); // Property value count
        e131Header.writeUInt8(0x00, 125); // DMX Start Code (0x00)

        const dmxData = Buffer.from(pixels.slice(0, channels));
        buffer = Buffer.concat([e131Header, dmxData]);
      } else {
        return;
      }

      // Send the formulated buffer over UDP to WLED
      udpSocket.send(buffer, targetPort, ip, (err) => {
        if (err) {
          // Silent local network catch to prevent server terminal scroll pollution
        }
      });

    } catch (err: any) {
      // Catch syntax errors or malformed frames safely
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected from WLED Video Sync WebSocket');
  });
});

// Handle WebSocket upgrade manually
httpServer.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;

  if (pathname === '/api/video-sync') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', udpSocketActive: true });
});

async function startServer() {
  // Vite integration
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
