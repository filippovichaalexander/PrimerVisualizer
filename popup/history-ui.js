import { historyEntryId } from '../lib/history-manager.js';
import {
    HistoryGroupStats,
    calculateGC,
    getDateRangeLabel,
} from '../lib/history-group-stats.js';
import { normalizeResults } from '../lib/primer-result-normalize.js';
import { displayResults } from './display-results.js';

const GROUPS_PER_PAGE = 6;

/**
 * @param {any[]} history
 * @param {string} search
 * @param {string} dateRange
 */
function applyHistoryFilters(history, search, dateRange) {
    let h = [...history];
    if (search) {
        const q = search.toLowerCase();
        h = h.filter((item) => {
            const sequence = item.sequence?.toLowerCase() || '';
            const bestScore = item.best_score?.toString() || '';
            const params = JSON.stringify(item.parameters || '').toLowerCase();
            const gene = (item.geneName || item.parameters?.gene || '').toLowerCase();
            return (
                sequence.includes(q) ||
                bestScore.includes(q) ||
                params.includes(q) ||
                gene.includes(q)
            );
        });
    }
    if (dateRange !== 'all') {
        const now = Date.now();
        const ranges = {
            today: now - 24 * 60 * 60 * 1000,
            week: now - 7 * 24 * 60 * 60 * 1000,
            month: now - 30 * 24 * 60 * 60 * 1000,
            year: now - 365 * 24 * 60 * 60 * 1000,
        };
        const since = ranges[dateRange];
        if (since) {
            h = h.filter((item) => (item.timestamp || 0) >= since);
        }
    }
    return h;
}

/**
 * @param {object} ctx
 * @param {import('../lib/history-manager.js').HistoryManager} ctx.historyManager
 * @param {import('../lib/storage-manager.js').StorageManager} ctx.storage
 * @param {(s: string) => void} ctx.setCurrentSequence
 * @param {(r: unknown) => void} ctx.setCurrentResults
 * @param {(seq: string) => void} ctx.updateSequenceStats
 * @param {(msg: string) => void} ctx.showNotification
 * @param {(msg: string) => void} ctx.showWarning
 * @param {(v: boolean) => void} ctx.setPanelRightAnalysisVisible
 * @param {(pair: object, opts?: { sequence?: string, fromHistory?: boolean, historyEntryId?: string | number }) => void | Promise<void>} ctx.savePrimer
 * @param {() => void} [ctx.refreshSavedPrimers] обновить список вкладки «Избранное»
 * @returns {() => Promise<void>}
 */
