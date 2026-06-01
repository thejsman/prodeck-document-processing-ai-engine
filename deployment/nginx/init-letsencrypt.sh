#!/usr/bin/env bash
# -------------------------------------------------------------------
# init-letsencrypt.sh — Bootstrap SSL certificates for Nginx.
#
# Run ONCE on first deploy, before starting the full production stack.
#
# Usage:
#   cd /opt/ai-engine
#   set -a && source deployment/.env.production && set +a
#   bash deployment/nginx/init-letsencrypt.sh
# -------------------------------------------------------------------

set -euo pipefail

DOMAIN="${DOMAIN:?ERROR: DOMAIN environment variable is required}"
EMAIL="${CERTBOT_EMAIL:?ERROR: CERTBOT_EMAIL environment variable is required}"
PROJECT_NAME="ai-engine"
COMPOSE_FILE="deployment/docker-compose.prod.yml"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> Bootstrapping SSL for ${DOMAIN}"

# ── Step 1: Generate placeholder self-signed cert ─────────────────
echo "==> Creating placeholder self-signed certificate..."
docker volume create "${PROJECT_NAME}_letsencrypt_certs" >/dev/null 2>&1 || true
docker run --rm \
  -v "${PROJECT_NAME}_letsencrypt_certs:/etc/letsencrypt" \
  alpine sh -c "
    apk add --no-cache openssl >/dev/null 2>&1 && \
    mkdir -p /etc/letsencrypt/live/${DOMAIN} && \
    openssl req -x509 -nodes -newkey rsa:2048 \
      -days 1 \
      -keyout /etc/letsencrypt/live/${DOMAIN}/privkey.pem \
      -out /etc/letsencrypt/live/${DOMAIN}/fullchain.pem \
      -subj '/CN=localhost' 2>/dev/null
  "

# ── Step 2: Generate nginx.conf from template ─────────────────────
echo "==> Generating nginx.conf from template..."
DOMAIN="${DOMAIN}" envsubst '${DOMAIN}' \
  < "${SCRIPT_DIR}/nginx.conf.template" \
  > "${SCRIPT_DIR}/nginx.conf"

# ── Step 3: Start Nginx with placeholder cert ─────────────────────
echo "==> Starting Nginx..."
docker compose -p "${PROJECT_NAME}" -f "${COMPOSE_FILE}" up -d nginx
sleep 5

# ── Step 4: Remove placeholder cert so Certbot can create a real one ─
echo "==> Removing placeholder certificate..."
docker run --rm \
  -v "${PROJECT_NAME}_letsencrypt_certs:/etc/letsencrypt" \
  alpine sh -c "rm -rf /etc/letsencrypt/live/${DOMAIN} /etc/letsencrypt/archive/${DOMAIN} /etc/letsencrypt/renewal/${DOMAIN}.conf"

# ── Step 5: Run Certbot to get real wildcard certificate ─────────
# Uses DNS-01 via Route 53 — required for *.${DOMAIN} wildcard coverage.
# The certbot/dns-route53 container reads AWS credentials from env or EC2 instance role.
# IAM policy needed: route53:ListHostedZones, route53:GetChange,
#                    route53:ChangeResourceRecordSets on your hosted zone.
echo "==> Requesting Let's Encrypt wildcard certificate for ${DOMAIN} and *.${DOMAIN}..."
docker compose -p "${PROJECT_NAME}" -f "${COMPOSE_FILE}" \
  --profile certbot run --rm certbot \
  certonly \
  --dns-route53 \
  --email "${EMAIL}" \
  --agree-tos \
  --no-eff-email \
  -d "${DOMAIN}" \
  -d "*.${DOMAIN}"

# ── Step 6: Reload Nginx with real certificate ────────────────────
echo "==> Reloading Nginx..."
docker compose -p "${PROJECT_NAME}" -f "${COMPOSE_FILE}" exec nginx nginx -s reload

echo ""
echo "==> SSL bootstrap complete for ${DOMAIN}"
echo "    Start the full stack with:"
echo "    docker compose -p ai-engine -f deployment/docker-compose.prod.yml --env-file deployment/.env.production up -d"
