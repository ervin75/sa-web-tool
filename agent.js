/**
 * SA Web Tool — Local Agent
 *
 * Run this on your local Windows machine to forward SSH commands
 * from the VPS web server through your local network.
 *
 * Usage:
 *   node agent.js --url wss://yourdomain.com/agent --token your-secret-token
 *
 * Or set environment variables:
 *   AGENT_URL=wss://yourdomain.com/agent
 *   AGENT_TOKEN=your-secret-token
 */

const { WebSocket } = require('ws');
const { executeCommand } = require('./lib/ssh-executor');

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : null;
};

const AGENT_URL = getArg('--url') || process.env.AGENT_URL;
const AGENT_TOKEN = getArg('--token') || process.env.AGENT_TOKEN;

if (!AGENT_URL || !AGENT_TOKEN) {
  console.error('Usage: node agent.js --url wss://yourdomain.com/agent --token your-secret-token');
  process.exit(1);
}

const RECONNECT_DELAY_MS = 5000;
let ws;
let reconnectTimer;

function connect() {
  const url = `${AGENT_URL}?token=${encodeURIComponent(AGENT_TOKEN)}`;
  ws = new WebSocket(url);

  ws.on('open', () => {
    console.log(`[${new Date().toISOString()}] Connected to server`);
  });

  ws.on('message', async (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      console.error('Failed to parse message from server');
      return;
    }

    const { id, host, port, username, password, command } = msg;
    console.log(`[${new Date().toISOString()}] SSH → ${host}:${port} — ${command}`);

    try {
      const result = await executeCommand({ host, port, username, password, command, timeout: 30000 });
      ws.send(JSON.stringify({ id, output: result.output, exitCode: result.exitCode }));
    } catch (err) {
      ws.send(JSON.stringify({ id, error: err.message }));
    }
  });

  ws.on('close', () => {
    console.log(`[${new Date().toISOString()}] Disconnected — reconnecting in ${RECONNECT_DELAY_MS / 1000}s...`);
    reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
  });

  ws.on('error', (err) => {
    console.error(`[${new Date().toISOString()}] Error: ${err.message}`);
  });
}

connect();
