Давайте создадим полноценное расширение, которое будет работать как "швейцарский нож" для молекулярного биолога прямо в браузере.

Архитектура расширения
text
primer-designer-extension/
├── manifest.json
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   ├── icon128.png
│   └── icon-success.png  # Для уведомлений
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
├── content/
│   ├── content.js
│   ├── ncbi-integration.js
│   └── styles.css
├── background/
│   └── background.js
├── options/
│   ├── options.html
│   ├── options.js
│   └── options.css
├── lib/
│   ├── heuristic-engine.js
│   ├── primer-generator.js
│   ├── storage-manager.js
│   └── sync-manager.js
├── dashboard/
│   ├── dashboard.html
│   └── dashboard.js
└── _locales/
    └── en/
        └── messages.json
1. Манифест и настройки
json
// manifest.json
{
  "manifest_version": 3,
  "name": "PrimerDesigner Pro - PCR Primer Design",
  "version": "2.0.0",
  "description": "Мгновенный дизайн и оценка праймеров прямо на страницах NCBI, PubMed и других баз данных",
  "author": "Bioinformatics Lab",
  
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },

  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    },
    "default_title": "PrimerDesigner (Ctrl+Shift+P)"
  },

  "permissions": [
    "storage",
    "activeTab",
    "contextMenus",
    "notifications",
    "alarms",
    "scripting",
    "clipboardWrite"
  ],

  "host_permissions": [
    "https://www.ncbi.nlm.nih.gov/*",
    "https://www.uniprot.org/*",
    "https://www.ensembl.org/*",
    "https://your-api.example.com/*"
  ],

  "content_scripts": [
    {
      "matches": [
        "https://www.ncbi.nlm.nih.gov/nuccore/*",
        "https://www.ncbi.nlm.nih.gov/protein/*",
        "https://www.ncbi.nlm.nih.gov/gene/*",
        "https://www.uniprot.org/uniprot/*",
        "https://www.ensembl.org/*"
      ],
      "js": [
        "lib/heuristic-engine.js",
        "content/ncbi-integration.js",
        "content/content.js"
      ],
      "css": ["content/styles.css"],
      "run_at": "document_idle"
    }
  ],

  "background": {
    "service_worker": "background/background.js",
    "type": "module"
  },

  "options_ui": {
    "page": "options/options.html",
    "open_in_tab": true
  },

  "commands": {
    "_execute_action": {
      "suggested_key": {
        "default": "Ctrl+Shift+P",
        "mac": "Command+Shift+P"
      },
      "description": "Открыть PrimerDesigner"
    },
    "quick-design": {
      "suggested_key": {
        "default": "Ctrl+Shift+D",
        "mac": "Command+Shift+D"
      },
      "description": "Быстрый дизайн для выделенного текста"
    }
  },

  "web_accessible_resources": [{
    "resources": [
      "dashboard/dashboard.html",
      "icons/icon-success.png",
      "icons/icon128.png"
    ],
    "matches": ["<all_urls>"]
  }]
}
2. Модуль эвристики (оффлайн-режим)
javascript
// lib/heuristic-engine.js
/**
 * Полноценный эвристический движок для оффлайн-работы
 * Не требует интернета, работает в любых условиях
 */

class PrimerHeuristicEngine {
    constructor() {
        this.version = '2.0.0';
        this.rules = this.initializeRules();
        this.cache = new Map();
    }

    initializeRules() {
        return {
            // Основные правила для оценки праймеров
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

    /**
     * Полная оценка пары праймеров
     */
    evaluatePrimerPair(forwardSeq, reverseSeq, options = {}) {
        const startTime = performance.now();
        
        // Оценка каждого праймера
        const forwardScore = this.evaluateSinglePrimer(forwardSeq, 'forward', options);
        const reverseScore = this.evaluateSinglePrimer(reverseSeq, 'reverse', options);
        
        // Оценка совместимости пары
        const pairScore = this.evaluatePairCompatibility(forwardSeq, reverseSeq, options);
        
        // Итоговый счет (0-100)
        const totalScore = Math.round(
            (forwardScore.total * 0.35) +
            (reverseScore.total * 0.35) +
            (pairScore.total * 0.3)
        );
        
        // Детальный анализ
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
        
        // Кешируем результат
        const cacheKey = `${forwardSeq}_${reverseSeq}`;
        this.cache.set(cacheKey, {
            result: analysis,
            timestamp: Date.now()
        });
        
        return analysis;
    }

    /**
     * Оценка одного праймера
     */
    evaluateSinglePrimer(sequence, type, options) {
        const scores = {};
        const details = {};
        const warnings = [];
        
        // 1. Температура плавления (Tm)
        const tm = this.calculateTm(sequence);
        scores.tm = this.evaluateTm(tm, options.targetTm);
        if (scores.tm.score < 10) {
            warnings.push(`Tm (${tm.toFixed(1)}°C) не в оптимуме`);
        }
        details.tm = { value: tm, ...scores.tm };
        
        // 2. GC-состав
        const gc = this.calculateGC(sequence);
        scores.gc = this.evaluateGC(gc);
        if (scores.gc.score < 8) {
            warnings.push(`GC-состав (${gc.toFixed(1)}%) требует оптимизации`);
        }
        details.gc = { value: gc, ...scores.gc };
        
        // 3. GC-clamp (3'-конец)
        const gcClamp = this.checkGCClamp(sequence);
        scores.gcClamp = gcClamp ? 10 : 0;
        if (!gcClamp) {
            warnings.push('Нет GC-clamp на 3\'-конце');
        }
        details.gcClamp = { present: gcClamp };
        
        // 4. Длина
        scores.length = this.evaluateLength(sequence.length);
        details.length = { value: sequence.length, ...scores.length };
        
        // 5. Поли-X повторы
        const polyX = this.checkPolyX(sequence);
        scores.polyX = polyX.score;
        if (polyX.warning) {
            warnings.push(polyX.warning);
        }
        details.polyX = polyX;
        
        // 6. Самокомплементарность
        const selfComp = this.checkSelfComplementarity(sequence);
        scores.selfComp = selfComp.score;
        if (selfComp.warning) {
            warnings.push(selfComp.warning);
        }
        details.selfComp = selfComp;
        
        // 7. Повторы динуклеотидов
        const repeats = this.checkDinucleotideRepeats(sequence);
        scores.repeats = repeats.score;
        if (repeats.warning) {
            warnings.push(repeats.warning);
        }
        details.repeats = repeats;
        
        // 8. 3'-концевая стабильность
        const endStability = this.checkEndStability(sequence);
        scores.endStability = endStability.score;
        details.endStability = endStability;
        
        // Общий счет
        const total = Object.values(scores).reduce((a, b) => a + b, 0);
        
        return {
            total,
            scores,
            details,
            warnings,
            sequence: this.maskSequence(sequence)
        };
    }

    /**
     * Расчет Tm по формуле ближайших соседей (упрощенно)
     */
    calculateTm(sequence) {
        // Базовая формула: 2*(A+T) + 4*(G+C)
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
            if (sequence[i] === sequence[i-1]) {
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
        // Проверка на палиндромы и внутреннюю комплементарность
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
        
        // 1. Разница Tm
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
        
        // 2. Размер продукта (если известны позиции)
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
            scores.productSize = 5; // Нейтрально
        }
        
        // 3. Риск димеров (3'-концы)
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
        
        // 4. GC-состав пары
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
        const comp = { 'A': 'T', 'T': 'A', 'G': 'C', 'C': 'G' };
        return seq.split('').reverse().map(b => comp[b] || b).join('');
    }

    maskSequence(seq) {
        // Для отображения: первые 10 и последние 5 нуклеотидов
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
        
        // До 3 самых важных предупреждений с каждой стороны
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
        
        return recs.slice(0, 3); // Максимум 3 рекомендации
    }
}

// Экспорт для использования в других модулях
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PrimerHeuristicEngine };
}
3. Интеграция с NCBI
javascript
// content/ncbi-integration.js
/**
 * Модуль для работы с NCBI и другими базами данных
 */

