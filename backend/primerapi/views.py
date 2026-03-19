import json
import logging
import os
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from django.http import HttpResponse
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

logger = logging.getLogger(__name__)

PRIMER3_SERVICE_URL = os.environ.get("PRIMER3_MICROSERVICE_URL", "http://primer3-service:8001").rstrip("/")


def root_info(request):
    body = """
    <!DOCTYPE html>
    <html>
    <head><meta charset='utf-8'><title>PrimerDesigner API</title></head>
    <body>
        <h1>PrimerDesigner API</h1>
        <p>Backend запущен. Используется микросервис Primer3.</p>
        <p>Статус микросервиса: <span id="status">проверка...</span></p>
        <script>
            fetch('/api/health/')
                .then(r => r.json())
                .then(d => document.getElementById('status').textContent = d.primer3_service || d.status)
                .catch(() => document.getElementById('status').textContent = 'недоступен');
        </script>
        <p><a href='/admin/'>Django Admin</a> | <a href='/api/health/'>Health check</a></p>
    </body>
    </html>
    """
    return HttpResponse(body, content_type="text/html; charset=utf-8")


@api_view(["GET"])
def health_check(_request):
    try:
        req = Request(f"{PRIMER3_SERVICE_URL}/health", method="GET")
        with urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            primer3_status = data.get("status", "unknown")
    except Exception as e:
        primer3_status = f"error: {str(e)}"

    return Response(
        {
            "status": "ok",
            "service": "django-backend",
            "primer3_service": primer3_status,
            "version": "2.0.0",
        }
    )


@api_view(["POST"])
def design_primers(request):
    try:
        return _proxy_to_primer3(request)
    except Exception as e:
        logger.error("Design error: %s", str(e), exc_info=True)
        return Response(
            {"detail": f"Внутренняя ошибка: {str(e)}", "results": []},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


def _proxy_to_primer3(request):
    sequence = (request.data.get("sequence") or "").upper().replace(" ", "").replace("\n", "")
    if len(sequence) < 50:
        return Response(
            {"detail": "Минимальная длина последовательности: 50 нуклеотидов"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    payload_data = dict(request.data) if request.data else {}
    payload_data["sequence"] = sequence
    payload = json.dumps(payload_data).encode("utf-8")

    try:
        req = Request(
            f"{PRIMER3_SERVICE_URL}/api/design/",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urlopen(req, timeout=int(os.environ.get("PRIMER3_TIMEOUT", 30))) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return Response(data, status=resp.status)
    except HTTPError as e:
        error_body = e.read().decode("utf-8") if hasattr(e, "read") else str(e)
        return Response(
            {"detail": f"Ошибка микросервиса Primer3: {error_body}", "results": []},
            status=e.code if hasattr(e, "code") else 500,
        )
    except URLError:
        return Response(
            {
                "detail": "Микросервис Primer3 не отвечает. Убедитесь, что он запущен: docker compose up primer3-service",
                "results": [],
            },
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )