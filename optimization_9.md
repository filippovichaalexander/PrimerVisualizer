







Анализ и улучшение вкладки "Избранное"
Отличный вопрос! Действительно, текущее отображение статистики в избранном может быть значительно улучшено для практического использования биологами. Давайте разберем, что важно и как это структурировать.

🔍 Проблемы текущего подхода
Смешанная статистика - "Средняя оценка: " без числа (пусто)

Нет группировки по важным критериям - биологу нужны праймеры по конкретным генам/участкам

Отсутствие контекста - непонятно, для какой последовательности подобраны праймеры

Нет истории использования - когда и для чего использовался праймер

🏆 Новая структура вкладки "Избранное"
1. Группировка по последовательности (как в истории)
javascript
// В history-group-stats.js добавить функцию группировки избранного
groupFavoritesBySequence(favorites) {
    const groups = new Map();
    
    for (const item of favorites) {
        // Используем sequence из записи или определяем по праймерам
        const seq = item.sequence || this.inferSequenceFromPrimers(item.pair);
        const seqHash = this.getSequenceHash(seq);
        const seqPreview = this.getSequencePreview(seq);
        
        if (!groups.has(seqHash)) {
            groups.set(seqHash, {
                sequence: seq,
                sequencePreview: seqPreview,
                sequenceLength: seq.length,
                geneName: this.extractGeneName({ sequence: seq, geneName: item.geneName }),
                accession: item.accession || '',
                favorites: [],
                firstAdded: item.timestamp,
                lastAdded: item.timestamp,
                bestScore: 0,
                bestPair: null,
                avgScore: 0,
                count: 0,
                hasFeedback: false,
                mostUsedParams: { tm: [], gc: [], length: [] }
            });
        }
        
        const group = groups.get(seqHash);
        group.favorites.push(item);
        group.count++;
        group.lastAdded = Math.max(group.lastAdded, item.timestamp);
        group.firstAdded = Math.min(group.firstAdded, item.timestamp);
        
        const score = item.pair?.totalScore || 0;
        if (score > group.bestScore) {
            group.bestScore = score;
            group.bestPair = item.pair;
        }
        
        if (item.feedback) group.hasFeedback = true;
        
        // Собираем статистику по параметрам
        if (item.pair) {
            group.mostUsedParams.tm.push(item.pair.forward?.details?.tm?.value || 0);
            group.mostUsedParams.gc.push(item.pair.forward?.details?.gc?.value || 0);
            group.mostUsedParams.length.push(item.pair.forward?.sequence?.length || 0);
        }
    }
    
    // Вычисляем средние
    for (const group of groups.values()) {
        group.avgScore = Math.round(group.favorites.reduce((sum, f) => 
            sum + (f.pair?.totalScore || 0), 0) / group.count);
        
        // Находим наиболее частые параметры
        group.mostUsedParams.tm = this.getMostFrequent(group.mostUsedParams.tm);
        group.mostUsedParams.gc = this.getMostFrequent(group.mostUsedParams.gc);
        group.mostUsedParams.length = this.getMostFrequent(group.mostUsedParams.length);
    }
    
    return Array.from(groups.values());
}

