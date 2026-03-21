/**
 * Текст ошибки из JSON ответа DRF (detail может быть строкой или массивом).
 * @param {unknown} err
 * @param {string} fallback
 */
function formatApiErrorDetail(err, fallback) {
    if (!err || typeof err !== 'object') return fallback;
    const d = /** @type {{ detail?: unknown; message?: unknown }} */ (err).detail;
    const m = /** @type {{ message?: unknown }} */ (err).message;
    const raw = d != null ? d : m;
    if (typeof raw === 'string') return raw;
    if (Array.isArray(raw)) return raw.map(String).join(' ');
    if (raw && typeof raw === 'object') {
        try {
            return JSON.stringify(raw);
        } catch {
            return fallback;
        }
    }
    return fallback;
}

/**
 * Профиль и сессия пользователя (локально + опционально сервер).
 * Соответствует optimization_5.md; при отсутствии API — режим локального профиля.
 */
export class UserManager {
    /**
     * @param {import('./storage-manager.js').StorageManager} storage
     * @param {string} apiBaseUrl
     */
    constructor(storage, apiBaseUrl) {
        this.storage = storage;
        this.apiBaseUrl = (apiBaseUrl || '').replace(/\/$/, '');
        this.currentUser = null;
        this.token = null;
        this.listeners = [];
    }

    async init() {
        const savedToken = await this.storage.get('authToken');
        const savedUser = await this.storage.get('currentUser');

        if (savedToken && savedUser) {
            this.token = savedToken;
            this.currentUser = savedUser;
            await this.validateToken();
        } else if (savedUser) {
            this.currentUser = savedUser;
        }

        this.notifyListeners();
        return this.currentUser;
    }

    async login(email, password) {
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/auth/login/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });

            if (!response.ok) {
                let detail = 'Не удалось войти';
                try {
                    const err = await response.json();
                    detail = formatApiErrorDetail(err, detail);
                } catch {
                    if (response.status === 404) {
                        detail = 'Сервер не найден: проверьте, что backend запущен и в config.js верный URL';
                    }
                }
                throw new Error(detail);
            }

            const data = await response.json();
            this.token = data.token;
            this.currentUser = { ...data.user, localOnly: false };

            await this.storage.set('authToken', this.token);
            await this.storage.set('currentUser', this.currentUser);

            this.notifyListeners();
            return { success: true, user: this.currentUser };
        } catch (error) {
            console.warn('Login error:', error);
            return { success: false, error: error.message || String(error) };
        }
    }

    async register(email, password, name = '') {
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/auth/register/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, name }),
            });

            if (!response.ok) {
                let detail = 'Регистрация не выполнена';
                try {
                    const err = await response.json();
                    detail = formatApiErrorDetail(err, detail);
                } catch {
                    if (response.status === 404) {
                        detail =
                            'Эндпоинт /api/auth/register/ не найден — обновите backend (docker compose up --build) и выполните migrate';
                    }
                }
                throw new Error(detail);
            }

            const data = await response.json();
            this.token = data.token;
            this.currentUser = { ...data.user, localOnly: false };

            await this.storage.set('authToken', this.token);
            await this.storage.set('currentUser', this.currentUser);

            this.notifyListeners();
            return { success: true, user: this.currentUser };
        } catch (error) {
            return { success: false, error: error.message || String(error) };
        }
    }

    /**
     * Локальный профиль без сервера (личный кабинет офлайн).
     */
    async saveLocalProfile({ name, email }) {
        this.currentUser = {
            id: `local_${Date.now()}`,
            name: name || 'Пользователь',
            email: email || '',
            localOnly: true,
        };
        this.token = null;
        await this.storage.remove('authToken');
        await this.storage.set('currentUser', this.currentUser);
        this.notifyListeners();
        return { success: true, user: this.currentUser };
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
                headers: { Authorization: `Bearer ${this.token}` },
            });
            if (response.status === 401 || response.status === 403) {
                await this.logout();
                return false;
            }
            if (!response.ok) return true;
            const data = await response.json();
            if (data.user) {
                this.currentUser = { ...data.user, localOnly: false };
                await this.storage.set('currentUser', this.currentUser);
            }
            return true;
        } catch {
            return true;
        }
    }

    /** Есть токен для облачной синхронизации */
    isAuthenticated() {
        return !!this.token && !!this.currentUser;
    }

    /** Показан профиль (локальный или серверный) */
    hasProfile() {
        return !!this.currentUser;
    }

    getUser() {
        return this.currentUser;
    }

    addListener(callback) {
        this.listeners.push(callback);
    }

    notifyListeners() {
        this.listeners.forEach((cb) => cb(this.currentUser));
    }
}
