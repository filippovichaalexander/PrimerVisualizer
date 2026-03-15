"""
Микросервис эталонного расчёта Primer3 (primer3-py).
API совместим с расширением: POST /api/design/ с телом { sequence, tm, gc, length }.
Отладка: PRIMER3_DEBUG=1 в окружении — логи запросов и дедупликации.
"""
from math import fabs
import logging
import os

if os.environ.get("PRIMER3_DEBUG"):
    logging.basicConfig(level=logging.DEBUG)

from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app, origins=os.environ.get("CORS_ORIGINS", "*").split(","))


def _calc_tm(seq: str) -> float:
    seq = seq.upper()
    at = sum(1 for b in seq if b in "AT")
    gc = sum(1 for b in seq if b in "GC")
    return 2 * at + 4 * gc


def _calc_gc(seq: str) -> float:
    seq = seq.upper()
    if not seq:
        return 0.0
    gc = sum(1 for b in seq if b in "GC")
    return gc * 100.0 / len(seq)


def _grade_from_score(score: float) -> dict:
    if score >= 90:
        return {"letter": "A+", "color": "#22c55e", "description": "Идеальная пара"}
    if score >= 80:
        return {"letter": "A", "color": "#22c55e", "description": "Отличная пара"}
    if score >= 70:
        return {"letter": "B", "color": "#3b82f6", "description": "Хорошая пара"}
    if score >= 60:
        return {"letter": "C", "color": "#eab308", "description": "Приемлемая пара"}
    return {"letter": "D", "color": "#f97316", "description": "Требуется оптимизация"}


