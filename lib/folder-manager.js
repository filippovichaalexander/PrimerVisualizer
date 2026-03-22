/**
 * Иерархия папок для вкладки «Избранное» (optimization_10).
 * Хранение: chrome.storage через StorageManager, ключ favoritesFolders.
 */

export const ROOT_FOLDER_ID = 'root';

const COLORS = ['#3b82f6', '#22c55e', '#eab308', '#ef4444', '#8b5cf6', '#ec4899'];

export function normalizeFavoriteFolderId(folderId) {
    if (folderId == null || folderId === '' || folderId === ROOT_FOLDER_ID) {
        return ROOT_FOLDER_ID;
    }
    return String(folderId);
}

function cloneDeep(obj) {
    return JSON.parse(JSON.stringify(obj));
}

export function mergeFavoriteFolderMaps(local, remote) {
    const L = local && typeof local === 'object' ? local : {};
    const R = remote && typeof remote === 'object' ? remote : {};
    const ids = new Set([...Object.keys(L), ...Object.keys(R)]);
    /** @type {Record<string, any>} */
    const out = {};
    for (const id of ids) {
        const a = L[id];
        const b = R[id];
        if (!a) out[id] = cloneDeep(b);
        else if (!b) out[id] = cloneDeep(a);
        else {
            const ta = Number(a.updatedAt) || 0;
            const tb = Number(b.updatedAt) || 0;
            out[id] = cloneDeep(ta >= tb ? a : b);
        }
    }
    if (!out[ROOT_FOLDER_ID]) {
        out[ROOT_FOLDER_ID] = defaultRoot();
    }
    return out;
}

function defaultRoot() {
    const t = Date.now();
    return {
        id: ROOT_FOLDER_ID,
        name: 'Все праймеры',
        parentId: null,
        children: [],
        createdAt: t,
        updatedAt: t,
        isSystem: true,
        metadata: {
            description: 'Корневая папка со всеми праймерами',
            color: '#3b82f6',
            icon: '📁',
        },
    };
}

export class FolderManager {
    /**
     * @param {import('./storage-manager.js').StorageManager} storage
     */
    constructor(storage) {
        this.storage = storage;
        this.KEY = 'favoritesFolders';
    }

    randomColor() {
        return COLORS[Math.floor(Math.random() * COLORS.length)];
    }

    /** @returns {Promise<Record<string, any>>} */
    async getStructure() {
        let folders = await this.storage.get(this.KEY);
        if (!folders || typeof folders !== 'object' || !folders[ROOT_FOLDER_ID]) {
            folders = { [ROOT_FOLDER_ID]: defaultRoot() };
            await this.storage.set(this.KEY, folders);
        }
        return folders;
    }

    /** @param {Record<string, any>} folders */
    async saveStructure(folders) {
        await this.storage.set(this.KEY, folders);
    }

    /** Сброс дерева до одной корневой папки (например после «Очистить всё» в избранном). */
    async resetToRootOnly() {
        await this.saveStructure({ [ROOT_FOLDER_ID]: defaultRoot() });
    }

