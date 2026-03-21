import { getPairNumber } from '../lib/primer-result-normalize.js';
import {
    overlapPaginationIdleHtml,
    getRiskExplanationHtml,
    formatOverlapType,
    buildOverlapCharsInnerHtml,
    formatSequence,
} from './overlap-html.js';

/** @type {null | Record<string, unknown>} */
let deps = null;

/**
 * @param {object} d
 * @param {string} d.API_BASE_URL
 * @param {import('../lib/heuristic-engine.js').PrimerHeuristicEngine} d.heuristicEngine
 * @param {() => object} d.getAdvancedSettings
 * @param {() => unknown} d.getVisualizer
 * @param {() => number} d.getVizZoom
 * @param {() => string} d.getCurrentSequence
 * @param {() => unknown[] | null} d.getCurrentResults
 * @param {typeof import('./visualization.js').OverlapVisualizer} d.OverlapVisualizer
 * @param {(v: boolean) => void} d.setPanelRightAnalysisVisible
 * @param {(fn: () => void) => void} d.setVizRedraw
 * @param {() => void} d.scrollVizToCenter
 * @param {(pair: object) => void | Promise<void>} d.savePrimer
 * @param {(pair: object) => void} d.openFeedbackForPair
 * @param {(pair: object) => Promise<void>} d.showBlastResults
 * @param {(msg: string) => void} d.showWarning
 * @param {(msg: string) => void} d.showError
 * @param {(msg: string) => void} d.showNotification
 * @param {import('../lib/export-service.js').ExportService} d.exportService
 * @param {number} d.PRIMER_RESULTS_PER_PAGE
 * @param {number} d.OVERLAP_PER_PAGE
 */
export function configureDisplayResults(d) {
    deps = d;
}

