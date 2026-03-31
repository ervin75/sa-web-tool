const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const http = require('http');
const { WebSocketServer } = require('ws');
const config = require('./config/config.json');
const { parseOutput } = require('./lib/output-parser');

const app = express();
const PORT = process.env.PORT || 3000;
const AGENT_TOKEN = process.env.AGENT_TOKEN || 'change-this-secret-token';

// Security headers
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

app.use(express.json({ limit: '1kb' }));

const executeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, error: 'Too many requests. Please wait before trying again.' },
  standardHeaders: true,
  legacyHeaders: false
});

app.use(express.static(path.join(__dirname, 'public')));

// --- Agent WebSocket state ---
let agentSocket = null;
const pendingRequests = new Map(); // requestId -> { resolve, reject, timer }

function sendToAgent(payload) {
  return new Promise((resolve, reject) => {
    if (!agentSocket || agentSocket.readyState !== agentSocket.OPEN) {
      return reject(new Error('No local agent connected. Start agent.js on your local machine.'));
    }

    const id = Math.random().toString(36).slice(2);
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error('Agent timed out waiting for SSH result.'));
    }, 35000);

    pendingRequests.set(id, { resolve, reject, timer });
    agentSocket.send(JSON.stringify({ id, ...payload }));
  });
}

// --- API Routes ---

app.get('/api/agent-status', (req, res) => {
  res.json({ connected: agentSocket !== null && agentSocket.readyState === agentSocket.OPEN });
});

app.get('/api/config', (req, res) => {
  const servers = config.servers.map(s => ({ id: s.id, label: s.label }));
  const actions = config.actions.map(a => ({
    id: a.id,
    label: a.label,
    usesInput: a.usesInput,
    inputPlaceholder: a.inputPlaceholder || ''
  }));
  res.json({ servers, actions });
});

app.post('/api/execute', executeLimiter, async (req, res) => {
  try {
    const { serverId, actionId, input, username, password } = req.body;

    if (!serverId || !actionId || !username || !password) {
      return res.status(400).json({ success: false, error: 'Missing required fields.' });
    }

    const server = config.servers.find(s => s.id === serverId);
    if (!server) return res.status(400).json({ success: false, error: 'Invalid server selection.' });

    const action = config.actions.find(a => a.id === actionId);
    if (!action) return res.status(400).json({ success: false, error: 'Invalid action selection.' });

    if (action.usesInput) {
      if (!input || input.trim() === '') {
        return res.status(400).json({ success: false, error: 'This action requires input data.' });
      }
      const dangerous = /[;|&$`(){}<>!\\\n\r]/;
      if (dangerous.test(input)) {
        return res.status(400).json({ success: false, error: 'Input contains disallowed characters.' });
      }
    }

    let command = action.command;
    if (action.usesInput && input) {
      command = command.replace('{{input}}', input.trim());
    }

    const start = Date.now();
    const result = await sendToAgent({
      host: server.host,
      port: server.port,
      username,
      password,
      command
    });
    const executionTime = Date.now() - start;

    const parsedOutput = parseOutput(result.output, action.parser);
    res.json({
      success: true,
      output: parsedOutput,
      exitCode: result.exitCode,
      server: server.label,
      action: action.label,
      executionTime
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- WebSocket server for local agent ---
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  if (req.url !== '/agent') {
    socket.destroy();
    return;
  }

  // Authenticate via token in query string
  const url = new URL(req.url, `http://localhost`);
  const token = url.searchParams.get('token');
  if (token !== AGENT_TOKEN) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws);
  });
});

wss.on('connection', (ws) => {
  agentSocket = ws;
  console.log('Local agent connected');

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      const pending = pendingRequests.get(msg.id);
      if (!pending) return;
      pendingRequests.delete(msg.id);
      clearTimeout(pending.timer);
      if (msg.error) {
        pending.reject(new Error(msg.error));
      } else {
        pending.resolve({ output: msg.output, exitCode: msg.exitCode });
      }
    } catch (e) {
      console.error('Agent message parse error:', e);
    }
  });

  ws.on('close', () => {
    agentSocket = null;
    console.log('Local agent disconnected');
  });

  ws.on('error', (err) => {
    console.error('Agent WebSocket error:', err.message);
  });
});

server.listen(PORT, () => {
  console.log(`SA Web Tool running at http://localhost:${PORT}`);
  console.log(`Agent token: ${AGENT_TOKEN}`);
});
