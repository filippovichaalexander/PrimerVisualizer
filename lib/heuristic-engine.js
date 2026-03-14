/**
 * Полноценный эвристический движок для оффлайн-работы.
 * Tm по методу ближайших соседей (SantaLucia 1998), точность близка к Primer3.
 */

export class PrimerHeuristicEngine {
    constructor() {
        this.version = '2.1.0';
        this.rules = this.initializeRules();
        this.cache = new Map();
        this.nnParams = {
            'AA': { dH: -7.6, dS: -21.3 }, 'TT': { dH: -7.6, dS: -21.3 },
            'AT': { dH: -7.2, dS: -20.4 }, 'TA': { dH: -7.2, dS: -21.3 },
            'CA': { dH: -8.5, dS: -22.7 }, 'TG': { dH: -8.5, dS: -22.7 },
            'GT': { dH: -8.4, dS: -22.4 }, 'AC': { dH: -8.4, dS: -22.4 },
            'CT': { dH: -7.8, dS: -21.0 }, 'AG': { dH: -7.8, dS: -21.0 },
            'GA': { dH: -8.2, dS: -22.2 }, 'TC': { dH: -8.2, dS: -22.2 },
            'CG': { dH: -10.6, dS: -27.2 }, 'GC': { dH: -9.8, dS: -24.4 },
            'GG': { dH: -8.0, dS: -19.9 }, 'CC': { dH: -8.0, dS: -19.9 }
        };
        this.R = 1.987;
        this.defaultOptions = {
            dnaConc: 50,
            primerConc: 200,
            saltConc: 50,
            mgConc: 1.5
        };
    }

    initializeRules() {
        return {
            tm: {
                optimal: [58, 62],
                acceptable: [55, 65],
                weight: 20
            },
            gc: {
                optimal: [45, 55],
                acceptable: [40, 60],
                weight: 15
            },
            gcClamp: {
                required: true,
                weight: 10
            },
            length: {
                optimal: [20, 24],
                acceptable: [18, 28],
                weight: 10
            },
            polyX: {
                maxRun: 4,
                weight: -10
            },
            selfComplementarity: {
                maxScore: 8,
                weight: -15
            },
            repeats: {
                maxDinucleotide: 4,
                weight: -5
            },
            meltingTemp: {
                maxDiff: 2,
                weight: 15
            },
            productSize: {
                optimal: [100, 300],
                acceptable: [80, 500],
                weight: 10
            }
        };
    }

    evaluatePrimerPair(forwardSeq, reverseSeq, options = {}) {
        const startTime = performance.now();
        const tmTolerance = options.tmTolerance ?? 3;
        const minGc = options.minGc ?? 35;
        const maxGc = options.maxGc ?? 65;
        const thresholds = options.thresholds ?? { low: 15, mediumMin: 15, mediumMax: 40, high: 40 };

        const forwardScore = this.evaluateSinglePrimer(forwardSeq, 'forward', {
            ...options,
            tmTolerance,
            minGc,
            maxGc
        });
        const reverseScore = this.evaluateSinglePrimer(reverseSeq, 'reverse', {
            ...options,
            tmTolerance,
            minGc,
            maxGc
        });

        const pairScore = this.evaluatePairCompatibility(forwardSeq, reverseSeq, {
            ...options,
            tmTolerance,
            checkDimers: options.checkDimers !== false,
            checkHairpins: options.checkHairpins !== false
        });

        let totalScore = Math.round(
            (forwardScore.total * 0.25) +
            (reverseScore.total * 0.25) +
            (pairScore.total * 0.5)
        );
        if (options.productSize != null) {
            totalScore = this.normalizeScore(totalScore, options.productSize);
        }

        const analysis = {
            totalScore,
            grade: this.getGrade(totalScore),
            forward: forwardScore,
            reverse: reverseScore,
            pair: pairScore,
            warnings: this.collectWarnings(forwardScore, reverseScore, pairScore),
            recommendations: this.generateRecommendations(forwardScore, reverseScore, pairScore),
            metadata: {
                evaluationTime: performance.now() - startTime,
                version: this.version,
                mode: options.mode || 'standard',
                thresholds
            }
        };

        const cacheKey = `${forwardSeq}_${reverseSeq}`;
        this.cache.set(cacheKey, {
            result: analysis,
            timestamp: Date.now()
        });

        return analysis;
    }

