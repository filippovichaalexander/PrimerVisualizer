/**
 * Разрешение конфликтов синхронизации (optimization_5.md).
 * Критические: один id сохранённого праймера, но разные последовательности;
 * несовместимые advancedSettings (диапазон продукта); расхождение forceOfflineMode в settings.
 */
export class ConflictResolver {
    constructor() {
        this.strategies = {
            timestamp: this.resolveByTimestamp.bind(this),
            merge: this.resolveByMerge.bind(this),
            latest: this.resolveByLatest.bind(this),
            user: this.resolveByUserChoice.bind(this),
        };
    }

    resolve(conflict, strategy = 'merge') {
        const resolver = this.strategies[strategy] || this.strategies.merge;
        return resolver(conflict);
    }

    resolveByTimestamp(conflict) {
        const { local, remote } = conflict;
        if (!local || !remote) {
            return { resolved: true, data: local || remote, strategy: 'timestamp' };
        }
        const localTime = local.updated_at || local.timestamp || 0;
        const remoteTime = remote.updated_at || remote.timestamp || 0;
        return {
            resolved: true,
            data: localTime >= remoteTime ? local : remote,
            strategy: 'timestamp',
            lostData: localTime < remoteTime ? local : remote,
        };
    }

    resolveByMerge(conflict) {
        const { local, remote, type } = conflict;
        if (!local) return { resolved: true, data: remote, strategy: 'merge' };
        if (!remote) return { resolved: true, data: local, strategy: 'merge' };

        let merged;
        switch (type) {
            case 'primers':
            case 'savedPrimers':
                merged = this.mergePrimers(local, remote);
                break;
            case 'history':
                merged = this.mergeHistory(local, remote);
                break;
            case 'settings':
                merged = this.mergeSettings(local, remote);
                break;
            case 'advancedSettings':
                merged = this.mergeAdvancedSettings(local, remote);
                break;
            case 'feedback':
                merged = this.mergeFeedback(local, remote);
                break;
            default:
                merged = this.mergeGeneric(local, remote);
        }
        return { resolved: true, data: merged, strategy: 'merge' };
    }

