import { ConflictResolver } from './conflict-resolver.js';
import { mergeFavoriteFolderMaps } from './folder-manager.js';

export class SyncEngine {
    /**
     * @param {import('./storage-manager.js').StorageManager} storage
     * @param {import('./user-manager.js').UserManager} userManager
     * @param {string} apiBaseUrl
     */
    constructor(storage, userManager, apiBaseUrl) {
        this.storage = storage;
        this.userManager = userManager;
        this.apiBaseUrl = (apiBaseUrl || '').replace(/\/$/, '');
        this.conflictResolver = new ConflictResolver();
        this.isSyncing = false;
        this.listeners = [];
    }

    addListener(callback) {
        this.listeners.push(callback);
    }

    notifyStatus(status, message) {
        this.listeners.forEach((cb) => cb({ type: 'status', status, message }));
    }

    notifyComplete(result) {
        this.listeners.forEach((cb) => cb({ type: 'complete', result }));
    }

    async collectPayload() {
        const [savedPrimers, history, settings, advancedSettings, stats, feedbacks, favoritesFolders] =
            await Promise.all([
                this.storage.get('savedPrimers'),
                this.storage.get('history'),
                this.storage.get('settings'),
                this.storage.get('advancedSettings'),
                this.storage.get('stats'),
                this.storage.get('feedbacks'),
                this.storage.get('favoritesFolders'),
            ]);
        return {
            savedPrimers: Array.isArray(savedPrimers) ? savedPrimers : [],
            history: Array.isArray(history) ? history : [],
            settings: settings && typeof settings === 'object' ? settings : {},
            advancedSettings: advancedSettings && typeof advancedSettings === 'object' ? advancedSettings : {},
            stats: stats && typeof stats === 'object' ? stats : {},
            feedbacks: Array.isArray(feedbacks) ? feedbacks : [],
            favoritesFolders:
                favoritesFolders && typeof favoritesFolders === 'object' ? favoritesFolders : {},
            updatedAt: new Date().toISOString(),
        };
    }

    async applyPayload(payload) {
        await this.storage.set('savedPrimers', payload.savedPrimers || []);
        await this.storage.set('history', payload.history || []);
        await this.storage.set('settings', payload.settings || {});
        await this.storage.set('advancedSettings', payload.advancedSettings || {});
        await this.storage.set('stats', payload.stats || {});
        await this.storage.set('feedbacks', Array.isArray(payload.feedbacks) ? payload.feedbacks : []);
        await this.storage.set(
            'favoritesFolders',
            payload.favoritesFolders && typeof payload.favoritesFolders === 'object'
                ? payload.favoritesFolders
                : {},
        );
    }

    /**
     * Локальная синхронизация: слепок в storage vs текущие данные.
     * Первый запуск — только сохраняет слепок.
     */
    async syncLocal() {
        if (this.isSyncing) {
            return { success: false, reason: 'already_syncing' };
        }
        this.isSyncing = true;
        this.notifyStatus('syncing', 'Локальная синхронизация…');
        try {
            const current = await this.collectPayload();
            const snapshot = await this.storage.get('localSyncSnapshot');

            if (snapshot == null) {
                await this.storage.set('localSyncSnapshot', JSON.parse(JSON.stringify(current)));
                await this.storage.updateStats({ syncsCompleted: 1 });
                this.notifyStatus('success', 'Слепок создан. Повторите синхронизацию после изменений.');
                this.notifyComplete({ success: true, mode: 'local', created: true });
                return { success: true, mode: 'local', created: true };
            }

            const critical = this.conflictResolver.detectCriticalPayloadConflicts(current, snapshot);
            /** @type {Map<string, string>} */
            const choices = new Map();

            if (critical.length) {
                const userChoices = await this.promptCriticalConflicts(critical);
                for (const c of critical) {
                    const key = `${c.type}:${c.id}`;
                    choices.set(key, userChoices[key] || 'local');
                }
            }

            const merged = this.mergePayloadsWithChoices(current, snapshot, critical, choices);

            await this.applyPayload(merged);
            await this.storage.set('localSyncSnapshot', JSON.parse(JSON.stringify(merged)));
            await this.storage.set('lastSyncTime', new Date().toISOString());
            await this.storage.updateStats({ syncsCompleted: 1 });

            this.notifyStatus('success', 'Локальная синхронизация завершена');
            this.notifyComplete({ success: true, mode: 'local', criticalResolved: critical.length });
            return { success: true, mode: 'local', criticalResolved: critical.length };
        } catch (e) {
            console.error(e);
            this.notifyStatus('error', e.message || String(e));
            return { success: false, error: e.message };
        } finally {
            this.isSyncing = false;
        }
    }

