const http = require('http');
const crypto = require('crypto');
const { Duplex } = require('stream');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { WebSocketServer } = require('ws');
const config = require('./config/config.json');
const { executeCommand } = require('./lib/ssh-executor');
const { parseOutput } = require('./lib/output-parser');

// --- AGENT_TOKEN enforcement ---
const AGENT_TOKEN = process.env.AGENT_TOKEN;
if (!AGENT_TOKEN || AGENT_TOKEN === 'change-this-secret-token') {
  console.error('ERROR: AGENT_TOKEN environment variable is required.');
  console.error('Set it when starting the container:');
  console.error('  docker run -e AGENT_TOKEN=your-secret-here ...');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

// --- Agent state ---
let agentSocket = null;
const activeTunnels = new Map();
let pingInterval = null;

// --- TunnelStream: Duplex stream that proxies TCP over WebSocket ---
class TunnelStream extends Duplex {
  constructor(id) {
    super();
    this.tunnelId = id;
    this._connectResolve = null;
    this._connectReject = null;
    this._connectPromise = new Promise((resolve, reject) => {
      this._connectResolve = resolve;
      this._connectReject = reject;
    });
  }

  waitForConnection(timeoutMs = 10000) {
    return Promise.race([
      this._connectPromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Tunnel connection timed out — the target server did not respond')), timeoutMs)
      )
    ]);
  }

  onConnected() {
    if (this._connectResolve) this._connectResolve();
  }

  onError(message) {
    const err = new Error(message);
    if (this._connectReject) this._connectReject(err);
    this.destroy(err);
  }

  pushData(base64Data) {
    this.push(Buffer.from(base64Data, 'base64'));
  }

  onEnd() {
    this.push(null);
  }

  _write(chunk, encoding, callback) {
    if (agentSocket && agentSocket.readyState === 1) {
      agentSocket.send(JSON.stringify({
        id: this.tunnelId,
        type: 'data',
        data: chunk.toString('base64')
      }));
    }
    callback();
  }

  _read() {
    // Data is pushed externally via pushData()
  }

  _final(callback) {
    if (agentSocket && agentSocket.readyState === 1) {
      agentSocket.send(JSON.stringify({
        id: this.tunnelId,
        type: 'end'
      }));
    }
    callback();
  }
}

// --- Express middleware ---

// Security headers (relaxed CSP for inline styles used by output parser)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'"],
      connectSrc: ["'self'"]
    }
  }
}));

// JSON body parser with size limit
app.use(express.json({ limit: '1kb' }));

