import { PrimerHeuristicEngine } from '../lib/heuristic-engine.js';
import { StorageManager } from '../lib/storage-manager.js';
import { BlastService } from '../lib/blast-service.js';
import { ExportService } from '../lib/export-service.js';
import { TemplateManager } from '../lib/template-manager.js';
import { UserManager } from '../lib/user-manager.js';
import { SyncEngine } from '../lib/sync-engine.js';
import { DNAVisualizer, OverlapVisualizer } from './visualization.js';
import { API_BASE_URL } from '../config.js';
import { overlapPaginationIdleHtml, formatSequence } from './overlap-html.js';
import { normalizeResults } from '../lib/primer-result-normalize.js';
import { runInstallerStartupCheck } from './installer-panel.js';
import { createDesignHandlers } from './design-flow.js';
import { setupSettingsEventListeners } from './settings-bindings.js';
import { initUserCabinet } from './user-cabinet.js';
import { configureBlastUi, showBlastResults } from './blast-ui.js';
import { configureDisplayResults, displayResults } from './display-results.js';
import { HistoryManager } from '../lib/history-manager.js';
import { HistoryGroupStats, geneLabelFromFavoriteItem } from '../lib/history-group-stats.js';
import { initHistoryPanel } from './history-ui.js';
import {
    FolderManager,
    ROOT_FOLDER_ID,
    normalizeFavoriteFolderId,
} from '../lib/folder-manager.js';

const heuristicEngine = new PrimerHeuristicEngine();
const storage = new StorageManager();
const historyManager = new HistoryManager(storage);
const userManager = new UserManager(storage, API_BASE_URL);
const syncEngine = new SyncEngine(storage, userManager, API_BASE_URL);
const savedGroupStatsEngine = new HistoryGroupStats();
const savedFolderManager = new FolderManager(storage);

/** Снимок групп при последней отрисовке избранного (для «Сравнить в группе»). */
let lastSavedRenderedGroups = [];

/** Выбранная папка на вкладке «Избранное» (optimization_10). */
let selectedSavedFolderId = ROOT_FOLDER_ID;
/** Раскрытые узлы дерева папок. */
const expandedSavedFolderIds = new Set([ROOT_FOLDER_ID]);

/** Пар на странице в центральной колонке (высота колонки фиксирована). */
const PRIMER_RESULTS_PER_PAGE = 3;
/** Пересечений на странице в правой колонке (под полосой пагинации). */
const OVERLAP_PER_PAGE = 8;

/** @type {ReturnType<typeof createDesignHandlers> | null} */
let designHandlers = null;

/** Правая колонка: график и «Анализ пересечений» только после успешного подбора. */
function setPanelRightAnalysisVisible(visible) {
    const invite = document.getElementById('panel-right-invite');
    const analysis = document.getElementById('panel-right-analysis');
    if (invite) invite.style.display = visible ? 'none' : 'flex';
    if (analysis) analysis.style.display = visible ? 'flex' : 'none';
}

let currentSequence = '';
let currentResults = null;
let settings = {};
let advancedSettings = {};
let visualizer = null;
let vizZoom = 1;
const blastService = new BlastService();
const exportService = new ExportService();
const templateManager = new TemplateManager();
let onVizRedraw = null;
function setVizRedraw(fn) { onVizRedraw = fn; }

/** @type {() => Promise<void>} */
let refreshHistoryView = async () => {};

function escapeHtml(str) {
    if (str == null || str === '') return '';
    return String(str).replace(/[&<>]/g, (m) => {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

/** Фрагмент имени файла из названия записи (без расширения). */
function safeFileNameSegment(str, maxLen = 72) {
    const s = String(str || 'primer')
        .replace(/[/\\?%*:|"<>']/g, '_')
        .replace(/\s+/g, '-')
        .slice(0, maxLen);
    return s || 'primer';
}

function updateNavigationBar(tabName) {
    const bar = document.getElementById('navigation-bar');
    if (!bar) return;
    bar.hidden = tabName === 'design';
}

async function updateHistoryWithFeedback(feedback) {
    const history = await storage.get('history') || [];
    const pid = feedback.pairId;
    const index = history.findIndex((h) =>
        Array.isArray(h.results) && h.results.some((r) => r.id === pid),
    );
    if (index !== -1) {
        history[index] = { ...history[index], feedback };
        await storage.set('history', history);
    }
}

function scrollVizToCenter() {
    const scrollEl = document.getElementById('visualization-scroll');
    if (!scrollEl || !visualizer?.canvas) return;
    const seq = (currentSequence || '').replace(/\s/g, '');
    if (!seq.length) return;
    const centerX = 20 + (seq.length / 2) * visualizer.scale;
    scrollEl.scrollLeft = Math.max(0, centerX - scrollEl.clientWidth / 2);
}

function updateOverlapVisualizationForCurrent() {
    if (!visualizer || !currentSequence || !currentResults || !currentResults.length) return;
    const seq = currentSequence.replace(/\s/g, '');
    const overlaps = heuristicEngine.analyzeOverlaps(currentResults, {
        thresholds: {
            low: advancedSettings.lowThreshold,
            mediumMin: advancedSettings.mediumThresholdMin,
            mediumMax: advancedSettings.mediumThresholdMax,
            high: advancedSettings.highThreshold
        }
    });
    const pairIdxAttr = document.querySelector('.result-card.result-card-highlighted')?.dataset.pairIndex;
    const overlapIdxAttr = document.querySelector('.overlap-card.highlighted')?.dataset.overlapIndex;
    const pairIndex = pairIdxAttr != null ? parseInt(pairIdxAttr, 10) : -1;
    const overlapIndex = overlapIdxAttr != null ? parseInt(overlapIdxAttr, 10) : -1;
    visualizer.render(seq, currentResults, isNaN(pairIndex) ? -1 : pairIndex, vizZoom);
    if (overlaps.length > 0 && visualizer.canvas) {
        const ov = new OverlapVisualizer(visualizer.canvas);
        ov.drawOverlaps(overlaps, seq.length, isNaN(overlapIndex) ? -1 : overlapIndex);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    visualizer = new DNAVisualizer('visualization');
    setPanelRightAnalysisVisible(false);

    configureBlastUi({
        blastService,
        getAdvancedSettings: () => advancedSettings,
        showNotification,
        showWarning,
    });
    configureDisplayResults({
        API_BASE_URL,
        heuristicEngine,
        getAdvancedSettings: () => advancedSettings,
        getVisualizer: () => visualizer,
        getVizZoom: () => vizZoom,
        getCurrentSequence: () => currentSequence,
        getCurrentResults: () => currentResults,
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
    });

    designHandlers = createDesignHandlers({
        API_BASE_URL,
        storage,
        heuristicEngine,
        getSettings: () => settings,
        getAdvancedSettings: () => advancedSettings,
        setCurrentSequence: (s) => { currentSequence = s; },
        setCurrentResults: (r) => { currentResults = r; },
        showError,
        showWarning,
        showProgress,
    });

    await loadSettings();
    await loadStats();
    checkNetworkStatus();
    await checkForNCBIData();

    setupSettingsEventListeners({
        designPrimers: () => designHandlers.designPrimers(),
        clearForm,
        pasteFromClipboard,
        loadSample,
        useNCBIData,
        useNCBIDataAndDesign,
        updateSequenceStats,
        setCurrentSequence: (s) => { currentSequence = s; },
        saveSettings,
        toggleForceOfflineMode,
        checkNetworkStatus,
        exportData,
        clearAllData,
        openFeedback,
        openHelp,
        searchGeneTemplate,
        loadGeneTemplateById,
        storage,
        API_BASE_URL,
        getSettings: () => settings,
        updateStatusDisplay,
        showNotification,
        getAdvancedSettings: () => advancedSettings,
        updateOverlapVisualizationForCurrent,
        updateSidebarKv,
        updateThresholdDisplay,
        updateAdvancedSettingsUI,
        updateNewSettingsUI,
        validateExcludeRegion,
        updateExcludeRegionsList,
        applyPreset,
        getTooltipForSetting,
        getVizZoom: () => vizZoom,
        setVizZoom: (z) => { vizZoom = z; },
        getVizRedraw: () => onVizRedraw,
        getCurrentSequence: () => currentSequence,
    });
    setupTabs();
    document.getElementById('nav-back-btn')?.addEventListener('click', () => {
        window.switchTab('design');
    });
    document.getElementById('saved-list')?.addEventListener('click', handleSavedListClick);
    initSavedPanel();

    refreshHistoryView = initHistoryPanel({
        historyManager,
        storage,
        setCurrentSequence: (s) => { currentSequence = s; },
        setCurrentResults: (r) => { currentResults = r; },
        updateSequenceStats,
        showNotification,
        showWarning,
        setPanelRightAnalysisVisible,
        savePrimer,
        refreshSavedPrimers: () => loadSavedPrimers().catch(() => {}),
    });
    await runInstallerStartupCheck({
        storage,
        API_BASE_URL,
        getSettings: () => settings,
        updateStatusDisplay,
        showNotification,
    });
    await userManager.init();
    initUserCabinet({
        userManager,
        syncEngine,
        showNotification,
        onAfterSyncRefresh: refreshAfterCabinetSync,
    });

    const saved = await storage.get('lastSequence');
    if (saved) {
        const textarea = document.getElementById('sequence');
        textarea.value = saved;
        updateSequenceStats(saved);
        currentSequence = saved;
    }
});

async function refreshAfterCabinetSync() {
    await loadSettings();
    await loadStats();
    await loadSavedPrimers();
    await loadHistory();
}

async function loadSettings() {
    settings = await storage.get('settings') || {
        defaultTm: 60,
        defaultGc: 50,
        primerLength: 22,
        autoSync: true,
        notifications: true,
        theme: 'light',
        forceOfflineMode: false
    };

    advancedSettings = await storage.get('advancedSettings') || {
        stepSize: 3,
        minDistance: 50,
        minProductSize: 80,
        maxProductSize: 500,
        lowThreshold: 15,
        mediumThresholdMin: 15,
        mediumThresholdMax: 40,
        highThreshold: 40,
        tmTolerance: 3,
        minGc: 35,
        maxGc: 65,
        checkHairpins: true,
        checkDimers: true,
        checkRepeats: true,
        maxPolyX: 4,
        temperatureGradient: 5,
        saltNa: 50,
        saltMg: 1.5,
        saltDntp: 0.2,
        saltDna: 50,
        saltPrimer: 200,
        excludeRegions: [],
        checkSpecificity: false,
        specificityLevel: 'strict',
        specificityOrganism: 'human'
    };

    document.getElementById('tm').value = settings.defaultTm;
    document.getElementById('gc').value = settings.defaultGc;
    document.getElementById('length').value = settings.primerLength;
    document.getElementById('auto-sync').checked = settings.autoSync;
    document.getElementById('notifications').checked = settings.notifications;
    document.getElementById('auto-design').checked = settings.autoDesign || false;
    document.getElementById('theme').value = settings.theme;
    const forceOfflineEl = document.getElementById('force-offline');
    if (forceOfflineEl) forceOfflineEl.checked = settings.forceOfflineMode || false;

    updateAdvancedSettingsUI();
    updateNewSettingsUI();
    updateStatusDisplay();
}

function updateSidebarKv() {
    const pr = document.getElementById('sidebar-kv-product');
    const tm = document.getElementById('sidebar-kv-tm');
    const gc = document.getElementById('sidebar-kv-gc');
    const mp = document.getElementById('min-product-size');
    const xp = document.getElementById('max-product-size');
    const tmv = document.getElementById('tm-tolerance-value');
    const mg = document.getElementById('min-gc');
    const xg = document.getElementById('max-gc');
    if (pr && mp && xp) pr.textContent = `${mp.value}–${xp.value} п.н.`;
    if (tm && tmv) tm.textContent = tmv.textContent;
    if (gc && mg && xg) gc.textContent = `мин ${mg.value} | макс ${xg.value}`;
}

function updateAdvancedSettingsUI() {
    const stepSlider = document.getElementById('step-slider');
    const stepValue = document.getElementById('step-value');
    if (stepSlider && stepValue) {
        stepSlider.value = advancedSettings.stepSize;
        stepValue.textContent = advancedSettings.stepSize;
    }
    const distanceSlider = document.getElementById('min-distance-slider');
    const distanceValue = document.getElementById('min-distance-value');
    if (distanceSlider && distanceValue) {
        distanceSlider.value = advancedSettings.minDistance;
        distanceValue.textContent = advancedSettings.minDistance;
    }
    const minProduct = document.getElementById('min-product-size');
    const maxProduct = document.getElementById('max-product-size');
    if (minProduct) minProduct.value = advancedSettings.minProductSize;
    if (maxProduct) maxProduct.value = advancedSettings.maxProductSize;
    updateThresholdDisplay();
    const tmSlider = document.getElementById('tm-tolerance-slider');
    const tmValue = document.getElementById('tm-tolerance-value');
    if (tmSlider && tmValue) {
        tmSlider.value = advancedSettings.tmTolerance;
        tmValue.textContent = `±${advancedSettings.tmTolerance}°C`;
    }
    const minGc = document.getElementById('min-gc');
    const maxGc = document.getElementById('max-gc');
    if (minGc) minGc.value = advancedSettings.minGc;
    if (maxGc) maxGc.value = advancedSettings.maxGc;
    const checkHairpins = document.getElementById('check-hairpins');
    const checkDimers = document.getElementById('check-dimers');
    const checkRepeats = document.getElementById('check-repeats');
    if (checkHairpins) checkHairpins.checked = advancedSettings.checkHairpins;
    if (checkDimers) checkDimers.checked = advancedSettings.checkDimers;
    if (checkRepeats) checkRepeats.checked = advancedSettings.checkRepeats;
    updateSidebarKv();
}

function getTooltipForSetting(setting) {
    const tips = {
        stepSize: 'Меньший шаг — точнее в GC-богатых регионах, но медленнее поиск. 💻 Только локально.',
        minProductSize: 'Для qPCR чаще 80–200 п.н.; для клонирования — 200+ п.н. ☁️ Отправляется на сервер.',
        maxProductSize: 'Большие продукты сложнее усиливать и анализировать. ☁️ Отправляется на сервер.',
        tmTolerance: 'Меньший допуск — более одинаковые Tm пары, но меньше кандидатов. ☁️ Сервер, 💻 локально.',
        minGc: 'Слишком низкий GC снижает Tm и стабильность праймера. ☁️ Отправляется на сервер.',
        maxGc: 'Слишком высокий GC повышает риск шпилек и димеров. ☁️ Отправляется на сервер.',
        temperatureGradient: 'Разница между Tm и температурой отжига. ☁️ Сервер, 💻 локально.',
        excludeRegions: 'Регионы, где не выбирать праймеры. ☁️ Сервер, 💻 локально.'
    };
    return tips[setting] || '';
}

function updateThresholdDisplay() {
    const lowValue = document.getElementById('low-threshold-value');
    if (lowValue) lowValue.textContent = `0-${advancedSettings.lowThreshold}%`;
    const mediumMin = document.getElementById('medium-threshold-min');
    const mediumMax = document.getElementById('medium-threshold-max');
    const mediumValue = document.getElementById('medium-threshold-value');
    if (mediumMin && mediumMax) {
        mediumMin.value = advancedSettings.mediumThresholdMin;
        mediumMax.value = advancedSettings.mediumThresholdMax;
        if (parseInt(mediumMin.value, 10) > parseInt(mediumMax.value, 10)) {
            mediumMax.value = mediumMin.value;
        }
    }
    if (mediumValue) {
        mediumValue.textContent = `${advancedSettings.mediumThresholdMin}-${advancedSettings.mediumThresholdMax}%`;
    }
    const highSlider = document.getElementById('high-threshold-slider');
    const highValue = document.getElementById('high-threshold-value');
    if (highSlider && highValue) {
        highSlider.value = advancedSettings.highThreshold;
        highValue.textContent = `>${advancedSettings.highThreshold}%`;
    }
}

function updateNewSettingsUI() {
    const polyxSlider = document.getElementById('polyx-slider');
    const polyxValue = document.getElementById('polyx-value');
    if (polyxSlider && polyxValue) {
        polyxSlider.value = advancedSettings.maxPolyX;
        polyxValue.textContent = advancedSettings.maxPolyX;
    }
    const gradientSlider = document.getElementById('gradient-slider');
    const gradientValue = document.getElementById('gradient-value');
    if (gradientSlider && gradientValue) {
        gradientSlider.value = advancedSettings.temperatureGradient;
        gradientValue.textContent = advancedSettings.temperatureGradient;
    }
    const saltIds = ['salt-na', 'salt-mg', 'salt-dntp', 'salt-dna', 'salt-primer'];
    const saltKeys = ['saltNa', 'saltMg', 'saltDntp', 'saltDna', 'saltPrimer'];
    saltIds.forEach((id, i) => {
        const el = document.getElementById(id);
        if (el && advancedSettings[saltKeys[i]] != null) el.value = advancedSettings[saltKeys[i]];
    });
    updateExcludeRegionsList();
    const checkSpecificity = document.getElementById('check-specificity');
    const specificityOptions = document.getElementById('specificity-options');
    if (checkSpecificity) {
        checkSpecificity.checked = advancedSettings.checkSpecificity;
        if (specificityOptions) {
            specificityOptions.style.display = advancedSettings.checkSpecificity ? 'block' : 'none';
        }
    }
    const levelRadios = document.querySelectorAll('input[name="specificity-level"]');
    levelRadios.forEach(r => {
        if (r.value === advancedSettings.specificityLevel) r.checked = true;
    });
    const organismSelect = document.getElementById('specificity-organism');
    if (organismSelect) organismSelect.value = advancedSettings.specificityOrganism;
}

function validateExcludeRegion(start, end, sequenceLength) {
    const errors = [];
    if (start < 0 || end < 0) errors.push('Координаты не могут быть отрицательными');
    if (sequenceLength > 0 && start >= sequenceLength) {
        errors.push(`Начало региона (${start}) выходит за длину последовательности (${sequenceLength})`);
    }
    if (sequenceLength > 0 && end > sequenceLength) {
        errors.push(`Конец региона (${end}) выходит за длину последовательности (${sequenceLength})`);
    }
    if (end <= start) errors.push('Конец региона должен быть больше начала');
    if (end - start < 1) errors.push('Регион должен быть длиной минимум 1 нуклеотид');
    return errors;
}

function updateExcludeRegionsList() {
    const listEl = document.getElementById('exclude-list');
    if (!listEl) return;
    if (!advancedSettings.excludeRegions || advancedSettings.excludeRegions.length === 0) {
        listEl.innerHTML = '<div class="exclude-empty">Нет исключенных регионов</div>';
        return;
    }
    advancedSettings.excludeRegions.sort((a, b) => a.start - b.start);
    let html = '';
    advancedSettings.excludeRegions.forEach((region, index) => {
        const length = region.end - region.start;
        html += `
            <div class="exclude-item" data-index="${index}">
                <span class="exclude-range">${region.start}-${region.end}</span>
                <span class="exclude-length">${length} п.н.</span>
                <button type="button" class="exclude-remove" data-index="${index}" title="Удалить регион">✕</button>
            </div>
        `;
    });
    listEl.innerHTML = html;
    listEl.querySelectorAll('.exclude-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const index = parseInt(e.currentTarget.dataset.index, 10);
            advancedSettings.excludeRegions.splice(index, 1);
            updateExcludeRegionsList();
            storage.set('advancedSettings', advancedSettings);
            showNotification('✅ Регион удален');
        });
    });
    listEl.querySelectorAll('.exclude-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.classList.contains('exclude-remove')) return;
            const index = parseInt(item.dataset.index, 10);
            const region = advancedSettings.excludeRegions[index];
            const action = confirm(
                `Регион: ${region.start}-${region.end} (${region.end - region.start} п.н.)\n\nНажмите OK для удаления\nНажмите Отмена для отмены`
            );
            if (action) {
                advancedSettings.excludeRegions.splice(index, 1);
                updateExcludeRegionsList();
                storage.set('advancedSettings', advancedSettings);
                showNotification('✅ Регион удален');
            }
        });
    });
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