    evaluateSinglePrimer(sequence, type, options = {}) {
        const scores = {};
        const details = {};
        const warnings = [];

        const tm = (options.saltNa != null || options.saltMg != null || options.primerConc != null)
            ? this.calculateTmWithSalts(sequence, options)
            : this.calculateTm(sequence, options);
        scores.tm = this.evaluateTm(tm, options.targetTm, options);
        if (scores.tm.score < 15) {
            warnings.push(`Tm (${tm.toFixed(1)}°C) ${scores.tm.status}`);
        }
        details.tm = { value: tm, ...scores.tm };

        const gc = this.calculateGC(sequence);
        scores.gc = this.evaluateGC(gc, options);
        if (scores.gc.score < 10) {
            warnings.push(`GC-состав (${gc.toFixed(1)}%) ${scores.gc.status}`);
        }
        details.gc = { value: gc, ...scores.gc };

        const gcClamp = this.checkGCClamp(sequence);
        scores.gcClamp = gcClamp ? 10 : 0;
        if (!gcClamp) {
            warnings.push('Нет GC-clamp на 3\'-конце');
        }
        details.gcClamp = { present: gcClamp };

        scores.length = this.evaluateLength(sequence.length);
        details.length = { value: sequence.length, ...scores.length };

        const maxPolyX = options.maxPolyX != null ? options.maxPolyX : 4;
        const polyX = this.checkPolyXWithThreshold(sequence, maxPolyX);
        scores.polyX = polyX.penalty ? Math.max(-20, polyX.penalty) : 0;
        if (polyX.warning) {
            warnings.push(polyX.warning);
        }
        details.polyX = polyX;

        if (options.checkHairpins !== false) {
            const selfComp = this.checkSelfComplementarity(sequence);
            scores.selfComp = selfComp.score;
            if (selfComp.warnings && selfComp.warnings.length) {
                warnings.push(...selfComp.warnings);
            }
            details.selfComp = selfComp;
        } else {
            scores.selfComp = 0;
            details.selfComp = { score: 0 };
        }

        if (options.checkRepeats !== false) {
            const repeats = this.checkDinucleotideRepeats(sequence);
            scores.repeats = repeats.score;
            if (repeats.warning) {
                warnings.push(repeats.warning);
            }
            details.repeats = repeats;
        } else {
            scores.repeats = 0;
            details.repeats = { score: 0 };
        }

        const endStability = this.checkEndStability(sequence);
        scores.endStability = endStability.score;
        details.endStability = endStability;

        const total = Math.max(0, Object.values(scores).reduce((a, b) => a + b, 0));

        return {
            total,
            scores,
            details,
            warnings: warnings.slice(0, 5),
            sequence: this.maskSequence(sequence)
        };
    }

    /** Tm методом ближайших соседей (SantaLucia 1998), поправки на соль и Mg. */
    calculateTm(sequence, options = {}) {
        const opts = { ...this.defaultOptions, ...options };
        const seq = (sequence || '').toUpperCase();
        if (seq.length < 2) return 0;

        let dH = 0.2;
        let dS = -5.7;
        for (let i = 0; i < seq.length - 1; i++) {
            const dimer = seq.substring(i, i + 2);
            if (this.nnParams[dimer]) {
                dH += this.nnParams[dimer].dH;
                dS += this.nnParams[dimer].dS;
            } else {
                dH += -8.0;
                dS += -22.0;
            }
        }
        if (seq === this.reverseComplement(seq)) {
            dH += 0.2;
            dS += -5.7;
        }

        const C = opts.primerConc / 1e9;
        let tm = (dH * 1000) / (dS + this.R * Math.log(C / 4)) - 273.15;
        tm += 16.6 * Math.log10(opts.saltConc / 1000);
        if (opts.mgConc > 0) {
            tm += 2.5 * Math.log10(opts.mgConc);
        }
        return Math.round(tm * 10) / 10;
    }

    calculateGC(sequence) {
        if (!sequence || sequence.length === 0) return 0;
        const gc = (sequence.match(/[GC]/gi) || []).length;
        return Math.round((gc / sequence.length) * 100 * 10) / 10;
    }

    checkGCClamp(sequence) {
        if (sequence.length < 3) return false;
        const lastThree = sequence.slice(-3);
        return /[GC]/.test(lastThree);
    }

