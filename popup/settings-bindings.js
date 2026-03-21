import { attachInstallerPanelHandlers } from './installer-panel.js';

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

/**
 * Все обработчики DOM: кнопки дизайна, настройки, слайдеры, исключения, zoom графика.
 * @param {object} ctx
 */
export function setupSettingsEventListeners(ctx) {
    const {
        designPrimers,
        clearForm,
        pasteFromClipboard,
        loadSample,
        useNCBIData,
        useNCBIDataAndDesign,
        updateSequenceStats,
        setCurrentSequence,
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
        getSettings,
        updateStatusDisplay,
        showNotification,
        getAdvancedSettings,
        updateOverlapVisualizationForCurrent,
        updateSidebarKv,
        updateThresholdDisplay,
        updateAdvancedSettingsUI,
        updateNewSettingsUI,
        validateExcludeRegion,
        updateExcludeRegionsList,
        applyPreset,
        getTooltipForSetting,
        getVizZoom,
        setVizZoom,
        getVizRedraw,
        getCurrentSequence,
    } = ctx;

    const adv = getAdvancedSettings;

    document.getElementById('design-btn').addEventListener('click', () => {
        designPrimers();
    });
    document.getElementById('clear-btn').addEventListener('click', clearForm);
    document.getElementById('paste-btn').addEventListener('click', pasteFromClipboard);
    document.getElementById('sample-btn').addEventListener('click', loadSample);
    document.getElementById('use-ncbi').addEventListener('click', useNCBIData);
    const useNcbiAndDesign = document.getElementById('use-ncbi-and-design');
    if (useNcbiAndDesign) useNcbiAndDesign.addEventListener('click', useNCBIDataAndDesign);

    document.getElementById('sequence').addEventListener('input', (e) => {
        updateSequenceStats(e.target.value);
        setCurrentSequence(e.target.value);
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
    const geneSearchBtn = document.getElementById('gene-search-btn');
    if (geneSearchBtn) geneSearchBtn.addEventListener('click', searchGeneTemplate);
    const geneSearchInput = document.getElementById('gene-search');
    if (geneSearchInput) {
        geneSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                searchGeneTemplate();
            }
        });
    }
    document.querySelectorAll('.gene-chip').forEach((chip) => {
        chip.addEventListener('click', async () => {
            await loadGeneTemplateById(chip.dataset.gene);
        });
    });
    attachInstallerPanelHandlers({
        storage,
        API_BASE_URL,
        getSettings,
        updateStatusDisplay,
        showNotification,
    });

    const saveAdvancedSettings = () => storage.set('advancedSettings', adv());
    const debouncedSaveAdvanced = debounce(saveAdvancedSettings, 500);
    const debouncedUpdateOverlaps = debounce(updateOverlapVisualizationForCurrent, 250);

    const stepSlider = document.getElementById('step-slider');
    if (stepSlider) {
        stepSlider.addEventListener('input', (e) => {
            adv().stepSize = parseInt(e.target.value, 10);
            const v = document.getElementById('step-value');
            if (v) v.textContent = e.target.value;
            debouncedSaveAdvanced();
        });
    }
    const distanceSlider = document.getElementById('min-distance-slider');
    if (distanceSlider) {
        distanceSlider.addEventListener('input', (e) => {
            adv().minDistance = parseInt(e.target.value, 10);
            const v = document.getElementById('min-distance-value');
            if (v) v.textContent = e.target.value;
            debouncedSaveAdvanced();
        });
    }
    const minProduct = document.getElementById('min-product-size');
    const maxProduct = document.getElementById('max-product-size');
    if (minProduct) {
        minProduct.addEventListener('change', (e) => {
            const a = adv();
            a.minProductSize = parseInt(e.target.value, 10);
            if (a.minProductSize > a.maxProductSize) {
                a.maxProductSize = a.minProductSize + 100;
                if (maxProduct) maxProduct.value = a.maxProductSize;
            }
            debouncedSaveAdvanced();
            updateSidebarKv();
        });
    }
    if (maxProduct) {
        maxProduct.addEventListener('change', (e) => {
            const a = adv();
            a.maxProductSize = parseInt(e.target.value, 10);
            if (a.maxProductSize < a.minProductSize) {
                a.minProductSize = a.maxProductSize - 100;
                if (minProduct) minProduct.value = a.minProductSize;
            }
            debouncedSaveAdvanced();
            updateSidebarKv();
        });
    }
    const mediumMin = document.getElementById('medium-threshold-min');
    const mediumMax = document.getElementById('medium-threshold-max');
    if (mediumMin) {
        mediumMin.addEventListener('input', (e) => {
            const a = adv();
            a.mediumThresholdMin = parseInt(e.target.value, 10);
            if (a.mediumThresholdMin > a.mediumThresholdMax) {
                a.mediumThresholdMax = a.mediumThresholdMin;
                if (mediumMax) mediumMax.value = a.mediumThresholdMax;
            }
            updateThresholdDisplay();
            debouncedSaveAdvanced();
            debouncedUpdateOverlaps();
        });
    }
    if (mediumMax) {
        mediumMax.addEventListener('input', (e) => {
            const a = adv();
            a.mediumThresholdMax = parseInt(e.target.value, 10);
            if (a.mediumThresholdMax < a.mediumThresholdMin) {
                a.mediumThresholdMin = a.mediumThresholdMax;
                if (mediumMin) mediumMin.value = a.mediumThresholdMin;
            }
            updateThresholdDisplay();
            debouncedSaveAdvanced();
            debouncedUpdateOverlaps();
        });
    }
    const highSlider = document.getElementById('high-threshold-slider');
    if (highSlider) {
        highSlider.addEventListener('input', (e) => {
            adv().highThreshold = parseInt(e.target.value, 10);
            updateThresholdDisplay();
            debouncedSaveAdvanced();
            debouncedUpdateOverlaps();
        });
    }
    const tmTolSlider = document.getElementById('tm-tolerance-slider');
    if (tmTolSlider) {
        tmTolSlider.addEventListener('input', (e) => {
            adv().tmTolerance = parseFloat(e.target.value);
            const v = document.getElementById('tm-tolerance-value');
            if (v) v.textContent = `±${e.target.value}°C`;
            debouncedSaveAdvanced();
            updateSidebarKv();
        });
    }
    const minGcEl = document.getElementById('min-gc');
    const maxGcEl = document.getElementById('max-gc');
    if (minGcEl) {
        minGcEl.addEventListener('change', (e) => {
            const a = adv();
            a.minGc = parseInt(e.target.value, 10);
            if (a.minGc > a.maxGc) {
                a.maxGc = a.minGc + 10;
                if (maxGcEl) maxGcEl.value = a.maxGc;
            }
            debouncedSaveAdvanced();
            updateSidebarKv();
        });
    }
    if (maxGcEl) {
        maxGcEl.addEventListener('change', (e) => {
            const a = adv();
            a.maxGc = parseInt(e.target.value, 10);
            if (a.maxGc < a.minGc) {
                a.minGc = a.maxGc - 10;
                if (minGcEl) minGcEl.value = a.minGc;
            }
            debouncedSaveAdvanced();
            updateSidebarKv();
        });
    }
    const checkHairpins = document.getElementById('check-hairpins');
    const checkDimers = document.getElementById('check-dimers');
    const checkRepeats = document.getElementById('check-repeats');
    if (checkHairpins) {
        checkHairpins.addEventListener('change', (e) => {
            adv().checkHairpins = e.target.checked;
            debouncedSaveAdvanced();
        });
    }
    if (checkDimers) {
        checkDimers.addEventListener('change', (e) => {
            adv().checkDimers = e.target.checked;
            debouncedSaveAdvanced();
        });
    }
    if (checkRepeats) {
        checkRepeats.addEventListener('change', (e) => {
            adv().checkRepeats = e.target.checked;
            debouncedSaveAdvanced();
        });
    }

    document.querySelectorAll('.preset-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            applyPreset(e.currentTarget.dataset.preset);
        });
    });
    const savePresetBtn = document.getElementById('save-custom-preset');
    if (savePresetBtn) {
        savePresetBtn.addEventListener('click', async () => {
            const name = prompt('Название пресета (например, "qPCR_мой")');
            if (!name) return;
            const key = `customPreset_${name.trim()}`;
            await storage.set(key, { ...adv() });
            console.log('Сохранён пресет', key);
        });
    }
    const exportBtn = document.getElementById('export-advanced-settings');
    if (exportBtn) {
        exportBtn.addEventListener('click', async () => {
            const json = JSON.stringify(adv(), null, 2);
            try {
                await navigator.clipboard.writeText(json);
                alert('Настройки скопированы в буфер обмена.');
            } catch {
                prompt('Скопируйте настройки вручную:', json);
            }
        });
    }
    const importBtn = document.getElementById('import-advanced-settings');
    if (importBtn) {
        importBtn.addEventListener('click', async () => {
            const json = prompt('Вставьте JSON настроек advancedSettings:');
            if (!json) return;
            try {
                const parsed = JSON.parse(json);
                Object.assign(adv(), parsed);
                updateAdvancedSettingsUI();
                updateNewSettingsUI();
                await storage.set('advancedSettings', adv());
                updateOverlapVisualizationForCurrent();
            } catch (e) {
                alert('Не удалось разобрать JSON настроек: ' + (e.message || e));
            }
        });
    }

    const polyxSlider = document.getElementById('polyx-slider');
    if (polyxSlider) {
        polyxSlider.addEventListener('input', (e) => {
            adv().maxPolyX = parseInt(e.target.value, 10);
            const v = document.getElementById('polyx-value');
            if (v) v.textContent = e.target.value;
            debouncedSaveAdvanced();
        });
    }
    const gradientSlider = document.getElementById('gradient-slider');
    if (gradientSlider) {
        gradientSlider.addEventListener('input', (e) => {
            adv().temperatureGradient = parseFloat(e.target.value);
            const v = document.getElementById('gradient-value');
            if (v) v.textContent = e.target.value;
            debouncedSaveAdvanced();
        });
    }
    const saltMap = { 'salt-na': 'saltNa', 'salt-mg': 'saltMg', 'salt-dntp': 'saltDntp', 'salt-dna': 'saltDna', 'salt-primer': 'saltPrimer' };
    Object.keys(saltMap).forEach((id) => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', (e) => {
                adv()[saltMap[id]] = parseFloat(e.target.value);
                debouncedSaveAdvanced();
            });
        }
    });
    const excludeAddBtn = document.getElementById('exclude-add-btn');
    if (excludeAddBtn) {
        excludeAddBtn.addEventListener('click', () => {
            const startInput = document.getElementById('exclude-start');
            const endInput = document.getElementById('exclude-end');
            const start = parseInt(startInput.value, 10);
            const end = parseInt(endInput.value, 10);
            if (isNaN(start) || isNaN(end)) {
                showNotification('❌ Введите числа для начала и конца региона');
                return;
            }
            const a = adv();
            const sequenceLength = (getCurrentSequence() || '').replace(/\s/g, '').length || 0;
            const validationErrors = validateExcludeRegion(start, end, sequenceLength);
            if (validationErrors.length > 0) {
                showNotification('❌ ' + validationErrors.join('. '));
                return;
            }
            const isDuplicate = a.excludeRegions?.some((region) => region.start === start && region.end === end);
            if (isDuplicate) {
                showNotification('⚠️ Этот регион уже исключен');
                return;
            }
            const hasOverlap = a.excludeRegions?.some((region) => {
                const overlap1 = start >= region.start && start < region.end;
                const overlap2 = end > region.start && end <= region.end;
                const contains = start <= region.start && end >= region.end;
                const inside = start >= region.start && end <= region.end;
                return overlap1 || overlap2 || contains || inside;
            });
            if (hasOverlap) {
                const confirmOverlap = confirm(
                    '⚠️ Этот регион пересекается с существующим исключенным регионом.\n\nХотите объединить их?',
                );
                if (confirmOverlap) {
                    let newStart = start;
                    let newEnd = end;
                    a.excludeRegions.forEach((region) => {
                        if (start <= region.end && end >= region.start) {
                            newStart = Math.min(newStart, region.start);
                            newEnd = Math.max(newEnd, region.end);
                        }
                    });
                    a.excludeRegions = a.excludeRegions.filter((region) => !(start <= region.end && end >= region.start));
                    a.excludeRegions.push({ start: newStart, end: newEnd });
                } else {
                    return;
                }
            } else {
                if (!a.excludeRegions) a.excludeRegions = [];
                a.excludeRegions.push({ start, end });
            }
            a.excludeRegions.sort((x, y) => x.start - y.start);
            updateExcludeRegionsList();
            startInput.value = '';
            endInput.value = '';
            storage.set('advancedSettings', a);
            showNotification('✅ Регион добавлен');
        });
    }
    document.querySelectorAll('.exclude-preset').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            const preset = e.currentTarget.dataset.preset;
            const seqLength = (getCurrentSequence() || '').replace(/\s/g, '').length || 500;
            let start;
            let end;
            switch (preset) {
                case 'low-complexity':
                    start = 0;
                    end = Math.min(50, seqLength);
                    break;
                case 'repeats':
                    start = Math.min(200, Math.max(0, seqLength - 100));
                    end = Math.min(start + 50, seqLength);
                    break;
                case 'snp':
                    start = Math.min(450, Math.max(0, seqLength - 1));
                    end = start + 1;
                    break;
                default:
                    start = 0;
                    end = Math.min(50, seqLength);
            }
            document.getElementById('exclude-start').value = start;
            document.getElementById('exclude-end').value = end;
            showNotification(`📋 Пресет «${preset}» готов к добавлению`);
        });
    });
    const checkSpecificity = document.getElementById('check-specificity');
    const specificityOptions = document.getElementById('specificity-options');
    if (checkSpecificity) {
        checkSpecificity.addEventListener('change', (e) => {
            adv().checkSpecificity = e.target.checked;
            if (specificityOptions) specificityOptions.style.display = e.target.checked ? 'block' : 'none';
            debouncedSaveAdvanced();
        });
    }
    document.querySelectorAll('input[name="specificity-level"]').forEach((radio) => {
        radio.addEventListener('change', (e) => {
            adv().specificityLevel = e.target.value;
            debouncedSaveAdvanced();
        });
    });
    const organismSelect = document.getElementById('specificity-organism');
    if (organismSelect) {
        organismSelect.addEventListener('change', (e) => {
            adv().specificityOrganism = e.target.value;
            debouncedSaveAdvanced();
        });
    }

    const advInputs = document.querySelectorAll('.advanced-settings input, .advanced-settings select');
    advInputs.forEach((el) => {
        el.addEventListener('change', debouncedSaveAdvanced);
        el.addEventListener('input', debouncedSaveAdvanced);
    });
    document.querySelectorAll('[data-setting-tooltip]').forEach((el) => {
        const key = el.getAttribute('data-setting-tooltip');
        const tip = getTooltipForSetting(key);
        if (tip) el.title = tip;
    });

    const vizZoomValueEl = document.getElementById('viz-zoom-value');
    const vizZoomSlider = document.getElementById('viz-zoom-slider');
    const updateVizZoomLabel = () => {
        if (vizZoomValueEl) vizZoomValueEl.textContent = `${Math.round(getVizZoom() * 100)}%`;
    };
    if (vizZoomSlider) {
        vizZoomSlider.value = String(getVizZoom());
        vizZoomSlider.addEventListener('input', () => {
            let z = Math.max(0.5, Math.min(10, parseFloat(vizZoomSlider.value) || 1));
            setVizZoom(z);
            vizZoomSlider.value = String(z);
            updateVizZoomLabel();
            const redraw = getVizRedraw();
            if (redraw) redraw();
        });
    }
}
