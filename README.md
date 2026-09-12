# Dulo

<p align="center">
  <strong>A lightweight, local-first AI agent harness with a real-time browser control panel.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-20+-68a063?style=flat-square&logo=node.js&logoColor=white" alt="Node.js 20+" />
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react&logoColor=black" alt="React 19" />
  <img src="https://img.shields.io/badge/Vite-8-646cff?style=flat-square&logo=vite&logoColor=white" alt="Vite 8" />
  <img src="https://img.shields.io/badge/TailwindCSS-v4-38bdf8?style=flat-square&logo=tailwindcss&logoColor=white" alt="Tailwind CSS v4" />
  <img src="https://img.shields.io/badge/LLM-OpenRouter-blueviolet?style=flat-square" alt="OpenRouter" />
  <img src="https://img.shields.io/badge/License-ISC-green?style=flat-square" alt="License: ISC" />
</p>

---

![Dulo Dashboard](docs/dashboard.png)

## Overview

**Dulo** is an autonomous agent runner and web workspace designed for transparency, safety, and local control.

- **Harness (`src/`)**: Pure Node.js & TypeScript agent loop implementing the ReAct pattern. Interacts with OpenRouter models, executes sandboxed tools locally, and streams step-by-step progress via Server-Sent Events (SSE).
- **Control Panel (`client/`)**: Modern React 19 web interface powered by Vite, Tailwind CSS v4, and shadcn/ui. Provides a live playground, visual tool management, run telemetry, and configuration controls.

> **Security by Design**: The browser client **never** communicates directly with OpenRouter and never receives your API key. The harness holds the credentials on your machine, applies strict tool safety guardrails, and streams live event traces directly to your browser.

---

## Key Features

- **Live Multi-Step Agent Tracing**: Watch queries execute in real time. Inspect exact tool arguments, stdout/stderr, latency timings, errors, and reasoning chains.
- **Strict Local Sandboxing**: Filesystem actions are confined to the workspace root; shell commands are strictly whitelisted and blocked from code execution flags; HTTP requests enforce SSRF filtering.
- **Dynamic Tool Management**: Toggle tools on/off per run directly from the UI or inspect their underlying JSON schemas.
- **Resilient Multi-Model Fallbacks**: Default support for high-capability free OpenRouter models with automated fallback chaining (up to 3 models per request) to bypass rate limits.
- **Real-Time SSE Streaming**: Native HTTP streaming delivers instant feedback with disconnect detection and automatic run cancellation.
- **Local Browser Persistence**: Run history (last 50 runs), custom tool toggles, and client settings are persisted safely in local storage.
- **MCP Extensibility Ready**: Architected with a clear migration path to Model Context Protocol (MCP) servers (see [MCP Research](docs/mcp-research.md)).

---

## Architecture & Data Flow

```
┌────────────────────────────────────────────────────────────────────────┐
│                          Dulo Web Panel                                │
│         (React 19 · Vite · Tailwind CSS v4 · shadcn/ui)                │
│                                                                        │
│  [Dashboard]          [Playground]          [Tools]        [Settings]  │
│  Metrics & Charts     Live Trace Stream     Per-Tool On/Off Model/Temp │
└─────────────────────────────────┬──────────────────────────────────────┘
                                  │ Server-Sent Events (SSE) & REST
                                  ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        Dulo Harness API (:3001)                        │
│                     (Node.js native http server)                       │
│                                                                        │
│   POST /api/run ──► [Agent Loop (agent.ts)]                            │
│                            │                                           │
│         ┌──────────────────┴──────────────────┐                        │
│         ▼                                     ▼                        │
│  [OpenRouter API]                     [Tool Registry]                  │
│  - Chat completions                   - Filesystem (sandboxed)         │
│  - Model fallback chain               - Shell (whitelisted binary)     │
│  - Function definitions               - Network (SSRF-protected)       │
│                                       - System & Utilities             │
└────────────────────────────────────────────────────────────────────────┘
```

### Event Stream Lifecycle

When `POST /api/run` is initiated, the server streams strongly typed events defined in `src/events.ts`:

`run.start` → `step.start` → `tool.call` → `tool.result` → `assistant` → `run.end`

If a user stops the run or closes the browser tab, an `AbortSignal` immediately aborts the active LLM request and halts the loop.

---

## Control Panel Showcase

### 1. Interactive Playground
Run queries with real-time feedback. Inspect tool execution steps, intermediate outputs, execution duration, and markdown answers.

![Playground](docs/playground.png)

### 2. Tools & Permissions Manager
Inspect JSON schemas, filter tools by category, and toggle capabilities on/off before launching runs.

![Tools](docs/tools.png)

### 3. Model & Harness Settings
Configure primary models, fallback chains, sampling temperature, max step boundaries, and check harness connectivity.

![Settings](docs/settings.png)

---

## Built-in Tools

Dulo comes equipped with 18+ tools out-of-the-box, each governed by strict safety bounds:

