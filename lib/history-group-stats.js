/**
 * Группировка истории дизайнов для вкладки «История» (optimization_8).
 * Статистика осмысленна в разрезе последовательности / дня / гена.
 */

function normSeq(s) {
    return (s || '').replace(/\s/g, '').toUpperCase();
}

/**
 * Ключ группировки избранного по последовательности шаблона или по парам F/R.
 * @param {any} item элемент savedPrimers
 */
export function favoriteSeqKey(item) {
    const seq = normSeq(item?.sequence || '');
    if (seq) return seq;
    const f = normSeq(item?.pair?.forward?.sequence || '');
    const r = normSeq(item?.pair?.reverse?.sequence || '');
    if (f || r) return `pair:${f}|${r}`;
    return `id:${item?.id ?? Math.random()}`;
}

/**
 * Мода для чисел (округление до 0.1 для Tm/GC).
 * @param {number[]} nums
 * @returns {number | null}
 */
export function getMostFrequentNumeric(nums) {
    const arr = (nums || []).filter((n) => Number.isFinite(n));
    if (!arr.length) return null;
    const counts = new Map();
    for (const n of arr) {
        const k = Math.round(n * 10) / 10;
        counts.set(k, (counts.get(k) || 0) + 1);
    }
    let best = arr[0];
    let bestC = 0;
    for (const [k, c] of counts) {
        if (c > bestC) {
            bestC = c;
            best = k;
        }
    }
    return best;
}

/** Короткие сигнатуры для эвристики «возможно TP53» (фрагменты CDS, не весь ген). */
const GENE_FINGERPRINTS = [
    { re: /ATGGAGGAGCCGCAGTCAGATCCT/i, name: 'TP53 (фрагмент)' },
    { re: /ATGGTGACCCGACTGGAAGTCC/i, name: 'ACTB (фрагмент)' },
    { re: /ATGGAAGCCCAGCGTGGG/i, name: 'GAPDH (фрагмент)' },
];

export class HistoryGroupStats {
    /**
     * @param {any[]} history
     * @returns {Map<string, any>}
     */
    groupBySequence(history) {
        const groups = new Map();

        for (const item of history) {
            const sequence = normSeq(item.sequence || '');
            const key = sequence || `empty_${item.timestamp || Math.random()}`;
            const seqPreview =
                sequence.length <= 60 ? sequence : `${sequence.slice(0, 40)}…${sequence.slice(-20)}`;

            if (!groups.has(key)) {
                groups.set(key, {
                    sequence,
                    sequencePreview: seqPreview,
                    sequenceLength: item.sequence_length || sequence.length,
                    geneName: this.extractGeneName(item),
                    designs: [],
                    firstDesign: item.timestamp || 0,
                    lastDesign: item.timestamp || 0,
                    bestScore: 0,
                    bestPair: null,
                    totalPairs: 0,
                    avgScore: 0,
                    avgPairs: 0,
                    designCount: 0,
                });
            }

            const group = groups.get(key);
            group.designs.push(item);
            group.designCount += 1;
            group.lastDesign = Math.max(group.lastDesign, item.timestamp || 0);
            group.firstDesign = Math.min(group.firstDesign, item.timestamp || 0);

            const bestScoreInDesign = this.getBestScore(item);
            if (bestScoreInDesign > group.bestScore) {
                group.bestScore = bestScoreInDesign;
                group.bestPair = this.getBestPair(item);
            }

            group.totalPairs +=
                item.results_count ?? item.results?.length ?? item.primers?.length ?? 0;
        }

        for (const group of groups.values()) {
            const n = group.designCount || 1;
            const sumBest = group.designs.reduce((sum, d) => sum + this.getBestScore(d), 0);
            group.avgScore = Math.round(sumBest / n);
            group.avgPairs = Math.round(group.totalPairs / n);
        }

        return Array.from(groups.values());
    }

