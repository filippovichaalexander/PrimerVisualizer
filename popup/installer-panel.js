/**
 * Мастер установки Primer3 в настройках popup.
 * @param {object} ctx
 * @param {import('../lib/storage-manager.js').StorageManager} ctx.storage
 * @param {string} ctx.API_BASE_URL
 * @param {() => object} ctx.getSettings
 * @param {() => void} ctx.updateStatusDisplay
 * @param {(msg: string) => void} ctx.showNotification
 */
export function attachInstallerPanelHandlers(ctx) {
    const { runAutoInstallFlow, verifyInstallation } = createInstallerApi(ctx);

    document.getElementById('installer-auto-btn')?.addEventListener('click', runAutoInstallFlow);
    document.getElementById('installer-verify-btn')?.addEventListener('click', () => verifyInstallation(false));
    document.getElementById('installer-remind-btn')?.addEventListener('click', async () => {
        const postponeMs = 24 * 60 * 60 * 1000;
        await ctx.storage.set('primer3InstallPostponeUntil', Date.now() + postponeMs);
        const { setInstallerStatus } = createInstallerApi(ctx);
        setInstallerStatus('⏰ Напоминание отложено на 24 часа.');
        ctx.showNotification('⏰ Напоминание об установке отложено');
    });
}

function getClientPlatform() {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('win')) return 'windows';
    if (ua.includes('mac')) return 'mac';
    if (ua.includes('linux')) return 'linux';
    return 'unknown';
}

async function detectBestInstallMethod() {
    const platform = getClientPlatform();
    if (typeof WebAssembly !== 'undefined') return { method: 'wasm', platform };
    if (platform === 'windows') return { method: 'portable', platform };
    return { method: 'docker', platform };
}

function createInstallerApi(ctx) {
    const setInstallerStatus = (text, kind = '') => {
        const el = document.getElementById('installer-status');
        if (!el) return;
        el.textContent = text;
        el.className = `installer-status${kind ? ` ${kind}` : ''}`;
    };

    const setInstallerProgress = (active, text = '', percent = 0) => {
        const wrap = document.getElementById('installer-progress');
        const textEl = document.getElementById('installer-progress-text');
        const fill = document.getElementById('installer-progress-fill');
        if (wrap) wrap.classList.toggle('active', !!active);
        if (textEl && text) textEl.textContent = text;
        if (fill) fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    };

    const triggerTextDownload = (filename, content) => {
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    const getInstallScriptContent = (platform) => {
        if (platform === 'windows') {
            return ['# install.ps1', 'iwr -useb https://primerdesigner.io/install.ps1 | iex'].join('\n');
        }
        return ['#!/usr/bin/env bash', 'curl -sSL https://primerdesigner.io/install.sh | bash'].join('\n');
    };

    const verifyInstallation = async (silent = false) => {
        const checks = [
            `${ctx.API_BASE_URL}/api/health/`,
            'http://localhost:8001/health',
            'http://127.0.0.1:8001/health',
        ];
        for (const url of checks) {
            try {
                const resp = await fetch(url, { method: 'GET' });
                if (!resp.ok) continue;
                const data = await resp.json().catch(() => ({}));
                const statusRaw = String(data.primer3_service ?? data.status ?? '').toLowerCase();
                if (statusRaw === 'ok') {
                    await ctx.storage.set('primer3Installed', true);
                    await ctx.storage.set('primer3Method', url.includes('/api/health/') ? 'proxy' : 'direct');
                    const settings = ctx.getSettings();
                    settings.forceOfflineMode = false;
                    const forceOfflineEl = document.getElementById('force-offline');
                    if (forceOfflineEl) forceOfflineEl.checked = false;
                    await ctx.storage.set('settings', settings);
                    ctx.updateStatusDisplay();
                    setInstallerStatus('✅ Primer3 обнаружен и активирован', 'ok');
                    if (!silent) ctx.showNotification('✅ Primer3 успешно установлен и включен');
                    return true;
                }
            } catch (_e) {
                /* ignore */
            }
        }
        setInstallerStatus('⚠️ Primer3 пока не обнаружен. Попробуйте через 10-20 секунд.', 'warn');
        return false;
    };

    const runAutoInstallFlow = async () => {
        const best = await detectBestInstallMethod();
        setInstallerProgress(true, 'Определяем лучший способ...', 15);
        await new Promise((r) => setTimeout(r, 250));

        if (best.method === 'wasm') {
            setInstallerProgress(true, 'WebAssembly доступен: запускаем установщик...', 45);
            await new Promise((r) => setTimeout(r, 350));
            setInstallerProgress(true, 'WASM-модуль не найден, переключаемся на helper-установку...', 65);
        } else {
            setInstallerProgress(
                true,
                `Выбран способ: ${best.method === 'portable' ? 'portable' : 'docker helper'}`,
                55,
            );
        }

        const platform = best.platform;
        const filename = platform === 'windows' ? 'install-primer3.ps1' : 'install-primer3.sh';
        triggerTextDownload(filename, getInstallScriptContent(platform));
        setInstallerProgress(true, 'Скрипт установки скачан. После запуска нажмите "Проверить установку".', 90);
        setInstallerStatus('⬇️ Скачан установщик. Запустите его и нажмите "Проверить установку".');
        ctx.showNotification('⬇️ Файл установщика подготовлен');
    };

    return { setInstallerStatus, setInstallerProgress, verifyInstallation, runAutoInstallFlow };
}

/**
 * Стартовая проверка при открытии popup.
 */
export async function runInstallerStartupCheck(ctx) {
    const statusEl = document.getElementById('installer-status');
    if (!statusEl) return;
    const { setInstallerStatus, setInstallerProgress, verifyInstallation } = createInstallerApi(ctx);

    const postponedUntil = await ctx.storage.get('primer3InstallPostponeUntil');
    if (postponedUntil && Date.now() < postponedUntil) {
        setInstallerStatus('Напоминание отложено. Можно вернуться к установке в любое время.');
        return;
    }
    const ok = await verifyInstallation(true);
    if (!ok) {
        const best = await detectBestInstallMethod();
        const hint = document.getElementById('installer-hint');
        if (hint) {
            hint.textContent =
                best.method === 'wasm'
                    ? 'Попробуем WebAssembly, при необходимости автоматически дадим helper-установщик.'
                    : 'Мастер подготовит установщик и проверит сервис после запуска.';
        }
        setInstallerProgress(false, '', 0);
    }
}
