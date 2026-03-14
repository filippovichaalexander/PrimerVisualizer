## PrimerDesigner Django backend

Этот каталог содержит простой Django‑backend, который играет роль Primer API для браузерного расширения.

### Структура

- `backend/requirements.txt` — зависимости Django/DRF/CORS.
- `backend/Dockerfile` — контейнер для dev‑запуска.
- `docker-compose.yml` (в корне) — поднимает backend на `http://127.0.0.1:8000`.
- `backend/primer_backend` — стандартный Django‑проект.
- `backend/primerapi` — приложение с эндпоинтом `POST /api/design/`.

### Запуск через Docker

```bash
cd primer-designer-extension
docker-compose up --build
```

После успешного старта backend доступен на `http://127.0.0.1:8000`.

Эндпоинт для дизайна праймеров:

- `POST /api/design/`
- тело:

```json
{
  "sequence": "ATGC...",
  "tm": 60,
  "gc": 50,
  "length": 22
}
```

- ответ:

```json
{
  "results": [
    {
      "id": "server_0",
      "rank": 1,
      "forward": { "...": "..." },
      "reverse": { "...": "..." },
      "totalScore": 87,
      "grade": { "letter": "A", "color": "#22c55e", "description": "..." },
      "warnings": [],
      "source": "server"
    }
  ]
}
```

Этот формат совместим с `popup/popup.js`: при наличии интернета расширение сначала пытается использовать серверный дизайн, а при ошибке или недоступности API переходит в оффлайн‑эвристику.

### CORS

В `primer_backend/settings.py` для разработки включено:

```python
CORS_ALLOW_ALL_ORIGINS = True
```

Это гарантирует отсутствие CORS‑ошибок при обращении из Chrome Extension к `http://127.0.0.1:8000`. Для продакшена рекомендуется заменить на явный список разрешённых origin.