| Category | Tool | Description | Safety Boundary |
| :--- | :--- | :--- | :--- |
| **Files** | `list_files` | List files and folders in a project directory | Confined to project root |
| **Files** | `read_file` | Read full text content of a workspace file | Confined to project root |
| **Files** | `write_file` | Create or overwrite files with recursive folder creation | Confined to project root |
| **Files** | `glob` | Find files matching patterns (`**/*.ts`, `*.json`) | Node `fs/promises` glob |
| **Files** | `file_compress` | Compress files using Gzip or Deflate | Confined to project root |
| **Files** | `file_extract` | Decompress Gzip or Deflate files | Confined to project root |
| **System** | `shell` | Run allow-listed commands (`git`, `npm`, `ls`, etc.) | Whitelist only, no shell, no `-e`/`--eval`, 30s timeout, 10KB buffer |
| **System** | `get_system_info` | OS, CPU count, memory, architecture, Node uptime | Read-only |
| **System** | `get_env` | Read environment variables | Strips keys containing `KEY`, `SECRET`, `TOKEN`, `PASSWORD` |
| **Network** | `http_request` | Fetch web pages (HTML converted to readable plain text) | Blocks SSRF (localhost, private subnets), 5MB download cap |
| **Network** | `dns_lookup` | Query DNS records (A, AAAA, MX, NS, TXT, SRV, CNAME) | Standard DNS resolver |
| **Network** | `ping` | Measure TCP connection latency to a host:port | Uses TCP connect (works without root ICMP privileges) |
| **Network** | `port_check` | Check if a remote TCP port is open, closed, or filtered | TCP socket connect |
| **Network** | `get_weather` | Sample mock weather tool for quick tests | Demo data |
| **Utility** | `get_current_time` | Returns the current server timestamp | Read-only |
| **Utility** | `calculate` | Evaluates math expressions | Safe expression parsing |
| **Utility** | `get_random_number`| Random integer generation | Local generator |
| **Utility** | `get_uuid` | Generate cryptographically strong UUID v4 | `crypto.randomUUID` |
| **Utility** | `generate_password`| Cryptographically secure password generator | Configurable character sets |

---

## Safety & Security Model

Because tools execute on your local machine, Dulo enforces defense-in-depth protections:

1. **Path Sandboxing**: All file tools resolve paths using `path.resolve` and verify that the target starts with `process.cwd()`. Directory traversal attempts (`../`) outside the project root are rejected.
2. **SSRF Rejection**: `http_request` prohibits requests to loopback addresses (`localhost`, `127.0.0.1`, `::1`), link-local IPs, and private subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`).
3. **No Shell Interpolation**: `shell` invokes binaries directly with `execFile` (`shell: false`), preventing shell injection, command chaining (`&&`, `;`), pipes (`|`), and output redirects (`>`). Inline code execution flags (`-e`, `--eval`, `-c`) are blocked.
4. **Secret Scrubbing**: `get_env` automatically redacts sensitive variables matching common credential names before exposing them to the agent.
5. **No Key Leakage**: Browser code never interacts with OpenRouter. All API keys reside strictly inside the backend `.env`.

---

## Getting Started

### Prerequisites

- **Node.js**: `v20.0.0` or higher
- **npm** or **pnpm**
- An **OpenRouter API Key** ([get one here](https://openrouter.ai/keys))

### Installation

1. Clone the repository and install root dependencies:
   ```bash
   git clone https://github.com/your-username/dulo.git
   cd dulo
   npm install
   ```

2. Install web client dependencies:
   ```bash
   cd client
   npm install
   cd ..
   ```

3. Configure your `.env` in the project root:
   ```env
   OPENROUTER_API_KEY=sk-or-v1-...
   ```

---

## Running Dulo

### Web Control Panel (Recommended)

Run two processes in separate terminals:

```bash
# Terminal 1: Harness API on http://localhost:3001
npm run serve

# Terminal 2: Web panel on http://localhost:5173
cd client
npm start
```

Open **http://localhost:5173** in your browser. The header badge turns green once connected to the harness.

### Command Line Interface (CLI)

Run a single-shot query directly from the terminal:

```bash
npm start -- "What time is it and how many files are in src?"
```

---

## Environment Variables

| Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `OPENROUTER_API_KEY` | **Yes** | — | OpenRouter secret API key |
| `OPENROUTER_MODEL` | No | `nvidia/nemotron-3-ultra-550b-a55b:free` | Primary model identifier |
| `OPENROUTER_URL` | No | `https://openrouter.ai/api/v1/chat/completions` | OpenRouter endpoint (or local testing stub) |
| `PORT` | No | `3001` | Harness HTTP / SSE server port |
| `DULO_CLIENT_ORIGIN` | No | `http://localhost:5173` | Allowed browser origin for CORS |

---

## API Reference

The harness exposes a clean HTTP and Server-Sent Events API:

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Harness health, model configuration, tool count, API key check |
| `GET` | `/api/tools` | Tool names, descriptions, and JSON Schema parameters |
| `POST` | `/api/run` | Executes an agent run; streams Server-Sent Events |

### `POST /api/run`
Takes a JSON payload:
```json
{
  "query": "What files are in src?",
  "model": "nvidia/nemotron-3-ultra-550b-a55b:free",
  "maxSteps": 8,
  "temperature": 0.2,
  "enabledTools": ["list_files", "read_file"]
}
```

Streams `RunEvent` SSE chunks:
- `run.start` — Run metadata, runId, model, timestamp.
- `step.start` — Current step index.
- `tool.call` — Tool name, parsed arguments, unique call ID.
- `tool.result` — Execution result, duration, error flag.
- `assistant` — Intermediate thoughts or final markdown answer.
- `run.end` — Final status (`completed`, `failed`, `cancelled`), duration, step count.

---

## Model Context Protocol (MCP) Integration

Looking to connect external MCP tool servers (e.g. GitHub, PostgreSQL, Docker, or custom tools)?

Dulo includes comprehensive research and an implementation blueprint for `@modelcontextprotocol/client` v2 integration. Read the complete proposal in [docs/mcp-research.md](docs/mcp-research.md).

---

## License

This project is licensed under the [ISC License](package.json).
