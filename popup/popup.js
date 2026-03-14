import { PrimerHeuristicEngine } from '../lib/heuristic-engine.js';
import { StorageManager } from '../lib/storage-manager.js';
import { DNAVisualizer, OverlapVisualizer } from './visualization.js';
import { API_BASE_URL } from '../config.js';

const heuristicEngine = new PrimerHeuristicEngine();
const storage = new StorageManager();

const RESULTS_PER_PAGE = 10;

/** Извлекает номер пары из id (server_primer3_0 → 1, local_2 → 3) для отображения. */
function getPairNumber(id) {
    if (id == null || id === '') return '?';
    const match = String(id).match(/_(\d+)$/);
    return match ? parseInt(match[1], 10) + 1 : '?';
}

/** Нормализует результаты онлайн/оффлайн к одной структуре: id, forward/reverse { start, end, sequence, details }. */
function normalizeResults(results, sourceHint = null) {
    if (!Array.isArray(results) || results.length === 0) return results;
    return results.map((r, i) => {
        const source = r.source ?? sourceHint ?? (r.id && String(r.id).startsWith('server') ? 'server' : 'local');
        const prefix = source === 'server' || (r.id && String(r.id).startsWith('server')) ? 'server' : 'local';
        const id = r.id != null && String(r.id) !== '' ? String(r.id) : `${prefix}_${i}`;
        const f = r.forward || {};
        const fDetails = f.details || {};
        const fTm = fDetails.tm && typeof fDetails.tm === 'object' ? fDetails.tm.value : fDetails.tm;
        const fGc = fDetails.gc && typeof fDetails.gc === 'object' ? fDetails.gc.value : fDetails.gc;
        const rev = r.reverse || {};
        const rDetails = rev.details || {};
        const rTm = rDetails.tm && typeof rDetails.tm === 'object' ? rDetails.tm.value : rDetails.tm;
        const rGc = rDetails.gc && typeof rDetails.gc === 'object' ? rDetails.gc.value : rDetails.gc;
        return {
            ...r,
            id,
            rank: r.rank != null ? r.rank : i + 1,
            forward: {
                sequence: f.sequence ?? '',
                start: f.start ?? 0,
                end: f.end ?? (f.start ?? 0) + (f.sequence ?? '').length,
                ...f,
                details: {
                    ...fDetails,
                    tm: typeof fTm === 'number' ? { value: fTm } : (fDetails.tm || { value: 0 }),
                    gc: typeof fGc === 'number' ? { value: fGc } : (fDetails.gc || { value: 0 }),
                },
            },
            reverse: {
                sequence: rev.sequence ?? '',
                start: rev.start ?? 0,
                end: rev.end ?? (rev.start ?? 0) + (rev.sequence ?? '').length,
                ...rev,
                details: {
                    ...rDetails,
                    tm: typeof rTm === 'number' ? { value: rTm } : (rDetails.tm || { value: 0 }),
                    gc: typeof rGc === 'number' ? { value: rGc } : (rDetails.gc || { value: 0 }),
                },
            },
            warnings: Array.isArray(r.warnings) ? r.warnings : (r.warnings ? [r.warnings] : []),
            recommendations: Array.isArray(r.recommendations) ? r.recommendations : (r.recommendations ? [r.recommendations] : []),
            source: r.source ?? source,
        };
    });
}

let currentSequence = '';
let currentResults = null;
let resultsPage = 1;
let overlapPage = 1;
let overlapTab = 'all';
let settings = {};
let advancedSettings = {};
let visualizer = null;
let vizZoom = 1;
let onVizRedraw = null;
function setVizRedraw(fn) { onVizRedraw = fn; }

function scrollVizToCenter() {
    const scrollEl = document.getElementById('visualization-scroll');
    if (!scrollEl || !visualizer?.canvas) return;
    const seq = (currentSequence || '').replace(/\s/g, '');
    if (!seq.length) return;
    const centerX = 20 + (seq.length / 2) * visualizer.scale;
    scrollEl.scrollLeft = Math.max(0, centerX - scrollEl.clientWidth / 2);
}

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