function applyPreset(preset) {
    const textarea = document.getElementById('sequence');
    const seqStr = (textarea && textarea.value) ? textarea.value.replace(/\s/g, '') : '';
    const seqLength = currentSequence?.length || seqStr.length || 500;

    const defaults = {
        stepSize: 3,
        minDistance: 50,
        minProductSize: 80,
        maxProductSize: 500,
        lowThreshold: 15,
        mediumThresholdMin: 15,
        mediumThresholdMax: 40,
        highThreshold: 40,
        tmTolerance: 3,
        minGc: 35,
        maxGc: 65,
        checkHairpins: true,
        checkDimers: true,
        checkRepeats: true
    };
    switch (preset) {
        case 'qpcr':
            advancedSettings = {
                ...advancedSettings,
                ...defaults,
                stepSize: 2,
                minDistance: 30,
                minProductSize: 80,
                maxProductSize: Math.min(200, Math.max(120, Math.floor(seqLength * 0.5))),
                lowThreshold: 10,
                mediumThresholdMin: 10,
                mediumThresholdMax: 25,
                highThreshold: 25,
                tmTolerance: 2,
                minGc: 40,
                maxGc: 60
            };
            break;
        case 'cloning':
            {
                const minProduct = Math.min(200, Math.floor(seqLength * 0.6));
                const maxProduct = Math.min(2000, Math.floor(seqLength * 0.9));
                advancedSettings = {
                    ...advancedSettings,
                    ...defaults,
                    stepSize: 5,
                    minDistance: 100,
                    minProductSize: Math.max(100, minProduct),
                    maxProductSize: Math.max(minProduct + 100, maxProduct),
                    lowThreshold: 20,
                    mediumThresholdMin: 20,
                    mediumThresholdMax: 50,
                    highThreshold: 50,
                    tmTolerance: 5,
                    minGc: 30,
                    maxGc: 70,
                    checkHairpins: false,
                    checkRepeats: false
                };
            }
            break;
        case 'sequencing':
            {
                const seqMin = Math.min(400, Math.max(150, Math.floor(seqLength * 0.5)));
                const seqMax = Math.min(800, Math.max(seqMin + 100, Math.floor(seqLength * 0.85)));
                advancedSettings = {
                    ...advancedSettings,
                    ...defaults,
                    stepSize: 1,
                    minDistance: 200,
                    minProductSize: seqMin,
                    maxProductSize: seqMax,
                    lowThreshold: 5,
                    mediumThresholdMin: 5,
                    mediumThresholdMax: 15,
                    highThreshold: 15,
                    tmTolerance: 1,
                    minGc: 45,
                    maxGc: 55
                };
            }
            break;
        case 'custom':
        default:
            advancedSettings = { ...advancedSettings, ...defaults };
            break;
    }
    updateAdvancedSettingsUI();
    updateNewSettingsUI();
    storage.set('advancedSettings', advancedSettings);
}

function checkNetworkStatus() {
    updateStatusDisplay();
}

