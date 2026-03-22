import { getPairNumber } from '../lib/primer-result-normalize.js';

export function overlapPaginationIdleHtml() {
    return `<div class="pagination-bar overlap-pagination overlap-pagination-idle">
        <button type="button" class="pagination-btn" disabled tabindex="-1">←</button>
        <span class="pagination-info">—</span>
        <button type="button" class="pagination-btn" disabled tabindex="-1">→</button>
    </div>`;
}

export function formatSequence(seq) {
    if (!seq || seq.length <= 25) return seq || '';
    return seq.substring(0, 20) + '...' + seq.slice(-5);
}

export function getRiskExplanationHtml(overlaps, seqLength) {
    if (!overlaps || overlaps.length === 0 || seqLength >= 200) return '';
    const highRiskCount = overlaps.filter((o) => o.conflictLevel === 'high').length;
    if (highRiskCount !== overlaps.length) return '';
    return `
        <div class="risk-explanation" role="alert">
            ⚠️ Все пересечения высокого риска из-за короткой последовательности.
            Для получения вариативных результатов используйте последовательность &gt;300 нт.
        </div>`;
}

export function formatOverlapType(type) {
    const types = {
        forward_forward: 'Прямой-Прямой',
        forward_reverse: 'Прямой-Обратный',
        reverse_reverse: 'Обратный-Обратный',
        product_overlap: 'Перекрытие продуктов',
    };
    return types[type] || type;
}

/** Карточка пары для панели пересечения (компактно). */
export function buildOverlapEmbeddedPairHtml(pair, idx) {
    if (!pair?.forward || !pair?.reverse) {
        return '<div class="overlap-embed-pair overlap-embed-missing">Пара не найдена в текущих результатах.</div>';
    }
    const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '📌';
    const gradeColor = pair.grade?.color ?? '#94a3b8';
    const gradeLetter = pair.grade?.letter ?? '—';
    const scoreDisplay = pair.totalScore != null && Number.isFinite(pair.totalScore) ? pair.totalScore : '—';
    const pf = pair.forward;
    const pr = pair.reverse;
    let warnBlock = '';
    if (pair.warnings && pair.warnings.length > 0) {
        warnBlock = '<div class="warnings">';
        pair.warnings.slice(0, 2).forEach((w) => {
            warnBlock += `<div class="warning">⚠️ ${String(w).replace(/</g, '&lt;')}</div>`;
        });
        warnBlock += '</div>';
    }
    const pairJson = JSON.stringify(pair);
    return `
                <div class="overlap-embed-pair">
                    <div class="card-header">
                        <div class="rank">${medal} Пара #${idx + 1}</div>
                        <div class="grade" style="background: ${gradeColor}20; color: ${gradeColor}">${gradeLetter} (${scoreDisplay})</div>
                    </div>
                    <div class="primers">
                        <div class="primer forward">
                            <div class="primer-label">
                                <span>5' → 3'</span>
                                <span class="primer-pos">${pf.start}-${pf.end}</span>
                            </div>
                            <div class="primer-sequence">${formatSequence(pf.sequence)}</div>
                            <div class="primer-stats">
                                <span>Tm: ${pf.details?.tm?.value?.toFixed(1) || 'N/A'}°C</span>
                                <span>GC: ${pf.details?.gc?.value?.toFixed(1) || 'N/A'}%</span>
                            </div>
                        </div>
                        <div class="primer reverse">
                            <div class="primer-label">
                                <span>3' ← 5'</span>
                                <span class="primer-pos">${pr.start}-${pr.end}</span>
                            </div>
                            <div class="primer-sequence">${formatSequence(pr.sequence)}</div>
                            <div class="primer-stats">
                                <span>Tm: ${pr.details?.tm?.value?.toFixed(1) || 'N/A'}°C</span>
                                <span>GC: ${pr.details?.gc?.value?.toFixed(1) || 'N/A'}%</span>
                            </div>
                        </div>
                    </div>
                    ${warnBlock}
                    <div class="card-actions">
                        <button type="button" class="action-btn copy-btn" data-seq="${pf.sequence}" data-type="forward">📋 Fwd</button>
                        <button type="button" class="action-btn copy-btn" data-seq="${pr.sequence}" data-type="reverse">📋 Rev</button>
                        <button type="button" class="action-btn save-btn" data-pair='${pairJson}'>
                            ⭐ В избранное
                        </button>
                        <button type="button" class="action-btn feedback-btn" data-pair='${pairJson}'>
                            📝 Отзыв
                        </button>
                    </div>
                </div>`;
}

/** Блок «Характеристики пересечения» + карточки пар. */
export function buildOverlapCharsInnerHtml(o, overlapIndex, results) {
    const warnings = Array.isArray(o.warning) ? o.warning : (o.warning ? [o.warning] : []);
    const conflictLabels = { low: 'Низкий', medium: 'Средний', high: 'Высокий' };
    const num = overlapIndex + 1;
    const res = Array.isArray(results) ? results : [];
    const i1 = res.findIndex((p) => p.id === o.pair1_id);
    const i2 = res.findIndex((p) => p.id === o.pair2_id);
    const p1 = i1 >= 0 ? res[i1] : null;
    const p2 = i2 >= 0 ? res[i2] : null;
    const embed1 = buildOverlapEmbeddedPairHtml(p1, i1 >= 0 ? i1 : 0);
    const embed2 = buildOverlapEmbeddedPairHtml(p2, i2 >= 0 ? i2 : 0);
    const detailCol = `
                    <div class="overlap-chars-col-detail">
                        <div class="overlap-detail-inner">
                            <h4>Характеристики пересечения № ${num}</h4>
                            <ul class="overlap-detail-list">
                                <li><strong>Пары:</strong> #${getPairNumber(o.pair1_id)} ↔ #${getPairNumber(o.pair2_id)}</li>
                                <li><strong>Тип:</strong> ${formatOverlapType(o.type)}</li>
                                <li><strong>Позиция:</strong> ${o.overlapStart}–${o.overlapEnd} (${o.overlapLength} п.н.)</li>
                                <li><strong>Уровень конфликта:</strong> ${conflictLabels[o.conflictLevel] || o.conflictLevel}</li>
                                ${o.percentOfFirst != null ? `<li><strong>% от 1-го праймера:</strong> ${o.percentOfFirst}%</li>` : ''}
                                ${o.percentOfSecond != null ? `<li><strong>% от 2-го праймера:</strong> ${o.percentOfSecond}%</li>` : ''}
                                ${(o.complementaryRisk?.hasComplementarity) ? `<li class="warning">Комплементарность в перекрытии: ${o.complementaryRisk.matchPercent}%</li>` : ''}
                            </ul>
                        </div>
                    </div>`;
    const pairsBlock = `
                    <div class="overlap-chars-pairs-block" aria-label="Пары в пересечении">
                        <div class="overlap-embed-pair-label">Участвующие пары</div>
                        <div class="overlap-chars-pairs-flex">
                            ${embed1}
                            ${embed2}
                        </div>
                    </div>`;
    const warnFull = warnings.length
        ? `<div class="overlap-detail-warnings overlap-chars-warnings-full">${warnings.map((w) => `<div class="overlap-warning">${w}</div>`).join('')}</div>`
        : '';
    return `
                <div class="overlap-chars-layout">
                    ${detailCol}
                    ${pairsBlock}
                </div>
                ${warnFull}`;
}
