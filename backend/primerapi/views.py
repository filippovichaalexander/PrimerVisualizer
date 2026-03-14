import json
import os
from math import fabs
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

from django.http import HttpResponse
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status


def root_info(request):
    """Главная страница бэкенда: чтобы не показывать 404 на /."""
    body = (
        "<!DOCTYPE html><html><head><meta charset='utf-8'><title>PrimerDesigner API</title></head><body>"
        "<h1>PrimerDesigner API</h1>"
        "<p>Backend запущен. Эндпоинт дизайна праймеров: <code>POST /api/design/</code></p>"
        "<p><a href='/admin/'>Django Admin</a></p>"
        "</body></html>"
    )
    return HttpResponse(body, content_type="text/html; charset=utf-8")

# primer3plus импортируется при вызове design_primers (отложенный импорт),
# чтобы сервер мог запуститься даже если пакет не установлен

# Вспомогательные функции можно оставить (они не помешают)
def calculate_tm(seq: str) -> float:
    seq = seq.upper()
    at = sum(1 for b in seq if b in "AT")
    gc = sum(1 for b in seq if b in "GC")
    return 2 * at + 4 * gc

def calculate_gc(seq: str) -> float:
    seq = seq.upper()
    if not seq:
        return 0.0
    gc = sum(1 for b in seq if b in "GC")
    return gc * 100.0 / len(seq)

def grade_from_score(score: float) -> dict:
    if score >= 90:
        return {"letter": "A+", "color": "#22c55e", "description": "Идеальная пара"}
    if score >= 80:
        return {"letter": "A", "color": "#22c55e", "description": "Отличная пара"}
    if score >= 70:
        return {"letter": "B", "color": "#3b82f6", "description": "Хорошая пара"}
    if score >= 60:
        return {"letter": "C", "color": "#eab308", "description": "Приемлемая пара"}
    return {"letter": "D", "color": "#f97316", "description": "Требуется оптимизация"}

def _openprimer_to_results(primers, sequence, target_tm, target_gc):
    """Конвертирует результат openprimer.Design().design_primers() в формат расширения."""
    results = []
    for i, p in enumerate(primers):
        # Поддержка dict или object
        get_v = lambda obj, k, default=None: obj.get(k, default) if isinstance(obj, dict) else getattr(obj, k, default)
        fwd = get_v(p, "forward_sequence") or get_v(p, "forward") or get_v(p, "forward_seq") or ""
        rev = get_v(p, "reverse_sequence") or get_v(p, "reverse") or get_v(p, "reverse_seq") or ""
        if isinstance(fwd, (dict, type(p))):
            fwd = get_v(fwd, "sequence") or get_v(fwd, "seq") or str(fwd)
        if isinstance(rev, (dict, type(p))):
            rev = get_v(rev, "sequence") or get_v(rev, "seq") or str(rev)
        fwd = str(fwd).upper()
        rev = str(rev).upper()
        f_tm = get_v(p, "tm") or get_v(p, "forward_tm")
        if f_tm is None:
            f_tm = calculate_tm(fwd)
        r_tm = get_v(p, "reverse_tm")
        if r_tm is None:
            r_tm = calculate_tm(rev)
        f_gc = get_v(p, "gc") or get_v(p, "gc_percent")
        if f_gc is None:
            f_gc = calculate_gc(fwd)
        r_gc = get_v(p, "reverse_gc")
        if r_gc is None:
            r_gc = calculate_gc(rev)
        fwd_start = get_v(p, "forward_start") or get_v(p, "start")
        if fwd_start is None and fwd:
            fwd_start = sequence.find(fwd)
        if fwd_start == -1:
            fwd_start = 0
        rev_end = get_v(p, "reverse_end") or get_v(p, "end")
        if rev_end is None and rev:
            rev_end = sequence.rfind(rev)
        if rev_end == -1:
            rev_end = len(sequence)
        rev_start = rev_end - len(rev) if rev else rev_end
        tm_penalty = fabs((float(f_tm) + float(r_tm)) / 2.0 - target_tm)
        gc_penalty = fabs((float(f_gc) + float(r_gc)) / 2.0 - target_gc)
        pair_tm_diff = fabs(float(f_tm) - float(r_tm))
        raw_score = max(0.0, 100.0 - (tm_penalty * 1.5 + gc_penalty + pair_tm_diff * 2.0))
        grade = grade_from_score(raw_score)
        warnings = []
        if pair_tm_diff > 3:
            warnings.append(f"Разница Tm между праймерами {pair_tm_diff:.1f}°C")
        pair = {
            "id": f"server_openprimer_{i}",
            "rank": i + 1,
            "forward": {
                "sequence": fwd,
                "start": int(fwd_start),
                "end": int(fwd_start) + len(fwd),
                "details": {"tm": {"value": float(f_tm)}, "gc": {"value": float(f_gc)}},
            },
            "reverse": {
                "sequence": rev,
                "start": int(rev_start),
                "end": int(rev_end),
                "details": {"tm": {"value": float(r_tm)}, "gc": {"value": float(r_gc)}},
            },
            "totalScore": int(raw_score),
            "grade": grade,
            "warnings": warnings,
            "recommendations": [],
            "source": "server_openprimer",
        }
        results.append(pair)
    results.sort(key=lambda x: x["totalScore"], reverse=True)
    return results


