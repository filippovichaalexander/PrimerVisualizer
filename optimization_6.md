

Расширенная история с фильтрацией и поиском
1. Добавляем больше метаданных в историю
javascript
// design-flow.js - обновленный addToHistory
await storage.addToHistory({
    id: Date.now(),                    // Уникальный ID
    sequence: cleaned,                // Последовательность
    sequence_length: cleaned.length,  // Длина
    results_count: results.length,    // Количество пар
    best_score: results[0]?.totalScore, // Лучшая оценка
    parameters: {                     // Параметры дизайна
        tm: params.tm,
        gc: params.gc,
        length: params.length
    },
    settings_snapshot: {              // Снимок настроек
        minProductSize: advancedSettings.minProductSize,
        maxProductSize: advancedSettings.maxProductSize
    },
    timestamp: Date.now(),
    date: new Date().toISOString()
});
2. Расширенный UI для истории
html
<!-- В popup.html, вкладка history -->
<div class="history-filters">
    <input type="text" id="history-search" placeholder="🔍 Поиск по последовательности...">
    <select id="history-sort">
        <option value="date-desc">Новые сначала</option>
        <option value="date-asc">Старые сначала</option>
        <option value="score">По оценке</option>
        <option value="length">По длине</option>
    </select>
    <button id="history-clear" class="btn btn-small btn-outline">Очистить историю</button>
</div>

<div id="history-stats" class="history-stats"></div>
<div id="history-list" class="history-list"></div>

<!-- Пагинация -->
<div class="history-pagination" id="history-pagination"></div>
3. Улучшенная загрузка истории
javascript
// history-manager.js (новый файл)
export class HistoryManager {
    constructor(storage) {
        this.storage = storage;
        this.itemsPerPage = 10;
        this.currentPage = 1;
        this.filteredHistory = [];
    }

    async loadHistory(filters = {}) {
        let history = await this.storage.get('history') || [];
        
        // Фильтрация
        if (filters.search) {
            const search = filters.search.toLowerCase();
            history = history.filter(item => 
                item.sequence?.toLowerCase().includes(search) ||
                item.best_score?.toString().includes(search)
            );
        }
        
        // Сортировка
        history = this.sortHistory(history, filters.sortBy || 'date-desc');
        
        this.filteredHistory = history;
        return this.getPage(1);
    }
    
    sortHistory(history, sortBy) {
        switch(sortBy) {
            case 'date-asc':
                return history.sort((a, b) => a.timestamp - b.timestamp);
            case 'score':
                return history.sort((a, b) => (b.best_score || 0) - (a.best_score || 0));
            case 'length':
                return history.sort((a, b) => (b.sequence_length || 0) - (a.sequence_length || 0));
            default: // date-desc
                return history.sort((a, b) => b.timestamp - a.timestamp);
        }
    }
    
    getPage(page) {
        const start = (page - 1) * this.itemsPerPage;
        const end = start + this.itemsPerPage;
        return {
            items: this.filteredHistory.slice(start, end),
            total: this.filteredHistory.length,
            page,
            totalPages: Math.ceil(this.filteredHistory.length / this.itemsPerPage)
        };
    }
    
    async clearHistory() {
        await this.storage.set('history', []);
        return { success: true };
    }
    
    async deleteItem(id) {
        const history = await this.storage.get('history') || [];
        const filtered = history.filter(item => item.id !== id);
        await this.storage.set('history', filtered);
        return { success: true };
    }
    
    async exportHistory() {
        const history = await this.storage.get('history') || [];
        const blob = new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `primer-history-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }
}
4. Улучшенное отображение истории
javascript
// В popup.js - обновленная функция loadHistory
async function loadHistory() {
    const history = await storage.get('history') || [];
    const container = document.getElementById('history-list');
    const statsContainer = document.getElementById('history-stats');
    
    if (history.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">📜</span>
                <p>История пуста</p>
                <p class="empty-hint">После дизайна праймеров они появятся здесь</p>
            </div>
        `;
        if (statsContainer) statsContainer.innerHTML = '';
        return;
    }
    
    // Статистика
    const totalDesigns = history.length;
    const uniqueSequences = new Set(history.map(h => h.sequence)).size;
    const avgScore = Math.round(history.reduce((sum, h) => sum + (h.best_score || 0), 0) / totalDesigns);
    
    statsContainer.innerHTML = `
        <div class="history-stats-grid">
            <div class="stat-card">
                <div class="stat-number">${totalDesigns}</div>
                <div class="stat-label">Всего дизайнов</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${uniqueSequences}</div>
                <div class="stat-label">Уникальных последовательностей</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${avgScore}</div>
                <div class="stat-label">Средняя оценка</div>
            </div>
        </div>
    `;
    
    // Отображение с группировкой по датам
    const grouped = groupByDate(history);
    