class NCBIIntegration {
    constructor() {
        this.currentData = null;
        this.observers = [];
        this.init();
    }

    init() {
        // Определяем тип страницы
        this.pageType = this.detectPageType();
        
        // Извлекаем данные
        this.extractData();
        
        // Добавляем кнопку расширения на страницу
        this.injectButton();
        
        // Наблюдаем за изменениями (для динамических страниц)
        this.observeChanges();
    }

    detectPageType() {
        const url = window.location.href;
        
        if (url.includes('ncbi.nlm.nih.gov/nuccore')) {
            return 'nuccore';
        }
        if (url.includes('ncbi.nlm.nih.gov/protein')) {
            return 'protein';
        }
        if (url.includes('ncbi.nlm.nih.gov/gene')) {
            return 'gene';
        }
        if (url.includes('uniprot.org')) {
            return 'uniprot';
        }
        if (url.includes('ensembl.org')) {
            return 'ensembl';
        }
        
        return 'unknown';
    }

    extractData() {
        switch (this.pageType) {
            case 'nuccore':
                this.extractNuccoreData();
                break;
            case 'protein':
                this.extractProteinData();
                break;
            case 'gene':
                this.extractGeneData();
                break;
            case 'uniprot':
                this.extractUniprotData();
                break;
            case 'ensembl':
                this.extractEnsemblData();
                break;
        }
    }

    extractNuccoreData() {
        const data = {
            type: 'nucleotide',
            source: 'NCBI',
            accession: this.extractAccession(),
            sequence: this.extractSequence(),
            organism: this.extractOrganism(),
            geneName: this.extractGeneName(),
            description: this.extractDescription(),
            features: this.extractFeatures()
        };
        
        this.currentData = data;
        
        // Отправляем в background
        chrome.runtime.sendMessage({
            type: 'NCBI_DATA_EXTRACTED',
            data: data
        });
    }

    extractAccession() {
        // Ищем accession number
        const accElement = document.querySelector('.acc, .accession, .genbank');
        if (accElement) {
            return accElement.textContent.trim();
        }
        
        // Парсим из URL
        const match = window.location.href.match(/[A-Z]{2}_?\d+\.\d+/);
        return match ? match[0] : null;
    }

    extractSequence() {
        // Ищем в разных местах
        let sequence = '';
        
        // 1. В pre-элементах
        const preElements = document.querySelectorAll('pre');
        for (const pre of preElements) {
            const text = pre.textContent;
            if (text.includes('ORIGIN') || /^[ATCG\s]+$/.test(text)) {
                sequence = this.cleanSequence(text);
                if (sequence.length > 50) break;
            }
        }
        
        // 2. В FASTA формате
        if (!sequence) {
            const fastaDiv = document.querySelector('.fasta, .sequence');
            if (fastaDiv) {
                sequence = this.cleanSequence(fastaDiv.textContent);
            }
        }
        
        // 3. В таблице
        if (!sequence) {
            const tableCells = document.querySelectorAll('td');
            for (const cell of tableCells) {
                const text = cell.textContent;
                if (text.length > 100 && /^[ATCG\s]+$/.test(text)) {
                    sequence = this.cleanSequence(text);
                    break;
                }
            }
        }
        
        return sequence;
    }

    cleanSequence(text) {
        return text
            .replace(/\d+/g, '')           // Убираем цифры
            .replace(/\s/g, '')             // Убираем пробелы
            .replace(/ORIGIN/g, '')          // Убираем "ORIGIN"
            .replace(/\/\/.*/g, '')          // Убираем комментарии
            .toUpperCase()
            .replace(/[^ATCG]/g, '')         // Только ATCG
            .trim();
    }

    extractOrganism() {
        const orgElement = document.querySelector('.organism, .taxon, .orgname');
        return orgElement ? orgElement.textContent.trim() : null;
    }

    extractGeneName() {
        const geneElement = document.querySelector('.gene, .genename');
        return geneElement ? geneElement.textContent.trim() : null;
    }

    extractDescription() {
        const descElement = document.querySelector('.description, .caption, .title');
        return descElement ? descElement.textContent.trim() : null;
    }

    extractFeatures() {
        const features = [];
        
        // Ищем таблицу с фичами
        const featureTables = document.querySelectorAll('.featureTable, .features');
        for (const table of featureTables) {
            const rows = table.querySelectorAll('tr');
            for (const row of rows) {
                const cells = row.querySelectorAll('td');
                if (cells.length >= 2) {
                    features.push({
                        type: cells[0].textContent.trim(),
                        location: cells[1].textContent.trim(),
                        product: cells[2]?.textContent?.trim() || ''
                    });
                }
            }
        }
        
        return features;
    }

    extractProteinData() {
        // Аналогично для protein
        // ...
    }

    extractGeneData() {
        // Для gene-страниц
        // ...
    }

    extractUniprotData() {
        // Для UniProt
        // ...
    }

    extractEnsemblData() {
        // Для Ensembl
        // ...
    }

    injectButton() {
        // Добавляем кнопку на страницу NCBI
        const button = document.createElement('button');
        button.id = 'primer-designer-btn';
        button.innerHTML = `
            <span class="pd-icon">🧬</span>
            <span class="pd-text">PrimerDesigner</span>
            <span class="pd-badge">быстрый дизайн</span>
        `;
        
        button.addEventListener('click', () => {
            this.openPrimerDesigner();
        });
        
        // Ищем место для вставки
        const target = document.querySelector('.page-header, .toplinks, #maincontent');
        if (target) {
            target.appendChild(button);
        } else {
            // Вставляем в начало страницы
            document.body.insertBefore(button, document.body.firstChild);
        }
        
        // Добавляем стили
        this.injectStyles();
    }

    injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            #primer-designer-btn {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                padding: 8px 16px;
                margin: 10px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                border: none;
                border-radius: 50px;
                cursor: pointer;
                font-size: 14px;
                font-weight: 500;
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                transition: all 0.3s ease;
                z-index: 9999;
            }
            
            #primer-designer-btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 6px 12px rgba(0, 0, 0, 0.15);
            }
            
            .pd-icon {
                font-size: 18px;
            }
            
            .pd-badge {
                background: rgba(255, 255, 255, 0.2);
                padding: 2px 8px;
                border-radius: 20px;
                font-size: 11px;
                font-weight: 400;
            }
            
            .pd-tooltip {
                position: absolute;
                background: white;
                border: 1px solid #e2e8f0;
                border-radius: 8px;
                padding: 12px;
                box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
                z-index: 10000;
                max-width: 300px;
                font-size: 12px;
            }
            
            .pd-highlight {
                background: rgba(102, 126, 234, 0.1);
                border: 2px solid #667eea;
                cursor: pointer;
            }
        `;
        document.head.appendChild(style);
    }

    openPrimerDesigner() {
        if (!this.currentData || !this.currentData.sequence) {
            alert('Не удалось извлечь последовательность со страницы');
            return;
        }
        
        // Открываем popup с данными
        chrome.runtime.sendMessage({
            type: 'OPEN_WITH_SEQUENCE',
            data: {
                sequence: this.currentData.sequence,
                metadata: {
                    accession: this.currentData.accession,
                    organism: this.currentData.organism,
                    geneName: this.currentData.geneName,
                    url: window.location.href
                }
            }
        });
        
        // Открываем popup
        chrome.runtime.sendMessage({ type: 'OPEN_POPUP' });
    }

    observeChanges() {
        // Наблюдаем за изменениями на странице (для AJAX-загрузки)
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    // Перепроверяем данные
                    this.extractData();
                }
            }
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    highlightFeature(feature) {
        // Подсветка выбранной фичи
        const elements = document.querySelectorAll('.feature, .rprt');
        elements.forEach(el => {
            if (el.textContent.includes(feature)) {
                el.classList.add('pd-highlight');
                
                // Добавляем тултип
                const tooltip = document.createElement('div');
                tooltip.className = 'pd-tooltip';
                tooltip.innerHTML = `
                    <strong>Дизайн праймеров для:</strong><br>
                    ${feature}<br>
                    <button onclick="window.designForFeature('${feature}')">
                        Подобрать праймеры
                    </button>
                `;
                
                el.appendChild(tooltip);
            }
        });
    }
}

// Инициализация при загрузке
const ncbiIntegration = new NCBIIntegration();
4. Content Script
javascript
// content/content.js
/**
 * Основной content script для взаимодействия со страницей
 */

(function() {
    // Ждем загрузки страницы
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    function init() {
        console.log('🧬 PrimerDesigner extension loaded');
        
        // Слушаем сообщения от popup/background
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            switch (request.type) {
                case 'GET_SEQUENCE':
                    sendResponse({ sequence: getSelectedSequence() });
                    break;
                    
                case 'HIGHLIGHT_PRIMER':
                    highlightPrimerOnPage(request.primer);
                    break;
                    
                case 'EXTRACT_FEATURES':
                    sendResponse({ features: extractFeatures() });
                    break;
            }
            
            return true;
        });
        
        // Добавляем контекстное меню для выделенного текста
        document.addEventListener('mouseup', handleTextSelection);
    }

    function getSelectedSequence() {
        const selection = window.getSelection().toString().trim();
        
        // Очищаем выделенный текст
        const cleaned = selection
            .replace(/\s/g, '')
            .replace(/\d/g, '')
            .toUpperCase()
            .replace(/[^ATCG]/g, '');
        
        if (cleaned.length >= 20) {
            return cleaned;
        }
        
        // Если выделено мало, пробуем найти ближайшую последовательность
        return findNearbySequence();
    }

    function findNearbySequence() {
        const selection = window.getSelection();
        if (!selection.rangeCount) return null;
        
        const range = selection.getRangeAt(0);
        const container = range.commonAncestorContainer;
        
        // Ищем в родительском элементе
        let element = container.nodeType === 3 ? container.parentElement : container;
        
        while (element) {
            const text = element.textContent;
            const cleaned = text
                .replace(/\s/g, '')
                .replace(/\d/g, '')
                .toUpperCase()
                .replace(/[^ATCG]/g, '');
            
            if (cleaned.length >= 50) {
                return cleaned;
            }
            
            element = element.parentElement;
        }
        
        return null;
    }

    function extractFeatures() {
        const features = [];
        
        // Ищем таблицы с фичами
        const tables = document.querySelectorAll('table');
        for (const table of tables) {
            if (table.textContent.includes('gene') || table.textContent.includes('CDS')) {
                const rows = table.querySelectorAll('tr');
                for (const row of rows) {
                    const cells = row.querySelectorAll('td');
                    if (cells.length >= 2) {
                        features.push({
                            type: cells[0].textContent.trim(),
                            location: cells[1].textContent.trim(),
                            text: row.textContent.trim()
                        });
                    }
                }
            }
        }
        
        return features;
    }

    function handleTextSelection() {
        const selected = window.getSelection().toString().trim();
        if (selected.length > 10) {
            // Показываем плавающую кнопку
            showFloatingButton(selected);
        }
    }

    function showFloatingButton(selectedText) {
        // Удаляем старую кнопку
        const oldBtn = document.getElementById('pd-floating-btn');
        if (oldBtn) oldBtn.remove();
        
        // Создаем новую
        const btn = document.createElement('div');
        btn.id = 'pd-floating-btn';
        btn.innerHTML = '🧬 Дизайн праймеров';
        btn.style.cssText = `
            position: absolute;
            background: #667eea;
            color: white;
            padding: 8px 16px;
            border-radius: 50px;
            font-size: 14px;
            cursor: pointer;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            z-index: 10000;
            transition: all 0.2s;
        `;
        
        // Позиционируем рядом с выделением
        const range = window.getSelection().getRangeAt(0);
        const rect = range.getBoundingClientRect();
        
        btn.style.left = rect.left + window.scrollX + 'px';
        btn.style.top = rect.bottom + window.scrollY + 10 + 'px';
        
        btn.addEventListener('click', () => {
            chrome.runtime.sendMessage({
                type: 'QUICK_DESIGN',
                data: {
                    sequence: selectedText.replace(/\s/g, ''),
                    source: 'selection'
                }
            });
            btn.remove();
        });
        
        document.body.appendChild(btn);
        
        // Убираем через 5 секунд
        setTimeout(() => {
            if (btn.parentNode) btn.remove();
        }, 5000);
    }

    function highlightPrimerOnPage(primer) {
        // Поиск и подсветка праймера на странице
        const regex = new RegExp(primer.sequence, 'gi');
        
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: (node) => {
                    if (node.parentElement.tagName === 'SCRIPT') return NodeFilter.FILTER_REJECT;
                    if (node.parentElement.tagName === 'STYLE') return NodeFilter.FILTER_REJECT;
                    if (regex.test(node.textContent)) return NodeFilter.FILTER_ACCEPT;
                    return NodeFilter.FILTER_REJECT;
                }
            }
        );
        
        const nodes = [];
        while (walker.nextNode()) {
            nodes.push(walker.currentNode);
        }
        
        nodes.forEach(node => {
            const span = document.createElement('span');
            span.innerHTML = node.textContent.replace(
                regex,
                match => `<mark class="pd-primer-highlight" style="background: #fef3c7; border-bottom: 2px solid #f59e0b;">${match}</mark>`
            );
            node.parentNode.replaceChild(span, node);
        });
    }
})();
5. Background Service Worker
javascript
// background/background.js
/**
 * Фоновый сервис для управления расширением
 */

import { PrimerHeuristicEngine } from '../lib/heuristic-engine.js';
import { StorageManager } from '../lib/storage-manager.js';
import { SyncManager } from '../lib/sync-manager.js';

// Инициализация
const heuristicEngine = new PrimerHeuristicEngine();
const storage = new StorageManager();
const sync = new SyncManager();

// Состояние
let offlineMode = false;
let pendingSync = [];

// При установке
chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
        await initializeExtension();
    } else if (details.reason === 'update') {
        await migrateData(details.previousVersion);
    }
    
    // Создаем контекстное меню
    createContextMenus();
    
    // Устанавливаем будильник для синхронизации
    chrome.alarms.create('sync', { periodInMinutes: 30 });
    chrome.alarms.create('cleanup', { periodInMinutes: 60 });
});

// Инициализация расширения
async function initializeExtension() {
    await storage.set('settings', {
        defaultTm: 60,
        defaultGc: 50,
        primerLength: 22,
        autoSync: true,
        notifications: true,
        theme: 'light',
        offlineMode: false,
        version: chrome.runtime.getManifest().version
    });
    
    await storage.set('stats', {
        primersDesigned: 0,
        savedPrimers: 0,
        syncsCompleted: 0,
        installDate: Date.now()
    });
    
    // Показываем приветствие
    chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'PrimerDesigner установлен!',
        message: 'Выделите последовательность ДНК на любой странице и нажмите Ctrl+Shift+D'
    });
}

// Контекстное меню
function createContextMenus() {
    chrome.contextMenus.create({
        id: 'design-primers',
        title: '🧬 Дизайн праймеров для выделенного',
        contexts: ['selection']
    });
    
    chrome.contextMenus.create({
        id: 'check-primer',
        title: '🔍 Проверить праймер',
        contexts: ['selection']
    });
    
    chrome.contextMenus.create({
        id: 'save-primer',
        title: '💾 Сохранить праймер',
        contexts: ['selection']
    });
    
    chrome.contextMenus.create({
        id: 'separator-1',
        type: 'separator',
        contexts: ['selection']
    });
    
    chrome.contextMenus.create({
        id: 'blast-search',
        title: '🌐 BLAST поиск',
        contexts: ['selection']
    });
    
    chrome.contextMenus.create({
        id: 'reverse-complement',
        title: '🔄 Получить обратную комплементарную',
        contexts: ['selection']
    });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
    const selected = info.selectionText.trim();
    
    switch (info.menuItemId) {
        case 'design-primers':
            quickDesign(selected, tab);
            break;
            
        case 'check-primer':
            checkPrimer(selected, tab);
            break;
            
        case 'save-primer':
            savePrimer(selected, tab);
            break;
            
        case 'blast-search':
            blastSearch(selected, tab);
            break;
            
        case 'reverse-complement':
            showReverseComplement(selected, tab);
            break;
    }
});

// Быстрый дизайн
async function quickDesign(sequence, tab) {
    sequence = sequence.replace(/\s/g, '').toUpperCase();
    
    if (sequence.length < 50) {
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: 'Ошибка',
            message: 'Слишком короткая последовательность (минимум 50 нуклеотидов)'
        });
        return;
    }
    
    // Генерируем праймеры
    const primers = generatePrimers(sequence);
    
    // Сохраняем в историю
    await storage.addToHistory({
        sequence,
        primers,
        timestamp: Date.now(),
        source: tab?.url || 'manual'
    });
    
    // Обновляем статистику
    await storage.updateStats({ primersDesigned: 1 });
    
    // Открываем результаты
    chrome.tabs.sendMessage(tab.id, {
        type: 'SHOW_QUICK_RESULTS',
        primers
    });
}

// Генерация праймеров
function generatePrimers(sequence) {
    const primers = [];
    const length = sequence.length;
    const step = Math.floor(length / 15);
    
    for (let i = 0; i < 10; i++) {
        const start = i * step;
        const end = start + 22;
        
        if (end < length) {
            const fwdSeq = sequence.substring(start, end);
            const revSeq = sequence.substring(length - end, length - start);
            
            const evaluation = heuristicEngine.evaluatePrimerPair(fwdSeq, revSeq);
            
            primers.push({
                id: `pair_${i}`,
                index: i + 1,
                forward: {
                    sequence: fwdSeq,
                    start,
                    end,
                    ...evaluation.forward
                },
                reverse: {
                    sequence: revSeq,
                    start: length - end,
                    end: length - start,
                    ...evaluation.reverse
                },
                ...evaluation
            });
        }
    }
    
    return primers.sort((a, b) => b.totalScore - a.totalScore);
}

// Сообщения от popup и content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.type) {
        case 'OPEN_POPUP':
            chrome.action.openPopup();
            break;
            
        case 'OPEN_WITH_SEQUENCE':
            handleOpenWithSequence(request.data);
            break;
            
        case 'QUICK_DESIGN':
            quickDesign(request.data.sequence, sender.tab);
            break;
            
        case 'SAVE_FEEDBACK':
            saveFeedback(request.data);
            break;
            
        case 'GET_SETTINGS':
            storage.get('settings').then(settings => sendResponse(settings));
            return true;
            
        case 'UPDATE_SETTINGS':
            storage.set('settings', request.data);
            break;
            
        case 'SYNC_NOW':
            sync.syncNow();
            break;
            
        case 'GET_STATS':
            storage.get('stats').then(stats => sendResponse(stats));
            return true;
            
        case 'EXPORT_DATA':
            exportData(request.data);
            break;
            
        case 'NCBI_DATA_EXTRACTED':
            handleNCBIData(request.data);
            break;
    }
    
    return true;
});

// Обработка данных с NCBI
async function handleNCBIData(data) {
    // Сохраняем последнюю последовательность
    await storage.set('lastNCBISequence', {
        ...data,
        timestamp: Date.now()
    });
    
    // Если есть авто-дизайн, генерируем
    const settings = await storage.get('settings');
    if (settings.autoDesign) {
        const primers = generatePrimers(data.sequence);
        
        // Показываем уведомление
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: 'Последовательность загружена',
            message: `Найдено ${primers.length} пар праймеров. Нажмите для просмотра.`,
            buttons: [{ title: 'Показать' }]
        });
    }
}

// Сохранение обратной связи
async function saveFeedback(data) {
    await storage.addFeedback(data);
    
    if (navigator.onLine) {
        sync.syncFeedback([data]);
    } else {
        pendingSync.push(data);
    }
    
    chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Спасибо!',
        message: 'Ваш отзыв поможет улучшить систему'
    });
}

// Будильники
chrome.alarms.onAlarm.addListener(async (alarm) => {
    switch (alarm.name) {
        case 'sync':
            if (navigator.onLine) {
                await sync.syncAll();
            }
            break;
            
        case 'cleanup':
            await cleanupOldData();
            break;
    }
});

// Очистка старых данных
async function cleanupOldData() {
    const oneMonthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    
    // Удаляем старую историю
    const history = await storage.get('history') || [];
    const newHistory = history.filter(item => item.timestamp > oneMonthAgo);
    await storage.set('history', newHistory);
    
    // Очищаем кеш
    // ...
}

// Мониторинг сети
window.addEventListener('online', () => {
    offlineMode = false;
    chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Подключение восстановлено',
        message: `Синхронизация ${pendingSync.length} элементов...`
    });
    
    if (pendingSync.length > 0) {
        sync.syncAll();
    }
});

window.addEventListener('offline', () => {
    offlineMode = true;
    chrome.action.setBadgeText({ text: 'OFF' });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
});

// Экспорт данных
function exportData(format) {
    // ...
}
6. Popup UI
html
<!-- popup/popup.html -->
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="popup.css">
</head>
<body>
    <div class="container">
        <!-- Шапка -->
        <div class="header">
            <div class="logo">
                <span class="logo-icon">🧬</span>
                <span class="logo-text">PrimerDesigner</span>
            </div>
            <div class="status">
                <span class="status-indicator online" id="status-indicator"></span>
                <span class="status-text" id="status-text">Онлайн</span>
            </div>
        </div>
        
        <!-- Вкладки -->
        <div class="tabs">
            <button class="tab active" data-tab="design">Дизайн</button>
            <button class="tab" data-tab="saved">Сохраненные</button>
            <button class="tab" data-tab="history">История</button>
            <button class="tab" data-tab="settings">Настройки</button>
        </div>
        
        <!-- Вкладка: Дизайн -->
        <div class="tab-pane active" id="tab-design">
            <!-- Быстрая вставка с NCBI -->
            <div class="quick-insert" id="quick-insert">
                <span class="quick-insert-icon">📋</span>
                <span class="quick-insert-text">Есть последовательность с NCBI</span>
                <button class="btn btn-small btn-primary" id="use-ncbi">Вставить</button>
            </div>
            
            <!-- Форма ввода -->
            <div class="form-group">
                <label for="sequence">Последовательность ДНК</label>
                <textarea id="sequence" 
                          placeholder="Вставьте последовательность (минимум 50 нуклеотидов)..."
                          rows="4"></textarea>
                <div class="sequence-stats">
                    <span id="seq-length">0</span> нуклеотидов
                </div>
            </div>
            
            <!-- Параметры -->
            <div class="params-grid">
                <div class="form-group">
                    <label for="tm">Tm (°C)</label>
                    <input type="number" id="tm" value="60" min="50" max="70" step="0.5">
                </div>
                
                <div class="form-group">
                    <label for="gc">GC (%)</label>
                    <input type="number" id="gc" value="50" min="30" max="70">
                </div>
                
                <div class="form-group">
                    <label for="length">Длина праймера</label>
                    <select id="length">
                        <option value="18">18</option>
                        <option value="20">20</option>
                        <option value="22" selected>22</option>
                        <option value="24">24</option>
                        <option value="26">26</option>
                    </select>
                </div>
            </div>
            
            <!-- Кнопки -->
            <div class="actions">
                <button class="btn btn-primary btn-block" id="design-btn">
                    <span class="btn-icon">🎯</span>
                    Подобрать праймеры
                </button>
                
                <div class="action-row">
                    <button class="btn btn-outline" id="clear-btn">
                        <span class="btn-icon">🗑️</span>
                        Очистить
                    </button>
                    
                    <button class="btn btn-outline" id="paste-btn">
                        <span class="btn-icon">📋</span>
                        Вставить
                    </button>
                    
                    <button class="btn btn-outline" id="sample-btn">
                        <span class="btn-icon">🧪</span>
                        Пример
                    </button>
                </div>
            </div>
            
            <!-- Прогресс (скрыт) -->
            <div class="progress" id="progress" style="display: none;">
                <div class="progress-bar" id="progress-bar"></div>
                <div class="progress-text" id="progress-text">Дизайн праймеров...</div>
            </div>
            
            <!-- Результаты -->
            <div class="results" id="results"></div>
        </div>
        
        <!-- Вкладка: Сохраненные -->
        <div class="tab-pane" id="tab-saved">
            <div class="saved-list" id="saved-list">
                <!-- Будут загружены через JS -->
                <div class="empty-state">
                    <span class="empty-icon">📭</span>
                    <p>Нет сохраненных праймеров</p>
                    <button class="btn btn-small btn-primary" onclick="switchTab('design')">
                        Создать новые
                    </button>
                </div>
            </div>
        </div>
        
        <!-- Вкладка: История -->
        <div class="tab-pane" id="tab-history">
            <div class="history-list" id="history-list">
                <!-- Будут загружены через JS -->
                <div class="empty-state">
                    <span class="empty-icon">📜</span>
                    <p>История пуста</p>
                </div>
            </div>
        </div>
        
        <!-- Вкладка: Настройки -->
        <div class="tab-pane" id="tab-settings">
            <div class="settings-form">
                <div class="form-group">
                    <label class="checkbox">
                        <input type="checkbox" id="auto-sync">
                        <span>Автоматическая синхронизация</span>
                    </label>
                </div>
                
                <div class="form-group">
                    <label class="checkbox">
                        <input type="checkbox" id="notifications">
                        <span>Уведомления</span>
                    </label>
                </div>
                
                <div class="form-group">
                    <label class="checkbox">
                        <input type="checkbox" id="auto-design">
                        <span>Авто-дизайн на NCBI</span>
                    </label>
                </div>
                
                <div class="form-group">
                    <label for="theme">Тема</label>
                    <select id="theme">
                        <option value="light">Светлая</option>
                        <option value="dark">Темная</option>
                        <option value="system">Системная</option>
                    </select>
                </div>
                
                <hr>
                
                <div class="stats">
                    <h4>Статистика</h4>
                    <div class="stat-row">
                        <span>Всего дизайнов:</span>
                        <span id="stat-primers">0</span>
                    </div>
                    <div class="stat-row">
                        <span>Сохранено:</span>
                        <span id="stat-saved">0</span>
                    </div>
                    <div class="stat-row">
                        <span>Дата установки:</span>
                        <span id="stat-install">-</span>
                    </div>
                </div>
                
                <button class="btn btn-outline btn-block" id="export-btn">
                    📤 Экспортировать данные
                </button>
                
                <button class="btn btn-outline btn-block" id="clear-data-btn">
                    🗑️ Очистить все данные
                </button>
            </div>
        </div>
        
        <!-- Футер -->
        <div class="footer">
            <div class="version">v2.0.0</div>
            <div class="links">
                <a href="#" id="feedback-link">Обратная связь</a>
                <span class="separator">•</span>
                <a href="#" id="help-link">Помощь</a>
            </div>
        </div>
    </div>
    
    <script src="popup.js" type="module"></script>
</body>
</html>
7. Popup JavaScript
javascript
// popup/popup.js
import { PrimerHeuristicEngine } from '../lib/heuristic-engine.js';
import { StorageManager } from '../lib/storage-manager.js';

const heuristicEngine = new PrimerHeuristicEngine();
const storage = new StorageManager();

// Состояние
let currentSequence = '';
let currentResults = null;
let settings = {};

// Инициализация
document.addEventListener('DOMContentLoaded', async () => {
    await loadSettings();
    await loadStats();
    await checkNetworkStatus();
    await checkForNCBIData();
    
    setupEventListeners();
    setupTabs();
    
    // Загружаем сохраненную последовательность
    const saved = await storage.get('lastSequence');
    if (saved) {
        document.getElementById('sequence').value = saved;
        updateSequenceStats(saved);
    }
});

// Загрузка настроек
async function loadSettings() {
    settings = await storage.get('settings') || {
        defaultTm: 60,
        defaultGc: 50,
        primerLength: 22,
        autoSync: true,
        notifications: true,
        theme: 'light'
    };
    
    // Применяем настройки
    document.getElementById('tm').value = settings.defaultTm;
    document.getElementById('gc').value = settings.defaultGc;
    document.getElementById('length').value = settings.primerLength;
    document.getElementById('auto-sync').checked = settings.autoSync;
    document.getElementById('notifications').checked = settings.notifications;
    document.getElementById('auto-design').checked = settings.autoDesign || false;
    document.getElementById('theme').value = settings.theme;
}

// Проверка сети
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

// Проверка данных с NCBI
async function checkForNCBIData() {
    const ncbiData = await storage.get('lastNCBISequence');
    if (ncbiData && Date.now() - ncbiData.timestamp < 5 * 60 * 1000) { // 5 минут
        const quickInsert = document.getElementById('quick-insert');
        quickInsert.style.display = 'flex';
        
        // Обновляем текст
        const geneInfo = ncbiData.geneName || ncbiData.accession || 'NCBI';
        quickInsert.querySelector('.quick-insert-text').textContent = 
            `Последовательность с ${geneInfo}`;
    }
}

// Обработчики событий
function setupEventListeners() {
    // Основные кнопки
    document.getElementById('design-btn').addEventListener('click', designPrimers);
    document.getElementById('clear-btn').addEventListener('click', clearForm);
    document.getElementById('paste-btn').addEventListener('click', pasteFromClipboard);
    document.getElementById('sample-btn').addEventListener('click', loadSample);
    document.getElementById('use-ncbi').addEventListener('click', useNCBIData);
    
    // Ввод последовательности
    document.getElementById('sequence').addEventListener('input', (e) => {
        updateSequenceStats(e.target.value);
        currentSequence = e.target.value;
    });
    
    // Настройки
    document.getElementById('auto-sync').addEventListener('change', saveSettings);
    document.getElementById('notifications').addEventListener('change', saveSettings);
    document.getElementById('auto-design').addEventListener('change', saveSettings);
    document.getElementById('theme').addEventListener('change', saveSettings);
    
    // Действия
    document.getElementById('export-btn').addEventListener('click', exportData);
    document.getElementById('clear-data-btn').addEventListener('click', clearAllData);
    document.getElementById('feedback-link').addEventListener('click', openFeedback);
    document.getElementById('help-link').addEventListener('click', openHelp);
}

// Вкладки
function setupTabs() {
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            
            // Обновляем активные классы
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            document.querySelectorAll('.tab-pane').forEach(pane => {
                pane.classList.remove('active');
            });
            document.getElementById(`tab-${tabName}`).classList.add('active');
            
            // Загружаем данные для вкладки
            if (tabName === 'saved') loadSavedPrimers();
            if (tabName === 'history') loadHistory();
        });
    });
}

// Дизайн праймеров
async function designPrimers() {
    const sequence = document.getElementById('sequence').value.trim();
    const tm = parseFloat(document.getElementById('tm').value);
    const gc = parseFloat(document.getElementById('gc').value);
    const length = parseInt(document.getElementById('length').value);
    
    // Валидация
    if (!sequence) {
        showError('Введите последовательность ДНК');
        return;
    }
    
    const cleaned = sequence.replace(/\s/g, '').toUpperCase();
    if (cleaned.length < 50) {
        showError('Минимальная длина последовательности: 50 нуклеотидов');
        return;
    }
    
    // Показываем прогресс
    showProgress(true);
    
    try {
        // Сохраняем последовательность
        await storage.set('lastSequence', cleaned);
        
        // Пытаемся получить с сервера
        let results;
        if (navigator.onLine) {
            results = await designWithServer(cleaned, { tm, gc, length });
        }
        
        // Если сервер недоступен или оффлайн - используем локальную эвристику
        if (!results) {
            results = designLocally(cleaned, { tm, gc, length });
        }
        
        // Показываем результаты
        displayResults(results);
        currentResults = results;
        
        // Сохраняем в историю
        await storage.addToHistory({
            sequence: cleaned,
            results,
            timestamp: Date.now()
        });
        
        // Обновляем статистику
        await storage.updateStats({ primersDesigned: 1 });
        
    } catch (error) {
        showError('Ошибка: ' + error.message);
    } finally {
        showProgress(false);
    }
}

// Дизайн на сервере
async function designWithServer(sequence, params) {
    try {
        const response = await fetch('https://your-api.example.com/api/design/', {
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
        return data.results;
    } catch {
        return null;
    }
}

// Локальный дизайн
function designLocally(sequence, params) {
    const results = [];
    const step = Math.floor(sequence.length / 15);
    
    for (let i = 0; i < 10; i++) {
        const start = i * step;
        const end = start + params.length;
        
        if (end < sequence.length) {
            const fwdSeq = sequence.substring(start, end);
            const revSeq = sequence.substring(sequence.length - end, sequence.length - start);
            
            const evaluation = heuristicEngine.evaluatePrimerPair(fwdSeq, revSeq);
            
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

// Отображение результатов
function displayResults(results) {
    const container = document.getElementById('results');
    
    if (!results || results.length === 0) {
        container.innerHTML = '<div class="error">Не удалось подобрать праймеры</div>';
        return;
    }
    
    let html = '<div class="results-header">';
    
    // Источник данных
    if (results[0].source === 'local') {
        html += '<div class="source-badge offline">⚡ Оффлайн режим (эвристика)</div>';
    } else {
        html += '<div class="source-badge online">☁️ Серверный режим</div>';
    }
    
    html += '</div>';
    
    // Результаты
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
                            <span>Tm: ${pair.forward.details.tm.value.toFixed(1)}°C</span>
                            <span>GC: ${pair.forward.details.gc.value.toFixed(1)}%</span>
                        </div>
                    </div>
                    
                    <div class="primer reverse">
                        <div class="primer-label">
                            <span>3' ← 5'</span>
                            <span class="primer-pos">${pair.reverse.start}-${pair.reverse.end}</span>
                        </div>
                        <div class="primer-sequence">${formatSequence(pair.reverse.sequence)}</div>
                        <div class="primer-stats">
                            <span>Tm: ${pair.reverse.details.tm.value.toFixed(1)}°C</span>
                            <span>GC: ${pair.reverse.details.gc.value.toFixed(1)}%</span>
                        </div>
                    </div>
                </div>
        `;
        
        // Предупреждения
        if (pair.warnings && pair.warnings.length > 0) {
            html += '<div class="warnings">';
            pair.warnings.slice(0, 2).forEach(w => {
                html += `<div class="warning">⚠️ ${w}</div>`;
            });
            html += '</div>';
        }
        
        // Кнопки действий
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
    
    // Добавляем обработчики
    document.querySelectorAll('.copy-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const seq = e.target.dataset.seq;
            navigator.clipboard.writeText(seq);
            
            // Визуальный фидбек
            const original = e.target.textContent;
            e.target.textContent = '✓ Скопировано';
            setTimeout(() => {
                e.target.textContent = original;
            }, 1000);
        });
    });
    
    document.querySelectorAll('.save-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const pair = JSON.parse(e.target.dataset.pair);
            savePrimer(pair);
        });
    });
    
    document.querySelectorAll('.feedback-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const pair = JSON.parse(e.target.dataset.pair);
            openFeedbackForPair(pair);
        });
    });
}

