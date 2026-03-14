// Простейшая заглушка для менеджера синхронизации.
// Дальнейшая логика (облако, ML и т.п.) может быть добавлена позже.

export class SyncManager {
    async syncAll() {
        // здесь может быть отправка всех данных на сервер
        return;
    }

    async syncNow() {
        return this.syncAll();
    }

    async syncFeedback(items) {
        // отправка только фидбэка
        return;
    }
}

