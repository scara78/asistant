# assistantui2api-cfworker

A Cloudflare Worker that converts the [assistant-ui.com](https://www.assistant-ui.com) free chat endpoint into an **OpenAI-compatible API** (`/v1/chat/completions`).

Use it as a drop-in backend for any tool that speaks the OpenAI format — [Open WebUI](https://github.com/open-webui/open-webui), ChatBox, IDE extensions, CLI clients, etc.

> Ported from the Python/FastAPI version: [XXXxx7258/assistant-2api](https://github.com/XXXxx7258/assistant-2api)

## One-Click Deploy

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/banana2556/assistantui2api-cfworker)

After deploying, **set an API key** to protect your endpoint:

```bash
npx wrangler secret put API_KEY
```

## Features

- OpenAI-compatible `/v1/chat/completions` (streaming & non-streaming)
- Tool / function calling support
- Vision — images via URL or base64 data URI
- System prompt passthrough
- API key authentication (timing-safe)
- Automatic retry with exponential backoff on 429
- Optional proxy support for IP rotation
- Zero cold-start on Cloudflare Workers — no Docker needed

## Available Models

| Model | Provider |
|---|---|
| `gpt-5.4-nano` (default) | OpenAI |
| `gpt-5.4-mini` | OpenAI |
| `gemini-3.1-flash-lite` | Google |
| `grok-4.1-fast` | xAI |
| `grok-3-mini` | xAI |
| `llama-4-scout-17b` | Groq |
| `qwen3-32b` | Groq |

Use `GET /v1/models` to check current availability.

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/` | No | Health check |
| `GET` | `/health` | No | Health check |
| `GET` | `/ping` | No | Pong |
| `GET` | `/v1/models` | Yes | List active models |
| `GET` | `/v1/models/all` | Yes | List all models (including disabled) |
| `POST` | `/v1/chat/completions` | Yes | Chat completions |

## Usage

### curl

```bash
# Streaming
curl https://<your-worker>.workers.dev/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.4-nano",
    "stream": true,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'

# Non-streaming
curl https://<your-worker>.workers.dev/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.4-nano",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### OpenAI SDK (Python)

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://<your-worker>.workers.dev/v1",
    api_key="YOUR_API_KEY",
)

response = client.chat.completions.create(
    model="gpt-5.4-nano",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(response.choices[0].message.content)
```

### Open WebUI / ChatBox

Set the API base URL to `https://<your-worker>.workers.dev/v1` and enter your API key.

## Manual Deploy

```bash
git clone https://github.com/banana2556/assistantui2api-cfworker.git
cd assistantui2api-cfworker
npm install
npx wrangler login
npx wrangler deploy
```

## Local Development

```bash
npm run dev
```

Create `.dev.vars` for local secrets (this file is gitignored):

```
API_KEY=test-key
```

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `API_KEY` | No | _(empty = open access)_ | Bearer token. **Set via `wrangler secret put`**, not in `wrangler.toml`. |
| `UPSTREAM_URL` | No | `https://www.assistant-ui.com/api/chat` | Upstream chat endpoint. |
| `PROXY_URL` | No | _(empty)_ | Reverse-proxy URL for IP rotation (see below). |

### Proxy Mode

Cloudflare Workers share egress IPs, which can trigger upstream rate limits. If you hit frequent 429 errors, deploy a reverse proxy on your own VPS and set `PROXY_URL`. The worker sends requests to your proxy with the real upstream URL in the `X-Target-URL` header.

## License

MIT
