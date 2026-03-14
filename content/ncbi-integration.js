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
        this.pageType = this.detectPageType();
        this.extractData();
        this.injectButton();
        this.observeChanges();
    }

    detectPageType() {
        const url = window.location.href;

        if (url.includes('ncbi.nlm.nih.gov/nuccore')) return 'nuccore';
        if (url.includes('ncbi.nlm.nih.gov/protein')) return 'protein';
        if (url.includes('ncbi.nlm.nih.gov/gene')) return 'gene';
        if (url.includes('uniprot.org')) return 'uniprot';
        if (url.includes('ensembl.org')) return 'ensembl';

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

        chrome.runtime.sendMessage({
            type: 'NCBI_DATA_EXTRACTED',
            data
        });
    }

    extractAccession() {
        const accElement = document.querySelector('.acc, .accession, .genbank');
        if (accElement) {
            return accElement.textContent.trim();
        }

        const match = window.location.href.match(/[A-Z]{2}_?\d+\.\d+/);
        return match ? match[0] : null;
    }

    extractSequence() {
        let sequence = '';

        const preElements = document.querySelectorAll('pre');
        for (const pre of preElements) {
            const text = pre.textContent;
            if (text.includes('ORIGIN') || /^[ATCG\s]+$/i.test(text)) {
                sequence = this.cleanSequence(text);
                if (sequence.length > 50) break;
            }
        }

        if (!sequence) {
            const fastaDiv = document.querySelector('.fasta, .sequence');
            if (fastaDiv) {
                sequence = this.cleanSequence(fastaDiv.textContent);
            }
        }

        if (!sequence) {
            const tableCells = document.querySelectorAll('td');
            for (const cell of tableCells) {
                const text = cell.textContent;
                if (text.length > 100 && /^[ATCG\s]+$/i.test(text)) {
                    sequence = this.cleanSequence(text);
                    break;
                }
            }
        }

        return sequence;
    }

    cleanSequence(text) {
        return text
            .replace(/\d+/g, '')
            .replace(/\s/g, '')
            .replace(/ORIGIN/gi, '')
            .replace(/\/\/.*/g, '')
            .toUpperCase()
            .replace(/[^ATCG]/g, '')
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
        // Заглушка для protein-страниц
    }

    extractGeneData() {
        // Заглушка для gene-страниц
    }

    extractUniprotData() {
        // Заглушка для UniProt
    }

    extractEnsemblData() {
        // Заглушка для Ensembl
    }

    injectButton() {
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

        const target = document.querySelector('.page-header, .toplinks, #maincontent');
        if (target) {
            target.appendChild(button);
        } else {
            document.body.insertBefore(button, document.body.firstChild);
        }

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

        chrome.runtime.sendMessage({ type: 'OPEN_POPUP' });
    }

    observeChanges() {
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
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
        const elements = document.querySelectorAll('.feature, .rprt');
        elements.forEach(el => {
            if (el.textContent.includes(feature)) {
                el.classList.add('pd-highlight');

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

const ncbiIntegration = new NCBIIntegration();

