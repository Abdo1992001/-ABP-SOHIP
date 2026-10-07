# Shared by the server scripts. Run from the repository root.
compose() {
  docker compose --env-file .env.production \
    -f docker-compose.production.yml -f deploy/vps/compose.vps.yml "$@"
}