function updateStatusDisplay() {
    const indicator = document.getElementById('status-indicator');
    const textEl = document.getElementById('status-text');
    const modeEl = document.getElementById('status-mode');
    const toggleBtn = document.getElementById('mode-toggle');

    if (!indicator || !textEl) return;

    const forceOffline = settings.forceOfflineMode || false;

    if (navigator.onLine) {
        indicator.className = 'status-indicator online';
        indicator.title = 'Сеть: доступна';
        textEl.textContent = 'Онлайн';
    } else {
        indicator.className = 'status-indicator offline';
        indicator.title = 'Сеть: недоступна';
        textEl.textContent = 'Оффлайн';
    }

    if (modeEl) {
        modeEl.textContent = forceOffline ? 'Локально' : 'Сервер';
        modeEl.className = 'status-mode ' + (forceOffline ? 'mode-local' : 'mode-server');
    }
    if (toggleBtn) {
        toggleBtn.textContent = forceOffline ? 'Переключить на сервер' : 'Переключить на локально';
        toggleBtn.className = 'status-mode-toggle ' + (forceOffline ? 'mode-local' : 'mode-server');
    }
    updateSettingsModeIndicators();
}

function updateSettingsModeIndicators() {
    const container = document.getElementById('advanced-settings-container');
    if (!container) return;
    const isServerMode = navigator.onLine && !(settings.forceOfflineMode || false);
    container.classList.remove('local-mode', 'server-mode');
    container.classList.add(isServerMode ? 'server-mode' : 'local-mode');
}

function toggleForceOfflineMode() {
    settings.forceOfflineMode = !(settings.forceOfflineMode || false);
    storage.set('settings', settings);
    updateStatusDisplay();
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
            if (tabName === 'history') loadHistory();
            updateNavigationBar(tabName);
        });
    });

    updateNavigationBar('design');

    // для кнопки «Перейти к дизайну» во вкладке «Избранное»
    window.switchTab = (name) => {
        const target = Array.from(tabs).find(t => t.dataset.tab === name);
        if (target) target.click();
    };
}

/**
 * Делегирование кликов по списку избранного (optimization_7).
 * @param {MouseEvent} e
 */
