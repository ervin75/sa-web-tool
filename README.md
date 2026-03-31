# SA Web Tool

A **web-based remote server administration tool** that lets system administrators run predefined SSH commands on multiple Linux servers directly from a browser — no direct SSH access required.

![Node.js](https://img.shields.io/badge/Node.js-22%2B-green) ![Express](https://img.shields.io/badge/Express-5-blue) ![Docker](https://img.shields.io/badge/Docker-ready-blue) ![License](https://img.shields.io/badge/license-MIT-lightgrey)

---

## Overview

SA Web Tool provides a clean browser UI where you select a target server, choose a predefined action (disk usage, memory, top processes, log tailing, etc.), enter SSH credentials, and instantly see formatted results — all without leaving the browser.

**Key design decisions:**
- **No credential storage** — SSH credentials are used per-request and never persisted anywhere
- **Predefined commands only** — arbitrary command execution is not possible; only commands from `config/config.json` can run
- **Input sanitization** — shell metacharacters (`` ;|&$`(){}<>!\n\r ``) are rejected to prevent injection
- **Local agent tunnel** — SSH connections originate from your local network via a lightweight agent, not from the VPS

---

## Architecture

```
Browser --HTTPS--> VPS (Docker: server.js + ssh2)
                          |
                    WebSocket (wss://)
                          |
                       Internet
                          |
              Local PC (agent.js) --TCP--> SSH Servers (192.168.x.x)
```

The web UI runs on your VPS in Docker. When you execute a command, the VPS tunnels the SSH connection through a WebSocket to a lightweight agent running on your local PC. The agent opens a TCP connection to the target server on your local network, and the VPS performs the SSH handshake through this tunnel.

**The agent is a single file with zero npm dependencies** — it only requires Node.js 22+.

---

## Features

- **Remote command execution** via SSH (password authentication)
- **Local network access** — SSH connections originate from your PC, reaching servers the VPS can't
- **8 built-in actions** — disk usage, memory, top processes, service status, log tailing, uptime, network connections, large file search
- **Multiple servers** — configure as many target servers as needed in a single JSON file
- **3 output formats** — table (structured), log (color-coded severity), plain text
- **Agent status indicator** — green/red dot in the header shows if your local agent is connected
- **Security hardened** — Helmet headers, rate limiting (30 req/min), 1 KB body limit, HTML output escaping, token-authenticated WebSocket
- **Responsive UI** — works on desktop and mobile browsers
- **Keyboard shortcut** — `Ctrl+Enter` / `Cmd+Enter` to execute

---

## Prerequisites

- [Docker](https://www.docker.com/) on the VPS
- [Node.js](https://nodejs.org/) v22 or later on your local PC (for the agent)
- SSH access to the target Linux servers from your local network

---

## Quick Start

### 1. Deploy on VPS with Docker

```bash
# Pull and run (replace YOUR_SECRET_TOKEN with a strong random string)
docker run -d \
  -p 3000:3000 \
  -e AGENT_TOKEN=YOUR_SECRET_TOKEN \
  --name sa-web-tool \
  ghcr.io/ervin75/sa-web-tool:latest
```

Or build from source:

```bash
docker build -t sa-web-tool .
docker run -d \
  -p 3000:3000 \
  -e AGENT_TOKEN=YOUR_SECRET_TOKEN \
  --name sa-web-tool \
  sa-web-tool
```

### 2. Set up the local agent (on your PC)

```bash
# Download the agent script (single file, no npm install needed)
curl -o agent.js https://your-domain.com/api/agent-script

# Run it
node agent.js --url wss://your-domain.com/ws/agent --token YOUR_SECRET_TOKEN
```

You should see:
```
[2026-04-01 12:00:00] SA Web Tool Local Agent
[2026-04-01 12:00:00] Target VPS: wss://your-domain.com/ws/agent
[2026-04-01 12:00:00] Connected to VPS
```

### 3. Open the web UI

Navigate to `https://your-domain.com` — the header should show a green **Agent connected** indicator.

Select a server, choose an action, enter SSH credentials, and click **Execute**.

---

## Docker Options

### Run with a custom config (bind mount)

```bash
docker run -d \
  -p 3000:3000 \
  -e AGENT_TOKEN=YOUR_SECRET_TOKEN \
  -v $(pwd)/config/config.json:/app/config/config.json:ro \
  --name sa-web-tool \
  sa-web-tool
```

### Run on a custom port

```bash
docker run -d \
  -p 8080:3000 \
  -e AGENT_TOKEN=YOUR_SECRET_TOKEN \
  --name sa-web-tool \
  sa-web-tool
```

### Stop / remove the container

```bash
docker stop sa-web-tool && docker rm sa-web-tool
```

---

## Local Agent Reference

### Command-line arguments

| Argument | Env Variable | Description |
|----------|-------------|-------------|
| `--url` | `AGENT_URL` | WebSocket URL of the VPS (e.g. `wss://your-domain.com/ws/agent`) |
| `--token` | `AGENT_TOKEN` | Shared secret for authentication |
| `--help` | | Show usage information |

### Running as a background service

**Windows (startup script):**
Create a `.bat` file:
```bat
@echo off
node agent.js --url wss://your-domain.com/ws/agent --token YOUR_SECRET_TOKEN
```

**Linux (systemd):**
```ini
[Unit]
Description=SA Web Tool Agent
After=network.target

[Service]
ExecStart=/usr/bin/node /path/to/agent.js --url wss://your-domain.com/ws/agent --token YOUR_SECRET_TOKEN
Restart=always

[Install]
WantedBy=multi-user.target
```

### Auto-reconnect

The agent automatically reconnects if the connection drops, using exponential backoff (2s, 4s, 8s, ... up to 30s). No manual restart needed.

---

## Configuration

Edit `config/config.json` to define your servers and actions.

### Servers

```json
{
  "servers": [
    {
      "id": "web-prod-01",
      "label": "Web Production 01",
      "host": "192.168.1.10",
      "port": 22
    }
  ]
}
```

### Actions

```json
{
  "actions": [
    {
      "id": "disk-usage",
      "label": "Disk Usage",
      "command": "df -h",
      "usesInput": false,
      "inputPlaceholder": "",
      "parser": "table"
    },
    {
      "id": "service-status",
      "label": "Service Status",
      "command": "systemctl status {{input}}",
      "usesInput": true,
      "inputPlaceholder": "Service name (e.g. nginx, sshd, docker)",
      "parser": "plain"
    }
  ]
}
```

| Field | Description |
|-------|-------------|
| `id` | Unique identifier for the action |
| `label` | Display name shown in the UI |
| `command` | Shell command to execute; use `{{input}}` as a placeholder for user-provided values |
| `usesInput` | Whether the action requires user input |
| `inputPlaceholder` | Hint text shown in the input field |
| `parser` | Output format: `table`, `log`, or `plain` |

---

## Project Structure

```
SA_web_Tool/
├── Dockerfile             # Docker containerization (Node.js 22 Alpine)
├── .dockerignore          # Files excluded from Docker image
├── server.js              # Express server, API routes, WebSocket tunnel
├── agent.js               # Standalone local agent (zero dependencies)
├── config/
│   └── config.json        # Server and action definitions
├── lib/
│   ├── ssh-executor.js    # SSH command execution via ssh2
│   └── output-parser.js   # Output formatting (table/log/plain)
├── public/
│   ├── index.html         # Main UI with agent status indicator
│   ├── css/style.css      # Styles (responsive, dark output theme)
│   └── js/app.js          # Frontend logic with agent status polling
└── package.json
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/config` | Returns available servers and actions (no sensitive data) |
| `POST` | `/api/execute` | Executes a predefined command via the local agent tunnel |
| `GET` | `/api/agent-status` | Returns `{ connected: true/false }` |
| `GET` | `/api/agent-script` | Downloads the standalone agent.js file |
| `WS` | `/ws/agent?token=...` | WebSocket endpoint for the local agent |

### POST /api/execute — Request body

```json
{
  "serverId": "web-prod-01",
  "actionId": "disk-usage",
  "username": "admin",
  "password": "secret",
  "input": ""
}
```

### POST /api/execute — Response

```json
{
  "success": true,
  "output": "<table>...</table>",
  "exitCode": 0,
  "server": "Web Production 01",
  "action": "Disk Usage"
}
```

---

## Security Notes

- **Always deploy behind a reverse proxy** (nginx, Caddy, Traefik) with TLS in production
- **HTTPS is mandatory** — SSH credentials and the agent token are transmitted over the network
- **AGENT_TOKEN** must be set — the server refuses to start without it
- Shell metacharacters are rejected in user input to prevent command injection
- Only commands defined in `config/config.json` can be executed — no arbitrary shell access
- The Docker image runs as the non-root `node` user
- The agent WebSocket uses token authentication; unauthorized connections are rejected with HTTP 401
- Ping/pong keepalive (25s) prevents idle connection drops through nginx
- SSH host key verification is disabled in the current implementation — enable it for hardened production deployments
- **nginx tip:** suppress query-string logging for `/ws/agent` to avoid token exposure in access logs

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22 (Alpine in Docker) |
| Web framework | Express 5 |
| SSH client | ssh2 |
| WebSocket | ws (server), built-in WebSocket (agent) |
| Security | Helmet, express-rate-limit, token auth |
| Frontend | Vanilla JS, CSS Grid/Flexbox |
| Container | Docker |
