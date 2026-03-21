import { getPairNumber } from '../lib/primer-result-normalize.js';
import { formatSequence } from './overlap-html.js';

let _blast = null;

/**
 * @param {object} d
 * @param {import('../lib/blast-service.js').BlastService} d.blastService
 * @param {() => object} d.getAdvancedSettings
 * @param {(msg: string) => void} d.showNotification
 * @param {(msg: string) => void} d.showWarning
 */
export function configureBlastUi(d) {
    _blast = d;
}

export async function showBlastResults(pair) {
    if (!_blast) return;
    const { blastService, getAdvancedSettings, showNotification, showWarning } = _blast;
    const organism = getAdvancedSettings().specificityOrganism || 'human';
    showNotification('🧬 BLAST проверка запущена...');
    try {
        const fwd = await blastService.checkPrimerSpecificity(pair.forward.sequence, { organism });
        const rev = await blastService.checkPrimerSpecificity(pair.reverse.sequence, { organism });
        renderBlastModal(pair, fwd, rev, blastService);
    } catch (error) {
        showWarning(`BLAST недоступен: ${error.message || error}`);
        chrome.tabs.create({ url: blastService.getBlastSearchUrl(pair.forward.sequence) });
    }
}

function renderBlastAnalysis(label, result) {
    return `
        <div class="blast-primer-box">
            <h4>${label}</h4>
            <div class="blast-badge ${result.offTargetHits === 0 ? 'good' : 'warn'}">${result.offTargetHits} нецелевых совпадений</div>
            ${result.highRisk.length ? `<div class="blast-risk high"><strong>Высокий риск</strong>${result.highRisk.slice(0, 5).map(h => `<div>${h.description} (${h.identity.toFixed(1)}%)</div>`).join('')}</div>` : ''}
            ${result.mediumRisk.length ? `<div class="blast-risk medium"><strong>Средний риск</strong>${result.mediumRisk.slice(0, 5).map(h => `<div>${h.description} (${h.identity.toFixed(1)}%)</div>`).join('')}</div>` : ''}
        </div>
    `;
}

function renderBlastModal(pair, fwd, rev, blastService) {
    const modal = document.createElement('div');
    modal.className = 'blast-modal';
    modal.innerHTML = `
        <div class="blast-modal-content">
            <h3>🧬 BLAST: Пара #${getPairNumber(pair.id)}</h3>
            <div class="blast-two-col">
                ${renderBlastAnalysis(`Forward: ${formatSequence(pair.forward.sequence)}`, fwd)}
                ${renderBlastAnalysis(`Reverse: ${formatSequence(pair.reverse.sequence)}`, rev)}
            </div>
            <div class="blast-actions">
                <button class="btn btn-outline blast-open-ncbi">Открыть NCBI BLAST</button>
                <button class="btn btn-primary blast-close">Закрыть</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('.blast-close')?.addEventListener('click', () => modal.remove());
    modal.querySelector('.blast-open-ncbi')?.addEventListener('click', () => {
        chrome.tabs.create({ url: blastService.getBlastSearchUrl(pair.forward.sequence) });
    });
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
}