async function handleSavedListClick(e) {
    const t = e.target;
    if (!(t instanceof Element)) return;

    const compareGrpBtn = t.closest('.saved-group-compare-btn');
    if (compareGrpBtn) {
        e.stopPropagation();
        const idx = Number(compareGrpBtn.getAttribute('data-saved-group-idx'));
        const g = lastSavedRenderedGroups[idx];
        if (g?.savedSequenceGroup) {
            openSavedFavoritesCompareModal(g.savedSequenceGroup);
        } else {
            showWarning('Нет данных группы для сравнения');
        }
        return;
    }

    const groupHead = t.closest('.saved-group-header');
    if (groupHead && !t.closest('button')) {
        const grp = groupHead.closest('.saved-group');
        const content = grp?.querySelector('.saved-group-content');
        if (content) {
            const open = content.style.display === 'none' || !content.style.display;
            content.style.display = open ? 'block' : 'none';
            const ex = groupHead.querySelector('.saved-expand');
            if (ex) {
                ex.textContent = open ? '▲' : '▼';
                ex.setAttribute('aria-expanded', open ? 'true' : 'false');
                ex.setAttribute('aria-label', open ? 'Свернуть группу' : 'Развернуть группу');
            }
        }
        return;
    }

    const favExportFmt = t.closest('.favorite-export-format-btn');
    const saveFileBtn = t.closest('.saved-save-file-btn');
    const delBtn = t.closest('.saved-delete-btn');
    const copyFwd = t.closest('.saved-copy-fwd');
    const copyRev = t.closest('.saved-copy-rev');
    const fbBtn = t.closest('.saved-feedback-btn');

    const saved = await storage.get('savedPrimers') || [];

    if (favExportFmt) {
        const sid = favExportFmt.getAttribute('data-saved-id');
        const format = favExportFmt.getAttribute('data-format') || '';
        const item = saved.find((i) => String(i.id) === String(sid));
        if (!item?.pair) {
            showWarning('Нет пары для экспорта');
            return;
        }
        e.stopPropagation();
        const primers = normalizeResults([item.pair], 'local');
        if (!primers?.length) {
            showWarning('Нет данных для экспорта');
            return;
        }
        try {
            if (format === 'pdf') exportService.exportToPDF(primers);
            else if (format === 'excel') exportService.exportToExcel(primers);
            else if (format === 'csv') exportService.exportToCSV(primers);
            else if (format === 'html') exportService.exportToHTML(primers);
            else {
                showWarning('Неизвестный формат');
                return;
            }
            showNotification('Экспорт выполнен');
        } catch (err) {
            const msg =
                err && typeof err === 'object' && 'message' in err ? err.message : String(err);
            showWarning(msg || 'Ошибка экспорта');
        }
        return;
    }

    if (saveFileBtn) {
        const sid = saveFileBtn.getAttribute('data-saved-id');
        const item = saved.find((i) => String(i.id) === String(sid));
        if (!item) {
            showWarning('Запись не найдена');
            return;
        }
        e.stopPropagation();
        const blob = new Blob([JSON.stringify(item, null, 2)], {
            type: 'application/json;charset=utf-8',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `favorite-item-${safeFileNameSegment(item.name)}-${item.id}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showNotification(`Файл экспортирован: ${item.name || 'элемент'}`);
        return;
    }

    if (copyFwd || copyRev) {
        const btn = copyFwd || copyRev;
        const seq = btn?.getAttribute('data-seq');
        if (!seq) return;
        e.stopPropagation();
        try {
            await navigator.clipboard.writeText(seq);
            const orig = btn.textContent;
            btn.textContent = '✓ Скопировано';
            setTimeout(() => {
                btn.textContent = orig;
            }, 1000);
            showNotification('Последовательность скопирована');
        } catch {
            showWarning('Не удалось скопировать');
        }
        return;
    }

    if (fbBtn) {
        const sid = fbBtn.getAttribute('data-saved-id');
        const item = saved.find((i) => String(i.id) === String(sid));
        if (!item?.pair) return;
        const pair = normalizeResults([item.pair], 'local')[0];
        openFeedbackForPair(pair, item.id, item.sequence || '');
        return;
    }

    if (delBtn) {
        const sid = delBtn.getAttribute('data-saved-id');
        const savedId = sid != null ? Number(sid) : NaN;
        if (!Number.isFinite(savedId)) return;
        if (!confirm('Удалить этот элемент из избранного?')) return;
        const filtered = saved.filter((i) => i.id !== savedId);
        await storage.set('savedPrimers', filtered);
        await loadSavedPrimers();
        showNotification('Удалено из избранного');
    }
}

async function loadGeneTemplateById(geneId) {
    const flat = templateManager.getFlatTemplates();
    const gene = flat.find((g) => g.id === geneId);
    if (!gene) {
        showWarning('Шаблон гена не найден');
        return;
    }
    await loadGeneTemplate(gene);
}

async function searchGeneTemplate() {
    const input = document.getElementById('gene-search');
    const q = input?.value || '';
    const list = document.getElementById('gene-search-results');
    if (!list) return;
    const results = templateManager.search(q).slice(0, 8);
    if (!results.length) {
        list.innerHTML = '<div class="gene-search-empty">Ничего не найдено</div>';
        return;
    }
    list.innerHTML = results.map((g) => `
        <button type="button" class="gene-search-item" data-gene="${g.id}">
            <strong>${g.name}</strong> · ${g.accession} <span>${g.organism}</span>
        </button>
    `).join('');
    list.querySelectorAll('.gene-search-item').forEach((btn) => {
        btn.addEventListener('click', async () => {
            await loadGeneTemplateById(btn.dataset.gene);
        });
    });
}

async function loadGeneTemplate(gene) {
    try {
        showProgress(true);
        const seq = await templateManager.fetchFromNCBI(gene.accession);
        const textarea = document.getElementById('sequence');
        if (!textarea) return;
        textarea.value = seq;
        currentSequence = seq;
        updateSequenceStats(seq);
        showNotification(`✅ Загружен шаблон: ${gene.name}`);
    } catch (error) {
        showError(`Ошибка загрузки ${gene.name}: ${error.message || error}`);
    } finally {
        showProgress(false);
    }
}

/**
 * Нормализация имени для проверки уникальности (история → избранное).
 * @param {string} name
 */
function savedPrimerNameKey(name) {
    return String(name || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

/**
 * @param {object} pair
 * @param {{
 *   sequence?: string,
 *   fromHistory?: boolean,
 *   historyEntryId?: string | number,
 * }} [options] — sequence из истории; fromHistory: обязательное уникальное имя + historyEntryId в записи
 */
async function savePrimer(pair, options = {}) {
    const fromHistory = options.fromHistory === true;
    const historyEntryId =
        options.historyEntryId != null && options.historyEntryId !== ''
            ? String(options.historyEntryId)
            : '';

    const defaultName = fromHistory
        ? `Избранное · история ${historyEntryId || '?'} · ${new Date().toLocaleDateString()}`
        : `Избранное ${new Date().toLocaleDateString()}`;

    const promptText = fromHistory
        ? 'Введите уникальное имя элемента избранного (обязательно). Будет привязан ID записи истории.'
        : 'Введите название элемента избранного:';

    const nameRaw = prompt(promptText, defaultName);
    if (nameRaw === null) return;

    const nameTrimmed = String(nameRaw).trim();
    if (fromHistory) {
        if (!nameTrimmed) {
            showWarning('Имя обязательно: укажите непустое уникальное название элемента избранного.');
            return;
        }
    } else if (!nameTrimmed) {
        return;
    }

    const seqRaw =
        options.sequence != null && options.sequence !== ''
            ? options.sequence
            : currentSequence || '';
    const sequence = String(seqRaw).replace(/\s/g, '');

    const saved = await storage.get('savedPrimers') || [];
    if (fromHistory) {
        const key = savedPrimerNameKey(nameTrimmed);
        const duplicate = saved.some((s) => savedPrimerNameKey(s.name) === key);
        if (duplicate) {
            showWarning(
                'В избранном уже есть элемент с таким именем. Укажите другое уникальное имя.',
            );
            return;
        }
    }

    /** @type {Record<string, unknown>} */
    const entry = {
        id: Date.now(),
        name: nameTrimmed,
        pair,
        sequence,
        timestamp: Date.now(),
    };
    if (fromHistory && historyEntryId) {
        entry.historyEntryId = historyEntryId;
    }
    if (selectedSavedFolderId && selectedSavedFolderId !== ROOT_FOLDER_ID) {
        entry.folderId = selectedSavedFolderId;
    }

    saved.push(entry);

    await storage.set('savedPrimers', saved);
    await storage.updateStats({ savedPrimers: (settings.savedPrimers || 0) + 1 });
    showNotification(fromHistory ? '✓ Добавлено в избранное из истории' : '✓ Добавлено в избранное');
}

let savedSearchDebounceTimer;
function scheduleSavedListReload() {
    clearTimeout(savedSearchDebounceTimer);
    savedSearchDebounceTimer = setTimeout(() => {
        loadSavedPrimers().catch(() => {});
    }, 280);
}

function filterSavedPrimers(saved, query) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return [...saved];
    return saved.filter((item) => {
        const name = (item.name || '').toLowerCase();
        const f = (item.pair?.forward?.sequence || '').toLowerCase();
        const r = (item.pair?.reverse?.sequence || '').toLowerCase();
        const seq = (item.sequence || '').toLowerCase();
        return name.includes(q) || f.includes(q) || r.includes(q) || seq.includes(q);
    });
}

function sortSavedPrimersList(saved, sortBy) {
    const arr = [...saved];
    switch (sortBy) {
        case 'name-asc':
            return arr.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));
        case 'score-desc':
            return arr.sort(
                (a, b) => (Number(b.pair?.totalScore) || 0) - (Number(a.pair?.totalScore) || 0),
            );
        default:
            return arr.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    }
}

function getSavedScoreClass(score) {
    const s = Number(score) || 0;
    if (s >= 90) return 'score-excellent';
    if (s >= 70) return 'score-good';
    if (s >= 50) return 'score-acceptable';
    return 'score-poor';
}

/** GC-clamp: G/C в последних 3 нт 5'→3' (optimization_9). */
function checkGCClamp(sequence) {
    const s = String(sequence || '')
        .replace(/\s/g, '')
        .toUpperCase();
    if (s.length < 3) return false;
    return /[GC]/i.test(s.slice(-3));
}

/** Эвристика «мультиплекс-совместимость» 0–100. */
function calculateSavedMultiplexScore(pair) {
    let score = 100;
    const f = pair?.forward || {};
    const r = pair?.reverse || {};
    const fTm = Number(f.details?.tm?.value) || 0;
    const rTm = Number(r.details?.tm?.value) || 0;
    const tmDiff = Math.abs(fTm - rTm);
    if (tmDiff > 3) score -= tmDiff * 2;
    const fGc = Number(f.details?.gc?.value) || 0;
    const rGc = Number(r.details?.gc?.value) || 0;
    const gcDiff = Math.abs(fGc - rGc);
    if (gcDiff > 10) score -= gcDiff;
    if (!checkGCClamp(f.sequence)) score -= 10;
    if (!checkGCClamp(r.sequence)) score -= 10;
    return Math.max(0, Math.min(100, Math.round(score)));
}

/** Краткая рекомендация по применению пары. */
function getSavedApplicationRecommendation(pair) {
    const score = Number(pair?.totalScore) || 0;
    const fTm = Number(pair?.forward?.details?.tm?.value) || 0;
    const rTm = Number(pair?.reverse?.details?.tm?.value) || 0;
    const fs = pair?.forward?.start;
    const re = pair?.reverse?.end;
    const productSize =
        fs != null && re != null ? Math.max(0, re - fs) : null;

    if (score >= 90 && Math.abs(fTm - rTm) <= 1) {
        return 'Подходит для qPCR / мультиплекса';
    }
    if (score >= 80 && productSize != null && productSize >= 100 && productSize <= 300) {
        return 'Стандартная ПЦР';
    }
    if (score >= 70) {
        return 'Проверить условия / оптимизация';
    }
    if (productSize != null && productSize > 500) {
        return 'Длинный продукт — клонирование';
    }
    if (productSize != null && productSize < 80) {
        return 'Короткий ампликон — qPCR';
    }
    return 'Тестирование в лаборатории';
}

function shortTemplatePreview(seq, max = 52) {
    const s = String(seq || '').replace(/\s/g, '');
    if (!s) return '';
    return s.length <= max ? s : `${s.slice(0, max - 6)}…${s.slice(-4)}`;
}

/**
 * Загрузить пару из избранного на вкладку «Дизайн».
 * @param {any} item
 * @returns {boolean}
 */
function applyFavoritePairToDesign(item) {
    if (!item?.pair) return false;
    const normalized = normalizeResults([item.pair], 'local');
    if (!normalized?.length) return false;
    currentResults = normalized;
    displayResults(normalized, { serverUnavailable: false, serverReturnedEmpty: false });
    const seq = String(item.sequence || '').replace(/\s/g, '');
    if (seq) {
        currentSequence = seq;
        const ta = document.getElementById('sequence');
        if (ta) ta.value = seq;
        updateSequenceStats(seq);
    }
    setPanelRightAnalysisVisible(true);
    window.switchTab('design');
    showNotification(`Загружено в дизайн: ${item.name || 'пара'}`);
    return true;
}

/**
 * Сводка по группе «одна последовательность — несколько пар в избранном».
 * @param {any} sg результат groupFavoritesBySequence
 */
function renderSavedSequenceGroupBanner(sg) {
    if (!sg) return '';
    const len =
        sg.sequenceLength != null && sg.sequenceLength > 0
            ? `${sg.sequenceLength} нт`
            : '—';
    const tm = sg.mostUsedParams?.tm != null ? `${sg.mostUsedParams.tm}°C` : '—';
    const gc = sg.mostUsedParams?.gc != null ? `${sg.mostUsedParams.gc}%` : '—';
    const ln = sg.mostUsedParams?.length != null ? `${sg.mostUsedParams.length} нт (F)` : '—';
    const dates = `${new Date(sg.firstAdded).toLocaleDateString()} — ${new Date(sg.lastAdded).toLocaleDateString()}`;
    const gene =
        sg.geneName != null && String(sg.geneName).trim()
            ? escapeHtml(String(sg.geneName))
            : '';
    const acc = sg.accession ? escapeHtml(String(sg.accession)) : '';
    const preview = escapeHtml(String(sg.sequencePreview || '—'));
    const fb = sg.hasFeedback ? '<span class="saved-group-fb-badge" title="Есть отзывы">📝</span>' : '';

    return `
        <div class="saved-seq-group-banner">
            <div class="saved-seq-group-banner-row">
                <span class="saved-seq-group-label">Последовательность</span>
                ${fb}
            </div>
            <code class="saved-seq-group-code">${preview}</code>
            <div class="saved-seq-group-grid">
                <span>Длина шаблона: <strong>${escapeHtml(len)}</strong></span>
                <span>Частые Tm/GC/дл.F: <strong>${escapeHtml(tm)}</strong> · <strong>${escapeHtml(gc)}</strong> · <strong>${escapeHtml(ln)}</strong></span>
                <span>Даты добавления: <strong>${escapeHtml(dates)}</strong></span>
                ${gene ? `<span>Ген (эвр.): <strong>${gene}</strong>${acc ? ` (${acc})` : ''}</span>` : ''}
            </div>
        </div>`;
}

/**
 * Сравнение до 4 лучших пар внутри одной группы по последовательности (optimization_9).
 * @param {any} group объект из groupFavoritesBySequence
 */
function openSavedFavoritesCompareModal(group) {
    const favorites = group?.favorites || [];
    if (favorites.length < 2) {
        showWarning('В группе нужно минимум 2 элемента для сравнения');
        return;
    }

    const top = [...favorites]
        .sort((a, b) => (Number(b.pair?.totalScore) || 0) - (Number(a.pair?.totalScore) || 0))
        .slice(0, 4);

    const title = escapeHtml(
        String(group.geneName || group.sequencePreview || 'Группа избранного').slice(0, 120),
    );

    const card = (rank, fav) => {
        const pair = fav.pair || {};
        const f = pair.forward || {};
        const r = pair.reverse || {};
        const fTm = f.details?.tm?.value;
        const rTm = r.details?.tm?.value;
        const tmDiff = Math.abs((Number(fTm) || 0) - (Number(rTm) || 0));
        const fs = f.start;
        const re = r.end;
        const prod =
            fs != null && re != null ? Math.max(0, re - fs) : '—';
        const sc = getSavedScoreClass(pair.totalScore);
        const gLet = pair.grade?.letter || '—';
        const sid = escapeHtml(String(fav.id));

        return `
        <div class="history-compare-card saved-fav-compare-card">
            <div class="history-compare-card-top">
                <span class="history-compare-rank" aria-hidden="true">${rank}</span>
                <div class="history-compare-card-meta">
                    <div class="history-compare-card-title">${escapeHtml(fav.name || '—')}</div>
                    <div class="saved-fav-compare-score ${sc}">${Number(pair.totalScore) || '—'} (${gLet})</div>
                </div>
            </div>
            <div class="saved-fav-compare-primers">
                <div><span class="text-muted">F</span> <code>${escapeHtml(shortTemplatePreview(f.sequence, 36))}</code></div>
                <div><span class="text-muted">R</span> <code>${escapeHtml(shortTemplatePreview(r.sequence, 36))}</code></div>
            </div>
            <dl class="history-compare-dl saved-fav-compare-dl">
                <div><dt>Продукт</dt><dd>${escapeHtml(String(prod))} п.н.</dd></div>
                <div><dt>ΔTm</dt><dd>${tmDiff.toFixed(1)}°C</dd></div>
                <div><dt>GC-clamp</dt><dd>${checkGCClamp(f.sequence) && checkGCClamp(r.sequence) ? '✅' : '❌'}</dd></div>
            </dl>
            <button type="button" class="btn btn-small btn-primary saved-fav-compare-load-btn" data-saved-id="${sid}">В дизайн</button>
        </div>`;
    };

    const modal = document.createElement('div');
    modal.className = 'history-compare-modal saved-fav-compare-modal pd-modal-overlay';
    modal.setAttribute('role', 'presentation');
    modal.innerHTML = `
        <div class="history-compare-modal-content pd-modal" role="dialog" aria-modal="true" aria-labelledby="saved-fav-compare-title">
            <button type="button" class="history-compare-close pd-modal-close" aria-label="Закрыть">×</button>
            <h3 class="pd-modal-title" id="saved-fav-compare-title">🔬 Сравнение в группе</h3>
            <p class="pd-modal-sub">До 4 вариантов с лучшим баллом. ${title}</p>
            <div class="history-compare-grid saved-fav-compare-grid">
                ${top.map((fav, i) => card(i + 1, fav)).join('')}
            </div>
            <div class="pd-modal-actions history-compare-actions">
                <button type="button" class="btn btn-primary" id="saved-fav-compare-ok">Закрыть</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const closeModal = () => {
        modal.remove();
        document.removeEventListener('keydown', onKey);
    };
    const onKey = (ev) => {
        if (ev.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', onKey);

    modal.querySelector('.history-compare-close')?.addEventListener('click', closeModal);
    modal.querySelector('#saved-fav-compare-ok')?.addEventListener('click', closeModal);
    modal.addEventListener('click', (ev) => {
        if (ev.target === modal) closeModal();
    });

    modal.querySelectorAll('.saved-fav-compare-load-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-saved-id');
            const item = favorites.find((x) => String(x.id) === String(id));
            if (item && applyFavoritePairToDesign(item)) closeModal();
            else showWarning('Не удалось загрузить пару');
        });
    });
}

/**
 * @param {any[]} saved
 * @param {string} groupBy
 * @returns {null | { title: string, primers: any[], count: number, bestScore: number, avgScore: number }[]}
 */
function groupSavedPrimers(saved, groupBy) {
    if (groupBy === 'sequence') {
        const arr = savedGroupStatsEngine.groupFavoritesBySequence(saved);
        return arr.map((sg) => ({
            title:
                (sg.geneName && String(sg.geneName).trim()) ||
                (sg.sequencePreview && String(sg.sequencePreview).slice(0, 56)) ||
                'Последовательность',
            primers: [...sg.favorites].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)),
            count: sg.count,
            bestScore: sg.bestScore,
            avgScore: sg.avgScore,
            savedSequenceGroup: sg,
        }));
    }
    if (groupBy === 'gene') {
        const map = new Map();
        for (const item of saved) {
            const gene = geneLabelFromFavoriteItem(item);
            if (!map.has(gene)) {
                map.set(gene, {
                    title: gene,
                    primers: [],
                    count: 0,
                    bestScore: 0,
                    avgScore: 0,
                });
            }
            const g = map.get(gene);
            g.primers.push(item);
            g.count += 1;
            const sc = Number(item.pair?.totalScore) || 0;
            g.bestScore = Math.max(g.bestScore, sc);
            g.avgScore = (g.avgScore * (g.count - 1) + sc) / g.count;
        }
        return Array.from(map.values()).sort((a, b) => a.title.localeCompare(b.title, 'ru'));
    }
    if (groupBy === 'score') {
        const bands = [
            { title: 'Отличные (≥90)', primers: [] },
            { title: 'Хорошие (70–89)', primers: [] },
            { title: 'Приемлемые (50–69)', primers: [] },
            { title: 'Требуют оптимизации (<50)', primers: [] },
        ];
        for (const item of saved) {
            const sc = Number(item.pair?.totalScore) || 0;
            if (sc >= 90) bands[0].primers.push(item);
            else if (sc >= 70) bands[1].primers.push(item);
            else if (sc >= 50) bands[2].primers.push(item);
            else bands[3].primers.push(item);
        }
        return bands
            .filter((b) => b.primers.length)
            .map((b) => ({
                title: b.title,
                primers: b.primers,
                count: b.primers.length,
                bestScore: Math.max(...b.primers.map((p) => Number(p.pair?.totalScore) || 0)),
                avgScore:
                    b.primers.reduce((s, p) => s + (Number(p.pair?.totalScore) || 0), 0) /
                    b.primers.length,
            }));
    }
    if (groupBy === 'date') {
        const map = new Map();
        for (const item of saved) {
            const key = new Date(item.timestamp || 0).toLocaleDateString();
            if (!map.has(key)) {
                map.set(key, {
                    title: key,
                    primers: [],
                    count: 0,
                    bestScore: 0,
                    avgScore: 0,
                    lastTs: 0,
                });
            }
            const g = map.get(key);
            g.primers.push(item);
            g.count += 1;
            const sc = Number(item.pair?.totalScore) || 0;
            g.bestScore = Math.max(g.bestScore, sc);
            g.avgScore = (g.avgScore * (g.count - 1) + sc) / g.count;
            g.lastTs = Math.max(g.lastTs, item.timestamp || 0);
        }
        return Array.from(map.values()).sort((a, b) => b.lastTs - a.lastTs);
    }
    return null;
}