// Сохранение праймера
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
    await storage.updateStats({ savedPrimers: 1 });
    
    // Показываем уведомление
    showNotification('✓ Праймер сохранен');
}

// Загрузка сохраненных праймеров
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

// Вспомогательные функции
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
        
        // Анимация прогресс-бара
        let width = 0;
        const interval = setInterval(() => {
            if (width >= 90) {
                clearInterval(interval);
            } else {
                width += Math.random() * 10;
                document.getElementById('progress-bar').style.width = width + '%';
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
    // Простая нотификация
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

// Остальные функции
async function clearForm() {
    document.getElementById('sequence').value = '';
    document.getElementById('results').innerHTML = '';
    updateSequenceStats('');
    await storage.remove('lastSequence');
}

async function pasteFromClipboard() {
    try {
        const text = await navigator.clipboard.readText();
        document.getElementById('sequence').value = text;
        updateSequenceStats(text);
    } catch {
        showError('Не удалось вставить из буфера обмена');
    }
}

function loadSample() {
    const sample = 'ATGCGATCGTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGC' +
                   'TAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGC' +
                   'TAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGC';
    document.getElementById('sequence').value = sample;
    updateSequenceStats(sample);
}

async function useNCBIData() {
    const ncbiData = await storage.get('lastNCBISequence');
    if (ncbiData) {
        document.getElementById('sequence').value = ncbiData.sequence;
        updateSequenceStats(ncbiData.sequence);
        document.getElementById('quick-insert').style.display = 'none';
    }
}

async function saveSettings() {
    settings = {
        defaultTm: parseFloat(document.getElementById('tm').value),
        defaultGc: parseFloat(document.getElementById('gc').value),
        primerLength: parseInt(document.getElementById('length').value),
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
        await storage.clearAll();
        location.reload();
    }
}

function openFeedback() {
    chrome.tabs.create({ url: 'https://your-api.example.com/feedback' });
}

function openHelp() {
    chrome.tabs.create({ url: 'https://your-api.example.com/help' });
}

function openFeedbackForPair(pair) {
    chrome.runtime.sendMessage({
        type: 'OPEN_FEEDBACK',
        data: { pair }
    });
}
8. CSS стили
css
/* popup/popup.css */
:root {
    --primary: #667eea;
    --primary-dark: #5a67d8;
    --secondary: #764ba2;
    --success: #22c55e;
    --warning: #f59e0b;
    --danger: #ef4444;
    --gray-50: #f9fafb;
    --gray-100: #f3f4f6;
    --gray-200: #e5e7eb;
    --gray-300: #d1d5db;
    --gray-400: #9ca3af;
    --gray-500: #6b7280;
    --gray-600: #4b5563;
    --gray-700: #374151;
    --gray-800: #1f2937;
    --gray-900: #111827;
}

* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    width: 480px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
    background: white;
    color: var(--gray-800);
}

.container {
    padding: 16px;
}

/* Шапка */
.header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--gray-200);
}