    mergePayloadsWithChoices(current, snapshot, criticalList, choices) {
        const mergedPrimers = this.mergeSavedPrimersTriple(
            current.savedPrimers,
            snapshot.savedPrimers,
            criticalList.filter((c) => c.type === 'savedPrimers'),
            choices,
        );

        let mergedAdvanced = this.conflictResolver.mergeAdvancedSettings(
            current.advancedSettings,
            snapshot.advancedSettings,
        );
        const advCrit = criticalList.find((c) => c.type === 'advancedSettings');
        if (advCrit) {
            const key = `${advCrit.type}:${advCrit.id}`;
            const ch = choices.get(key) || 'local';
            if (ch === 'local') mergedAdvanced = { ...current.advancedSettings };
            else if (ch === 'remote') mergedAdvanced = { ...snapshot.advancedSettings };
            else {
                mergedAdvanced = this.conflictResolver.mergeAdvancedSettings(
                    current.advancedSettings,
                    snapshot.advancedSettings,
                );
            }
        }

        let mergedSettings = this.conflictResolver.mergeSettings(current.settings, snapshot.settings);
        const setCrit = criticalList.find((c) => c.type === 'settings');
        if (setCrit) {
            const sk = `${setCrit.type}:${setCrit.id}`;
            const ch = choices.get(sk) || 'local';
            if (ch === 'local') mergedSettings = { ...current.settings };
            else if (ch === 'remote') mergedSettings = { ...snapshot.settings };
            else {
                mergedSettings = this.conflictResolver.mergeSettings(current.settings, snapshot.settings);
            }
        }

        const mergedFolders = mergeFavoriteFolderMaps(
            current.favoritesFolders || {},
            snapshot.favoritesFolders || {},
        );

        return {
            savedPrimers: mergedPrimers,
            history: this.conflictResolver.mergeHistory(current.history, snapshot.history),
            settings: mergedSettings,
            advancedSettings: mergedAdvanced,
            stats: { ...snapshot.stats, ...current.stats },
            feedbacks: this.conflictResolver.mergeFeedback(
                current.feedbacks || [],
                snapshot.feedbacks || [],
            ),
            favoritesFolders: mergedFolders,
            updatedAt: new Date().toISOString(),
        };
    }

    mergeSavedPrimersTriple(localArr, remoteArr, criticalPrimers, choices) {
        const lm = new Map((localArr || []).map((p) => [p.id, p]));
        const rm = new Map((remoteArr || []).map((p) => [p.id, p]));
        const ids = new Set([...lm.keys(), ...rm.keys()]);
        const out = [];

        for (const id of ids) {
            const lp = lm.get(id);
            const rp = rm.get(id);
            if (!lp) {
                out.push(rp);
                continue;
            }
            if (!rp) {
                out.push(lp);
                continue;
            }

            const crit = criticalPrimers.find((c) => c.id === id);
            if (crit) {
                const key = `savedPrimers:${id}`;
                const ch = choices.get(key) || 'local';
                if (ch === 'local') out.push({ ...lp });
                else if (ch === 'remote') out.push({ ...rp });
                else {
                    const r = this.conflictResolver.resolveByTimestamp({ local: lp, remote: rp });
                    out.push(r.data);
                }
                continue;
            }

            const fpL = this.conflictResolver.savedPrimerFingerprint(lp);
            const fpR = this.conflictResolver.savedPrimerFingerprint(rp);
            if (fpL === fpR) {
                out.push((lp.timestamp || 0) >= (rp.timestamp || 0) ? lp : rp);
            } else {
                const r = this.conflictResolver.resolveByTimestamp({ local: lp, remote: rp });
                out.push(r.data);
            }
        }
        return out.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    }

    /**
     * @returns {Promise<Record<string, 'local'|'remote'|'merge'>>}
     */
    promptCriticalConflicts(conflicts) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'pd-modal-overlay';
            overlay.style.zIndex = '10050';
            const keyFor = (c) => `${c.type}:${c.id}`;

            const itemsHtml = conflicts
                .map((c, i) => {
                    const title =
                        c.type === 'savedPrimers'
                            ? `Праймер «${(c.local && c.local.name) || c.id}»`
                            : c.type === 'advancedSettings'
                              ? 'Расширенные настройки'
                              : c.type === 'settings'
                                ? 'Основные настройки'
                                : c.reason || c.type;
                    return `
            <div class="pd-conflict-item" data-key="${k}">
              <div class="pd-conflict-title">${title}</div>
              <p class="pd-conflict-reason">${c.reason || 'Критическое расхождение данных'}</p>
              <div class="pd-conflict-options">
                <label class="pd-conflict-opt"><input type="radio" name="crit_${i}" value="local" checked> Локальная копия</label>
                <label class="pd-conflict-opt"><input type="radio" name="crit_${i}" value="remote"> Из слепка</label>
                <label class="pd-conflict-opt"><input type="radio" name="crit_${i}" value="merge"> Новее по дате</label>
              </div>
            </div>`;
                })
                .join('');