    /**
     * @param {string} name
     * @param {string} [parentId]
     * @param {Record<string, unknown>} [metadata]
     */
    async createFolder(name, parentId = ROOT_FOLDER_ID, metadata = {}) {
        const trimmed = String(name || '').trim();
        if (!trimmed) throw new Error('Пустое имя папки');

        const folders = await this.getStructure();
        const parent = folders[parentId];
        if (!parent) throw new Error('Родительская папка не найдена');

        const id = `f_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const t = Date.now();
        const newFolder = {
            id,
            name: trimmed,
            parentId,
            children: [],
            createdAt: t,
            updatedAt: t,
            isSystem: false,
            metadata: {
                description: String(metadata.description || ''),
                color: metadata.color || this.randomColor(),
                icon: metadata.icon || '📂',
            },
        };

        folders[id] = newFolder;
        if (!parent.children.includes(id)) parent.children.push(id);
        parent.updatedAt = t;
        await this.saveStructure(folders);
        return newFolder;
    }

    /**
     * @param {string} folderId
     * @param {{ name?: string, description?: string, color?: string, icon?: string }} patch
     */
    async updateFolderMeta(folderId, patch) {
        const folders = await this.getStructure();
        const f = folders[folderId];
        if (!f || f.isSystem) throw new Error('Нельзя редактировать эту папку');
        if (patch.name != null && String(patch.name).trim()) f.name = String(patch.name).trim();
        if (!f.metadata) f.metadata = {};
        if (patch.description != null) f.metadata.description = String(patch.description);
        if (patch.color != null) f.metadata.color = String(patch.color);
        if (patch.icon != null) f.metadata.icon = String(patch.icon);
        f.updatedAt = Date.now();
        await this.saveStructure(folders);
        return f;
    }

    /**
     * Перенести подпапку к другому родителю.
     * @param {string} folderId
     * @param {string} newParentId
     */
    async reparentFolder(folderId, newParentId) {
        if (folderId === ROOT_FOLDER_ID) return;
        const folders = await this.getStructure();
        const f = folders[folderId];
        const newParent = folders[newParentId];
        if (!f || !newParent) throw new Error('Папка не найдена');
        if (newParentId === folderId) return;
        // не кладём папку внутрь своего потомка
        let p = newParentId;
        while (p) {
            if (p === folderId) throw new Error('Некорректная вложенность');
            p = folders[p]?.parentId;
        }

        const oldParent = folders[f.parentId];
        if (oldParent) {
            oldParent.children = oldParent.children.filter((c) => c !== folderId);
            oldParent.updatedAt = Date.now();
        }
        f.parentId = newParentId;
        if (!newParent.children.includes(folderId)) newParent.children.push(folderId);
        newParent.updatedAt = Date.now();
        f.updatedAt = Date.now();
        await this.saveStructure(folders);
    }

    /**
     * Удалить папку: подпапки и записи переносятся в moveToId.
     * @param {string} folderId
     * @param {string} [moveToId]
     */
    async deleteFolder(folderId, moveToId = ROOT_FOLDER_ID) {
        const folders = await this.getStructure();
        const folder = folders[folderId];
        if (!folder || folder.isSystem) throw new Error('Нельзя удалить системную папку');

        const childFolderIds = [...folder.children];
        for (const cid of childFolderIds) {
            if (folders[cid]) await this.reparentFolder(cid, moveToId);
        }

        const saved = (await this.storage.get('savedPrimers')) || [];
        const t = Date.now();
        for (const item of saved) {
            if (normalizeFavoriteFolderId(item.folderId) === folderId) {
                item.folderId = moveToId === ROOT_FOLDER_ID ? null : moveToId;
                item.updatedAt = t;
            }
        }
        await this.storage.set('savedPrimers', saved);

        const parent = folders[folder.parentId];
        if (parent) {
            parent.children = parent.children.filter((id) => id !== folderId);
            parent.updatedAt = t;
        }
        delete folders[folderId];
        await this.saveStructure(folders);
    }

    /**
     * @param {number|string} favoriteId
     * @param {string} folderId целевая папка (root → null в записи)
     */
    async setFavoriteFolder(favoriteId, folderId) {
        const fid = normalizeFavoriteFolderId(folderId);
        const saved = (await this.storage.get('savedPrimers')) || [];
        const idx = saved.findIndex((f) => String(f.id) === String(favoriteId));
        if (idx === -1) return false;
        const folders = await this.getStructure();
        if (fid !== ROOT_FOLDER_ID && !folders[fid]) return false;
        saved[idx].folderId = fid === ROOT_FOLDER_ID ? null : fid;
        saved[idx].updatedAt = Date.now();
        await this.storage.set('savedPrimers', saved);
        return true;
    }

    /**
     * @param {string} folderId
     * @returns {Promise<{ folder: any, subFolders: any[], primers: any[] }>}
     */
    async getFolderContents(folderId) {
        const folders = await this.getStructure();
        const folder = folders[folderId];
        if (!folder) {
            return { folder: null, subFolders: [], primers: [] };
        }
        const saved = (await this.storage.get('savedPrimers')) || [];
        const subFolders = (folder.children || [])
            .map((cid) => folders[cid])
            .filter(Boolean);
        const primers = saved.filter((p) => normalizeFavoriteFolderId(p.folderId) === folderId);
        return { folder, subFolders, primers };
    }

    /**
     * Счётчики праймеров по папкам (для дерева).
     * @param {Record<string, any>} folders
     * @param {any[]} savedPrimers
     */
    static computePrimerCounts(folders, savedPrimers) {
        /** @type {Record<string, number>} */
        const counts = {};
        for (const id of Object.keys(folders)) counts[id] = 0;
        for (const p of savedPrimers || []) {
            let k = normalizeFavoriteFolderId(p.folderId);
            if (!folders[k]) k = ROOT_FOLDER_ID;
            counts[k] = (counts[k] || 0) + 1;
        }
        return counts;
    }

    /**
     * Плоский список для &lt;select&gt; (имя с отступом).
     * @param {Record<string, any>} folders
     */
    static flatFolderOptions(folders, excludeId = null) {
        const out = [];

        function walk(id, depth) {
            const f = folders[id];
            if (!f || id === excludeId) return;
            const pad = depth > 0 ? `${'·'.repeat(depth)} ` : '';
            out.push({ id, label: `${pad}${f.name}`, depth });
            for (const cid of f.children || []) walk(cid, depth + 1);
        }

        walk(ROOT_FOLDER_ID, 0);
        return out;
    }
}
