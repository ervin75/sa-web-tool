#!/usr/bin/env node
/**
 * SA Web Tool — Local Agent
 *
 * A lightweight TCP proxy that bridges SSH connections from the VPS
 * web interface to servers on your local network.
 *
 * Zero npm dependencies — requires only Node.js 22+.
 *
 * Usage:
 *   node agent.js --url wss://your-domain.com/ws/agent --token YOUR_SECRET_TOKEN
 *
 * Environment variables (alternative to CLI args):
 *   AGENT_URL   - WebSocket URL of the VPS (e.g. wss://your-domain.com/ws/agent)
 *   AGENT_TOKEN - Shared secret token for authentication
 */

'use strict';

// --- Node.js version check ---
const [major] = process.versions.node.split('.').map(Number);
if (major < 22) {
  console.error(`Error: Node.js 22 or later is required (you have v${process.version})`);
  console.error('Download the latest LTS from https://nodejs.org/');
  process.exit(1);
}

const net = require('net');

// --- Parse arguments ---
const args = process.argv.slice(2);
let url, token;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--url' && args[i + 1]) url = args[++i];
  else if (args[i] === '--token' && args[i + 1]) token = args[++i];
  else if (args[i] === '--help' || args[i] === '-h') {
    console.log('SA Web Tool — Local Agent');
    console.log('');
    console.log('Usage: node agent.js --url <wss://...> --token <secret>');
    console.log('');
    console.log('Options:');
    console.log('  --url    WebSocket URL of the VPS (or set AGENT_URL env var)');
    console.log('  --token  Authentication token (or set AGENT_TOKEN env var)');
    console.log('  --help   Show this help message');
    process.exit(0);
  }
}

url = url || process.env.AGENT_URL;
token = token || process.env.AGENT_TOKEN;

if (!url || !token) {
  console.error('Error: --url and --token are required.');
  console.error('Run "node agent.js --help" for usage information.');
  process.exit(1);
}

// Append token to URL
const connectUrl = url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);

// --- State ---
const tunnels = new Map();
let ws = null;
let reconnectDelay = 2000;
let reconnectTimer = null;
let stopping = false;

// --- Logging ---
function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] ${msg}`);
}

// --- Connection ---
function connect() {
  if (stopping) return;

  log('Connecting to ' + url.replace(/\?.*/, '') + '...');

  ws = new WebSocket(connectUrl);

  ws.onopen = () => {
    log('Connected to VPS');
    reconnectDelay = 2000; // Reset backoff
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleMessage(msg);
    } catch (e) {
      log('Error parsing message: ' + e.message);
    }
  };

  ws.onclose = (event) => {
    ws = null;

    // Clean up all active tunnels
    for (const [id, socket] of tunnels) {
      socket.destroy();
    }
    tunnels.clear();

    if (stopping) {
      log('Disconnected');
      return;
    }

    const reason = event.code === 4001 ? ' (replaced by another agent)' : '';
    log(`Disconnected${reason}. Reconnecting in ${reconnectDelay / 1000}s...`);
    reconnectTimer = setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  };

  ws.onerror = () => {
    // onclose will fire after this, which handles reconnection
  };
}

// --- Message handler ---
function handleMessage(msg) {
  if (msg.type === 'tunnel') {
    openTunnel(msg.id, msg.host, msg.port);
    return;
  }

  if (msg.type === 'data') {
    const socket = tunnels.get(msg.id);
    if (socket) socket.write(Buffer.from(msg.data, 'base64'));
    return;
  }

  if (msg.type === 'end') {
    const socket = tunnels.get(msg.id);
    if (socket) {
      socket.end();
      tunnels.delete(msg.id);
    }
  }
}

// --- Open TCP tunnel ---
function openTunnel(id, host, port) {
  log(`TCP tunnel -> ${host}:${port}`);

  const socket = net.createConnection({ host, port, timeout: 10000 });

  tunnels.set(id, socket);

  socket.on('connect', () => {
    socket.setTimeout(0); // Clear connection timeout
    send({ id, type: 'connected' });
  });

  socket.on('data', (data) => {
    send({ id, type: 'data', data: data.toString('base64') });
  });

  socket.on('end', () => {
    send({ id, type: 'end' });
    tunnels.delete(id);
  });

  socket.on('timeout', () => {
    send({ id, type: 'error', error: 'Connection timed out: server did not respond on ' + host + ':' + port });
    socket.destroy();
    tunnels.delete(id);
  });

  socket.on('error', (err) => {
    let message = 'Connection failed: ' + err.message;
    if (err.code === 'ECONNREFUSED') {
      message = 'Connection refused: SSH is not running on ' + host + ':' + port;
    } else if (err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET') {
      message = 'Connection timed out: ' + host + ':' + port + ' did not respond';
    } else if (err.code === 'ENOTFOUND') {
      message = 'Host not found: ' + host;
    }
    send({ id, type: 'error', error: message });
    tunnels.delete(id);
  });
}

// --- Send message to VPS ---
function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

// --- Graceful shutdown ---
function shutdown() {
  if (stopping) return;
  stopping = true;
  log('Shutting down...');
  clearTimeout(reconnectTimer);
  for (const [id, socket] of tunnels) {
    socket.destroy();
  }
  tunnels.clear();
  if (ws) ws.close();
  setTimeout(() => process.exit(0), 500);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// --- Start ---
log('SA Web Tool Local Agent');
log('Target VPS: ' + url.replace(/\?.*/, ''));
connect();