.logo {
    display: flex;
    align-items: center;
    gap: 8px;
}

.logo-icon {
    font-size: 24px;
}

.logo-text {
    font-size: 18px;
    font-weight: 600;
    background: linear-gradient(135deg, var(--primary), var(--secondary));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
}

.status {
    display: flex;
    align-items: center;
    gap: 6px;
}

.status-indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
}

.status-indicator.online {
    background: var(--success);
    box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.2);
}

.status-indicator.offline {
    background: var(--gray-400);
}

.status-text {
    font-size: 12px;
    color: var(--gray-500);
}

/* Вкладки */
.tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 20px;
    background: var(--gray-100);
    padding: 4px;
    border-radius: 8px;
}

.tab {
    flex: 1;
    padding: 8px;
    border: none;
    background: transparent;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    color: var(--gray-600);
    cursor: pointer;
    transition: all 0.2s;
}

.tab:hover {
    color: var(--gray-900);
}

.tab.active {
    background: white;
    color: var(--primary);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.tab-pane {
    display: none;
}

.tab-pane.active {
    display: block;
}

/* Быстрая вставка */
.quick-insert {
    display: none;
    align-items: center;
    gap: 8px;
    padding: 12px;
    margin-bottom: 16px;
    background: linear-gradient(135deg, #667eea10, #764ba210);
    border-radius: 8px;
    font-size: 13px;
}

.quick-insert-icon {
    font-size: 18px;
}

.quick-insert-text {
    flex: 1;
    color: var(--gray-700);
}

/* Формы */
.form-group {
    margin-bottom: 12px;
}

label {
    display: block;
    margin-bottom: 4px;
    font-size: 12px;
    font-weight: 500;
    color: var(--gray-600);
}

input, select, textarea {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--gray-300);
    border-radius: 8px;
    font-size: 14px;
    transition: all 0.2s;
}

input:focus, select:focus, textarea:focus {
    outline: none;
    border-color: var(--primary);
    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
}

textarea {
    resize: vertical;
    font-family: 'Courier New', monospace;
    font-size: 13px;
}

.sequence-stats {
    margin-top: 4px;
    font-size: 11px;
    color: var(--gray-500);
    text-align: right;
}

.params-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 8px;
    margin-bottom: 16px;
}

