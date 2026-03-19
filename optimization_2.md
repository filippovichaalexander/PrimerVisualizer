


Установка через WebAssembly (самый перспективный)
javascript
// background.js
class WasmInstaller {
    async installWithWasm() {
        try {
            // Загружаем WebAssembly модуль с Primer3
            const response = await fetch('https://primerdesigner.io/wasm/primer3.wasm');
            const wasmBuffer = await response.arrayBuffer();
            
            // Компилируем WebAssembly
            const wasmModule = await WebAssembly.compile(wasmBuffer);
            const wasmInstance = await WebAssembly.instantiate(wasmModule, {
                env: {
                    memory: new WebAssembly.Memory({ initial: 100 }),
                    // эмуляция файловой системы
                    fd_write: this.emulateFileSystem.bind(this)
                }
            });
            
            // Запускаем Primer3 прямо в браузере!
            const result = wasmInstance.exports.primer3_design(
                this.sequencePointer,
                this.sequenceLength
            );
            
            return this.parseResult(result);
        } catch (error) {
            console.error('Wasm installation failed:', error);
            this.fallbackToNative();
        }
    }

    // Эмуляция файловой системы для WebAssembly
    emulateFileSystem(fd, iovs, iovs_len, nwritten) {
        // перехватываем вывод Primer3
        return 0;
    }
}
🎯 Лучшее решение: Комбинированный подход
1. Сначала пробуем WebAssembly (если браузер поддерживает)
javascript
async function installBest() {
    // WebAssembly - идеально, работает прямо в браузере
    if (WebAssembly && await checkWasmSupport()) {
        return installWasm();
    }
    
    // Пробуем Native Client (Chrome только)
    if (chrome.nacl) {
        return installNaCl();
    }
    
    // Пробуем автоматический установщик
    if (await checkNativeMessaging()) {
        return installWithHelper();
    }
    
    // Fallback: показываем команду
    showManualCommand();
}
2. UI для установки в расширении
html
<div class="installer-panel">
    <h3>🚀 Установка Primer3</h3>
    
    <!-- Определяем лучший метод автоматически -->
    <div class="auto-install" id="autoInstall">
        <div class="install-status">
            <span class="spinner"></span>
            Определяем лучший способ установки...
        </div>
    </div>
    
    <!-- Или ручной выбор -->
    <div class="manual-options">
        <button class="install-option" data-method="wasm">
            <span class="icon">⚡</span>
            <span class="title">WebAssembly</span>
            <span class="desc">Самый быстрый, работает в браузере</span>
        </button>
        
        <button class="install-option" data-method="docker">
            <span class="icon">🐳</span>
            <span class="title">Docker</span>
            <span class="desc">Для разработчиков</span>
        </button>
        
        <button class="install-option" data-method="portable">
            <span class="icon">📦</span>
            <span class="title">Portable</span>
            <span class="desc">Скачать и запустить</span>
        </button>
    </div>
    
    <!-- Прогресс установки -->
    <div class="install-progress" style="display: none;">
        <div class="progress-bar"></div>
        <div class="progress-message"></div>
    </div>
</div>
3. Проверка после установки
javascript
// После установки автоматически проверяем
async function verifyInstallation() {
    const attempts = [
        () => checkLocalhost('http://localhost:8001/health'),
        () => checkLocalhost('http://127.0.0.1:8001/health'),
        () => checkWasmModule()
    ];
    
    for (const attempt of attempts) {
        try {
            const result = await attempt();
            if (result) {
                await storage.set('primer3Installed', true);
                await storage.set('primer3Method', result.method);
                
                // Показываем успех
                showNotification('✅ Primer3 успешно установлен!');
                
                // Автоматически переключаем в серверный режим
                settings.forceOfflineMode = false;
                await storage.set('settings', settings);
                
                return true;
            }
        } catch (e) {
            continue;
        }
    }
    
    return false;
}
📱 Как это будет выглядеть для пользователя
Шаг 1: Расширение предлагает установку
text
┌─────────────────────────────────────┐
│  PrimerDesigner Pro                  │
├─────────────────────────────────────┤
│                                      │
│  💻 Текущий режим: Локальный         │
│                                      │
│  🚀 Хотите получать ещё более        │
│     точные результаты?               │
│                                      │
│  [✨ Улучшить до Primer3]             │
│                                      │
│  _Не сейчас_  _Напомнить позже_      │
└─────────────────────────────────────┘
Шаг 2: Нажали кнопку - пошла установка
text
┌─────────────────────────────────────┐
│  Установка Primer3                   │
├─────────────────────────────────────┤
│                                      │
│  ⚡ Определяем лучший способ...      │
│                                      │
│  ✅ WebAssembly поддерживается        │
│  📦 Скачивание модуля...             │
│  🔧 Компиляция...                    │
│  🚀 Запуск...                        │
│                                      │
│  [████████████████░░░] 80%           │
│                                      │
│  Установка завершится через 5 сек    │
└─────────────────────────────────────┘
Шаг 3: Готово!
text
┌─────────────────────────────────────┐
│  ✅ Установка завершена!             │
├─────────────────────────────────────┤
│                                      │
│  Теперь вы используете:              │
│  ☁️ Серверный режим (Primer3)        │
│                                      │
│  Точность: 🏆 Эталонная               │
│  Скорость: ⚡ Быстрая (WebAssembly)   │
│                                      │
│  [🚀 Начать дизайн]                   │
│                                      │
└─────────────────────────────────────┘
🎯 Преимущества подхода
Никакого терминала - всё через UI расширения

Автовыбор метода - система сама выбирает лучший способ

WebAssembly - работает прямо в браузере, не требует установки

Docker - для тех, у кого он есть

Portable - для Windows без прав администратора

Автопереключение - после установки сразу включает серверный режим