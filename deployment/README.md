# AI Engine — Docker Deployment

On-prem deployment blueprint. Runs the full stack with no cloud dependency.

## Services

| Service | Purpose | Port |
|---------|---------|------|
| **ollama** | Local LLM inference (generation + embeddings) | 11434 |
| **ollama-init** | One-shot model pull on first boot | — |
| **api** | HTTP API with auth, RBAC, and audit logging | 3000 |
| **engine** | CLI-only container (on-demand, `--profile cli`) | — |

## Quick start

```bash
cd deployment
cp .env.example .env          # edit if needed
docker compose up              # first run pulls models — be patient
```

The API is ready when `http://localhost:3000/health` returns `200`.

## API endpoints

All endpoints except `/health` require an API key via the
`Authorization: Bearer <key>` header. Keys are configured in
`config/api_keys.json` (see [Authentication](#authentication) below).

### `GET /health`

```bash
curl http://localhost:3000/health
```

### `POST /ingest`

Ingest documents from the shared data volume into a FAISS namespace.

```bash
# Copy files into the data volume first
docker compose cp ./my-docs api:/data/docs

# Then ingest
curl -X POST http://localhost:3000/ingest \
  -H "Authorization: Bearer admin-key" \
  -H "Content-Type: application/json" \
  -d '{"path": "docs", "namespace": "default"}'
```

### `POST /query`

Query the knowledge base.

```bash
curl -X POST http://localhost:3000/query \
  -H "Authorization: Bearer admin-key" \
  -H "Content-Type: application/json" \
  -d '{"question": "Summarize the key points", "namespace": "default"}'
```

Stream the response with SSE:

```bash
curl -N -X POST http://localhost:3000/query \
  -H "Authorization: Bearer admin-key" \
  -H "Content-Type: application/json" \
  -d '{"question": "Summarize the key points", "namespace": "default", "stream": true}'
```

### `GET /namespaces`

List namespaces accessible to the current API key.

```bash
curl http://localhost:3000/namespaces \
  -H "Authorization: Bearer admin-key"
```

## Authentication

API keys are loaded from a JSON file. Each key maps to an array of
allowed namespace names. `["*"]` grants access to all namespaces.

Default path: `/app/config/api_keys.json` (mounted from host via
`API_KEYS_PATH` in `.env` or docker-compose volume).

Example `config/api_keys.json`:

```json
{
  "legal-team-key": ["legal"],
  "finance-team-key": ["finance"],
  "admin-key": ["*"]
}
```

To supply your own keys at runtime:

```bash
# In deployment/.env
API_KEYS_PATH=../config/api_keys.json
```

Or mount the file directly:

```bash
docker compose run --rm -v /path/to/keys.json:/app/config/api_keys.json api
```

## CLI access

Run CLI commands directly against the same data volume:

```bash
docker compose run --rm engine ingest /data/docs --workdir /data
docker compose run --rm engine query "What happened?" --workdir /data
docker compose run --rm engine namespaces --workdir /data
```

## Volumes

| Volume | Mount | Purpose |
|--------|-------|---------|
| `ollama_models` | `/root/.ollama` | Persisted model weights |
| `engine_data` | `/data` | Namespaces, FAISS indices, pipeline output, audit log |

## Configuration

All configuration is in `.env`. See `.env.example` for available variables.

To switch from Ollama to OpenAI:

```bash
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
```

To change the Ollama model:

```bash
OLLAMA_GENERATION_MODEL=llama3
OLLAMA_EMBEDDING_MODEL=nomic-embed-text
```

After changing models, restart to trigger a pull:

```bash
docker compose up --force-recreate ollama-init
```

## Rebuilding

```bash
docker compose build              # rebuild images
docker compose up --build         # rebuild and start
```

## Stopping

```bash
docker compose down               # stop, keep volumes
docker compose down -v            # stop, delete volumes
```
