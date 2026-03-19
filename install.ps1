# install.ps1 - Установка микросервиса Primer3 для Windows

Write-Host "PrimerDesigner Pro: установка микросервиса Primer3" -ForegroundColor Cyan
Write-Host "===================================================" -ForegroundColor Cyan

if (!(Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "Docker не найден. Установите Docker Desktop: https://www.docker.com/products/docker-desktop/" -ForegroundColor Red
    exit 1
}

$composeCmd = "docker compose"
try {
    docker compose version | Out-Null
} catch {
    if (Get-Command docker-compose -ErrorAction SilentlyContinue) {
        $composeCmd = "docker-compose"
    } else {
        Write-Host "Не найден Docker Compose." -ForegroundColor Red
        exit 1
    }
}

$configDir = Join-Path $env:USERPROFILE ".primerdesigner"
$dataDir = Join-Path $configDir "data"
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

@"
services:
  primer3-service:
    image: primerdesigner/primer3-service:latest
    container_name: primerdesigner-primer3
    ports:
      - "8001:8001"
    volumes:
      - ${env:USERPROFILE}\.primerdesigner\data:/app/data
    environment:
      - PORT=8001
      - CORS_ORIGINS=http://localhost,chrome-extension://*
      - PRIMER3_CACHE_SIZE=1000
      - PRIMER3_MAX_SEQUENCE=10000
    restart: unless-stopped
"@ | Out-File -FilePath (Join-Path $configDir "docker-compose.yml") -Encoding utf8

Set-Location $configDir
Invoke-Expression "$composeCmd up -d"

Write-Host "Готово: микросервис Primer3 запущен на порту 8001" -ForegroundColor Green
