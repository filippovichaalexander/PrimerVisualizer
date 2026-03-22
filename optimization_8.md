Оптимизация отображения статистики для биологов
Отличный вопрос! Действительно, текущая агрегированная статистика по всей истории может вводить в заблуждение. Давайте переработаем отображение, чтобы оно было полезным для биологов.

📊 Проблемы текущего подхода
Средняя оценка 90 - непонятно, к чему относится (ко всем разным последовательностям?)

Средн. пар 10 - но у каждой последовательности может быть разное количество найденных пар

Смешивание разных экспериментов - TP53 и ACTB имеют разную сложность дизайна

🏆 Новый подход: Группировка по последовательности
1. Редизайн вкладки "История"
html
<!-- В popup.html заменить секцию истории -->
<div class="tab-pane" id="tab-history">
    <!-- Панель управления -->
    <div class="history-toolbar">
        <div class="history-filters">
            <input type="search" id="history-search" placeholder="🔍 Поиск по последовательности, гену...">
            <select id="history-group-by">
                <option value="sequence">Группировать по последовательности</option>
                <option value="date">Группировать по дате</option>
                <option value="gene">Группировать по гену</option>
            </select>
            <select id="history-sort">
                <option value="date-desc">Новые сначала</option>
                <option value="best-score">По лучшей оценке</option>
                <option value="most-pairs">По количеству пар</option>
            </select>
        </div>
        <div class="history-actions-bar">
            <button type="button" id="history-export" class="btn btn-small btn-outline">📤 Экспорт</button>
            <button type="button" id="history-compare" class="btn btn-small btn-outline">🔬 Сравнить</button>
            <button type="button" id="history-clear" class="btn btn-small btn-outline">🗑️ Очистить</button>
        </div>
    </div>

    <!-- Статистика по группам -->
    <div id="history-group-stats" class="history-group-stats"></div>

    <!-- Список с группировкой -->
    <div id="history-list" class="history-list-scroll"></div>
    
    <div class="history-pagination" id="history-pagination"></div>
</div>
2. Новая логика группировки
javascript
// В history-ui.js обновить функции

class HistoryGroupStats {
    constructor(historyManager) {
        this.historyManager = historyManager;
    }

    /**
     * Группировка по последовательности (основной режим для биологов)
     */
    groupBySequence(history) {
        const groups = new Map();
        
        for (const item of history) {
            // Используем хеш последовательности как ключ
            const seqHash = this.getSequenceHash(item.sequence);
            const seqPreview = this.getSequencePreview(item.sequence);
            
            if (!groups.has(seqHash)) {
                groups.set(seqHash, {
                    sequence: item.sequence,
                    sequencePreview: seqPreview,
                    sequenceLength: item.sequence_length || item.sequence.length,
                    geneName: this.extractGeneName(item),
                    accession: item.accession || '',
                    designs: [],
                    firstDesign: item.timestamp,
                    lastDesign: item.timestamp,
                    bestScore: 0,
                    bestPair: null,
                    totalPairs: 0,
                    avgScore: 0,
                    designCount: 0
                });
            }
            
            const group = groups.get(seqHash);
            group.designs.push(item);
            group.designCount++;
            group.lastDesign = Math.max(group.lastDesign, item.timestamp);
            group.firstDesign = Math.min(group.firstDesign, item.timestamp);
            
            // Обновляем статистику по группе
            const bestScoreInDesign = this.getBestScore(item);
            if (bestScoreInDesign > group.bestScore) {
                group.bestScore = bestScoreInDesign;
                group.bestPair = this.getBestPair(item);
            }
            
            group.totalPairs += item.results_count || item.results?.length || 0;
        }
        
        // Вычисляем средние
        for (const group of groups.values()) {
            group.avgScore = group.designCount > 0 
                ? Math.round(group.designs.reduce((sum, d) => sum + this.getBestScore(d), 0) / group.designCount)
                : 0;
            group.avgPairs = group.designCount > 0 
                ? Math.round(group.totalPairs / group.designCount)
                : 0;
        }
        
        return Array.from(groups.values());
    }
    
    /**
     * Группировка по гену (если удалось определить)
     */
    groupByGene(history) {
        const groups = new Map();
        
        for (const item of history) {
            const geneName = this.extractGeneName(item) || 'Неизвестный ген';
            const geneKey = geneName.toLowerCase();
            
            if (!groups.has(geneKey)) {
                groups.set(geneKey, {
                    geneName: geneName,
                    sequences: [],
                    designCount: 0,
                    totalPairs: 0,
                    bestScore: 0,
                    avgScore: 0,
                    lastDesign: item.timestamp
                });
            }
            
            const group = groups.get(geneKey);
            group.designCount++;
            group.totalPairs += item.results_count || item.results?.length || 0;
            
            const bestScore = this.getBestScore(item);
            if (bestScore > group.bestScore) {
                group.bestScore = bestScore;
            }
            
            group.lastDesign = Math.max(group.lastDesign, item.timestamp);
        }
        
        for (const group of groups.values()) {
            group.avgScore = Math.round(group.designCount > 0 ? group.totalScore / group.designCount : 0);
            group.avgPairs = Math.round(group.totalPairs / group.designCount);
        }
        
        return Array.from(groups.values());
    }
    
    getSequenceHash(sequence) {
        // Используем первые 100 символов как идентификатор
        return sequence.substring(0, 100);
    }
    
    getSequencePreview(sequence) {
        if (sequence.length <= 60) return sequence;
        return sequence.substring(0, 40) + '...' + sequence.slice(-20);
    }
    
    extractGeneName(item) {
        // Пытаемся извлечь имя гена из разных источников
        if (item.geneName) return item.geneName;
        if (item.parameters?.gene) return item.parameters.gene;
        
        // Проверяем последовательность на известные гены
        const knownGenes = {
            'ATGGAGGAGCCGCAGTCAGATCCTAGCGTCGAGCCCCCTCTGAGTCAGGAAACATTTTCAGACCTATGGAAACTACTTCCTGAAAACAACGTTCTGTCCCCCTTGCCGTCCCAAGCAATGGATGATTTGATGCTGTCCCCGGACGATATTGAACAATGGTTCACTGAAGACCCAGGTCCAGATGAAGCTCCCAGAATGCCAGAGGCTGCTCCCCGCGTGGCCCCTGCACCAGCAGCTCCTACACCGGCGGCCCCTGCACCAGCCCCCTCCTGGCCCCTGTCATCTTCTGTCCCTTCCCAGAAAACCTACCAGGGCAGCTACGGTTTCCGTCTGGGCTTCTTGCATTCTGGGACAGCCAAGTCTGTGACTTGCACGTACTCCCCTGCCCTCAACAAGATGTTTTGCCAACTGGCCAAGACCTGCCCTGTGCAGCTGTGGGTTGATTCCACACCCCCGCCCGGCACCCGCGTCCGCGCCATGGCCATCTACAAGCAGTCACAGCACATGACGGAGGTTGTGAGGCGCTGCCCCCACCATGAGCGCTGCTCAGATAGCGATGGTCTGGCCCCTCCTCAGCATCTTATCCGAGTGGAAGGAAATTTGCGTGTGGAGTATTTGGATGACAGAAACACTTTTCGACATAGTGTGGTGGTGCCCTATGAGCCGCCTGAGGTTGGCTCTGACTGTACCACCATCCACTACAACTACATGTGTAACAGTTCCTGCATGGGCGGCATGAACCGGAGGCCCATCCTCACCATCATCACACTGGAAGACTCCAGTGGTAATCTACTGGGACGGAACAGCTTTGAGGTGCGTGTTTGTGCCTGTCCTGGGAGAGACCGGCGCACAGAGGAAGAGAATCTCCGCAAGAAAGGGGAGCCTCACCACGAGCTGCCCCCAGGGAGCACTAAGCGAGCACTGCCCAACAACACCAGCTCCTCTCCCCAGCCAAAGAAGAAACCACTGGATGGAGAATATTTCACCCTTCAGATCCGTGGGCGTGAGCGCTTCGAGATGTTCCGAGAGCTGAATGAGGCCTTGGAACTCAAGGATGCCCAGGCTGGGAAGGAGCCAGGGGGGAGCAGGGCTCACTCCAGCCACCTGAAGTCCAAAAAGGGTCAGTCTACCTCCCGCCATAAAAAACTCATGTTCAAGACAGAAGGGCCTGACTCAGACTGA':
                return 'TP53',
            // Добавить другие известные гены
        };
        
        for (const [pattern, name] of Object.entries(knownGenes)) {
            if (item.sequence.includes(pattern)) {
                return name;
            }
        }
        
        return null;
    }
    
    getBestScore(item) {
        if (item.best_score) return item.best_score;
        if (item.results?.length) {
            const scores = item.results.map(r => r.totalScore).filter(s => s);
            return scores.length ? Math.max(...scores) : 0;
        }
        return 0;
    }
    
    getBestPair(item) {
        if (!item.results?.length) return null;
        return item.results.reduce((best, current) => 
            (current.totalScore > best.totalScore) ? current : best, item.results[0]);
    }
}

// Обновляем функцию отображения истории
async function renderHistory() {
    const history = await storage.get('history') || [];
    const groupBy = document.getElementById('history-group-by')?.value || 'sequence';
    const stats = new HistoryGroupStats();
    
    let groups = [];
    if (groupBy === 'sequence') {
        groups = stats.groupBySequence(history);
    } else if (groupBy === 'gene') {
        groups = stats.groupByGene(history);
    }
    
    // Сортируем группы
    const sortBy = document.getElementById('history-sort')?.value || 'date-desc';
    groups.sort((a, b) => {
        if (sortBy === 'best-score') return b.bestScore - a.bestScore;
        if (sortBy === 'most-pairs') return b.totalPairs - a.totalPairs;
        return b.lastDesign - a.lastDesign;
    });
    
    // Отображаем статистику по группам
    renderGroupStats(groups, groupBy);
    
    // Отображаем список групп
    renderGroupList(groups, groupBy);
}

function renderGroupStats(groups, groupBy) {
    const statsContainer = document.getElementById('history-group-stats');
    if (!statsContainer) return;
    
    if (groups.length === 0) {
        statsContainer.innerHTML = '<div class="empty-state">Нет данных</div>';
        return;
    }
    
    const totalDesigns = groups.reduce((sum, g) => sum + g.designCount, 0);
    const avgScore = Math.round(groups.reduce((sum, g) => sum + g.avgScore, 0) / groups.length);
    const bestOverallScore = Math.max(...groups.map(g => g.bestScore));
    const totalPairs = groups.reduce((sum, g) => sum + g.totalPairs, 0);
    
    statsContainer.innerHTML = `
        <div class="group-stats-grid">
            <div class="stat-card">
                <div class="stat-value">${groups.length}</div>
                <div class="stat-label">${groupBy === 'sequence' ? 'Уникальных последовательностей' : 'Генов'}</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${totalDesigns}</div>
                <div class="stat-label">Всего дизайнов</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${bestOverallScore}</div>
                <div class="stat-label">Лучшая оценка</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${Math.round(totalPairs / groups.length)}</div>
                <div class="stat-label">Ср. пар на группу</div>
            </div>
        </div>
    `;
}

