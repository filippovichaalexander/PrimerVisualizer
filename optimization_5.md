










🔐 Реализация личного кабинета в расширении с обработкой конфликтов
Давайте детально реализуем личный кабинет с минималистичным UI и полноценной обработкой конфликтов синхронизации.

📁 Структура новых файлов
text
extension/
├── popup/
│   ├── popup.html (обновлен)
│   ├── popup.js (обновлен)
│   └── popup.css (добавлены стили профиля)
├── lib/
│   ├── user-manager.js (НОВЫЙ)
│   ├── sync-engine.js (НОВЫЙ)
│   └── conflict-resolver.js (НОВЫЙ)
├── icons/
│   └── default-avatar.png
└── background/
    └── background.js (обновлен)
1️⃣ UI для личного кабинета (минималистичный)
popup.html - добавляем секцию профиля
html
<!-- В начало popup.html, после header, до основного контента -->
<div class="user-section" id="userSection">
    <div class="user-profile" id="userProfile">
        <div class="user-avatar" id="userAvatar">
            <img src="../icons/default-avatar.png" alt="avatar" id="avatarImg">
            <div class="avatar-status" id="avatarStatus"></div>
        </div>
        
        <div class="user-info" id="userInfo">
            <div class="user-name" id="userName">Гость</div>
            <div class="user-status-text" id="userStatusText">
                <span class="status-dot offline"></span>
                <span>Оффлайн режим</span>
            </div>
        </div>
        
        <button class="user-menu-btn" id="userMenuBtn" aria-label="Меню пользователя">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M6 9l6 6 6-6"/>
            </svg>
        </button>
    </div>
    
    <!-- Выпадающее меню (изначально скрыто) -->
    <div class="user-dropdown" id="userDropdown" style="display: none;">
        <div class="dropdown-section" id="anonymousSection">
            <div class="dropdown-item" data-action="login">
                <span class="item-icon">🔑</span>
                <span class="item-text">Войти / Зарегистрироваться</span>
            </div>
            <div class="dropdown-divider"></div>
            <div class="dropdown-item" data-action="sync-local">
                <span class="item-icon">🔄</span>
                <span class="item-text">Синхронизировать локально</span>
                <span class="item-badge">оффлайн</span>
            </div>
        </div>
        
        <div class="dropdown-section" id="authenticatedSection" style="display: none;">
            <div class="dropdown-item user-email" id="userEmailDisplay">
                <span class="item-icon">📧</span>
                <span class="item-text" id="userEmail"></span>
            </div>
            <div class="dropdown-divider"></div>
            <div class="dropdown-item" data-action="sync-now">
                <span class="item-icon">🔄</span>
                <span class="item-text">Синхронизировать</span>
                <span class="item-badge" id="lastSyncBadge"></span>
            </div>
            <div class="dropdown-item" data-action="preferences">
                <span class="item-icon">⚙️</span>
                <span class="item-text">Настройки профиля</span>
            </div>
            <div class="dropdown-item" data-action="stats">
                <span class="item-icon">📊</span>
                <span class="item-text">Моя статистика</span>
                <span class="item-badge" id="statsBadge"></span>
            </div>
            <div class="dropdown-divider"></div>
            <div class="dropdown-item" data-action="logout">
                <span class="item-icon">🚪</span>
                <span class="item-text">Выйти</span>
            </div>
        </div>
        
        <div class="dropdown-section sync-status-section" id="syncStatusSection">
            <div class="sync-status-item">
                <span class="sync-status-icon" id="syncStatusIcon">⏳</span>
                <span class="sync-status-text" id="syncStatusText">Синхронизация...</span>
            </div>
            <div class="sync-progress" id="syncProgress" style="display: none;">
                <div class="sync-progress-bar"></div>
                <span class="sync-progress-text">0%</span>
            </div>
        </div>
    </div>
</div>

<!-- Мини-статистика (компактная) -->
<div class="stats-mini" id="statsMini" style="display: none;">
    <div class="stat-item">
        <span class="stat-icon">🎯</span>
        <span class="stat-value" id="statPrimersCount">0</span>
    </div>
    <div class="stat-item">
        <span class="stat-icon">💾</span>
        <span class="stat-value" id="statSavedCount">0</span>
    </div>
    <div class="stat-item">
        <span class="stat-icon">⭐</span>
        <span class="stat-value" id="statSuccessRate">0%</span>
    </div>