inferSequenceFromPrimers(pair) {
    // Если нет сохраненной последовательности, пытаемся восстановить по позициям
    // или возвращаем пустую строку
    return pair?.forward?.sequence ? 
        `[Последовательность не сохранена, но праймер: ${pair.forward.sequence.substring(0, 20)}...]` : '';
}
2. Расширенная карточка элемента избранного
javascript
function buildEnhancedFavoriteCard(item, groupContext = null) {
    const pair = item.pair || {};
    const f = pair.forward || {};
    const r = pair.reverse || {};
    const grade = pair.grade || {};
    
    // Вычисляем дополнительные метрики
    const productSize = (r.end && f.start) ? (r.end - f.start) : '—';
    const tmDiff = Math.abs((f.details?.tm?.value || 0) - (r.details?.tm?.value || 0));
    const gcBalance = Math.abs((f.details?.gc?.value || 0) - (r.details?.gc?.value || 0));
    
    // Оценка качества для мультиплекса
    const multiplexScore = calculateMultiplexScore(pair);
    
    // Рекомендация по применению
    const application = getApplicationRecommendation(pair);
    
    const scoreClass = getScoreClass(pair.totalScore);
    const dateAdded = new Date(item.timestamp).toLocaleDateString();
    const dateAddedFull = new Date(item.timestamp).toLocaleString();
    
    return `
        <div class="favorite-item enhanced" data-favorite-id="${item.id}" data-sequence-hash="${item.sequenceHash || ''}">
            <div class="favorite-header">
                <div class="favorite-title">
                    <span class="favorite-name">${escapeHtml(item.name)}</span>
                    ${item.feedback ? '<span class="feedback-badge" title="Есть отзыв">📝</span>' : ''}
                    ${item.fromHistory ? '<span class="history-badge" title="Из истории дизайнов">📜</span>' : ''}
                </div>
                <div class="favorite-grade ${scoreClass}">
                    ${grade.letter || '—'} (${pair.totalScore || '—'})
                </div>
            </div>
            
            <div class="favorite-primers">
                <div class="primer-card forward">
                    <div class="primer-direction">5' → 3'</div>
                    <div class="primer-sequence">${escapeHtml(formatSequence(f.sequence || ''))}</div>
                    <div class="primer-metrics">
                        <span class="metric">Tm: ${f.details?.tm?.value?.toFixed(1) || 'N/A'}°C</span>
                        <span class="metric">GC: ${f.details?.gc?.value?.toFixed(1) || 'N/A'}%</span>
                        <span class="metric">Длина: ${f.sequence?.length || 0} нт</span>
                        <span class="metric">Позиция: ${f.start || '?'}-${f.end || '?'}</span>
                    </div>
                    ${f.details?.self_any_th > 45 ? '<div class="warning-badge">⚠️ Риск шпилек</div>' : ''}
                </div>
                
                <div class="primer-card reverse">
                    <div class="primer-direction">3' ← 5'</div>
                    <div class="primer-sequence">${escapeHtml(formatSequence(r.sequence || ''))}</div>
                    <div class="primer-metrics">
                        <span class="metric">Tm: ${r.details?.tm?.value?.toFixed(1) || 'N/A'}°C</span>
                        <span class="metric">GC: ${r.details?.gc?.value?.toFixed(1) || 'N/A'}%</span>
                        <span class="metric">Длина: ${r.sequence?.length || 0} нт</span>
                        <span class="metric">Позиция: ${r.start || '?'}-${r.end || '?'}</span>
                    </div>
                    ${r.details?.self_any_th > 45 ? '<div class="warning-badge">⚠️ Риск шпилек</div>' : ''}
                </div>
            </div>
            
            <div class="favorite-metrics">
                <div class="metrics-row">
                    <div class="metric-item">
                        <span class="metric-label">Продукт ПЦР:</span>
                        <span class="metric-value">${productSize} п.н.</span>
                    </div>
                    <div class="metric-item">
                        <span class="metric-label">ΔTm:</span>
                        <span class="metric-value ${tmDiff > 3 ? 'warning' : ''}">${tmDiff.toFixed(1)}°C</span>
                    </div>
                    <div class="metric-item">
                        <span class="metric-label">ΔGC:</span>
                        <span class="metric-value ${gcBalance > 10 ? 'warning' : ''}">${gcBalance.toFixed(1)}%</span>
                    </div>
                    <div class="metric-item">
                        <span class="metric-label">GC-clamp:</span>
                        <span class="metric-value">${checkGCClamp(f.sequence) ? '✅ Есть' : '❌ Нет'}</span>
                    </div>
                </div>
                
                <div class="metrics-row">
                    <div class="metric-item">
                        <span class="metric-label">Мультиплекс-совместимость:</span>
                        <span class="metric-value ${multiplexScore >= 70 ? 'good' : 'warning'}">${multiplexScore}%</span>
                    </div>
                    <div class="metric-item">
                        <span class="metric-label">Рекомендация:</span>
                        <span class="metric-value">${application}</span>
                    </div>
                </div>
            </div>
            
            ${pair.warnings?.length ? `
                <div class="favorite-warnings">
                    ${pair.warnings.slice(0, 3).map(w => `<div class="warning">⚠️ ${escapeHtml(w)}</div>`).join('')}
                </div>
            ` : ''}
            
            <div class="favorite-actions">
                <div class="action-group">
                    <button class="action-btn small favorite-open-btn" data-favorite-id="${item.id}">📂 Открыть</button>
                    <button class="action-btn copy-btn favorite-copy-fwd" data-seq="${f.sequence || ''}">📋 Fwd</button>
                    <button class="action-btn copy-btn favorite-copy-rev" data-seq="${r.sequence || ''}">📋 Rev</button>
                    <button class="action-btn favorite-feedback-btn" data-favorite-id="${item.id}">📝 Отзыв</button>
                </div>
                <div class="action-group">
                    <button class="action-btn small favorite-export-json" data-favorite-id="${item.id}">💾 Экспорт</button>
                    <button class="action-btn small delete favorite-delete-btn" data-favorite-id="${item.id}">🗑️</button>
                </div>
            </div>
            
            <div class="favorite-footer">
                <span class="footer-meta">Добавлен: ${dateAddedFull}</span>
                ${groupContext ? `
                    <span class="footer-meta">Группа: ${escapeHtml(groupContext.geneName || 'Другие')}</span>
                    <span class="footer-meta">Всего в группе: ${groupContext.count}</span>
                ` : ''}
                ${item.notes ? `<span class="footer-meta user-note">📌 ${escapeHtml(item.notes.substring(0, 100))}</span>` : ''}
            </div>
        </div>
    `;
}