@api_view(["POST"])
def design_primers(request):
    """
    Серверный дизайн: сначала OpenPrimer (лёгкая замена), при недоступности — primer3plus.
    Формат ответа совместим с расширением.
    """
    try:
        return _design_primers_impl(request)
    except Exception as e:
        return Response(
            {"detail": f"Внутренняя ошибка: {e}", "results": []},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


def _design_primers_impl(request):
    sequence = (request.data.get("sequence") or "").upper().replace(" ", "").replace("\n", "")

    try:
        target_tm = float(request.data.get("tm", 60))
        target_gc = float(request.data.get("gc", 50))
        length = int(request.data.get("length", 22))
    except (TypeError, ValueError):
        return Response(
            {"detail": "Параметры tm/gc/length заданы некорректно"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if len(sequence) < 50:
        return Response(
            {"detail": "Минимальная длина последовательности: 50 нуклеотидов"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # 1) Пробуем OpenPrimer (лёгкая замена, pip install openprimer)
    try:
        from openprimer import Design as OpenPrimerDesign
        design = OpenPrimerDesign(sequence)
        design.parameters.tm = target_tm
        design.parameters.gc_min = max(20, target_gc - 15)
        design.parameters.gc_max = min(80, target_gc + 15)
        if hasattr(design.parameters, "primer_length"):
            design.parameters.primer_length = length
        primers = design.design_primers()
        if primers:
            results = _openprimer_to_results(primers, sequence, target_tm, target_gc)
            return Response({"results": results})
    except ModuleNotFoundError:
        pass
    except Exception as e:
        pass  # fallback to primer3plus

    # 2) Пробуем primer3plus (если установлен)
    try:
        from primer3plus import Design
        from primer3plus.design import DesignError
    except ModuleNotFoundError:
        # 3) Прокси на микросервис Primer3 (режим разработки / production)
        micro_url = os.environ.get("PRIMER3_MICROSERVICE_URL", "").rstrip("/")
        if micro_url:
            try:
                # Передаём в микросервис весь body (в т.ч. minProductSize, maxProductSize, excludeRegions, minGc, maxGc)
                payload_data = dict(request.data) if request.data else {}
                payload_data.setdefault("sequence", sequence)
                payload_data.setdefault("tm", target_tm)
                payload_data.setdefault("gc", target_gc)
                payload_data.setdefault("length", length)
                payload = json.dumps(payload_data).encode("utf-8")
                req = Request(
                    f"{micro_url}/api/design/",
                    data=payload,
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urlopen(req, timeout=30) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                return Response(data, status=resp.status)
            except (HTTPError, URLError, OSError, ValueError, KeyError) as e:
                pass  # fallback to 503
        return Response(
            {
                "detail": "Не установлен ни openprimer, ни primer3plus. Для дизайна через Primer3 запустите оба контейнера: docker compose up backend primer3-service"
            },
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    try:
        design = Design()
        
        # Базовые настройки
        design.settings.template(sequence)
        design.settings.primer_num_return(10)  # Сколько пар вернуть
        
        # Настройка температуры плавления
        design.settings.PRIMER_OPT_TM.value = target_tm
        design.settings.PRIMER_MIN_TM.value = target_tm - 3
        design.settings.PRIMER_MAX_TM.value = target_tm + 3
        
        # Настройка длины праймера
        design.settings.PRIMER_MIN_SIZE.value = length - 2
        design.settings.PRIMER_OPT_SIZE.value = length
        design.settings.PRIMER_MAX_SIZE.value = length + 2
        
        # Настройка GC-состава (опционально)
        design.settings.PRIMER_MIN_GC.value = max(20, target_gc - 15)
        design.settings.PRIMER_OPT_GC_PERCENT.value = target_gc
        design.settings.PRIMER_MAX_GC.value = min(80, target_gc + 15)
        
        # Размер продукта (можно настроить под ваши задачи)
        design.settings.product_size((100, 300))
        
        # Запускаем Primer3
        left_primers, right_primers = design.run()
        
        # === Конвертируем результат Primer3 в формат расширения ===
        results = []
        
        # Primer3 возвращает списки словарей для левых и правых праймеров
        for i, (left, right) in enumerate(zip(left_primers, right_primers)):
            # Извлекаем данные из результата Primer3
            fwd_seq = left.get('SEQUENCE', '')
            rev_seq = right.get('SEQUENCE', '')
            
            # Primer3 часто не возвращает позиции, но мы можем их примерно оценить
            # Для точных позиций нужно использовать поиск подстроки
            fwd_start = sequence.find(fwd_seq)
            if fwd_start == -1:
                fwd_start = 0  # fallback
            
            rev_end = sequence.rfind(rev_seq)
            if rev_end == -1:
                rev_end = len(sequence)
            rev_start = rev_end - len(rev_seq)
            
            # Получаем значения из Primer3 или используем наши fallback
            f_tm = left.get('TM', calculate_tm(fwd_seq))
            r_tm = right.get('TM', calculate_tm(rev_seq))
            f_gc = left.get('GC_PERCENT', calculate_gc(fwd_seq))
            r_gc = right.get('GC_PERCENT', calculate_gc(rev_seq))
            
            # Вычисляем штрафы для общей оценки
            tm_penalty = fabs((f_tm + r_tm) / 2.0 - target_tm)
            gc_penalty = fabs((f_gc + r_gc) / 2.0 - target_gc)
            pair_tm_diff = fabs(f_tm - r_tm)
            
            raw_score = max(0.0, 100.0 - (tm_penalty * 1.5 + gc_penalty + pair_tm_diff * 2.0))
            grade = grade_from_score(raw_score)
            
            # Собираем предупреждения из Primer3
            warnings = []
            
            # Проверка на вторичные структуры (если есть в данных Primer3)
            if left.get('SELF_ANY_TH', 0) > 45:
                warnings.append("Высокий риск шпилек в прямом праймере")
            if right.get('SELF_ANY_TH', 0) > 45:
                warnings.append("Высокий риск шпилек в обратном праймере")
            
            # Проверка на димеры
            if left.get('SELF_END_TH', 0) > 3:
                warnings.append("Риск димеризации прямого праймера")
            
            if pair_tm_diff > 3:
                warnings.append(f"Разница Tm между праймерами {pair_tm_diff:.1f}°C")
            
            pair = {
                "id": f"server_primer3_{i}",
                "rank": i + 1,
                "forward": {
                    "sequence": fwd_seq,
                    "start": fwd_start,
                    "end": fwd_start + len(fwd_seq),
                    "details": {
                        "tm": {"value": f_tm},
                        "gc": {"value": f_gc},
                        "self_any_th": left.get('SELF_ANY_TH', 0),
                        "self_end_th": left.get('SELF_END_TH', 0),
                    },
                },
                "reverse": {
                    "sequence": rev_seq,
                    "start": rev_start,
                    "end": rev_end,
                    "details": {
                        "tm": {"value": r_tm},
                        "gc": {"value": r_gc},
                        "self_any_th": right.get('SELF_ANY_TH', 0),
                        "self_end_th": right.get('SELF_END_TH', 0),
                    },
                },
                "totalScore": int(raw_score),
                "grade": grade,
                "warnings": warnings,
                "recommendations": [],
                "source": "server_primer3",  # Отличаем от вашей реализации
            }
            results.append(pair)
        
        # Сортируем по убыванию оценки
        results.sort(key=lambda p: p["totalScore"], reverse=True)
        
        return Response({"results": results})
    
    except DesignError as e:
        # Ошибка Primer3 - возвращаем понятное сообщение
        return Response(
            {"detail": f"Ошибка Primer3: {str(e)}", "results": []},
            status=status.HTTP_200_OK,  # 200, чтобы расширение не падало
        )
    except Exception as e:
        # Любая другая ошибка
        return Response(
            {"detail": f"Внутренняя ошибка сервера: {str(e)}", "results": []},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )