import { historyEntryId } from '../lib/history-manager.js';
import { normalizeResults } from '../lib/primer-result-normalize.js';
import { displayResults } from './display-results.js';

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
    } = ctx;

    const root = document.getElementById('tab-history');
    if (!root) {
        return async () => {};
    }

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

    function renderStatsHtml(s) {
        return `
            <div class="history-stats-grid">
                <div class="history-stat-card"><span class="history-stat-value">${s.total}</span><span class="history-stat-label">Дизайнов</span></div>
                <div class="history-stat-card"><span class="history-stat-value">${s.uniqueSequences}</span><span class="history-stat-label">Уник. последовательностей</span></div>
                <div class="history-stat-card"><span class="history-stat-value">${s.avgScore || '—'}</span><span class="history-stat-label">Средняя оценка</span></div>
                <div class="history-stat-card"><span class="history-stat-value">${s.bestScore || '—'}</span><span class="history-stat-label">Лучшая оценка</span></div>
                <div class="history-stat-card"><span class="history-stat-value">${s.avgPairs}</span><span class="history-stat-label">Средн. пар</span></div>
            </div>`;
    }

    function renderItemHtml(item) {
        const id = historyEntryId(item);
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
            <div class="history-item" data-entry-id="${id}">
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
                    <button type="button" class="action-btn small load-history-btn" data-id="${id}">📂 Загрузить</button>
                    <button type="button" class="action-btn small delete-history-btn" data-id="${id}">🗑️</button>
                </div>
            </div>`;
    }

    function renderGroupedList(items) {
        const grouped = historyManager.groupByDate(items);
        let html = '';
        Object.keys(grouped).forEach((date) => {
            html += `<div class="history-date-group">
                <div class="history-date-header">${escapeHtml(date)}</div>
                <div class="history-items">${grouped[date].map(renderItemHtml).join('')}</div>
            </div>`;
        });
        return html;
    }

    function renderPagination(page) {
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
            <span class="pagination-info" id="history-page-info">${page.page} / ${page.totalPages}</span>
            <button type="button" class="pagination-btn" id="history-next" ${page.hasNext ? '' : 'disabled'}>→</button>`;
    }

    async function refresh() {
        const raw = await storage.get('history') || [];
        const emptyEl = document.getElementById('history-empty');
        const toolbar = document.getElementById('history-toolbar');
        const statsEl = document.getElementById('history-stats');
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

        await historyManager.loadHistory({ search, sortBy, dateRange });

        const stats = await historyManager.getStats();
        if (statsEl) {
            statsEl.style.display = 'block';
            statsEl.innerHTML = renderStatsHtml(stats);
        }

        const page = historyManager.getCurrentPage();
        if (page.total === 0) {
            listEl.innerHTML =
                '<div class="empty-state history-filter-empty"><p>По фильтрам ничего не найдено</p></div>';
        } else {
            listEl.innerHTML = renderGroupedList(page.items);
        }

        renderPagination(page);
    }

    function bindPaginationOnce() {
        const pagEl = document.getElementById('history-pagination');
        if (!pagEl || pagEl.dataset.bound) return;
        pagEl.dataset.bound = '1';
        pagEl.addEventListener('click', (e) => {
            const t = e.target;
            if (!(t instanceof HTMLElement)) return;
            if (t.id === 'history-prev') {
                historyManager.pagePrev();
            } else if (t.id === 'history-next') {
                historyManager.pageNext();
            } else return;
            const listEl = document.getElementById('history-list');
            const page = historyManager.getCurrentPage();
            if (listEl && page.total > 0) {
                listEl.innerHTML = renderGroupedList(page.items);
            }
            renderPagination(page);
        });
    }

    if (!root.dataset.historyUiInit) {
        root.dataset.historyUiInit = '1';

        document.getElementById('history-search')?.addEventListener('input', debouncedRefresh);
        document.getElementById('history-sort')?.addEventListener('change', () => refresh());
        document.getElementById('history-date-range')?.addEventListener('change', () => refresh());

        document.getElementById('history-export')?.addEventListener('click', async () => {
            await historyManager.exportHistory();
            showNotification('История экспортирована в JSON');
        });

        document.getElementById('history-clear')?.addEventListener('click', async () => {
            if (!confirm('Очистить всю историю дизайнов?')) return;
            await historyManager.clearHistory();
            showNotification('История очищена');
            await refresh();
        });

        root.addEventListener('click', async (e) => {
            const loadBtn = e.target.closest?.('.load-history-btn');
            const delBtn = e.target.closest?.('.delete-history-btn');
            if (loadBtn) {
                const id = loadBtn.getAttribute('data-id');
                const history = await storage.get('history') || [];
                const item = history.find((h) => String(historyEntryId(h)) === String(id));
                if (!item) {
                    showWarning('Запись не найдена');
                    return;
                }
                const seq = (item.sequence || '').replace(/\s/g, '').toUpperCase();
                const ta = document.getElementById('sequence');
                if (ta) ta.value = seq;
                setCurrentSequence(seq);
                updateSequenceStats(seq);

                const p = item.parameters;
                if (p) {
                    const tmEl = document.getElementById('tm');
                    const gcEl = document.getElementById('gc');
                    const lenEl = document.getElementById('length');
                    if (p.tm != null && tmEl) tmEl.value = String(p.tm);
                    if (p.gc != null && gcEl) gcEl.value = String(p.gc);
                    if (p.length != null && lenEl) lenEl.value = String(p.length);
                }

                let rawResults = item.results || item.primers;
                if (rawResults && Array.isArray(rawResults) && rawResults.length) {
                    const normalized = normalizeResults(rawResults, 'local');
                    setCurrentResults(normalized);
                    displayResults(normalized, { serverUnavailable: false, serverReturnedEmpty: false });
                    setPanelRightAnalysisVisible(true);
                    showNotification('Запись загружена в редактор');
                } else {
                    setCurrentResults(null);
                    setPanelRightAnalysisVisible(false);
                    const primersEl = document.getElementById('results-primers');
                    if (primersEl) {
                        primersEl.innerHTML =
                            '<div class="empty-state" style="padding:12px"><p>Нет сохранённых пар — нажмите «Подобрать праймеры».</p></div>';
                    }
                    showNotification('Последовательность загружена');
                }

                if (typeof window.switchTab === 'function') window.switchTab('design');
                return;
            }

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
