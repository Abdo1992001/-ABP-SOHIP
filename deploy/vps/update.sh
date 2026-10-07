#!/usr/bin/env bash
# Pull the latest code from GitHub and rebuild. Data is kept.
#   cd /opt/abp && bash deploy/vps/update.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=lib.sh
. deploy/vps/lib.sh
bash deploy/vps/backup.sh
git pull --ff-only
compose up -d --build
compose ps
