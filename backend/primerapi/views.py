from math import fabs

from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status


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


@api_view(["POST"])
def design_primers(request):
    """
    Простейшая серверная реализация бизнес-логики:
    - принимает sequence, tm, gc, length;
    - генерирует окна по последовательности;
    - для каждой пары считает Tm/GC и выдает тот же формат, что и popup ожидает.
    """

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

    results = []
    step = max(len(sequence) // 15, 1)

    for i in range(10):
        start = i * step
        end = start + length
        if end >= len(sequence):
            break

        fwd_seq = sequence[start:end]
        rev_seq = sequence[len(sequence) - end : len(sequence) - start]

        f_tm = calculate_tm(fwd_seq)
        r_tm = calculate_tm(rev_seq)
        f_gc = calculate_gc(fwd_seq)
        r_gc = calculate_gc(rev_seq)

        tm_penalty = fabs(f_tm - target_tm)
        gc_penalty = fabs((f_gc + r_gc) / 2.0 - target_gc)
        pair_tm_diff = fabs(f_tm - r_tm)

        raw_score = max(0.0, 100.0 - (tm_penalty * 1.5 + gc_penalty + pair_tm_diff * 2.0))
        grade = grade_from_score(raw_score)

        warnings = []
        if pair_tm_diff > 3:
            warnings.append(f"Разница Tm между праймерами {pair_tm_diff:.1f}°C")
        if f_gc < 35 or f_gc > 65 or r_gc < 35 or r_gc > 65:
            warnings.append("GC-состав выходит за рекомендуемый диапазон 40–60%")

        pair = {
            "id": f"server_{i}",
            "rank": i + 1,
            "forward": {
                "sequence": fwd_seq,
                "start": start,
                "end": end,
                "details": {
                    "tm": {"value": f_tm},
                    "gc": {"value": f_gc},
                },
            },
            "reverse": {
                "sequence": rev_seq,
                "start": len(sequence) - end,
                "end": len(sequence) - start,
                "details": {
                    "tm": {"value": r_tm},
                    "gc": {"value": r_gc},
                },
            },
            "totalScore": int(raw_score),
            "grade": grade,
            "warnings": warnings,
            "recommendations": [],
            "source": "server",
        }
        results.append(pair)

    results.sort(key=lambda p: p["totalScore"], reverse=True)

    return Response({"results": results})

