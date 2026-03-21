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

    async clearAll() {
        const all = await chrome.storage.local.get(null);
        const keys = Object.keys(all).filter(k => k.startsWith(this.prefix));
        await chrome.storage.local.remove(keys);
    }

    async addToHistory(item) {
        const history = await this.get('history') || [];
        const ts = item.timestamp ?? Date.now();
        const entry = {
            ...item,
            id: item.id ?? ts,
            timestamp: item.timestamp ?? ts,
        };
        history.unshift(entry);
        const maxHistory = 200;
        if (history.length > maxHistory) history.length = maxHistory;
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

        Object.keys(update).forEach(key => {
            if (typeof update[key] === 'number') {
                stats[key] = (stats[key] || 0) + update[key];
            } else {
                stats[key] = update[key];
            }
        });

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