</div>
popup.css - стили профиля
css
/* user-section.css - минималистичный и ненавязчивый */
.user-section {
    position: relative;
    margin-bottom: 12px;
    padding: 4px;
    background: linear-gradient(135deg, #f8fafc 0%, #ffffff 100%);
    border-radius: 48px;
    border: 1px solid #e2e8f0;
    box-shadow: 0 1px 2px rgba(0,0,0,0.02);
}

.user-profile {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 12px 6px 8px;
    cursor: pointer;
    transition: background 0.2s;
    border-radius: 40px;
}

.user-profile:hover {
    background: rgba(102, 126, 234, 0.04);
}

.user-avatar {
    position: relative;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    overflow: hidden;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    flex-shrink: 0;
}

.user-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.avatar-status {
    position: absolute;
    bottom: 0;
    right: 0;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 2px solid white;
}

.avatar-status.online { background: #22c55e; }
.avatar-status.offline { background: #94a3b8; }
.avatar-status.syncing { background: #f59e0b; animation: pulse 1s infinite; }

@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
}

.user-info {
    flex: 1;
    min-width: 0;
}

.user-name {
    font-size: 13px;
    font-weight: 600;
    color: #1e293b;
    line-height: 1.3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.user-status-text {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    color: #64748b;
}

.status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    display: inline-block;
}

.status-dot.online { background: #22c55e; box-shadow: 0 0 0 2px #dcfce7; }
.status-dot.offline { background: #94a3b8; }
.status-dot.syncing { background: #f59e0b; animation: pulse 1s infinite; }

.user-menu-btn {
    background: none;
    border: none;
    padding: 4px;
    cursor: pointer;
    color: #94a3b8;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
    flex-shrink: 0;
}

.user-menu-btn:hover {
    background: #f1f5f9;
    color: #475569;
}

/* Выпадающее меню */
.user-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    width: 280px;
    background: white;
    border-radius: 16px;
    box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.02);
    border: 1px solid #e2e8f0;
    z-index: 1000;
    overflow: hidden;
    backdrop-filter: blur(0);
}

.dropdown-section {
    padding: 8px 0;
}

.dropdown-section:not(:last-child) {
    border-bottom: 1px solid #f1f5f9;
}

.dropdown-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    cursor: pointer;
    transition: background 0.15s;
    font-size: 13px;
    color: #334155;
}

.dropdown-item:hover {
    background: #f8fafc;
}

.dropdown-item .item-icon {
    width: 20px;
    font-size: 14px;
    text-align: center;
}

.dropdown-item .item-text {
    flex: 1;
}

.dropdown-item .item-badge {
    font-size: 10px;
    padding: 2px 6px;
    background: #f1f5f9;
    border-radius: 20px;
    color: #64748b;
}

.dropdown-divider {
    height: 1px;
    background: #f1f5f9;
    margin: 4px 0;
}

.user-email {
    font-size: 11px;
    color: #64748b;
    cursor: default;
}

.user-email:hover {
    background: transparent;
}

/* Секция статуса синхронизации */
.sync-status-section {
    background: #fafcff;
    border-top: 1px solid #eef2ff;
}

.sync-status-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 16px;
    font-size: 12px;
    color: #475569;
}

.sync-status-icon {
    font-size: 14px;
}

.sync-progress {
    padding: 0 16px 12px 16px;
}

.sync-progress-bar {
    height: 3px;
    background: #e2e8f0;
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 4px;
}

.sync-progress-bar::after {
    content: '';
    display: block;
    width: 0%;
    height: 100%;
    background: linear-gradient(90deg, #667eea, #764ba2);
    border-radius: 3px;
    transition: width 0.3s ease;
}

.sync-progress-text {
    font-size: 10px;
    color: #94a3b8;
}

/* Мини-статистика */
.stats-mini {
    display: flex;
    justify-content: space-around;
    padding: 8px;
    background: #f8fafc;
    border-radius: 12px;
    margin-bottom: 12px;
    border: 1px solid #e2e8f0;
}

.stat-item {
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-size: 12px;
    color: #64748b;
}

.stat-icon {
    font-size: 12px;
}

.stat-value {
    font-size: 14px;
    font-weight: 600;
    color: #1e293b;
}
2️⃣ Управление пользователем (user-manager.js)
javascript
// lib/user-manager.js
export class UserManager {
    constructor(storage, apiBaseUrl) {
        this.storage = storage;
        this.apiBaseUrl = apiBaseUrl;
        this.currentUser = null;
        this.token = null;
        this.listeners = [];
    }

    async init() {
        // Восстанавливаем сессию
        const savedToken = await this.storage.get('authToken');
        const savedUser = await this.storage.get('currentUser');
        
        if (savedToken && savedUser) {
            this.token = savedToken;
            this.currentUser = savedUser;
            await this.validateToken();
        }
        
        this.notifyListeners();
        return this.currentUser;
    }

    async login(email, password) {
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/auth/login/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Login failed');
            }
            
            const data = await response.json();
            this.token = data.token;
            this.currentUser = data.user;
            
            await this.storage.set('authToken', this.token);
            await this.storage.set('currentUser', this.currentUser);
            
            this.notifyListeners();
            return { success: true, user: this.currentUser };
            
        } catch (error) {
            console.error('Login error:', error);
            return { success: false, error: error.message };
        }
    }

    async register(email, password, name = '') {
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/auth/register/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, name })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Registration failed');
            }
            
            const data = await response.json();
            this.token = data.token;
            this.currentUser = data.user;
            
            await this.storage.set('authToken', this.token);
            await this.storage.set('currentUser', this.currentUser);
            
            this.notifyListeners();
            return { success: true, user: this.currentUser };
            
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async googleLogin() {
        return new Promise((resolve, reject) => {
            const width = 500;
            const height = 600;
            const left = (screen.width / 2) - (width / 2);
            const top = (screen.height / 2) - (height / 2);
            
            const authWindow = window.open(
                `${this.apiBaseUrl}/api/auth/google/`,
                'Google Auth',
                `width=${width},height=${height},top=${top},left=${left}`
            );
            
            const handler = async (event) => {
                if (event.data.type === 'google-auth-success') {
                    window.removeEventListener('message', handler);
                    authWindow.close();
                    
                    this.token = event.data.token;
                    this.currentUser = event.data.user;
                    
                    await this.storage.set('authToken', this.token);
                    await this.storage.set('currentUser', this.currentUser);
                    
                    this.notifyListeners();
                    resolve({ success: true, user: this.currentUser });
                }
                if (event.data.type === 'google-auth-error') {
                    window.removeEventListener('message', handler);
                    authWindow.close();
                    reject(new Error(event.data.error));
                }
            };
            
            window.addEventListener('message', handler);
        });
    }

    async logout() {
        this.token = null;
        this.currentUser = null;
        
        await this.storage.remove('authToken');
        await this.storage.remove('currentUser');
        
        this.notifyListeners();
        return { success: true };
    }

    async validateToken() {
        if (!this.token) return false;
        
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/auth/validate/`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            
            if (!response.ok) {
                await this.logout();
                return false;
            }
            
            const data = await response.json();
            this.currentUser = data.user;
            await this.storage.set('currentUser', this.currentUser);
            return true;
            
        } catch {
            return false;
        }
    }

    isAuthenticated() {
        return !!this.token && !!this.currentUser;
    }

    getUser() {
        return this.currentUser;
    }

    addListener(callback) {
        this.listeners.push(callback);
    }

    notifyListeners() {
        this.listeners.forEach(cb => cb(this.currentUser));
    }
}
3️⃣ Обработка конфликтов синхронизации (конфликт-резолвер)
javascript
// lib/conflict-resolver.js
export class ConflictResolver {
    constructor() {
        this.strategies = {
            'timestamp': this.resolveByTimestamp,
            'merge': this.resolveByMerge,
            'latest': this.resolveByLatest,
            'user': this.resolveByUserChoice
        };
    }

    /**
     * Основной метод разрешения конфликтов
     */
    resolve(conflict, strategy = 'merge') {
        const resolver = this.strategies[strategy] || this.resolveByMerge;
        return resolver.call(this, conflict);
    }

    /**
     * Разрешение по временной метке (берем новейшее)
     */
    resolveByTimestamp(conflict) {
        const { local, remote, type } = conflict;
        
        if (!local || !remote) {
            return local || remote;
        }
        
        const localTime = local.updated_at || local.timestamp || 0;
        const remoteTime = remote.updated_at || remote.timestamp || 0;
        
        return {
            resolved: true,
            data: localTime >= remoteTime ? local : remote,
            strategy: 'timestamp',
            lostData: localTime < remoteTime ? local : remote
        };
    }

    /**
     * Умное слияние (для массивов и объектов)
     */
    resolveByMerge(conflict) {
        const { local, remote, type, context } = conflict;
        
        if (!local) return { resolved: true, data: remote };
        if (!remote) return { resolved: true, data: local };
        
        let merged;
        
        switch (type) {
            case 'primers':
                merged = this.mergePrimers(local, remote);
                break;
            case 'history':
                merged = this.mergeHistory(local, remote);
                break;
            case 'settings':
                merged = this.mergeSettings(local, remote);
                break;
            case 'feedback':
                merged = this.mergeFeedback(local, remote);
                break;
            default:
                merged = this.mergeGeneric(local, remote);
        }
        
        return {
            resolved: true,
            data: merged,
            strategy: 'merge',
            conflictsResolved: this.getResolvedCount(merged, local, remote)
        };
    }

    /**
     * Слияние праймеров (по ID)
     */
    mergePrimers(local, remote) {
        const map = new Map();
        
        // Добавляем локальные
        (local || []).forEach(p => {
            map.set(p.id, { ...p, source: 'local', timestamp: p.timestamp || 0 });
        });
        
        // Добавляем/обновляем из удаленных
        (remote || []).forEach(p => {
            const existing = map.get(p.id);
            const remoteTime = p.timestamp || 0;
            
            if (!existing) {
                map.set(p.id, { ...p, source: 'remote' });
            } else if (remoteTime > existing.timestamp) {
                map.set(p.id, { ...p, source: 'remote' });
            } else if (remoteTime === existing.timestamp) {
                // Одинаковые - берем любой
                map.set(p.id, { ...p, source: 'both' });
            }
        });
        
        return Array.from(map.values()).sort((a, b) => 
            (b.timestamp || 0) - (a.timestamp || 0)
        );
    }

    /**
     * Слияние истории (сохраняем все, удаляем дубликаты)
     */
    mergeHistory(local, remote) {
        const merged = [...(local || []), ...(remote || [])];
        const seen = new Set();
        
        return merged
            .filter(item => {
                const key = `${item.sequence}_${item.timestamp}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
            .slice(0, 200); // Лимит истории
    }

    /**
     * Слияние настроек (глубокое слияние)
     */
    mergeSettings(local, remote) {
        const merged = { ...local, ...remote };
        
        // Для вложенных объектов
        for (const key of ['advancedSettings', 'thresholds', 'saltParams']) {
            if (local[key] && remote[key]) {
                merged[key] = { ...local[key], ...remote[key] };
            }
        }
        
        return merged;
    }

    /**
     * Слияние фидбека (сохраняем оба)
     */
    mergeFeedback(local, remote) {
        const merged = [...(local || []), ...(remote || [])];
        const seen = new Set();
        
        return merged
            .filter(f => {
                if (seen.has(f.id)) return false;
                seen.add(f.id);
                return true;
            })
            .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    }

    /**
     * Универсальное слияние для неизвестных типов
     */
    mergeGeneric(local, remote) {
        // Если оба массивы - объединяем
        if (Array.isArray(local) && Array.isArray(remote)) {
            return [...new Set([...local, ...remote])];
        }
        
        // Если оба объекты - сливаем
        if (typeof local === 'object' && typeof remote === 'object') {
            return { ...local, ...remote };
        }
        
        // Если разные типы - берем удаленное
        return remote;
    }

    /**
     * Разрешение по принципу "последнее изменение"
     */
    resolveByLatest(conflict) {
        return this.resolveByTimestamp(conflict);
    }

    /**
     * Разрешение с выбором пользователя
     */
    resolveByUserChoice(conflict) {
        // Возвращаем оба варианта для UI
        return {
            resolved: false,
            needsUserInput: true,
            local: conflict.local,
            remote: conflict.remote,
            type: conflict.type
        };
    }

    getResolvedCount(merged, local, remote) {
        let count = 0;
        if (local && remote) {
            const localKeys = new Set(Object.keys(local));
            const remoteKeys = new Set(Object.keys(remote));
            const mergedKeys = new Set(Object.keys(merged));
            
            for (const key of mergedKeys) {
                if (localKeys.has(key) && remoteKeys.has(key)) {
                    count++;
                }
            }
        }
        return count;
    }

    /**
     * Детекция конфликтов
     */
    detectConflicts(local, remote, type) {
        const conflicts = [];
        
        if (!local || !remote) return conflicts;
        
        switch (type) {
            case 'primers':
                conflicts.push(...this.detectPrimerConflicts(local, remote));
                break;
            case 'settings':
                conflicts.push(...this.detectSettingsConflicts(local, remote));
                break;
            case 'history':
                conflicts.push(...this.detectHistoryConflicts(local, remote));
                break;
        }
        
        return conflicts;
    }

    detectPrimerConflicts(local, remote) {
        const conflicts = [];
        const localMap = new Map(local.map(p => [p.id, p]));
        const remoteMap = new Map(remote.map(p => [p.id, p]));
        
        for (const [id, localPrimer] of localMap) {
            const remotePrimer = remoteMap.get(id);
            if (remotePrimer) {
                const localTime = localPrimer.timestamp || 0;
                const remoteTime = remotePrimer.timestamp || 0;
                
                // Конфликт если разные версии
                if (localTime !== remoteTime && 
                    JSON.stringify(localPrimer) !== JSON.stringify(remotePrimer)) {
                    conflicts.push({
                        id,
                        type: 'primer',
                        local: localPrimer,
                        remote: remotePrimer,
                        localTime,
                        remoteTime
                    });
                }
            }
        }
        
        return conflicts;
    }

    detectSettingsConflicts(local, remote) {
        const conflicts = [];
        
        for (const key of Object.keys(local)) {
            if (remote[key] !== undefined && 
                JSON.stringify(local[key]) !== JSON.stringify(remote[key])) {
                conflicts.push({
                    key,
                    type: 'setting',
                    local: local[key],
                    remote: remote[key]
                });
            }
        }
        
        return conflicts;
    }

    detectHistoryConflicts(local, remote) {
        // История - меньше конфликтов, просто дубликаты
        const localIds = new Set(local.map(h => h.id));
        const remoteIds = new Set(remote.map(h => h.id));
        const conflicts = [];
        
        for (const id of localIds) {
            if (remoteIds.has(id)) {
                conflicts.push({
                    id,
                    type: 'history',
                    message: 'Duplicate history entry'
                });
            }
        }
        
        return conflicts;
    }
}
4️⃣ Движок синхронизации (sync-engine.js)
javascript
// lib/sync-engine.js
import { ConflictResolver } from './conflict-resolver.js';