function ensureSavedFolderSelectionValid(folders) {
    if (!folders || !folders[selectedSavedFolderId]) {
        selectedSavedFolderId = ROOT_FOLDER_ID;
    }
}

function expandSavedFolderAncestors(folderId, folders) {
    let p = folders[folderId]?.parentId;
    while (p) {
        expandedSavedFolderIds.add(p);
        p = folders[p]?.parentId;
    }
}

/** @param {string} color */
function safeFolderColor(color) {
    const s = String(color || '');
    return /^#[0-9A-Fa-f]{6}$/.test(s) ? s : '#475569';
}

/**
 * @param {Record<string, any>} folders
 * @param {Record<string, number>} primerCounts
 */
function renderSavedFolderNodeHtml(folderId, folders, primerCounts) {
    const f = folders[folderId];
    if (!f) return '';
    const childIds = f.children || [];
    const hasCh = childIds.length > 0;
    const expanded = expandedSavedFolderIds.has(folderId);
    const sel = selectedSavedFolderId === folderId ? ' selected' : '';
    const pc = primerCounts[folderId] ?? 0;
    const meta = f.metadata || {};
    const color = safeFolderColor(meta.color);
    const icon = meta.icon || '📁';
    const idEsc = escapeHtml(folderId);
    let html = `<div class="folder-node" data-folder-id="${idEsc}">`;
    html += `<div class="folder-node-header${sel}" data-folder-id="${idEsc}" role="treeitem" aria-expanded="${hasCh ? String(expanded) : 'false'}" aria-selected="${selectedSavedFolderId === folderId ? 'true' : 'false'}">`;
    html += `<span class="folder-expand ${hasCh ? 'has-children' : ''}" data-folder-id="${idEsc}">${hasCh ? (expanded ? '▼' : '▶') : '\u00a0'}</span>`;
    html += `<span class="folder-icon" aria-hidden="true">${icon}</span>`;
    html += `<span class="folder-name" style="color:${escapeHtml(color)}">${escapeHtml(f.name)}</span>`;
    html += `<span class="folder-stats-mini">`;
    if (pc > 0) html += `<span class="folder-stat-p" title="Праймеров в папке">${pc}</span>`;
    if (hasCh) html += `<span class="folder-stat-s" title="Подпапок">${childIds.length}</span>`;
    html += `</span><span class="folder-actions">`;
    html += `<button type="button" class="folder-action-btn" data-action="new" data-folder-id="${idEsc}" title="Создать подпапку">➕</button>`;
    if (!f.isSystem) {
        html += `<button type="button" class="folder-action-btn" data-action="edit" data-folder-id="${idEsc}" title="Изменить">✏️</button>`;
        html += `<button type="button" class="folder-action-btn" data-action="delete" data-folder-id="${idEsc}" title="Удалить">🗑️</button>`;
    }
    html += '</span></div>';
    if (hasCh && expanded) {
        html += '<div class="folder-children" role="group">';
        for (const cid of childIds) {
            html += renderSavedFolderNodeHtml(cid, folders, primerCounts);
        }
        html += '</div>';
    }
    html += '</div>';
    return html;
}

function renderSavedFolderTreeHtml(folders, primerCounts) {
    return renderSavedFolderNodeHtml(ROOT_FOLDER_ID, folders, primerCounts);
}

/**
 * @param {any} item
 * @param {Record<string, any>} folders
 */
function buildSavedFolderMoveRowHtml(item, folders) {
    const opts = FolderManager.flatFolderOptions(folders);
    const cur = normalizeFavoriteFolderId(item.folderId);
    const optsHtml = opts
        .map(
            (o) =>
                `<option value="${escapeHtml(o.id)}"${o.id === cur ? ' selected' : ''}>${escapeHtml(o.label)}</option>`,
        )
        .join('');
    return `<div class="saved-folder-move-row">
        <label class="saved-folder-move-label text-muted" for="saved-folder-sel-${item.id}">Папка</label>
        <select id="saved-folder-sel-${item.id}" class="saved-folder-move-select" data-saved-id="${item.id}">${optsHtml}</select>
    </div>`;
}

function buildSavedItemCardHtml(item, folders = null) {
    const date = new Date(item.timestamp).toLocaleDateString();
    const dateFull = new Date(item.timestamp).toLocaleString();
    const pair = item.pair || {};
    const g = pair.grade || {};
    const f = pair.forward || {};
    const r = pair.reverse || {};
    const fTm = f.details?.tm?.value;
    const rTm = r.details?.tm?.value;
    const fGc = f.details?.gc?.value;
    const rGc = r.details?.gc?.value;
    const prod =
        f.start != null && r.end != null ? Math.max(0, r.end - f.start) : '—';
    const tmDiff = Math.abs((Number(fTm) || 0) - (Number(rTm) || 0));
    const gcBalance = Math.abs((Number(fGc) || 0) - (Number(rGc) || 0));
    const multiplex = calculateSavedMultiplexScore(pair);
    const application = escapeHtml(getSavedApplicationRecommendation(pair));
    const gcClampOk = checkGCClamp(f.sequence) && checkGCClamp(r.sequence);
    const tmWarn = tmDiff > 3 ? ' saved-metric-warn' : '';
    const gcWarn = gcBalance > 10 ? ' saved-metric-warn' : '';
    const mxClass =
        multiplex >= 70 ? 'saved-multiplex-good' : 'saved-multiplex-warn';
    const tpl = item.sequence
        ? `<div class="saved-template-snippet text-muted">Шаблон: <code>${escapeHtml(shortTemplatePreview(item.sequence, 56))}</code></div>`
        : '';
    const warnBlock =
        Array.isArray(pair.warnings) && pair.warnings.length
            ? `<div class="saved-warnings">⚠️ ${escapeHtml(pair.warnings.slice(0, 3).join('; '))}</div>`
            : '';
    const scClass = getSavedScoreClass(pair.totalScore);
    const historyMeta =
        item.historyEntryId != null && String(item.historyEntryId) !== ''
            ? `<div class="saved-history-ref text-muted" title="Из журнала дизайнов">📜 Запись истории: ${escapeHtml(String(item.historyEntryId))}</div>`
            : '';

    return `
            <div class="saved-item" data-saved-id="${item.id}">
                <div class="saved-header">
                    <span class="saved-name">${escapeHtml(item.name)}</span>
                    ${item.feedback ? '<span class="has-feedback" title="Есть отзыв">📝</span>' : ''}
                    <span class="saved-date" title="${escapeHtml(dateFull)}">${date}</span>
                </div>
                ${historyMeta}
                ${tpl}
                <div class="saved-preview">
                    <div class="saved-grade ${scClass}" style="border: 1px solid transparent">
                        ${g.letter || '—'} (${pair.totalScore ?? '—'})
                    </div>
                    <div class="saved-seqs">
                        <div class="saved-seq saved-forward">
                            <span class="seq-label">F:</span>
                            <code class="seq-code">${escapeHtml(formatSequence(f.sequence || ''))}</code>
                        </div>
                        <div class="saved-seq saved-reverse">
                            <span class="seq-label">R:</span>
                            <code class="seq-code">${escapeHtml(formatSequence(r.sequence || ''))}</code>
                        </div>
                    </div>
                    <div class="saved-stats">
                        <span>Tm: ${fTm != null ? fTm.toFixed(1) : 'N/A'}°C / ${rTm != null ? rTm.toFixed(1) : 'N/A'}°C</span>
                        <span>GC: ${fGc != null ? fGc.toFixed(1) : 'N/A'}% / ${rGc != null ? fGc.toFixed(1) : 'N/A'}%</span>
                        <span>Продукт: ${prod} п.н.</span>
                    </div>
                    <div class="saved-bio-metrics">
                        <span class="saved-metric${tmWarn}" title="Разница Tm F/R">ΔTm ${tmDiff.toFixed(1)}°C</span>
                        <span class="saved-metric${gcWarn}" title="Разница GC F/R">ΔGC ${gcBalance.toFixed(1)}%</span>
                        <span class="saved-metric">GC-clamp ${gcClampOk ? '✅' : '❌'}</span>
                        <span class="saved-metric ${mxClass}" title="Эвристика мультиплекса">Мультиплекс ~${multiplex}%</span>
                    </div>
                    <div class="saved-application-row text-muted">
                        <span class="saved-app-label">Применение:</span> ${application}
                    </div>
                    ${warnBlock}
                </div>
                <div class="saved-card-footer text-muted">Добавлено: ${escapeHtml(dateFull)}</div>
                ${folders ? buildSavedFolderMoveRowHtml(item, folders) : ''}
                <div class="saved-actions">
                    <button type="button" class="action-btn small saved-save-file-btn" data-saved-id="${item.id}" title="Экспортировать элемент в JSON-файл">⬇ В файл</button>
                    <button type="button" class="action-btn copy-btn saved-copy-fwd" data-seq="${escapeHtml(f.sequence || '')}">📋 Fwd</button>
                    <button type="button" class="action-btn copy-btn saved-copy-rev" data-seq="${escapeHtml(r.sequence || '')}">📋 Rev</button>
                    <button type="button" class="action-btn saved-feedback-btn" data-saved-id="${item.id}">📝 Отзыв</button>
                    <button type="button" class="action-btn small delete saved-delete-btn" data-saved-id="${item.id}">🗑️</button>
                </div>
                <div class="saved-export-formats" role="group" aria-label="Экспорт пары (как на дизайне)">
                    <span class="saved-export-formats-label">PDF / Excel / CSV / HTML:</span>
                    <button type="button" class="action-btn small favorite-export-format-btn" data-saved-id="${item.id}" data-format="pdf" title="PDF / печать">📄 PDF</button>
                    <button type="button" class="action-btn small favorite-export-format-btn" data-saved-id="${item.id}" data-format="excel" title="Excel">📊 Excel</button>
                    <button type="button" class="action-btn small favorite-export-format-btn" data-saved-id="${item.id}" data-format="csv" title="CSV">📈 CSV</button>
                    <button type="button" class="action-btn small favorite-export-format-btn" data-saved-id="${item.id}" data-format="html" title="HTML">🖨️ HTML</button>
                </div>
            </div>`;
}

function renderSavedMiniStatsBar(items, allSavedForGroups) {
    if (!items.length) return '';
    const n = items.length;
    const scores = items
        .map((i) => Number(i.pair?.totalScore))
        .filter((x) => Number.isFinite(x));
    const best = scores.length ? Math.max(...scores) : '—';
    const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : '—';
    const withFb = items.filter((i) => i.feedback).length;
    const base = allSavedForGroups || items;
    const uniqSeq = savedGroupStatsEngine.groupFavoritesBySequence(base).length;
    return `
        <div class="saved-mini-stats">
            <span><strong>${n}</strong> в списке</span>
            <span>Уник. шаблонов: <strong>${uniqSeq}</strong></span>
            <span>Лучшая оценка: <strong>${best}</strong></span>
            <span>Средняя оценка: <strong>${avg}</strong></span>
            <span>С отзывом: <strong>${withFb}</strong></span>
        </div>`;
}

