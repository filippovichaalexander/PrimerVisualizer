Исправление проблем вкладки "Сохраненные"
Проблемы:
Кнопка "Открыть" не работает

Кнопка "Удалить" не работает

Нет кнопки "Назад" во вкладке

Кнопки Fwd/Rev/Отзыв не доступны в сохраненных

Исправление popup.js:
javascript
// В popup.js, найти функцию loadSavedPrimers и исправить:

async function loadSavedPrimers() {
    const saved = await storage.get('savedPrimers') || [];
    const container = document.getElementById('saved-list');

    if (saved.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">📭</span>
                <p>Нет сохранённых праймеров</p>
                <p class="saved-empty-hint">Сохранение — на вкладке <strong>Дизайн</strong>: после подбора праймеров у каждой пары нажмите <strong>💾 Сохранить</strong> в блоке результатов (центр).</p>
                <button type="button" class="btn btn-small btn-primary" onclick="switchTab('design')">Перейти к дизайну</button>
            </div>
        `;
        return;
    }

    let html = '';
    saved.sort((a, b) => b.timestamp - a.timestamp).forEach(item => {
        const date = new Date(item.timestamp).toLocaleDateString();
        const pair = item.pair;
        const pairJson = JSON.stringify(pair).replace(/</g, '&lt;').replace(/>/g, '&gt;');
        
        html += `
            <div class="saved-item" data-saved-id="${item.id}">
                <div class="saved-header">
                    <span class="saved-name">${escapeHtml(item.name)}</span>
                    <span class="saved-date">${date}</span>
                </div>
                <div class="saved-preview">
                    <div class="saved-grade" style="background: ${pair.grade?.color || '#94a3b8'}20; color: ${pair.grade?.color || '#94a3b8'}">
                        ${pair.grade?.letter || '—'} (${pair.totalScore || '—'})
                    </div>
                    <div class="saved-seqs">
                        <div class="saved-seq saved-forward">
                            <span class="seq-label">F:</span>
                            <code class="seq-code">${formatSequence(pair.forward.sequence)}</code>
                        </div>
                        <div class="saved-seq saved-reverse">
                            <span class="seq-label">R:</span>
                            <code class="seq-code">${formatSequence(pair.reverse.sequence)}</code>
                        </div>
                    </div>
                    <div class="saved-stats">
                        <span>Tm: ${pair.forward.details?.tm?.value?.toFixed(1) || 'N/A'}°C / ${pair.reverse.details?.tm?.value?.toFixed(1) || 'N/A'}°C</span>
                        <span>GC: ${pair.forward.details?.gc?.value?.toFixed(1) || 'N/A'}% / ${pair.reverse.details?.gc?.value?.toFixed(1) || 'N/A'}%</span>
                        <span>Продукт: ${pair.reverse.end - pair.forward.start} п.н.</span>
                    </div>
                    ${pair.warnings?.length ? `<div class="saved-warnings">⚠️ ${pair.warnings.slice(0, 2).join('; ')}</div>` : ''}
                </div>
                <div class="saved-actions">
                    <button class="action-btn small saved-open-btn" data-pair='${pairJson}' data-saved-id="${item.id}">
                        📂 Открыть
                    </button>
                    <button class="action-btn copy-btn saved-copy-fwd" data-seq="${pair.forward.sequence}">
                        📋 Fwd
                    </button>
                    <button class="action-btn copy-btn saved-copy-rev" data-seq="${pair.reverse.sequence}">
                        📋 Rev
                    </button>
                    <button class="action-btn saved-feedback-btn" data-pair='${pairJson}' data-saved-id="${item.id}">
                        📝 Отзыв
                    </button>
                    <button class="action-btn small delete saved-delete-btn" data-saved-id="${item.id}">
                        🗑️
                    </button>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;

    // Обработчики для сохраненных элементов
    container.querySelectorAll('.saved-open-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const pair = JSON.parse(btn.dataset.pair);
            const savedId = btn.dataset.savedId;
            
            // Загружаем пару в текущие результаты
            currentResults = [pair];
            
            // Переключаемся на вкладку дизайна
            switchTab('design');
            
            // Отображаем результаты
            displayResults([pair], { serverUnavailable: false, serverReturnedEmpty: false });
            setPanelRightAnalysisVisible(true);
            
            // Подсвечиваем загруженную пару
            setTimeout(() => {
                const cards = document.querySelectorAll('.result-card');
                if (cards.length) {
                    cards[0].classList.add('result-card-highlighted');
                    cards[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 100);
            
            showNotification(`✅ Загружен праймер: ${pair.grade?.letter || '—'} (${pair.totalScore || '—'})`);
        });
    });

    container.querySelectorAll('.saved-copy-fwd, .saved-copy-rev').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const seq = btn.dataset.seq;
            await navigator.clipboard.writeText(seq);
            const original = btn.textContent;
            btn.textContent = '✓ Скопировано';
            setTimeout(() => {
                btn.textContent = original;
            }, 1000);
            showNotification('📋 Последовательность скопирована');
        });
    });

    container.querySelectorAll('.saved-feedback-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const pair = JSON.parse(btn.dataset.pair);
            const savedId = btn.dataset.savedId;
            openFeedbackForPair(pair, savedId);
        });
    });

    container.querySelectorAll('.saved-delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const savedId = parseInt(btn.dataset.savedId);
            if (confirm('Удалить этот сохраненный праймер?')) {
                const saved = await storage.get('savedPrimers') || [];
                const filtered = saved.filter(i => i.id !== savedId);
                await storage.set('savedPrimers', filtered);
                await loadSavedPrimers();
                showNotification('🗑️ Праймер удален');
            }
        });
    });
}