export class SyncEngine {
    constructor(storage, userManager, apiBaseUrl) {
        this.storage = storage;
        this.userManager = userManager;
        this.apiBaseUrl = apiBaseUrl;
        this.conflictResolver = new ConflictResolver();
        this.isSyncing = false;
        this.syncQueue = [];
        this.listeners = [];
    }

    async sync(force = false) {
        if (!this.userManager.isAuthenticated()) {
            console.log('Not authenticated, skipping sync');
            return { success: false, reason: 'not_authenticated' };
        }
        
        if (this.isSyncing && !force) {
            console.log('Sync already in progress');
            return { success: false, reason: 'already_syncing' };
        }
        
        this.isSyncing = true;
        this.notifyStatus('syncing', 'Синхронизация...');
        
        try {
            // 1. Pull - получаем изменения с сервера
            const pullResult = await this.pull();
            
            // 2. Разрешаем конфликты
            const resolved = await this.resolveConflicts(pullResult.conflicts);
            
            // 3. Объединяем данные
            const merged = await this.mergeData(resolved);
            
            // 4. Push - отправляем локальные изменения
            const pushResult = await this.push(merged);
            
            // 5. Сохраняем результат
            await this.saveSyncResult(pushResult);
            
            this.notifyStatus('success', 'Синхронизация завершена');
            this.notifyComplete({ success: true, pull: pullResult, push: pushResult });
            
            return { success: true, pull: pullResult, push: pushResult };
            
        } catch (error) {
            console.error('Sync error:', error);
            this.notifyStatus('error', `Ошибка: ${error.message}`);
            return { success: false, error: error.message };
        } finally {
            this.isSyncing = false;
        }
    }

