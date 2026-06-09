# Model Proxy

A lightweight HTTP proxy + real-time dashboard for inspecting requests between [pi](https://github.com/earendil-works/pi) and a custom model provider.

## What It Does

Sits between pi and your model provider as a transparent pass-through proxy, logging every proxied request so you can inspect them in real-time via a web dashboard.

```
pi ──► Model Proxy (localhost:3000) ──► https://<your API endpoint>
                │
                └──► Web Dashboard (/)
```

## Features

- **Transparent proxying** — No request/response modification, pure pass-through
- **In-memory logging** — All proxied requests are logged (up to 1000, oldest evicted first)
- **Real-time dashboard** — Polls `/api/logs` every 2 seconds for live updates
- **Expandable details** — Click any request row to see the full request/response bodies (truncated to 4096 chars)
- **Status code color-coding** — Green (2xx), yellow (3xx), orange (4xx), red (5xx)
- **Docker-ready** — Single `docker compose up` to run

## Project Structure

```
model-proxy/
├── src/
│   ├── lib/
│   │   ├── store.ts           ← In-memory request store (1000 max, 4096 body truncate)
│   │   └── types.ts           ← RequestLog TypeScript type
│   ├── routes/
│   │   ├── +page.svelte       ← Dashboard UI (compact list + expandable detail)
│   │   ├── +layout.server.ts  ← SSR layout (loads env config)
│   │   └── api/
│   │       ├── logs/+server.ts    ← GET /api/logs — compact list
│   │       └── logs/[id]/+server.ts ← GET /api/logs/:id — full detail
│   ├── server/
│   │   └── proxy.ts           ← Core proxy engine (undici fetch, pass-through)
│   ├── hooks.server.ts        ← SvelteKit hook intercepts /v1/** for proxying
│   ├── app.d.ts               ← Type declarations
│   └── app.html               ← HTML shell
├── Dockerfile                 ← Multi-stage Node 20 build
├── docker-compose.yml         ← Docker Compose with env vars & healthcheck
├── svelte.config.js           ← SvelteKit config (adapter-node)
├── vite.config.ts             ← Vite config
└── tsconfig.json              ← TypeScript config
```

## Quick Start

### Local Development

```bash
npm install
npm run dev
# → http://localhost:3000
```

### Docker

```bash
docker compose up --build
# → http://localhost:3000
```

## Configuration

Environment variables (all optional):

| Variable | Default | Description |
|----------|---------|-------------|
| `PROXY_PROVIDER_URL` | `https://<your API endpoint>` | Target model provider URL |
| `PROXY_PORT` | `3000` | Port the server listens on |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Web dashboard |
| `/api/logs` | GET | Array of logged requests (compact, newest first) |
| `/api/logs/:id` | GET | Full detail for a specific request |
| `/v1/**` | Any | Proxied to the model provider |

## Using the Proxy with pi

Configure pi to use the proxy as its model endpoint. For example, in your pi provider config, set the model URL to `http://localhost:3000/v1/chat/completions` (or the Docker-exposed port).

## Tech Stack

- **Runtime:** Node.js 20+
- **Framework:** SvelteKit 2 + Svelte 5 (runes)
- **Adapter:** `@sveltejs/adapter-node` (Node.js production build)
- **HTTP:** `undici` (for proxying via native fetch)
- **Packaging:** Docker + Docker Compose

## Limitations

- In-memory storage only — requests are lost on restart
- Body capture limited to 4096 characters per body
- No request/response header logging
- No persistence layer
- View-only dashboard — no ability to block or modify requests