    let html = '';
    for (const [date, items] of Object.entries(grouped)) {
        html += `<div class="history-date-group">
            <div class="history-date-header">${date}</div>
            <div class="history-items">
        `;
        
        for (const item of items.slice(0, 5)) {
            const dateStr = new Date(item.timestamp).toLocaleString();
            const preview = item.sequence?.substring(0, 50) || '';
            
            html += `
                <div class="history-item" data-id="${item.id}">
                    <div class="history-item-header">
                        <span class="history-date">${dateStr}</span>
                        <div class="history-badges">
                            <span class="badge">${item.results_count || 0} пар</span>
                            ${item.best_score ? `<span class="badge score">⭐ ${item.best_score}</span>` : ''}
                        </div>
                    </div>
                    <div class="history-sequence" title="${item.sequence}">
                        ${preview}${preview.length < item.sequence?.length ? '...' : ''}
                    </div>
                    <div class="history-params">
                        Tm: ${item.parameters?.tm || '—'}°C · 
                        GC: ${item.parameters?.gc || '—'}% · 
                        Длина: ${item.sequence_length || '—'} нт
                    </div>
                    <div class="history-actions">
                        <button class="action-btn small load-history-btn" data-id="${item.id}">
                            📂 Загрузить
                        </button>
                        <button class="action-btn small delete-history-btn" data-id="${item.id}">
                            🗑️
                        </button>
                    </div>
                </div>
            `;
        }
        
        if (items.length > 5) {
            html += `<div class="history-show-more" data-date="${date}">
                + еще ${items.length - 5} записей
            </div>`;
        }
        
        html += `</div></div>`;
    }
    
    container.innerHTML = html;
    
    // Обработчики
    container.querySelectorAll('.load-history-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = parseInt(btn.dataset.id);
            const item = history.find(h => h.id === id);
            if (item) {
                document.getElementById('sequence').value = item.sequence;
                updateSequenceStats(item.sequence);
                currentSequence = item.sequence;
                
                if (item.results) {
                    currentResults = item.results;
                    displayResults(item.results);
                }
                
                showNotification('✅ История загружена');
            }
        });
    });
    
    container.querySelectorAll('.delete-history-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = parseInt(btn.dataset.id);
            if (confirm('Удалить эту запись из истории?')) {
                const filtered = history.filter(h => h.id !== id);
                await storage.set('history', filtered);
                await loadHistory();
                showNotification('✅ Запись удалена');
            }
        });
    });
    
    container.querySelectorAll('.history-show-more').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const date = btn.dataset.date;
            // Показать все записи за эту дату
            // (можно реализовать модальное окно или раскрытие)
        });
    });
}

function groupByDate(history) {
    const groups = {};
    history.forEach(item => {
        const date = new Date(item.timestamp).toLocaleDateString();
        if (!groups[date]) groups[date] = [];
        groups[date].push(item);
    });
    return groups;
}
5. Добавляем стили для истории
css
/* В popup.css */
.history-filters {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
    flex-wrap: wrap;
}

.history-filters input {
    flex: 1;
    padding: 8px 12px;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    font-size: 13px;
}

.history-stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 12px;
    margin-bottom: 20px;
}

.stat-card {
    background: #f8fafc;
    border-radius: 12px;
    padding: 12px;
    text-align: center;
    border: 1px solid #e2e8f0;
}

.stat-number {
    font-size: 24px;
    font-weight: 700;
    color: #1e293b;
}

.stat-label {
    font-size: 11px;
    color: #64748b;
    margin-top: 4px;
}

.history-date-group {
    margin-bottom: 20px;
}

.history-date-header {
    font-size: 13px;
    font-weight: 600;
    color: #475569;
    padding: 8px 0;
    border-bottom: 1px solid #e2e8f0;
    margin-bottom: 12px;
}

.history-item {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 12px;
    margin-bottom: 8px;
    transition: all 0.2s;
}

.history-item:hover {
    border-color: #cbd5e1;
    box-shadow: 0 2px 4px rgba(0,0,0,0.05);
}

.history-item-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
    flex-wrap: wrap;
    gap: 8px;
}

.history-date {
    font-size: 11px;
    color: #94a3b8;
}

.history-badges {
    display: flex;
    gap: 6px;
}

.history-badges .badge {
    font-size: 10px;
    padding: 2px 6px;
    background: #f1f5f9;
    border-radius: 20px;
    color: #475569;
}

.history-badges .badge.score {
    background: #fef3c7;
    color: #b45309;
}

.history-sequence {
    font-family: monospace;
    font-size: 12px;
    color: #334155;
    background: #f8fafc;
    padding: 6px 8px;
    border-radius: 6px;
    margin-bottom: 8px;
    word-break: break-all;
}

.history-params {
    font-size: 11px;
    color: #64748b;
    margin-bottom: 10px;
}

.history-actions {
    display: flex;
    gap: 8px;
}

.history-show-more {
    text-align: center;
    padding: 8px;
    font-size: 12px;
    color: #3b82f6;
    cursor: pointer;
    background: #f8fafc;
    border-radius: 8px;
    margin-top: 4px;
}

