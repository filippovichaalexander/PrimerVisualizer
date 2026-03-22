"""Primer3 microservice with cache and health endpoints."""
import hashlib
import json
import logging
import os
import time
from typing import Any, Dict, Optional

import primer3
from flask import Flask, jsonify, request
from flask_cors import CORS

from utils import boulder_to_results, calculate_gc

logging.basicConfig(
    level=logging.INFO if not os.environ.get("PRIMER3_DEBUG") else logging.DEBUG,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("primer3_service")

app = Flask(__name__)
CORS(app, origins=os.environ.get("CORS_ORIGINS", "*").split(","))

_MEM_CACHE: Dict[str, Dict[str, Any]] = {}
CACHE_TTL_SEC = int(os.environ.get("CACHE_TTL", 3600))
MAX_SEQUENCE = int(os.environ.get("PRIMER3_MAX_SEQUENCE", 10000))


def _make_cache_key(sequence: str, body: Dict[str, Any]) -> str:
    return hashlib.md5(f"{sequence}_{json.dumps(body, sort_keys=True)}".encode()).hexdigest()


def _cache_get(cache_key: str) -> Optional[Dict[str, Any]]:
    rec = _MEM_CACHE.get(cache_key)
    if not rec:
        return None
    if time.time() - rec["ts"] > CACHE_TTL_SEC:
        _MEM_CACHE.pop(cache_key, None)
        return None
    return rec["value"]


def _cache_set(cache_key: str, value: Dict[str, Any]) -> None:
    _MEM_CACHE[cache_key] = {"ts": time.time(), "value": value}


@app.route("/api/design/", methods=["POST"])
def design():
    """Main endpoint for primer design with local cache."""
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
    if len(sequence) > MAX_SEQUENCE:
        return jsonify({"detail": f"Максимальная длина последовательности: {MAX_SEQUENCE}", "results": []}), 200

    cache_key = _make_cache_key(sequence, body)
    cached = _cache_get(cache_key)
    if cached:
        return jsonify({"cached": True, **cached})

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

    seq_gc = calculate_gc(sequence)
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

    # Доп. параметры из расширения (camelCase, прокси Django без изменений)
    check_hairpins = body.get("checkHairpins", body.get("check_hairpins", True))
    check_dimers = body.get("checkDimers", body.get("check_dimers", True))
    if check_hairpins and check_dimers:
        global_args["PRIMER_MAX_SELF_ANY"] = 8
        global_args["PRIMER_MAX_SELF_END"] = 3
    else:
        global_args["PRIMER_MAX_SELF_ANY"] = 47
        global_args["PRIMER_MAX_SELF_END"] = 47

    check_repeats = body.get("checkRepeats", body.get("check_repeats", True))
    max_poly = body.get("maxPolyX", body.get("max_poly_x"))
    if not check_repeats:
        global_args["PRIMER_MAX_POLY_X"] = 20
    elif max_poly is not None:
        try:
            global_args["PRIMER_MAX_POLY_X"] = max(3, min(20, int(max_poly)))
        except (TypeError, ValueError):
            pass

    for json_key, p3_key in (
        ("saltNa", "PRIMER_SALT_MONOVALENT"),
        ("saltMg", "PRIMER_SALT_DIVALENT"),
        ("saltDntp", "PRIMER_DNTP_CONC"),
        ("saltDna", "PRIMER_DNA_CONC"),
    ):
        if body.get(json_key) is not None:
            try:
                global_args[p3_key] = float(body[json_key])
            except (TypeError, ValueError):
                pass

    try:
        started = time.time()
        result = primer3.bindings.design_primers(seq_args, global_args)
        duration = time.time() - started
        logger.info("Primer3 finished in %.2fs", duration)
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

    results = boulder_to_results(result, sequence, target_tm, target_gc)
    response = {
        "results": results,
        "metadata": {
            "pairs_found": len(results),
            "cache_ttl_sec": CACHE_TTL_SEC,
        },
    }
    _cache_set(cache_key, response)
    return jsonify(response)


@app.route("/health", methods=["GET"])
def health():
    return jsonify(
        {
            "status": "ok",
            "service": "primer3",
            "version": "2.0.0",
            "cache_type": "memory",
            "cache_entries": len(_MEM_CACHE),
            "max_sequence": MAX_SEQUENCE,
        }
    )


@app.route("/api/design/parameters/", methods=["GET"])
def get_parameters():
    return jsonify(
        {
            "parameters": {
                "tm": {"min": 50, "max": 70, "default": 60},
                "length": {"min": 18, "max": 35, "default": 22},
                "gc": {"min": 30, "max": 70, "default": 50},
                "product_size": {"min": 50, "max": 2000, "default_min": 80, "default_max": 500},
                "tm_tolerance": {"min": 1, "max": 10, "default": 3},
                "gradient": {"min": 0, "max": 15, "default": 5},
            },
            "version": "2.0.0",
        }
    )


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8001))
    app.run(host="0.0.0.0", port=port, debug=os.environ.get("FLASK_DEBUG", "0") == "1")