function renderGroupList(groups, groupBy) {
    const container = document.getElementById('history-list');
    if (!container) return;
    
    if (groups.length === 0) {
        container.innerHTML = '<div class="empty-state">Нет записей</div>';
        return;
    }
    
    let html = '';
    for (const group of groups) {
        if (groupBy === 'sequence') {
            html += renderSequenceGroup(group);
        } else if (groupBy === 'gene') {
            html += renderGeneGroup(group);
        }
    }
    
    container.innerHTML = html;
    
    // Добавляем обработчики для групп
    container.querySelectorAll('.history-group').forEach(groupEl => {
        groupEl.addEventListener('click', () => {
            groupEl.classList.toggle('expanded');
        });
        
        const loadBtn = groupEl.querySelector('.load-group-btn');
        if (loadBtn) {
            loadBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const sequence = groupEl.dataset.sequence;
                if (sequence) {
                    loadSequenceToDesign(sequence);
                }
            });
        }
    });
}

function renderSequenceGroup(group) {
    const dateRange = getDateRange(group.firstDesign, group.lastDesign);
    
    return `
        <div class="history-group sequence-group" data-sequence="${escapeHtml(group.sequence)}">
            <div class="group-header">
                <div class="group-title">
                    <span class="group-icon">🧬</span>
                    <span class="group-name">${escapeHtml(group.sequencePreview)}</span>
                    ${group.geneName ? `<span class="group-gene">(${escapeHtml(group.geneName)})</span>` : ''}
                </div>
                <div class="group-stats">
                    <span class="stat-badge">📊 ${group.designCount} дизайнов</span>
                    <span class="stat-badge">🎯 Лучший: ${group.bestScore}</span>
                    <span class="stat-badge">🔬 Пар: ${group.avgPairs} ср.</span>
                    <span class="stat-badge">📅 ${dateRange}</span>
                </div>
                <div class="group-actions">
                    <button class="btn btn-small btn-outline load-group-btn">📂 Загрузить</button>
                    <button class="group-expand">▼</button>
                </div>
            </div>
            <div class="group-content" style="display: none;">
                <div class="group-details">
                    <div class="detail-row">
                        <strong>Длина:</strong> ${group.sequenceLength} нт
                        <strong>GC:</strong> ${calculateGC(group.sequence).toFixed(1)}%
                    </div>
                    <div class="best-pair">
                        <strong>🏆 Лучшая пара (оценка ${group.bestScore}):</strong>
                        <div class="primer-preview">
                            <code>F: ${group.bestPair?.forward?.sequence || '—'}</code>
                            <code>R: ${group.bestPair?.reverse?.sequence || '—'}</code>
                        </div>
                    </div>
                    <div class="design-list">
                        <strong>История дизайнов:</strong>
                        ${group.designs.map(d => renderDesignItemCompact(d)).join('')}
                    </div>
                </div>
            </div>
        </div>
    `;
}