// Вспомогательные функции
function calculateMultiplexScore(pair) {
    // Оценка пригодности для мультиплексной ПЦР
    let score = 100;
    const f = pair.forward || {};
    const r = pair.reverse || {};
    
    const tmDiff = Math.abs((f.details?.tm?.value || 0) - (r.details?.tm?.value || 0));
    if (tmDiff > 3) score -= tmDiff * 2;
    
    const gcDiff = Math.abs((f.details?.gc?.value || 0) - (r.details?.gc?.value || 0));
    if (gcDiff > 10) score -= gcDiff;
    
    if (!checkGCClamp(f.sequence)) score -= 10;
    if (!checkGCClamp(r.sequence)) score -= 10;
    
    return Math.max(0, Math.min(100, Math.round(score)));
}

function getApplicationRecommendation(pair) {
    const score = pair.totalScore || 0;
    const fTm = pair.forward?.details?.tm?.value || 0;
    const rTm = pair.reverse?.details?.tm?.value || 0;
    const productSize = (pair.reverse?.end || 0) - (pair.forward?.start || 0);
    
    if (score >= 90 && Math.abs(fTm - rTm) <= 1) {
        return '🏆 Идеально для qPCR / мультиплекса';
    }
    if (score >= 80 && productSize >= 100 && productSize <= 300) {
        return '✅ Рекомендуется для стандартной ПЦР';
    }
    if (score >= 70) {
        return '⚠️ Требует проверки, возможна оптимизация';
    }
    if (productSize > 500) {
        return '📏 Длинный продукт (>500 п.н.) - для клонирования';
    }
    if (productSize < 80) {
        return '🔬 Короткий продукт (<80 п.н.) - для qPCR';
    }
    return '🧪 Требуется тестирование';
}

function checkGCClamp(sequence) {
    if (!sequence || sequence.length < 3) return false;
    const lastThree = sequence.slice(-3);
    return /[GC]/.test(lastThree);
}

