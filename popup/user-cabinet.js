/**
 * Личный кабинет: меню в шапке и модалка входа.
 * @param {object} o
 * @param {import('../lib/user-manager.js').UserManager} o.userManager
 * @param {import('../lib/sync-engine.js').SyncEngine} o.syncEngine
 * @param {(msg: string) => void} o.showNotification
 * @param {() => Promise<void>} o.onAfterSyncRefresh
 */
export function initUserCabinet(o) {
    const { userManager, syncEngine, showNotification, onAfterSyncRefresh } = o;

    const closeUserDropdown = () => {
        const dd = document.getElementById('user-dropdown');
        const tr = document.getElementById('user-menu-trigger');
        if (dd) dd.hidden = true;
        if (tr) tr.setAttribute('aria-expanded', 'false');
    };

    const updateUserCabinetUI = () => {
        const u = userManager.getUser();
        const label = document.getElementById('user-label');
        const meta = document.getElementById('user-dropdown-meta');
        const logoutBtn = document.getElementById('user-action-logout');
        const cloudBtn = document.getElementById('user-action-sync-cloud');
        if (label) {
            label.textContent = u ? (u.name || u.email || 'Профиль') : 'Гость';
        }
        if (meta) {
            if (!u) meta.textContent = 'Вход, регистрация на сервере или локальный профиль';
            else if (u.localOnly) {
                meta.textContent = u.email
                    ? `${u.name || 'Профиль'} · локально`
                    : `${u.name || 'Профиль'} · только в браузере`;
            } else meta.textContent = u.email || u.name || 'Аккаунт';
        }
        if (logoutBtn) logoutBtn.hidden = !u;
        if (cloudBtn) {
            cloudBtn.disabled = !userManager.isAuthenticated();
            cloudBtn.title = userManager.isAuthenticated()
                ? 'Синхронизация с сервером'
                : 'Нужен серверный вход (токен)';
        }
    };

    const openLoginModal = () => {
        const m = document.getElementById('login-modal');
        if (!m) return;
        const u = userManager.getUser();
        const nameEl = document.getElementById('login-name');
        const emailEl = document.getElementById('login-email');
        if (u && nameEl) nameEl.value = u.name || '';
        if (u && emailEl) emailEl.value = u.email || '';
        m.hidden = false;
    };

    const closeLoginModal = () => {
        const m = document.getElementById('login-modal');
        if (m) m.hidden = true;
    };

    const openRegisterModal = () => {
        const m = document.getElementById('register-modal');
        if (!m) return;
        const u = userManager.getUser();
        const nameEl = document.getElementById('register-name');
        const emailEl = document.getElementById('register-email');
        if (u && nameEl) nameEl.value = u.name || '';
        if (u && emailEl) emailEl.value = u.email || '';
        const p1 = document.getElementById('register-password');
        const p2 = document.getElementById('register-password2');
        if (p1) p1.value = '';
        if (p2) p2.value = '';
        m.hidden = false;
    };

    const closeRegisterModal = () => {
        const m = document.getElementById('register-modal');
        if (m) m.hidden = true;
    };

    userManager.addListener(() => updateUserCabinetUI());
    updateUserCabinetUI();

    syncEngine.addListener((evt) => {
        if (evt.type === 'status' && evt.message && (evt.status === 'success' || evt.status === 'error')) {
            showNotification(evt.message);
        }
        if (evt.type === 'complete' && evt.result?.success) {
            onAfterSyncRefresh();
        }
    });

    const trigger = document.getElementById('user-menu-trigger');
    const dd = document.getElementById('user-dropdown');
    trigger?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!dd) return;
        dd.hidden = !dd.hidden;
        trigger.setAttribute('aria-expanded', String(!dd.hidden));
    });

    document.addEventListener('click', () => closeUserDropdown());

    document.getElementById('user-action-login')?.addEventListener('click', (e) => {
        e.stopPropagation();
        closeUserDropdown();
        closeRegisterModal();
        openLoginModal();
    });

    document.getElementById('user-action-register')?.addEventListener('click', (e) => {
        e.stopPropagation();
        closeUserDropdown();
        closeLoginModal();
        openRegisterModal();
    });

    document.getElementById('user-action-sync-local')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        closeUserDropdown();
        await syncEngine.syncLocal();
    });

    document.getElementById('user-action-sync-cloud')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        closeUserDropdown();
        const r = await syncEngine.syncCloud();
        if (!r.success && r.reason === 'not_authenticated') {
            showNotification('Сначала выполните вход на сервер');
        }
    });

    document.getElementById('user-action-logout')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        closeUserDropdown();
        await userManager.logout();
        showNotification('Вы вышли из профиля');
    });

    const loginModal = document.getElementById('login-modal');
    loginModal?.addEventListener('click', (e) => {
        if (e.target === loginModal) closeLoginModal();
    });
    document.getElementById('login-modal-close')?.addEventListener('click', closeLoginModal);

    document.getElementById('open-register-from-login')?.addEventListener('click', () => {
        closeLoginModal();
        openRegisterModal();
    });

    const registerModal = document.getElementById('register-modal');
    registerModal?.addEventListener('click', (e) => {
        if (e.target === registerModal) closeRegisterModal();
    });
    document.getElementById('register-modal-close')?.addEventListener('click', closeRegisterModal);
    document.getElementById('register-cancel-btn')?.addEventListener('click', closeRegisterModal);

    document.getElementById('open-login-from-register')?.addEventListener('click', () => {
        closeRegisterModal();
        openLoginModal();
    });

    document.getElementById('login-local-btn')?.addEventListener('click', async () => {
        const name = document.getElementById('login-name')?.value?.trim() || '';
        const email = document.getElementById('login-email')?.value?.trim() || '';
        if (!name && !email) {
            showNotification('Укажите имя или email для локального профиля');
            return;
        }
        await userManager.saveLocalProfile({ name: name || 'Пользователь', email });
        closeLoginModal();
        showNotification('Локальный профиль сохранён');
    });

    document.getElementById('login-server-btn')?.addEventListener('click', async () => {
        const email = document.getElementById('login-email')?.value?.trim() || '';
        const password = document.getElementById('login-password')?.value || '';
        if (!email || !password) {
            showNotification('Для входа на сервер укажите email и пароль');
            return;
        }
        const r = await userManager.login(email, password);
        if (r.success) {
            closeLoginModal();
            showNotification('Вход выполнен');
        } else {
            showNotification(r.error || 'Не удалось войти');
        }
    });

    const MIN_PASSWORD_LEN = 6;
    document.getElementById('register-submit-btn')?.addEventListener('click', async () => {
        const name = document.getElementById('register-name')?.value?.trim() || '';
        const email = document.getElementById('register-email')?.value?.trim() || '';
        const password = document.getElementById('register-password')?.value || '';
        const password2 = document.getElementById('register-password2')?.value || '';
        if (!email) {
            showNotification('Укажите email');
            return;
        }
        if (password.length < MIN_PASSWORD_LEN) {
            showNotification(`Пароль не короче ${MIN_PASSWORD_LEN} символов`);
            return;
        }
        if (password !== password2) {
            showNotification('Пароли не совпадают');
            return;
        }
        const r = await userManager.register(email, password, name);
        if (r.success) {
            closeRegisterModal();
            showNotification('Регистрация выполнена, вы вошли в аккаунт');
        } else {
            showNotification(r.error || 'Не удалось зарегистрироваться');
        }
    });
}