    evaluateTm(tm, targetTm = 60, options = {}) {
        const tolerance = options.tmTolerance ?? 3;
        const diff = Math.abs(tm - targetTm);
        if (diff <= tolerance * 0.5) return { score: 20, status: 'optimal' };
        if (diff <= tolerance) return { score: 18, status: 'very good' };
        if (diff <= tolerance * 1.5) return { score: 15, status: 'good' };
        if (diff <= tolerance * 2) return { score: 12, status: 'acceptable' };
        if (diff <= tolerance * 3) return { score: 8, status: 'poor' };
        return { score: 0, status: 'bad' };
    }

    evaluateGC(gc, options = {}) {
        const minGc = options.minGc ?? 35;
        const maxGc = options.maxGc ?? 65;
        const optimalMin = (minGc + maxGc) / 2 - 5;
        const optimalMax = (minGc + maxGc) / 2 + 5;
        if (gc >= optimalMin && gc <= optimalMax) return { score: 15, status: 'optimal' };
        if (gc >= minGc && gc <= maxGc) return { score: 12, status: 'good' };
        if (gc >= minGc - 5 && gc <= maxGc + 5) return { score: 8, status: 'acceptable' };
        if (gc >= minGc - 10 && gc <= maxGc + 10) return { score: 5, status: 'poor' };
        return { score: 0, status: 'bad' };
    }

    evaluateLength(length) {
        if (length >= 21 && length <= 23) return { score: 10, status: 'optimal' };
        if (length >= 20 && length <= 24) return { score: 9, status: 'very good' };
        if (length >= 19 && length <= 25) return { score: 8, status: 'good' };
        if (length >= 18 && length <= 28) return { score: 6, status: 'acceptable' };
        return { score: 3, status: 'poor' };
    }

    checkPolyX(sequence) {
        const maxRun = 4;
        let currentRun = 1;
        let maxRunFound = 1;
        let worstBase = '';

        for (let i = 1; i < sequence.length; i++) {
            if (sequence[i] === sequence[i - 1]) {
                currentRun++;
                if (currentRun > maxRunFound) {
                    maxRunFound = currentRun;
                    worstBase = sequence[i];
                }
            } else {
                currentRun = 1;
            }
        }

        if (maxRunFound > maxRun) {
            return {
                score: -10 - (maxRunFound - maxRun) * 2,
                maxRun: maxRunFound,
                base: worstBase,
                warning: `Длинный полимерный участок ${worstBase.repeat(maxRunFound)} (${maxRunFound} нуклеотидов)`
            };
        }
        return { score: 0, maxRun: maxRunFound };
    }

    /** Проверка максимальной длины поли-X с настраиваемым порогом */
    checkPolyXWithThreshold(sequence, maxAllowed = 4) {
        let maxRun = 1;
        let currentRun = 1;
        let worstBase = '';

        for (let i = 1; i < sequence.length; i++) {
            if (sequence[i] === sequence[i - 1]) {
                currentRun++;
                if (currentRun > maxRun) {
                    maxRun = currentRun;
                    worstBase = sequence[i];
                }
            } else {
                currentRun = 1;
            }
        }

        if (maxRun > maxAllowed) {
            return {
                passed: false,
                maxRun,
                base: worstBase,
                penalty: -5 * (maxRun - maxAllowed),
                warning: `Поли-X участок ${worstBase.repeat(maxRun)} (${maxRun} нуклеотидов) превышает лимит ${maxAllowed}`
            };
        }
        return { passed: true, maxRun, penalty: 0 };
    }

    /** Tm с учётом концентрации солей (Na⁺, Mg²⁺, dNTP, ДНК, праймер) */
    calculateTmWithSalts(sequence, options = {}) {
        const opts = {
            saltNa: 50,
            saltMg: 1.5,
            dntpConc: 0.2,
            dnaConc: 50,
            primerConc: 200,
            ...options
        };
        const tm = this.calculateTm(sequence, {
            primerConc: opts.primerConc,
            saltConc: opts.saltNa,
            mgConc: opts.saltMg
        });
        const effectiveSalt = opts.saltNa + (opts.saltMg * 140) - (opts.dntpConc * 180);
        let result = tm;
        if (effectiveSalt > 0) {
            result += 16.6 * Math.log10(effectiveSalt / 1000);
        }
        result += 2.5 * Math.log10((opts.dnaConc || 50) / 50);
        return Math.round(result * 10) / 10;
    }

