# SA Web Tool

A **web-based remote server administration tool** that lets system administrators run predefined SSH commands on multiple Linux servers directly from a browser — no direct SSH access required.

![Node.js](https://img.shields.io/badge/Node.js-18%2B-green) ![Express](https://img.shields.io/badge/Express-5-blue) ![Docker](https://img.shields.io/badge/Docker-ready-blue) ![License](https://img.shields.io/badge/license-MIT-lightgrey)

---

## Overview

SA Web Tool provides a clean browser UI where you select a target server, choose a predefined action (disk usage, memory, top processes, log tailing, etc.), enter SSH credentials, and instantly see formatted results — all without leaving the browser.

**Key design decisions:**
- **No credential storage** — SSH credentials are used per-request and never persisted anywhere
- **Predefined commands only** — arbitrary command execution is not possible; only commands from `config/config.json` can run
- **Input sanitization** — shell metacharacters (`;|&$`(){}<>!\n\r`) are rejected to prevent injection

---

## Features

- **Remote command execution** via SSH (password authentication)
- **8 built-in actions** — disk usage, memory, top processes, service status, log tailing, uptime, network connections, large file search
- **Multiple servers** — configure as many target servers as needed in a single JSON file
- **3 output formats** — table (structured), log (color-coded severity), plain text
- **Security hardened** — Helmet headers, rate limiting (30 req/min), 1 KB body limit, HTML output escaping
- **Responsive UI** — works on desktop and mobile browsers
- **Keyboard shortcut** — `Ctrl+Enter` / `Cmd+Enter` to execute

---

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or later **— OR —** [Docker](https://www.docker.com/)
- SSH access to the target Linux servers

---

## Quick Start with Docker

### Build the image

```bash
docker build -t sa-web-tool .
```

### Run the container

```bash
docker run -d \
  -p 3000:3000 \
  --name sa-web-tool \
  sa-web-tool
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Run with a custom config (bind mount)

```bash
docker run -d \
  -p 3000:3000 \
  -v $(pwd)/config/config.json:/app/config/config.json:ro \
  --name sa-web-tool \
  sa-web-tool
```

### Run on a custom port

```bash
docker run -d \
  -p 8080:3000 \
  --name sa-web-tool \
  sa-web-tool
```

### Stop / remove the container

```bash
docker stop sa-web-tool && docker rm sa-web-tool
```

---

## Installation (without Docker)

```bash
git clone <repository-url>
cd SA_web_Tool
npm install
```

### Start the server

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Custom port

```bash
PORT=8080 npm start
```

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
├── Dockerfile             # Docker containerization (Node.js 18 Alpine)
├── .dockerignore          # Files excluded from Docker image
├── server.js              # Express server and API routes
├── config/
│   └── config.json        # Server and action definitions
├── lib/
│   ├── ssh-executor.js    # SSH command execution via ssh2
│   └── output-parser.js   # Output formatting (table/log/plain)
├── public/
│   ├── index.html         # Main UI
│   ├── css/style.css      # Styles (responsive, dark output theme)
│   └── js/app.js          # Frontend logic
└── package.json
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/config` | Returns available servers and actions (no sensitive data) |
| `POST` | `/api/execute` | Executes a predefined command on a remote server |

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
  "output": "<table>...</table>",
  "exitCode": 0,
  "executionTime": 312
}
```

---

## Security Notes

- **Always deploy behind a reverse proxy** (nginx, Caddy, Traefik) with TLS in production
- **HTTPS is mandatory in production** — SSH credentials are transmitted per-request in the POST body
- Shell metacharacters are rejected in user input to prevent command injection
- Only commands defined in `config/config.json` can be executed — no arbitrary shell access
- The Docker image runs as the non-root `node` user
- SSH host key verification is disabled in the current implementation — enable it for hardened production deployments

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 18 (Alpine in Docker) |
| Web framework | Express 5 |
| SSH client | ssh2 |
| Security | Helmet, express-rate-limit |
| Frontend | Vanilla JS, CSS Grid/Flexbox |
| Container | Docker (multi-stage ready) |
