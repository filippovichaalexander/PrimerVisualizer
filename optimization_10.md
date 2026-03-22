Поддиректории для Избранного
Да, это превосходная идея, которая превращает простое хранилище праймеров в организованную лабораторную базу знаний. Давайте разберем реализацию и преимущества.

🎯 Почему это критически важно для биолога
Проблемы текущего подхода:
50+ праймеров в одном списке → хаос

Непонятно, какие праймеры для какого эксперимента

Смешиваются проверенные и экспериментальные

Нет связи между праймерами и научными проектами

Преимущества структурирования:
Аспект	Без папок	С папками
Организация	Один большой список	Иерархическая структура
Поиск	Поиск по названию	Навигация по проектам
Контекст	Непонятно, для чего	Привязка к эксперименту
Совместная работа	Затруднена	Можно делиться папками
Воспроизводимость	Низкая	Высокая (протокол + папка)
📁 Архитектура поддиректорий
1. Структура данных
javascript
// storage-manager.js - расширение структуры

class FolderManager {
    constructor(storage) {
        this.storage = storage;
        this.FOLDERS_KEY = 'favorites_folders';
    }
    
    // Структура папок
    async getFolderStructure() {
        let folders = await this.storage.get(this.FOLDERS_KEY);
        if (!folders) {
            // Инициализация с корневой папкой
            folders = {
                root: {
                    id: 'root',
                    name: 'Все праймеры',
                    parentId: null,
                    children: [],
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    isSystem: true,
                    // Метаданные для биолога
                    metadata: {
                        description: 'Корневая папка со всеми праймерами',
                        color: '#3b82f6',
                        icon: '📁'
                    }
                }
            };
            await this.storage.set(this.FOLDERS_KEY, folders);
        }
        return folders;
    }
    
