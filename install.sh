#!/usr/bin/env bash
# install.sh - Автоматическая установка микросервиса Primer3

set -euo pipefail

echo "PrimerDesigner Pro: установка микросервиса Primer3"
echo "==================================================="

if ! command -v docker >/dev/null 2>&1; then
    echo "Docker не найден. Установите Docker: https://docs.docker.com/get-docker/"
    exit 1
fi

if docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD="docker-compose"
else
    echo "Не найден Docker Compose (docker compose / docker-compose)."
    exit 1
fi

CONFIG_DIR="${HOME}/.primerdesigner"
DATA_DIR="${CONFIG_DIR}/data"
mkdir -p "${DATA_DIR}"

cat > "${CONFIG_DIR}/docker-compose.yml" <<'EOF'
services:
  primer3-service:
    image: primerdesigner/primer3-service:latest
    container_name: primerdesigner-primer3
    ports:
      - "8001:8001"
    volumes:
      - ~/.primerdesigner/data:/app/data
    environment:
      - PORT=8001
      - CORS_ORIGINS=http://localhost,chrome-extension://*
      - PRIMER3_CACHE_SIZE=1000
      - PRIMER3_MAX_SEQUENCE=10000
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8001/health"]
      interval: 30s
      timeout: 10s
      retries: 3
EOF

cd "${CONFIG_DIR}"
${COMPOSE_CMD} up -d

echo "Ожидание старта сервиса..."
sleep 5
if curl -sf "http://localhost:8001/health" >/dev/null; then
    echo "Готово: микросервис Primer3 доступен на http://localhost:8001"
else
    echo "Сервис запущен, но health endpoint пока не отвечает."
    echo "Проверьте логи: ${COMPOSE_CMD} -f ${CONFIG_DIR}/docker-compose.yml logs -f"
fi

echo "Для остановки: ${COMPOSE_CMD} -f ${CONFIG_DIR}/docker-compose.yml down"
