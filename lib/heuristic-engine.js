/**
 * Полноценный эвристический движок для оффлайн-работы
 * Не требует интернета, работает в любых условиях
 */

export class PrimerHeuristicEngine {
    constructor() {
        this.version = '2.0.0';
        this.rules = this.initializeRules();
        this.cache = new Map();
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

        const forwardScore = this.evaluateSinglePrimer(forwardSeq, 'forward', options);
        const reverseScore = this.evaluateSinglePrimer(reverseSeq, 'reverse', options);

        const pairScore = this.evaluatePairCompatibility(forwardSeq, reverseSeq, options);

        const totalScore = Math.round(
            (forwardScore.total * 0.35) +
            (reverseScore.total * 0.35) +
            (pairScore.total * 0.3)
        );

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
                mode: options.mode || 'standard'
            }
        };

        const cacheKey = `${forwardSeq}_${reverseSeq}`;
        this.cache.set(cacheKey, {
            result: analysis,
            timestamp: Date.now()
        });

        return analysis;
    }

    evaluateSinglePrimer(sequence, type, options) {
        const scores = {};
        const details = {};
        const warnings = [];

        const tm = this.calculateTm(sequence);
        scores.tm = this.evaluateTm(tm, options.targetTm);
        if (scores.tm.score < 10) {
            warnings.push(`Tm (${tm.toFixed(1)}°C) не в оптимуме`);
        }
        details.tm = { value: tm, ...scores.tm };

        const gc = this.calculateGC(sequence);
        scores.gc = this.evaluateGC(gc);
        if (scores.gc.score < 8) {
            warnings.push(`GC-состав (${gc.toFixed(1)}%) требует оптимизации`);
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

        const polyX = this.checkPolyX(sequence);
        scores.polyX = polyX.score;
        if (polyX.warning) {
            warnings.push(polyX.warning);
        }
        details.polyX = polyX;

        const selfComp = this.checkSelfComplementarity(sequence);
        scores.selfComp = selfComp.score;
        if (selfComp.warning) {
            warnings.push(selfComp.warning);
        }
        details.selfComp = selfComp;

        const repeats = this.checkDinucleotideRepeats(sequence);
        scores.repeats = repeats.score;
        if (repeats.warning) {
            warnings.push(repeats.warning);
        }
        details.repeats = repeats;

        const endStability = this.checkEndStability(sequence);
        scores.endStability = endStability.score;
        details.endStability = endStability;

        const total = Object.values(scores).reduce((a, b) => a + b, 0);

        return {
            total,
            scores,
            details,
            warnings,
            sequence: this.maskSequence(sequence)
        };
    }

    calculateTm(sequence) {
        const at = (sequence.match(/[AT]/g) || []).length;
        const gc = (sequence.match(/[GC]/g) || []).length;
        return 2 * at + 4 * gc;
    }

    calculateGC(sequence) {
        const gc = (sequence.match(/[GC]/g) || []).length;
        return (gc / sequence.length) * 100;
    }

    checkGCClamp(sequence) {
        if (sequence.length < 3) return false;
        const lastThree = sequence.slice(-3);
        return /[GC]/.test(lastThree);
    }

    evaluateTm(tm, targetTm = 60) {
        const diff = Math.abs(tm - targetTm);
        if (diff <= 2) return { score: 20, status: 'optimal' };
        if (diff <= 5) return { score: 15, status: 'good' };
        if (diff <= 8) return { score: 10, status: 'acceptable' };
        if (diff <= 12) return { score: 5, status: 'poor' };
        return { score: 0, status: 'bad' };
    }

    evaluateGC(gc) {
        if (gc >= 45 && gc <= 55) return { score: 15, status: 'optimal' };
        if (gc >= 40 && gc <= 60) return { score: 10, status: 'acceptable' };
        if (gc >= 35 && gc <= 65) return { score: 5, status: 'poor' };
        return { score: 0, status: 'bad' };
    }

    evaluateLength(length) {
        if (length >= 20 && length <= 24) return { score: 10, status: 'optimal' };
        if (length >= 18 && length <= 28) return { score: 8, status: 'acceptable' };
        return { score: 5, status: 'poor' };
    }

    checkPolyX(sequence) {
        const maxRun = 4;
        let currentRun = 1;
        let maxRunFound = 1;

        for (let i = 1; i < sequence.length; i++) {
            if (sequence[i] === sequence[i - 1]) {
                currentRun++;
                maxRunFound = Math.max(maxRunFound, currentRun);
            } else {
                currentRun = 1;
            }
        }

        if (maxRunFound > maxRun) {
            return {
                score: -10,
                maxRun: maxRunFound,
                warning: `Длинный полимерный участок (${maxRunFound} нуклеотидов)`
            };
        }

        return { score: 0, maxRun: maxRunFound };
    }

    checkSelfComplementarity(sequence) {
        const revComp = this.reverseComplement(sequence);
        let maxScore = 0;

        for (let i = 0; i < sequence.length - 3; i++) {
            for (let j = i + 3; j < sequence.length; j++) {
                const sub1 = sequence.substring(i, j);
                if (revComp.includes(sub1)) {
                    maxScore = Math.max(maxScore, sub1.length);
                }
            }
        }

        if (maxScore >= 6) {
            return {
                score: -15,
                maxMatch: maxScore,
                warning: 'Высокий риск образования шпилек'
            };
        }

        if (maxScore >= 4) {
            return {
                score: -8,
                maxMatch: maxScore,
                warning: 'Умеренный риск вторичных структур'
            };
        }

        return { score: 0, maxMatch: maxScore };
    }

    checkDinucleotideRepeats(sequence) {
        const patterns = ['AT', 'TA', 'GC', 'CG'];
        let maxRepeats = 0;

        for (const pattern of patterns) {
            const regex = new RegExp(`(${pattern}){4,}`, 'g');
            const matches = sequence.match(regex);
            if (matches) {
                maxRepeats = Math.max(maxRepeats, Math.max(...matches.map(m => m.length / 2)));
            }
        }

        if (maxRepeats >= 4) {
            return {
                score: -5,
                repeats: maxRepeats,
                warning: `Длинные динуклеотидные повторы (x${maxRepeats})`
            };
        }

        return { score: 0, repeats: maxRepeats };
    }

    checkEndStability(sequence) {
        const end3 = sequence.slice(-5);
        const gcCount = (end3.match(/[GC]/g) || []).length;

        if (gcCount >= 3) {
            return { score: 5, status: 'stable' };
        }
        if (gcCount >= 2) {
            return { score: 2, status: 'moderate' };
        }
        return { score: 0, status: 'unstable' };
    }

    evaluatePairCompatibility(forwardSeq, reverseSeq, options) {
        const scores = {};
        const warnings = [];

        const fTm = this.calculateTm(forwardSeq);
        const rTm = this.calculateTm(reverseSeq);
        const tmDiff = Math.abs(fTm - rTm);

        if (tmDiff <= 1) {
            scores.tmDiff = 15;
        } else if (tmDiff <= 2) {
            scores.tmDiff = 10;
        } else if (tmDiff <= 3) {
            scores.tmDiff = 5;
            warnings.push(`Разница Tm (${tmDiff.toFixed(1)}°C) выше оптимальной`);
        } else {
            scores.tmDiff = 0;
            warnings.push(`Критическая разница Tm (${tmDiff.toFixed(1)}°C)`);
        }

        if (options.productSize) {
            const size = options.productSize;
            if (size >= 100 && size <= 300) {
                scores.productSize = 10;
            } else if (size >= 80 && size <= 500) {
                scores.productSize = 5;
            } else {
                scores.productSize = 0;
                warnings.push(`Нестандартный размер продукта (${size} п.н.)`);
            }
        } else {
            scores.productSize = 5;
        }

        const fEnd = forwardSeq.slice(-5);
        const rEnd = reverseSeq.slice(-5);
        const rEndComp = this.reverseComplement(rEnd);

        let complementarity = 0;
        for (let i = 0; i < Math.min(fEnd.length, rEndComp.length); i++) {
            if (fEnd[i] === rEndComp[i]) complementarity++;
        }

        if (complementarity >= 3) {
            scores.dimerRisk = -15;
            warnings.push('Высокий риск образования праймер-димеров');
        } else if (complementarity >= 2) {
            scores.dimerRisk = -8;
            warnings.push('Умеренный риск образования димеров');
        } else {
            scores.dimerRisk = 0;
        }

        const fGc = this.calculateGC(forwardSeq);
        const rGc = this.calculateGC(reverseSeq);
        const gcDiff = Math.abs(fGc - rGc);

        if (gcDiff <= 5) {
            scores.gcBalance = 5;
        } else if (gcDiff <= 10) {
            scores.gcBalance = 2;
        } else {
            scores.gcBalance = -5;
            warnings.push('Дисбаланс GC-состава между праймерами');
        }

        const total = Object.values(scores).reduce((a, b) => a + b, 0);

        return {
            total,
            scores,
            warnings,
            details: {
                tmDiff,
                gcDiff,
                complementarity
            }
        };
    }

    reverseComplement(seq) {
        const comp = { A: 'T', T: 'A', G: 'C', C: 'G' };
        return seq.split('').reverse().map(b => comp[b] || b).join('');
    }

    maskSequence(seq) {
        if (seq.length <= 15) return seq;
        return seq.substring(0, 10) + '...' + seq.slice(-5);
    }

    getGrade(score) {
        if (score >= 90) return { letter: 'A+', color: '#22c55e', description: 'Идеальная пара' };
        if (score >= 85) return { letter: 'A', color: '#22c55e', description: 'Отличная пара' };
        if (score >= 80) return { letter: 'A-', color: '#22c55e', description: 'Очень хорошая пара' };
        if (score >= 75) return { letter: 'B+', color: '#3b82f6', description: 'Хорошая пара' };
        if (score >= 70) return { letter: 'B', color: '#3b82f6', description: 'Выше среднего' };
        if (score >= 65) return { letter: 'B-', color: '#3b82f6', description: 'Средняя пара' };
        if (score >= 60) return { letter: 'C+', color: '#eab308', description: 'Ниже среднего' };
        if (score >= 55) return { letter: 'C', color: '#eab308', description: 'Приемлемо' };
        if (score >= 50) return { letter: 'C-', color: '#eab308', description: 'С натяжкой' };
        if (score >= 40) return { letter: 'D', color: '#f97316', description: 'Плохо' };
        return { letter: 'F', color: '#ef4444', description: 'Не рекомендуется' };
    }

    collectWarnings(forward, reverse, pair) {
        const warnings = [];
        warnings.push(...forward.warnings.slice(0, 2));
        warnings.push(...reverse.warnings.slice(0, 2));
        warnings.push(...pair.warnings.slice(0, 2));
        return warnings;
    }

    generateRecommendations(forward, reverse, pair) {
        const recs = [];

        if (forward.total < 60 || reverse.total < 60) {
            recs.push('Рассмотрите другие позиции для праймеров');
        }

        if (pair.scores.tmDiff < 10) {
            recs.push('Выровняйте Tm праймеров, изменив длину или последовательность');
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

        return recs.slice(0, 3);
    }
}


// lib/heuristic-engine.js - добавить метод

class PrimerHeuristicEngine {
    /**
     * Анализ пересечений между парами праймеров
     */
    analyzeOverlaps(primerPairs) {
        const overlaps = [];
        
        for (let i = 0; i < primerPairs.length; i++) {
            for (let j = i + 1; j < primerPairs.length; j++) {
                const pair1 = primerPairs[i];
                const pair2 = primerPairs[j];
                
                // Проверяем все комбинации
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
                        check.seq1, check.seq2
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
                
                // Проверка перекрытия продуктов амплификации
                this.checkProductOverlap(pair1, pair2, overlaps);
            }
        }
        
        return overlaps;
    }


    /**
     * Расчет пересечения двух отрезков
     */
    calculateOverlap(start1, end1, start2, end2, seq1, seq2) {
        // Находим пересечение
        const overlapStart = Math.max(start1, start2);
        const overlapEnd = Math.min(end1, end2);
        
        if (overlapStart < overlapEnd) {
            const overlapLength = overlapEnd - overlapStart;
            const length1 = end1 - start1;
            const length2 = end2 - start2;
            
            // Процент от каждого праймера
            const percentOf1 = (overlapLength / length1) * 100;
            const percentOf2 = (overlapLength / length2) * 100;
            
            // Определяем уровень конфликта
            let conflictLevel = 'low';
            if (percentOf1 > 50 || percentOf2 > 50) {
                conflictLevel = 'high';
            } else if (percentOf1 > 25 || percentOf2 > 25) {
                conflictLevel = 'medium';
            }
            
            // Проверяем комплементарность в зоне пересечения
            const complementaryRisk = this.checkComplementarityInOverlap(
                seq1, seq2, 
                overlapStart - Math.min(start1, start2),
                overlapStart - Math.min(start2, start1)
            );
            
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
    checkProductOverlap(pair1, pair2, overlaps) {
        // Продукт определяется от forward праймера pair1 до reverse pair1
        const product1Start = pair1.forward.start;
        const product1End = pair1.reverse.end;
        
        const product2Start = pair2.forward.start;
        const product2End = pair2.reverse.end;
        
        const overlap = this.calculateOverlap(
            product1Start, product1End,
            product2Start, product2End,
            '', ''  // Последовательности не нужны для продукта
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