def _boulder_to_results(data: dict, sequence: str, target_tm: float, target_gc: float) -> list:
    """Конвертирует вывод design_primers (BoulderIO) в формат расширения. Дубликаты по (seq+координаты) отфильтровываются."""
    n = data.get("PRIMER_PAIR_NUM_RETURNED") or data.get("PRIMER_PAIR_NUM") or 0
    results = []
    seen_pairs = set()  # (fwd_seq, rev_seq, fwd_start, rev_start) для отсечения дубликатов
    for i in range(n):
        fwd_seq = data.get(f"PRIMER_LEFT_{i}_SEQUENCE") or ""
        rev_seq = data.get(f"PRIMER_RIGHT_{i}_SEQUENCE") or ""
        left_pos = data.get(f"PRIMER_LEFT_{i}")  # [start, length] or (start, length)
        right_pos = data.get(f"PRIMER_RIGHT_{i}")
        if isinstance(left_pos, (list, tuple)) and len(left_pos) >= 2:
            fwd_start, fwd_len = int(left_pos[0]), int(left_pos[1])
        else:
            fwd_start = sequence.find(fwd_seq) if fwd_seq else 0
            fwd_len = len(fwd_seq)
        if isinstance(right_pos, (list, tuple)) and len(right_pos) >= 2:
            rev_start = int(right_pos[0])
            rev_len = int(right_pos[1])
            rev_end = rev_start + rev_len
        else:
            rev_end = sequence.rfind(rev_seq) + len(rev_seq) if rev_seq else len(sequence)
            rev_start = rev_end - len(rev_seq) if rev_seq else rev_end
        pair_key = (fwd_seq, rev_seq, fwd_start, rev_start)
        if pair_key in seen_pairs:
            continue
        seen_pairs.add(pair_key)
        f_tm = data.get(f"PRIMER_LEFT_{i}_TM")
        if f_tm is None:
            f_tm = _calc_tm(fwd_seq)
        r_tm = data.get(f"PRIMER_RIGHT_{i}_TM")
        if r_tm is None:
            r_tm = _calc_tm(rev_seq)
        f_gc = data.get(f"PRIMER_LEFT_{i}_GC_PERCENT")
        if f_gc is None:
            f_gc = _calc_gc(fwd_seq)
        r_gc = data.get(f"PRIMER_RIGHT_{i}_GC_PERCENT")
        if r_gc is None:
            r_gc = _calc_gc(rev_seq)
        f_tm, r_tm = float(f_tm), float(r_tm)
        f_gc, r_gc = float(f_gc), float(r_gc)
        tm_penalty = fabs((f_tm + r_tm) / 2.0 - target_tm)
        gc_penalty = fabs((f_gc + r_gc) / 2.0 - target_gc)
        pair_tm_diff = fabs(f_tm - r_tm)
        raw_score = max(0.0, 100.0 - (tm_penalty * 1.5 + gc_penalty + pair_tm_diff * 2.0))
        grade = _grade_from_score(raw_score)
        warnings = []
        if pair_tm_diff > 3:
            warnings.append(f"Разница Tm между праймерами {pair_tm_diff:.1f}°C")
        self_any_l = data.get(f"PRIMER_LEFT_{i}_SELF_ANY_TH")
        self_any_r = data.get(f"PRIMER_RIGHT_{i}_SELF_ANY_TH")
        if self_any_l is not None and float(self_any_l) > 45:
            warnings.append("Высокий риск шпилек в прямом праймере")
        if self_any_r is not None and float(self_any_r) > 45:
            warnings.append("Высокий риск шпилек в обратном праймере")
        pair = {
            "id": f"server_primer3_{i}",
            "rank": i + 1,
            "forward": {
                "sequence": fwd_seq,
                "start": fwd_start,
                "end": fwd_start + fwd_len,
                "details": {"tm": {"value": f_tm}, "gc": {"value": f_gc}},
            },
            "reverse": {
                "sequence": rev_seq,
                "start": rev_start,
                "end": rev_end,
                "details": {"tm": {"value": r_tm}, "gc": {"value": r_gc}},
            },
            "totalScore": int(raw_score),
            "grade": grade,
            "warnings": warnings,
            "recommendations": [],
            "source": "server_primer3",
        }
        results.append(pair)
    results.sort(key=lambda x: x["totalScore"], reverse=True)
    for idx, r in enumerate(results):
        r["id"] = f"server_primer3_{idx}"
        r["rank"] = idx + 1
    if os.environ.get("PRIMER3_DEBUG") and n > 0:
        print(f"DEBUG: Primer3 вернул {n} пар, уникальных после фильтрации: {len(results)}")
        for i, r in enumerate(results):
            fwd = (r.get("forward") or {}).get("sequence", "")[:10]
            rev = (r.get("reverse") or {}).get("sequence", "")[:10]
            print(f"  Пара {i}: {fwd}... / {rev}...")
    return results