// Функция escapeHtml для безопасности
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}
Добавляем кнопку "Назад" в интерфейс:
html
<!-- В popup.html, добавить после шапки или в нужном месте -->
<div class="navigation-bar" id="navigationBar" style="display: none;">
    <button type="button" class="btn btn-small btn-outline back-btn" id="backBtn">
        ← Назад
    </button>
</div>
javascript
// В popup.js добавить функцию навигации
function initNavigation() {
    const backBtn = document.getElementById('backBtn');
    const navBar = document.getElementById('navigationBar');
    
    // Показываем кнопку "Назад" только если есть история
    function updateNavigation() {
        const hasHistory = window.history.length > 1;
        navBar.style.display = hasHistory ? 'flex' : 'none';
    }
    
    backBtn.addEventListener('click', () => {
        // Возвращаемся к предыдущему состоянию
        if (window.history.length > 1) {
            window.history.back();
        } else {
            // Если нет истории, переключаемся на вкладку дизайна
            switchTab('design');
        }
    });
    
    // Обновляем при смене вкладок
    const observer = new MutationObserver(updateNavigation);
    observer.observe(document.querySelector('.tab-pane.active'), { attributes: true, attributeFilter: ['class'] });
    
    updateNavigation();
}
2. 📝 Реализация отзывов для праймеров
Добавляем функционал отзывов:
javascript
// В popup.js улучшаем функцию openFeedbackForPair
function openFeedbackForPair(pair, savedId = null) {
    const modal = document.createElement('div');
    modal.className = 'feedback-modal';
    modal.innerHTML = `
        <div class="feedback-modal-content">
            <div class="feedback-header">
                <h3>📝 Отзыв о праймере</h3>
                <button class="feedback-close">&times;</button>
            </div>
            <div class="feedback-primer-info">
                <div class="feedback-primer forward">
                    <strong>Forward:</strong>
                    <code>${pair.forward.sequence}</code>
                    <div class="primer-details">
                        Tm: ${pair.forward.details?.tm?.value?.toFixed(1) || 'N/A'}°C |
                        GC: ${pair.forward.details?.gc?.value?.toFixed(1) || 'N/A'}%
                    </div>
                </div>
                <div class="feedback-primer reverse">
                    <strong>Reverse:</strong>
                    <code>${pair.reverse.sequence}</code>
                    <div class="primer-details">
                        Tm: ${pair.reverse.details?.tm?.value?.toFixed(1) || 'N/A'}°C |
                        GC: ${pair.reverse.details?.gc?.value?.toFixed(1) || 'N/A'}%
                    </div>
                </div>
                <div class="feedback-score">
                    Оценка: ${pair.totalScore || '—'} (${pair.grade?.letter || '—'})
                </div>
            </div>
            <div class="feedback-form">
                <label for="feedback-result">Результат эксперимента:</label>
                <select id="feedback-result">
                    <option value="success">✅ Успешно (четкая амплификация)</option>
                    <option value="partial">⚠️ Частично (слабый сигнал)</option>
                    <option value="failed">❌ Неудачно (не амплифицируется)</option>
                    <option value="nonspecific">🎯 Неспецифично (несколько полос)</option>
                    <option value="optimized">✨ Требуется оптимизация</option>
                </select>
                
                <label for="feedback-notes">Комментарии (опционально):</label>
                <textarea id="feedback-notes" rows="4" placeholder="Напишите, как работал праймер, какие были сложности, примечания..."></textarea>
                
                <label class="checkbox">
                    <input type="checkbox" id="feedback-share">
                    <span>Поделиться анонимной статистикой (поможет улучшить алгоритм)</span>
                </label>
            </div>
            <div class="feedback-actions">
                <button class="btn btn-primary" id="submit-feedback">💾 Сохранить отзыв</button>
                <button class="btn btn-outline" id="cancel-feedback">Отмена</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    const closeModal = () => modal.remove();
    modal.querySelector('.feedback-close').addEventListener('click', closeModal);
    modal.querySelector('#cancel-feedback').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });
    
    modal.querySelector('#submit-feedback').addEventListener('click', async () => {
        const result = modal.querySelector('#feedback-result').value;
        const notes = modal.querySelector('#feedback-notes').value;
        const share = modal.querySelector('#feedback-share').checked;
        
        const feedback = {
            id: Date.now(),
            pairId: pair.id,
            savedId: savedId,
            forward: pair.forward.sequence,
            reverse: pair.reverse.sequence,
            forwardTm: pair.forward.details?.tm?.value,
            reverseTm: pair.reverse.details?.tm?.value,
            forwardGc: pair.forward.details?.gc?.value,
            reverseGc: pair.reverse.details?.gc?.value,
            score: pair.totalScore,
            grade: pair.grade?.letter,
            result: result,
            notes: notes,
            share: share,
            timestamp: Date.now(),
            date: new Date().toISOString()
        };
        
        // Сохраняем отзыв
        await storage.addFeedback(feedback);
        
        // Если есть сохраненный праймер, обновляем его с отзывом
        if (savedId) {
            const saved = await storage.get('savedPrimers') || [];
            const index = saved.findIndex(p => p.id === savedId);
            if (index !== -1) {
                saved[index].feedback = {
                    result: result,
                    notes: notes,
                    timestamp: Date.now()
                };
                await storage.set('savedPrimers', saved);
            }
        }
        
        // Обновляем статистику
        await storage.updateStats({ feedbackCount: 1 });
        
        showNotification('✅ Отзыв сохранен! Спасибо за обратную связь.');
        closeModal();
        
        // Если отзыв был на сохраненный праймер, обновляем список
        if (savedId) {
            await loadSavedPrimers();
        }
    });
}
3. 🎨 Исправление горизонтального скролла при hover
css
/* В popup.css добавить */
.overlap-card {
    padding: 12px;
    border-radius: 8px;
    border-left: 4px solid;
    transition: all 0.2s;
    overflow-x: hidden;  /* Предотвращает горизонтальный скролл */
    word-wrap: break-word; /* Перенос длинных слов */
}

.overlap-card:hover {
    transform: translateX(4px);
    box-shadow: 0 2px 4px rgba(0,0,0,0.05);
}

/* Ограничение ширины для длинных последовательностей */
.overlap-pairs {
    font-weight: 600;
    font-size: 13px;
    color: #1f2937;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* Для мобильных устройств */
@media (max-width: 768px) {
    .overlap-pairs {
        white-space: normal;
        word-break: break-word;
    }
}
4. 🔧 Активация локальных настроек для серверного режима
Проблема:
Сейчас настройки "Проверять шпильки", "Проверять димеры", "Проверять повторы" и другие помечены как data-mode="local" и скрываются в серверном режиме. Но эти проверки важны и в серверном режиме!

Решение: Изменить логику - отправлять эти настройки на сервер
javascript
// В design-flow.js, в функции designWithServer добавить отправку этих настроек

async function designWithServer(sequence, params) {
    const advancedSettings = getAdvancedSettings();
    const url = `${API_BASE_URL}/api/design/`;
    const body = {
        sequence,
        tm: params.tm,
        gc: params.gc,
        length: params.length,
        // ... существующие настройки
        
        // ДОБАВЛЯЕМ настройки проверок (теперь отправляются на сервер!)
        check_hairpins: advancedSettings.checkHairpins !== false,
        check_dimers: advancedSettings.checkDimers !== false,
        check_repeats: advancedSettings.checkRepeats !== false,
        max_poly_x: advancedSettings.maxPolyX ?? 4,
        temperature_gradient: advancedSettings.temperatureGradient ?? 5,
        
        // Настройки солей
        salt_na: advancedSettings.saltNa ?? 50,
        salt_mg: advancedSettings.saltMg ?? 1.5,
        dntp_conc: advancedSettings.saltDntp ?? 0.2,
        dna_conc: advancedSettings.saltDna ?? 50,
        primer_conc: advancedSettings.saltPrimer ?? 200,
        
        // Пороги риска для анализа
        risk_thresholds: {
            low: advancedSettings.lowThreshold ?? 15,
            medium_min: advancedSettings.mediumThresholdMin ?? 15,
            medium_max: advancedSettings.mediumThresholdMax ?? 40,
            high: advancedSettings.highThreshold ?? 40
        }
    };
    
    // ... остальной код
}
В микросервисе app.py добавить обработку этих параметров:
python
# В app.py, в функции design добавить

@app.route("/api/design/", methods=["POST"])
def design():
    body = request.get_json() or {}
    # ... существующий код
    
    # ДОБАВЛЯЕМ обработку дополнительных параметров
    check_hairpins = body.get("check_hairpins", True)
    check_dimers = body.get("check_dimers", True)
    check_repeats = body.get("check_repeats", True)
    max_poly_x = body.get("max_poly_x", 4)
    
    # Добавляем в global_args параметры для Primer3
    if check_hairpins:
        global_args["PRIMER_SELF_ANY"] = 1
        global_args["PRIMER_SELF_ANY_TH"] = 45.0
        global_args["PRIMER_SELF_END"] = 1
        global_args["PRIMER_SELF_END_TH"] = 3.0
    
    if check_dimers:
        global_args["PRIMER_SELF_ANY"] = 1  # Проверка на димеры
        global_args["PRIMER_SELF_END"] = 1  # Проверка 3'-концов
    
    if check_repeats:
        global_args["PRIMER_MAX_POLY_X"] = max_poly_x
    
    # Настройки солей
    if body.get("salt_na"):
        global_args["PRIMER_SALT_MONOVALENT"] = body["salt_na"]
    if body.get("salt_mg"):
        global_args["PRIMER_SALT_DIVALENT"] = body["salt_mg"]
    if body.get("dntp_conc"):
        global_args["PRIMER_DNTP_CONC"] = body["dntp_conc"]
    if body.get("dna_conc"):
        global_args["PRIMER_DNA_CONC"] = body["dna_conc"]
    
    # ... остальной код
Обновляем UI - теперь эти настройки не скрываются в серверном режиме:
html
<!-- В popup.html, изменить data-mode="local" на data-mode="both" для этих настроек -->
<div class="advanced-checkboxes" data-mode="both">
    <label class="checkbox">
        <input type="checkbox" id="check-hairpins" checked>
        <span>Проверять шпильки</span>
        <span class="setting-badge server-badge" title="Отправляется на сервер">☁️ Сервер</span>
        <span class="setting-badge local-badge" title="Локально">💻 Локально</span>
    </label>
    <label class="checkbox">
        <input type="checkbox" id="check-dimers" checked>
        <span>Проверять димеры</span>
        <span class="setting-badge server-badge" title="Отправляется на сервер">☁️ Сервер</span>
        <span class="setting-badge local-badge" title="Локально">💻 Локально</span>
    </label>
    <label class="checkbox">
        <input type="checkbox" id="check-repeats" checked>
        <span>Проверять повторы</span>
        <span class="setting-badge server-badge" title="Отправляется на сервер">☁️ Сервер</span>
        <span class="setting-badge local-badge" title="Локально">💻 Локально</span>
    </label>
</div>

<!-- Поли-X тоже отправляем на сервер -->
<div class="polyx-group" data-mode="both">
    <label class="slider-label">
        Макс. длина поли-X участка:
        <span id="polyx-value" class="slider-value">4</span> нуклеотидов
        <span class="setting-badge server-badge" title="Отправляется на сервер">☁️ Сервер</span>
        <span class="setting-badge local-badge" title="Локально">💻 Локально</span>
    </label>
    <input type="range" id="polyx-slider" class="slider"
           min="3" max="8" value="4" step="1">
</div>
Обновляем CSS для отображения бейджей:
css
/* В popup.css обновить стили */
.setting-badge {
    display: inline-block;
    font-size: 9px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 10px;
    margin-left: 6px;
    vertical-align: middle;
    text-transform: uppercase;
    letter-spacing: 0.3px;
}
.server-badge {
    background: #dbeafe;
    color: #1e40af;
    border: 1px solid #93c5fd;
}
.local-badge {
    background: #fef3c7;
    color: #92400e;
    border: 1px solid #fcd34d;
}

/* В серверном режиме показываем оба бейджа, но local-бейдж делаем полупрозрачным? Нет, оба показываем */
.advanced-settings.server-mode [data-mode="both"] .local-badge,
.advanced-settings.local-mode [data-mode="both"] .server-badge {
    display: inline-block; /* Показываем оба в любом режиме */
    opacity: 0.7;
}
5. 📊 Обновление summary-панели
html
<!-- В popup.html обновить settings-summary -->
<div class="settings-summary" id="settings-summary">
    <h4 class="settings-summary-title">📋 Сводка по настройкам</h4>
    <div class="summary-grid">
        <div class="summary-item" data-mode="both">
            <span class="summary-icon">☁️</span>
            <span class="summary-text">Отправляются на сервер:</span>
            <span class="summary-badges">
                <span class="badge">Размер продукта</span>
                <span class="badge">GC состав</span>
                <span class="badge">Допуск Tm</span>
                <span class="badge">Градиент</span>
                <span class="badge">Исключённые регионы</span>
                <span class="badge">Шпильки/димеры</span>
                <span class="badge">Поли-X</span>
                <span class="badge">Концентрация солей</span>
            </span>
        </div>
        <div class="summary-item" data-mode="local">
            <span class="summary-icon">💻</span>
            <span class="summary-text">Только локально:</span>
            <span class="summary-badges">
                <span class="badge local">Шаг поиска</span>
                <span class="badge local">Мин. расстояние</span>
                <span class="badge local">Пороги риска</span>
                <span class="badge local">Специфичность (BLAST)</span>
            </span>
        </div>
    </div>
</div>
📋 Итог исправлений
Проблема	Решение	Статус
Кнопка "Открыть" не работает	Добавлен обработчик с загрузкой пары и переключением на вкладку дизайна	✅
Кнопка "Удалить" не работает	Добавлен обработчик удаления из storage	✅
Нет кнопки "Назад"	Добавлена навигационная панель с кнопкой назад	✅
Кнопки Fwd/Rev не работают	Добавлены обработчики копирования	✅
Кнопка "Отзыв" не работает	Реализовано модальное окно с сохранением отзыва	✅
Горизонтальный скролл при hover	Добавлены CSS правила overflow-x: hidden	✅
Локальные настройки не работают в серверном режиме	Изменена логика - настройки отправляются на сервер	✅
🚀 Дополнительные улучшения
1. Сохранение отзывов в истории праймера
javascript
// При сохранении отзыва, обновляем запись в истории
async function updateHistoryWithFeedback(feedback) {
    const history = await storage.get('history') || [];
    const index = history.findIndex(h => 
        h.results?.some(r => r.id === feedback.pairId)
    );
    if (index !== -1) {
        history[index].feedback = feedback;
        await storage.set('history', history);
    }
}
2. Индикация наличия отзыва в сохраненных
html
<!-- Добавить в элемент saved-item -->
<span class="has-feedback" title="Есть отзыв">📝</span>
3. Экспорт отзывов вместе с данными
javascript
// В exportData добавить отзывы
async function exportData() {
    const all = await storage.exportAll();
    const feedbacks = await storage.get('feedbacks') || [];
    all.feedbacks = feedbacks;
    // ... остальной код
}