/** Сводка по полной истории дизайнов (перенесено с вкладки «История»). */
function renderHistoryJournalStatsBar(h) {
    if (!h || !h.total) {
        return `<div class="saved-history-journal-stats saved-history-journal-stats--empty">
            <span class="saved-history-journal-title">Журнал дизайнов</span>
            <span class="text-muted">Нет записей в истории</span>
        </div>`;
    }
    return `
        <div class="saved-history-journal-stats">
            <span class="saved-history-journal-title">Журнал дизайнов (вся история)</span>
            <div class="saved-history-journal-grid">
                <span>Средняя оценка: <strong>${h.avgScore || '—'}</strong></span>
                <span>Лучшая оценка: <strong>${h.bestScore || '—'}</strong></span>
                <span>Средн. пар: <strong>${h.avgPairs ?? '—'}</strong></span>
            </div>
        </div>`;
}

async function handleSavedFolderTreeClick(e) {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const exp = t.closest('.folder-expand.has-children');
    if (exp) {
        e.stopPropagation();
        const id = exp.getAttribute('data-folder-id');
        if (id) {
            if (expandedSavedFolderIds.has(id)) expandedSavedFolderIds.delete(id);
            else expandedSavedFolderIds.add(id);
            await loadSavedPrimers();
        }
        return;
    }
    const act = t.closest('.folder-action-btn');
    if (act) {
        e.stopPropagation();
        const action = act.getAttribute('data-action');
        const fid = act.getAttribute('data-folder-id');
        if (!fid) return;
        if (action === 'new') {
            await openSavedFolderModal('create', fid);
            return;
        }
        if (action === 'edit') {
            await openSavedFolderModal('edit', fid);
            return;
        }
        if (action === 'delete') {
            if (
                !confirm(
                    'Удалить папку? Записи и подпапки будут перенесены в корень («Все праймеры»).',
                )
            ) {
                return;
            }
            try {
                await savedFolderManager.deleteFolder(fid, ROOT_FOLDER_ID);
                if (selectedSavedFolderId === fid) selectedSavedFolderId = ROOT_FOLDER_ID;
                showNotification('Папка удалена');
                await loadSavedPrimers();
            } catch (err) {
                const msg =
                    err && typeof err === 'object' && 'message' in err ? err.message : String(err);
                showWarning(msg || 'Ошибка удаления');
            }
        }
        return;
    }
    const hdr = t.closest('.folder-node-header');
    if (hdr && !t.closest('.folder-expand') && !t.closest('.folder-action-btn')) {
        const id = hdr.getAttribute('data-folder-id');
        if (id) {
            selectedSavedFolderId = id;
            const folders = await savedFolderManager.getStructure();
            expandSavedFolderAncestors(id, folders);
            await loadSavedPrimers();
        }
    }
}

async function handleSavedFolderMoveChange(e) {
    const t = e.target;
    if (!(t instanceof HTMLSelectElement)) return;
    if (!t.classList.contains('saved-folder-move-select')) return;
    const sid = t.getAttribute('data-saved-id');
    const fid = t.value || ROOT_FOLDER_ID;
    const ok = await savedFolderManager.setFavoriteFolder(sid, fid);
    if (ok) {
        showNotification('Запись перемещена');
        await loadSavedPrimers();
    } else {
        showWarning('Не удалось сменить папку');
    }
}

function closeSavedFolderModal() {
    const el = document.getElementById('folder-modal-overlay');
    if (el) el.hidden = true;
}

/**
 * @param {'create' | 'edit'} mode
 * @param {string} folderOrParentId для create — parentId; для edit — id папки
 */
async function openSavedFolderModal(mode, folderOrParentId) {
    const overlay = document.getElementById('folder-modal-overlay');
    const title = document.getElementById('folder-modal-title');
    const modeEl = document.getElementById('folder-modal-mode');
    const parentEl = document.getElementById('folder-modal-parent-id');
    const targetEl = document.getElementById('folder-modal-target-id');
    const nameEl = document.getElementById('folder-modal-name');
    const descEl = document.getElementById('folder-modal-desc');
    const colorEl = document.getElementById('folder-modal-color');
    const iconEl = document.getElementById('folder-modal-icon');
    if (!overlay || !modeEl || !parentEl || !targetEl) return;

    modeEl.value = mode;
    if (mode === 'create') {
        if (title) title.textContent = 'Новая папка';
        parentEl.value = folderOrParentId || ROOT_FOLDER_ID;
        targetEl.value = '';
        if (nameEl) nameEl.value = '';
        if (descEl) descEl.value = '';
        if (colorEl) colorEl.selectedIndex = 0;
        if (iconEl) iconEl.selectedIndex = 0;
    } else {
        if (title) title.textContent = 'Редактировать папку';
        targetEl.value = folderOrParentId;
        parentEl.value = '';
        const folders = await savedFolderManager.getStructure();
        const f = folders[folderOrParentId];
        if (f) {
            if (nameEl) nameEl.value = f.name || '';
            if (descEl) descEl.value = f.metadata?.description || '';
            if (colorEl) colorEl.value = safeFolderColor(f.metadata?.color) || '#3b82f6';
            if (iconEl) iconEl.value = f.metadata?.icon || '📂';
        }
    }
    overlay.hidden = false;
    if (nameEl) nameEl.focus();
}

async function submitSavedFolderModal() {
    const mode = document.getElementById('folder-modal-mode')?.value;
    const parentId = document.getElementById('folder-modal-parent-id')?.value || ROOT_FOLDER_ID;
    const targetId = document.getElementById('folder-modal-target-id')?.value || '';
    const name = document.getElementById('folder-modal-name')?.value?.trim() || '';
    const desc = document.getElementById('folder-modal-desc')?.value || '';
    const color = document.getElementById('folder-modal-color')?.value || '#3b82f6';
    const icon = document.getElementById('folder-modal-icon')?.value || '📂';
    if (!name) {
        showWarning('Введите название папки');
        return;
    }
    try {
        if (mode === 'create') {
            await savedFolderManager.createFolder(name, parentId, {
                description: desc,
                color,
                icon,
            });
            expandedSavedFolderIds.add(parentId);
            showNotification('Папка создана');
        } else {
            await savedFolderManager.updateFolderMeta(targetId, {
                name,
                description: desc,
                color,
                icon,
            });
            showNotification('Папка обновлена');
        }
        closeSavedFolderModal();
        await loadSavedPrimers();
    } catch (err) {
        const msg =
            err && typeof err === 'object' && 'message' in err ? err.message : String(err);
        showWarning(msg || 'Ошибка');
    }
}

