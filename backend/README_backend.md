## PrimerDesigner Django backend

Этот каталог содержит простой Django‑backend, который играет роль Primer API для браузерного расширения.

### Структура

- `backend/requirements.txt` — зависимости Django/DRF/CORS.
- `backend/Dockerfile` — контейнер для dev‑запуска.
- `docker-compose.yml` (в корне) — поднимает backend на `http://127.0.0.1:8000`.
- `backend/primer_backend` — стандартный Django‑проект.
- `backend/primerapi` — приложение с эндпоинтом `POST /api/design/`.

### Очистка кэша перед запуском

Из корня проекта (`primer-designer-extension`):

```bash
# Кэш Docker (образы и сборка) — если нужно пересобрать с нуля
docker compose build --no-cache

# Python: байт-код и кэш Django (опционально)
find backend -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null; find backend -name "*.pyc" -delete 2>/dev/null

# Расширение Chrome: обновить без кэша — chrome://extensions → «Обновить» у расширения
```

Обычно достаточно `docker compose build --no-cache` при смене зависимостей или Dockerfile; для быстрого перезапуска кэш можно не чистить.

### Запуск проекта

**Вариант 1: только backend** (расширение будет использовать API или эвристику при недоступности):

```bash
docker compose up backend
```

**Вариант 2: backend + микросервис Primer3** (эталонный расчёт через прокси на порту 8000):

```bash
docker compose up backend primer3-service
```

Первый запуск или после смены зависимостей:

```bash
docker compose up --build backend primer3-service
```

После старта:
- Backend: `http://127.0.0.1:8000`
- Микросервис (если запущен): `http://127.0.0.1:8001`
- Расширение в `config.js` по умолчанию: `API_BASE_URL = 'http://localhost:8000'`

### Как проверить, что API отвечает

1. **Из терминала (curl)** — backend должен быть запущен (`docker compose up backend`):
   ```bash
   curl -s -w "\nHTTP %{http_code}\n" http://127.0.0.1:8000/api/design/ -X POST -H "Content-Type: application/json" -d '{"sequence":"ATGCATGCATGCATGCATGCATGCATGCATGCATGCATGCATGCATGCATGCATGCATGCATGC","tm":60,"gc":50,"length":22}'
   ```
   Ожидается ответ с `HTTP 200` и JSON с полем `results` или `detail`. Если «Connection refused» или таймаут — бэкенд не запущен или порт другой.

2. **В браузере** — откройте `http://localhost:8000` или `http://127.0.0.1:8000`: должна открыться страница Django (или 404 для корня — это нормально, нужен именно `/api/design/`).

3. **В расширении** — откройте попап, нажмите правой кнопкой по попапу → «Просмотреть код» (или на `chrome://extensions` → «Просмотреть представления: popup»). Во вкладке **Console** при нажатии «Подобрать праймеры» появятся сообщения `PrimerDesigner API request failed: ...` при ошибке сети. Во вкладке **Network** будет виден запрос к `http://localhost:8000/api/design/` и его статус (Failed, 200, 503 и т.д.). Если запрос в списке с красным статусом или `ERR_FILE_NOT_FOUND` — проверьте, что в `config.js` указан именно `http://localhost:8000` или `http://127.0.0.1:8000`, а не относительный путь.

4. **ERR_FILE_NOT_FOUND** в консоли расширения часто означает не запрос к API, а неудачную загрузку скрипта/ресурса (например, неверный путь к модулю). Посмотрите во вкладке Network, какой именно URL дал ERR_FILE_NOT_FOUND — если это не `localhost:8000`, то проблема в другом ресурсе (путь к `config.js`, к иконкам и т.д.).

### Запуск через Docker (историческая справка)

Используйте **Docker Compose V2** (команда с пробелом):

```bash
cd primer-designer-extension
docker compose up --build
```

Если установлен только старый `docker-compose` (через pip/snap), установите плагин или используйте запуск без Docker (см. ниже).

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

### Серверный дизайн праймеров

- По умолчанию в контейнере **нет** тяжёлых движков (primer3-py не собирается в новых Python). Расширение при недоступности API использует **локальную эвристику** в браузере (в т.ч. анализ пересечений).
- Опционально можно установить в контейнер пакет для серверного расчёта, если он доступен: `pip install openprimer` (или primer3plus при среде, где он собирается). Эндпоинт сначала пробует openprimer, затем primer3plus.
- Для production с эталонным Primer3 см. **PRODUCTION_PRIMER3_MICROSERVICE.md** — отдельный микросервис на Python 3.9 с primer3-py.

### Улучшение эвристики по реальным данным

Текущая эвристика в расширении (`lib/heuristic-engine.js`) уже даёт анализ пересечений. Улучшать её «по реальным данным» можно так:

- Собирать ответы от серверного движка (OpenPrimer / primer3-py микросервис) и сравнивать с результатами эвристики (Tm, GC, штрафы, пересечения).
- Подбирать пороги и веса в эвристике (например, границы оценок A/B/C, коэффициенты штрафов за Tm/GC), чтобы минимизировать расхождение с эталоном.
- При наличии обратной связи от пользователей (хорошо/плохо пара) — учитывать её для калибровки оценок и предупреждений.