.history-show-more:hover {
    background: #f1f5f9;
}
📋 Итог
✅ Уже реализовано:
Сохранение истории при каждом дизайне

Лимит 50 записей

Отображение во вкладке "История"

Синхронизация с облаком (если включена)

Разрешение конфликтов истории

🚀 Можно улучшить:
Поиск по последовательности

Фильтрация и сортировка

Пагинация (вместо лимита 50)

Экспорт истории в JSON

Удаление отдельных записей

Группировка по датам

Статистика использования

Загрузка записи обратно в редактор


.....

 Реализация расширенной истории пользователя
Давайте реализуем все улучшения прямо сейчас! Я создам новый модуль history-manager.js и обновлю существующие файлы.

📁 Создаем новый файл: history-manager.js
javascript
// lib/history-manager.js
export class HistoryManager {
    constructor(storage) {
        this.storage = storage;
        this.itemsPerPage = 10;
        this.currentPage = 1;
        this.filteredHistory = [];
        this.currentFilters = {
            search: '',
            sortBy: 'date-desc',
            dateRange: 'all'
        };
    }

    /**
     * Загрузка истории с фильтрацией и сортировкой
     */
    async loadHistory(filters = {}) {
        let history = await this.storage.get('history') || [];
        
        // Применяем фильтры
        this.currentFilters = { ...this.currentFilters, ...filters };
        
        // Фильтрация по поиску
        if (this.currentFilters.search) {
            const search = this.currentFilters.search.toLowerCase();
            history = history.filter(item => {
                const sequence = item.sequence?.toLowerCase() || '';
                const bestScore = item.best_score?.toString() || '';
                const params = JSON.stringify(item.parameters || '').toLowerCase();
                return sequence.includes(search) || 
                       bestScore.includes(search) ||
                       params.includes(search);
            });
        }
        
        // Фильтрация по дате
        if (this.currentFilters.dateRange !== 'all') {
            const now = Date.now();
            const ranges = {
                'today': now - 24 * 60 * 60 * 1000,
                'week': now - 7 * 24 * 60 * 60 * 1000,
                'month': now - 30 * 24 * 60 * 60 * 1000,
                'year': now - 365 * 24 * 60 * 60 * 1000
            };
            const since = ranges[this.currentFilters.dateRange];
            if (since) {
                history = history.filter(item => item.timestamp >= since);
            }
        }
        
        // Сортировка
        history = this.sortHistory(history, this.currentFilters.sortBy);
        
        this.filteredHistory = history;
        this.currentPage = 1;
        
        return this.getCurrentPage();
    }
    
    /**
     * Сортировка истории
     */
    sortHistory(history, sortBy) {
        switch(sortBy) {
            case 'date-asc':
                return history.sort((a, b) => a.timestamp - b.timestamp);
            case 'score':
                return history.sort((a, b) => (b.best_score || 0) - (a.best_score || 0));
            case 'length':
                return history.sort((a, b) => (b.sequence_length || 0) - (a.sequence_length || 0));
            case 'score-desc':
                return history.sort((a, b) => (b.best_score || 0) - (a.best_score || 0));
            default: // date-desc
                return history.sort((a, b) => b.timestamp - a.timestamp);
        }
    }
    
    /**
     * Получение текущей страницы
     */
    getCurrentPage() {
        const start = (this.currentPage - 1) * this.itemsPerPage;
        const end = start + this.itemsPerPage;
        return {
            items: this.filteredHistory.slice(start, end),
            total: this.filteredHistory.length,
            page: this.currentPage,
            totalPages: Math.max(1, Math.ceil(this.filteredHistory.length / this.itemsPerPage)),
            hasNext: end < this.filteredHistory.length,
            hasPrev: this.currentPage > 1
        };
    }
    
    /**
     * Переход на страницу
     */
    goToPage(page) {
        this.currentPage = Math.max(1, Math.min(page, this.getCurrentPage().totalPages));
        return this.getCurrentPage();
    }
    