function updateExcludeRegionsList() {
    const listEl = document.getElementById('exclude-list');
    if (!listEl) return;
    if (!advancedSettings.excludeRegions || advancedSettings.excludeRegions.length === 0) {
        listEl.innerHTML = '<div class="exclude-empty">Нет исключенных регионов</div>';
        return;
    }
    let html = '';
    advancedSettings.excludeRegions.forEach((region, index) => {
        html += `<div class="exclude-item"><span>${region.start}-${region.end}</span><button type="button" class="exclude-remove" data-index="${index}">✕</button></div>`;
    });
    listEl.innerHTML = html;
    listEl.querySelectorAll('.exclude-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const index = parseInt(e.currentTarget.dataset.index, 10);
            advancedSettings.excludeRegions.splice(index, 1);
            updateExcludeRegionsList();
            storage.set('advancedSettings', advancedSettings);
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

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
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

function setupEventListeners() {
    document.getElementById('design-btn').addEventListener('click', designPrimers);
    document.getElementById('clear-btn').addEventListener('click', clearForm);
    document.getElementById('paste-btn').addEventListener('click', pasteFromClipboard);
    document.getElementById('sample-btn').addEventListener('click', loadSample);
    document.getElementById('use-ncbi').addEventListener('click', useNCBIData);
    const useNcbiAndDesign = document.getElementById('use-ncbi-and-design');
    if (useNcbiAndDesign) useNcbiAndDesign.addEventListener('click', useNCBIDataAndDesign);

    document.getElementById('sequence').addEventListener('input', (e) => {
        updateSequenceStats(e.target.value);
        currentSequence = e.target.value;
    });

    document.getElementById('auto-sync').addEventListener('change', saveSettings);
    document.getElementById('notifications').addEventListener('change', saveSettings);
    document.getElementById('auto-design').addEventListener('change', saveSettings);
    document.getElementById('theme').addEventListener('change', saveSettings);
    const forceOfflineEl = document.getElementById('force-offline');
    if (forceOfflineEl) forceOfflineEl.addEventListener('change', saveSettings);
    const modeToggle = document.getElementById('mode-toggle');
    if (modeToggle) modeToggle.addEventListener('click', toggleForceOfflineMode);

    window.addEventListener('online', checkNetworkStatus);
    window.addEventListener('offline', checkNetworkStatus);

    document.getElementById('export-btn').addEventListener('click', exportData);
    document.getElementById('clear-data-btn').addEventListener('click', clearAllData);
    document.getElementById('feedback-link').addEventListener('click', openFeedback);
    document.getElementById('help-link').addEventListener('click', openHelp);

    const saveAdvancedSettings = () => storage.set('advancedSettings', advancedSettings);
    const debouncedSaveAdvanced = debounce(saveAdvancedSettings, 500);

    const stepSlider = document.getElementById('step-slider');
    if (stepSlider) {
        stepSlider.addEventListener('input', (e) => {
            advancedSettings.stepSize = parseInt(e.target.value, 10);
            const v = document.getElementById('step-value');
            if (v) v.textContent = e.target.value;
            debouncedSaveAdvanced();
        });
    }
    const distanceSlider = document.getElementById('min-distance-slider');
    if (distanceSlider) {
        distanceSlider.addEventListener('input', (e) => {
            advancedSettings.minDistance = parseInt(e.target.value, 10);
            const v = document.getElementById('min-distance-value');
            if (v) v.textContent = e.target.value;
            debouncedSaveAdvanced();
        });
    }
    const minProduct = document.getElementById('min-product-size');
    const maxProduct = document.getElementById('max-product-size');
    if (minProduct) {
        minProduct.addEventListener('change', (e) => {
            advancedSettings.minProductSize = parseInt(e.target.value, 10);
            if (advancedSettings.minProductSize > advancedSettings.maxProductSize) {
                advancedSettings.maxProductSize = advancedSettings.minProductSize + 100;
                if (maxProduct) maxProduct.value = advancedSettings.maxProductSize;
            }
            debouncedSaveAdvanced();
        });
    }
    if (maxProduct) {
        maxProduct.addEventListener('change', (e) => {
            advancedSettings.maxProductSize = parseInt(e.target.value, 10);
            if (advancedSettings.maxProductSize < advancedSettings.minProductSize) {
                advancedSettings.minProductSize = advancedSettings.maxProductSize - 100;
                if (minProduct) minProduct.value = advancedSettings.minProductSize;
            }
            debouncedSaveAdvanced();
        });
    }
    const mediumMin = document.getElementById('medium-threshold-min');
    const mediumMax = document.getElementById('medium-threshold-max');
    if (mediumMin) {
        mediumMin.addEventListener('input', (e) => {
            advancedSettings.mediumThresholdMin = parseInt(e.target.value, 10);
            if (advancedSettings.mediumThresholdMin > advancedSettings.mediumThresholdMax) {
                advancedSettings.mediumThresholdMax = advancedSettings.mediumThresholdMin;
                if (mediumMax) mediumMax.value = advancedSettings.mediumThresholdMax;
            }
            updateThresholdDisplay();
            debouncedSaveAdvanced();
        });
    }
    if (mediumMax) {
        mediumMax.addEventListener('input', (e) => {
            advancedSettings.mediumThresholdMax = parseInt(e.target.value, 10);
            if (advancedSettings.mediumThresholdMax < advancedSettings.mediumThresholdMin) {
                advancedSettings.mediumThresholdMin = advancedSettings.mediumThresholdMax;
                if (mediumMin) mediumMin.value = advancedSettings.mediumThresholdMin;
            }
            updateThresholdDisplay();
            debouncedSaveAdvanced();
        });
    }
    const highSlider = document.getElementById('high-threshold-slider');
    if (highSlider) {
        highSlider.addEventListener('input', (e) => {
            advancedSettings.highThreshold = parseInt(e.target.value, 10);
            updateThresholdDisplay();
            debouncedSaveAdvanced();
        });
    }
    const tmTolSlider = document.getElementById('tm-tolerance-slider');
    if (tmTolSlider) {
        tmTolSlider.addEventListener('input', (e) => {
            advancedSettings.tmTolerance = parseFloat(e.target.value);
            const v = document.getElementById('tm-tolerance-value');
            if (v) v.textContent = `±${e.target.value}°C`;
            debouncedSaveAdvanced();
        });
    }
    const minGcEl = document.getElementById('min-gc');
    const maxGcEl = document.getElementById('max-gc');
    if (minGcEl) {
        minGcEl.addEventListener('change', (e) => {
            advancedSettings.minGc = parseInt(e.target.value, 10);
            if (advancedSettings.minGc > advancedSettings.maxGc) {
                advancedSettings.maxGc = advancedSettings.minGc + 10;
                if (maxGcEl) maxGcEl.value = advancedSettings.maxGc;
            }
            debouncedSaveAdvanced();
        });
    }
    if (maxGcEl) {
        maxGcEl.addEventListener('change', (e) => {
            advancedSettings.maxGc = parseInt(e.target.value, 10);
            if (advancedSettings.maxGc < advancedSettings.minGc) {
                advancedSettings.minGc = advancedSettings.maxGc - 10;
                if (minGcEl) minGcEl.value = advancedSettings.minGc;
            }
            debouncedSaveAdvanced();
        });
    }
    const checkHairpins = document.getElementById('check-hairpins');
    const checkDimers = document.getElementById('check-dimers');
    const checkRepeats = document.getElementById('check-repeats');
    if (checkHairpins) checkHairpins.addEventListener('change', (e) => { advancedSettings.checkHairpins = e.target.checked; debouncedSaveAdvanced(); });
    if (checkDimers) checkDimers.addEventListener('change', (e) => { advancedSettings.checkDimers = e.target.checked; debouncedSaveAdvanced(); });
    if (checkRepeats) checkRepeats.addEventListener('change', (e) => { advancedSettings.checkRepeats = e.target.checked; debouncedSaveAdvanced(); });

    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            applyPreset(e.currentTarget.dataset.preset);
        });
    });

    const polyxSlider = document.getElementById('polyx-slider');
    if (polyxSlider) {
        polyxSlider.addEventListener('input', (e) => {
            advancedSettings.maxPolyX = parseInt(e.target.value, 10);
            const v = document.getElementById('polyx-value');
            if (v) v.textContent = e.target.value;
            debouncedSaveAdvanced();
        });
    }
    const gradientSlider = document.getElementById('gradient-slider');
    if (gradientSlider) {
        gradientSlider.addEventListener('input', (e) => {
            advancedSettings.temperatureGradient = parseFloat(e.target.value);
            const v = document.getElementById('gradient-value');
            if (v) v.textContent = e.target.value;
            debouncedSaveAdvanced();
        });
    }
    const saltMap = { 'salt-na': 'saltNa', 'salt-mg': 'saltMg', 'salt-dntp': 'saltDntp', 'salt-dna': 'saltDna', 'salt-primer': 'saltPrimer' };
    Object.keys(saltMap).forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', (e) => {
            advancedSettings[saltMap[id]] = parseFloat(e.target.value);
            debouncedSaveAdvanced();
        });
    });
    const excludeAddBtn = document.getElementById('exclude-add-btn');
    if (excludeAddBtn) {
        excludeAddBtn.addEventListener('click', () => {
            const start = parseInt(document.getElementById('exclude-start').value, 10);
            const end = parseInt(document.getElementById('exclude-end').value, 10);
            if (!isNaN(start) && !isNaN(end) && start >= 0 && end > start) {
                if (!advancedSettings.excludeRegions) advancedSettings.excludeRegions = [];
                advancedSettings.excludeRegions.push({ start, end });
                advancedSettings.excludeRegions.sort((a, b) => a.start - b.start);
                updateExcludeRegionsList();
                document.getElementById('exclude-start').value = '';
                document.getElementById('exclude-end').value = '';
                debouncedSaveAdvanced();
            }
        });
    }
    document.querySelectorAll('.exclude-preset').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const preset = e.currentTarget.dataset.preset;
            let start = 0, end = 50;
            if (preset === 'repeats') { start = 200; end = 250; }
            else if (preset === 'snp') { start = 450; end = 451; }
            document.getElementById('exclude-start').value = start;
            document.getElementById('exclude-end').value = end;
        });
    });
    const checkSpecificity = document.getElementById('check-specificity');
    const specificityOptions = document.getElementById('specificity-options');
    if (checkSpecificity) {
        checkSpecificity.addEventListener('change', (e) => {
            advancedSettings.checkSpecificity = e.target.checked;
            if (specificityOptions) specificityOptions.style.display = e.target.checked ? 'block' : 'none';
            debouncedSaveAdvanced();
        });
    }
    document.querySelectorAll('input[name="specificity-level"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            advancedSettings.specificityLevel = e.target.value;
            debouncedSaveAdvanced();
        });
    });
    const organismSelect = document.getElementById('specificity-organism');
    if (organismSelect) {
        organismSelect.addEventListener('change', (e) => {
            advancedSettings.specificityOrganism = e.target.value;
            debouncedSaveAdvanced();
        });
    }

    const advInputs = document.querySelectorAll('.advanced-settings input, .advanced-settings select');
    advInputs.forEach(el => {
        el.addEventListener('change', debouncedSaveAdvanced);
        el.addEventListener('input', debouncedSaveAdvanced);
    });

    const vizZoomValueEl = document.getElementById('viz-zoom-value');
    const vizZoomSlider = document.getElementById('viz-zoom-slider');
    const updateVizZoomLabel = () => { if (vizZoomValueEl) vizZoomValueEl.textContent = Math.round(vizZoom * 100) + '%'; };
    if (vizZoomSlider) {
        vizZoomSlider.value = String(vizZoom);
        vizZoomSlider.addEventListener('input', () => {
            vizZoom = Math.max(0.5, Math.min(10, parseFloat(vizZoomSlider.value) || 1));
            vizZoomSlider.value = String(vizZoom);
            updateVizZoomLabel();
            if (onVizRedraw) onVizRedraw();
        });
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
    if (cleaned.length < 200) {
        showWarning(
            `Последовательность короткая (${cleaned.length} нт). Для получения низкого риска пересечений желательно >300 нт.`
        );
    }

    currentSequence = cleaned;
    showProgress(true);

    try {
        await storage.set('lastSequence', cleaned);

        const params = { tm, gc, length };
        let results = null;
        let serverUnavailable = false;
        let serverReturnedEmpty = false;

        if (navigator.onLine && !(settings.forceOfflineMode || false)) {
            results = await designWithServer(cleaned, params);
            if (results && results.length > 0) {
                results = normalizeResults(results, 'server');
            } else if (!results) {
                serverUnavailable = true;
            } else {
                serverReturnedEmpty = true;
            }
        }
        if (!results || results.length === 0) {
            results = designLocally(cleaned, params);
            results = normalizeResults(results, 'local');
        }

        currentResults = results;
        displayResults(results, { serverUnavailable, serverReturnedEmpty });

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
    const url = `${API_BASE_URL}/api/design/`;
    const body = {
        sequence,
        tm: params.tm,
        gc: params.gc,
        length: params.length
    };
    if (advancedSettings.minProductSize != null) body.minProductSize = advancedSettings.minProductSize;
    if (advancedSettings.maxProductSize != null) body.maxProductSize = advancedSettings.maxProductSize;
    if (advancedSettings.excludeRegions && advancedSettings.excludeRegions.length > 0) {
        body.excludeRegions = advancedSettings.excludeRegions;
    }
    if (advancedSettings.minGc != null) body.minGc = advancedSettings.minGc;
    if (advancedSettings.maxGc != null) body.maxGc = advancedSettings.maxGc;
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            console.warn('PrimerDesigner API:', url, 'status', response.status, await response.text().catch(() => ''));
            return null;
        }

        const data = await response.json();
        if (!data.results || !Array.isArray(data.results)) {
            console.warn('Сервер вернул не массив results:', data);
            return null;
        }
        const seen = new Set();
        const unique = data.results.filter((r) => {
            const fwd = r?.forward?.sequence ?? '';
            const rev = r?.reverse?.sequence ?? '';
            const key = `${fwd}_${rev}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        if (unique.length !== data.results.length) {
            console.warn(`Сервер вернул ${data.results.length} пар, уникальных: ${unique.length}`);
        }
        return unique;
    } catch (e) {
        console.warn('PrimerDesigner API request failed:', url, e);
        return null;
    }
}

function designLocally(sequence, params) {
    const results = [];
    const minLength = 18;
    const maxLength = 28;
    const stepFwd = advancedSettings.stepSize || 3;
    const minProductSize = advancedSettings.minProductSize || 50;
    const maxProductSize = advancedSettings.maxProductSize || 2000;
    const excludedRegions = advancedSettings.excludeRegions || [];
    const maxEvaluations = 6000;

    for (let start = 0; start < sequence.length - minLength && results.length < maxEvaluations; start += stepFwd) {
        for (let len = minLength; len <= maxLength && results.length < maxEvaluations; len++) {
            const end = start + len;
            if (end > sequence.length) continue;
            const excludeCheck = heuristicEngine.checkExcludedRegions(start, end, excludedRegions);
            if (!excludeCheck.passed) continue;
            const fwdSeq = sequence.substring(start, end);

            for (let revStart = start + minProductSize; revStart < sequence.length - minLength && results.length < maxEvaluations; revStart += stepFwd) {
                for (let revLen = minLength; revLen <= maxLength; revLen++) {
                    const revEnd = revStart + revLen;
                    if (revEnd > sequence.length) continue;
                    const excludeRev = heuristicEngine.checkExcludedRegions(revStart, revEnd, excludedRegions);
                    if (!excludeRev.passed) continue;
                    const productSize = revEnd - start;
                    if (productSize < minProductSize || productSize > maxProductSize) continue;

                    const revSeq = heuristicEngine.reverseComplement(sequence.substring(revStart, revEnd));
                    const evaluation = heuristicEngine.evaluatePrimerPair(fwdSeq, revSeq, {
                        targetTm: params.tm,
                        productSize,
                        tmTolerance: advancedSettings.tmTolerance,
                        temperatureGradient: advancedSettings.temperatureGradient,
                        minGc: advancedSettings.minGc,
                        maxGc: advancedSettings.maxGc,
                        maxPolyX: advancedSettings.maxPolyX,
                        saltNa: advancedSettings.saltNa,
                        saltMg: advancedSettings.saltMg,
                        dntpConc: advancedSettings.saltDntp,
                        dnaConc: advancedSettings.saltDna,
                        primerConc: advancedSettings.saltPrimer,
                        checkHairpins: advancedSettings.checkHairpins,
                        checkDimers: advancedSettings.checkDimers,
                        checkRepeats: advancedSettings.checkRepeats,
                        checkSpecificity: advancedSettings.checkSpecificity,
                        specificityLevel: advancedSettings.specificityLevel,
                        specificityOrganism: advancedSettings.specificityOrganism,
                        thresholds: {
                            low: advancedSettings.lowThreshold,
                            mediumMin: advancedSettings.mediumThresholdMin,
                            mediumMax: advancedSettings.mediumThresholdMax,
                            high: advancedSettings.highThreshold
                        }
                    });

                    results.push({
                        id: `local_${results.length}`,
                        rank: 0,
                        forward: {
                            sequence: fwdSeq,
                            start,
                            end,
                            ...evaluation.forward
                        },
                        reverse: {
                            sequence: revSeq,
                            start: revStart,
                            end: revEnd,
                            ...evaluation.reverse
                        },
                        totalScore: evaluation.totalScore,
                        grade: evaluation.grade,
                        warnings: evaluation.warnings,
                        recommendations: evaluation.recommendations,
                        source: 'local',
                        productSize
                    });
                }
            }
        }
    }

    return results
        .sort((a, b) => b.totalScore - a.totalScore)
        .slice(0, 10)
        .map((r, idx) => ({ ...r, id: `local_${idx}`, rank: idx + 1 }));
}

function displayResults(results, options = {}) {
    if (!window.displayResultsCounter) window.displayResultsCounter = 0;
    window.displayResultsCounter += 1;
    if (typeof console !== 'undefined' && console.log) {
        console.log(`displayResults вызван #${window.displayResultsCounter}`);
    }

    const container = document.getElementById('results');
    const connectionWarning = document.getElementById('connection-warning');
    const warningText = document.querySelector('.connection-warning-text');

    if (connectionWarning) {
        const showWarning = options.serverUnavailable || options.serverReturnedEmpty;
        connectionWarning.style.display = showWarning ? 'flex' : 'none';
        if (showWarning && warningText) {
            if (options.serverReturnedEmpty) {
                warningText.innerHTML = 'Сервер не подобрал праймеры по заданным критериям. Показаны результаты локальной эвристики.';
            } else {
                warningText.innerHTML = `Сервер не ответил. URL: <code>${API_BASE_URL}</code>. Проверьте: <code>docker compose up</code> и что в консоли расширения нет CORS/сети.`;
            }
        }
    }

    if (!results || results.length === 0) {
        container.innerHTML = '<div class="error">Не удалось подобрать праймеры</div>';
        if (visualizer) visualizer.render('', []);
        return;
    }

    const uniquePairs = new Map();
    results.forEach((r) => {
        const fwd = r?.forward?.sequence ?? '';
        const rev = r?.reverse?.sequence ?? '';
        const fwdStart = r?.forward?.start ?? 0;
        const revStart = r?.reverse?.start ?? 0;
        const key = `${fwd}_${rev}_${fwdStart}_${revStart}`;
        if (!uniquePairs.has(key)) uniquePairs.set(key, r);
    });
    if (uniquePairs.size !== results.length) {
        if (typeof console !== 'undefined' && console.warn) {
            console.warn(`Обнаружены дубликаты пар: было ${results.length}, уникальных ${uniquePairs.size}`);
        }
        results = Array.from(uniquePairs.values());
        results.sort((a, b) => (b.totalScore ?? 0) - (a.totalScore ?? 0));
    }

    const forwardGroups = {};
    results.forEach((pair) => {
        const fwdSeq = pair?.forward?.sequence ?? '';
        if (!forwardGroups[fwdSeq]) forwardGroups[fwdSeq] = [];
        forwardGroups[fwdSeq].push(pair);
    });
    if (typeof console !== 'undefined' && console.log) {
        console.log(`Найдено ${Object.keys(forwardGroups).length} уникальных forward праймеров`);
        Object.keys(forwardGroups).forEach((fwd) => {
            const preview = fwd.length > 15 ? `${fwd.substring(0, 15)}...` : fwd;
            console.log(`  Forward ${preview}: ${forwardGroups[fwd].length} reverse вариантов`);
        });
    }

    if (typeof console !== 'undefined' && console.log) {
        const r0 = results[0];
        const f = r0?.forward; const rev = r0?.reverse;
        console.log('=== Сравнение режимов ===');
        console.log('Режим:', r0?.source);
        console.log('Forward Tm:', f?.details?.tm?.value);
        console.log('Reverse Tm:', rev?.details?.tm?.value);
        console.log('GC%:', f?.details?.gc?.value, '/', rev?.details?.gc?.value);
        console.log('Оценка:', r0?.totalScore);
        console.log('Размер продукта:', rev != null && f != null ? (rev.end - f.start) : '—');
    }

    let html = '<div class="results-header">';
    if (results[0].source === 'local') {
        html += '<div class="source-badge offline">⚡ Локальный режим (эвристика)</div>';
    } else {
        html += '<div class="source-badge online">☁️ Серверный режим</div>';
    }
    html += '</div>';

    // Анализируем пересечения (пороги из расширенных настроек)
    const overlaps = heuristicEngine.analyzeOverlaps(results, {
        thresholds: {
            low: advancedSettings.lowThreshold,
            mediumMin: advancedSettings.mediumThresholdMin,
            mediumMax: advancedSettings.mediumThresholdMax,
            high: advancedSettings.highThreshold
        }
    });

    const riskExplanationHtml = getRiskExplanationHtml(overlaps, currentSequence?.length ?? 0);
    if (riskExplanationHtml) {
        html += riskExplanationHtml;
    }

    // Добавляем секцию с пересечениями если они есть
    if (overlaps.length > 0) {
        overlapPage = 1;
        overlapTab = 'all';
        const overlapLevels = [...new Set(overlaps.map(o => o.conflictLevel))];
        const tabLabels = { all: 'Все', high: 'Высокий риск', medium: 'Средний', low: 'Низкий' };
        const tabOrder = ['all', 'high', 'medium', 'low'];
        const tabsToShow = ['all', ...tabOrder.filter(t => t !== 'all' && overlapLevels.includes(t))];
        let tabsHtml = '<div class="overlap-tabs">';
        tabsToShow.forEach(t => {
            const label = tabLabels[t] || t;
            const active = t === 'all' ? ' active' : '';
            tabsHtml += `<button type="button" class="overlap-tab${active}" data-overlap-tab="${t}" aria-pressed="${t === 'all'}">${label}</button>`;
        });
        tabsHtml += '</div>';
        html += `
            <div class="overlap-section">
                <h3 class="overlap-title">🔗 Анализ пересечений</h3>
                <p class="overlap-hint">Клик по карточке — выделение на графике и подробности</p>
                ${tabsHtml}
                <div class="overlap-grid">
        `;
        
        overlaps.forEach((o, idx) => {
            const pageNum = Math.floor(idx / RESULTS_PER_PAGE) + 1;
            html += `
                <div class="overlap-card overlap-${o.conflictLevel}" data-overlap-index="${idx}" data-overlap-page="${pageNum}" data-conflict-level="${o.conflictLevel}" role="button" tabindex="0" style="display: none;">
                    <div class="overlap-header">
                        <span class="overlap-num" aria-label="Номер пересечения">№ ${idx + 1}</span>
                        <span class="overlap-pairs">
                            Пара #${getPairNumber(o.pair1_id)} ↔ Пара #${getPairNumber(o.pair2_id)}
                        </span>
                        <span class="overlap-badge">${o.overlapLength} п.н.</span>
                    </div>
                    <div class="overlap-details">
                        <div>${formatOverlapType(o.type)}</div>
                        ${(Array.isArray(o.warning) ? o.warning : (o.warning ? [o.warning] : [])).map(w => `<div class="overlap-warning">${w}</div>`).join('')}
                    </div>
                </div>
            `;
        });
        
        html += `
                </div>`;
        const overlapTotalPages = Math.max(1, Math.ceil(overlaps.length / RESULTS_PER_PAGE));
        html += `
                <div class="pagination-bar overlap-pagination">
                    <button type="button" class="pagination-btn overlap-pagination-prev" aria-label="Предыдущая страница">← Назад</button>
                    <span class="pagination-info" id="overlap-pagination-info">Страница 1 из ${overlapTotalPages}</span>
                    <button type="button" class="pagination-btn overlap-pagination-next" aria-label="Следующая страница">Вперёд →</button>
                </div>
                <div class="overlap-detail" id="overlap-detail" style="display: none;" aria-live="polite"></div>
            </div>`;
    }

    // Карточки с праймерами (все; пагинация по 10 на страницу)
    const totalPages = Math.max(1, Math.ceil(results.length / RESULTS_PER_PAGE));
    resultsPage = 1;

    results.forEach((pair, idx) => {
        const pageNum = Math.floor(idx / RESULTS_PER_PAGE) + 1;
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '📌';
        const gradeColor = pair.grade.color;
        const sameForwardAsPrev = idx > 0 && (results[idx - 1].forward?.sequence === pair.forward?.sequence);

        html += `
            <div class="result-card" data-pair-id="${pair.id}" data-pair-index="${idx}" data-page="${pageNum}" style="display: none;">
                ${sameForwardAsPrev ? '<div class="same-forward-indicator">↕️ Тот же forward, другой reverse</div>' : ''}
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

    // Пагинация карточек праймеров — показываем всегда (при 1 странице кнопки отключены)
    html += `
        <div class="pagination-bar pagination-results">
            <button type="button" class="pagination-btn pagination-prev" aria-label="Предыдущая страница">← Назад</button>
            <span class="pagination-info" id="pagination-info">Страница 1 из ${totalPages}</span>
            <button type="button" class="pagination-btn pagination-next" aria-label="Следующая страница">Вперёд →</button>
        </div>`;

    container.innerHTML = html;

    // Показать первую страницу карточек и повесить пагинацию
    const showPage = (page) => {
        const totalP = Math.max(1, Math.ceil(results.length / RESULTS_PER_PAGE));
        document.querySelectorAll('.result-card').forEach(card => {
            card.style.display = parseInt(card.dataset.page, 10) === page ? '' : 'none';
        });
        const infoEl = document.getElementById('pagination-info');
        if (infoEl) infoEl.textContent = `Страница ${page} из ${totalP}`;
        const prevBtn = document.querySelector('.pagination-prev');
        const nextBtn = document.querySelector('.pagination-next');
        if (prevBtn) prevBtn.disabled = page <= 1;
        if (nextBtn) nextBtn.disabled = page >= totalP;
    };
    showPage(1);

    document.querySelector('.pagination-prev')?.addEventListener('click', () => {
        if (resultsPage <= 1) return;
        resultsPage--;
        showPage(resultsPage);
    });
    document.querySelector('.pagination-next')?.addEventListener('click', () => {
        const totalP = Math.max(1, Math.ceil(results.length / RESULTS_PER_PAGE));
        if (resultsPage >= totalP) return;
        resultsPage++;
        showPage(resultsPage);
    });

    // Вкладки и пагинация карточек пересечений
    if (overlaps.length > 0) {
        const getIndicesForTab = (tab) => {
            if (tab === 'all') return overlaps.map((_, i) => i);
            return overlaps.map((o, i) => o.conflictLevel === tab ? i : -1).filter(i => i >= 0);
        };
        const showOverlapPage = (tab, page) => {
            const indices = getIndicesForTab(tab);
            const totalP = Math.max(1, Math.ceil(indices.length / RESULTS_PER_PAGE));
            const pageIndices = indices.slice((page - 1) * RESULTS_PER_PAGE, page * RESULTS_PER_PAGE);
            const set = new Set(pageIndices);
            document.querySelectorAll('.overlap-card').forEach(card => {
                const idx = parseInt(card.dataset.overlapIndex, 10);
                card.style.display = set.has(idx) ? '' : 'none';
            });
            const infoEl = document.getElementById('overlap-pagination-info');
            if (infoEl) infoEl.textContent = `Страница ${page} из ${totalP}`;
            const prevBtn = document.querySelector('.overlap-pagination-prev');
            const nextBtn = document.querySelector('.overlap-pagination-next');
            if (prevBtn) prevBtn.disabled = page <= 1;
            if (nextBtn) nextBtn.disabled = page >= totalP;
        };
        showOverlapPage(overlapTab, 1);
        document.querySelectorAll('.overlap-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.overlapTab;
                overlapTab = tab;
                overlapPage = 1;
                document.querySelectorAll('.overlap-tab').forEach(b => {
                    b.classList.toggle('active', b.dataset.overlapTab === tab);
                    b.setAttribute('aria-pressed', b.dataset.overlapTab === tab);
                });
                showOverlapPage(overlapTab, overlapPage);
            });
        });
        document.querySelector('.overlap-pagination-prev')?.addEventListener('click', () => {
            if (overlapPage <= 1) return;
            overlapPage--;
            showOverlapPage(overlapTab, overlapPage);
        });
        document.querySelector('.overlap-pagination-next')?.addEventListener('click', () => {
            const indices = getIndicesForTab(overlapTab);
            const totalP = Math.max(1, Math.ceil(indices.length / RESULTS_PER_PAGE));
            if (overlapPage >= totalP) return;
            overlapPage++;
            showOverlapPage(overlapTab, overlapPage);
        });
    }

    const vizZoomValueEl = document.getElementById('viz-zoom-value');
    const vizZoomSlider = document.getElementById('viz-zoom-slider');
    if (vizZoomValueEl) vizZoomValueEl.textContent = Math.round(vizZoom * 100) + '%';
    if (vizZoomSlider) vizZoomSlider.value = String(vizZoom);

    if (visualizer && currentSequence) {
        const seq = currentSequence.replace(/\s/g, '');
        visualizer.render(seq, results, -1, vizZoom);
        if (overlaps.length > 0 && visualizer.canvas) {
            const overlapViz = new OverlapVisualizer(visualizer.canvas);
            overlapViz.drawOverlaps(overlaps, seq.length);
        }
    }

    const renderVisualization = (highlightedPairIndex = -1, overlapHighlightIndex = -1) => {
        if (!visualizer || !currentSequence) return;
        const seq = currentSequence.replace(/\s/g, '');
        visualizer.render(seq, results, highlightedPairIndex, vizZoom);
        if (overlaps.length > 0 && visualizer.canvas) {
            const ov = new OverlapVisualizer(visualizer.canvas);
            ov.drawOverlaps(overlaps, seq.length, overlapHighlightIndex);
        }
    };

    setVizRedraw(() => {
        const pairIdx = document.querySelector('.result-card.result-card-highlighted')?.dataset.pairIndex;
        const overlapIdx = document.querySelector('.overlap-card.highlighted')?.dataset.overlapIndex;
        renderVisualization(pairIdx != null ? parseInt(pairIdx, 10) : -1, overlapIdx != null ? parseInt(overlapIdx, 10) : -1);
        scrollVizToCenter();
    });

    document.querySelectorAll('.result-card').forEach((card) => {
        card.addEventListener('click', (e) => {
            if (e.target.closest('.action-btn')) return;
            const pairIndex = parseInt(card.dataset.pairIndex, 10);
            if (isNaN(pairIndex)) return;
            document.querySelectorAll('.result-card').forEach((c) => c.classList.remove('result-card-highlighted'));
            card.classList.add('result-card-highlighted');
            document.querySelectorAll('.overlap-card').forEach(c => c.classList.remove('highlighted'));
            document.getElementById('visualization')?.classList.remove('visualization-overlap-highlighted');
            renderVisualization(pairIndex, -1);
        });
    });

    // Клик по карточке пересечения: выделение на графике + тултип с характеристиками
    if (overlaps.length > 0 && visualizer && currentSequence) {
        const seq = currentSequence.replace(/\s/g, '');
        const detailEl = document.getElementById('overlap-detail');
        const renderHighlight = (highlightIndex) => {
            const pairIdx = document.querySelector('.result-card.result-card-highlighted')?.dataset.pairIndex;
            const parsed = pairIdx != null ? parseInt(pairIdx, 10) : -1;
            renderVisualization(parsed >= 0 ? parsed : -1, highlightIndex);
        };
        const showOverlapDetail = (o, overlapIndex = 0) => {
            const warnings = Array.isArray(o.warning) ? o.warning : (o.warning ? [o.warning] : []);
            const conflictLabels = { low: 'Низкий', medium: 'Средний', high: 'Высокий' };
            const num = (overlapIndex != null ? overlapIndex : 0) + 1;
            let html = `
                <div class="overlap-detail-inner">
                    <h4>Характеристики пересечения № ${num}</h4>
                    <ul class="overlap-detail-list">
                        <li><strong>Пары:</strong> #${getPairNumber(o.pair1_id)} ↔ #${getPairNumber(o.pair2_id)}</li>
                        <li><strong>Тип:</strong> ${formatOverlapType(o.type)}</li>
                        <li><strong>Позиция:</strong> ${o.overlapStart}–${o.overlapEnd} (${o.overlapLength} п.н.)</li>
                        <li><strong>Уровень конфликта:</strong> ${conflictLabels[o.conflictLevel] || o.conflictLevel}</li>
                        ${o.percentOfFirst != null ? `<li><strong>% от 1-го праймера:</strong> ${o.percentOfFirst}%</li>` : ''}
                        ${o.percentOfSecond != null ? `<li><strong>% от 2-го праймера:</strong> ${o.percentOfSecond}%</li>` : ''}
                        ${(o.complementaryRisk?.hasComplementarity) ? `<li class="warning">Комплементарность в перекрытии: ${o.complementaryRisk.matchPercent}%</li>` : ''}
                    </ul>
                    ${warnings.length ? `<div class="overlap-detail-warnings">${warnings.map(w => `<div class="overlap-warning">${w}</div>`).join('')}</div>` : ''}
                </div>`;
            if (detailEl) {
                detailEl.innerHTML = html;
                detailEl.style.display = 'block';
            }
        };
        document.querySelectorAll('.overlap-card').forEach(card => {
            card.addEventListener('click', () => {
                const idx = parseInt(card.dataset.overlapIndex, 10);
                if (isNaN(idx) || idx < 0) return;
                document.querySelectorAll('.overlap-card').forEach(c => c.classList.remove('highlighted'));
                card.classList.add('highlighted');
                renderHighlight(idx);
                showOverlapDetail(overlaps[idx], idx);
                const vizEl = document.getElementById('visualization');
                if (vizEl) {
                    vizEl.classList.add('visualization-overlap-highlighted');
                    vizEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            });
            card.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    card.click();
                }
            });
        });
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

function showWarning(message) {
    const notification = document.createElement('div');
    notification.className = 'notification notification-warning';
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 4500);
}

function formatSequence(seq) {
    if (seq.length <= 25) return seq;
    return seq.substring(0, 20) + '...' + seq.slice(-5);
}

function getRiskExplanationHtml(overlaps, seqLength) {
    if (!overlaps || overlaps.length === 0 || seqLength >= 200) return '';
    const highRiskCount = overlaps.filter((o) => o.conflictLevel === 'high').length;
    if (highRiskCount !== overlaps.length) return '';
    return `
        <div class="risk-explanation" role="alert">
            ⚠️ Все пересечения высокого риска из-за короткой последовательности.
            Для получения вариативных результатов используйте последовательность &gt;300 нт.
        </div>`;
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
    if (currentSequence && currentSequence.length >= 50) {
        designPrimers();
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
`;
document.head.appendChild(statusStyles);