    /**
     * @param {any[]} history
     */
    groupByDate(history) {
        const map = new Map();

        for (const item of history) {
            const ts = item.timestamp || 0;
            const dateLabel = new Date(ts).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
            });
            if (!map.has(dateLabel)) {
                map.set(dateLabel, {
                    dateLabel,
                    sequencePreview: dateLabel,
                    geneName: null,
                    designs: [],
                    firstDesign: ts,
                    lastDesign: ts,
                    bestScore: 0,
                    bestPair: null,
                    totalPairs: 0,
                    avgScore: 0,
                    avgPairs: 0,
                    designCount: 0,
                    sequence: '',
                    sequenceLength: 0,
                });
            }
            const g = map.get(dateLabel);
            g.designs.push(item);
            g.designCount += 1;
            g.lastDesign = Math.max(g.lastDesign, ts);
            g.firstDesign = Math.min(g.firstDesign, ts);
            const bs = this.getBestScore(item);
            if (bs > g.bestScore) {
                g.bestScore = bs;
                g.bestPair = this.getBestPair(item);
            }
            g.totalPairs +=
                item.results_count ?? item.results?.length ?? item.primers?.length ?? 0;
        }

        for (const g of map.values()) {
            const n = g.designCount || 1;
            g.avgScore = Math.round(
                g.designs.reduce((sum, d) => sum + this.getBestScore(d), 0) / n,
            );
            g.avgPairs = Math.round(g.totalPairs / n);
        }

        return Array.from(map.values());
    }

    /**
     * @param {any[]} history
     */
    groupByGene(history) {
        const map = new Map();

        for (const item of history) {
            const geneName = this.extractGeneName(item) || 'Неизвестный ген / нет метки';
            const geneKey = geneName.toLowerCase();

            if (!map.has(geneKey)) {
                map.set(geneKey, {
                    geneName,
                    sequences: [],
                    sequenceSet: new Set(),
                    designs: [],
                    designCount: 0,
                    totalPairs: 0,
                    bestScore: 0,
                    avgScore: 0,
                    avgPairs: 0,
                    lastDesign: item.timestamp || 0,
                    firstDesign: item.timestamp || 0,
                    sequencePreview: geneName,
                    sequence: '',
                    sequenceLength: 0,
                    bestPair: null,
                });
            }

            const g = map.get(geneKey);
            g.designs.push(item);
            g.designCount += 1;
            g.totalPairs +=
                item.results_count ?? item.results?.length ?? item.primers?.length ?? 0;
            const bs = this.getBestScore(item);
            if (bs > g.bestScore) {
                g.bestScore = bs;
                g.bestPair = this.getBestPair(item);
            }
            g.lastDesign = Math.max(g.lastDesign, item.timestamp || 0);
            g.firstDesign = Math.min(g.firstDesign, item.timestamp || 0);

            const seq = normSeq(item.sequence || '');
            if (seq && !g.sequenceSet.has(seq)) {
                g.sequenceSet.add(seq);
                g.sequences.push(seq);
            }
        }

        for (const g of map.values()) {
            const n = g.designCount || 1;
            g.avgScore = Math.round(
                g.designs.reduce((sum, d) => sum + this.getBestScore(d), 0) / n,
            );
            g.avgPairs = Math.round(g.totalPairs / n);
            delete g.sequenceSet;
        }

        return Array.from(map.values());
    }

    extractGeneName(item) {
        if (item.geneName) return item.geneName;
        if (item.parameters?.gene) return item.parameters.gene;
        const snap = item.settings_snapshot;
        if (snap?.geneName) return snap.geneName;
        const seq = item.sequence || '';
        for (const { re, name } of GENE_FINGERPRINTS) {
            if (re.test(seq)) return name;
        }
        return null;
    }

    getBestScore(item) {
        if (item.best_score != null && Number.isFinite(Number(item.best_score))) {
            return Number(item.best_score);
        }
        const results = item.results || item.primers;
        if (Array.isArray(results) && results.length) {
            const scores = results
                .map((r) => Number(r.totalScore))
                .filter((x) => Number.isFinite(x));
            return scores.length ? Math.max(...scores) : 0;
        }
        return 0;
    }

    getBestPair(item) {
        const results = item.results || item.primers;
        if (!Array.isArray(results) || !results.length) return null;
        return results.reduce(
            (best, cur) =>
                (Number(cur.totalScore) || 0) > (Number(best.totalScore) || 0) ? cur : best,
            results[0],
        );
    }

    /**
     * Группировка избранного по последовательности шаблона (optimization_9).
     * @param {any[]} favorites savedPrimers
     * @returns {any[]}
     */
    groupFavoritesBySequence(favorites) {
        const groups = new Map();

        for (const item of favorites) {
            const key = favoriteSeqKey(item);
            const seq = normSeq(item.sequence || '');
            const fOne = item.pair?.forward?.sequence || '';
            const preview =
                seq.length > 0
                    ? seq.length <= 60
                        ? seq
                        : `${seq.slice(0, 40)}…${seq.slice(-20)}`
                    : fOne
                      ? `[без шаблона: ${normSeq(fOne).slice(0, 18)}…]`
                      : '—';

            if (!groups.has(key)) {
                groups.set(key, {
                    sequenceKey: key,
                    sequence: seq,
                    sequencePreview: preview,
                    sequenceLength: seq.length || null,
                    geneName: this.extractGeneName({
                        sequence: seq || fOne,
                        geneName: item.geneName,
                        parameters: item.parameters,
                    }),
                    accession: item.accession || '',
                    favorites: [],
                    firstAdded: item.timestamp || 0,
                    lastAdded: item.timestamp || 0,
                    bestScore: 0,
                    bestPair: null,
                    avgScore: 0,
                    count: 0,
                    hasFeedback: false,
                    mostUsedParams: { tm: [], gc: [], length: [] },
                });
            }

            const group = groups.get(key);
            group.favorites.push(item);
            group.count += 1;
            const ts = item.timestamp || 0;
            group.lastAdded = Math.max(group.lastAdded, ts);
            group.firstAdded = Math.min(group.firstAdded, ts);

            const score = Number(item.pair?.totalScore) || 0;
            if (score > group.bestScore) {
                group.bestScore = score;
                group.bestPair = item.pair || null;
            }
            if (item.feedback) group.hasFeedback = true;

            const f = item.pair?.forward;
            if (f) {
                const tm = f.details?.tm?.value;
                const gc = f.details?.gc?.value;
                const len = f.sequence?.length;
                if (Number.isFinite(tm)) group.mostUsedParams.tm.push(tm);
                if (Number.isFinite(gc)) group.mostUsedParams.gc.push(gc);
                if (Number.isFinite(len)) group.mostUsedParams.length.push(len);
            }
        }

        for (const group of groups.values()) {
            const n = group.count || 1;
            const sum = group.favorites.reduce(
                (s, f) => s + (Number(f.pair?.totalScore) || 0),
                0,
            );
            group.avgScore = Math.round(sum / n);
            group.mostUsedParams = {
                tm: getMostFrequentNumeric(group.mostUsedParams.tm),
                gc: getMostFrequentNumeric(group.mostUsedParams.gc),
                length: getMostFrequentNumeric(group.mostUsedParams.length),
            };
        }

        return Array.from(groups.values()).sort(
            (a, b) => (b.lastAdded || 0) - (a.lastAdded || 0),
        );
    }
}

export function calculateGC(sequence) {
    const s = normSeq(sequence);
    if (!s.length) return 0;
    let gc = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === 'G' || c === 'C') gc++;
    }
    return (100 * gc) / s.length;
}

export function getDateRangeLabel(firstTs, lastTs) {
    const a = new Date(firstTs).toLocaleDateString();
    const b = new Date(lastTs).toLocaleDateString();
    return a === b ? a : `${a} — ${b}`;
}

/** Для вкладки «Избранное»: метка гена по последовательности шаблона. */
export function geneLabelFromFavoriteItem(item) {
    const stats = new HistoryGroupStats();
    const fromTemplate = stats.extractGeneName({
        sequence: item.sequence || '',
        geneName: item.geneName,
        parameters: item.parameters,
    });
    if (fromTemplate) return fromTemplate;
    return (
        stats.extractGeneName({
            sequence: (item.pair && item.pair.forward && item.pair.forward.sequence) || '',
        }) || 'Другие'
    );
}

/** @deprecated используйте geneLabelFromFavoriteItem */
export const geneLabelFromSavedItem = geneLabelFromFavoriteItem;