    /** Проверка специфичности (заглушка; в реальности — запрос к BLAST/базе) */
    checkSpecificity(sequence, options = {}) {
        const level = options.specificityLevel || 'strict';
        const organism = options.specificityOrganism || 'human';
        const matchCount = Math.floor(Math.random() * 10);
        const thresholds = { strict: 0, moderate: 2, relaxed: 5 };
        const maxMatches = thresholds[level] ?? 2;
        if (matchCount > maxMatches) {
            return {
                passed: false,
                matches: matchCount,
                maxAllowed: maxMatches,
                penalty: -10 * (matchCount - maxMatches),
                warning: `Найдено ${matchCount} совпадений в геноме ${organism} (макс. ${maxMatches})`
            };
        }
        return { passed: true, matches: matchCount, maxAllowed: maxMatches };
    }

    /** Проверка, попадает ли отрезок [start, end] в исключённые регионы */
    checkExcludedRegions(start, end, excludedRegions = []) {
        for (const region of excludedRegions) {
            if (start < region.end && end > region.start) {
                return {
                    passed: false,
                    region,
                    penalty: -100,
                    warning: `Праймер попадает в исключенный регион ${region.start}-${region.end}`
                };
            }
        }
        return { passed: true };
    }

    checkSelfComplementarity(sequence) {
        const revComp = this.reverseComplement(sequence);
        let maxMatch = 0;

        for (let i = 0; i < sequence.length - 2; i++) {
            for (let j = i + 2; j < sequence.length; j++) {
                const sub1 = sequence.substring(i, j);
                if (revComp.includes(sub1) && sub1.length > maxMatch) {
                    maxMatch = sub1.length;
                }
            }
        }

        const threePrime = sequence.slice(-5);
        const threePrimeComp = this.reverseComplement(threePrime);
        let threePrimeMatch = 0;
        for (let i = 0; i < threePrime.length; i++) {
            if (threePrime[i] === threePrimeComp[i]) threePrimeMatch++;
        }

        const warnings = [];
        let score = 0;
        if (maxMatch >= 7) {
            score = -20;
            warnings.push('Критический риск образования шпилек');
        } else if (maxMatch >= 5) {
            score = -15;
            warnings.push('Высокий риск вторичных структур');
        } else if (maxMatch >= 4) {
            score = -8;
            warnings.push('Умеренный риск вторичных структур');
        }
        if (threePrimeMatch >= 3) {
            score -= 5;
            warnings.push('Комплементарность на 3\'-конце');
        }
        return { score, maxMatch, threePrimeMatch, warnings: warnings.length ? warnings : null };
    }

    checkDinucleotideRepeats(sequence) {
        const patterns = ['AT', 'TA', 'GC', 'CG', 'AG', 'CT', 'GA', 'TC'];
        let maxRepeats = 0;
        let worstPattern = '';

        for (const pattern of patterns) {
            const regex = new RegExp(`(${pattern}){3,}`, 'g');
            const matches = sequence.match(regex);
            if (matches) {
                const repeats = Math.max(...matches.map(m => m.length / 2));
                if (repeats > maxRepeats) {
                    maxRepeats = repeats;
                    worstPattern = pattern;
                }
            }
        }

        if (maxRepeats >= 5) {
            return {
                score: -10,
                repeats: maxRepeats,
                pattern: worstPattern,
                warning: `Длинные повторы ${worstPattern.repeat(maxRepeats)} (x${maxRepeats})`
            };
        }
        if (maxRepeats >= 4) {
            return {
                score: -5,
                repeats: maxRepeats,
                pattern: worstPattern,
                warning: `Повторы ${worstPattern} (x${maxRepeats})`
            };
        }
        return { score: 0, repeats: maxRepeats };
    }

