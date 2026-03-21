import { PrimerHeuristicEngine } from '../lib/heuristic-engine.js';
import { StorageManager } from '../lib/storage-manager.js';
import { BlastService } from '../lib/blast-service.js';
import { ExportService } from '../lib/export-service.js';
import { TemplateManager } from '../lib/template-manager.js';
import { UserManager } from '../lib/user-manager.js';
import { SyncEngine } from '../lib/sync-engine.js';
import { DNAVisualizer, OverlapVisualizer } from './visualization.js';
import { API_BASE_URL } from '../config.js';
import { overlapPaginationIdleHtml } from './overlap-html.js';
import { runInstallerStartupCheck } from './installer-panel.js';
import { createDesignHandlers } from './design-flow.js';
import { setupSettingsEventListeners } from './settings-bindings.js';
import { initUserCabinet } from './user-cabinet.js';
import { configureBlastUi, showBlastResults } from './blast-ui.js';
import { configureDisplayResults, displayResults } from './display-results.js';
import { HistoryManager } from '../lib/history-manager.js';
import { initHistoryPanel } from './history-ui.js';

const heuristicEngine = new PrimerHeuristicEngine();
const storage = new StorageManager();
const historyManager = new HistoryManager(storage);
const userManager = new UserManager(storage, API_BASE_URL);
const syncEngine = new SyncEngine(storage, userManager, API_BASE_URL);

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
    refreshHistoryView = initHistoryPanel({
        historyManager,
        storage,
        setCurrentSequence: (s) => { currentSequence = s; },
        setCurrentResults: (r) => { currentResults = r; },
        updateSequenceStats,
        showNotification,
        showWarning,
        setPanelRightAnalysisVisible,
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
        });
    });

    // для кнопки "Создать новые" во вкладке "Сохраненные"
    window.switchTab = (name) => {
        const target = Array.from(tabs).find(t => t.dataset.tab === name);
        if (target) target.click();
    };
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