/* Кнопки */
.btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 10px 16px;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
}

.btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.btn-primary {
    background: linear-gradient(135deg, var(--primary), var(--secondary));
    color: white;
}

.btn-primary:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.btn-outline {
    background: white;
    border: 1px solid var(--gray-300);
    color: var(--gray-700);
}

.btn-outline:hover {
    background: var(--gray-50);
    border-color: var(--gray-400);
}

.btn-small {
    padding: 6px 12px;
    font-size: 12px;
}

.btn-block {
    width: 100%;
}

.action-row {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 8px;
    margin-top: 8px;
}

/* Прогресс */
.progress {
    margin: 20px 0;
    padding: 16px;
    background: var(--gray-50);
    border-radius: 12px;
    text-align: center;
}

.progress-bar {
    height: 6px;
    background: linear-gradient(90deg, var(--primary), var(--secondary));
    border-radius: 3px;
    margin-bottom: 8px;
    transition: width 0.3s ease;
}

.progress-text {
    font-size: 13px;
    color: var(--gray-600);
}

/* Результаты */
.results {
    margin-top: 20px;
}

.results-header {
    margin-bottom: 12px;
}

.source-badge {
    display: inline-block;
    padding: 4px 8px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 500;
}

.source-badge.online {
    background: #22c55e20;
    color: #166534;
}