    async pull() {
        const token = this.userManager.token;
        const lastSync = await this.storage.get('lastSyncTime');
        
        const response = await fetch(`${this.apiBaseUrl}/api/sync/pull/`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'X-Last-Sync': lastSync || ''
            }
        });
        
        if (!response.ok) {
            throw new Error(`Pull failed: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Детектируем конфликты
        const conflicts = [];
        for (const [type, remoteData] of Object.entries(data.data || {})) {
            const localData = await this.storage.get(type) || [];
            const typeConflicts = this.conflictResolver.detectConflicts(
                localData, 
                remoteData, 
                type
            );
            conflicts.push(...typeConflicts.map(c => ({ ...c, type })));
        }
        
        return {
            success: true,
            data: data.data || {},
            conflicts,
            timestamp: data.timestamp
        };
    }

    async resolveConflicts(conflicts) {
        if (!conflicts.length) return { resolved: true, data: {} };
        
        const resolvedData = {};
        const unresolved = [];
        
        for (const conflict of conflicts) {
            const resolution = this.conflictResolver.resolve(conflict, 'merge');
            
            if (resolution.resolved) {
                resolvedData[conflict.type] = resolvedData[conflict.type] || [];
                resolvedData[conflict.type].push(resolution.data);
            } else if (resolution.needsUserInput) {
                unresolved.push(conflict);
            }
        }
        
        if (unresolved.length) {
            // Запрашиваем пользователя
            const userResolved = await this.promptUserForConflictResolution(unresolved);
            Object.assign(resolvedData, userResolved);
        }
        
        return { resolved: true, data: resolvedData, unresolved: [] };
    }

    async promptUserForConflictResolution(conflicts) {
        return new Promise((resolve) => {
            const dialog = document.createElement('div');
            dialog.className = 'conflict-dialog';
            dialog.innerHTML = `
                <div class="conflict-dialog-content">
                    <h3>⚠️ Конфликты синхронизации</h3>
                    <p>Обнаружены расхождения между локальными и облачными данными</p>
                    
                    <div class="conflict-list" id="conflictList">
                        ${conflicts.map((c, i) => `
                            <div class="conflict-item" data-index="${i}">
                                <div class="conflict-type">${c.type}</div>
                                <div class="conflict-options">
                                    <label class="conflict-option">
                                        <input type="radio" name="conflict_${i}" value="local" checked>
                                        <span>Локальная версия</span>
                                        <small>${this.formatDate(c.localTime)}</small>
                                    </label>
                                    <label class="conflict-option">
                                        <input type="radio" name="conflict_${i}" value="remote">
                                        <span>Облачная версия</span>
                                        <small>${this.formatDate(c.remoteTime)}</small>
                                    </label>
                                    <label class="conflict-option">
                                        <input type="radio" name="conflict_${i}" value="merge">
                                        <span>Объединить</span>
                                    </label>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                    
                    <div class="conflict-actions">
                        <button class="btn btn-primary" id="resolveConflictsBtn">Применить</button>
                        <button class="btn btn-outline" id="cancelConflictsBtn">Отмена</button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(dialog);
            
            const resolveBtn = dialog.querySelector('#resolveConflictsBtn');
            const cancelBtn = dialog.querySelector('#cancelConflictsBtn');
            
            resolveBtn.onclick = () => {
                const resolved = {};
                conflicts.forEach((c, i) => {
                    const selected = document.querySelector(`input[name="conflict_${i}"]:checked`);
                    const choice = selected ? selected.value : 'local';
                    
                    if (choice === 'local') {
                        resolved[c.type] = resolved[c.type] || [];
                        resolved[c.type].push(c.local);
                    } else if (choice === 'remote') {
                        resolved[c.type] = resolved[c.type] || [];
                        resolved[c.type].push(c.remote);
                    } else {
                        // merge - используем стратегию слияния
                        const merged = this.conflictResolver.resolve(c, 'merge');
                        resolved[c.type] = resolved[c.type] || [];
                        resolved[c.type].push(merged.data);
                    }
                });
                
                dialog.remove();
                resolve(resolved);
            };
            
            cancelBtn.onclick = () => {
                dialog.remove();
                resolve({});
            };
        });
    }

    async push(mergedData) {
        const token = this.userManager.token;
        
        // Собираем только измененные данные
        const changes = {};
        for (const [type, data] of Object.entries(mergedData)) {
            const localData = await this.storage.get(type) || [];
            if (JSON.stringify(localData) !== JSON.stringify(data)) {
                changes[type] = data;
            }
        }
        
        if (Object.keys(changes).length === 0) {
            return { success: true, changes: 0 };
        }
        
        const response = await fetch(`${this.apiBaseUrl}/api/sync/push/`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ changes })
        });
        
        if (!response.ok) {
            throw new Error(`Push failed: ${response.status}`);
        }
        
        return await response.json();
    }

    async mergeData(resolved) {
        const merged = {};
        
        for (const [type, newData] of Object.entries(resolved.data)) {
            const current = await this.storage.get(type) || [];
            
            if (Array.isArray(current) && Array.isArray(newData)) {
                merged[type] = this.mergeArrays(current, newData);
            } else if (typeof current === 'object' && typeof newData === 'object') {
                merged[type] = { ...current, ...newData };
            } else {
                merged[type] = newData;
            }
            
            // Сохраняем
            await this.storage.set(type, merged[type]);
        }
        
        return merged;
    }

    mergeArrays(local, remote) {
        const map = new Map();
        
        // Добавляем локальные
        local.forEach(item => {
            const id = item.id || JSON.stringify(item);
            map.set(id, { ...item, source: 'local', timestamp: item.timestamp || 0 });
        });
        
        // Добавляем/обновляем из удаленных
        remote.forEach(item => {
            const id = item.id || JSON.stringify(item);
            const existing = map.get(id);
            const remoteTime = item.timestamp || 0;
            
            if (!existing || remoteTime > existing.timestamp) {
                map.set(id, { ...item, source: 'remote' });
            }
        });
        
        return Array.from(map.values())
            .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    }

    async saveSyncResult(result) {
        await this.storage.set('lastSyncTime', new Date().toISOString());
        await this.storage.set('lastSyncResult', {
            ...result,
            timestamp: Date.now()
        });
        
        // Обновляем статистику
        const stats = await this.storage.get('stats') || {};
        stats.lastSync = Date.now();
        stats.syncsCompleted = (stats.syncsCompleted || 0) + 1;
        await this.storage.set('stats', stats);
    }

    formatDate(timestamp) {
        if (!timestamp) return '—';
        const date = new Date(timestamp);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    }

    addListener(callback) {
        this.listeners.push(callback);
    }

    notifyStatus(status, message) {
        this.listeners.forEach(cb => cb({ type: 'status', status, message }));
    }

    notifyComplete(result) {
        this.listeners.forEach(cb => cb({ type: 'complete', result }));
    }
}
5️⃣ Бэкенд API (критическое добавление)
Схема базы данных
python
# backend/users/models.py
from django.db import models
from django.contrib.auth.models import AbstractUser
import uuid

class User(AbstractUser):
    """Расширенная модель пользователя"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    avatar = models.URLField(blank=True, null=True)
    preferences = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    last_sync = models.DateTimeField(null=True, blank=True)
    sync_enabled = models.BooleanField(default=True)
    
    class Meta:
        db_table = 'users'
        indexes = [
            models.Index(fields=['email']),
            models.Index(fields=['last_sync']),
        ]

class UserData(models.Model):
    """Модель для хранения данных пользователя с версионированием"""
    DATA_TYPES = [
        ('primers', 'Сохраненные праймеры'),
        ('history', 'История дизайнов'),
        ('settings', 'Настройки'),
        ('feedback', 'Обратная связь'),
        ('stats', 'Статистика'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='data')
    data_type = models.CharField(max_length=20, choices=DATA_TYPES)
    data = models.JSONField()
    version = models.IntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        db_table = 'user_data'
        unique_together = ['user', 'data_type']
        indexes = [
            models.Index(fields=['user', 'data_type', '-updated_at']),
        ]

class SyncLog(models.Model):
    """Лог синхронизации для отладки"""
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    sync_type = models.CharField(max_length=10)  # push/pull
    status = models.CharField(max_length=20)  # success/failed/conflict
    changes_count = models.IntegerField(default=0)
    conflicts = models.JSONField(default=list)
    error = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'sync_logs'
        indexes = [
            models.Index(fields=['user', '-created_at']),
        ]
API эндпоинты
python
# backend/users/views.py
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from django.contrib.auth import authenticate
from django.utils import timezone
import jwt
import json
from .models import User, UserData, SyncLog
from .serializers import UserSerializer, UserDataSerializer

@api_view(['POST'])
@permission_classes([AllowAny])
def register(request):
    """Регистрация нового пользователя"""
    email = request.data.get('email')
    password = request.data.get('password')
    name = request.data.get('name', '')
    
    if not email or not password:
        return Response({'error': 'Email and password required'}, status=400)
    
    if User.objects.filter(email=email).exists():
        return Response({'error': 'Email already registered'}, status=400)
    
    user = User.objects.create_user(
        username=email,
        email=email,
        password=password,
        first_name=name
    )
    
    # Создаем пустые записи данных
    for data_type, _ in UserData.DATA_TYPES:
        UserData.objects.create(
            user=user,
            data_type=data_type,
            data={}
        )
    
    token = generate_token(user)
    
    return Response({
        'token': token,
        'user': UserSerializer(user).data
    })

@api_view(['POST'])
@permission_classes([AllowAny])
def login(request):
    """Вход пользователя"""
    email = request.data.get('email')
    password = request.data.get('password')
    
    user = authenticate(username=email, password=password)
    
    if not user:
        return Response({'error': 'Invalid credentials'}, status=401)
    
    token = generate_token(user)
    
    return Response({
        'token': token,
        'user': UserSerializer(user).data
    })

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def validate_token(request):
    """Проверка валидности токена"""
    return Response({
        'valid': True,
        'user': UserSerializer(request.user).data
    })

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def sync_pull(request):
    """Получение данных с сервера"""
    user = request.user
    last_sync = request.headers.get('X-Last-Sync')
    
    # Получаем все данные пользователя
    data = {}
    for user_data in UserData.objects.filter(user=user):
        # Если указан last_sync, возвращаем только измененные
        if last_sync and user_data.updated_at <= last_sync:
            continue
        data[user_data.data_type] = user_data.data
    
    # Обновляем время последнего пула
    user.last_sync = timezone.now()
    user.save(update_fields=['last_sync'])
    
    # Логируем
    SyncLog.objects.create(
        user=user,
        sync_type='pull',
        status='success',
        changes_count=len(data)
    )
    
    return Response({
        'success': True,
        'data': data,
        'timestamp': user.last_sync.isoformat()
    })

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def sync_push(request):
    """Отправка данных на сервер"""
    user = request.user
    changes = request.data.get('changes', {})
    
    results = {}
    conflicts = []
    
    for data_type, new_data in changes.items():
        try:
            user_data = UserData.objects.get(user=user, data_type=data_type)
            
            # Проверяем версию
            local_version = user_data.version
            remote_version = request.data.get('version', {}).get(data_type, 0)
            
            if remote_version > local_version:
                # Конфликт: на сервере более новая версия
                conflicts.append({
                    'type': data_type,
                    'local_version': local_version,
                    'remote_version': remote_version,
                    'local_data': new_data,
                    'remote_data': user_data.data
                })
            else:
                # Нет конфликта - обновляем
                user_data.data = new_data
                user_data.version += 1
                user_data.updated_at = timezone.now()
                user_data.save()
                results[data_type] = {
                    'status': 'updated',
                    'version': user_data.version
                }
                
        except UserData.DoesNotExist:
            # Создаем новую запись
            user_data = UserData.objects.create(
                user=user,
                data_type=data_type,
                data=new_data,
                version=1
            )
            results[data_type] = {
                'status': 'created',
                'version': 1
            }
    
    # Логируем
    SyncLog.objects.create(
        user=user,
        sync_type='push',
        status='success' if not conflicts else 'conflict',
        changes_count=len(changes),
        conflicts=conflicts
    )
    
    return Response({
        'success': True,
        'results': results,
        'conflicts': conflicts,
        'timestamp': timezone.now().isoformat()
    })

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def resolve_conflict(request):
    """Разрешение конфликта синхронизации"""
    user = request.user
    data_type = request.data.get('type')
    resolution = request.data.get('resolution')  # 'local', 'remote', 'merge'
    merged_data = request.data.get('data')
    
    user_data = UserData.objects.get(user=user, data_type=data_type)
    
    if resolution == 'local':
        # Пользователь выбрал локальную версию - обновляем сервер
        user_data.data = merged_data
    elif resolution == 'remote':
        # Пользователь выбрал серверную версию - ничего не меняем
        pass
    elif resolution == 'merge':
        # Пользователь предоставил объединенную версию
        user_data.data = merged_data
    
    user_data.version += 1
    user_data.updated_at = timezone.now()
    user_data.save()
    
    return Response({
        'success': True,
        'data': user_data.data,
        'version': user_data.version
    })

def generate_token(user):
    """Генерация JWT токена"""
    payload = {
        'user_id': str(user.id),
        'email': user.email,
        'exp': timezone.now() + timezone.timedelta(days=30)
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm='HS256')
URLs
python
# backend/users/urls.py
from django.urls import path
from . import views

urlpatterns = [
    path('auth/register/', views.register, name='register'),
    path('auth/login/', views.login, name='login'),
    path('auth/validate/', views.validate_token, name='validate'),
    path('sync/pull/', views.sync_pull, name='sync-pull'),
    path('sync/push/', views.sync_push, name='sync-push'),
    path('sync/resolve/', views.resolve_conflict, name='sync-resolve'),
]
Настройки для JWT
python
# backend/primer_backend/settings.py
import datetime

# JWT настройки
JWT_SECRET_KEY = os.environ.get('JWT_SECRET_KEY', SECRET_KEY)
JWT_ALGORITHM = 'HS256'
JWT_EXPIRATION_DELTA = datetime.timedelta(days=30)

# Добавляем в INSTALLED_APPS
INSTALLED_APPS = [
    # ...
    'users',  # новое приложение
]

# Добавляем middleware для аутентификации
MIDDLEWARE = [
    # ...
    'users.middleware.JWTAuthenticationMiddleware',
]
6️⃣ Интеграция в popup.js
javascript
// В popup.js добавить импорты
import { UserManager } from '../lib/user-manager.js';
import { SyncEngine } from '../lib/sync-engine.js';

// Инициализация
let userManager;
let syncEngine;

document.addEventListener('DOMContentLoaded', async () => {
    // ... существующий код ...
    
    userManager = new UserManager(storage, API_BASE_URL);
    syncEngine = new SyncEngine(storage, userManager, API_BASE_URL);
    
    await userManager.init();
    
    // Подписываемся на изменения пользователя
    userManager.addListener((user) => updateUIForUser(user));
    
    // Подписываемся на синхронизацию
    syncEngine.addListener((event) => updateSyncStatus(event));
    
    // Обновляем UI
    updateUIForUser(userManager.getUser());
    updateSyncStatusDisplay();
    
    // Если пользователь авторизован - запускаем автосинхронизацию
    if (userManager.isAuthenticated()) {
        const settings = await storage.get('settings');
        if (settings.autoSync !== false) {
            setTimeout(() => syncEngine.sync(), 1000);
        }
    }
});

// Обновление UI в зависимости от статуса пользователя
function updateUIForUser(user) {
    const anonymousSection = document.getElementById('anonymousSection');
    const authenticatedSection = document.getElementById('authenticatedSection');
    const userName = document.getElementById('userName');
    const userEmail = document.getElementById('userEmail');
    const avatarStatus = document.getElementById('avatarStatus');
    const statsMini = document.getElementById('statsMini');
    
    if (user) {
        // Авторизован
        anonymousSection.style.display = 'none';
        authenticatedSection.style.display = 'block';
        userName.textContent = user.first_name || user.email.split('@')[0];
        userEmail.textContent = user.email;
        avatarStatus.className = 'avatar-status online';
        statsMini.style.display = 'flex';
        
        // Загружаем статистику
        loadUserStats();
        
    } else {
        // Аноним
        anonymousSection.style.display = 'block';
        authenticatedSection.style.display = 'none';
        userName.textContent = 'Гость';
        avatarStatus.className = 'avatar-status offline';
        statsMini.style.display = 'none';
    }
}

// Обновление статуса синхронизации
function updateSyncStatus(event) {
    const syncStatusText = document.getElementById('syncStatusText');
    const syncStatusIcon = document.getElementById('syncStatusIcon');
    const syncProgress = document.getElementById('syncProgress');
    
    if (event.type === 'status') {
        syncStatusText.textContent = event.message;
        
        switch (event.status) {
            case 'syncing':
                syncStatusIcon.textContent = '🔄';
                syncProgress.style.display = 'block';
                break;
            case 'success':
                syncStatusIcon.textContent = '✅';
                setTimeout(() => {
                    if (syncStatusText.textContent === 'Синхронизация завершена') {
                        syncStatusText.textContent = 'Готово';
                    }
                }, 2000);
                break;
            case 'error':
                syncStatusIcon.textContent = '⚠️';
                break;
        }
    }
    
    if (event.type === 'complete') {
        setTimeout(() => {
            syncProgress.style.display = 'none';
            updateSyncStatusDisplay();
        }, 1000);
    }
}

// Обработчики UI
function setupUserEventListeners() {
    const userProfile = document.getElementById('userProfile');
    const userMenuBtn = document.getElementById('userMenuBtn');
    const userDropdown = document.getElementById('userDropdown');
    
    const toggleMenu = () => {
        userDropdown.style.display = userDropdown.style.display === 'none' ? 'block' : 'none';
    };
    
    userProfile.addEventListener('click', toggleMenu);
    userMenuBtn.addEventListener('click', toggleMenu);
    
    // Закрываем при клике вне
    document.addEventListener('click', (e) => {
        if (!userProfile.contains(e.target) && !userDropdown.contains(e.target)) {
            userDropdown.style.display = 'none';
        }
    });
    
    // Обработка действий в меню
    document.querySelectorAll('.dropdown-item[data-action]').forEach(item => {
        item.addEventListener('click', async (e) => {
            const action = item.dataset.action;
            userDropdown.style.display = 'none';
            
            switch (action) {
                case 'login':
                    showLoginDialog();
                    break;
                case 'sync-now':
                    await syncEngine.sync(true);
                    break;
                case 'sync-local':
                    await syncEngine.sync(false);
                    break;
                case 'logout':
                    await userManager.logout();
                    break;
                case 'preferences':
                    showPreferencesDialog();
                    break;
                case 'stats':
                    showStatsDialog();
                    break;
            }
        });
    });
}

// Диалог логина
function showLoginDialog() {
    const dialog = document.createElement('div');
    dialog.className = 'auth-dialog';
    dialog.innerHTML = `
        <div class="auth-dialog-content">
            <h3>🔐 Вход в PrimerDesigner</h3>
            
            <form id="loginForm">
                <div class="form-group">
                    <label>Email</label>
                    <input type="email" id="loginEmail" required>
                </div>
                <div class="form-group">
                    <label>Пароль</label>
                    <input type="password" id="loginPassword" required>
                </div>
                
                <div class="auth-actions">
                    <button type="submit" class="btn btn-primary">Войти</button>
                    <button type="button" id="registerSwitch" class="btn btn-link">Нет аккаунта?</button>
                </div>
            </form>
            
            <div class="auth-or">или</div>
            
            <button class="btn btn-google" id="googleLogin">
                <img src="icons/google.svg" alt="Google">
                Войти через Google
            </button>
            
            <div class="auth-note">
                <small>Ваши данные синхронизируются между устройствами</small>
            </div>
        </div>
    `;
    
    document.body.appendChild(dialog);
    
    const form = dialog.querySelector('#loginForm');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const email = dialog.querySelector('#loginEmail').value;
        const password = dialog.querySelector('#loginPassword').value;
        
        const result = await userManager.login(email, password);
        
        if (result.success) {
            dialog.remove();
            await syncEngine.sync();
        } else {
            showNotification('❌ ' + result.error);
        }
    });
    
    dialog.querySelector('#registerSwitch').addEventListener('click', () => {
        dialog.remove();
        showRegisterDialog();
    });
    
    dialog.querySelector('#googleLogin').addEventListener('click', async () => {
        try {
            await userManager.googleLogin();
            dialog.remove();
            await syncEngine.sync();
        } catch (error) {
            showNotification('❌ ' + error.message);
        }
    });
}

// Диалог регистрации
function showRegisterDialog() {
    const dialog = document.createElement('div');
    dialog.className = 'auth-dialog';
    dialog.innerHTML = `
        <div class="auth-dialog-content">
            <h3>📝 Регистрация</h3>
            
            <form id="registerForm">
                <div class="form-group">
                    <label>Имя (опционально)</label>
                    <input type="text" id="regName">
                </div>
                <div class="form-group">
                    <label>Email</label>
                    <input type="email" id="regEmail" required>
                </div>
                <div class="form-group">
                    <label>Пароль</label>
                    <input type="password" id="regPassword" required>
                </div>
                <div class="form-group">
                    <label>Повторите пароль</label>
                    <input type="password" id="regPassword2" required>
                </div>
                
                <div class="auth-actions">
                    <button type="submit" class="btn btn-primary">Зарегистрироваться</button>
                    <button type="button" id="loginSwitch" class="btn btn-link">Уже есть аккаунт?</button>
                </div>
            </form>
            
            <div class="auth-note">
                <small>Регистрируясь, вы соглашаетесь с условиями использования</small>
            </div>
        </div>
    `;
    
    document.body.appendChild(dialog);
    
    const form = dialog.querySelector('#registerForm');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const name = dialog.querySelector('#regName').value;
        const email = dialog.querySelector('#regEmail').value;
        const password = dialog.querySelector('#regPassword').value;
        const password2 = dialog.querySelector('#regPassword2').value;
        
        if (password !== password2) {
            showNotification('❌ Пароли не совпадают');
            return;
        }
        
        const result = await userManager.register(email, password, name);
        
        if (result.success) {
            dialog.remove();
            await syncEngine.sync();
            showNotification('✅ Регистрация успешна!');
        } else {
            showNotification('❌ ' + result.error);
        }
    });
    
    dialog.querySelector('#loginSwitch').addEventListener('click', () => {
        dialog.remove();
        showLoginDialog();
    });
}
📊 Критическое добавление бэкенда: что нужно обязательно
Минимальный набор для работы:
Сервер аутентификации

Регистрация/логин (email + password)

JWT токены

Google OAuth (опционально)

API для данных

POST /api/sync/push - отправка данных

GET /api/sync/pull - получение данных

POST /api/sync/resolve - разрешение конфликтов

База данных

PostgreSQL (минимум) или SQLite для старта

Таблицы: users, user_data, sync_logs

Инфраструктура

HTTPS (обязательно для расширения)

CORS настройки для chrome-extension://*

Стартовый вариант (быстрый старт):
python
# backend/simple_server.py - упрощенная версия для тестирования
from flask import Flask, request, jsonify
from flask_cors import CORS
import jwt
import sqlite3
import json

app = Flask(__name__)
CORS(app)

# Простая SQLite база
conn = sqlite3.connect('users.db', check_same_thread=False)

@app.route('/api/auth/register/', methods=['POST'])
def register():
    # упрощенная реализация
    pass

@app.route('/api/auth/login/', methods=['POST'])
def login():
    # упрощенная реализация
    pass

@app.route('/api/sync/pull/', methods=['GET'])
def sync_pull():
    # упрощенная реализация
    pass

@app.route('/api/sync/push/', methods=['POST'])
def sync_push():
    # упрощенная реализация
    pass

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8000)
🎯 Итог
Теперь у вас есть:

✅ Минималистичный UI для личного кабинета (не перегружает)

✅ Полноценный User Manager с регистрацией/логином

✅ Sync Engine с обработкой конфликтов

✅ Conflict Resolver с 4 стратегиями (timestamp, merge, latest, user)

✅ Бэкенд API с версионированием и логированием

✅ Авто-синхронизация и индикация статуса