    /**
     * Получение статистики
     */
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
                mostUsedTm: 0,
                mostUsedGc: 0,
                activityByDay: {},
                topSequences: []
            };
        }
        
        // Базовая статистика
        const total = history.length;
        const uniqueSequences = new Set(history.map(h => h.sequence)).size;
        const scores = history.map(h => h.best_score || 0).filter(s => s > 0);
        const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
        const bestScore = Math.max(...scores, 0);
        const totalPairs = history.reduce((sum, h) => sum + (h.results_count || 0), 0);
        const avgPairs = total ? Math.round(totalPairs / total) : 0;
        
        // Анализ параметров
        const tmCounts = {};
        const gcCounts = {};
        history.forEach(h => {
            if (h.parameters?.tm) {
                const tm = Math.round(h.parameters.tm);
                tmCounts[tm] = (tmCounts[tm] || 0) + 1;
            }
            if (h.parameters?.gc) {
                const gc = Math.round(h.parameters.gc);
                gcCounts[gc] = (gcCounts[gc] || 0) + 1;
            }
        });
        
        const mostUsedTm = Object.entries(tmCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 0;
        const mostUsedGc = Object.entries(gcCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 0;
        
        // Активность по дням (последние 30 дней)
        const activityByDay = {};
        const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
        history
            .filter(h => h.timestamp >= thirtyDaysAgo)
            .forEach(h => {
                const date = new Date(h.timestamp).toLocaleDateString();
                activityByDay[date] = (activityByDay[date] || 0) + 1;
            });
        
        // Топ последовательностей
        const sequenceCounts = {};
        history.forEach(h => {
            const seq = h.sequence?.substring(0, 50) || '';
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
            topSequences
        };
    }
    
    /**
     * Группировка по датам для отображения
     */
    groupByDate(history) {
        const groups = {};
        history.forEach(item => {
            const date = new Date(item.timestamp).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
            if (!groups[date]) groups[date] = [];
            groups[date].push(item);
        });
        return groups;
    }
    
    /**
     * Удаление одной записи
     */
    async deleteItem(id) {
        const history = await this.storage.get('history') || [];
        const filtered = history.filter(item => item.id !== id);
        await this.storage.set('history', filtered);
        return { success: true, remaining: filtered.length };
    }
    
    /**
     * Очистка всей истории
     */
    async clearHistory() {
        await this.storage.set('history', []);
        return { success: true };
    }
    
    /**
     * Экспорт в JSON
     */
    async exportHistory() {
        const history = await this.storage.get('history') || [];
        const exportData = {
            exportDate: new Date().toISOString(),
            version: '2.0.0',
            total: history.length,
            data: history
        };
        
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `primer-history-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        
        return { success: true };
    }
    
    /**
     * Загрузка записи в редактор
     */
    loadItemToEditor(item, callbacks) {
        if (callbacks.onLoadSequence) {
            callbacks.onLoadSequence(item.sequence);
        }
        if (item.results && callbacks.onLoadResults) {
            callbacks.onLoadResults(item.results);
        }
        if (item.parameters && callbacks.onLoadParameters) {
            callbacks.onLoadParameters(item.parameters);
        }
        return { success: true };
    }
}
📝 Обновляем popup.html - добавляем UI для расширенной истории
html
<!-- Вкладка history - полная версия -->
<div class="tab-pane" id="tab-history">
    <div class="history-container">
        <!-- Панель управления -->
        <div class="history-controls">
            <div class="history-search">
                <input type="text" id="history-search" class="history-search-input" 
                       placeholder="🔍 Поиск по последовательности, оценке, параметрам...">
                <button id="history-clear-search" class="btn btn-small btn-outline" title="Очистить">✕</button>
            </div>
            
            <div class="history-filters">
                <select id="history-sort" class="history-select">
                    <option value="date-desc">📅 Новые сначала</option>
                    <option value="date-asc">📅 Старые сначала</option>
                    <option value="score">⭐ По оценке (высокие)</option>
                    <option value="length">📏 По длине последовательности</option>
                </select>
                
                <select id="history-date-range" class="history-select">
                    <option value="all">📆 Вся история</option>
                    <option value="today">📅 Сегодня</option>
                    <option value="week">📆 Последняя неделя</option>
                    <option value="month">📆 Последний месяц</option>
                    <option value="year">📆 Последний год</option>
                </select>
                
                <button id="history-export" class="btn btn-small btn-outline" title="Экспорт">
                    📤 Экспорт
                </button>
                <button id="history-clear-all" class="btn btn-small btn-outline btn-danger" title="Очистить всю историю">
                    🗑️ Очистить всё
                </button>
            </div>
        </div>
        
        <!-- Статистика -->
        <div id="history-stats" class="history-stats" style="display: none;"></div>
        
        <!-- Список истории -->
        <div id="history-list" class="history-list"></div>
        
        <!-- Пагинация -->
        <div id="history-pagination" class="history-pagination" style="display: none;">
            <div class="pagination-bar">
                <button class="pagination-btn" id="history-prev" disabled>← Назад</button>
                <span class="pagination-info" id="history-page-info">Страница 1</span>
                <button class="pagination-btn" id="history-next" disabled>Вперёд →</button>
            </div>
        </div>
        
        <div class="history-empty" id="history-empty" style="display: none;">
            <span class="empty-icon">📜</span>
            <p>История пуста</p>
            <p class="empty-hint">После дизайна праймеров они появятся здесь</p>
            <button class="btn btn-small btn-primary" onclick="switchTab('design')">
                🎯 Создать первый дизайн
            </button>
        </div>
    </div>
</div>
🎨 Обновляем popup.css - добавляем стили
css
/* history.css - стили для расширенной истории */

.history-container {
    padding: 4px;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.history-controls {
    flex-shrink: 0;
    margin-bottom: 16px;
}

.history-search {
    position: relative;
    margin-bottom: 12px;
}

.history-search-input {
    width: 100%;
    padding: 10px 36px 10px 12px;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    font-size: 13px;
    background: #fff;
}

.history-search-input:focus {
    outline: none;
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59,130,246,0.1);
}

#history-clear-search {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    padding: 4px 8px;
    font-size: 12px;
}

.history-filters {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
}

.history-select {
    padding: 6px 10px;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    font-size: 12px;
    background: #fff;
    color: #334155;
    cursor: pointer;
}

.history-select:hover {
    border-color: #cbd5e1;
}

/* Статистика */
.history-stats {
    flex-shrink: 0;
    margin-bottom: 16px;
    padding: 12px;
    background: linear-gradient(135deg, #f8fafc 0%, #fff 100%);
    border-radius: 12px;
    border: 1px solid #e2e8f0;
}

.stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
    gap: 12px;
    margin-bottom: 16px;
}

.stat-card {
    text-align: center;
    padding: 10px;
    background: #fff;
    border-radius: 10px;
    border: 1px solid #e2e8f0;
}

.stat-number {
    font-size: 22px;
    font-weight: 700;
    color: #1e293b;
    line-height: 1.2;
}

.stat-label {
    font-size: 10px;
    color: #64748b;
    margin-top: 4px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
}

.activity-chart {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid #e2e8f0;
}

.chart-title {
    font-size: 11px;
    font-weight: 600;
    color: #64748b;
    margin-bottom: 8px;
    text-transform: uppercase;
}

.chart-bars {
    display: flex;
    gap: 4px;
    align-items: flex-end;
    flex-wrap: wrap;
}

.chart-bar {
    flex: 1;
    min-width: 20px;
    background: #3b82f6;
    border-radius: 4px 4px 0 0;
    transition: height 0.2s;
    cursor: pointer;
    position: relative;
}

.chart-bar:hover {
    background: #2563eb;
}

.chart-bar:hover::after {
    content: attr(data-count);
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    background: #1e293b;
    color: #fff;
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 4px;
    white-space: nowrap;
    margin-bottom: 4px;
}

.top-sequences {
    margin-top: 12px;
    font-size: 11px;
}

.top-sequence-item {
    display: flex;
    justify-content: space-between;
    padding: 6px 0;
    border-bottom: 1px solid #f1f5f9;
}

.top-sequence-preview {
    font-family: monospace;
    color: #334155;
}

.top-sequence-count {
    color: #3b82f6;
    font-weight: 600;
}

/* Список истории */
.history-list {
    flex: 1;
    overflow-y: auto;
    margin-bottom: 12px;
    padding-right: 4px;
}

.history-date-group {
    margin-bottom: 20px;
}

.history-date-header {
    font-size: 12px;
    font-weight: 600;
    color: #475569;
    padding: 6px 0;
    border-bottom: 1px solid #e2e8f0;
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    gap: 8px;
}

.history-date-header .count {
    font-size: 11px;
    font-weight: normal;
    color: #94a3b8;
}

.history-item {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 12px;
    margin-bottom: 8px;
    transition: all 0.2s;
    cursor: pointer;
}

.history-item:hover {
    border-color: #cbd5e1;
    box-shadow: 0 2px 8px rgba(0,0,0,0.05);
    transform: translateY(-1px);
}

.history-item.selected {
    border-color: #3b82f6;
    background: #eff6ff;
}

.history-item-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
    flex-wrap: wrap;
    gap: 8px;
}

.history-time {
    font-size: 11px;
    color: #94a3b8;
    display: flex;
    align-items: center;
    gap: 4px;
}

.history-badges {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
}

.history-badge {
    font-size: 10px;
    padding: 2px 8px;
    background: #f1f5f9;
    border-radius: 20px;
    color: #475569;
}

.history-badge.score {
    background: #fef3c7;
    color: #b45309;
}

.history-badge.length {
    background: #dbeafe;
    color: #1e40af;
}

.history-sequence {
    font-family: 'Monaco', 'Menlo', monospace;
    font-size: 11px;
    color: #334155;
    background: #f8fafc;
    padding: 8px;
    border-radius: 8px;
    margin-bottom: 8px;
    word-break: break-all;
    line-height: 1.4;
}

.history-params {
    font-size: 11px;
    color: #64748b;
    margin-bottom: 10px;
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
}

.history-params span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
}

.history-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
}

.history-actions .action-btn {
    font-size: 11px;
    padding: 4px 10px;
}

/* Пагинация */
.history-pagination {
    flex-shrink: 0;
    padding-top: 8px;
    border-top: 1px solid #e2e8f0;
}

.pagination-bar {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
}

.pagination-info {
    font-size: 12px;
    color: #64748b;
}

/* Пустое состояние */
.history-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 40px 20px;
    color: #94a3b8;
}

.empty-icon {
    font-size: 48px;
    margin-bottom: 16px;
}

.empty-hint {
    font-size: 12px;
    margin-top: 8px;
    color: #cbd5e1;
}
🔧 Обновляем popup.js - интегрируем HistoryManager
javascript
// popup.js - добавляем импорт и инициализацию
import { HistoryManager } from '../lib/history-manager.js';

// Инициализация
const historyManager = new HistoryManager(storage);
let currentHistoryPage = null;

// Обновленная функция loadHistory
async function loadHistory() {
    const container = document.getElementById('history-list');
    const statsContainer = document.getElementById('history-stats');
    const paginationContainer = document.getElementById('history-pagination');
    const emptyContainer = document.getElementById('history-empty');
    const controlsContainer = document.querySelector('.history-controls');
    
    if (!container) return;
    
    try {
        // Получаем фильтры из UI
        const searchInput = document.getElementById('history-search');
        const sortSelect = document.getElementById('history-sort');
        const dateRangeSelect = document.getElementById('history-date-range');
        
        const pageData = await historyManager.loadHistory({
            search: searchInput?.value || '',
            sortBy: sortSelect?.value || 'date-desc',
            dateRange: dateRangeSelect?.value || 'all'
        });
        
        currentHistoryPage = pageData;
        
        // Показываем/скрываем элементы
        if (pageData.total === 0) {
            if (statsContainer) statsContainer.style.display = 'none';
            if (paginationContainer) paginationContainer.style.display = 'none';
            if (emptyContainer) emptyContainer.style.display = 'flex';
            if (controlsContainer) controlsContainer.style.display = 'none';
            container.innerHTML = '';
            return;
        }
        
        if (controlsContainer) controlsContainer.style.display = 'block';
        if (emptyContainer) emptyContainer.style.display = 'none';
        if (statsContainer) statsContainer.style.display = 'block';
        if (paginationContainer) paginationContainer.style.display = 'flex';
        
        // Загружаем и отображаем статистику
        await loadHistoryStats();
        
        // Группируем по датам
        const grouped = historyManager.groupByDate(pageData.items);
        
        let html = '';
        for (const [date, items] of Object.entries(grouped)) {
            html += `
                <div class="history-date-group">
                    <div class="history-date-header">
                        ${date}
                        <span class="count">(${items.length})</span>
                    </div>
                    <div class="history-items">
            `;
            
            for (const item of items) {
                const timeStr = new Date(item.timestamp).toLocaleTimeString();
                const preview = item.sequence?.substring(0, 60) || '';
                const scoreDisplay = item.best_score ? `⭐ ${item.best_score}` : '—';
                const lengthDisplay = item.sequence_length ? `${item.sequence_length} нт` : '—';
                
                html += `
                    <div class="history-item" data-id="${item.id}" data-sequence="${item.sequence || ''}">
                        <div class="history-item-header">
                            <div class="history-time">
                                🕐 ${timeStr}
                            </div>
                            <div class="history-badges">
                                <span class="history-badge">${item.results_count || 0} пар</span>
                                <span class="history-badge score">${scoreDisplay}</span>
                                <span class="history-badge length">${lengthDisplay}</span>
                            </div>
                        </div>
                        <div class="history-sequence" title="${item.sequence || ''}">
                            ${escapeHtml(preview)}${preview.length < (item.sequence?.length || 0) ? '...' : ''}
                        </div>
                        <div class="history-params">
                            <span>🌡️ Tm: ${item.parameters?.tm || '—'}°C</span>
                            <span>🧬 GC: ${item.parameters?.gc || '—'}%</span>
                            <span>📏 Длина: ${item.parameters?.length || '—'} нт</span>
                        </div>
                        <div class="history-actions">
                            <button class="action-btn small load-history-item" data-id="${item.id}">
                                📂 Загрузить
                            </button>
                            <button class="action-btn small delete-history-item" data-id="${item.id}">
                                🗑️ Удалить
                            </button>
                        </div>
                    </div>
                `;
            }
            
            html += `</div></div>`;
        }
        
        container.innerHTML = html;
        
        // Обновляем пагинацию
        updatePagination(pageData);
        
        // Добавляем обработчики
        attachHistoryItemHandlers();
        
    } catch (error) {
        console.error('Error loading history:', error);
        container.innerHTML = '<div class="error">Ошибка загрузки истории</div>';
    }
}

// Загрузка статистики
async function loadHistoryStats() {
    const statsContainer = document.getElementById('history-stats');
    if (!statsContainer) return;
    
    const stats = await historyManager.getStats();
    
    if (stats.total === 0) {
        statsContainer.innerHTML = '';
        return;
    }
    
    // Создаем график активности
    const activityDays = Object.keys(stats.activityByDay).slice(-7);
    const maxActivity = Math.max(...Object.values(stats.activityByDay), 1);
    
    let chartHtml = '';
    if (activityDays.length > 0) {
        chartHtml = `
            <div class="activity-chart">
                <div class="chart-title">📊 Активность за последние 7 дней</div>
                <div class="chart-bars">
                    ${activityDays.map(day => {
                        const count = stats.activityByDay[day] || 0;
                        const height = Math.max(20, (count / maxActivity) * 40);
                        return `
                            <div class="chart-bar" style="height: ${height}px" data-count="${count}" title="${day}: ${count} дизайнов"></div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }
    
    // Топ последовательности
    let topSequencesHtml = '';
    if (stats.topSequences.length > 0) {
        topSequencesHtml = `
            <div class="top-sequences">
                <div class="chart-title">🔥 Чаще всего дизайнировали</div>
                ${stats.topSequences.map(seq => `
                    <div class="top-sequence-item">
                        <span class="top-sequence-preview">${escapeHtml(seq.sequence.substring(0, 40))}...</span>
                        <span class="top-sequence-count">${seq.count} раз</span>
                    </div>
                `).join('')}
            </div>
        `;
    }
    
    statsContainer.innerHTML = `
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-number">${stats.total}</div>
                <div class="stat-label">Всего дизайнов</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${stats.uniqueSequences}</div>
                <div class="stat-label">Уникальных<br>последовательностей</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${stats.avgScore}</div>
                <div class="stat-label">Средняя оценка</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${stats.bestScore}</div>
                <div class="stat-label">Лучшая оценка</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${stats.totalPairs}</div>
                <div class="stat-label">Всего пар праймеров</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${stats.avgPairs}</div>
                <div class="stat-label">Пар в среднем</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${stats.mostUsedTm}°C</div>
                <div class="stat-label">Часто используемая Tm</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${stats.mostUsedGc}%</div>
                <div class="stat-label">Часто используемый GC</div>
            </div>
        </div>
        ${chartHtml}
        ${topSequencesHtml}
    `;
}

// Обновление пагинации
function updatePagination(pageData) {
    const prevBtn = document.getElementById('history-prev');
    const nextBtn = document.getElementById('history-next');
    const pageInfo = document.getElementById('history-page-info');
    
    if (prevBtn) {
        prevBtn.disabled = !pageData.hasPrev;
        prevBtn.onclick = () => goToHistoryPage(pageData.page - 1);
    }
    
    if (nextBtn) {
        nextBtn.disabled = !pageData.hasNext;
        nextBtn.onclick = () => goToHistoryPage(pageData.page + 1);
    }
    
    if (pageInfo) {
        pageInfo.textContent = `Страница ${pageData.page} из ${pageData.totalPages} (${pageData.total} записей)`;
    }
}

// Переход на страницу
async function goToHistoryPage(page) {
    const pageData = historyManager.goToPage(page);
    currentHistoryPage = pageData;
    
    // Перерисовываем список
    const grouped = historyManager.groupByDate(pageData.items);
    const container = document.getElementById('history-list');
    
    let html = '';
    for (const [date, items] of Object.entries(grouped)) {
        html += `
            <div class="history-date-group">
                <div class="history-date-header">${date}<span class="count">(${items.length})</span></div>
                <div class="history-items">
        `;
        
        for (const item of items) {
            const timeStr = new Date(item.timestamp).toLocaleTimeString();
            const preview = item.sequence?.substring(0, 60) || '';
            const scoreDisplay = item.best_score ? `⭐ ${item.best_score}` : '—';
            const lengthDisplay = item.sequence_length ? `${item.sequence_length} нт` : '—';
            
            html += `
                <div class="history-item" data-id="${item.id}">
                    <div class="history-item-header">
                        <div class="history-time">🕐 ${timeStr}</div>
                        <div class="history-badges">
                            <span class="history-badge">${item.results_count || 0} пар</span>
                            <span class="history-badge score">${scoreDisplay}</span>
                            <span class="history-badge length">${lengthDisplay}</span>
                        </div>
                    </div>
                    <div class="history-sequence">${escapeHtml(preview)}${preview.length < (item.sequence?.length || 0) ? '...' : ''}</div>
                    <div class="history-params">
                        <span>🌡️ Tm: ${item.parameters?.tm || '—'}°C</span>
                        <span>🧬 GC: ${item.parameters?.gc || '—'}%</span>
                        <span>📏 Длина: ${item.parameters?.length || '—'} нт</span>
                    </div>
                    <div class="history-actions">
                        <button class="action-btn small load-history-item" data-id="${item.id}">📂 Загрузить</button>
                        <button class="action-btn small delete-history-item" data-id="${item.id}">🗑️ Удалить</button>
                    </div>
                </div>
            `;
        }
        
        html += `</div></div>`;
    }
    
    container.innerHTML = html;
    attachHistoryItemHandlers();
    updatePagination(pageData);
}

// Обработчики для элементов истории
function attachHistoryItemHandlers() {
    // Загрузка записи
    document.querySelectorAll('.load-history-item').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = parseInt(btn.dataset.id);
            const history = await storage.get('history') || [];
            const item = history.find(h => h.id === id);
            
            if (item) {
                // Загружаем в редактор
                document.getElementById('sequence').value = item.sequence;
                updateSequenceStats(item.sequence);
                currentSequence = item.sequence;
                
                if (item.parameters) {
                    if (item.parameters.tm) document.getElementById('tm').value = item.parameters.tm;
                    if (item.parameters.gc) document.getElementById('gc').value = item.parameters.gc;
                    if (item.parameters.length) document.getElementById('length').value = item.parameters.length;
                }
                
                if (item.results) {
                    currentResults = item.results;
                    displayResults(item.results);
                }
                
                // Переключаемся на вкладку дизайна
                switchTab('design');
                showNotification('✅ История загружена');
            }
        });
    });
    
    // Удаление записи
    document.querySelectorAll('.delete-history-item').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = parseInt(btn.dataset.id);
            if (confirm('Удалить эту запись из истории?')) {
                await historyManager.deleteItem(id);
                await loadHistory();
                showNotification('✅ Запись удалена');
            }
        });
    });
    
    // Клик по карточке
    document.querySelectorAll('.history-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.history-actions')) return;
            const loadBtn = item.querySelector('.load-history-item');
            if (loadBtn) loadBtn.click();
        });
    });
}

// Обработчики фильтров
function setupHistoryFilters() {
    const searchInput = document.getElementById('history-search');
    const sortSelect = document.getElementById('history-sort');
    const dateRangeSelect = document.getElementById('history-date-range');
    const clearSearchBtn = document.getElementById('history-clear-search');
    const exportBtn = document.getElementById('history-export');
    const clearAllBtn = document.getElementById('history-clear-all');
    
    if (searchInput) {
        searchInput.addEventListener('input', debounce(() => loadHistory(), 300));
    }
    
    if (sortSelect) {
        sortSelect.addEventListener('change', () => loadHistory());
    }
    
    if (dateRangeSelect) {
        dateRangeSelect.addEventListener('change', () => loadHistory());
    }
    
    if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', () => {
            if (searchInput) searchInput.value = '';
            loadHistory();
        });
    }
    
    if (exportBtn) {
        exportBtn.addEventListener('click', async () => {
            await historyManager.exportHistory();
            showNotification('📤 История экспортирована');
        });
    }
    
    if (clearAllBtn) {
        clearAllBtn.addEventListener('click', async () => {
            if (confirm('Вы уверены? Вся история будет удалена без возможности восстановления.')) {
                await historyManager.clearHistory();
                await loadHistory();
                showNotification('🗑️ История очищена');
            }
        });
    }
}

// Вспомогательная функция для экранирования HTML
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Обновляем setupTabs для истории
function setupTabs() {
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            document.querySelectorAll('.tab-pane').forEach(pane => {
                pane.classList.remove('active');
            });
            document.getElementById(`tab-${tabName}`).classList.add('active');
            
            const sdo = document.getElementById('sidebar-design-only');
            if (sdo) sdo.style.display = tabName === 'design' ? '' : 'none';
            
            if (tabName === 'saved') loadSavedPrimers();
            if (tabName === 'history') {
                setupHistoryFilters();
                loadHistory();
            }
        });
    });
    
    window.switchTab = (name) => {
        const target = Array.from(tabs).find(t => t.dataset.tab === name);
        if (target) target.click();
    };
}
📝 Обновляем design-flow.js - добавляем расширенные метаданные
javascript
// В design-flow.js, в функции designPrimers, обновляем сохранение в историю

// После получения результатов
await storage.addToHistory({
    id: Date.now(),
    sequence: cleaned,
    sequence_length: cleaned.length,
    results_count: results.length,
    best_score: results[0]?.totalScore || null,
    results: results,
    parameters: {
        tm: params.tm,
        gc: params.gc,
        length: params.length
    },
    settings_snapshot: {
        minProductSize: advancedSettings.minProductSize,
        maxProductSize: advancedSettings.maxProductSize,
        tmTolerance: advancedSettings.tmTolerance,
        temperatureGradient: advancedSettings.temperatureGradient,
        minGc: advancedSettings.minGc,
        maxGc: advancedSettings.maxGc
    },
    timestamp: Date.now(),
    date: new Date().toISOString()
});
🎯 Итог: что теперь реализовано
Функция	Статус	Описание
Поиск по последовательности	✅	Поиск по всей последовательности, оценке, параметрам
Фильтрация	✅	По дате (сегодня/неделя/месяц/год)
Сортировка	✅	По дате (новые/старые), оценке, длине
Пагинация	✅	10 записей на страницу
Экспорт в JSON	✅	Полный экспорт всех данных
Удаление записей	✅	Удаление одной записи или всей истории
Группировка по датам	✅	Красивая группировка с заголовками
Статистика	✅	График активности, топ последовательностей
Загрузка в редактор	✅	Восстановление последовательности, параметров, результатов
Расширение теперь имеет полноценную, профессиональную систему истории пользователя!