from math import fabs
from typing import Dict, List
import hashlib
import logging

logger = logging.getLogger(__name__)


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


def grade_from_score(score: float) -> Dict:
    if score >= 90:
        return {"letter": "A+", "color": "#22c55e", "description": "Идеальная пара"}
    if score >= 80:
        return {"letter": "A", "color": "#22c55e", "description": "Отличная пара"}
    if score >= 70:
        return {"letter": "B", "color": "#3b82f6", "description": "Хорошая пара"}
    if score >= 60:
        return {"letter": "C", "color": "#eab308", "description": "Приемлемая пара"}
    return {"letter": "D", "color": "#f97316", "description": "Требуется оптимизация"}


def boulder_to_results(data: Dict, sequence: str, target_tm: float, target_gc: float) -> List[Dict]:
    n = data.get("PRIMER_PAIR_NUM_RETURNED") or data.get("PRIMER_PAIR_NUM") or 0
    results = []
    seen_pairs = set()

    for i in range(n):
        fwd_seq = data.get(f"PRIMER_LEFT_{i}_SEQUENCE") or ""
        rev_seq = data.get(f"PRIMER_RIGHT_{i}_SEQUENCE") or ""

        left_pos = data.get(f"PRIMER_LEFT_{i}")
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
            f_tm = calculate_tm(fwd_seq)
        r_tm = data.get(f"PRIMER_RIGHT_{i}_TM")
        if r_tm is None:
            r_tm = calculate_tm(rev_seq)

        f_gc = data.get(f"PRIMER_LEFT_{i}_GC_PERCENT")
        if f_gc is None:
            f_gc = calculate_gc(fwd_seq)
        r_gc = data.get(f"PRIMER_RIGHT_{i}_GC_PERCENT")
        if r_gc is None:
            r_gc = calculate_gc(rev_seq)

        f_tm, r_tm = float(f_tm), float(r_tm)
        f_gc, r_gc = float(f_gc), float(r_gc)

        tm_penalty = fabs((f_tm + r_tm) / 2.0 - target_tm)
        gc_penalty = fabs((f_gc + r_gc) / 2.0 - target_gc)
        pair_tm_diff = fabs(f_tm - r_tm)
        raw_score = max(0.0, 100.0 - (tm_penalty * 1.5 + gc_penalty + pair_tm_diff * 2.0))
        grade = grade_from_score(raw_score)

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
            "id": f"server_primer3_{i}_{hashlib.md5(fwd_seq.encode()).hexdigest()[:4]}",
            "rank": i + 1,
            "forward": {
                "sequence": fwd_seq,
                "start": fwd_start,
                "end": fwd_start + fwd_len,
                "details": {
                    "tm": {"value": round(f_tm, 1)},
                    "gc": {"value": round(f_gc, 1)},
                    "self_any_th": float(self_any_l) if self_any_l else 0,
                    "self_end_th": float(data.get(f"PRIMER_LEFT_{i}_SELF_END_TH", 0)),
                    "hairpin_th": float(data.get(f"PRIMER_LEFT_{i}_HAIRPIN_TH", 0)),
                },
            },
            "reverse": {
                "sequence": rev_seq,
                "start": rev_start,
                "end": rev_end,
                "details": {
                    "tm": {"value": round(r_tm, 1)},
                    "gc": {"value": round(r_gc, 1)},
                    "self_any_th": float(self_any_r) if self_any_r else 0,
                    "self_end_th": float(data.get(f"PRIMER_RIGHT_{i}_SELF_END_TH", 0)),
                    "hairpin_th": float(data.get(f"PRIMER_RIGHT_{i}_HAIRPIN_TH", 0)),
                },
            },
            "totalScore": int(raw_score),
            "grade": grade,
            "warnings": warnings,
            "recommendations": [],
            "source": "server_primer3",
            "metadata": {
                "product_size": rev_end - fwd_start,
                "pair_tm_diff": round(pair_tm_diff, 1),
            },
        }
        results.append(pair)

    results.sort(key=lambda x: x["totalScore"], reverse=True)
    for idx, r in enumerate(results):
        r["rank"] = idx + 1
        r["id"] = f"server_primer3_{idx}_{hashlib.md5(r['forward']['sequence'].encode()).hexdigest()[:4]}"

    return results