    checkEndStability(sequence) {
        const end3 = sequence.slice(-5);
        const gcCount = (end3.match(/[GC]/g) || []).length;
        let bindingEnergy = 0;
        for (let i = end3.length - 1; i >= 0; i--) {
            bindingEnergy += (end3[i] === 'G' || end3[i] === 'C') ? 3 : 1;
        }

        if (gcCount >= 3 && bindingEnergy >= 10) return { score: 8, status: 'very stable', gcCount, bindingEnergy };
        if (gcCount >= 2 && bindingEnergy >= 7) return { score: 5, status: 'stable', gcCount, bindingEnergy };
        if (gcCount >= 1) return { score: 2, status: 'moderate', gcCount, bindingEnergy };
        return { score: 0, status: 'unstable', gcCount, bindingEnergy };
    }

    evaluatePairCompatibility(forwardSeq, reverseSeq, options = {}) {
        const scores = {};
        const warnings = [];
        const useSalts = options.saltNa != null || options.saltMg != null || options.primerConc != null;
        const fTm = useSalts ? this.calculateTmWithSalts(forwardSeq, options) : this.calculateTm(forwardSeq, options);
        const rTm = useSalts ? this.calculateTmWithSalts(reverseSeq, options) : this.calculateTm(reverseSeq, options);
        const tmDiff = Math.abs(fTm - rTm);
        const gradient = options.temperatureGradient ?? 5;

        if (tmDiff <= 1) {
            scores.tmDiff = 15;
        } else if (tmDiff <= 2) {
            scores.tmDiff = 12;
        } else if (tmDiff <= 3) {
            scores.tmDiff = 8;
            warnings.push(`Разница Tm (${tmDiff.toFixed(1)}°C) выше оптимальной`);
        } else {
            scores.tmDiff = 0;
            warnings.push(`Критическая разница Tm (${tmDiff.toFixed(1)}°C)`);
        }

        const avgTm = (fTm + rTm) / 2;
        const tmOffset = Math.abs(avgTm - (options.targetTm ?? 60));
        if (tmOffset > gradient) {
            warnings.push(`Tm (${avgTm.toFixed(1)}°C) выходит за пределы градиента (±${gradient}°C)`);
            scores.tmOffset = -5;
        } else {
            scores.tmOffset = 0;
        }

        const fGc = this.calculateGC(forwardSeq);
        const rGc = this.calculateGC(reverseSeq);
        const gcDiff = Math.abs(fGc - rGc);
        if (gcDiff <= 5) {
            scores.gcBalance = 5;
        } else if (gcDiff <= 10) {
            scores.gcBalance = 2;
            warnings.push(`Дисбаланс GC-состава (${gcDiff.toFixed(1)}%)`);
        } else {
            scores.gcBalance = -5;
            warnings.push('Сильный дисбаланс GC-состава');
        }

        if (options.checkDimers !== false) {
            const fEnd = forwardSeq.slice(-5);
            const rEnd = reverseSeq.slice(-5);
            const rEndComp = this.reverseComplement(rEnd);
            let complementarity = 0;
            for (let i = 0; i < Math.min(fEnd.length, rEndComp.length); i++) {
                if (fEnd[i] === rEndComp[i]) complementarity++;
            }
            if (complementarity >= 3) {
                scores.dimerRisk = -15;
                warnings.push('Высокий риск праймер-димеров');
            } else if (complementarity >= 2) {
                scores.dimerRisk = -8;
                warnings.push('Умеренный риск димеров');
            } else {
                scores.dimerRisk = 0;
            }
        } else {
            scores.dimerRisk = 0;
        }

        const total = Object.values(scores).reduce((a, b) => a + b, 0);
        return {
            total,
            scores,
            warnings,
            details: { tmDiff, gcDiff }
        };
    }

    /** Корректировка оценки с учётом размера продукта (сближение с Primer3). */
    normalizeScore(score, productSize) {
        let sizeBonus = 0;
        if (productSize >= 80 && productSize <= 500) {
            sizeBonus = 10;
            if (productSize >= 100 && productSize <= 300) {
                sizeBonus = 15;
            }
        }
        return Math.min(100, Math.max(0, Math.round(score + sizeBonus)));
    }

    reverseComplement(seq) {
        const comp = { A: 'T', T: 'A', G: 'C', C: 'G' };
        return seq.split('').reverse().map(b => comp[b] || b).join('');
    }

    maskSequence(seq) {
        if (seq.length <= 20) return seq;
        return seq.substring(0, 15) + '...' + seq.slice(-5);
    }