@app.route("/api/design/", methods=["POST"])
def design():
    """Pass-through с учётом расширенных настроек: minProductSize, maxProductSize, excludeRegions, minGc, maxGc."""
    body = request.get_json() or {}
    sequence = (body.get("sequence") or "").upper().replace(" ", "").replace("\n", "")
    try:
        target_tm = float(body.get("tm", 60))
        target_gc = float(body.get("gc", 50))
        length = int(body.get("length", 22))
    except (TypeError, ValueError):
        return jsonify({"detail": "Параметры tm/gc/length заданы некорректно"}), 400
    if len(sequence) < 50:
        return jsonify({"detail": "Минимальная длина последовательности: 50 нуклеотидов", "results": []}), 200

    import primer3

    # Диапазон размера продукта из запроса (профили qPCR / клонирование / секвенирование)
    min_product = body.get("minProductSize")
    max_product = body.get("maxProductSize")
    try:
        min_product = int(min_product) if min_product is not None else 50
        max_product = int(max_product) if max_product is not None else 500
    except (TypeError, ValueError):
        min_product, max_product = 50, 500
    min_product = max(50, min(1000, min_product))
    max_product = max(min_product, min(2000, max_product))
    if max_product - min_product <= 150:
        product_size_range = [[min_product, max_product]]
    else:
        mid = (min_product + max_product) // 2
        product_size_range = [
            [min_product, mid],
            [mid, max_product],
        ]

    # Исключённые регионы (не выбирать праймеры в этих участках)
    exclude_regions = body.get("excludeRegions") or []
    excluded_boulder = []
    for r in exclude_regions:
        try:
            s = int(r.get("start", 0))
            e = int(r.get("end", 0))
            if s < e and e <= len(sequence):
                excluded_boulder.append([s, e - s])
        except (TypeError, ValueError):
            continue

    tm_tolerance = float(body.get("tmTolerance", 3))
    temperature_gradient = float(body.get("temperatureGradient", 5))
    effective_target_tm = target_tm - temperature_gradient / 2

    if os.environ.get("PRIMER3_DEBUG"):
        print(
            f"Request: tm={target_tm}, tm_tolerance={tm_tolerance}, gradient={temperature_gradient}, "
            f"effective_tm={effective_target_tm}, gc={target_gc}, length={length}, "
            f"min_product={min_product}, max_product={max_product}, exclude_regions={len(excluded_boulder)}"
        )

    seq_gc = _calc_gc(sequence)
    if seq_gc > 75:
        min_gc = max(20, target_gc - 25)
        max_gc = 98
        min_tm = target_tm - 5
        max_tm = target_tm + 15
    elif seq_gc < 25:
        min_gc = 2
        max_gc = min(85, target_gc + 25)
        min_tm = target_tm - 15
        max_tm = target_tm + 5
    else:
        min_gc = max(20, target_gc - 15)
        max_gc = min(80, target_gc + 15)
        min_tm = effective_target_tm - tm_tolerance
        max_tm = effective_target_tm + tm_tolerance

    if body.get("minGc") is not None:
        try:
            min_gc = max(20, min(80, int(body["minGc"])))
        except (TypeError, ValueError):
            pass
    if body.get("maxGc") is not None:
        try:
            max_gc = max(min_gc, min(98, int(body["maxGc"])))
        except (TypeError, ValueError):
            pass

    seq_args = {
        "SEQUENCE_TEMPLATE": sequence,
        "SEQUENCE_ID": "design",
    }
    if excluded_boulder:
        seq_args["SEQUENCE_EXCLUDED_REGION"] = excluded_boulder

    global_args = {
        "PRIMER_OPT_TM": effective_target_tm,
        "PRIMER_MIN_TM": min_tm,
        "PRIMER_MAX_TM": max_tm,
        "PRIMER_OPT_SIZE": length,
        "PRIMER_MIN_SIZE": max(18, length - 2),
        "PRIMER_MAX_SIZE": min(35, length + 2),
        "PRIMER_MIN_GC": min_gc,
        "PRIMER_MAX_GC": max_gc,
        "PRIMER_NUM_RETURN": 10,
        "PRIMER_PRODUCT_SIZE_RANGE": product_size_range,
        "PRIMER_PICK_LEFT_PRIMER": 1,
        "PRIMER_PICK_RIGHT_PRIMER": 1,
        "PRIMER_PICK_INTERNAL_OLIGO": 0,
    }
    try:
        result = primer3.bindings.design_primers(seq_args, global_args)
    except Exception as e:
        detail = str(e).strip()
        if len(detail) > 200:
            detail = detail[:197] + "..."
        return jsonify({"detail": detail or "Primer3 не подобрал пары", "results": []}), 200

    n = result.get("PRIMER_PAIR_NUM_RETURNED") or result.get("PRIMER_PAIR_NUM") or 0
    if n == 0:
        explain = (
            result.get("PRIMER_PAIR_EXPLAIN")
            or result.get("PRIMER_LEFT_EXPLAIN")
            or "Праймеры не найдены"
        )
        return jsonify({"detail": explain, "results": []}), 200

    results = _boulder_to_results(result, sequence, target_tm, target_gc)
    return jsonify({"results": results})


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "primer3"})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8001))
    app.run(host="0.0.0.0", port=port, debug=os.environ.get("FLASK_DEBUG", "0") == "1")