.source-badge.offline {
    background: #f59e0b20;
    color: #92400e;
}

.result-card {
    padding: 16px;
    margin-bottom: 12px;
    background: white;
    border: 1px solid var(--gray-200);
    border-radius: 12px;
    transition: all 0.2s;
}

.result-card:hover {
    border-color: var(--primary);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
}

.card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
}

.rank {
    font-weight: 600;
    color: var(--gray-700);
}

.grade {
    padding: 4px 8px;
    border-radius: 20px;
    font-weight: 600;
    font-size: 13px;
}

.primers {
    display: grid;
    gap: 8px;
    margin-bottom: 12px;
}

.primer {
    padding: 10px;
    background: var(--gray-50);
    border-radius: 8px;
}

.primer.forward {
    border-left: 3px solid var(--primary);
}

.primer.reverse {
    border-left: 3px solid var(--secondary);
}

.primer-label {
    display: flex;
    justify-content: space-between;
    margin-bottom: 6px;
    font-size: 11px;
    color: var(--gray-500);
}

.primer-pos {
    color: var(--gray-400);
}

.primer-sequence {
    font-family: 'Courier New', monospace;
    font-size: 13px;
    margin-bottom: 6px;
    word-break: break-all;
}

.primer-stats {
    display: flex;
    gap: 12px;
    font-size: 11px;
    color: var(--gray-600);
}