    mergePrimers(local, remote) {
        const map = new Map();
        (local || []).forEach((p) => {
            map.set(p.id, { ...p, source: 'local', timestamp: p.timestamp || 0 });
        });
        (remote || []).forEach((p) => {
            const existing = map.get(p.id);
            const remoteTime = p.timestamp || 0;
            if (!existing) {
                map.set(p.id, { ...p, source: 'remote' });
            } else if (remoteTime > existing.timestamp) {
                map.set(p.id, { ...p, source: 'remote' });
            } else if (remoteTime === existing.timestamp) {
                map.set(p.id, { ...p, source: 'both' });
            }
        });
        return Array.from(map.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    }

    mergeHistory(local, remote) {
        const merged = [...(local || []), ...(remote || [])];
        const seen = new Set();
        return merged
            .filter((item) => {
                const key = `${item.sequence}_${item.timestamp}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
            .slice(0, 200);
    }

    mergeSettings(local, remote) {
        const merged = { ...(local || {}), ...(remote || {}) };
        for (const key of ['advancedSettings', 'thresholds', 'saltParams']) {
            if (local?.[key] && remote?.[key]) {
                merged[key] = { ...local[key], ...remote[key] };
            }
        }
        return merged;
    }

    mergeAdvancedSettings(local, remote) {
        return { ...(local || {}), ...(remote || {}) };
    }

    mergeFeedback(local, remote) {
        const merged = [...(local || []), ...(remote || [])];
        const seen = new Set();
        return merged
            .filter((f) => {
                if (seen.has(f.id)) return false;
                seen.add(f.id);
                return true;
            })
            .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    }

    mergeGeneric(local, remote) {
        if (Array.isArray(local) && Array.isArray(remote)) {
            return [...new Set([...local, ...remote])];
        }
        if (typeof local === 'object' && typeof remote === 'object') {
            return { ...local, ...remote };
        }
        return remote;
    }

    resolveByLatest(conflict) {
        return this.resolveByTimestamp(conflict);
    }

    resolveByUserChoice(conflict) {
        return {
            resolved: false,
            needsUserInput: true,
            local: conflict.local,
            remote: conflict.remote,
            type: conflict.type,
            id: conflict.id,
            severity: conflict.severity,
        };
    }

    /** Отпечаток содержимого сохранённой пары (критический конфликт по id). */
    savedPrimerFingerprint(p) {
        const pair = p.pair || p;
        const f = (pair?.forward?.sequence || '').replace(/\s/g, '');
        const r = (pair?.reverse?.sequence || '').replace(/\s/g, '');
        return `${f}|${r}|${p.name || ''}`;
    }

    /**
     * Критические конфликты между двумя полными слепками данных.
     * @returns {Array<{ type: string, id: any, severity: 'critical', local: any, remote: any, localTime?: number, remoteTime?: number, reason?: string }>}
     */
    detectCriticalPayloadConflicts(localPayload, remotePayload) {
        const conflicts = [];
        const loc = localPayload.savedPrimers || [];
        const rem = remotePayload.savedPrimers || [];
        const lm = new Map(loc.map((p) => [p.id, p]));
        const rm = new Map(rem.map((p) => [p.id, p]));
        for (const [id, lp] of lm) {
            const rp = rm.get(id);
            if (!rp) continue;
            if (this.savedPrimerFingerprint(lp) !== this.savedPrimerFingerprint(rp)) {
                conflicts.push({
                    type: 'savedPrimers',
                    id,
                    severity: 'critical',
                    reason: 'Один id, разные последовательности праймеров',
                    local: lp,
                    remote: rp,
                    localTime: lp.timestamp,
                    remoteTime: rp.timestamp,
                });
            }
        }

        const ls = localPayload.settings || {};
        const rs = remotePayload.settings || {};
        if (Boolean(ls.forceOfflineMode) !== Boolean(rs.forceOfflineMode)) {
            conflicts.push({
                type: 'settings',
                id: 'forceOfflineMode',
                severity: 'critical',
                reason: 'Принудительный локальный режим (сервер/локально) расходится',
                local: ls,
                remote: rs,
            });
        }

        const la = localPayload.advancedSettings || {};
        const ra = remotePayload.advancedSettings || {};
        const advReasons = [];

        const minL = la.minProductSize;
        const maxL = la.maxProductSize;
        const minR = ra.minProductSize;
        const maxR = ra.maxProductSize;
        if (
            minL != null &&
            maxL != null &&
            minR != null &&
            maxR != null &&
            (minL !== minR || maxL !== maxR) &&
            Math.min(minL, minR) > Math.max(maxL, maxR)
        ) {
            advReasons.push('диапазоны размера продукта несовместимы');
        }

        if (advReasons.length) {
            conflicts.push({
                type: 'advancedSettings',
                id: 'combined',
                severity: 'critical',
                reason: advReasons.join('; '),
                local: la,
                remote: ra,
            });
        }

        return conflicts;
    }

    detectConflicts(local, remote, type) {
        const conflicts = [];
        if (!local || !remote) return conflicts;
        switch (type) {
            case 'primers':
            case 'savedPrimers':
                conflicts.push(...this.detectPrimerConflicts(local, remote));
                break;
            case 'settings':
                conflicts.push(...this.detectSettingsConflicts(local, remote));
                break;
            case 'history':
                conflicts.push(...this.detectHistoryConflicts(local, remote));
                break;
            default:
                break;
        }
        return conflicts;
    }

    detectPrimerConflicts(local, remote) {
        const conflicts = [];
        const localMap = new Map((local || []).map((p) => [p.id, p]));
        const remoteMap = new Map((remote || []).map((p) => [p.id, p]));
        for (const [id, localPrimer] of localMap) {
            const remotePrimer = remoteMap.get(id);
            if (!remotePrimer) continue;
            const localTime = localPrimer.timestamp || 0;
            const remoteTime = remotePrimer.timestamp || 0;
            if (
                localTime !== remoteTime &&
                JSON.stringify(localPrimer) !== JSON.stringify(remotePrimer)
            ) {
                conflicts.push({
                    id,
                    type: 'primer',
                    local: localPrimer,
                    remote: remotePrimer,
                    localTime,
                    remoteTime,
                    severity:
                        this.savedPrimerFingerprint(localPrimer) !==
                        this.savedPrimerFingerprint(remotePrimer)
                            ? 'critical'
                            : 'normal',
                });
            }
        }
        return conflicts;
    }

    detectSettingsConflicts(local, remote) {
        const conflicts = [];
        if (!local || !remote) return conflicts;
        for (const key of Object.keys(local)) {
            if (remote[key] !== undefined && JSON.stringify(local[key]) !== JSON.stringify(remote[key])) {
                conflicts.push({
                    key,
                    type: 'setting',
                    local: local[key],
                    remote: remote[key],
                });
            }
        }
        return conflicts;
    }

    detectHistoryConflicts(local, remote) {
        const localIds = new Set((local || []).map((h) => h.id).filter(Boolean));
        const remoteIds = new Set((remote || []).map((h) => h.id).filter(Boolean));
        const conflicts = [];
        for (const id of localIds) {
            if (remoteIds.has(id)) {
                conflicts.push({ id, type: 'history', message: 'Duplicate history entry' });
            }
        }
        return conflicts;
    }
}