export function displayResults(results, options = {}) {
    if (!deps) {
        console.error('PrimerDesigner: configureDisplayResults() not called');
        return;
    }
    const d = deps;
    const {
        API_BASE_URL,
        heuristicEngine,
        getAdvancedSettings,
        getVisualizer,
        getVizZoom,
        getCurrentSequence,
        getCurrentResults,
        OverlapVisualizer,
        setPanelRightAnalysisVisible,
        setVizRedraw,
        scrollVizToCenter,
        savePrimer,
        openFeedbackForPair,
        showBlastResults,
        showWarning,
        showError,
        showNotification,
        exportService,
        PRIMER_RESULTS_PER_PAGE,
        OVERLAP_PER_PAGE,
    } = d;

    const advancedSettings = getAdvancedSettings();
    const visualizer = getVisualizer();
    const vizZoom = getVizZoom();
    const currentSequence = getCurrentSequence();

    let resultsPage = 1;
    let overlapPage = 1;
    let overlapTab = 'all';

    const primersEl = document.getElementById('results-primers');
    const overlapEl = document.getElementById('overlap-dynamic');
    const connectionWarning = document.getElementById('connection-warning');
    const warningText = document.querySelector('.connection-warning-text');

    if (connectionWarning) {
        const showConnWarning = options.serverUnavailable || options.serverReturnedEmpty;
        connectionWarning.style.display = showConnWarning ? 'flex' : 'none';
        if (showConnWarning && warningText) {
            if (options.serverReturnedEmpty) {
                warningText.innerHTML =
                    'Сервер не подобрал праймеры по заданным критериям. Показаны результаты локальной эвристики.';
            } else {
                warningText.innerHTML = `Сервер не ответил. URL: <code>${API_BASE_URL}</code>. Проверьте: <code>docker compose up</code> и что в консоли расширения нет CORS/сети.`;
            }
        }
    }

    if (!results || results.length === 0) {
        if (primersEl) primersEl.innerHTML = '<div class="error">Не удалось подобрать праймеры</div>';
        if (overlapEl) overlapEl.innerHTML = '';
        const strip0 = document.getElementById('overlap-pagination-strip');
        if (strip0) strip0.innerHTML = overlapPaginationIdleHtml();
        setPanelRightAnalysisVisible(false);
        if (visualizer) visualizer.render('', []);
        return;
    }

    const uniquePairs = new Map();
    results.forEach((r) => {
        const fwd = r?.forward?.sequence ?? '';
        const rev = r?.reverse?.sequence ?? '';
        const fwdStart = r?.forward?.start ?? 0;
        const revStart = r?.reverse?.start ?? 0;
        const key = `${fwd}_${rev}_${fwdStart}_${revStart}`;
        if (!uniquePairs.has(key)) uniquePairs.set(key, r);
    });
    if (uniquePairs.size !== results.length) {
        results = Array.from(uniquePairs.values());
        results.sort((a, b) => (b.totalScore ?? 0) - (a.totalScore ?? 0));
    }

    let htmlPrimers = `
        <div class="export-panel">
            <button type="button" class="btn btn-outline btn-small export-btn" data-format="pdf">📄 PDF</button>
            <button type="button" class="btn btn-outline btn-small export-btn" data-format="excel">📊 Excel</button>
            <button type="button" class="btn btn-outline btn-small export-btn" data-format="csv">📈 CSV</button>
            <button type="button" class="btn btn-outline btn-small export-btn" data-format="html">🖨️ HTML</button>
        </div>
    `;

    const overlaps = heuristicEngine.analyzeOverlaps(results, {
        thresholds: {
            low: advancedSettings.lowThreshold,
            mediumMin: advancedSettings.mediumThresholdMin,
            mediumMax: advancedSettings.mediumThresholdMax,
            high: advancedSettings.highThreshold,
        },
    });

    const riskExplanationHtml = getRiskExplanationHtml(overlaps, currentSequence?.length ?? 0);
    if (riskExplanationHtml) {
        htmlPrimers += riskExplanationHtml;
    }

    let htmlOverlap = '';
    let overlapStripHtml = overlapPaginationIdleHtml();
    if (overlaps.length > 0) {
        overlapPage = 1;
        overlapTab = 'all';
        const overlapLevels = [...new Set(overlaps.map((o) => o.conflictLevel))];
        const tabLabels = { all: 'Все', high: 'Высокий', medium: 'Средний', low: 'Низ' };
        const tabOrder = ['all', 'high', 'medium', 'low'];
        const tabsToShow = ['all', ...tabOrder.filter((t) => t !== 'all' && overlapLevels.includes(t))];
        let tabsHtml = '<div class="overlap-tabs">';
        tabsToShow.forEach((t) => {
            const label = tabLabels[t] || t;
            const active = t === 'all' ? ' active' : '';
            tabsHtml += `<button type="button" class="overlap-tab${active}" data-overlap-tab="${t}" aria-pressed="${t === 'all'}">${label}</button>`;
        });
        tabsHtml += '</div>';
        let htmlOverlapScroll = `
            <div class="overlap-section overlap-section-panel">
                <p class="overlap-hint">Клик по карточке — выделение на графике</p>
                ${tabsHtml}
                <div class="overlap-grid-scroll">
                <div class="overlap-grid">
        `;

        overlaps.forEach((o, idx) => {
            const pageNum = Math.floor(idx / OVERLAP_PER_PAGE) + 1;
            const charsHtml = buildOverlapCharsInnerHtml(o, idx, results);
            htmlOverlapScroll += `
                <div class="overlap-item-wrap" data-overlap-index="${idx}" data-overlap-page="${pageNum}" style="display: none;">
                    <div class="overlap-card overlap-${o.conflictLevel}" data-overlap-index="${idx}" data-conflict-level="${o.conflictLevel}" role="button" tabindex="0">
                        <div class="overlap-header">
                            <span class="overlap-num" aria-label="Номер пересечения">№ ${idx + 1}</span>
                            <span class="overlap-pairs">
                                Пара #${getPairNumber(o.pair1_id)} ↔ Пара #${getPairNumber(o.pair2_id)}
                            </span>
                            <span class="overlap-badge">${o.overlapLength} п.н.</span>
                        </div>
                        <div class="overlap-details">
                            <div>${formatOverlapType(o.type)}</div>
                            ${(Array.isArray(o.warning) ? o.warning : (o.warning ? [o.warning] : [])).map((w) => `<div class="overlap-warning">${w}</div>`).join('')}
                        </div>
                    </div>
                    <button type="button" class="overlap-chars-toggle" aria-expanded="false">Показать характеристики</button>
                    <div class="overlap-chars-panel" style="display: none;" aria-hidden="true">${charsHtml}</div>
                </div>
            `;
        });

        htmlOverlapScroll += `
                </div>
                </div>
            </div>`;
        htmlOverlap = htmlOverlapScroll;
        const overlapTotalPages = Math.max(1, Math.ceil(overlaps.length / OVERLAP_PER_PAGE));
        overlapStripHtml = `
                <div class="pagination-bar overlap-pagination">
                    <button type="button" class="pagination-btn overlap-pagination-prev" aria-label="Предыдущая страница">← Назад</button>
                    <span class="pagination-info" id="overlap-pagination-info">Страница 1 из ${overlapTotalPages}</span>
                    <button type="button" class="pagination-btn overlap-pagination-next" aria-label="Следующая страница">Вперёд →</button>
                </div>`;
    }

    const totalPages = Math.max(1, Math.ceil(results.length / PRIMER_RESULTS_PER_PAGE));
    resultsPage = 1;

    results.forEach((pair, idx) => {
        const pageNum = Math.floor(idx / PRIMER_RESULTS_PER_PAGE) + 1;
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '📌';
        const gradeColor = pair.grade?.color ?? '#94a3b8';
        const gradeLetter = pair.grade?.letter ?? '—';
        const scoreDisplay = pair.totalScore != null && Number.isFinite(pair.totalScore) ? pair.totalScore : '—';
        const sameForwardAsPrev = idx > 0 && results[idx - 1].forward?.sequence === pair.forward?.sequence;

        htmlPrimers += `
            <div class="result-card" data-pair-id="${pair.id}" data-pair-index="${idx}" data-page="${pageNum}" style="display: none;">
                ${sameForwardAsPrev ? '<div class="same-forward-indicator">↕️ Тот же forward, другой reverse</div>' : ''}
                <div class="card-header">
                    <div class="rank">
                        ${medal} Пара #${idx + 1}
                    </div>
                    <div class="grade" style="background: ${gradeColor}20; color: ${gradeColor}">
                        ${gradeLetter} (${scoreDisplay})
                    </div>
                </div>

                <div class="primers">
                    <div class="primer forward">
                        <div class="primer-label">
                            <span>5' → 3'</span>
                            <span class="primer-pos">${pair.forward.start}-${pair.forward.end}</span>
                        </div>
                        <div class="primer-sequence">${formatSequence(pair.forward.sequence)}</div>
                        <div class="primer-stats">
                            <span>Tm: ${pair.forward.details?.tm?.value?.toFixed(1) || 'N/A'}°C</span>
                            <span>GC: ${pair.forward.details?.gc?.value?.toFixed(1) || 'N/A'}%</span>
                        </div>
                    </div>

                    <div class="primer reverse">
                        <div class="primer-label">
                            <span>3' ← 5'</span>
                            <span class="primer-pos">${pair.reverse.start}-${pair.reverse.end}</span>
                        </div>
                        <div class="primer-sequence">${formatSequence(pair.reverse.sequence)}</div>
                        <div class="primer-stats">
                            <span>Tm: ${pair.reverse.details?.tm?.value?.toFixed(1) || 'N/A'}°C</span>
                            <span>GC: ${pair.reverse.details?.gc?.value?.toFixed(1) || 'N/A'}%</span>
                        </div>
                    </div>
                </div>
        `;

        if (pair.warnings && pair.warnings.length > 0) {
            htmlPrimers += '<div class="warnings">';
            pair.warnings.slice(0, 2).forEach((w) => {
                htmlPrimers += `<div class="warning">⚠️ ${w}</div>`;
            });
            htmlPrimers += '</div>';
        }

        htmlPrimers += `
                <div class="card-actions">
                    <button class="action-btn blast-btn" data-pair='${JSON.stringify(pair)}'>
                        🧬 BLAST
                    </button>
                    <button class="action-btn copy-btn" data-seq="${pair.forward.sequence}" data-type="forward">
                        📋 Fwd
                    </button>
                    <button class="action-btn copy-btn" data-seq="${pair.reverse.sequence}" data-type="reverse">
                        📋 Rev
                    </button>
                    <button class="action-btn save-btn" data-pair='${JSON.stringify(pair)}'>
                        💾 Сохранить
                    </button>
                    <button class="action-btn feedback-btn" data-pair='${JSON.stringify(pair)}'>
                        📝 Отзыв
                    </button>
                </div>
            </div>
        `;
    });

    htmlPrimers += `
        <div class="pagination-bar pagination-results">
            <button type="button" class="pagination-btn pagination-prev" aria-label="Предыдущая страница">← Назад</button>
            <span class="pagination-info" id="pagination-info">Страница 1 из ${totalPages}</span>
            <button type="button" class="pagination-btn pagination-next" aria-label="Следующая страница">Вперёд →</button>
        </div>`;

    if (primersEl) primersEl.innerHTML = htmlPrimers;
    if (overlapEl) {
        overlapEl.innerHTML = htmlOverlap || '<p class="overlap-empty-msg">Пересечений не обнаружено.</p>';
    }
    const overlapStrip = document.getElementById('overlap-pagination-strip');
    if (overlapStrip) overlapStrip.innerHTML = overlapStripHtml;
    setPanelRightAnalysisVisible(true);

    const showPage = (page) => {
        const totalP = Math.max(1, Math.ceil(results.length / PRIMER_RESULTS_PER_PAGE));
        document.querySelectorAll('.result-card').forEach((card) => {
            card.style.display = parseInt(card.dataset.page, 10) === page ? '' : 'none';
        });
        const infoEl = document.getElementById('pagination-info');
        if (infoEl) infoEl.textContent = `Страница ${page} из ${totalP}`;
        const prevBtn = document.querySelector('.pagination-prev');
        const nextBtn = document.querySelector('.pagination-next');
        if (prevBtn) prevBtn.disabled = page <= 1;
        if (nextBtn) nextBtn.disabled = page >= totalP;
    };
    showPage(1);

    document.querySelector('.pagination-prev')?.addEventListener('click', () => {
        if (resultsPage <= 1) return;
        resultsPage--;
        showPage(resultsPage);
    });
    document.querySelector('.pagination-next')?.addEventListener('click', () => {
        const totalP = Math.max(1, Math.ceil(results.length / PRIMER_RESULTS_PER_PAGE));
        if (resultsPage >= totalP) return;
        resultsPage++;
        showPage(resultsPage);
    });

    if (overlaps.length > 0) {
        const getIndicesForTab = (tab) => {
            if (tab === 'all') return overlaps.map((_, i) => i);
            return overlaps.map((o, i) => (o.conflictLevel === tab ? i : -1)).filter((i) => i >= 0);
        };
        const showOverlapPage = (tab, page) => {
            const indices = getIndicesForTab(tab);
            const totalP = Math.max(1, Math.ceil(indices.length / OVERLAP_PER_PAGE));
            const pageIndices = indices.slice((page - 1) * OVERLAP_PER_PAGE, page * OVERLAP_PER_PAGE);
            const set = new Set(pageIndices);
            document.querySelectorAll('.overlap-item-wrap').forEach((wrap) => {
                const idx = parseInt(wrap.dataset.overlapIndex, 10);
                const show = set.has(idx);
                wrap.style.display = show ? '' : 'none';
                if (!show) {
                    const panel = wrap.querySelector('.overlap-chars-panel');
                    const toggle = wrap.querySelector('.overlap-chars-toggle');
                    if (panel && toggle) {
                        panel.style.display = 'none';
                        panel.setAttribute('aria-hidden', 'true');
                        toggle.textContent = 'Показать характеристики';
                        toggle.setAttribute('aria-expanded', 'false');
                    }
                }
            });
            const infoEl = document.getElementById('overlap-pagination-info');
            if (infoEl) infoEl.textContent = `Страница ${page} из ${totalP}`;
            const prevBtn = document.querySelector('.overlap-pagination-prev');
            const nextBtn = document.querySelector('.overlap-pagination-next');
            if (prevBtn) prevBtn.disabled = page <= 1;
            if (nextBtn) nextBtn.disabled = page >= totalP;
        };
        showOverlapPage(overlapTab, 1);
        document.querySelectorAll('.overlap-tab').forEach((btn) => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.overlapTab;
                overlapTab = tab;
                overlapPage = 1;
                document.querySelectorAll('.overlap-tab').forEach((b) => {
                    b.classList.toggle('active', b.dataset.overlapTab === tab);
                    b.setAttribute('aria-pressed', b.dataset.overlapTab === tab);
                });
                showOverlapPage(overlapTab, overlapPage);
            });
        });
        document.querySelector('.overlap-pagination-prev')?.addEventListener('click', () => {
            if (overlapPage <= 1) return;
            overlapPage--;
            showOverlapPage(overlapTab, overlapPage);
        });
        document.querySelector('.overlap-pagination-next')?.addEventListener('click', () => {
            const indices = getIndicesForTab(overlapTab);
            const totalP = Math.max(1, Math.ceil(indices.length / OVERLAP_PER_PAGE));
            if (overlapPage >= totalP) return;
            overlapPage++;
            showOverlapPage(overlapTab, overlapPage);
        });
    }

    const vizZoomValueEl = document.getElementById('viz-zoom-value');
    const vizZoomSlider = document.getElementById('viz-zoom-slider');
    if (vizZoomValueEl) vizZoomValueEl.textContent = `${Math.round(vizZoom * 100)}%`;
    if (vizZoomSlider) vizZoomSlider.value = String(vizZoom);

    const vis = getVisualizer();
    const seqClean = currentSequence.replace(/\s/g, '');
    if (vis && currentSequence) {
        vis.render(seqClean, results, -1, vizZoom);
        if (overlaps.length > 0 && vis.canvas) {
            const overlapViz = new OverlapVisualizer(vis.canvas);
            overlapViz.drawOverlaps(overlaps, seqClean.length);
        }
    }

    const renderVisualization = (highlightedPairIndex = -1, overlapHighlightIndex = -1) => {
        const v = getVisualizer();
        if (!v || !getCurrentSequence()) return;
        const seq = getCurrentSequence().replace(/\s/g, '');
        const vz = getVizZoom();
        v.render(seq, results, highlightedPairIndex, vz);
        if (overlaps.length > 0 && v.canvas) {
            const ov = new OverlapVisualizer(v.canvas);
            ov.drawOverlaps(overlaps, seq.length, overlapHighlightIndex);
        }
    };

    setVizRedraw(() => {
        const pairIdx = document.querySelector('.result-card.result-card-highlighted')?.dataset.pairIndex;
        const overlapIdx = document.querySelector('.overlap-card.highlighted')?.dataset.overlapIndex;
        renderVisualization(
            pairIdx != null ? parseInt(pairIdx, 10) : -1,
            overlapIdx != null ? parseInt(overlapIdx, 10) : -1,
        );
        scrollVizToCenter();
    });

    document.querySelectorAll('.result-card').forEach((card) => {
        card.addEventListener('click', (e) => {
            if (e.target.closest('.action-btn')) return;
            const pairIndex = parseInt(card.dataset.pairIndex, 10);
            if (isNaN(pairIndex)) return;
            document.querySelectorAll('.result-card').forEach((c) => c.classList.remove('result-card-highlighted'));
            card.classList.add('result-card-highlighted');
            document.querySelectorAll('.overlap-card').forEach((c) => c.classList.remove('highlighted'));
            document.getElementById('visualization')?.classList.remove('visualization-overlap-highlighted');
            renderVisualization(pairIndex, -1);
        });
    });

    if (overlaps.length > 0 && getVisualizer() && getCurrentSequence()) {
        const renderHighlight = (highlightIndex) => {
            const pairIdx = document.querySelector('.result-card.result-card-highlighted')?.dataset.pairIndex;
            const parsed = pairIdx != null ? parseInt(pairIdx, 10) : -1;
            renderVisualization(parsed >= 0 ? parsed : -1, highlightIndex);
        };
        document.querySelectorAll('.overlap-chars-toggle').forEach((toggle) => {
            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                const wrap = toggle.closest('.overlap-item-wrap');
                const panel = wrap?.querySelector('.overlap-chars-panel');
                if (!panel) return;
                const opening = panel.style.display === 'none' || !panel.style.display;
                document.querySelectorAll('.overlap-item-wrap').forEach((w) => {
                    if (w.style.display === 'none') return;
                    const p = w.querySelector('.overlap-chars-panel');
                    const t = w.querySelector('.overlap-chars-toggle');
                    if (p && t && w !== wrap) {
                        p.style.display = 'none';
                        p.setAttribute('aria-hidden', 'true');
                        t.textContent = 'Показать характеристики';
                        t.setAttribute('aria-expanded', 'false');
                    }
                });
                if (opening) {
                    panel.style.display = 'block';
                    panel.setAttribute('aria-hidden', 'false');
                    toggle.textContent = 'Скрыть характеристики';
                    toggle.setAttribute('aria-expanded', 'true');
                } else {
                    panel.style.display = 'none';
                    panel.setAttribute('aria-hidden', 'true');
                    toggle.textContent = 'Показать характеристики';
                    toggle.setAttribute('aria-expanded', 'false');
                }
            });
        });
        document.querySelectorAll('.overlap-card').forEach((card) => {
            card.addEventListener('click', () => {
                const idx = parseInt(card.dataset.overlapIndex, 10);
                if (isNaN(idx) || idx < 0) return;
                document.querySelectorAll('.overlap-card').forEach((c) => c.classList.remove('highlighted'));
                card.classList.add('highlighted');
                renderHighlight(idx);
                const vizEl = document.getElementById('visualization');
                if (vizEl) {
                    vizEl.classList.add('visualization-overlap-highlighted');
                    vizEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            });
            card.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    card.click();
                }
            });
        });
    }

    document.querySelectorAll('.copy-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            const seq = e.currentTarget.dataset.seq;
            navigator.clipboard.writeText(seq);
            const original = e.currentTarget.textContent;
            e.currentTarget.textContent = '✓ Скопировано';
            setTimeout(() => {
                e.currentTarget.textContent = original;
            }, 1000);
        });
    });

    document.querySelectorAll('.save-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            const pair = JSON.parse(e.currentTarget.dataset.pair);
            savePrimer(pair);
        });
    });

    document.querySelectorAll('.feedback-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            const pair = JSON.parse(e.currentTarget.dataset.pair);
            openFeedbackForPair(pair);
        });
    });
    document.querySelectorAll('.blast-btn').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
            const pair = JSON.parse(e.currentTarget.dataset.pair);
            await showBlastResults(pair);
        });
    });
    document.querySelectorAll('.export-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            const format = btn.dataset.format;
            const currentResults = getCurrentResults();
            if (!currentResults || currentResults.length === 0) {
                showWarning('Нет результатов для экспорта');
                return;
            }
            try {
                if (format === 'pdf') exportService.exportToPDF(currentResults);
                else if (format === 'excel') exportService.exportToExcel(currentResults);
                else if (format === 'csv') exportService.exportToCSV(currentResults);
                else if (format === 'html') exportService.exportToHTML(currentResults);
                showNotification(`✅ Экспорт: ${format.toUpperCase()}`);
            } catch (err) {
                showError(`Ошибка экспорта: ${err.message || err}`);
            }
        });
    });
}
