import { PrimerHeuristicEngine } from '../lib/heuristic-engine.js';
import { StorageManager } from '../lib/storage-manager.js';
import { DNAVisualizer } from './visualization.js';
import { API_BASE_URL } from '../config.js';

const heuristicEngine = new PrimerHeuristicEngine();
const storage = new StorageManager();

let currentSequence = '';
let currentResults = null;
let settings = {};
let visualizer = null;

document.addEventListener('DOMContentLoaded', async () => {
    visualizer = new DNAVisualizer('visualization');

    await loadSettings();
    await loadStats();
    checkNetworkStatus();
    await checkForNCBIData();

    setupEventListeners();
    setupTabs();

    const saved = await storage.get('lastSequence');
    if (saved) {
        const textarea = document.getElementById('sequence');
        textarea.value = saved;
        updateSequenceStats(saved);
        currentSequence = saved;
    }
});

async function loadSettings() {
    settings = await storage.get('settings') || {
        defaultTm: 60,
        defaultGc: 50,
        primerLength: 22,
        autoSync: true,
        notifications: true,
        theme: 'light'
    };

    document.getElementById('tm').value = settings.defaultTm;
    document.getElementById('gc').value = settings.defaultGc;
    document.getElementById('length').value = settings.primerLength;
    document.getElementById('auto-sync').checked = settings.autoSync;
    document.getElementById('notifications').checked = settings.notifications;
    document.getElementById('auto-design').checked = settings.autoDesign || false;
    document.getElementById('theme').value = settings.theme;
}

async function loadStats() {
    const stats = await storage.get('stats') || {
        primersDesigned: 0,
        savedPrimers: 0,
        syncsCompleted: 0,
        installDate: Date.now()
    };

    document.getElementById('stat-primers').textContent = stats.primersDesigned || 0;
    document.getElementById('stat-saved').textContent = stats.savedPrimers || 0;
    document.getElementById('stat-install').textContent =
        stats.installDate ? new Date(stats.installDate).toLocaleDateString() : '-';
}

function checkNetworkStatus() {
    const indicator = document.getElementById('status-indicator');
    const text = document.getElementById('status-text');

    if (navigator.onLine) {
        indicator.className = 'status-indicator online';
        text.textContent = 'Онлайн';
    } else {
        indicator.className = 'status-indicator offline';
        text.textContent = 'Оффлайн (эвристика)';
    }
}

async function checkForNCBIData() {
    const ncbiData = await storage.get('lastNCBISequence');
    if (ncbiData && Date.now() - ncbiData.timestamp < 5 * 60 * 1000) {
        const quickInsert = document.getElementById('quick-insert');
        quickInsert.style.display = 'flex';

        const geneInfo = ncbiData.geneName || ncbiData.accession || 'NCBI';
        quickInsert.querySelector('.quick-insert-text').textContent =
            `Последовательность с ${geneInfo}`;
    }
}

function setupEventListeners() {
    document.getElementById('design-btn').addEventListener('click', designPrimers);
    document.getElementById('clear-btn').addEventListener('click', clearForm);
    document.getElementById('paste-btn').addEventListener('click', pasteFromClipboard);
    document.getElementById('sample-btn').addEventListener('click', loadSample);
    document.getElementById('use-ncbi').addEventListener('click', useNCBIData);

    document.getElementById('sequence').addEventListener('input', (e) => {
        updateSequenceStats(e.target.value);
        currentSequence = e.target.value;
    });

    document.getElementById('auto-sync').addEventListener('change', saveSettings);
    document.getElementById('notifications').addEventListener('change', saveSettings);
    document.getElementById('auto-design').addEventListener('change', saveSettings);
    document.getElementById('theme').addEventListener('change', saveSettings);

    document.getElementById('export-btn').addEventListener('click', exportData);
    document.getElementById('clear-data-btn').addEventListener('click', clearAllData);
    document.getElementById('feedback-link').addEventListener('click', openFeedback);
    document.getElementById('help-link').addEventListener('click', openHelp);
}

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

            if (tabName === 'saved') loadSavedPrimers();
            if (tabName === 'history') loadHistory();
        });
    });

    // для кнопки "Создать новые" во вкладке "Сохраненные"
    window.switchTab = (name) => {
        const target = Array.from(tabs).find(t => t.dataset.tab === name);
        if (target) target.click();
    };
}