.warnings {
    margin: 12px 0;
    padding: 8px 12px;
    background: #fef3c7;
    border-radius: 6px;
}

.warning {
    font-size: 12px;
    color: #92400e;
    margin-bottom: 2px;
}

.card-actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--gray-200);
}

.action-btn {
    flex: 1;
    padding: 6px;
    border: none;
    background: var(--gray-100);
    border-radius: 6px;
    font-size: 11px;
    color: var(--gray-700);
    cursor: pointer;
    transition: all 0.2s;
}

.action-btn:hover {
    background: var(--gray-200);
}

/* Сохраненные элементы */
.saved-item {
    padding: 12px;
    margin-bottom: 8px;
    background: var(--gray-50);
    border-radius: 8px;
}

.saved-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 8px;
}

.saved-name {
    font-weight: 600;
    color: var(--gray-700);
}

.saved-date {
    font-size: 11px;
    color: var(--gray-500);
}

.saved-preview {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
}

.saved-grade {
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
}

.saved-seqs {
    flex: 1;
    font-size: 11px;
    color: var(--gray-600);
}

.saved-actions {
    display: flex;
    gap: 4px;
}

.action-btn.small {
    flex: 1;
    padding: 4px;
    font-size: 10px;
}

.action-btn.delete:hover {
    background: var(--danger);
    color: white;
}

/* Пустое состояние */
.empty-state {
    text-align: center;
    padding: 40px 20px;
    color: var(--gray-500);
}

.empty-icon {
    font-size: 48px;
    margin-bottom: 16px;
    display: block;
}

.empty-state p {
    margin-bottom: 16px;
}

/* Настройки */
.settings-form {
    padding: 8px 0;
}

.checkbox {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
}

.checkbox input {
    width: auto;
}

hr {
    margin: 16px 0;
    border: none;
    border-top: 1px solid var(--gray-200);
}

.stats {
    padding: 12px;
    background: var(--gray-50);
    border-radius: 8px;
    margin-bottom: 16px;
}

.stats h4 {
    margin-bottom: 8px;
    font-size: 13px;
    color: var(--gray-600);
}

.stat-row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 4px;
    font-size: 12px;
}

/* Футер */
.footer {
    margin-top: 20px;
    padding-top: 12px;
    border-top: 1px solid var(--gray-200);
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11px;
    color: var(--gray-500);
}

.links a {
    color: var(--gray-500);
    text-decoration: none;
}

.links a:hover {
    color: var(--primary);
}

.separator {
    margin: 0 4px;
}

/* Уведомления */
.notification {
    position: fixed;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    padding: 8px 16px;
    background: var(--gray-800);
    color: white;
    border-radius: 8px;
    font-size: 13px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    z-index: 1000;
    animation: slideUp 0.3s ease;
}

@keyframes slideUp {
    from {
        transform: translate(-50%, 100%);
        opacity: 0;
    }
    to {
        transform: translate(-50%, 0);
        opacity: 1;
    }
}

/* Темная тема */
@media (prefers-color-scheme: dark) {
    body {
        background: var(--gray-900);
        color: var(--gray-100);
    }
    
    .container {
        background: var(--gray-900);
    }
    
    .header {
        border-bottom-color: var(--gray-800);
    }
    
    .tabs {
        background: var(--gray-800);
    }
    
    .tab {
        color: var(--gray-400);
    }
    
    .tab:hover {
        color: var(--gray-200);
    }
    
    .tab.active {
        background: var(--gray-700);
        color: white;
    }
    
    .quick-insert {
        background: linear-gradient(135deg, #667eea20, #764ba220);
    }
    
    input, select, textarea {
        background: var(--gray-800);
        border-color: var(--gray-700);
        color: var(--gray-100);
    }
    
    .result-card {
        background: var(--gray-800);
        border-color: var(--gray-700);
    }
    
    .primer {
        background: var(--gray-700);
    }
    
    .action-btn {
        background: var(--gray-700);
        color: var(--gray-300);
    }
    
    .action-btn:hover {
        background: var(--gray-600);
    }
    
    .saved-item {
        background: var(--gray-800);
    }
    
    .stats {
        background: var(--gray-800);
    }
    
    .footer {
        border-top-color: var(--gray-800);
    }
    
    .links a {
        color: var(--gray-500);
    }
}
9. Storage Manager
javascript
// lib/storage-manager.js
export class StorageManager {
    constructor() {
        this.prefix = 'pd_';
    }

    async get(key) {
        const result = await chrome.storage.local.get(this.prefix + key);
        return result[this.prefix + key];
    }

    async set(key, value) {
        await chrome.storage.local.set({ [this.prefix + key]: value });
    }

    async remove(key) {
        await chrome.storage.local.remove(this.prefix + key);
    }

    async clear() {
        const all = await chrome.storage.local.get(null);
        const keys = Object.keys(all).filter(k => k.startsWith(this.prefix));
        await chrome.storage.local.remove(keys);
    }

    async addToHistory(item) {
        const history = await this.get('history') || [];
        history.unshift(item);
        
        // Храним только последние 50 записей
        if (history.length > 50) history.pop();
        
        await this.set('history', history);
    }

    async addFeedback(feedback) {
        const feedbacks = await this.get('feedbacks') || [];
        feedbacks.push({
            ...feedback,
            timestamp: Date.now(),
            id: Date.now()
        });
        await this.set('feedbacks', feedbacks);
    }

    async updateStats(update) {
        const stats = await this.get('stats') || {
            primersDesigned: 0,
            savedPrimers: 0,
            syncsCompleted: 0,
            installDate: Date.now()
        };
        
        Object.assign(stats, update);
        await this.set('stats', stats);
    }

    async exportAll() {
        const all = await chrome.storage.local.get(null);
        const data = {};
        
        Object.keys(all).forEach(key => {
            if (key.startsWith(this.prefix)) {
                data[key.replace(this.prefix, '')] = all[key];
            }
        });
        
        return data;
    }

    async importAll(data) {
        const importData = {};
        Object.keys(data).forEach(key => {
            importData[this.prefix + key] = data[key];
        });
        await chrome.storage.local.set(importData);
    }
}





⚠️ Визуализация: схематичное изображение ДНК
Это единственный пункт, который реализован частично.

Что есть сейчас:

Текстовое отображение позиций (start-end)

Визуальные индикаторы качества (цвета, значки)

Предупреждения и рекомендации

Чего нет:

Графической схемы ДНК как линии

Стрелочек, показывающих направление праймеров