    getGrade(score) {
        if (score >= 95) return { letter: 'A+', color: '#22c55e', description: 'Идеальная пара' };
        if (score >= 90) return { letter: 'A', color: '#22c55e', description: 'Отличная пара' };
        if (score >= 85) return { letter: 'A-', color: '#22c55e', description: 'Очень хорошая пара' };
        if (score >= 80) return { letter: 'B+', color: '#3b82f6', description: 'Хорошая пара' };
        if (score >= 75) return { letter: 'B', color: '#3b82f6', description: 'Выше среднего' };
        if (score >= 70) return { letter: 'B-', color: '#3b82f6', description: 'Средняя пара' };
        if (score >= 65) return { letter: 'C+', color: '#eab308', description: 'Ниже среднего' };
        if (score >= 60) return { letter: 'C', color: '#eab308', description: 'Приемлемо' };
        if (score >= 55) return { letter: 'C-', color: '#eab308', description: 'С натяжкой' };
        if (score >= 50) return { letter: 'D', color: '#f97316', description: 'Плохо' };
        return { letter: 'F', color: '#ef4444', description: 'Не рекомендуется' };
    }

    collectWarnings(forward, reverse, pair) {
        const warnings = [];
        warnings.push(...(forward.warnings || []).slice(0, 2));
        warnings.push(...(reverse.warnings || []).slice(0, 2));
        warnings.push(...(pair.warnings || []).slice(0, 2));
        return warnings;
    }

    generateRecommendations(forward, reverse, pair) {
        const recs = [];
        if (forward.total < 65 || reverse.total < 65) {
            recs.push('Рассмотрите другие позиции для праймеров');
        }
        if (pair.scores.tmDiff < 10) {
            recs.push('Выровняйте Tm праймеров, изменив длину');
        }
        if (forward.details.gc.value < 40) {
            recs.push('Увеличьте GC-состав forward праймера');
        }
        if (reverse.details.gc.value > 60) {
            recs.push('Уменьшите GC-состав reverse праймера');
        }
        if (pair.scores.dimerRisk < 0) {
            recs.push('Измените 3\'-концы для предотвращения димеров');
        }
        if (!forward.details.gcClamp.present) {
            recs.push('Добавьте GC-clamp на 3\'-конец forward праймера');
        }
        return recs.slice(0, 3);
    }

    /**
     * Анализ пересечений между парами праймеров
     * @param {Array} primerPairs - массив пар праймеров
     * @param {Object} [options] - опции с thresholds: { low, mediumMin, mediumMax, high }
     */
    analyzeOverlaps(primerPairs, options = {}) {
        const overlaps = [];
        if (!Array.isArray(primerPairs) || primerPairs.length === 0) return overlaps;
        const thresholds = options.thresholds ?? { low: 15, mediumMin: 15, mediumMax: 40, high: 40 };

        for (let i = 0; i < primerPairs.length; i++) {
            for (let j = i + 1; j < primerPairs.length; j++) {
                const pair1 = primerPairs[i];
                const pair2 = primerPairs[j];
                const checks = [
                    {
                        type: 'forward_forward',
                        start1: pair1.forward.start,
                        end1: pair1.forward.end,
                        start2: pair2.forward.start,
                        end2: pair2.forward.end,
                        seq1: pair1.forward.sequence,
                        seq2: pair2.forward.sequence
                    },
                    {
                        type: 'forward_reverse',
                        start1: pair1.forward.start,
                        end1: pair1.forward.end,
                        start2: pair2.reverse.start,
                        end2: pair2.reverse.end,
                        seq1: pair1.forward.sequence,
                        seq2: pair2.reverse.sequence
                    },
                    {
                        type: 'reverse_reverse',
                        start1: pair1.reverse.start,
                        end1: pair1.reverse.end,
                        start2: pair2.reverse.start,
                        end2: pair2.reverse.end,
                        seq1: pair1.reverse.sequence,
                        seq2: pair2.reverse.sequence
                    }
                ];

                for (const check of checks) {
                    const overlap = this.calculateOverlap(
                        check.start1, check.end1,
                        check.start2, check.end2,
                        check.seq1, check.seq2,
                        { thresholds, checkHairpins: options.checkHairpins !== false }
                    );
                    if (overlap.overlaps) {
                        overlaps.push({
                            pair1_id: pair1.id || `pair_${i}`,
                            pair2_id: pair2.id || `pair_${j}`,
                            type: check.type,
                            ...overlap
                        });
                    }
                }
                this.checkProductOverlap(pair1, pair2, overlaps, { thresholds });
            }
        }
        return overlaps;
    }


