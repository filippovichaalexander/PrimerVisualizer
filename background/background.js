import { PrimerHeuristicEngine } from '../lib/heuristic-engine.js';
import { StorageManager } from '../lib/storage-manager.js';
import { SyncManager } from '../lib/sync-manager.js';

const heuristicEngine = new PrimerHeuristicEngine();
const storage = new StorageManager();
const sync = new SyncManager();

let offlineMode = false;

chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
        await initializeExtension();
    }

    createContextMenus();
    chrome.alarms.create('sync', { periodInMinutes: 30 });
});

// По клику на иконку расширения открываем интерфейс в новой вкладке
chrome.action.onClicked.addListener(() => {
    const url = chrome.runtime.getURL('popup/popup.html');
    chrome.tabs.create({ url });
});

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
}

function createContextMenus() {
    chrome.contextMenus.create({
        id: 'design-primers',
        title: '🧬 Дизайн праймеров для выделенного',
        contexts: ['selection']
    });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
    const selected = (info.selectionText || '').trim();
    if (info.menuItemId === 'design-primers' && selected) {
        quickDesign(selected, tab);
    }
});

async function quickDesign(sequence, tab) {
    const cleaned = sequence.replace(/\s/g, '').toUpperCase();
    if (cleaned.length < 50) {
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: 'Ошибка',
            message: 'Слишком короткая последовательность (минимум 50 нуклеотидов)'
        });
        return;
    }

    const primers = generatePrimers(cleaned);

    await storage.addToHistory({
        sequence: cleaned,
        primers,
        timestamp: Date.now(),
        source: tab?.url || 'manual'
    });

    chrome.tabs.sendMessage(tab.id, {
        type: 'SHOW_QUICK_RESULTS',
        primers
    });
}

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
            exportData();
            break;
        case 'NCBI_DATA_EXTRACTED':
            handleNCBIData(request.data);
            break;
    }

    return true;
});

async function handleOpenWithSequence(data) {
    await storage.set('lastNCBISequence', {
        ...data.metadata,
        sequence: data.sequence,
        timestamp: Date.now()
    });
}

async function handleNCBIData(data) {
    await storage.set('lastNCBISequence', {
        ...data,
        timestamp: Date.now()
    });
}

async function saveFeedback(data) {
    await storage.addFeedback(data);
}

async function exportData() {
    const all = await storage.exportAll();
    console.log('Export data', all);
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'sync' && !offlineMode) {
        await sync.syncAll();
    }
});

