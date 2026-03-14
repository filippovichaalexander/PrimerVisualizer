# Production: отдельный микросервис на primer3-py (Python 3.9)

## Зачем выносить в микросервис

Текущий бэкенд в Docker использует **OpenPrimer** (или при установке — primer3plus). Пакет **primer3-py** в современных образах (Python 3.11+) не собирается из‑за ошибки в Cython-коде (`thermoanalysis.pyx`). Для production можно поднять **отдельный микросервис** на **Python 3.9**, где primer3-py успешно ставится и даёт эталонный расчёт Primer3.

### Преимущества такого варианта

| Аспект | Преимущество |
|--------|---------------|
| **Эталонный расчёт** | Официальные термодинамические параметры Primer3 (SantaLucia, точный Tm, шпильки, димеры). |
| **Стабильная среда** | Фиксированный Python 3.9 — без гонки за новыми версиями Python и Cython. |
| **Масштабирование** | Микросервис можно масштабировать и балансировать отдельно от основного Django. |
| **Нагрузка** | Тяжёлый расчёт не блокирует остальные запросы основного приложения. |
| **Обновления** | Обновлять primer3-py/микросервис можно независимо от основного бэкенда. |
| **Формат API** | Тот же `POST /api/design/` с телом `{ "sequence", "tm", "gc", "length" }` — расширение просто переключает URL в конфиге. |

---

## Инструкция: поднять микросервис на Python 3.9

### 1. Отдельный каталог и виртуальное окружение

```bash
mkdir -p primer3-microservice
cd primer3-microservice
python3.9 -m venv .venv
source .venv/bin/activate   # Linux/macOS
# .venv\Scripts\activate    # Windows
```

### 2. Зависимости

**requirements.txt:**

```text
# Ядро расчёта — ставится на Python 3.9 без ошибок Cython
primer3-py>=0.6.0,<0.7.0
# Минимальный HTTP-сервер (или заменить на FastAPI/Flask)
flask>=2.0
gunicorn>=20.0
```

```bash
pip install -r requirements.txt
```

### 3. Совместимость с форматом расширения

Эндпоинт должен принимать `POST` с JSON:

```json
{ "sequence": "ATGC...", "tm": 60, "gc": 50, "length": 22 }
```

и возвращать:

```json
{ "results": [ { "id", "rank", "forward": { "sequence", "start", "end", "details": { "tm", "gc" } }, "reverse": { ... }, "totalScore", "grade", "warnings", "source": "server_primer3" } ] }
```

Использовать `primer3.bindings.design_primers()` или высокоуровневый API primer3-py и преобразовать вывод в этот формат (как в текущем `primerapi/views.py` для primer3plus).

### 4. CORS

Для вызовов из браузерного расширения на микросервисе нужно разрешить CORS: либо `Access-Control-Allow-Origin: *` для разработки, либо явный origin расширения.

### 5. Запуск

- **Разработка:** `flask run --host=0.0.0.0 --port=8001`
- **Production:** за обратным прокси (nginx/traefik), например:  
  `gunicorn -w 2 -b 0.0.0.0:8001 "app:app"`

### 6. Подключение расширения

В конфиге расширения (например `config.js`) указать URL этого микросервиса как `API_BASE_URL` (например `http://your-server:8001`). Расширение уже умеет вызывать `POST /api/design/` и обрабатывать ответ в текущем формате.

---

## Режим разработки (тот же подход сразу в dev)

В репозитории уже есть готовый микросервис в каталоге **`primer3_service/`** (Flask + primer3-py, Python 3.9). Его можно поднимать в разработке наравне с бэкендом.

### Вариант A: только микросервис (расширение стучится в него напрямую)

1. Запустить сервис:
   ```bash
   docker compose up primer3-service
   ```
2. В `config.js` задать:
   ```js
   export const API_BASE_URL = 'http://localhost:8001';
   ```
3. Расширение будет вызывать `POST http://localhost:8001/api/design/` и получать эталонный расчёт Primer3.

### Вариант B: бэкенд + микросервис (один URL для расширения)

1. Запустить оба контейнера:
   ```bash
   docker compose up backend primer3-service
   ```
2. В `config.js` оставить:
   ```js
   export const API_BASE_URL = 'http://localhost:8000';
   ```
3. В `.env` в корне проекта (или в `environment` сервиса `backend` в docker-compose) задать:
   ```env
   PRIMER3_MICROSERVICE_URL=http://primer3-service:8001
   ```
4. Django при отсутствии OpenPrimer/primer3plus будет проксировать запрос на микросервис и отдавать ответ расширению. Расширение по-прежнему обращается только к `http://localhost:8000`.

Таким образом, **в режиме разработки можно сразу использовать тот же подход**, что и в production: отдельный микросервис на Python 3.9 с primer3-py, без установки тяжёлых движков в основном бэкенде.

---

## Резюме

- **Сейчас:** расширение использует локальную эвристику (с анализом пересечений) и при наличии бэкенда — OpenPrimer (или primer3plus, если установлен).
- **Production:** поднять отдельный микросервис на **Python 3.9** с **primer3-py**, реализовать тот же контракт `POST /api/design/` и прописать его URL в расширении. Так вы получаете эталонный Primer3 без перехода основного бэкенда на старый Python.