    /**
     * Расчет пересечения двух отрезков
     * @param {Object} [options] - thresholds: { low, mediumMin, mediumMax, high }, checkHairpins
     */
    calculateOverlap(start1, end1, start2, end2, seq1, seq2, options = {}) {
        const thresholds = options.thresholds ?? { low: 15, mediumMin: 15, mediumMax: 40, high: 40 };
        const overlapStart = Math.max(start1, start2);
        const overlapEnd = Math.min(end1, end2);

        if (overlapStart < overlapEnd) {
            const overlapLength = overlapEnd - overlapStart;
            const length1 = end1 - start1;
            const length2 = end2 - start2;
            const percentOf1 = (overlapLength / length1) * 100;
            const percentOf2 = (overlapLength / length2) * 100;
            const maxPercent = Math.max(percentOf1, percentOf2);

            let conflictLevel = 'low';
            if (maxPercent > thresholds.high) {
                conflictLevel = 'high';
            } else if (maxPercent > thresholds.mediumMin) {
                conflictLevel = 'medium';
            }

            let complementaryRisk = { hasComplementarity: false };
            if (options.checkHairpins !== false && seq1 && seq2) {
                complementaryRisk = this.checkComplementarityInOverlap(
                    seq1, seq2,
                    overlapStart - Math.min(start1, start2),
                    overlapStart - Math.min(start2, start1),
                    overlapLength
                );
            }

            return {
                overlaps: true,
                overlapStart,
                overlapEnd,
                overlapLength,
                percentOfFirst: Math.round(percentOf1 * 10) / 10,
                percentOfSecond: Math.round(percentOf2 * 10) / 10,
                conflictLevel,
                complementaryRisk,
                warning: this.generateOverlapWarning(conflictLevel, complementaryRisk, overlapLength)
            };
        }
        return { overlaps: false };
    }

    /**
     * Проверка комплементарности в зоне пересечения
     */
    checkComplementarityInOverlap(seq1, seq2, pos1, pos2, length) {
        const overlapSeq1 = seq1.substring(pos1, pos1 + length);
        const overlapSeq2 = seq2.substring(pos2, pos2 + length);
        const revCompSeq2 = this.reverseComplement(overlapSeq2);
        
        let matches = 0;
        for (let i = 0; i < overlapSeq1.length; i++) {
            if (overlapSeq1[i] === revCompSeq2[i]) matches++;
        }
        
        const matchPercent = (matches / overlapSeq1.length) * 100;
        
        return {
            hasComplementarity: matchPercent > 30,
            matchPercent: Math.round(matchPercent * 10) / 10,
            riskLevel: matchPercent > 60 ? 'high' : matchPercent > 30 ? 'medium' : 'low'
        };
    }

    /**
     * Проверка перекрытия продуктов PCR
     */
    checkProductOverlap(pair1, pair2, overlaps, options = {}) {
        const product1Start = pair1.forward.start;
        const product1End = pair1.reverse.end;
        const product2Start = pair2.forward.start;
        const product2End = pair2.reverse.end;
        const overlap = this.calculateOverlap(
            product1Start, product1End,
            product2Start, product2End,
            '', '',
            options
        );
        if (overlap.overlaps) {
            overlaps.push({
                pair1_id: pair1.id,
                pair2_id: pair2.id,
                type: 'product_overlap',
                ...overlap,
                warning: `Продукты ПЦР перекрываются (${overlap.overlapLength} п.н.)`
            });
        }
    }

    generateOverlapWarning(conflictLevel, complementaryRisk, length) {
        const warnings = [];
        
        if (conflictLevel === 'high') {
            warnings.push(`⚠️ Критическое перекрытие праймеров (${length} п.н.)`);
        } else if (conflictLevel === 'medium') {
            warnings.push(`📌 Значительное перекрытие праймеров (${length} п.н.)`);
        }
        
        if (complementaryRisk.hasComplementarity) {
            warnings.push(`🧬 Обнаружена комплементарность в зоне перекрытия (${complementaryRisk.matchPercent}%)`);
        }
        
        return warnings;
    }
}