    // Создание папки
    async createFolder(name, parentId = 'root', metadata = {}) {
        const folders = await this.getFolderStructure();
        const id = `folder_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        
        const newFolder = {
            id,
            name: name.trim(),
            parentId,
            children: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
            isSystem: false,
            metadata: {
                description: metadata.description || '',
                color: metadata.color || this.getRandomColor(),
                icon: metadata.icon || '📂',
                ...metadata
            }
        };
        
        folders[id] = newFolder;
        folders[parentId].children.push(id);
        folders[parentId].updatedAt = Date.now();
        
        await this.storage.set(this.FOLDERS_KEY, folders);
        return newFolder;
    }
    
    // Перемещение элемента в папку
    async moveToFolder(favoriteId, folderId) {
        // Обновляем привязку праймера к папке
        const favorites = await this.storage.get('savedPrimers') || [];
        const index = favorites.findIndex(f => f.id === favoriteId);
        
        if (index !== -1) {
            favorites[index].folderId = folderId;
            favorites[index].updatedAt = Date.now();
            await this.storage.set('savedPrimers', favorites);
        }
        
        // Обновляем статистику папки
        await this.updateFolderStats(folderId);
    }
    
    // Получение содержимого папки
    async getFolderContents(folderId) {
        const folders = await this.getFolderStructure();
        const favorites = await this.storage.get('savedPrimers') || [];
        
        // Подпапки
        const subFolders = folders[folderId].children
            .map(childId => folders[childId])
            .filter(f => f);
        
        // Праймеры в этой папке
        const primers = favorites.filter(f => f.folderId === folderId);
        
        return {
            folder: folders[folderId],
            subFolders,
            primers
        };
    }
    
    // Удаление папки (с перемещением содержимого)
    async deleteFolder(folderId, moveToId = 'root') {
        const folders = await this.getFolderStructure();
        const folder = folders[folderId];
        
        if (!folder || folder.isSystem) {
            throw new Error('Нельзя удалить системную папку');
        }
        
        // Перемещаем все подпапки
        for (const childId of folder.children) {
            await this.moveFolder(childId, moveToId);
        }
        
        // Перемещаем все праймеры
        const favorites = await this.storage.get('savedPrimers') || [];
        for (const fav of favorites) {
            if (fav.folderId === folderId) {
                fav.folderId = moveToId;
                fav.updatedAt = Date.now();
            }
        }
        await this.storage.set('savedPrimers', favorites);
        
        // Удаляем папку из родителя
        const parent = folders[folder.parentId];
        if (parent) {
            parent.children = parent.children.filter(id => id !== folderId);
            parent.updatedAt = Date.now();
        }
        
        // Удаляем папку
        delete folders[folderId];
        await this.storage.set(this.FOLDERS_KEY, folders);
    }
    
    getRandomColor() {
        const colors = ['#3b82f6', '#22c55e', '#eab308', '#ef4444', '#8b5cf6', '#ec489a'];
        return colors[Math.floor(Math.random() * colors.length)];
    }
    
    async updateFolderStats(folderId) {
        const contents = await this.getFolderContents(folderId);
        const folders = await this.getFolderStructure();
        
        folders[folderId].stats = {
            primerCount: contents.primers.length,
            subfolderCount: contents.subFolders.length,
            bestScore: Math.max(...contents.primers.map(p => p.pair?.totalScore || 0), 0),
            lastUpdated: Date.now()
        };
        
        await this.storage.set(this.FOLDERS_KEY, folders);
    }
}
2. UI для управления папками
html
<!-- В popup.html, добавить панель папок в избранное -->
<div class="favorites-folder-panel">
    <div class="folder-header">
        <span class="folder-title">📁 Структура проектов</span>
        <button class="btn btn-small btn-outline" id="new-folder-btn">
            ➕ Новая папка
        </button>
    </div>
    
    <div class="folder-tree" id="folder-tree">
        <!-- Динамическое дерево папок -->
    </div>
</div>

<!-- Модальное окно для создания/редактирования папки -->
<div id="folder-modal" class="pd-modal-overlay" hidden>
    <div class="pd-modal">
        <button class="pd-modal-close" id="folder-modal-close">✕</button>
        <h3 class="pd-modal-title" id="folder-modal-title">Новая папка</h3>
        
        <label class="pd-field">
            <span>Название папки</span>
            <input type="text" id="folder-name" placeholder="Например: COVID-19 проекты">
        </label>
        
        <label class="pd-field">
            <span>Описание</span>
            <textarea id="folder-description" rows="3" placeholder="Краткое описание проекта..."></textarea>
        </label>
        
        <label class="pd-field">
            <span>Цвет</span>
            <select id="folder-color">
                <option value="#3b82f6">🔵 Синий</option>
                <option value="#22c55e">🟢 Зеленый</option>
                <option value="#eab308">🟡 Желтый</option>
                <option value="#ef4444">🔴 Красный</option>
                <option value="#8b5cf6">🟣 Фиолетовый</option>
                <option value="#ec489a">🌸 Розовый</option>
            </select>
        </label>
        
        <label class="pd-field">
            <span>Иконка</span>
            <select id="folder-icon">
                <option value="📁">📁 Папка</option>
                <option value="🧬">🧬 Генетика</option>
                <option value="🔬">🔬 Микроскоп</option>
                <option value="🧪">🧪 Пробирка</option>
                <option value="📊">📊 Статистика</option>
                <option value="📝">📝 Документ</option>
                <option value="⭐">⭐ Избранное</option>
                <option value="🏷️">🏷️ Тег</option>
            </select>
        </label>
        
        <div class="pd-modal-actions">
            <button class="btn btn-outline" id="cancel-folder">Отмена</button>
            <button class="btn btn-primary" id="create-folder">Создать</button>
        </div>
    </div>
</div>
3. Рендеринг дерева папок
javascript
// В popup.js добавить

class FolderTreeRenderer {
    constructor(folderManager, containerId) {
        this.folderManager = folderManager;
        this.container = document.getElementById(containerId);
        this.selectedFolderId = 'root';
        this.onFolderSelect = null;
    }
    
    async render() {
        const folders = await this.folderManager.getFolderStructure();
        const root = folders['root'];
        
        const html = await this.renderNode('root', folders, 0);
        this.container.innerHTML = html;
        
        // Добавляем обработчики
        this.attachEventListeners();
    }
    
    async renderNode(folderId, folders, level) {
        const folder = folders[folderId];
        if (!folder) return '';
        
        const stats = folder.stats || { primerCount: 0, subfolderCount: 0 };
        const isExpanded = this.expandedFolders?.has(folderId) ?? true;
        const hasChildren = folder.children.length > 0;
        const isSelected = this.selectedFolderId === folderId;
        
        const style = `
            padding-left: ${level * 20}px;
            border-left-color: ${folder.metadata?.color || '#e2e8f0'};
        `;
        
        let html = `
            <div class="folder-node" data-folder-id="${folderId}" style="${style}">
                <div class="folder-node-header ${isSelected ? 'selected' : ''}" data-folder-id="${folderId}">
                    <span class="folder-expand ${hasChildren ? 'has-children' : ''}" data-folder-id="${folderId}">
                        ${hasChildren ? (isExpanded ? '▼' : '▶') : ' '}
                    </span>
                    <span class="folder-icon">${folder.metadata?.icon || '📁'}</span>
                    <span class="folder-name" style="color: ${folder.metadata?.color || '#334155'}">
                        ${escapeHtml(folder.name)}
                    </span>
                    <span class="folder-stats">
                        ${stats.primerCount > 0 ? `📌 ${stats.primerCount}` : ''}
                        ${stats.subfolderCount > 0 ? `📁 ${stats.subfolderCount}` : ''}
                    </span>
                    <div class="folder-actions">
                        <button class="folder-action-btn" data-action="new" data-folder-id="${folderId}" title="Создать подпапку">➕</button>
                        ${!folder.isSystem ? `
                            <button class="folder-action-btn" data-action="edit" data-folder-id="${folderId}" title="Редактировать">✏️</button>
                            <button class="folder-action-btn" data-action="delete" data-folder-id="${folderId}" title="Удалить">🗑️</button>
                        ` : ''}
                    </div>
                </div>
                ${hasChildren && isExpanded ? `
                    <div class="folder-children" data-parent="${folderId}">
                        ${await Promise.all(folder.children.map(childId => 
                            this.renderNode(childId, folders, level + 1)
                        )).then(htmls => htmls.join(''))}
                    </div>
                ` : ''}
            </div>
        `;
        
        return html;
    }
    
    attachEventListeners() {
        this.container.querySelectorAll('.folder-node-header').forEach(header => {
            header.addEventListener('click', (e) => {
                if (e.target.classList.contains('folder-action-btn')) return;
                
                const folderId = header.dataset.folderId;
                this.selectedFolderId = folderId;
                this.render();
                
                if (this.onFolderSelect) {
                    this.onFolderSelect(folderId);
                }
            });
        });
        
        this.container.querySelectorAll('.folder-expand.has-children').forEach(expand => {
            expand.addEventListener('click', async (e) => {
                e.stopPropagation();
                const folderId = expand.dataset.folderId;
                this.toggleExpand(folderId);
                await this.render();
            });
        });
        
        this.container.querySelectorAll('.folder-action-btn[data-action="new"]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const parentId = btn.dataset.folderId;
                this.showCreateFolderModal(parentId);
            });
        });
        
        this.container.querySelectorAll('.folder-action-btn[data-action="edit"]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const folderId = btn.dataset.folderId;
                this.showEditFolderModal(folderId);
            });
        });
        
        this.container.querySelectorAll('.folder-action-btn[data-action="delete"]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const folderId = btn.dataset.folderId;
                if (confirm('Удалить папку? Все содержимое будет перемещено в корневую папку.')) {
                    await this.folderManager.deleteFolder(folderId);
                    await this.render();
                    if (this.onFolderSelect && this.selectedFolderId === folderId) {
                        this.onFolderSelect('root');
                    }
                }
            });
        });
    }
    
    showCreateFolderModal(parentId) {
        const modal = document.getElementById('folder-modal');
        const title = document.getElementById('folder-modal-title');
        const createBtn = document.getElementById('create-folder');
        
        title.textContent = 'Новая папка';
        document.getElementById('folder-name').value = '';
        document.getElementById('folder-description').value = '';
        
        modal.hidden = false;
        
        const onSubmit = async () => {
            const name = document.getElementById('folder-name').value.trim();
            if (!name) {
                showWarning('Введите название папки');
                return;
            }
            
            const description = document.getElementById('folder-description').value;
            const color = document.getElementById('folder-color').value;
            const icon = document.getElementById('folder-icon').value;
            
            await this.folderManager.createFolder(name, parentId, {
                description,
                color,
                icon
            });
            
            await this.render();
            modal.hidden = true;
            createBtn.removeEventListener('click', onSubmit);
        };
        
        createBtn.addEventListener('click', onSubmit);
        document.getElementById('cancel-folder').addEventListener('click', () => {
            modal.hidden = true;
            createBtn.removeEventListener('click', onSubmit);
        });
    }
    
    toggleExpand(folderId) {
        if (!this.expandedFolders) this.expandedFolders = new Set(['root']);
        
        if (this.expandedFolders.has(folderId)) {
            this.expandedFolders.delete(folderId);
        } else {
            this.expandedFolders.add(folderId);
        }
    }
}
4. Отображение содержимого папки
javascript
// В popup.js, интеграция с папками

async function loadFolderContents(folderId) {
    const folderManager = new FolderManager(storage);
    const { folder, subFolders, primers } = await folderManager.getFolderContents(folderId);
    
    const container = document.getElementById('favorites-content');
    
    let html = `
        <div class="folder-breadcrumb">
            <span class="breadcrumb-item" data-folder="root">Все праймеры</span>
            ${await buildBreadcrumb(folderId, folderManager)}
        </div>
        
        <div class="folder-info">
            <div class="folder-header">
                <span class="folder-icon-large">${folder.metadata?.icon || '📁'}</span>
                <div class="folder-title-section">
                    <h3>${escapeHtml(folder.name)}</h3>
                    <p class="folder-description">${escapeHtml(folder.metadata?.description || '')}</p>
                </div>
            </div>
            
            <div class="folder-stats-summary">
                <div class="stat">
                    <span class="stat-value">${primers.length}</span>
                    <span class="stat-label">праймеров</span>
                </div>
                <div class="stat">
                    <span class="stat-value">${subFolders.length}</span>
                    <span class="stat-label">подпапок</span>
                </div>
                <div class="stat">
                    <span class="stat-value">${folder.stats?.bestScore || '—'}</span>
                    <span class="stat-label">лучшая оценка</span>
                </div>
            </div>
        </div>
    `;
    
    // Отображаем подпапки
    if (subFolders.length > 0) {
        html += `
            <div class="subfolders-grid">
                <h4>📁 Подпапки</h4>
                <div class="subfolder-cards">
                    ${subFolders.map(sub => `
                        <div class="subfolder-card" data-folder-id="${sub.id}">
                            <div class="subfolder-icon">${sub.metadata?.icon || '📁'}</div>
                            <div class="subfolder-name">${escapeHtml(sub.name)}</div>
                            <div class="subfolder-stats">
                                ${sub.stats?.primerCount || 0} праймеров
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }
    
    // Отображаем праймеры
    if (primers.length > 0) {
        html += `
            <div class="favorites-list">
                <div class="list-header">
                    <span>🧬 Праймеры</span>
                    <div class="list-actions">
                        <button class="btn btn-small btn-outline" id="move-selected-btn">📦 Переместить</button>
                        <button class="btn btn-small btn-outline" id="export-folder-btn">📤 Экспорт папки</button>
                    </div>
                </div>
                ${primers.map(primer => renderEnhancedFavoriteCard(primer, { folder: folder })).join('')}
            </div>
        `;
    } else {
        html += `
            <div class="empty-folder">
                <div class="empty-state">
                    <span class="empty-icon">📭</span>
                    <p>В этой папке пока нет праймеров</p>
                    <button class="btn btn-small btn-primary" id="add-to-folder-btn">➕ Добавить праймер</button>
                </div>
            </div>
        `;
    }
    
    container.innerHTML = html;
    
    // Добавляем обработчики
    container.querySelectorAll('.subfolder-card').forEach(card => {
        card.addEventListener('click', () => {
            loadFolderContents(card.dataset.folderId);
        });
    });
    
    container.querySelectorAll('.breadcrumb-item').forEach(item => {
        item.addEventListener('click', () => {
            loadFolderContents(item.dataset.folder);
        });
    });
}

async function buildBreadcrumb(folderId, folderManager) {
    const folders = await folderManager.getFolderStructure();
    const breadcrumbs = [];
    let currentId = folderId;
    
    while (currentId !== 'root' && folders[currentId]) {
        breadcrumbs.unshift({
            id: currentId,
            name: folders[currentId].name
        });
        currentId = folders[currentId].parentId;
    }
    
    return breadcrumbs.map(crumb => `
        <span class="breadcrumb-sep">›</span>
        <span class="breadcrumb-item" data-folder="${crumb.id}">${escapeHtml(crumb.name)}</span>
    `).join('');
}
5. CSS для структуры папок
css
/* В popup.css добавить */

/* Дерево папок */
.folder-tree {
    background: #f8fafc;
    border-radius: 8px;
    padding: 8px;
    max-height: 400px;
    overflow-y: auto;
}

.folder-node {
    margin: 2px 0;
}

.folder-node-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s;
    border-left: 3px solid transparent;
}

.folder-node-header:hover {
    background: #f1f5f9;
}

.folder-node-header.selected {
    background: #dbeafe;
    border-left-color: #3b82f6;
}

.folder-expand {
    width: 20px;
    font-size: 10px;
    color: #64748b;
    cursor: pointer;
}

.folder-expand.has-children {
    cursor: pointer;
}

.folder-icon {
    font-size: 16px;
}

.folder-name {
    flex: 1;
    font-size: 13px;
    font-weight: 500;
}

.folder-stats {
    font-size: 11px;
    color: #64748b;
}

.folder-actions {
    display: none;
    gap: 4px;
}

.folder-node-header:hover .folder-actions {
    display: flex;
}

.folder-action-btn {
    background: none;
    border: none;
    font-size: 12px;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 4px;
}

.folder-action-btn:hover {
    background: #e2e8f0;
}

/* Подпапки в виде карточек */
.subfolders-grid {
    margin: 20px 0;
}

.subfolder-cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 12px;
    margin-top: 12px;
}

.subfolder-card {
    background: white;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 16px;
    cursor: pointer;
    transition: all 0.2s;
    text-align: center;
}

.subfolder-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    border-color: #3b82f6;
}

.subfolder-icon {
    font-size: 32px;
    margin-bottom: 8px;
}

.subfolder-name {
    font-weight: 600;
    margin-bottom: 4px;
}

.subfolder-stats {
    font-size: 11px;
    color: #64748b;
}

/* Хлебные крошки */
.folder-breadcrumb {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 12px 0;
    font-size: 13px;
    color: #64748b;
    flex-wrap: wrap;
}

.breadcrumb-item {
    cursor: pointer;
    color: #3b82f6;
}

.breadcrumb-item:hover {
    text-decoration: underline;
}

.breadcrumb-sep {
    color: #94a3b8;
}

/* Информация о папке */
.folder-info {
    background: linear-gradient(135deg, #f8fafc, #fff);
    border-radius: 12px;
    padding: 20px;
    margin: 16px 0;
    border: 1px solid #e2e8f0;
}

.folder-header {
    display: flex;
    gap: 16px;
    align-items: center;
}

.folder-icon-large {
    font-size: 48px;
}

.folder-title-section h3 {
    margin: 0 0 8px;
    font-size: 20px;
}

.folder-description {
    margin: 0;
    color: #64748b;
    font-size: 13px;
}

.folder-stats-summary {
    display: flex;
    gap: 24px;
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid #e2e8f0;
}

/* Список праймеров в папке */
.favorites-list .list-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
    padding-bottom: 8px;
    border-bottom: 2px solid #e2e8f0;
}

/* Пустая папка */
.empty-folder {
    text-align: center;
    padding: 40px;
}
🎯 Преимущества для биолога
1. Организация по проектам
text
📁 Проекты
├── 📁 COVID-19 (12 праймеров)
│   ├── 🧬 N-ген (4 праймера)
│   ├── 🧬 S-ген (5 праймеров)
│   └── 📝 Контрольные (3 праймера)
├── 📁 Онкология
│   ├── 🧬 TP53 (8 праймеров)
│   ├── 🧬 BRCA1 (6 праймеров)
│   └── 📁 Экзоны 5-8 (4 праймера)
└── 📁 Домашние гены
    ├── 🧬 ACTB (3 праймера)
    └── 🧬 GAPDH (2 праймера)
2. Быстрый доступ к часто используемым
Избранные папки можно закреплять вверху

Недавно использованные папки подсвечиваются

3. Контекст эксперимента
В папке можно хранить не только праймеры, но и протоколы, ссылки на публикации

Описание папки = методологическая заметка

4. Совместная работа
Папки можно экспортировать для коллег

Общий доступ к папке (при облачной синхронизации)

5. Воспроизводимость
Каждая папка = полный набор для конкретного эксперимента

Можно сохранить настройки ПЦР вместе с праймерами

🚀 Расширенные возможности
1. Шаблоны папок
javascript
const TEMPLATES = {
    qpcr: {
        name: 'qPCR эксперимент',
        structure: [
            'Целевые гены',
            'Референсные гены',
            'Контрольные образцы'
        ],
        defaultSettings: {
            tm: 60,
            productSize: [80, 200]
        }
    },
    sequencing: {
        name: 'Секвенирование',
        structure: [
            'Экзон 1-3',
            'Экзон 4-6',
            'Экзон 7-9'
        ]
    }
};
2. Теги и фильтры
javascript
// Автоматическое тегирование на основе содержимого
function autoTagPrimer(primer) {
    const tags = [];
    if (primer.pair?.totalScore > 90) tags.push('проверенный');
    if (primer.pair?.forward?.details?.gc?.value > 55) tags.push('GC-богатый');
    if (primer.notes) tags.push('с заметками');
    return tags;
}
3. Экспорт папки в PDF
javascript
async function exportFolderToPDF(folderId) {
    const folderManager = new FolderManager(storage);
    const { folder, primers } = await folderManager.getFolderContents(folderId);
    
    // Создаем PDF с:
    // - Описанием проекта
    // - Списком всех праймеров с характеристиками
    // - Рекомендациями по использованию
    // - Ссылками на протоколы
}
4. Умный поиск по папкам
javascript
async function searchInFolders(query) {
    const folders = await folderManager.getFolderStructure();
    const favorites = await storage.get('savedPrimers') || [];
    
    const results = {
        folders: [],
        primers: []
    };
    
    // Поиск в названиях папок
    for (const [id, folder] of Object.entries(folders)) {
        if (folder.name.toLowerCase().includes(query)) {
            results.folders.push(folder);
        }
    }
    
    // Поиск в праймерах
    for (const fav of favorites) {
        if (fav.name.toLowerCase().includes(query) ||
            fav.pair?.forward?.sequence.includes(query)) {
            results.primers.push(fav);
        }
    }
    
    return results;
}
📊 Сравнение: Без папок vs С папками
Характеристика	Без папок	С папками
Количество праймеров	50+ в одном списке	Организовано по проектам
Поиск нужного	Поиск по названию	Навигация по иерархии
Контекст	Потерян	Сохранен в структуре папок
Совместная работа	Затруднена	Экспорт папок, общий доступ
Воспроизводимость	Низкая	Высокая (папка = эксперимент)
Организация	Хаотичная	Иерархическая, интуитивная
🏁 Итог
Создание поддиректорий в избранном превращает расширение из простого хранилища праймеров в лабораторную информационную систему (LIMS) для дизайна праймеров.

Ключевые преимущества:

🧬 Структурированность - праймеры организованы по проектам и целям

📚 Контекст - каждая папка содержит описание эксперимента

🔄 Воспроизводимость - можно полностью восстановить экспериментальный протокол

🤝 Совместная работа - легкий обмен папками между коллегами

⏱️ Экономия времени - быстрый доступ к часто используемым наборам

// TODO
Не переносилось из дока (можно позже)
Отдельная большая область с хлебными крошками и карточками подпапок как в loadFolderContents.
Шаблоны папок, теги, PDF по папке, умный поиск только по папкам (частично перекрывается текущим поиском в папке).