/**
 * Основной content script для взаимодействия со страницей
 */

(function () {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    function init() {
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

        document.addEventListener('mouseup', handleTextSelection);
    }

    function getSelectedSequence() {
        const selection = window.getSelection().toString().trim();

        const cleaned = selection
            .replace(/\s/g, '')
            .replace(/\d/g, '')
            .toUpperCase()
            .replace(/[^ATCG]/g, '');

        if (cleaned.length >= 20) {
            return cleaned;
        }

        return findNearbySequence();
    }

    function findNearbySequence() {
        const selection = window.getSelection();
        if (!selection.rangeCount) return null;

        const range = selection.getRangeAt(0);
        const container = range.commonAncestorContainer;

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
            showFloatingButton(selected);
        }
    }

    function showFloatingButton(selectedText) {
        const oldBtn = document.getElementById('pd-floating-btn');
        if (oldBtn) oldBtn.remove();

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

        setTimeout(() => {
            if (btn.parentNode) btn.remove();
        }, 5000);
    }

    function highlightPrimerOnPage(primer) {
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

