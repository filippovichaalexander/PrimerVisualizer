/**
 * Расширенная история дизайнов: фильтры, сортировка, пагинация, статистика.
 * @see optimization_6.md
 */
export class HistoryManager {
    /**
     * @param {import('./storage-manager.js').StorageManager} storage
     */
    constructor(storage) {
        this.storage = storage;
        this.itemsPerPage = 10;
        this.currentPage = 1;
        /** @type {any[]} */
        this.filteredHistory = [];
        this.currentFilters = {
            search: '',
            sortBy: 'date-desc',
            dateRange: 'all',
        };
    }

    /**
     * @param {object} [filters]
     */
    async loadHistory(filters = {}) {
        let history = await this.storage.get('history') || [];

        this.currentFilters = { ...this.currentFilters, ...filters };

        if (this.currentFilters.search) {
            const search = this.currentFilters.search.toLowerCase();
            history = history.filter((item) => {
                const sequence = item.sequence?.toLowerCase() || '';
                const bestScore = item.best_score?.toString() || '';
                const params = JSON.stringify(item.parameters || '').toLowerCase();
                return (
                    sequence.includes(search) ||
                    bestScore.includes(search) ||
                    params.includes(search)
                );
            });
        }

        if (this.currentFilters.dateRange !== 'all') {
            const now = Date.now();
            const ranges = {
                today: now - 24 * 60 * 60 * 1000,
                week: now - 7 * 24 * 60 * 60 * 1000,
                month: now - 30 * 24 * 60 * 60 * 1000,
                year: now - 365 * 24 * 60 * 60 * 1000,
            };
            const since = ranges[this.currentFilters.dateRange];
            if (since) {
                history = history.filter((item) => (item.timestamp || 0) >= since);
            }
        }

        history = this.sortHistory([...history], this.currentFilters.sortBy);

        this.filteredHistory = history;
        this.currentPage = 1;

        return this.getCurrentPage();
    }

    /**
     * @param {any[]} history
     * @param {string} sortBy
     */
    sortHistory(history, sortBy) {
        switch (sortBy) {
            case 'date-asc':
                return history.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            case 'score':
            case 'score-desc':
            case 'best-score':
                return history.sort(
                    (a, b) => (b.best_score || 0) - (a.best_score || 0),
                );
            case 'length':
                return history.sort(
                    (a, b) =>
                        (b.sequence_length || b.sequence?.length || 0) -
                        (a.sequence_length || a.sequence?.length || 0),
                );
            case 'most-pairs':
                return history.sort((a, b) => {
                    const pa = a.results_count ?? a.results?.length ?? a.primers?.length ?? 0;
                    const pb = b.results_count ?? b.results?.length ?? b.primers?.length ?? 0;
                    return pb - pa;
                });
            default:
                return history.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        }
    }

    getCurrentPage() {
        const total = this.filteredHistory.length;
        const totalPages = Math.max(1, Math.ceil(total / this.itemsPerPage) || 1);
        if (this.currentPage > totalPages) this.currentPage = totalPages;
        if (this.currentPage < 1) this.currentPage = 1;
        const start = (this.currentPage - 1) * this.itemsPerPage;
        const end = start + this.itemsPerPage;
        return {
            items: this.filteredHistory.slice(start, end),
            total,
            page: this.currentPage,
            totalPages,
            hasNext: end < total,
            hasPrev: this.currentPage > 1,
        };
    }

    /**
     * @param {number} page
     */
    goToPage(page) {
        const totalPages = Math.max(
            1,
            Math.ceil(this.filteredHistory.length / this.itemsPerPage) || 1,
        );
        this.currentPage = Math.max(1, Math.min(page, totalPages));
        return this.getCurrentPage();
    }

    pageNext() {
        const { totalPages } = this.getCurrentPage();
        if (this.currentPage < totalPages) this.currentPage++;
        return this.getCurrentPage();
    }

    pagePrev() {
        if (this.currentPage > 1) this.currentPage--;
        return this.getCurrentPage();
    }

