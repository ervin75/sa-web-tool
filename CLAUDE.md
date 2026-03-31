# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start the server (requires AGENT_TOKEN env var)
AGENT_TOKEN=secret npm start

# Install dependencies
npm install

# Docker build and run
docker build -t sa-web-tool .
docker run -d -p 3000:3000 -e AGENT_TOKEN=secret --name sa-web-tool sa-web-tool

# Push to GHCR
docker tag sa-web-tool ghcr.io/ervin75/sa-web-tool:latest
docker push ghcr.io/ervin75/sa-web-tool:latest

# Run the local agent (Node.js 22+, zero dependencies)
node agent.js --url wss://domain/ws/agent --token SECRET
```

There are no tests or linting configured in this project.

## Architecture

This is a split-architecture SSH admin tool: a VPS-hosted web server tunnels SSH connections through a WebSocket to a local agent on the user's PC.

```
Browser → HTTPS → VPS (server.js + ssh2) ←WebSocket→ Local Agent (agent.js) →TCP→ SSH Servers
```

**Why the tunnel:** Target servers are on a private network (192.168.x.x) unreachable from the VPS. The agent runs on the user's local PC which is on the same network, acting as a TCP proxy. The VPS performs the actual SSH handshake through this proxied connection.

### Key data flow for command execution

1. `POST /api/execute` → server.js validates request, builds command from `config/config.json` template
2. server.js creates a `TunnelStream` (custom `stream.Duplex`) and asks the agent to open a TCP connection to the target host
3. Agent opens `net.createConnection()` to the target, pipes data bidirectionally as base64 JSON over WebSocket
4. server.js passes the `TunnelStream` as `sock` to ssh2's `connect()` — ssh2 sees it as a normal socket
5. `lib/ssh-executor.js` runs the command, collects stdout/stderr
6. `lib/output-parser.js` formats raw output as HTML (table/log/plain based on action config)

### Critical implementation details

- **TunnelStream** (server.js): Duplex stream where `_write()` sends base64 data to agent via WebSocket, and `pushData()` feeds incoming agent data into the readable side. ssh2 uses this as its transport layer.
- **Agent protocol**: JSON messages with `{id, type, ...}` where type is `tunnel|connected|data|end|error`. Data payloads are base64-encoded. Each tunnel has a unique UUID.
- **agent.js has zero npm dependencies** — uses only Node.js 22+ built-in `WebSocket` and `net`. This is intentional so users don't need to run `npm install`.
- **AGENT_TOKEN** is required — server.js exits at startup if not set. Validated during WebSocket upgrade on `/ws/agent`.
- **Input sanitization**: regex `/[;|&$\`(){}<>!\\\n\r]/` rejects shell metacharacters in user input before `{{input}}` template substitution.
- **Single-agent model**: only one agent connection at a time. New connections replace the old one (close code 4001).
- **Ping/pong keepalive** at 25s intervals prevents nginx from dropping idle WebSocket connections.

### Frontend

Vanilla JS, no framework. `public/js/app.js` polls `/api/agent-status` every 5 seconds for the connection indicator. Config (servers/actions) loaded once on page load. Password field cleared after each execution.
