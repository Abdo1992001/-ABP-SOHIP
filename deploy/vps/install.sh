#!/usr/bin/env bash
# One-time setup of ABP on a fresh Ubuntu server (run as root):
#   curl -fsSL https://raw.githubusercontent.com/Abdo1992001/-ABP-SOHIP/main/deploy/vps/install.sh | bash
# Optional: ABP_DOMAIN=crm.example.com to use the company host name instead of
# the <server-ip>.sslip.io test address.
# The repository is private, so pass a read-only GitHub token as GITHUB_TOKEN
# (see README.md). It is kept in the clone's remote so update.sh can pull.
set -euo pipefail

if [ -n "${GITHUB_TOKEN:-}" ]; then
  REPO_URL="${REPO_URL:-https://x-access-token:${GITHUB_TOKEN}@github.com/Abdo1992001/-ABP-SOHIP.git}"
fi
REPO_URL="${REPO_URL:-https://github.com/Abdo1992001/-ABP-SOHIP.git}"
APP_DIR="${APP_DIR:-/opt/abp}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this as root." >&2
  exit 1
fi

echo "==> Installing Docker and Git"
if ! command -v docker >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y ca-certificates curl git openssl
  curl -fsSL https://get.docker.com | sh
fi
command -v git >/dev/null 2>&1 || apt-get install -y git
command -v openssl >/dev/null 2>&1 || apt-get install -y openssl

# Building the images needs more memory than a small server has.
if [ ! -f /swapfile ] && [ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 7000000 ]; then
  echo "==> Adding 4 GB of swap for the build"
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  echo "/swapfile none swap sw 0 0" >> /etc/fstab
fi

echo "==> Getting the code"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone "$REPO_URL" "$APP_DIR"
  chmod 600 "$APP_DIR/.git/config"
fi
cd "$APP_DIR"
# shellcheck source=lib.sh
. deploy/vps/lib.sh

if [ ! -f .env.production ]; then
  echo "==> Writing .env.production with new secrets"
  ip="$(curl -fsS https://api.ipify.org || hostname -I | awk '{print $1}')"
  domain="${ABP_DOMAIN:-${ip//./-}.sslip.io}"
  db_password="$(openssl rand -hex 24)"
  umask 077
  sed \
    -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${db_password}|" \
    -e "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://abp:${db_password}@db:5432/abp?schema=public|" \
    -e "s|^ABP_ALLOWED_ORIGINS=.*|ABP_ALLOWED_ORIGINS=https://${domain}|" \
    -e "s|^ABP_PUBLIC_APP_URL=.*|ABP_PUBLIC_APP_URL=https://${domain}|" \
    -e "s|^ABP_MFA_MASTER_KEY=.*|ABP_MFA_MASTER_KEY=$(openssl rand -base64 32)|" \
    .env.production.example > .env.production
  echo "" >> .env.production
  echo "ABP_DOMAIN=${domain}" >> .env.production
fi
if [ ! -f .abp-admin ]; then
  domain="$(sed -n 's/^ABP_DOMAIN=//p' .env.production)"
  admin_password="Abp9-$(openssl rand -hex 6)-$(openssl rand -hex 6 | tr 'a-f' 'A-F')!"
  umask 077
  # Kept apart from .env.production, which every container reads.
  cat > .abp-admin <<ADMIN
ABP_ADMIN_USERNAME=admin
ABP_ADMIN_EMAIL=admin@${domain}
ABP_ADMIN_DISPLAY_NAME=Administrator
ABP_ADMIN_PASSWORD=${admin_password}
ADMIN
fi
set -a
# shellcheck disable=SC1091
. ./.env.production
# shellcheck disable=SC1091
. ./.abp-admin
set +a

echo "==> Opening the web ports"
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp
  ufw allow 443/tcp
fi
# Some cloud Ubuntu images ship iptables rules that reject everything but SSH.
if command -v iptables >/dev/null 2>&1 && iptables -S INPUT | grep -q -- "-j REJECT"; then
  for port in 80 443; do
    iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null ||
      iptables -I INPUT 1 -p tcp --dport "$port" -j ACCEPT
  done
  if command -v netfilter-persistent >/dev/null 2>&1; then
    netfilter-persistent save >/dev/null
  fi
fi

echo "==> Building and starting (the first build takes 10-20 minutes)"
compose up -d --build

echo "==> Creating the administrator"
compose exec -T \
  -e "ABP_ADMIN_USERNAME=${ABP_ADMIN_USERNAME}" \
  -e "ABP_ADMIN_EMAIL=${ABP_ADMIN_EMAIL}" \
  -e "ABP_ADMIN_DISPLAY_NAME=${ABP_ADMIN_DISPLAY_NAME}" \
  -e "ABP_ADMIN_PASSWORD=${ABP_ADMIN_PASSWORD}" \
  api node apps/api/dist/security/local-admin-cli.js create

echo "==> Scheduling a daily database backup"
cat > /etc/cron.d/abp-backup <<CRON
30 2 * * * root cd ${APP_DIR} && bash deploy/vps/backup.sh >> /var/log/abp-backup.log 2>&1
CRON

cat <<DONE

ABP is online:  https://${ABP_DOMAIN}
Username:       ${ABP_ADMIN_USERNAME}
Password:       ${ABP_ADMIN_PASSWORD}

The password is also kept in ${APP_DIR}/.abp-admin on this server.
If the page does not open straight away, wait a minute while the
HTTPS certificate is issued.
DONE
