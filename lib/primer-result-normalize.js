/** Номер пары из id (server_primer3_0 → 1, local_2 → 3). */
export function getPairNumber(id) {
    if (id == null || id === '') return '?';
    const match = String(id).match(/_(\d+)$/);
    return match ? parseInt(match[1], 10) + 1 : '?';
}

/**
 * Нормализует результаты онлайн/оффлайн к одной структуре:
 * id, forward/reverse { start, end, sequence, details }.
 */
export function normalizeResults(results, sourceHint = null) {
    if (!Array.isArray(results) || results.length === 0) return results;
    return results.map((r, i) => {
        const source = r.source ?? sourceHint ?? (r.id && String(r.id).startsWith('server') ? 'server' : 'local');
        const prefix = source === 'server' || (r.id && String(r.id).startsWith('server')) ? 'server' : 'local';
        const id = r.id != null && String(r.id) !== '' ? String(r.id) : `${prefix}_${i}`;
        const f = r.forward || {};
        const fDetails = f.details || {};
        const fTm = fDetails.tm && typeof fDetails.tm === 'object' ? fDetails.tm.value : fDetails.tm;
        const fGc = fDetails.gc && typeof fDetails.gc === 'object' ? fDetails.gc.value : fDetails.gc;
        const rev = r.reverse || {};
        const rDetails = rev.details || {};
        const rTm = rDetails.tm && typeof rDetails.tm === 'object' ? rDetails.tm.value : rDetails.tm;
        const rGc = rDetails.gc && typeof rDetails.gc === 'object' ? rDetails.gc.value : rDetails.gc;
        const rawScore = r.totalScore ?? r.total_score;
        const totalScore = rawScore != null && Number.isFinite(Number(rawScore)) ? Number(rawScore) : null;
        const gradeObj = r.grade && typeof r.grade === 'object' ? r.grade : {};
        const grade = {
            letter: gradeObj.letter ?? '—',
            color: gradeObj.color ?? '#94a3b8',
            description: gradeObj.description ?? '',
        };
        return {
            ...r,
            id,
            rank: r.rank != null ? r.rank : i + 1,
            totalScore,
            grade,
            forward: {
                sequence: f.sequence ?? '',
                start: f.start ?? 0,
                end: f.end ?? (f.start ?? 0) + (f.sequence ?? '').length,
                ...f,
                details: {
                    ...fDetails,
                    tm: typeof fTm === 'number' ? { value: fTm } : (fDetails.tm || { value: 0 }),
                    gc: typeof fGc === 'number' ? { value: fGc } : (fDetails.gc || { value: 0 }),
                },
            },
            reverse: {
                sequence: rev.sequence ?? '',
                start: rev.start ?? 0,
                end: rev.end ?? (rev.start ?? 0) + (rev.sequence ?? '').length,
                ...rev,
                details: {
                    ...rDetails,
                    tm: typeof rTm === 'number' ? { value: rTm } : (rDetails.tm || { value: 0 }),
                    gc: typeof rGc === 'number' ? { value: rGc } : (rDetails.gc || { value: 0 }),
                },
            },
            warnings: Array.isArray(r.warnings) ? r.warnings : (r.warnings ? [r.warnings] : []),
            recommendations: Array.isArray(r.recommendations) ? r.recommendations : (r.recommendations ? [r.recommendations] : []),
            source: r.source ?? source,
        };
    });
}
