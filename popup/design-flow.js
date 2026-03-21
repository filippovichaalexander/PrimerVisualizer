import { normalizeResults } from '../lib/primer-result-normalize.js';
import { displayResults } from './display-results.js';

/**
 * Логика дизайна праймеров: сервер, health, локальная эвристика.
 * @param {object} d
 * @param {string} d.API_BASE_URL
 * @param {import('../lib/storage-manager.js').StorageManager} d.storage
 * @param {import('../lib/heuristic-engine.js').PrimerHeuristicEngine} d.heuristicEngine
 * @param {() => object} d.getSettings
 * @param {() => object} d.getAdvancedSettings
 * @param {(s: string) => void} d.setCurrentSequence
 * @param {(r: unknown) => void} d.setCurrentResults
 * @param {(msg: string) => void} d.showError
 * @param {(msg: string) => void} d.showWarning
 * @param {(show: boolean) => void} d.showProgress
 */
export function createDesignHandlers(d) {
    const {
        API_BASE_URL,
        storage,
        heuristicEngine,
        getSettings,
        getAdvancedSettings,
        setCurrentSequence,
        setCurrentResults,
        showError,
        showWarning,
        showProgress,
    } = d;

    async function checkServerAvailability() {
        if (!navigator.onLine) return false;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        try {
            const response = await fetch(`${API_BASE_URL}/api/health/`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
            });
            if (!response.ok) return false;
            const data = await response.json().catch(() => ({}));
            const statusRaw = (data.primer3_service ?? '').toString().toLowerCase();
            return statusRaw === 'ok';
        } catch (_error) {
            return false;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    async function designWithServer(sequence, params) {
        const advancedSettings = getAdvancedSettings();
        const url = `${API_BASE_URL}/api/design/`;
        const body = {
            sequence,
            tm: params.tm,
            gc: params.gc,
            length: params.length,
        };
        if (advancedSettings.minProductSize != null) body.minProductSize = advancedSettings.minProductSize;
        if (advancedSettings.maxProductSize != null) body.maxProductSize = advancedSettings.maxProductSize;
        if (advancedSettings.excludeRegions && advancedSettings.excludeRegions.length > 0) {
            body.excludeRegions = advancedSettings.excludeRegions;
        }
        if (advancedSettings.minGc != null) body.minGc = advancedSettings.minGc;
        if (advancedSettings.maxGc != null) body.maxGc = advancedSettings.maxGc;
        if (advancedSettings.tmTolerance != null) body.tmTolerance = advancedSettings.tmTolerance;
        if (advancedSettings.temperatureGradient != null) body.temperatureGradient = advancedSettings.temperatureGradient;
        if (typeof console !== 'undefined' && console.log) {
            const debugPayload = { ...body };
            if (debugPayload.sequence) debugPayload.sequence = `${debugPayload.sequence.length} нт`;
            console.log('Отправка на сервер (design):', debugPayload);
        }
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
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
        const advancedSettings = getAdvancedSettings();
        const results = [];
        const minLength = 18;
        const maxLength = 28;
        const stepFwd = advancedSettings.stepSize || 3;
        const minDistance = advancedSettings.minDistance || 50;
        const minProductSize = advancedSettings.minProductSize || 50;
        const maxProductSize = advancedSettings.maxProductSize || 2000;
        const excludedRegions = advancedSettings.excludeRegions || [];
        const maxPolyX = advancedSettings.maxPolyX ?? 4;
        const tmTolerance = advancedSettings.tmTolerance ?? 3;
        const temperatureGradient = advancedSettings.temperatureGradient ?? 5;
        const minGc = advancedSettings.minGc ?? 35;
        const maxGc = advancedSettings.maxGc ?? 65;
        const saltParams = {
            saltNa: advancedSettings.saltNa ?? 50,
            saltMg: advancedSettings.saltMg ?? 1.5,
            dntpConc: advancedSettings.saltDntp ?? 0.2,
            dnaConc: advancedSettings.saltDna ?? 50,
            primerConc: advancedSettings.saltPrimer ?? 200,
        };
        const thresholds = {
            low: advancedSettings.lowThreshold ?? 15,
            mediumMin: advancedSettings.mediumThresholdMin ?? 15,
            mediumMax: advancedSettings.mediumThresholdMax ?? 40,
            high: advancedSettings.highThreshold ?? 40,
        };
        const checkHairpins = advancedSettings.checkHairpins !== false;
        const checkDimers = advancedSettings.checkDimers !== false;
        const checkRepeats = advancedSettings.checkRepeats !== false;
        const checkSpecificity = !!advancedSettings.checkSpecificity;
        const maxEvaluations = 6000;

        for (let start = 0; start < sequence.length - minLength && results.length < maxEvaluations; start += stepFwd) {
            for (let len = minLength; len <= maxLength && results.length < maxEvaluations; len++) {
                const end = start + len;
                if (end > sequence.length) continue;
                const excludeCheck = heuristicEngine.checkExcludedRegions(start, end, excludedRegions);
                if (!excludeCheck.passed) continue;
                const fwdSeq = sequence.substring(start, end);

                const minRevStart = start + Math.max(minDistance, minProductSize - maxLength);
                for (
                    let revStart = minRevStart;
                    revStart < sequence.length - minLength && results.length < maxEvaluations;
                    revStart += stepFwd
                ) {
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
                            tmTolerance,
                            temperatureGradient,
                            minGc,
                            maxGc,
                            maxPolyX,
                            ...saltParams,
                            checkHairpins,
                            checkDimers,
                            checkRepeats,
                            checkSpecificity,
                            specificityLevel: advancedSettings.specificityLevel || 'strict',
                            specificityOrganism: advancedSettings.specificityOrganism || 'human',
                            thresholds,
                        });

                        results.push({
                            id: `local_${results.length}`,
                            rank: 0,
                            forward: {
                                sequence: fwdSeq,
                                start,
                                end,
                                ...evaluation.forward,
                            },
                            reverse: {
                                sequence: revSeq,
                                start: revStart,
                                end: revEnd,
                                ...evaluation.reverse,
                            },
                            totalScore: evaluation.totalScore,
                            grade: evaluation.grade,
                            warnings: evaluation.warnings,
                            recommendations: evaluation.recommendations,
                            source: 'local',
                            productSize,
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
                `Последовательность короткая (${cleaned.length} нт). Для получения низкого риска пересечений желательно >300 нт.`,
            );
        }

        setCurrentSequence(cleaned);
        showProgress(true);

        try {
            await storage.set('lastSequence', cleaned);

            const params = { tm, gc, length };
            let results = null;
            let serverUnavailable = false;
            let serverReturnedEmpty = false;
            const settings = getSettings();
            const serverAvailable = await checkServerAvailability();

            if (serverAvailable && !(settings.forceOfflineMode || false)) {
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

            setCurrentResults(results);
            displayResults(results, { serverUnavailable, serverReturnedEmpty });

            const ts = Date.now();
            const scores = results.map((r) => Number(r.totalScore)).filter((n) => Number.isFinite(n));
            const bestScore = scores.length ? Math.max(...scores) : 0;
            const adv = getAdvancedSettings();
            await storage.addToHistory({
                id: ts,
                sequence: cleaned,
                sequence_length: cleaned.length,
                results_count: results.length,
                best_score: bestScore,
                parameters: { tm, gc, length },
                settings_snapshot: {
                    forceOfflineMode: !!(settings.forceOfflineMode || false),
                    theme: settings.theme,
                    minProductSize: adv.minProductSize,
                    maxProductSize: adv.maxProductSize,
                },
                results,
                timestamp: ts,
                date: new Date(ts).toISOString(),
                source: 'popup',
            });

            await storage.updateStats({ primersDesigned: (settings.primersDesigned || 0) + 1 });
        } catch (error) {
            showError('Ошибка: ' + (error.message || String(error)));
        } finally {
            showProgress(false);
        }
    }

    return {
        designPrimers,
        designWithServer,
        checkServerAvailability,
        designLocally,
    };
}