    async getStats() {
        const history = await this.storage.get('history') || [];

        if (history.length === 0) {
            return {
                total: 0,
                uniqueSequences: 0,
                avgScore: 0,
                bestScore: 0,
                totalPairs: 0,
                avgPairs: 0,
                mostUsedTm: null,
                mostUsedGc: null,
                activityByDay: {},
                topSequences: [],
            };
        }

        const total = history.length;
        const uniqueSequences = new Set(history.map((h) => h.sequence)).size;
        const scores = history.map((h) => h.best_score || 0).filter((s) => s > 0);
        const avgScore = scores.length
            ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
            : 0;
        const bestScore = scores.length ? Math.max(...scores) : 0;
        const totalPairs = history.reduce(
            (sum, h) =>
                sum + (h.results_count ?? h.results?.length ?? h.primers?.length ?? 0),
            0,
        );
        const avgPairs = total ? Math.round(totalPairs / total) : 0;

        const tmCounts = {};
        const gcCounts = {};
        history.forEach((h) => {
            if (h.parameters?.tm != null) {
                const tm = Math.round(Number(h.parameters.tm));
                tmCounts[tm] = (tmCounts[tm] || 0) + 1;
            }
            if (h.parameters?.gc != null) {
                const gc = Math.round(Number(h.parameters.gc));
                gcCounts[gc] = (gcCounts[gc] || 0) + 1;
            }
        });

        const mostUsedTm = Object.entries(tmCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
        const mostUsedGc = Object.entries(gcCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

        const activityByDay = {};
        const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
        history
            .filter((h) => (h.timestamp || 0) >= thirtyDaysAgo)
            .forEach((h) => {
                const date = new Date(h.timestamp).toLocaleDateString();
                activityByDay[date] = (activityByDay[date] || 0) + 1;
            });

        const sequenceCounts = {};
        history.forEach((h) => {
            const seq = (h.sequence || '').substring(0, 50);
            if (!seq) return;
            sequenceCounts[seq] = (sequenceCounts[seq] || 0) + 1;
        });
        const topSequences = Object.entries(sequenceCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([seq, count]) => ({ sequence: seq, count }));

        return {
            total,
            uniqueSequences,
            avgScore,
            bestScore,
            totalPairs,
            avgPairs,
            mostUsedTm,
            mostUsedGc,
            activityByDay,
            topSequences,
        };
    }

    /**
     * @param {any[]} history
     */
    groupByDate(history) {
        const groups = {};
        history.forEach((item) => {
            const date = new Date(item.timestamp || Date.now()).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
            });
            if (!groups[date]) groups[date] = [];
            groups[date].push(item);
        });
        return groups;
    }

    /**
     * @param {number|string} id
     */
    async deleteItem(id) {
        const history = await this.storage.get('history') || [];
        const key = String(id);
        const filtered = history.filter((item) => String(historyEntryId(item)) !== key);
        await this.storage.set('history', filtered);
        return { success: true, remaining: filtered.length };
    }

    async clearHistory() {
        await this.storage.set('history', []);
        return { success: true };
    }

    async exportHistory() {
        const history = await this.storage.get('history') || [];
        const exportData = {
            exportDate: new Date().toISOString(),
            version: '2.0.0',
            total: history.length,
            data: history,
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], {
            type: 'application/json',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `primer-history-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        return { success: true };
    }

    /**
     * @param {any} item
     * @param {object} callbacks
     */
    loadItemToEditor(item, callbacks) {
        if (callbacks.onLoadSequence) callbacks.onLoadSequence(item.sequence);
        const results = item.results || item.primers;
        if (results && callbacks.onLoadResults) callbacks.onLoadResults(results);
        if (item.parameters && callbacks.onLoadParameters) {
            callbacks.onLoadParameters(item.parameters);
        }
        return { success: true };
    }
}

/** Стабильный id для записей без поля id (старые данные). */
export function historyEntryId(item) {
    if (item?.id != null) return item.id;
    return item?.timestamp ?? 0;
}