async function designPrimers() {
    const textarea = document.getElementById('sequence');
    const sequence = textarea.value.trim();
    const tm = parseFloat(document.getElementById('tm').value);
    const gc = parseFloat(document.getElementById('gc').value);
    const length = parseInt(document.getElementById('length').value, 10);

    if (!sequence) {
        showError('Введите последовательность ДНК');
        return;
    }

    const cleaned = sequence.replace(/\s/g, '').toUpperCase();
    if (cleaned.length < 50) {
        showError('Минимальная длина последовательности: 50 нуклеотидов');
        return;
    }

    currentSequence = cleaned;
    showProgress(true);

    try {
        await storage.set('lastSequence', cleaned);

        let results = null;
        if (navigator.onLine) {
            results = await designWithServer(cleaned, { tm, gc, length });
        }

        if (!results) {
            results = designLocally(cleaned, { tm, gc, length });
        }

        currentResults = results;
        displayResults(results);

        await storage.addToHistory({
            sequence: cleaned,
            results,
            timestamp: Date.now()
        });

        await storage.updateStats({ primersDesigned: (settings.primersDesigned || 0) + 1 });
    } catch (error) {
        showError('Ошибка: ' + (error.message || String(error)));
    } finally {
        showProgress(false);
    }
}

async function designWithServer(sequence, params) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/design/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sequence,
                tm: params.tm,
                gc: params.gc,
                length: params.length
            })
        });

        if (!response.ok) return null;

        const data = await response.json();
        return data.results || null;
    } catch {
        return null;
    }
}

function designLocally(sequence, params) {
    const results = [];
    const step = Math.floor(sequence.length / 15);

    for (let i = 0; i < 10; i++) {
        const start = i * step;
        const end = start + params.length;

        if (end < sequence.length) {
            const fwdSeq = sequence.substring(start, end);
            const revSeq = sequence.substring(sequence.length - end, sequence.length - start);

            const evaluation = heuristicEngine.evaluatePrimerPair(fwdSeq, revSeq, {
                targetTm: params.tm
            });

            results.push({
                id: `local_${i}`,
                rank: i + 1,
                forward: {
                    sequence: fwdSeq,
                    start,
                    end,
                    ...evaluation.forward
                },
                reverse: {
                    sequence: revSeq,
                    start: sequence.length - end,
                    end: sequence.length - start,
                    ...evaluation.reverse
                },
                totalScore: evaluation.totalScore,
                grade: evaluation.grade,
                warnings: evaluation.warnings,
                recommendations: evaluation.recommendations,
                source: 'local'
            });
        }
    }

    return results.sort((a, b) => b.totalScore - a.totalScore);
}

function displayResults(results) {
    const container = document.getElementById('results');

    if (!results || results.length === 0) {
        container.innerHTML = '<div class="error">Не удалось подобрать праймеры</div>';
        if (visualizer) visualizer.render('', []);
        return;
    }

    let html = '<div class="results-header">';
    if (results[0].source === 'local') {
        html += '<div class="source-badge offline">⚡ Оффлайн режим (эвристика)</div>';
    } else {
        html += '<div class="source-badge online">☁️ Серверный режим</div>';
    }
    html += '</div>';

    // Анализируем пересечения
    const overlaps = heuristicEngine.analyzeOverlaps(results);

    // Добавляем секцию с пересечениями если они есть
    if (overlaps.length > 0) {
        html += `
            <div class="overlap-section">
                <h3 class="overlap-title">🔗 Анализ пересечений</h3>
                <div class="overlap-grid">
        `;
        
        overlaps.forEach(o => {
            html += `
                <div class="overlap-card overlap-${o.conflictLevel}">
                    <div class="overlap-header">
                        <span class="overlap-pairs">
                            Пара #${parseInt(o.pair1_id.split('_')[1]) + 1} ↔ Пара #${parseInt(o.pair2_id.split('_')[1]) + 1}
                        </span>
                        <span class="overlap-badge">${o.overlapLength} п.н.</span>
                    </div>
                    <div class="overlap-details">
                        <div>${formatOverlapType(o.type)}</div>
                        ${o.warning.map(w => `<div class="overlap-warning">${w}</div>`).join('')}
                    </div>
                </div>
            `;
        });
        
        html += '</div></div>';
    }

    // Добавляем карточки с праймерами
    results.slice(0, 5).forEach((pair, idx) => {
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '📌';
        const gradeColor = pair.grade.color;

        html += `
            <div class="result-card" data-pair-id="${pair.id}">
                <div class="card-header">
                    <div class="rank">
                        ${medal} Пара #${idx + 1}
                    </div>
                    <div class="grade" style="background: ${gradeColor}20; color: ${gradeColor}">
                        ${pair.grade.letter} (${pair.totalScore})
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
            html += '<div class="warnings">';
            pair.warnings.slice(0, 2).forEach(w => {
                html += `<div class="warning">⚠️ ${w}</div>`;
            });
            html += '</div>';
        }

        html += `
                <div class="card-actions">
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

    container.innerHTML = html;

    if (visualizer && currentSequence) {
        visualizer.render(currentSequence.replace(/\s/g, ''), results);
    }

    // Добавляем обработчики для кнопок
    document.querySelectorAll('.copy-btn').forEach(btn => {
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

    document.querySelectorAll('.save-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const pair = JSON.parse(e.currentTarget.dataset.pair);
            savePrimer(pair);
        });
    });

    document.querySelectorAll('.feedback-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const pair = JSON.parse(e.currentTarget.dataset.pair);
            openFeedbackForPair(pair);
        });
    });
}