function renderGeneGroup(group) {
    return `
        <div class="history-group gene-group">
            <div class="group-header">
                <div class="group-title">
                    <span class="group-icon">🧬</span>
                    <span class="group-name">${escapeHtml(group.geneName)}</span>
                </div>
                <div class="group-stats">
                    <span class="stat-badge">🎯 Лучший: ${group.bestScore}</span>
                    <span class="stat-badge">📊 ${group.designCount} дизайнов</span>
                    <span class="stat-badge">🔬 ${Math.round(group.avgPairs)} пар ср.</span>
                </div>
                <div class="group-actions">
                    <button class="btn btn-small btn-outline explore-gene-btn">🔍 Исследовать</button>
                    <button class="group-expand">▼</button>
                </div>
            </div>
            <div class="group-content" style="display: none;">
                <div class="group-details">
                    <div class="sequence-list">
                        ${group.sequences.map(seq => `
                            <div class="sequence-item" data-seq="${escapeHtml(seq)}">
                                <code>${escapeHtml(seq.substring(0, 50))}...</code>
                                <button class="btn btn-small load-seq-btn">Загрузить</button>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        </div>
    `;
}

function renderDesignItemCompact(design) {
    const date = new Date(design.timestamp).toLocaleDateString();
    const time = new Date(design.timestamp).toLocaleTimeString();
    const bestScore = design.best_score || 
        (design.results?.length ? Math.max(...design.results.map(r => r.totalScore)) : 0);
    const pairsCount = design.results_count || design.results?.length || 0;
    
    return `
        <div class="design-item">
            <div class="design-date">${date} ${time}</div>
            <div class="design-stats">
                <span>⭐ ${bestScore}</span>
                <span>🔬 ${pairsCount} пар</span>
            </div>
            <div class="design-params">
                Tm: ${design.parameters?.tm || '—'}°C | GC: ${design.parameters?.gc || '—'}% | L: ${design.parameters?.length || '—'}
            </div>
            <button class="btn btn-small load-design-btn" data-id="${design.id}">Загрузить</button>
        </div>
    `;
}
💾 Реорганизация вкладки "Сохраненные"
html
<!-- В popup.html обновить вкладку сохраненных -->
<div class="tab-pane" id="tab-saved">
    <div class="saved-toolbar">
        <div class="saved-filters">
            <input type="search" id="saved-search" placeholder="🔍 Поиск по названию, последовательности...">
            <select id="saved-group-by">
                <option value="none">Без группировки</option>
                <option value="gene">По гену</option>
                <option value="score">По оценке</option>
                <option value="date">По дате</option>
            </select>
            <select id="saved-sort">
                <option value="date-desc">Новые сначала</option>
                <option value="score-desc">По оценке ↓</option>
                <option value="name-asc">По названию</option>
            </select>
        </div>
        <div class="saved-actions">
            <button type="button" id="saved-export" class="btn btn-small btn-outline">📤 Экспорт</button>
            <button type="button" id="saved-compare" class="btn btn-small btn-outline">🔬 Сравнить</button>
        </div>
    </div>
    
    <div id="saved-stats" class="saved-stats"></div>
    <div id="saved-list" class="saved-list-scroll"></div>
</div>
javascript
// Функция группировки сохраненных
function groupSavedPrimers(saved, groupBy) {
    if (groupBy === 'gene') {
        const groups = new Map();
        for (const item of saved) {
            const geneName = detectGeneFromSequence(item.pair.forward.sequence) || 'Другие гены';
            if (!groups.has(geneName)) {
                groups.set(geneName, {
                    geneName: geneName,
                    primers: [],
                    bestScore: 0,
                    avgScore: 0,
                    count: 0
                });
            }
            const group = groups.get(geneName);
            group.primers.push(item);
            group.count++;
            const score = item.pair.totalScore;
            group.bestScore = Math.max(group.bestScore, score);
            group.avgScore = ((group.avgScore * (group.count - 1)) + score) / group.count;
        }
        return Array.from(groups.values());
    } else if (groupBy === 'score') {
        const groups = {
            excellent: { name: 'Отличные (90-100)', primers: [], minScore: 90 },
            good: { name: 'Хорошие (70-89)', primers: [], minScore: 70 },
            acceptable: { name: 'Приемлемые (50-69)', primers: [], minScore: 50 },
            poor: { name: 'Требуют оптимизации (<50)', primers: [], minScore: 0 }
        };
        
        for (const item of saved) {
            const score = item.pair.totalScore;
            if (score >= 90) groups.excellent.primers.push(item);
            else if (score >= 70) groups.good.primers.push(item);
            else if (score >= 50) groups.acceptable.primers.push(item);
            else groups.poor.primers.push(item);
        }
        
        return Object.values(groups).filter(g => g.primers.length > 0);
    }
    
    return null;
}

function renderSavedPrimers() {
    const saved = await storage.get('savedPrimers') || [];
    const groupBy = document.getElementById('saved-group-by')?.value || 'none';
    const groups = groupSavedPrimers(saved, groupBy);
    
    if (groups) {
        // Отображаем сгруппированный список
        renderGroupedSaved(groups);
    } else {
        // Отображаем обычный список
        renderSimpleSaved(saved);
    }
}

function renderGroupedSaved(groups) {
    const container = document.getElementById('saved-list');
    let html = '';
    
    for (const group of groups) {
        html += `
            <div class="saved-group">
                <div class="saved-group-header">
                    <span class="group-title">${escapeHtml(group.geneName || group.name)}</span>
                    <span class="group-stats">
                        ${group.count} праймеров | Лучший: ${Math.round(group.bestScore)} | Средний: ${Math.round(group.avgScore)}
                    </span>
                    <button class="group-expand">▼</button>
                </div>
                <div class="saved-group-content">
                    ${group.primers.map(item => renderSavedItemDetailed(item)).join('')}
                </div>
            </div>
        `;
    }
    
    container.innerHTML = html;
    
    // Добавляем обработчики раскрытия
    container.querySelectorAll('.saved-group-header').forEach(header => {
        header.addEventListener('click', () => {
            const content = header.nextElementSibling;
            const isExpanded = content.style.display !== 'none';
            content.style.display = isExpanded ? 'none' : 'block';
            header.querySelector('.group-expand').textContent = isExpanded ? '▼' : '▲';
        });
    });
}

function renderSavedItemDetailed(item) {
    const pair = item.pair;
    const scoreClass = getScoreClass(pair.totalScore);
    
    return `
        <div class="saved-item-detailed" data-saved-id="${item.id}">
            <div class="saved-item-header">
                <div class="saved-name">${escapeHtml(item.name)}</div>
                <div class="saved-grade ${scoreClass}">${pair.grade?.letter || '—'} (${pair.totalScore || '—'})</div>
            </div>
            <div class="saved-primers">
                <div class="primer-box forward">
                    <div class="primer-label">Forward (5' → 3')</div>
                    <div class="primer-sequence">${pair.forward.sequence}</div>
                    <div class="primer-stats">
                        <span>Tm: ${pair.forward.details?.tm?.value?.toFixed(1)}°C</span>
                        <span>GC: ${pair.forward.details?.gc?.value?.toFixed(1)}%</span>
                        <span>Позиция: ${pair.forward.start}-${pair.forward.end}</span>
                    </div>
                </div>
                <div class="primer-box reverse">
                    <div class="primer-label">Reverse (3' ← 5')</div>
                    <div class="primer-sequence">${pair.reverse.sequence}</div>
                    <div class="primer-stats">
                        <span>Tm: ${pair.reverse.details?.tm?.value?.toFixed(1)}°C</span>
                        <span>GC: ${pair.reverse.details?.gc?.value?.toFixed(1)}%</span>
                        <span>Позиция: ${pair.reverse.start}-${pair.reverse.end}</span>
                    </div>
                </div>
            </div>
            <div class="saved-product-info">
                <span>Продукт ПЦР: ${pair.reverse.end - pair.forward.start} п.н.</span>
                ${pair.warnings?.length ? `<span class="warning-badge">⚠️ ${pair.warnings[0]}</span>` : ''}
            </div>
            <div class="saved-actions">
                <button class="action-btn saved-open-btn" data-pair='${JSON.stringify(pair)}'>📂 Открыть</button>
                <button class="action-btn copy-btn" data-seq="${pair.forward.sequence}">📋 Fwd</button>
                <button class="action-btn copy-btn" data-seq="${pair.reverse.sequence}">📋 Rev</button>
                <button class="action-btn saved-feedback-btn" data-pair='${JSON.stringify(pair)}'>📝 Отзыв</button>
                <button class="action-btn delete saved-delete-btn">🗑️</button>
            </div>
        </div>
    `;
}

function getScoreClass(score) {
    if (score >= 90) return 'score-excellent';
    if (score >= 70) return 'score-good';
    if (score >= 50) return 'score-acceptable';
    return 'score-poor';
}
📈 Добавляем CSS для новой группировки
css
/* В popup.css добавить */

/* Группировка в истории */
.history-group {
    margin-bottom: 16px;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    background: #fff;
    overflow: hidden;
    transition: all 0.2s;
}

.history-group:hover {
    border-color: #cbd5e1;
    box-shadow: 0 2px 8px rgba(0,0,0,0.05);
}

.group-header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: #f8fafc;
    cursor: pointer;
    gap: 8px;
}

.group-title {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 200px;
}

.group-icon {
    font-size: 20px;
}

.group-name {
    font-family: monospace;
    font-size: 13px;
    font-weight: 600;
    color: #1e293b;
    word-break: break-all;
}

.group-gene {
    font-size: 11px;
    color: #3b82f6;
    background: #dbeafe;
    padding: 2px 6px;
    border-radius: 12px;
}

.group-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
}

.stat-badge {
    font-size: 11px;
    padding: 2px 8px;
    background: #f1f5f9;
    border-radius: 12px;
    color: #475569;
}

.group-actions {
    display: flex;
    gap: 8px;
    align-items: center;
}

.group-expand {
    border: none;
    background: none;
    font-size: 12px;
    color: #64748b;
    cursor: pointer;
    padding: 4px;
}

.group-content {
    padding: 16px;
    border-top: 1px solid #e2e8f0;
    background: #fff;
}

.group-details {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.detail-row {
    display: flex;
    gap: 20px;
    font-size: 13px;
    color: #475569;
}

.best-pair {
    padding: 10px;
    background: #f0fdf4;
    border-radius: 8px;
    border-left: 3px solid #22c55e;
}

.primer-preview {
    margin-top: 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-family: monospace;
    font-size: 12px;
}

.design-list {
    max-height: 300px;
    overflow-y: auto;
}

.design-item {
    padding: 10px;
    border-bottom: 1px solid #f1f5f9;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
}

.design-item:hover {
    background: #f8fafc;
}

.design-date {
    font-size: 11px;
    color: #64748b;
    min-width: 100px;
}

.design-stats {
    display: flex;
    gap: 12px;
    font-size: 12px;
}

.design-params {
    font-size: 11px;
    color: #94a3b8;
}

/* Статистика групп */
.group-stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 12px;
    margin-bottom: 20px;
}

.stat-card {
    background: linear-gradient(135deg, #f8fafc 0%, #fff 100%);
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 12px;
    text-align: center;
}

.stat-value {
    font-size: 28px;
    font-weight: 700;
    color: #1e293b;
}

.stat-label {
    font-size: 11px;
    color: #64748b;
    margin-top: 4px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
}

/* Оценки */
.score-excellent {
    background: #22c55e20;
    color: #166534;
    border-color: #22c55e;
}

.score-good {
    background: #3b82f620;
    color: #1e40af;
    border-color: #3b82f6;
}

.score-acceptable {
    background: #eab30820;
    color: #854d0e;
    border-color: #eab308;
}

.score-poor {
    background: #ef444420;
    color: #991b1b;
    border-color: #ef4444;
}
🎯 Итоговые улучшения
Что было	Что стало
Агрегированная статистика по всей истории	Группировка по последовательности/гену - видно реальную картину
Непонятные цифры "Средняя оценка 90"	Статистика внутри группы - оценка для конкретной последовательности
Список дизайнов без контекста	Детальная информация о группе - лучшая пара, количество дизайнов, тренды
Сохраненные праймеры в плоском списке	Группировка по гену/оценке - легко находить лучшие варианты
Теперь биолог видит:

✅ Какая последовательность дала лучшие результаты

✅ Для TP53 лучший дизайн был с оценкой 92

✅ Для ACTB в среднем 88, но есть 3 варианта

✅ Последний дизайн TP53 был 2 дня назад, нужно обновить