            overlay.innerHTML = `
        <div class="pd-modal pd-modal-conflict" role="dialog" aria-modal="true">
          <h3 class="pd-modal-title">Критические конфликты</h3>
          <p class="pd-modal-sub">Выберите, какую версию оставить для каждого пункта.</p>
          <div class="pd-conflict-list">${itemsHtml}</div>
          <div class="pd-modal-actions">
            <button type="button" class="btn btn-primary" id="pd-conflict-ok">Применить</button>
          </div>
        </div>`;

            document.body.appendChild(overlay);

            const finish = () => {
                const result = {};
                conflicts.forEach((c, i) => {
                    const sel = overlay.querySelector(`input[name="crit_${i}"]:checked`);
                    result[keyFor(c)] = (sel && sel.value) || 'local';
                });
                overlay.remove();
                resolve(result);
            };

            overlay.querySelector('#pd-conflict-ok').addEventListener('click', finish);
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) finish();
            });
        });
    }

    async syncCloud(force = false) {
        if (!this.userManager.isAuthenticated()) {
            return { success: false, reason: 'not_authenticated' };
        }
        if (this.isSyncing && !force) {
            return { success: false, reason: 'already_syncing' };
        }
        this.isSyncing = true;
        this.notifyStatus('syncing', 'Синхронизация с сервером…');
        const token = this.userManager.token;

        try {
            const lastSync = await this.storage.get('lastSyncTime');
            const pullRes = await fetch(`${this.apiBaseUrl}/api/sync/pull/`, {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'X-Last-Sync': lastSync || '',
                },
            });

            if (!pullRes.ok) {
                throw new Error(
                    pullRes.status === 404
                        ? 'API синхронизации не настроен на сервере'
                        : `Pull: ${pullRes.status}`,
                );
            }

            const data = await pullRes.json();
            const remoteData = data.data || {};
            const remotePayload = {
                savedPrimers: Array.isArray(remoteData.savedPrimers) ? remoteData.savedPrimers : [],
                history: Array.isArray(remoteData.history) ? remoteData.history : [],
                settings: remoteData.settings && typeof remoteData.settings === 'object' ? remoteData.settings : {},
                advancedSettings:
                    remoteData.advancedSettings && typeof remoteData.advancedSettings === 'object'
                        ? remoteData.advancedSettings
                        : {},
                stats: remoteData.stats && typeof remoteData.stats === 'object' ? remoteData.stats : {},
                feedbacks: Array.isArray(remoteData.feedbacks) ? remoteData.feedbacks : [],
                favoritesFolders:
                    remoteData.favoritesFolders && typeof remoteData.favoritesFolders === 'object'
                        ? remoteData.favoritesFolders
                        : {},
                updatedAt: data.timestamp || new Date().toISOString(),
            };

            const current = await this.collectPayload();
            const critical = this.conflictResolver.detectCriticalPayloadConflicts(current, remotePayload);
            /** @type {Map<string, string>} */
            const choices = new Map();
            if (critical.length) {
                const userChoices = await this.promptCriticalConflicts(critical);
                for (const c of critical) {
                    choices.set(`${c.type}:${c.id}`, userChoices[`${c.type}:${c.id}`] || 'local');
                }
            }

            const merged = this.mergePayloadsWithChoices(current, remotePayload, critical, choices);
            await this.applyPayload(merged);

            const pushRes = await fetch(`${this.apiBaseUrl}/api/sync/push/`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ changes: merged }),
            });

            if (!pushRes.ok) {
                throw new Error(
                    pushRes.status === 404 ? 'API синхронизации не настроен' : `Push: ${pushRes.status}`,
                );
            }

            await this.storage.set('lastSyncTime', new Date().toISOString());
            await this.storage.updateStats({ syncsCompleted: 1 });
            this.notifyStatus('success', 'Облачная синхронизация завершена');
            this.notifyComplete({ success: true, mode: 'cloud' });
            return { success: true, mode: 'cloud' };
        } catch (e) {
            console.warn(e);
            this.notifyStatus('error', e.message || String(e));
            return { success: false, error: e.message };
        } finally {
            this.isSyncing = false;
        }
    }

    /** Универсальная точка входа */
    async sync(force = false) {
        if (this.userManager.isAuthenticated()) {
            return this.syncCloud(force);
        }
        return this.syncLocal();
    }
}