async function savePrimer(pair) {
    const name = prompt('Введите название для сохранения:', `Primer ${new Date().toLocaleDateString()}`);
    if (!name) return;

    const saved = await storage.get('savedPrimers') || [];
    saved.push({
        id: Date.now(),
        name,
        pair,
        timestamp: Date.now()
    });

    await storage.set('savedPrimers', saved);
    await storage.updateStats({ savedPrimers: (settings.savedPrimers || 0) + 1 });
    showNotification('✓ Праймер сохранен');
}

async function loadSavedPrimers() {
    const saved = await storage.get('savedPrimers') || [];
    const container = document.getElementById('saved-list');

    if (saved.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">📭</span>
                <p>Нет сохраненных праймеров</p>
            </div>
        `;
        return;
    }

    let html = '';
    saved.sort((a, b) => b.timestamp - a.timestamp).forEach(item => {
        const date = new Date(item.timestamp).toLocaleDateString();
        html += `
            <div class="saved-item">
                <div class="saved-header">
                    <span class="saved-name">${item.name}</span>
                    <span class="saved-date">${date}</span>
                </div>
                <div class="saved-preview">
                    <div class="saved-grade" style="background: ${item.pair.grade.color}20; color: ${item.pair.grade.color}">
                        ${item.pair.grade.letter} (${item.pair.totalScore})
                    </div>
                    <div class="saved-seqs">
                        <div class="saved-seq">F: ${item.pair.forward.sequence.substring(0, 15)}...</div>
                        <div class="saved-seq">R: ${item.pair.reverse.sequence.substring(0, 15)}...</div>
                    </div>
                </div>
                <div class="saved-actions">
                    <button class="action-btn small" onclick="loadSavedPrimer(${item.id})">📂 Открыть</button>
                    <button class="action-btn small delete" onclick="deleteSavedPrimer(${item.id})">🗑️</button>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

async function loadHistory() {
    const history = await storage.get('history') || [];
    const container = document.getElementById('history-list');

    if (history.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">📜</span>
                <p>История пуста</p>
            </div>
        `;
        return;
    }

    let html = '';
    history.forEach(item => {
        const date = new Date(item.timestamp).toLocaleString();
        html += `
            <div class="saved-item">
                <div class="saved-header">
                    <span class="saved-name">${date}</span>
                </div>
                <div class="saved-preview">
                    <div class="saved-seqs">
                        <div class="saved-seq">Длина: ${item.sequence.length} нуклеотидов</div>
                        <div class="saved-seq">Пар: ${item.results?.length || 0}</div>
                    </div>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

function updateSequenceStats(sequence) {
    const cleaned = sequence.replace(/\s/g, '');
    document.getElementById('seq-length').textContent = cleaned.length;
}

function showProgress(show) {
    const progress = document.getElementById('progress');
    const designBtn = document.getElementById('design-btn');

    if (show) {
        progress.style.display = 'block';
        designBtn.disabled = true;

        let width = 0;
        const bar = document.getElementById('progress-bar');
        const interval = setInterval(() => {
            if (width >= 90) {
                clearInterval(interval);
            } else {
                width += Math.random() * 10;
                bar.style.width = `${width}%`;
            }
        }, 200);
    } else {
        progress.style.display = 'none';
        designBtn.disabled = false;
        document.getElementById('progress-bar').style.width = '0%';
    }
}

function showError(message) {
    const results = document.getElementById('results');
    results.innerHTML = `<div class="error">❌ ${message}</div>`;
}

function showNotification(message) {
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.remove();
    }, 2000);
}

function formatSequence(seq) {
    if (seq.length <= 25) return seq;
    return seq.substring(0, 20) + '...' + seq.slice(-5);
}

function formatOverlapType(type) {
    const types = {
        'forward_forward': 'Прямой-Прямой',
        'forward_reverse': 'Прямой-Обратный',
        'reverse_reverse': 'Обратный-Обратный',
        'product_overlap': 'Перекрытие продуктов'
    };
    return types[type] || type;
}

async function clearForm() {
    document.getElementById('sequence').value = '';
    document.getElementById('results').innerHTML = '';
    updateSequenceStats('');
    currentSequence = '';
    if (visualizer) visualizer.render('', []);
    await storage.remove('lastSequence');
}

async function pasteFromClipboard() {
    try {
        const text = await navigator.clipboard.readText();
        const textarea = document.getElementById('sequence');
        textarea.value = text;
        updateSequenceStats(text);
        currentSequence = text;
    } catch {
        showError('Не удалось вставить из буфера обмена');
    }
}

function loadSample() {
    const sample = 'ATGCGATCGTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGC' +
                   'TAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGC' +
                   'TAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGC';
    const textarea = document.getElementById('sequence');
    textarea.value = sample;
    updateSequenceStats(sample);
    currentSequence = sample;
}

async function useNCBIData() {
    const ncbiData = await storage.get('lastNCBISequence');
    if (ncbiData) {
        const textarea = document.getElementById('sequence');
        textarea.value = ncbiData.sequence;
        updateSequenceStats(ncbiData.sequence);
        currentSequence = ncbiData.sequence;
        document.getElementById('quick-insert').style.display = 'none';
    }
}

async function saveSettings() {
    settings = {
        defaultTm: parseFloat(document.getElementById('tm').value),
        defaultGc: parseFloat(document.getElementById('gc').value),
        primerLength: parseInt(document.getElementById('length').value, 10),
        autoSync: document.getElementById('auto-sync').checked,
        notifications: document.getElementById('notifications').checked,
        autoDesign: document.getElementById('auto-design').checked,
        theme: document.getElementById('theme').value
    };

    await storage.set('settings', settings);
}

function exportData() {
    storage.exportAll().then(data => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `primer-designer-backup-${Date.now()}.json`;
        a.click();
    });
}

async function clearAllData() {
    if (confirm('Вы уверены? Все данные будут удалены без возможности восстановления.')) {
        await storage.clear();
        location.reload();
    }
}

function openFeedback() {
    chrome.tabs.create({ url: `${API_BASE_URL}/feedback` });
}

function openHelp() {
    chrome.tabs.create({ url: `${API_BASE_URL}/help` });
}

function openFeedbackForPair(pair) {
    chrome.runtime.sendMessage({
        type: 'OPEN_FEEDBACK',
        data: { pair }
    });
}

// глобальные функции для onclick в HTML
window.loadSavedPrimer = async function (id) {
    const saved = await storage.get('savedPrimers') || [];
    const item = saved.find(i => i.id === id);
    if (!item) return;
    currentResults = [item.pair];
    displayResults([item.pair]);
};

window.deleteSavedPrimer = async function (id) {
    const saved = await storage.get('savedPrimers') || [];
    const filtered = saved.filter(i => i.id !== id);
    await storage.set('savedPrimers', filtered);
    await loadSavedPrimers();
};

// Добавляем стили для секции пересечений
const overlapStyles = document.createElement('style');
overlapStyles.textContent = `
    .overlap-section {
        margin: 16px 0;
        padding: 16px;
        background: #f8fafc;
        border-radius: 12px;
        border: 1px solid #e2e8f0;
    }
    
    .overlap-title {
        font-size: 14px;
        font-weight: 600;
        margin-bottom: 12px;
        color: #475569;
        display: flex;
        align-items: center;
        gap: 6px;
    }
    
    .overlap-grid {
        display: grid;
        gap: 8px;
    }
    
    .overlap-card {
        padding: 12px;
        border-radius: 8px;
        border-left: 4px solid;
        transition: all 0.2s;
    }
    
    .overlap-card:hover {
        transform: translateX(4px);
        box-shadow: 0 2px 4px rgba(0,0,0,0.05);
    }
    
    .overlap-high { 
        border-left-color: #ef4444; 
        background: #fef2f2; 
    }
    .overlap-medium { 
        border-left-color: #f59e0b; 
        background: #fffbeb; 
    }
    .overlap-low { 
        border-left-color: #3b82f6; 
        background: #eff6ff; 
    }
    
    .overlap-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 4px;
    }
    
    .overlap-pairs {
        font-weight: 600;
        font-size: 13px;
        color: #1f2937;
    }
    
    .overlap-badge {
        font-size: 11px;
        padding: 2px 8px;
        background: white;
        border-radius: 12px;
        font-weight: 500;
        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
    }
    
    .overlap-details {
        font-size: 12px;
        color: #64748b;
    }
    
    .overlap-warning {
        color: #b45309;
        margin-top: 4px;
        font-size: 11px;
        display: flex;
        align-items: center;
        gap: 4px;
    }
    
    .overlap-warning::before {
        content: "⚠️";
        font-size: 10px;
    }
`;

document.head.appendChild(overlapStyles);