export function initHistoryPanel(ctx) {
    const {
        historyManager,
        storage,
        setCurrentSequence,
        setCurrentResults,
        updateSequenceStats,
        showNotification,
        showWarning,
        setPanelRightAnalysisVisible,
        savePrimer,
        refreshSavedPrimers,
    } = ctx;

    const root = document.getElementById('tab-history');
    if (!root) {
        return async () => {};
    }

    /** @type {any[]} */
    let lastAllGroups = [];
    /** @type {any[]} */
    let lastGroupPageSlice = [];
    let groupsCurrentPage = 1;
    let historyViewMode = 'flat';

    function debounce(fn, ms) {
        let t;
        return () => {
            clearTimeout(t);
            t = setTimeout(fn, ms);
        };
    }

    const debouncedRefresh = debounce(() => {
        refresh().catch((e) => console.warn('history refresh', e));
    }, 280);

    function escapeHtml(s) {
        const div = document.createElement('div');
        div.textContent = s == null ? '' : String(s);
        return div.innerHTML;
    }

    function normSeqKey(item) {
        const s = (item.sequence || '').replace(/\s/g, '').toUpperCase();
        return s || `__empty_${item.timestamp || Math.random()}`;
    }

    function countUniqueSequences(items) {
        const set = new Set();
        for (const it of items) {
            set.add(normSeqKey(it));
        }
        return set.size;
    }

    /** Только дизайны и уникальные последовательности (остальная сводка — во вкладке «Избранное»). */
    function renderHistoryStatsTwo(designCount, uniqueSeq) {
        return `
            <div class="history-stats-grid history-stats-grid--two">
                <div class="history-stat-card"><span class="history-stat-value">${designCount}</span><span class="history-stat-label">Дизайнов</span></div>
                <div class="history-stat-card"><span class="history-stat-value">${uniqueSeq}</span><span class="history-stat-label">Уник. последовательностей</span></div>
            </div>`;
    }

    const groupStats = new HistoryGroupStats();

    function sortGroups(groups, sortBy) {
        const g = [...groups];
        switch (sortBy) {
            case 'date-asc':
                return g.sort((a, b) => (a.firstDesign || 0) - (b.firstDesign || 0));
            case 'score':
            case 'score-desc':
            case 'best-score':
                return g.sort((a, b) => (b.bestScore || 0) - (a.bestScore || 0));
            case 'length':
            case 'length-desc':
                return g.sort(
                    (a, b) => (b.sequenceLength || 0) - (a.sequenceLength || 0),
                );
            case 'most-pairs':
            case 'pairs-desc':
                return g.sort((a, b) => (b.totalPairs || 0) - (a.totalPairs || 0));
            default:
                return g.sort((a, b) => (b.lastDesign || 0) - (a.lastDesign || 0));
        }
    }

    function renderDesignItemCompact(d) {
        const id = historyEntryId(d);
        const date = new Date(d.timestamp || 0).toLocaleDateString();
        const time = new Date(d.timestamp || 0).toLocaleTimeString();
        const bestScore =
            d.best_score != null
                ? d.best_score
                : groupStats.getBestScore(d);
        const pairsCount =
            d.results_count ?? d.results?.length ?? d.primers?.length ?? 0;
        const p = d.parameters || {};
        const idEsc = escapeHtml(String(id));
        return `
            <div class="design-item">
                <div class="design-date">${escapeHtml(date)} ${escapeHtml(time)}</div>
                <div class="design-stats">
                    <span>⭐ ${escapeHtml(String(bestScore))}</span>
                    <span>🔬 ${pairsCount} пар</span>
                </div>
                <div class="design-params">
                    Tm: ${p.tm ?? '—'}°C | GC: ${p.gc ?? '—'}% | L: ${p.length ?? '—'}
                </div>
                <div class="design-item-actions">
                    <button type="button" class="btn btn-small save-history-best-btn" data-id="${idEsc}" title="Добавить лучшую пару в избранное">⭐</button>
                    <button type="button" class="btn btn-small btn-outline delete-history-btn" data-id="${idEsc}">🗑️</button>
                </div>
            </div>`;
    }

    function renderSequenceGroup(group, idx) {
        const dateRange = getDateRangeLabel(group.firstDesign, group.lastDesign);
        const gc = group.sequence ? calculateGC(group.sequence).toFixed(1) : '—';
        const geneHtml = group.geneName
            ? `<span class="group-gene">(${escapeHtml(group.geneName)})</span>`
            : '';

        return `
            <div class="history-group sequence-group" data-group-local-idx="${idx}">
                <div class="group-header" role="button" tabindex="0">
                    <div class="group-title">
                        <span class="group-icon">🧬</span>
                        <span class="group-name">${escapeHtml(group.sequencePreview || '')}</span>
                        ${geneHtml}
                    </div>
                    <div class="group-stats-row">
                        <span class="stat-badge">📊 ${group.designCount} дизайнов</span>
                        <span class="stat-badge">🎯 Лучший: ${group.bestScore}</span>
                        <span class="stat-badge">🔬 ~${group.avgPairs} пар ср.</span>
                        <span class="stat-badge">📅 ${escapeHtml(dateRange)}</span>
                    </div>
                    <div class="group-actions">
                        <button type="button" class="btn btn-small btn-outline load-group-btn" data-group-local-idx="${idx}">📂 В редактор</button>
                        <button type="button" class="group-expand" aria-label="Развернуть">▼</button>
                    </div>
                </div>
                <div class="group-content" style="display: none;">
                    <div class="group-details">
                        <div class="detail-row">
                            <span><strong>Длина:</strong> ${group.sequenceLength} нт</span>
                            <span><strong>GC:</strong> ${gc}%</span>
                        </div>
                        <div class="best-pair">
                            <strong>🏆 Лучшая пара (оценка ${group.bestScore}):</strong>
                            <div class="primer-preview">
                                <code>F: ${escapeHtml(group.bestPair?.forward?.sequence || '—')}</code>
                                <code>R: ${escapeHtml(group.bestPair?.reverse?.sequence || '—')}</code>
                            </div>
                        </div>
                        <div class="design-list">
                            <div class="history-uniq-seq-heading">Уник. последовательность — записи дизайнов</div>
                            ${group.designs.map((d) => renderDesignItemCompact(d)).join('')}
                        </div>
                    </div>
                </div>
            </div>`;
    }

    function renderDateGroup(group, idx) {
        const dateRange = escapeHtml(group.dateLabel || '');
        return `
            <div class="history-group date-group" data-group-local-idx="${idx}">
                <div class="group-header" role="button" tabindex="0">
                    <div class="group-title">
                        <span class="group-icon">📅</span>
                        <span class="group-name">${dateRange}</span>
                    </div>
                    <div class="group-stats-row">
                        <span class="stat-badge">📊 ${group.designCount} дизайнов</span>
                        <span class="stat-badge">🎯 Лучший: ${group.bestScore}</span>
                        <span class="stat-badge">🔬 ~${group.avgPairs} пар ср.</span>
                    </div>
                    <div class="group-actions">
                        <button type="button" class="group-expand" aria-label="Развернуть">▼</button>
                    </div>
                </div>
                <div class="group-content" style="display: none;">
                    <div class="group-details design-list">
                        <div class="history-uniq-seq-heading">Уник. последовательность — записи за день</div>
                        ${group.designs.map((d) => renderDesignItemCompact(d)).join('')}
                    </div>
                </div>
            </div>`;
    }

    function renderGeneGroup(group, idx) {
        const seqItems = (group.sequences || [])
            .slice(0, 12)
            .map(
                (seq) => `
            <div class="sequence-item-row">
                <code class="seq-preview">${escapeHtml(seq.length > 56 ? `${seq.slice(0, 40)}…` : seq)}</code>
                <button type="button" class="btn btn-small load-seq-btn" data-seq="${escapeHtml(seq)}">В редактор</button>
            </div>`,
            )
            .join('');

        return `
            <div class="history-group gene-group" data-group-local-idx="${idx}">
                <div class="group-header" role="button" tabindex="0">
                    <div class="group-title">
                        <span class="group-icon">🧬</span>
                        <span class="group-name">${escapeHtml(group.geneName)}</span>
                    </div>
                    <div class="group-stats-row">
                        <span class="stat-badge">🎯 Лучший: ${group.bestScore}</span>
                        <span class="stat-badge">📊 ${group.designCount} дизайнов</span>
                        <span class="stat-badge">🔬 ~${group.avgPairs} пар ср.</span>
                    </div>
                    <div class="group-actions">
                        <button type="button" class="group-expand" aria-label="Развернуть">▼</button>
                    </div>
                </div>
                <div class="group-content" style="display: none;">
                    <div class="group-details">
                        <p class="gene-seq-hint">Уникальные последовательности (${group.sequences?.length || 0}):</p>
                        <div class="sequence-list">${seqItems || '<p class="text-muted">Нет последовательностей</p>'}</div>
                    </div>
                </div>
            </div>`;
    }

    function renderItemHtml(item) {
        const id = historyEntryId(item);
        const idAttr = escapeHtml(String(id));
        const seq = item.sequence || '';
        const preview = seq.length > 48 ? `${seq.slice(0, 48)}…` : seq;
        const pairs =
            item.results_count ?? item.results?.length ?? item.primers?.length ?? 0;
        const len = item.sequence_length ?? seq.length;
        const score = item.best_score != null && item.best_score > 0 ? item.best_score : '—';
        const timeStr = new Date(item.timestamp || Date.now()).toLocaleString();
        const p = item.parameters || {};
        const paramStr = [p.tm != null ? `Tm ${p.tm}` : '', p.gc != null ? `GC ${p.gc}` : '', p.length != null ? `L ${p.length}` : '']
            .filter(Boolean)
            .join(' · ');
        const src =
            item.source === 'popup'
                ? 'Основной UI'
                : !item.source || item.source === 'manual'
                  ? 'Быстрый дизайн'
                  : escapeHtml(String(item.source).slice(0, 60));

        return `
            <div class="history-item" data-entry-id="${idAttr}">
                <div class="history-item-header">
                    <span class="history-date">${escapeHtml(timeStr)}</span>
                    <div class="history-badges">
                        <span class="badge">${pairs} пар</span>
                        <span class="badge">${len} нт</span>
                        <span class="badge score">${escapeHtml(String(score))}</span>
                    </div>
                </div>
                <div class="history-sequence" title="${escapeHtml(seq)}">${escapeHtml(preview)}</div>
                <div class="history-meta-line">${escapeHtml(paramStr || '—')} · ${src}</div>
                <div class="history-actions">
                    <button type="button" class="action-btn small save-history-best-btn" data-id="${idAttr}">⭐ В избранное</button>
                    <button type="button" class="action-btn small delete-history-btn" data-id="${idAttr}">🗑️</button>
                </div>
            </div>`;
    }

    /**
     * Плоский список: секции по уникальной последовательности (визуальное разграничение).
     * @param {any[]} items
     */
    function renderGroupedListFlat(items) {
        const map = new Map();
        for (const item of items) {
            const key = normSeqKey(item);
            if (!map.has(key)) {
                const seq = (item.sequence || '').replace(/\s/g, '').toUpperCase();
                const preview =
                    seq.length <= 64 ? seq : `${seq.slice(0, 44)}…${seq.slice(-16)}`;
                map.set(key, { preview: preview || '—', items: [] });
            }
            map.get(key).items.push(item);
        }
        const sections = Array.from(map.values());
        for (const s of sections) {
            s.items.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        }
        sections.sort((a, b) => (b.items[0]?.timestamp || 0) - (a.items[0]?.timestamp || 0));

        return sections
            .map(
                (sec) => `
            <div class="history-seq-section">
                <div class="history-seq-section-head">
                    <span class="history-seq-section-label">Уник. последовательность</span>
                    <code class="history-seq-section-code">${escapeHtml(sec.preview)}</code>
                </div>
                <div class="history-seq-section-items">${sec.items.map(renderItemHtml).join('')}</div>
            </div>`,
            )
            .join('');
    }

    function renderGroupPagination(totalGroups) {
        const pagEl = document.getElementById('history-pagination');
        if (!pagEl) return;
        const totalPages = Math.max(1, Math.ceil(totalGroups / GROUPS_PER_PAGE));
        if (totalPages <= 1) {
            pagEl.innerHTML = '';
            pagEl.style.display = 'none';
            return;
        }
        pagEl.style.display = 'flex';
        pagEl.innerHTML = `
            <button type="button" class="pagination-btn" id="history-prev" ${groupsCurrentPage <= 1 ? 'disabled' : ''}>←</button>
            <span class="pagination-info" id="history-page-info">Группы ${groupsCurrentPage} / ${totalPages}</span>
            <button type="button" class="pagination-btn" id="history-next" ${groupsCurrentPage >= totalPages ? 'disabled' : ''}>→</button>`;
    }

    function renderFlatPagination(page) {
        const pagEl = document.getElementById('history-pagination');
        if (!pagEl) return;
        if (page.totalPages <= 1) {
            pagEl.innerHTML = '';
            pagEl.style.display = 'none';
            return;
        }
        pagEl.style.display = 'flex';
        pagEl.innerHTML = `
            <button type="button" class="pagination-btn" id="history-prev" ${page.hasPrev ? '' : 'disabled'}>←</button>
            <span class="pagination-info" id="history-page-info">Страница ${page.page} из ${page.totalPages}</span>
            <button type="button" class="pagination-btn" id="history-next" ${page.hasNext ? '' : 'disabled'}>→</button>`;
    }

    function findHistoryEntryById(history, id) {
        return history.find((h) => String(historyEntryId(h)) === String(id));
    }

    /** @returns {any[] | null} */
    function getNormalizedPrimersFromEntry(item) {
        const raw = item?.results || item?.primers;
        if (!raw || !Array.isArray(raw) || !raw.length) return null;
        const n = normalizeResults(raw, 'local');
        return n?.length ? n : null;
    }

    /** @param {any[]} primers */
    function pickBestPair(primers) {
        if (!primers?.length) return null;
        return primers.reduce(
            (best, p) =>
                (Number(p.totalScore) || 0) > (Number(best.totalScore) || 0) ? p : best,
            primers[0],
        );
    }

    async function loadGroupSequenceToEditor(group) {
        const seq = (group.sequence || '').replace(/\s/g, '').toUpperCase();
        if (!seq) {
            showWarning('Нет последовательности в группе');
            return;
        }
        const ta = document.getElementById('sequence');
        if (ta) ta.value = seq;
        setCurrentSequence(seq);
        updateSequenceStats(seq);

        let rawResults = null;
        if (group.bestPair) {
            rawResults = normalizeResults([group.bestPair], 'local');
        }
        const last = group.designs?.[0];
        if ((!rawResults || !rawResults.length) && last) {
            const rr = last.results || last.primers;
            if (rr?.length) rawResults = normalizeResults(rr, 'local');
        }
        if (rawResults && rawResults.length) {
            const normalized = rawResults;
            setCurrentResults(normalized);
            displayResults(normalized, { serverUnavailable: false, serverReturnedEmpty: false });
            setPanelRightAnalysisVisible(true);
        }
        showNotification('Данные группы загружены в редактор');
        if (typeof window.switchTab === 'function') window.switchTab('design');
    }

    async function refresh() {
        const raw = await storage.get('history') || [];
        const emptyEl = document.getElementById('history-empty');
        const toolbar = document.getElementById('history-toolbar');
        const statsEl = document.getElementById('history-stats');
        const groupStatsEl = document.getElementById('history-group-stats');
        const listEl = document.getElementById('history-list');
        const pagEl = document.getElementById('history-pagination');

        if (!listEl) return;

        if (raw.length === 0) {
            if (emptyEl) emptyEl.style.display = 'flex';
            if (toolbar) toolbar.style.display = 'none';
            if (statsEl) {
                statsEl.innerHTML = '';
                statsEl.style.display = 'none';
            }
            if (groupStatsEl) {
                groupStatsEl.innerHTML = '';
                groupStatsEl.style.display = 'none';
            }
            listEl.innerHTML = '';
            if (pagEl) {
                pagEl.innerHTML = '';
                pagEl.style.display = 'none';
            }
            return;
        }

        if (emptyEl) emptyEl.style.display = 'none';
        if (toolbar) toolbar.style.display = '';

        const search = document.getElementById('history-search')?.value?.trim() || '';
        const sortBy = document.getElementById('history-sort')?.value || 'date-desc';
        const dateRange = document.getElementById('history-date-range')?.value || 'all';
        const groupBy = document.getElementById('history-group-by')?.value || 'flat';

        if (groupBy === 'flat') {
            historyViewMode = 'flat';
            groupsCurrentPage = 1;
            await historyManager.loadHistory({ search, sortBy, dateRange });

            const fh = historyManager.filteredHistory;
            if (statsEl) {
                statsEl.style.display = 'block';
                statsEl.innerHTML = renderHistoryStatsTwo(fh.length, countUniqueSequences(fh));
            }
            if (groupStatsEl) {
                groupStatsEl.innerHTML = '';
                groupStatsEl.style.display = 'none';
            }

            const page = historyManager.getCurrentPage();
            if (page.total === 0) {
                listEl.innerHTML =
                    '<div class="empty-state history-filter-empty"><p>По фильтрам ничего не найдено</p></div>';
            } else {
                listEl.innerHTML = renderGroupedListFlat(page.items);
            }
            renderFlatPagination(page);
            return;
        }

        historyViewMode = 'group';
        const filtered = applyHistoryFilters(raw, search, dateRange);
        let groups = [];
        if (groupBy === 'sequence') {
            groups = groupStats.groupBySequence(filtered);
        } else if (groupBy === 'date') {
            groups = groupStats.groupByDate(filtered);
        } else if (groupBy === 'gene') {
            groups = groupStats.groupByGene(filtered);
        }

        lastAllGroups = sortGroups(groups, sortBy);

        if (statsEl) {
            statsEl.style.display = 'block';
            statsEl.innerHTML = renderHistoryStatsTwo(
                filtered.length,
                countUniqueSequences(filtered),
            );
        }
        if (groupStatsEl) {
            groupStatsEl.innerHTML = '';
            groupStatsEl.style.display = 'none';
        }

        if (lastAllGroups.length === 0) {
            listEl.innerHTML =
                '<div class="empty-state history-filter-empty"><p>По фильтрам ничего не найдено</p></div>';
            if (pagEl) {
                pagEl.innerHTML = '';
                pagEl.style.display = 'none';
            }
            return;
        }

        const totalPages = Math.max(1, Math.ceil(lastAllGroups.length / GROUPS_PER_PAGE));
        if (groupsCurrentPage > totalPages) groupsCurrentPage = totalPages;
        const start = (groupsCurrentPage - 1) * GROUPS_PER_PAGE;
        const slice = lastAllGroups.slice(start, start + GROUPS_PER_PAGE);
        lastGroupPageSlice = slice;

        let html = '';
        slice.forEach((g, i) => {
            if (groupBy === 'sequence') html += renderSequenceGroup(g, i);
            else if (groupBy === 'date') html += renderDateGroup(g, i);
            else html += renderGeneGroup(g, i);
        });
        listEl.innerHTML = html;
        renderGroupPagination(lastAllGroups.length);
    }

    function bindPaginationOnce() {
        const pagEl = document.getElementById('history-pagination');
        if (!pagEl || pagEl.dataset.bound) return;
        pagEl.dataset.bound = '1';
        pagEl.addEventListener('click', (e) => {
            const t = e.target;
            if (!(t instanceof HTMLElement)) return;
            if (t.id === 'history-prev') {
                if (historyViewMode === 'flat') {
                    historyManager.pagePrev();
                    const listEl = document.getElementById('history-list');
                    const page = historyManager.getCurrentPage();
                    if (listEl && page.total > 0) {
                        listEl.innerHTML = renderGroupedListFlat(page.items);
                    }
                    renderFlatPagination(page);
                } else {
                    if (groupsCurrentPage > 1) groupsCurrentPage--;
                    refresh().catch(() => {});
                }
            } else if (t.id === 'history-next') {
                if (historyViewMode === 'flat') {
                    historyManager.pageNext();
                    const listEl = document.getElementById('history-list');
                    const page = historyManager.getCurrentPage();
                    if (listEl && page.total > 0) {
                        listEl.innerHTML = renderGroupedListFlat(page.items);
                    }
                    renderFlatPagination(page);
                } else {
                    const totalPages = Math.max(
                        1,
                        Math.ceil(lastAllGroups.length / GROUPS_PER_PAGE),
                    );
                    if (groupsCurrentPage < totalPages) groupsCurrentPage++;
                    refresh().catch(() => {});
                }
            }
        });
    }

    if (!root.dataset.historyUiInit) {
        root.dataset.historyUiInit = '1';

        document.getElementById('history-search')?.addEventListener('input', debouncedRefresh);
        document.getElementById('history-sort')?.addEventListener('change', () => {
            groupsCurrentPage = 1;
            refresh().catch(() => {});
        });
        document.getElementById('history-date-range')?.addEventListener('change', () => {
            groupsCurrentPage = 1;
            refresh().catch(() => {});
        });
        document.getElementById('history-group-by')?.addEventListener('change', () => {
            groupsCurrentPage = 1;
            refresh().catch(() => {});
        });

        document.getElementById('history-clear')?.addEventListener('click', async () => {
            if (!confirm('Очистить всю историю дизайнов?')) return;
            await historyManager.clearHistory();
            showNotification('История очищена');
            await refresh();
        });

        root.addEventListener('click', async (e) => {
            const t = e.target;
            if (!(t instanceof Element)) return;

            const expandBtn = t.closest('.group-expand');
            if (expandBtn) {
                e.stopPropagation();
                const groupEl = expandBtn.closest('.history-group');
                const content = groupEl?.querySelector('.group-content');
                if (content) {
                    const open = content.style.display === 'none' || !content.style.display;
                    content.style.display = open ? 'block' : 'none';
                    expandBtn.textContent = open ? '▲' : '▼';
                }
                return;
            }

            const header = t.closest('.group-header');
            if (header && !t.closest('button')) {
                const expand = header.querySelector('.group-expand');
                expand?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                return;
            }

            const loadGroup = t.closest('.load-group-btn');
            if (loadGroup) {
                e.stopPropagation();
                const idx = parseInt(loadGroup.getAttribute('data-group-local-idx') || '-1', 10);
                const g = lastGroupPageSlice[idx];
                if (g) await loadGroupSequenceToEditor(g);
                return;
            }

            const loadSeq = t.closest('.load-seq-btn');
            if (loadSeq) {
                const seq = loadSeq.getAttribute('data-seq') || '';
                const clean = seq.replace(/\s/g, '').toUpperCase();
                const ta = document.getElementById('sequence');
                if (ta) ta.value = clean;
                setCurrentSequence(clean);
                updateSequenceStats(clean);
                showNotification('Последовательность вставлена в редактор');
                if (typeof window.switchTab === 'function') window.switchTab('design');
                return;
            }

            const saveBestBtn = t.closest('.save-history-best-btn');
            if (saveBestBtn) {
                e.stopPropagation();
                const id = saveBestBtn.getAttribute('data-id');
                if (!id || !savePrimer) return;
                const history = await storage.get('history') || [];
                const item = findHistoryEntryById(history, id);
                if (!item) {
                    showWarning('Запись не найдена');
                    return;
                }
                const primers = getNormalizedPrimersFromEntry(item);
                if (!primers) {
                    showWarning('В записи нет пар праймеров');
                    return;
                }
                const pair = pickBestPair(primers);
                await savePrimer(pair, {
                    sequence: item.sequence || '',
                    fromHistory: true,
                    historyEntryId: id,
                });
                refreshSavedPrimers?.();
                return;
            }

            const delBtn = t.closest('.delete-history-btn');
            if (delBtn) {
                const id = delBtn.getAttribute('data-id');
                await historyManager.deleteItem(id);
                await refresh();
                showNotification('Запись удалена');
            }
        });

        bindPaginationOnce();
    }

    return refresh;
}
