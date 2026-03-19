# AI Engine — Production Deployment Guide

Deployment target: **AWS EC2** with OpenAI, Nginx reverse proxy, and Let's Encrypt TLS.

---

## 1. EC2 Instance Setup

### Instance type

| Option | Specs | Use case |
|--------|-------|----------|
| **t3.large** (recommended) | 2 vCPU, 8 GB RAM | Handles concurrent users comfortably |
| t3.medium (minimum) | 2 vCPU, 4 GB RAM | Low-traffic / evaluation |

No GPU required — all inference is via OpenAI API.

### Storage

- **Root volume:** 30 GB gp3 minimum, 50 GB recommended
- Stores Docker images, FAISS indexes, uploaded documents, and proposals

### AMI

- Ubuntu 24.04 LTS (x86_64)

### Security group

| Port | Protocol | Source | Purpose |
|------|----------|-------|---------|
| 22 | TCP | Your IP only | SSH |
| 80 | TCP | 0.0.0.0/0 | HTTP / ACME challenge |
| 443 | TCP | 0.0.0.0/0 | HTTPS |

Do **not** open ports 3000 or 3001. Only Nginx is exposed.

---

## 2. DNS Configuration

Create an **A record** pointing your domain to the EC2 public IP:

```
prodeck.online  →  A  →  <EC2-PUBLIC-IP>
```

Verify propagation before proceeding:

```bash
dig prodeck.online +short
```

---

## 3. Server Preparation

SSH into the instance:

```bash
ssh -i your-key.pem ubuntu@<EC2-PUBLIC-IP>
```

Update packages and install Docker:

```bash
sudo apt-get update && sudo apt-get upgrade -y

curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker ubuntu
newgrp docker

docker --version
docker compose version
```

---

## 4. Clone the Repository

```bash
sudo mkdir -p /opt/ai-engine
sudo chown ubuntu:ubuntu /opt/ai-engine
git clone <REPO_URL> /opt/ai-engine
cd /opt/ai-engine
```

---

## 5. Configure Environment

```bash
cp deployment/.env.production.example deployment/.env.production
nano deployment/.env.production
```

Fill in:

| Variable | What to set |
|----------|------------|
| `OPENAI_API_KEY` | Your OpenAI API key from https://platform.openai.com/api-keys |
| `DOMAIN` | Your domain (e.g., `prodeck.online`) |
| `CERTBOT_EMAIL` | Email for Let's Encrypt notifications |

Save and close.

---

## 6. Configure API Keys

The file `config/api_keys.km-digital.json` contains example API keys. Replace them with secure random strings:

```bash
# Generate a secure key
openssl rand -base64 32 | tr -d '+/=' | head -c 32

# Edit the keys file
nano config/api_keys.km-digital.json
```

Format: `{ "<bearer-token>": ["<namespace1>", "<namespace2>"] }`

Use `["*"]` for admin access to all namespaces.

---

## 7. Bootstrap SSL Certificates

Source the environment and run the bootstrap script:

```bash
cd /opt/ai-engine
set -a && source deployment/.env.production && set +a
bash deployment/nginx/init-letsencrypt.sh
```

This will:
1. Create a temporary self-signed certificate
2. Generate the Nginx config from the template
3. Start Nginx
4. Obtain a real Let's Encrypt certificate
5. Reload Nginx with the real certificate

---

## 8. Start the Full Stack

```bash
docker compose -p ai-engine -f deployment/docker-compose.prod.yml \
  --env-file deployment/.env.production up -d
```

First boot builds the Docker images (~3-5 minutes). Subsequent starts are fast.

---

## 9. Verify

```bash
# Health check
curl https://prodeck.online/api/health
# Expected: {"status":"ok","timestamp":"..."}

# Auth check (should return 401)
curl -s -o /dev/null -w "%{http_code}" https://prodeck.online/api/namespaces
# Expected: 401

# Auth check with key (should return 200)
curl https://prodeck.online/api/namespaces \
  -H "Authorization: Bearer <YOUR-ADMIN-KEY>"
# Expected: {"namespaces":[...]}
```

Open `https://prodeck.online` in a browser to access the UI.

---

## 10. Maintenance

### View logs

```bash
# All services
docker compose -p ai-engine -f deployment/docker-compose.prod.yml logs -f

# Single service
docker compose -p ai-engine -f deployment/docker-compose.prod.yml logs -f api
```

### Restart a service

```bash
docker compose -p ai-engine -f deployment/docker-compose.prod.yml restart api
```

### Update application

```bash
cd /opt/ai-engine
git pull
docker compose -p ai-engine -f deployment/docker-compose.prod.yml \
  --env-file deployment/.env.production up -d --build
```

### Certificate renewal

Add a cron job to auto-renew (runs twice monthly):

```bash
crontab -e
```

Add this line:

```
0 3 1,15 * * cd /opt/ai-engine && docker compose -p ai-engine -f deployment/docker-compose.prod.yml --profile certbot run --rm certbot renew --quiet && docker compose -p ai-engine -f deployment/docker-compose.prod.yml exec nginx nginx -s reload
```

### Backup data

```bash
# Backup all engine data (namespaces, indexes, proposals, audit log)
docker run --rm \
  -v ai-engine_engine_data:/data \
  -v /opt/backups:/backup \
  alpine tar czf /backup/engine-data-$(date +%Y%m%d).tar.gz -C / data
```

### Stop services

```bash
# Stop (keep data)
docker compose -p ai-engine -f deployment/docker-compose.prod.yml down

# Stop and DELETE all data (irreversible!)
docker compose -p ai-engine -f deployment/docker-compose.prod.yml down -v
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Nginx won't start | Cert files missing | Re-run `init-letsencrypt.sh` |
| API returns 401 | Wrong API key | Check `config/api_keys.km-digital.json` matches your Bearer token |
| OpenAI errors | Bad API key or no billing | Verify `OPENAI_API_KEY` in `.env.production` |
| Certificate not trusted | DNS not propagated before Certbot ran | Wait for DNS, then re-run `init-letsencrypt.sh` |
| Upload fails (413) | File exceeds 25 MB | This is the configured maximum |
| Slow proposal generation | Normal — LLM calls take 1-3 minutes | Proxy timeout is set to 10 minutes |