// Rate limiter on execute endpoint
const executeLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  message: { success: false, error: 'Too many requests. Please wait before trying again.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// --- API Routes ---

// GET /api/config — return safe subset of config (no host/IP exposed)
app.get('/api/config', (req, res) => {
  const servers = config.servers.map(s => ({
    id: s.id,
    label: s.label
  }));

  const actions = config.actions.map(a => ({
    id: a.id,
    label: a.label,
    usesInput: a.usesInput,
    inputPlaceholder: a.inputPlaceholder || ''
  }));

  res.json({ servers, actions });
});

// GET /api/agent-status — check if local agent is connected
app.get('/api/agent-status', (req, res) => {
  res.json({ connected: agentSocket !== null && agentSocket.readyState === 1 });
});

// GET /api/agent-script — download the standalone agent script
app.get('/api/agent-script', (req, res) => {
  res.download(path.join(__dirname, 'agent.js'), 'agent.js');
});

// POST /api/execute — run a predefined command via the local agent tunnel
app.post('/api/execute', executeLimiter, async (req, res) => {
  try {
    const { serverId, actionId, input, username, password } = req.body;

    // Validate required fields
    if (!serverId || !actionId || !username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: serverId, actionId, username, and password are required.'
      });
    }

    // Look up server
    const server = config.servers.find(s => s.id === serverId);
    if (!server) {
      return res.status(400).json({ success: false, error: 'Invalid server selection.' });
    }

    // Look up action
    const action = config.actions.find(a => a.id === actionId);
    if (!action) {
      return res.status(400).json({ success: false, error: 'Invalid action selection.' });
    }

    // Validate input if action requires it
    if (action.usesInput) {
      if (!input || input.trim() === '') {
        return res.status(400).json({
          success: false,
          error: 'This action requires input data. Please provide the required input.'
        });
      }

      // Sanitize input — reject dangerous shell metacharacters
      const dangerous = /[;|&$`(){}<>!\\\n\r]/;
      if (dangerous.test(input)) {
        return res.status(400).json({
          success: false,
          error: 'Input contains disallowed characters. Special shell characters are not permitted.'
        });
      }
    }

    // Build the command from template
    let command = action.command;
    if (action.usesInput && input) {
      command = command.replace('{{input}}', input.trim());
    }

    // Check agent connection
    if (!agentSocket || agentSocket.readyState !== 1) {
      return res.status(503).json({
        success: false,
        error: 'No local agent connected. Download and run agent.js on your local machine to bridge SSH connections.'
      });
    }

    // Create tunnel to target server via agent
    const tunnelId = crypto.randomUUID();
    const tunnel = new TunnelStream(tunnelId);
    activeTunnels.set(tunnelId, tunnel);

    // Request agent to open TCP connection
    agentSocket.send(JSON.stringify({
      id: tunnelId,
      type: 'tunnel',
      host: server.host,
      port: server.port
    }));

    try {
      // Wait for TCP connection to be established
      await tunnel.waitForConnection();

      // Execute SSH command through the tunnel
      const result = await executeCommand({
        sock: tunnel,
        username,
        password,
        command,
        timeout: 30000
      });

      // Parse and return output
      const parsedOutput = parseOutput(result.output, action.parser);

      res.json({
        success: true,
        output: parsedOutput,
        exitCode: result.exitCode,
        server: server.label,
        action: action.label
      });
    } finally {
      activeTunnels.delete(tunnelId);
    }

  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message || 'An unexpected error occurred while executing the command.'
    });
  }
});

// --- HTTP + WebSocket Server ---
const httpServer = http.createServer(app);

const wss = new WebSocketServer({ noServer: true });

// Handle WebSocket upgrade
httpServer.on('upgrade', (req, socket, head) => {
  const { pathname, searchParams } = new URL(req.url, 'http://localhost');

  if (pathname !== '/ws/agent') {
    socket.destroy();
    return;
  }

  const token = searchParams.get('token');
  if (token !== AGENT_TOKEN) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws);
  });
});

// Handle agent WebSocket connection
wss.on('connection', (ws) => {
  // Replace existing agent connection
  if (agentSocket && agentSocket.readyState === 1) {
    console.log('Replacing existing agent connection');
    agentSocket.close(4001, 'Replaced by new agent');
  }

  agentSocket = ws;
  ws.isAlive = true;
  console.log('Local agent connected');

  // Ping/pong keepalive
  clearInterval(pingInterval);
  pingInterval = setInterval(() => {
    if (!ws.isAlive) {
      console.log('Agent ping timeout — terminating connection');
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    ws.ping();
  }, 25000);

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  // Handle messages from agent
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      const tunnel = activeTunnels.get(msg.id);
      if (!tunnel) return;

      switch (msg.type) {
        case 'connected':
          tunnel.onConnected();
          break;
        case 'data':
          tunnel.pushData(msg.data);
          break;
        case 'end':
          tunnel.onEnd();
          activeTunnels.delete(msg.id);
          break;
        case 'error':
          tunnel.onError(msg.error);
          activeTunnels.delete(msg.id);
          break;
      }
    } catch (e) {
      console.error('Failed to parse agent message:', e.message);
    }
  });

  // Handle agent disconnect
  ws.on('close', () => {
    if (agentSocket === ws) {
      agentSocket = null;
      console.log('Local agent disconnected');
    }
    clearInterval(pingInterval);

    // Destroy all active tunnels
    for (const [id, tunnel] of activeTunnels) {
      tunnel.onError('Agent disconnected during command execution');
    }
    activeTunnels.clear();
  });

  ws.on('error', (err) => {
    console.error('Agent WebSocket error:', err.message);
  });
});

// Start server
// NOTE: In production, place this behind a reverse proxy (nginx/caddy) with TLS
httpServer.listen(PORT, () => {
  console.log(`SA Web Tool running at http://localhost:${PORT}`);
  console.log('Waiting for local agent connection on /ws/agent');
});