function getScoreClass(score) {
    if (score >= 90) return 'score-excellent';
    if (score >= 70) return 'score-good';
    if (score >= 50) return 'score-acceptable';
    return 'score-poor';
}
3. Статистика группы избранного
javascript
function renderFavoriteGroupStats(group) {
    return `
        <div class="favorite-group-stats">
            <div class="stats-header">
                <div class="group-info">
                    <span class="group-icon">🧬</span>
                    <span class="group-name">${escapeHtml(group.geneName || group.sequencePreview.substring(0, 50))}</span>
                    ${group.accession ? `<span class="group-accession">(${escapeHtml(group.accession)})</span>` : ''}
                </div>
                <div class="group-metrics">
                    <div class="metric">
                        <span class="metric-label">В избранном:</span>
                        <span class="metric-value">${group.count} вариантов</span>
                    </div>
                    <div class="metric">
                        <span class="metric-label">Лучший:</span>
                        <span class="metric-value">${group.bestScore}</span>
                    </div>
                    <div class="metric">
                        <span class="metric-label">Средний:</span>
                        <span class="metric-value">${group.avgScore}</span>
                    </div>
                </div>
            </div>
            
            <div class="stats-details">
                <div class="detail-row">
                    <span class="detail-label">Длина последовательности:</span>
                    <span class="detail-value">${group.sequenceLength} нт</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Часто используемые параметры:</span>
                    <span class="detail-value">
                        Tm: ${group.mostUsedParams.tm || '—'}°C | 
                        GC: ${group.mostUsedParams.gc || '—'}% | 
                        Длина: ${group.mostUsedParams.length || '—'} нт
                    </span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Диапазон дат:</span>
                    <span class="detail-value">
                        ${new Date(group.firstAdded).toLocaleDateString()} — ${new Date(group.lastAdded).toLocaleDateString()}
                    </span>
                </div>
                ${group.bestPair ? `
                    <div class="best-pair-preview">
                        <span class="detail-label">🏆 Лучшая пара:</span>
                        <div class="best-pair-sequences">
                            <code>F: ${escapeHtml(group.bestPair.forward?.sequence?.substring(0, 30) || '')}...</code>
                            <code>R: ${escapeHtml(group.bestPair.reverse?.sequence?.substring(0, 30) || '')}...</code>
                        </div>
                    </div>
                ` : ''}
            </div>
        </div>
    `;
}
4. Сравнение праймеров внутри группы
javascript
function openFavoritesCompareModal(group) {
    const favorites = group.favorites;
    if (favorites.length < 2) {
        showWarning('В группе минимум 2 элемента для сравнения');
        return;
    }
    
    // Сортируем по оценке и берем топ-4 для сравнения
    const topFavorites = [...favorites]
        .sort((a, b) => (b.pair?.totalScore || 0) - (a.pair?.totalScore || 0))
        .slice(0, 4);
    
    const modal = document.createElement('div');
    modal.className = 'compare-modal';
    modal.innerHTML = `
        <div class="compare-modal-content">
            <div class="compare-header">
                <h3>🔬 Сравнение праймеров</h3>
                <span class="compare-gene">${escapeHtml(group.geneName || group.sequencePreview)}</span>
                <button class="compare-close">×</button>
            </div>
            <div class="compare-grid">
                ${topFavorites.map((fav, idx) => `
                    <div class="compare-card">
                        <div class="compare-rank">#${idx + 1}</div>
                        <div class="compare-name">${escapeHtml(fav.name)}</div>
                        <div class="compare-score ${getScoreClass(fav.pair?.totalScore)}">
                            ${fav.pair?.totalScore || '—'} (${fav.pair?.grade?.letter || '—'})
                        </div>
                        <div class="compare-primers">
                            <div class="compare-fwd">
                                <span class="label">F:</span>
                                <code>${escapeHtml(formatSequence(fav.pair?.forward?.sequence || ''))}</code>
                                <span class="tm">${fav.pair?.forward?.details?.tm?.value?.toFixed(1) || '—'}°C</span>
                            </div>
                            <div class="compare-rev">
                                <span class="label">R:</span>
                                <code>${escapeHtml(formatSequence(fav.pair?.reverse?.sequence || ''))}</code>
                                <span class="tm">${fav.pair?.reverse?.details?.tm?.value?.toFixed(1) || '—'}°C</span>
                            </div>
                        </div>
                        <div class="compare-metrics">
                            <div>Продукт: ${(fav.pair?.reverse?.end || 0) - (fav.pair?.forward?.start || 0)} п.н.</div>
                            <div>ΔTm: ${Math.abs((fav.pair?.forward?.details?.tm?.value || 0) - (fav.pair?.reverse?.details?.tm?.value || 0)).toFixed(1)}°C</div>
                            <div>GC-clamp: ${checkGCClamp(fav.pair?.forward?.sequence) ? '✅' : '❌'}</div>
                        </div>
                        <button class="btn btn-small select-btn" data-favorite-id="${fav.id}">Выбрать</button>
                    </div>
                `).join('')}
            </div>
            <div class="compare-footer">
                <button class="btn btn-primary" id="compare-close-btn">Закрыть</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Обработчики
    modal.querySelector('.compare-close').addEventListener('click', () => modal.remove());
    modal.querySelector('#compare-close-btn').addEventListener('click', () => modal.remove());
    modal.querySelectorAll('.select-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const favId = parseInt(btn.dataset.favoriteId);
            const fav = group.favorites.find(f => f.id === favId);
            if (fav?.pair) {
                // Загружаем выбранный праймер в редактор
                currentResults = [fav.pair];
                displayResults([fav.pair]);
                switchTab('design');
                modal.remove();
                showNotification(`✅ Загружен праймер: ${fav.name}`);
            }
        });
    });
}
5. Статистическая сводка по избранному
javascript
async function renderFavoriteStats() {
    const favorites = await storage.get('savedPrimers') || [];
    if (favorites.length === 0) return;
    
    const groups = groupFavoritesBySequence(favorites);
    
    const stats = {
        total: favorites.length,
        groups: groups.length,
        bestOverall: Math.max(...favorites.map(f => f.pair?.totalScore || 0)),
        avgOverall: Math.round(favorites.reduce((sum, f) => sum + (f.pair?.totalScore || 0), 0) / favorites.length),
        withFeedback: favorites.filter(f => f.feedback).length,
        byApplication: {
            qpcr: 0,
            standard: 0,
            cloning: 0,
            needsOptimization: 0
        }
    };
    
    // Классификация по применению
    favorites.forEach(f => {
        const rec = getApplicationRecommendation(f.pair);
        if (rec.includes('qPCR')) stats.byApplication.qpcr++;
        else if (rec.includes('клонирование')) stats.byApplication.cloning++;
        else if (rec.includes('стандартной')) stats.byApplication.standard++;
        else stats.byApplication.needsOptimization++;
    });
    
    return `
        <div class="favorites-stats-panel">
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">${stats.total}</div>
                    <div class="stat-label">всего праймеров</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${stats.groups}</div>
                    <div class="stat-label">уникальных последовательностей</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${stats.bestOverall}</div>
                    <div class="stat-label">лучшая оценка</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${stats.avgOverall}</div>
                    <div class="stat-label">средняя оценка</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${stats.withFeedback}</div>
                    <div class="stat-label">с отзывами</div>
                </div>
            </div>
            <div class="applications-stats">
                <div class="stats-title">📋 Рекомендуемое применение</div>
                <div class="app-bars">
                    <div class="app-bar" style="width: ${(stats.byApplication.qpcr / stats.total * 100)}%">
                        <span class="app-label">qPCR</span>
                        <span class="app-count">${stats.byApplication.qpcr}</span>
                    </div>
                    <div class="app-bar" style="width: ${(stats.byApplication.standard / stats.total * 100)}%">
                        <span class="app-label">Стандартная ПЦР</span>
                        <span class="app-count">${stats.byApplication.standard}</span>
                    </div>
                    <div class="app-bar" style="width: ${(stats.byApplication.cloning / stats.total * 100)}%">
                        <span class="app-label">Клонирование</span>
                        <span class="app-count">${stats.byApplication.cloning}</span>
                    </div>
                    <div class="app-bar warning" style="width: ${(stats.byApplication.needsOptimization / stats.total * 100)}%">
                        <span class="app-label">Требуют оптимизации</span>
                        <span class="app-count">${stats.byApplication.needsOptimization}</span>
                    </div>
                </div>
            </div>
        </div>
    `;
}
📊 Сравнение: Что было vs Что стало
Аспект	Было	Стало
Статистика	"Средняя оценка: " (пусто)	Полная статистика: лучшая, средняя, по группам, по применению
Группировка	По оценке/дате/гену	+ По последовательности (как в истории)
Карточка элемента	Базовая информация	+ Продукт ПЦР, ΔTm, ΔGC, GC-clamp, мультиплекс-совместимость, рекомендация по применению
Сравнение	Нет	Сравнение топ-4 праймеров в группе
Контекст	Нет	Информация о группе: длина последовательности, частые параметры, диапазон дат
Применение	Не определено	Автоматическая классификация (qPCR/клонирование/стандартная/оптимизация)
Визуализация	Текст	Цветовые индикаторы, прогресс-бары, значки
🎯 Ключевые метрики для биолога
Критически важные (должны быть всегда видны):
Продукт ПЦР - размер ампликона

ΔTm - разница температур плавления (должна быть < 3°C)

GC-clamp - наличие G/C на 3'-конце

Оценка качества - общая оценка (0-100)

Средне важные:
ΔGC - разница GC-состава

Мультиплекс-совместимость - пригодность для мультиплексной ПЦР

Риски - шпильки, димеры, повторы

История использования - когда и для чего использовался

Для исследования:
Сравнение с другими вариантами - какой праймер лучше

Группировка по последовательности - все варианты для одного гена

Рекомендация по применению - для каких целей подходит

Отзывы - опыт использования

💡 Дополнительные улучшения
1. Экспорт в форматы для лабораторных журналов
javascript
function exportFavoritesToLabJournal(favorites) {
    // Формат, удобный для вставки в Word/Excel
    const labFormat = favorites.map(f => ({
        'Название': f.name,
        'Forward (5\'→3\')': f.pair?.forward?.sequence,
        'Reverse (5\'→3\')': f.pair?.reverse?.sequence,
        'Tm F/R': `${f.pair?.forward?.details?.tm?.value?.toFixed(1)}/${f.pair?.reverse?.details?.tm?.value?.toFixed(1)}°C`,
        'Продукт': (f.pair?.reverse?.end - f.pair?.forward?.start) + ' п.н.',
        'Оценка': f.pair?.totalScore,
        'Рекомендация': getApplicationRecommendation(f.pair),
        'Дата добавления': new Date(f.timestamp).toLocaleDateString()
    }));
    // ... экспорт в Excel
}
2. Теги и категории
javascript
// Пользователь может добавлять свои теги
item.tags = ['qpcr', 'exon5', 'validated'];
3. Интеграция с PubMed
javascript
// Поиск публикаций, использующих этот праймер
async function searchPubMedForPrimer(primer) {
    const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${primer.sequence}&retmode=json`;
    // ...
}
🏁 Итог
Обновленная вкладка "Избранное" становится лабораторным журналом праймеров, где биолог может:

Быстро найти - по гену, применению, качеству

Сравнить - разные варианты для одного гена

Оценить - пригодность для конкретной задачи (qPCR/клонирование)

Отследить - историю использования и отзывы

Экспортировать - для публикации или лабораторной документации


// TODO
Экспорт «лабораторный журнал», теги, PubMed, отдельный экспорт Excel по этому формату.