function initSavedPanel() {
    if (document.body.dataset.savedPanelInit) return;
    document.body.dataset.savedPanelInit = '1';

    document.getElementById('saved-search')?.addEventListener('input', scheduleSavedListReload);
    document.getElementById('saved-group-by')?.addEventListener('change', () => loadSavedPrimers());
    document.getElementById('saved-sort')?.addEventListener('change', () => loadSavedPrimers());

    document.getElementById('saved-export')?.addEventListener('click', async () => {
        /** Полный список из хранилища (не отфильтрованный список на экране). */
        const arr = await storage.get('savedPrimers') || [];
        if (!arr.length) {
            showWarning('В избранном нет элементов для экспорта');
            return;
        }
        const blob = new Blob([JSON.stringify(arr, null, 2)], {
            type: 'application/json;charset=utf-8',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `favorites-all-${arr.length}-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showNotification(`Экспортировано элементов избранного: ${arr.length} (JSON)`);
    });

    document.getElementById('saved-export-folder')?.addEventListener('click', async () => {
        const raw = await storage.get('savedPrimers') || [];
        const inFolder = raw.filter(
            (p) => normalizeFavoriteFolderId(p.folderId) === selectedSavedFolderId,
        );
        const q = document.getElementById('saved-search')?.value || '';
        const items = filterSavedPrimers(inFolder, q);
        if (!items.length) {
            showWarning('Нет записей для экспорта в этой папке');
            return;
        }
        const blob = new Blob([JSON.stringify(items, null, 2)], {
            type: 'application/json;charset=utf-8',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `favorites-folder-${selectedSavedFolderId}-${items.length}-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showNotification(`Экспорт папки: ${items.length} записей (JSON)`);
    });

    document.getElementById('new-folder-root-btn')?.addEventListener('click', () => {
        openSavedFolderModal('create', ROOT_FOLDER_ID).catch(() => {});
    });

    document.getElementById('folder-tree')?.addEventListener('click', (e) => {
        handleSavedFolderTreeClick(e).catch(() => {});
    });

    document.getElementById('saved-list')?.addEventListener('change', (e) => {
        handleSavedFolderMoveChange(e).catch(() => {});
    });

    document.getElementById('folder-modal-close')?.addEventListener('click', closeSavedFolderModal);
    document.getElementById('folder-modal-cancel')?.addEventListener('click', closeSavedFolderModal);
    document.getElementById('folder-modal-save')?.addEventListener('click', () => {
        submitSavedFolderModal().catch(() => {});
    });
    document.getElementById('folder-modal-overlay')?.addEventListener('click', (e) => {
        if (e.target === document.getElementById('folder-modal-overlay')) closeSavedFolderModal();
    });

    document.getElementById('saved-compare')?.addEventListener('click', async () => {
        const raw = await storage.get('history') || [];
        if (raw.length < 2) {
            showWarning('В журнале дизайнов нужно минимум две записи');
            return;
        }
        const gs = new HistoryGroupStats();
        const groups = gs.groupBySequence(raw);
        const sorted = [...groups].sort((a, b) => (b.bestScore || 0) - (a.bestScore || 0));
        const a = sorted[0];
        const b = sorted[1];
        if (!a || !b) {
            showWarning('Недостаточно разных последовательностей в истории для сравнения');
            return;
        }
        openHistoryCompareModal(a, b);
    });

    document.getElementById('saved-clear-all')?.addEventListener('click', async () => {
        const arr = await storage.get('savedPrimers') || [];
        if (!arr.length) {
            showWarning('В избранном уже пусто');
            return;
        }
        if (
            !confirm(
                `Удалить все элементы из избранного (${arr.length} шт.)? Это действие нельзя отменить.`,
            )
        ) {
            return;
        }
        await storage.set('savedPrimers', []);
        await savedFolderManager.resetToRootOnly();
        selectedSavedFolderId = ROOT_FOLDER_ID;
        expandedSavedFolderIds.clear();
        expandedSavedFolderIds.add(ROOT_FOLDER_ID);
        const stats = await storage.get('stats') || {
            primersDesigned: 0,
            savedPrimers: 0,
            syncsCompleted: 0,
            installDate: Date.now(),
        };
        stats.savedPrimers = 0;
        await storage.set('stats', stats);
        await loadSavedPrimers();
        await loadStats();
        showNotification('Избранное очищено');
    });
}

async function loadSavedPrimers() {
    const raw = await storage.get('savedPrimers') || [];
    const container = document.getElementById('saved-list');
    const toolbar = document.getElementById('saved-toolbar');
    const statsBar = document.getElementById('saved-stats');
    const sidebar = document.getElementById('saved-folder-sidebar');
    const exportFolderBtn = document.getElementById('saved-export-folder');
    const treeEl = document.getElementById('folder-tree');
    if (!container) return;

    if (raw.length === 0) {
        lastSavedRenderedGroups = [];
        if (toolbar) toolbar.style.display = 'none';
        if (statsBar) {
            statsBar.innerHTML = '';
            statsBar.style.display = 'none';
        }
        if (sidebar) sidebar.style.display = 'none';
        if (exportFolderBtn) exportFolderBtn.style.display = 'none';
        if (treeEl) treeEl.innerHTML = '';
        container.innerHTML = `
            <div class="saved-empty-state">
                <div class="empty-state">
                    <span class="empty-icon">📭</span>
                    <p>В избранном пока ничего нет</p>
                    <p class="history-empty-hint">На вкладке «Дизайн» после подбора праймеров нажмите ⭐ В избранное у нужной пары — элементы появятся здесь.</p>
                </div>
            </div>
        `;
        return;
    }

    const folders = await savedFolderManager.getStructure();
    ensureSavedFolderSelectionValid(folders);
    expandSavedFolderAncestors(selectedSavedFolderId, folders);

    if (sidebar) {
        sidebar.style.display = 'flex';
        const primerCounts = FolderManager.computePrimerCounts(folders, raw);
        if (treeEl) treeEl.innerHTML = renderSavedFolderTreeHtml(folders, primerCounts);
    }

    if (toolbar) toolbar.style.display = '';
    const q = document.getElementById('saved-search')?.value || '';
    const groupBy = document.getElementById('saved-group-by')?.value || 'none';
    const sortBy = document.getElementById('saved-sort')?.value || 'date-desc';

    const inFolder = raw.filter(
        (p) => normalizeFavoriteFolderId(p.folderId) === selectedSavedFolderId,
    );
    let working = filterSavedPrimers(inFolder, q);
    working = sortSavedPrimersList(working, sortBy);

    if (exportFolderBtn) {
        exportFolderBtn.style.display = working.length > 0 ? '' : 'none';
    }

    const activeFolderName = folders[selectedSavedFolderId]?.name || '—';
    const folderBar = `<div class="saved-active-folder-bar text-muted">📁 <strong>${escapeHtml(activeFolderName)}</strong> · в папке <strong>${working.length}</strong> из <strong>${inFolder.length}</strong> (с учётом поиска)</div>`;

    if (statsBar) {
        statsBar.style.display = 'block';
        const histStats = await historyManager.getStats();
        statsBar.innerHTML =
            folderBar +
            renderSavedMiniStatsBar(working, raw) +
            renderHistoryJournalStatsBar(histStats);
    }

    const groups = groupSavedPrimers(working, groupBy);
    if (groups && groups.length) {
        lastSavedRenderedGroups = groups;
        let html = '';
        for (let i = 0; i < groups.length; i++) {
            const g = groups[i];
            const banner = g.savedSequenceGroup
                ? renderSavedSequenceGroupBanner(g.savedSequenceGroup)
                : '';
            const compareBtn =
                g.savedSequenceGroup && g.count >= 2
                    ? `<button type="button" class="btn btn-small btn-outline saved-group-compare-btn" data-saved-group-idx="${i}">🔬 Сравнить в группе</button>`
                    : '';
            html += `
            <div class="saved-group">
                <div class="saved-group-header">
                    <div class="saved-group-header-text">
                        <span class="saved-group-title">${escapeHtml(g.title)}</span>
                        <span class="saved-group-meta">${g.count} шт. · лучший ${Math.round(g.bestScore)} · ср. ${Math.round(g.avgScore)}</span>
                    </div>
                    <div class="saved-group-header-actions">
                        ${compareBtn}
                        <button type="button" class="saved-expand" aria-label="Свернуть группу" aria-expanded="true">▲</button>
                    </div>
                </div>
                ${banner}
                <div class="saved-group-content" style="display: block;">
                    ${g.primers.map((item) => buildSavedItemCardHtml(item, folders)).join('')}
                </div>
            </div>`;
        }
        container.innerHTML = html;
        return;
    }

    lastSavedRenderedGroups = [];
    container.innerHTML = working.map((item) => buildSavedItemCardHtml(item, folders)).join('');
}

async function loadHistory() {
    await refreshHistoryView();
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
    const el = document.getElementById('results-primers');
    if (el) el.innerHTML = `<div class="error">❌ ${message}</div>`;
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

function showWarning(message) {
    const notification = document.createElement('div');
    notification.className = 'notification notification-warning';
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 4500);
}

async function clearForm() {
    document.getElementById('sequence').value = '';
    const rp = document.getElementById('results-primers');
    if (rp) rp.innerHTML = '';
    const od = document.getElementById('overlap-dynamic');
    if (od) od.innerHTML = '';
    const os = document.getElementById('overlap-pagination-strip');
    if (os) os.innerHTML = overlapPaginationIdleHtml();
    setPanelRightAnalysisVisible(false);
    const connectionWarning = document.getElementById('connection-warning');
    if (connectionWarning) connectionWarning.style.display = 'none';
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

async function useNCBIDataAndDesign() {
    await useNCBIData();
    if (currentSequence && currentSequence.length >= 50 && designHandlers) {
        designHandlers.designPrimers();
    }
}

async function saveSettings() {
    const forceOfflineEl = document.getElementById('force-offline');
    settings = {
        defaultTm: parseFloat(document.getElementById('tm').value),
        defaultGc: parseFloat(document.getElementById('gc').value),
        primerLength: parseInt(document.getElementById('length').value, 10),
        autoSync: document.getElementById('auto-sync').checked,
        notifications: document.getElementById('notifications').checked,
        autoDesign: document.getElementById('auto-design').checked,
        theme: document.getElementById('theme').value,
        forceOfflineMode: forceOfflineEl ? forceOfflineEl.checked : false
    };

    await storage.set('settings', settings);
    updateStatusDisplay();
}

async function exportData() {
    const data = await storage.exportAll();
    const feedbacks = await storage.get('feedbacks');
    if (feedbacks && Array.isArray(feedbacks)) {
        data.feedbacks = feedbacks;
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `primer-designer-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
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

/**
 * Модальное окно сравнения двух групп истории (по последовательности).
 * @param {object} a
 * @param {object} b
 */
function openHistoryCompareModal(a, b) {
    const preview = (g) => escapeHtml(g.sequencePreview || (g.sequence || '').slice(0, 56) || '—');
    const gene = (g) =>
        g.geneName
            ? `<div class="history-compare-gene text-muted">${escapeHtml(String(g.geneName))}</div>`
            : '';
    const num = (v) => escapeHtml(v != null && v !== '' ? String(v) : '—');

    const card = (rank, g) => `
        <div class="history-compare-card">
            <div class="history-compare-card-top">
                <span class="history-compare-rank" aria-hidden="true">${rank}</span>
                <div class="history-compare-card-meta">
                    <div class="history-compare-card-title">Последовательность</div>
                    ${gene(g)}
                </div>
            </div>
            <code class="history-compare-seq">${preview(g)}</code>
            <dl class="history-compare-dl">
                <div><dt>Лучший балл</dt><dd>${num(g.bestScore)}</dd></div>
                <div><dt>Дизайнов</dt><dd>${num(g.designCount)}</dd></div>
                <div><dt>Длина, нт</dt><dd>${num(g.sequenceLength)}</dd></div>
                <div><dt>Ср. пар за дизайн</dt><dd>${num(g.avgPairs)}</dd></div>
            </dl>
        </div>`;

    const modal = document.createElement('div');
    modal.className = 'history-compare-modal pd-modal-overlay';
    modal.setAttribute('role', 'presentation');
    modal.innerHTML = `
        <div class="history-compare-modal-content pd-modal" role="dialog" aria-modal="true" aria-labelledby="history-compare-title">
            <button type="button" class="history-compare-close pd-modal-close" aria-label="Закрыть">×</button>
            <h3 class="pd-modal-title" id="history-compare-title">🔬 Сравнение</h3>
            <p class="pd-modal-sub">Две лучшие группы по последовательности (по лучшему баллу в группе) среди всех записей журнала дизайнов.</p>
            <div class="history-compare-grid">
                ${card(1, a)}
                ${card(2, b)}
            </div>
            <div class="pd-modal-actions history-compare-actions">
                <button type="button" class="btn btn-primary" id="history-compare-ok">Закрыть</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const closeModal = () => {
        modal.remove();
        document.removeEventListener('keydown', onKey);
    };
    const onKey = (ev) => {
        if (ev.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', onKey);

    modal.querySelector('.history-compare-close')?.addEventListener('click', closeModal);
    modal.querySelector('#history-compare-ok')?.addEventListener('click', closeModal);
    modal.addEventListener('click', (ev) => {
        if (ev.target === modal) closeModal();
    });
}

function openHelp() {
    chrome.tabs.create({ url: `${API_BASE_URL}/help` });
}

function feedbackResultLabelRu(value) {
    const m = {
        success: 'Успешно',
        partial: 'Частично',
        failed: 'Неудачно',
        nonspecific: 'Неспецифично',
        optimized: 'Нужна оптимизация',
    };
    return m[value] || value || '—';
}

/**
 * @param {object[]} entries
 */
function formatFeedbackHistoryListHtml(entries) {
    if (!entries.length) {
        return '<p class="feedback-history-empty text-muted">Пока нет сохранённых отзывов по этой паре.</p>';
    }
    return `<ul class="feedback-history-list">${entries
        .map((f) => {
            const ts = f.timestamp
                ? new Date(f.timestamp).toLocaleString()
                : f.date
                  ? new Date(f.date).toLocaleString()
                  : '—';
            const nl = (f.notes || '').trim();
            const notesEsc = escapeHtml(nl.length > 500 ? `${nl.slice(0, 500)}…` : nl);
            const shareTag = f.share ? ' · статистика' : '';
            return `<li class="feedback-history-item"><span class="feedback-history-meta">${escapeHtml(ts)} · ${escapeHtml(feedbackResultLabelRu(f.result))}${shareTag}</span><div class="feedback-history-notes">${notesEsc || '—'}</div></li>`;
        })
        .join('')}</ul>`;
}

/**
 * @param {Record<string, unknown>} body
 */
async function pushFeedbackToServer(body) {
    try {
        const headers = { 'Content-Type': 'application/json' };
        if (userManager.token) {
            headers.Authorization = `Bearer ${userManager.token}`;
        }
        const res = await fetch(`${API_BASE_URL}/api/feedback/`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const t = await res.text();
            throw new Error(t || String(res.status));
        }
        return true;
    } catch (e) {
        console.warn('PrimerDesigner: submit feedback API', e);
        return false;
    }
}

/**
 * Модальное окно отзыва о паре: история отзывов + форма; опционально POST на сервер.
 * @param {object} pair
 * @param {string|number|null} [savedId]
 * @param {string} [sequenceContext] контекст последовательности (мишень) для API
 */
async function openFeedbackForPair(pair, savedId = null, sequenceContext = '') {
    const norm = (s) => (s || '').replace(/\s/g, '').toUpperCase();
    const fwd = norm(pair.forward?.sequence);
    const rev = norm(pair.reverse?.sequence);
    const all = (await storage.get('feedbacks')) || [];
    const related = all
        .filter((f) => {
            if (savedId != null && f.savedId != null && String(f.savedId) === String(savedId)) {
                return true;
            }
            if (pair.id != null && f.pairId != null && String(f.pairId) === String(pair.id)) {
                return true;
            }
            return norm(f.forward) === fwd && norm(f.reverse) === rev && !!fwd;
        })
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    const historyHtml = formatFeedbackHistoryListHtml(related);

    const modal = document.createElement('div');
    modal.className = 'feedback-modal pd-modal-overlay';
    modal.innerHTML = `
        <div class="feedback-modal-content pd-modal feedback-modal-wide" role="dialog" aria-labelledby="feedback-modal-title">
            <div class="feedback-header">
                <h3 class="pd-modal-title" id="feedback-modal-title">📝 Отзыв о праймере</h3>
                <button type="button" class="feedback-close pd-modal-close" aria-label="Закрыть">×</button>
            </div>
            <div class="feedback-primer-info">
                <div class="feedback-primer forward">
                    <strong>Forward:</strong>
                    <code>${escapeHtml(pair.forward?.sequence || '')}</code>
                    <div class="primer-details">
                        Tm: ${pair.forward?.details?.tm?.value != null ? pair.forward.details.tm.value.toFixed(1) : 'N/A'}°C |
                        GC: ${pair.forward?.details?.gc?.value != null ? pair.forward.details.gc.value.toFixed(1) : 'N/A'}%
                    </div>
                </div>
                <div class="feedback-primer reverse">
                    <strong>Reverse:</strong>
                    <code>${escapeHtml(pair.reverse?.sequence || '')}</code>
                    <div class="primer-details">
                        Tm: ${pair.reverse?.details?.tm?.value != null ? pair.reverse.details.tm.value.toFixed(1) : 'N/A'}°C |
                        GC: ${pair.reverse?.details?.gc?.value != null ? pair.reverse.details.gc.value.toFixed(1) : 'N/A'}%
                    </div>
                </div>
                <div class="feedback-score">
                    Оценка: ${pair.totalScore ?? '—'} (${pair.grade?.letter || '—'})
                </div>
            </div>
            <div class="feedback-history-section">
                <h4 class="feedback-history-heading">Сохранённые отзывы</h4>
                <p class="feedback-history-hint text-muted">Локально и при синхронизации; при отправке на сервер — в базе PrimerDesigner.</p>
                <div class="feedback-history-scroll">${historyHtml}</div>
            </div>
            <div class="feedback-form">
                <label class="pd-field" for="feedback-result"><span>Результат эксперимента</span></label>
                <select id="feedback-result" class="feedback-select">
                    <option value="success">✅ Успешно (чёткая амплификация)</option>
                    <option value="partial">⚠️ Частично (слабый сигнал)</option>
                    <option value="failed">❌ Неудачно</option>
                    <option value="nonspecific">🎯 Неспецифично (несколько полос)</option>
                    <option value="optimized">✨ Требуется оптимизация</option>
                </select>
                <label class="pd-field" for="feedback-notes"><span>Комментарии</span></label>
                <textarea id="feedback-notes" rows="4" placeholder="Как работала пара, примечания…"></textarea>
                <label class="checkbox feedback-share-row">
                    <input type="checkbox" id="feedback-share">
                    <span>Поделиться анонимной статистикой (улучшение алгоритма) — также отправка на сервер</span>
                </label>
            </div>
            <div class="pd-modal-actions feedback-actions">
                <button type="button" class="btn btn-outline" id="cancel-feedback">Отмена</button>
                <button type="button" class="btn btn-primary" id="submit-feedback">💾 Сохранить отзыв</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const closeModal = () => modal.remove();
    modal.querySelector('.feedback-close')?.addEventListener('click', closeModal);
    modal.querySelector('#cancel-feedback')?.addEventListener('click', closeModal);
    modal.addEventListener('click', (ev) => {
        if (ev.target === modal) closeModal();
    });

    modal.querySelector('#submit-feedback')?.addEventListener('click', async () => {
        const result = /** @type {HTMLSelectElement} */ (modal.querySelector('#feedback-result'))?.value || 'success';
        const notes = /** @type {HTMLTextAreaElement} */ (modal.querySelector('#feedback-notes'))?.value || '';
        const share = /** @type {HTMLInputElement} */ (modal.querySelector('#feedback-share'))?.checked || false;

        const feedback = {
            pairId: pair.id,
            savedId: savedId != null ? savedId : undefined,
            forward: pair.forward?.sequence,
            reverse: pair.reverse?.sequence,
            forwardTm: pair.forward?.details?.tm?.value,
            reverseTm: pair.reverse?.details?.tm?.value,
            forwardGc: pair.forward?.details?.gc?.value,
            reverseGc: pair.reverse?.details?.gc?.value,
            score: pair.totalScore,
            grade: pair.grade?.letter,
            result,
            notes,
            share,
            date: new Date().toISOString(),
        };

        await storage.addFeedback(feedback);
        await updateHistoryWithFeedback({ ...feedback, id: Date.now(), timestamp: Date.now() });

        if (savedId != null) {
            const saved = await storage.get('savedPrimers') || [];
            const index = saved.findIndex((p) => String(p.id) === String(savedId));
            if (index !== -1) {
                saved[index] = {
                    ...saved[index],
                    feedback: { result, notes, timestamp: Date.now() },
                };
                await storage.set('savedPrimers', saved);
            }
        }

        await storage.updateStats({ feedbackCount: 1 });

        const tryServer = share || userManager.isAuthenticated();
        let serverOk = false;
        if (tryServer) {
            serverOk = await pushFeedbackToServer({
                sequence: String(sequenceContext || '').slice(0, 100000),
                forward: String(pair.forward?.sequence || '').slice(0, 256),
                reverse: String(pair.reverse?.sequence || '').slice(0, 256),
                result,
                notes: String(notes || '').slice(0, 8000),
                pairId: pair.id,
                savedId: savedId != null ? savedId : undefined,
                share,
                score: pair.totalScore,
                grade: pair.grade?.letter,
                userEmail: userManager.getUser()?.email || undefined,
            });
        }

        if (tryServer && serverOk) {
            showNotification('Отзыв сохранён и записан на сервере.');
        } else if (tryServer && !serverOk) {
            showWarning('Отзыв сохранён локально; сервер сейчас недоступен или отклонил запрос.');
        } else {
            showNotification('Отзыв сохранён локально.');
        }
        closeModal();

        if (savedId != null) {
            await loadSavedPrimers();
        }
    });
}

// Добавляем стили для секции пересечений
const overlapStyles = document.createElement('style');
overlapStyles.textContent = `
    .overlap-section.overlap-section-panel {
        margin: 0;
        padding: 0;
        background: transparent;
        border: none;
        border-radius: 0;
    }
    .overlap-section:not(.overlap-section-panel) {
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
        gap: 10px;
    }
    
    .overlap-card {
        padding: 12px;
        border-radius: 8px;
        border-left: 4px solid;
        transition: box-shadow 0.2s, border-color 0.2s;
        overflow-x: hidden;
        word-wrap: break-word;
        max-width: 100%;
        box-sizing: border-box;
    }
    
    .overlap-card:hover {
        box-shadow: 0 2px 8px rgba(0,0,0,0.08);
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
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: wrap;
        align-items: center;
        margin-bottom: 4px;
    }
    
    .overlap-num { font-weight: 700; font-size: 12px; color: #475569; background: #f1f5f9; padding: 2px 6px; border-radius: 4px; flex-shrink: 0; }
    .overlap-pairs {
        font-weight: 600;
        font-size: 13px;
        color: #1f2937;
        max-width: 100%;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
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

const statusStyles = document.createElement('style');
statusStyles.textContent = `
    .status-block { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
    .status-row { display: flex; align-items: center; gap: 8px; }
    .status-mode { font-size: 11px; font-weight: 600; padding: 2px 6px; border-radius: 4px; }
    .status-mode.mode-server { background: #dbeafe; color: #1d4ed8; }
    .status-mode.mode-local { background: #fef3c7; color: #b45309; }
    .status-mode-toggle { font-size: 10px; padding: 2px 8px; border: 1px solid #e2e8f0; border-radius: 4px; background: #f8fafc; color: #64748b; cursor: pointer; }
    .status-mode-toggle:hover { background: #e2e8f0; color: #334155; }
    .connection-warning { display: flex; align-items: flex-start; gap: 8px; margin: 12px 0; padding: 12px; background: #fffbeb; border: 1px solid #f59e0b; border-radius: 8px; font-size: 12px; color: #92400e; }
    .connection-warning-icon { flex-shrink: 0; }
    .connection-warning code { font-size: 11px; background: rgba(0,0,0,0.06); padding: 1px 4px; border-radius: 4px; }
    .notification { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); padding: 10px 16px; border-radius: 8px; font-size: 13px; z-index: 9999; box-shadow: 0 4px 12px rgba(0,0,0,0.15); background: #334155; color: #fff; }
    .notification-warning { background: #b45309; color: #fff; border: 1px solid #92400e; }
    .risk-explanation { margin: 12px 0; padding: 12px; background: #fffbeb; border: 1px solid #f59e0b; border-radius: 8px; font-size: 12px; color: #92400e; }
    .same-forward-indicator { margin: 0 0 8px 0; padding: 6px 10px; background: #eff6ff; border-left: 3px solid #3b82f6; border-radius: 4px; font-size: 11px; color: #1d4ed8; }
    .result-card.result-card-highlighted { background: rgba(239, 246, 255, 0.6); }
    .viz-zoom-toolbar { display: flex; align-items: center; gap: 10px; margin: 12px 0 4px 0; }
    .viz-zoom-label { font-size: 12px; color: #64748b; }
    .viz-zoom-slider { -webkit-appearance: none; appearance: none; flex: 1; min-width: 80px; max-width: 200px; height: 6px; margin: 0; background: #e2e8f0; border-radius: 3px; outline: none; }
    .viz-zoom-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 14px; height: 14px; border-radius: 50%; background: #3b82f6; cursor: pointer; }
    .viz-zoom-slider::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: #3b82f6; cursor: pointer; border: none; }
    .viz-zoom-value { font-size: 12px; color: #64748b; min-width: 44px; }
    .viz-scroll-wrapper { width: 100%; max-width: 100%; overflow-x: auto; overflow-y: hidden; margin: 0; -webkit-overflow-scrolling: touch; box-sizing: border-box; }
    #visualization { overflow: visible; position: relative; z-index: 0; display: inline-block; min-width: min-content; box-sizing: border-box; }
    #visualization.visualization-overlap-highlighted { z-index: 5; }
    .viz-scroll-wrapper #visualization canvas { box-sizing: border-box; flex-shrink: 0; }
    .overlap-section { position: relative; z-index: 2; }
    .overlap-card { position: relative; z-index: 1; pointer-events: auto; }
    .export-panel { display: flex; gap: 8px; flex-wrap: wrap; margin: 0 0 10px 0; padding-bottom: 8px; border-bottom: 1px solid #e2e8f0; }
    .blast-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 10002; display: flex; align-items: center; justify-content: center; padding: 16px; }
    .blast-modal-content { width: min(900px, 96vw); max-height: 90vh; overflow: auto; background: #fff; border-radius: 12px; padding: 16px; }
    .blast-two-col { display: grid; grid-template-columns: repeat(2, minmax(220px, 1fr)); gap: 10px; }
    .blast-primer-box { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; background: #f8fafc; }
    .blast-badge { display: inline-block; font-size: 11px; border-radius: 999px; padding: 2px 8px; margin-bottom: 8px; }
    .blast-badge.good { background: #22c55e; color: #fff; }
    .blast-badge.warn { background: #f59e0b; color: #fff; }
    .blast-risk { margin-top: 8px; padding: 8px; border-radius: 6px; font-size: 12px; }
    .blast-risk.high { background: #fee2e2; border-left: 3px solid #ef4444; }
    .blast-risk.medium { background: #fef3c7; border-left: 3px solid #f59e0b; }
    .blast-actions { margin-top: 12px; display: flex; gap: 8px; justify-content: flex-end; }
    .gene-template-panel { margin: 0 0 10px 0; padding: 10px; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc; }
    .gene-chip-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .gene-chip { border: 1px solid #d1d5db; border-radius: 999px; background: #fff; color: #334155; padding: 4px 10px; font-size: 11px; cursor: pointer; }
    .gene-chip:hover { background: #f1f5f9; }
    .gene-search-row { display: flex; gap: 8px; align-items: center; }
    .gene-search-input { flex: 1; min-width: 0; }
    .gene-search-results { margin-top: 8px; display: grid; gap: 6px; }
    .gene-search-item { text-align: left; border: 1px solid #e2e8f0; background: #fff; border-radius: 6px; padding: 6px 8px; cursor: pointer; color: #334155; }
    .gene-search-item span { color: #64748b; font-size: 11px; }
    .gene-search-empty { font-size: 12px; color: #94a3b8; }
`;
document.head.appendChild(statusStyles);