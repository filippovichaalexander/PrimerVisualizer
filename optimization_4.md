нужно сделать - 
Интегрировать BLAST (даже упрощенный вариант через NCBI API)

Добавить экспорт в PDF/Excel (для протоколов)

Сделать облачную синхронизацию (чтобы праймеры были на всех устройствах)

Добавить шаблоны для популярных генов (TP53, BRCA1, ACTB и т.д.)


Используй рекоммендации - 
Интеграция BLAST (проверка специфичности)

Прямая интеграция с NCBI API (проще)
1.1 Добавляем кнопку в интерфейс
html
<!-- В popup.html, добавить в карточку праймера -->
<div class="card-actions">
    <button class="action-btn blast-btn" data-pair='${JSON.stringify(pair)}'>
        🧬 Проверить BLAST
    </button>
    <!-- остальные кнопки -->
</div>
1.2 Создаем BLAST-сервис в расширении
javascript
// lib/blast-service.js
export class BlastService {
    constructor() {
        this.baseUrl = 'https://blast.ncbi.nlm.nih.gov/Blast.cgi';
        this.pollInterval = 2000; // 2 секунды
        this.maxAttempts = 30; // 1 минута максимум
    }

    /**
     * Запустить BLAST поиск для праймера
     */
    async checkPrimerSpecificity(primerSequence, options = {}) {
        const organism = options.organism || 'human';
        const database = this.getDatabaseForOrganism(organism);
        
        // 1. Отправляем задание в NCBI BLAST
        const requestId = await this.submitBlastJob({
            sequence: primerSequence,
            database: database,
            program: 'blastn-short', // Для коротких последовательностей
            expect: 1000, // E-value threshold
            wordSize: 7,
            megablast: false,
            filter: false
        });

        // 2. Показываем прогресс пользователю
        this.showBlastProgress(requestId);

        // 3. Ждем результат
        const results = await this.pollBlastResults(requestId);

        // 4. Анализируем совпадения
        return this.analyzeBlastResults(results);
    }

    /**
     * Отправить задание в NCBI BLAST
     */
    async submitBlastJob(params) {
        const formData = new FormData();
        formData.append('QUERY', params.sequence);
        formData.append('DATABASE', params.database);
        formData.append('PROGRAM', params.program);
        formData.append('EXPECT', params.expect);
        formData.append('WORD_SIZE', params.wordSize);
        formData.append('MEGABLAST', params.megablast);
        formData.append('FILTER', params.filter);
        formData.append('CMD', 'Put'); // Создать задание

        try {
            const response = await fetch(this.baseUrl, {
                method: 'POST',
                body: formData
            });

            const text = await response.text();
            // NCBI возвращает HTML с RID (Request ID)
            const ridMatch = text.match(/RID = ([A-Z0-9]+)/);
            if (!ridMatch) {
                throw new Error('Could not get RID from NCBI');
            }

            return ridMatch[1];
        } catch (error) {
            console.error('BLAST submission error:', error);
            throw error;
        }
    }

    /**
     * Получить результаты BLAST
     */
    async pollBlastResults(rid) {
        let attempts = 0;
        
        while (attempts < this.maxAttempts) {
            const params = new URLSearchParams({
                RID: rid,
                FORMAT_TYPE: 'JSON2',
                CMD: 'Get'
            });

            try {
                const response = await fetch(`${this.baseUrl}?${params}`);
                const data = await response.json();

                if (data.BlastOutput2?.report?.results?.search?.hits) {
                    // Результаты готовы
                    return data.BlastOutput2.report;
                }

                if (data.BlastOutput2?.report?.results?.search?.message?.includes('Pending')) {
                    // Еще не готово
                    await this.sleep(this.pollInterval);
                    attempts++;
                    continue;
                }

                // Ошибка или неизвестный статус
                break;
            } catch (error) {
                console.error('BLAST polling error:', error);
                attempts++;
                await this.sleep(this.pollInterval);
            }
        }

        throw new Error('BLAST search timeout');
    }

    /**
     * Анализ результатов BLAST
     */
    analyzeBlastResults(blastReport) {
        const hits = blastReport.results.search.hits || [];
        
        // Отфильтровываем идеальные совпадения (сам праймер)
        const nonSelfHits = hits.filter(hit => {
            // TODO: определить, является ли совпадение самим праймером
            // по координатам или по описанию
            return !hit.description[0]?.title?.includes('PREDICTED');
        });

        // Группируем по уровню опасности
        const analysis = {
            totalHits: hits.length,
            offTargetHits: nonSelfHits.length,
            highRisk: [],
            mediumRisk: [],
            lowRisk: []
        };

        for (const hit of nonSelfHits.slice(0, 10)) { // Топ-10 совпадений
            const identity = this.calculateIdentity(hit);
            
            if (identity > 95) {
                analysis.highRisk.push({
                    description: hit.description[0]?.title,
                    identity: identity,
                    length: hit.len,
                    accession: hit.description[0]?.accession
                });
            } else if (identity > 80) {
                analysis.mediumRisk.push({
                    description: hit.description[0]?.title,
                    identity: identity,
                    length: hit.len
                });
            } else {
                analysis.lowRisk.push({
                    description: hit.description[0]?.title,
                    identity: identity
                });
            }
        }

        return analysis;
    }

    calculateIdentity(hit) {
        // Берем лучшее выравнивание
        const hsp = hit.hsps?.[0];
        if (!hsp) return 0;
        
        return (hsp.identity / hsp.align_len) * 100;
    }

    getDatabaseForOrganism(organism) {
        const databases = {
            human: 'refseq_genomic',
            mouse: 'refseq_genomic',
            rat: 'refseq_genomic',
            zebrafish: 'refseq_genomic',
            arabidopsis: 'refseq_genomic',
            ecori: 'refseq_genomic'
        };
        return databases[organism] || 'nt';
    }

    showBlastProgress(rid) {
        // Создаем уведомление о прогрессе
        const notification = document.createElement('div');
        notification.className = 'blast-progress';
        notification.id = `blast-${rid}`;
        notification.innerHTML = `
            <div class="blast-progress-content">
                <span class="spinner"></span>
                <span>BLAST проверка...</span>
                <small>ID: ${rid}</small>
            </div>
        `;
        document.body.appendChild(notification);
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
1.3 Добавляем отображение результатов BLAST
javascript
// В popup.js добавить функцию
async function showBlastResults(pair) {
    const blastService = new BlastService();
    
    try {
        // Проверяем оба праймера
        const fwdResults = await blastService.checkPrimerSpecificity(
            pair.forward.sequence,
            { organism: advancedSettings.specificityOrganism }
        );
        
        const revResults = await blastService.checkPrimerSpecificity(
            pair.reverse.sequence,
            { organism: advancedSettings.specificityOrganism }
        );

        // Показываем результаты в модальном окне
        showBlastResultsModal(pair, fwdResults, revResults);
    } catch (error) {
        showNotification('❌ Ошибка BLAST: ' + error.message);
    }
}

function showBlastResultsModal(pair, fwdResults, revResults) {
    const modal = document.createElement('div');
    modal.className = 'blast-modal';
    modal.innerHTML = `
        <div class="blast-modal-content">
            <h3>🧬 Результаты BLAST проверки</h3>
            
            <div class="blast-primer-results">
                <div class="blast-primer">
                    <h4>Forward: ${formatSequence(pair.forward.sequence)}</h4>
                    ${renderBlastAnalysis(fwdResults)}
                </div>
                
                <div class="blast-primer">
                    <h4>Reverse: ${formatSequence(pair.reverse.sequence)}</h4>
                    ${renderBlastAnalysis(revResults)}
                </div>
            </div>
            
            <div class="blast-actions">
                <button class="btn btn-primary" onclick="window.open('https://blast.ncbi.nlm.nih.gov/Blast.cgi?PAGE_TYPE=BlastSearch')">
                    🔬 Открыть NCBI BLAST
                </button>
                <button class="btn btn-outline" onclick="this.closest('.blast-modal').remove()">
                    Закрыть
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

function renderBlastAnalysis(results) {
    if (!results) return '<p>Нет данных</p>';
    
    let html = `
        <div class="blast-summary">
            <span class="blast-badge ${results.offTargetHits === 0 ? 'good' : 'warn'}">
                ${results.offTargetHits} нецелевых совпадений
            </span>
        </div>
    `;
    
    if (results.highRisk.length > 0) {
        html += '<div class="blast-risk high"><h5>🔴 Высокий риск</h5>';
        results.highRisk.forEach(hit => {
            html += `<div>${hit.description} (${hit.identity.toFixed(1)}% идентичность)</div>`;
        });
        html += '</div>';
    }
    
    if (results.mediumRisk.length > 0) {
        html += '<div class="blast-risk medium"><h5>🟡 Средний риск</h5>';
        results.mediumRisk.forEach(hit => {
            html += `<div>${hit.description} (${hit.identity.toFixed(1)}% идентичность)</div>`;
        });
        html += '</div>';
    }
    
    return html;
}
1.4 Добавляем стили для BLAST
css
/* В popup.css */
.blast-progress {
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: white;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 12px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 10000;
}

.blast-modal {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10001;
}

.blast-modal-content {
    background: white;
    border-radius: 12px;
    padding: 24px;
    max-width: 800px;
    max-height: 80vh;
    overflow-y: auto;
}

.blast-badge.good {
    background: #22c55e;
    color: white;
}

.blast-badge.warn {
    background: #f59e0b;
    color: white;
}

.blast-risk {
    margin: 12px 0;
    padding: 12px;
    border-radius: 8px;
}

.blast-risk.high {
    background: #fee2e2;
    border-left: 4px solid #ef4444;
}

.blast-risk.medium {
    background: #fef3c7;
    border-left: 4px solid #f59e0b;
}
2. 📄 Экспорт в PDF/Excel
2.1 Создаем сервис экспорта
javascript
// lib/export-service.js
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import * as XLSX from 'xlsx';

export class ExportService {
    /**
     * Экспорт в PDF
     */
    exportToPDF(primers, options = {}) {
        const doc = new jsPDF();
        let yPos = 20;

        // Заголовок
        doc.setFontSize(16);
        doc.text('PrimerDesigner Pro - Результаты', 20, yPos);
        yPos += 10;

        doc.setFontSize(10);
        doc.text(`Дата: ${new Date().toLocaleDateString()}`, 20, yPos);
        yPos += 10;
        doc.text(`Всего пар: ${primers.length}`, 20, yPos);
        yPos += 15;

        // Таблица с праймерами
        const tableData = primers.map((p, idx) => [
            idx + 1,
            p.forward.sequence,
            p.reverse.sequence,
            p.forward.details.tm.value.toFixed(1) + '°C',
            p.reverse.details.tm.value.toFixed(1) + '°C',
            p.forward.details.gc.value.toFixed(1) + '%',
            p.reverse.details.gc.value.toFixed(1) + '%',
            p.totalScore || '—',
            p.grade?.letter || '—'
        ]);

        doc.autoTable({
            head: [['#', 'Forward', 'Reverse', 'Tm F', 'Tm R', 'GC F', 'GC R', 'Score', 'Grade']],
            body: tableData,
            startY: yPos,
            styles: { fontSize: 8 },
            columnStyles: {
                1: { cellWidth: 30 },
                2: { cellWidth: 30 }
            }
        });

        // Сохраняем
        doc.save(`primers-${Date.now()}.pdf`);
    }

    /**
     * Экспорт в Excel
     */
    exportToExcel(primers, options = {}) {
        // Подготовка данных
        const data = primers.map((p, idx) => ({
            '№': idx + 1,
            'Forward Sequence': p.forward.sequence,
            'Forward Start': p.forward.start,
            'Forward End': p.forward.end,
            'Forward Tm': p.forward.details.tm.value.toFixed(1),
            'Forward GC%': p.forward.details.gc.value.toFixed(1),
            'Reverse Sequence': p.reverse.sequence,
            'Reverse Start': p.reverse.start,
            'Reverse End': p.reverse.end,
            'Reverse Tm': p.reverse.details.tm.value.toFixed(1),
            'Reverse GC%': p.reverse.details.gc.value.toFixed(1),
            'Product Size': p.reverse.end - p.forward.start,
            'Score': p.totalScore || '',
            'Grade': p.grade?.letter || '',
            'Warnings': (p.warnings || []).join('; ')
        }));

        // Создаем рабочий лист
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(data);

        // Добавляем метаданные
        ws['!cols'] = [
            { wch: 5 },   // №
            { wch: 25 },  // Forward Sequence
            { wch: 10 },  // Forward Start
            { wch: 10 },  // Forward End
            { wch: 10 },  // Forward Tm
            { wch: 10 },  // Forward GC%
            { wch: 25 },  // Reverse Sequence
            { wch: 10 },  // Reverse Start
            { wch: 10 },  // Reverse End
            { wch: 10 },  // Reverse Tm
            { wch: 10 },  // Reverse GC%
            { wch: 12 },  // Product Size
            { wch: 8 },   // Score
            { wch: 6 },   // Grade
            { wch: 30 }   // Warnings
        ];

        XLSX.utils.book_append_sheet(wb, ws, 'Primers');
        
        // Сохраняем
        XLSX.writeFile(wb, `primers-${Date.now()}.xlsx`);
    }

    /**
     * Экспорт в CSV (для совместимости)
     */
    exportToCSV(primers) {
        const headers = [
            'ID', 'Forward', 'Forward_Start', 'Forward_End', 'Forward_Tm', 'Forward_GC',
            'Reverse', 'Reverse_Start', 'Reverse_End', 'Reverse_Tm', 'Reverse_GC',
            'Product_Size', 'Score', 'Grade', 'Warnings'
        ];

        const rows = primers.map((p, idx) => [
            idx + 1,
            p.forward.sequence,
            p.forward.start,
            p.forward.end,
            p.forward.details.tm.value.toFixed(1),
            p.forward.details.gc.value.toFixed(1),
            p.reverse.sequence,
            p.reverse.start,
            p.reverse.end,
            p.reverse.details.tm.value.toFixed(1),
            p.reverse.details.gc.value.toFixed(1),
            p.reverse.end - p.forward.start,
            p.totalScore || '',
            p.grade?.letter || '',
            (p.warnings || []).join('; ')
        ]);

        const csv = [
            headers.join(','),
            ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
        ].join('\n');

        // Скачиваем
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `primers-${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    /**
     * Экспорт в HTML (для печати)
     */
    exportToHTML(primers) {
        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>PrimerDesigner Pro - Results</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 40px; }
                    h1 { color: #333; }
                    table { border-collapse: collapse; width: 100%; }
                    th { background: #667eea; color: white; padding: 10px; }
                    td { padding: 8px; border: 1px solid #ddd; }
                    .forward { background: #e6f7ff; }
                    .reverse { background: #fff0e6; }
                    .grade { font-weight: bold; }
                </style>
            </head>
            <body>
                <h1>PrimerDesigner Pro - Результаты</h1>
                <p>Дата: ${new Date().toLocaleString()}</p>
                <p>Всего пар: ${primers.length}</p>
                
                ${primers.map((p, idx) => `
                    <h3>Пара #${idx + 1} (Оценка: ${p.totalScore || '—'}, ${p.grade?.letter || '—'})</h3>
                    <table>
                        <tr>
                            <th>Праймер</th>
                            <th>Последовательность (5'→3')</th>
                            <th>Позиция</th>
                            <th>Tm (°C)</th>
                            <th>GC%</th>
                        </tr>
                        <tr class="forward">
                            <td>Forward</td>
                            <td><code>${p.forward.sequence}</code></td>
                            <td>${p.forward.start}-${p.forward.end}</td>
                            <td>${p.forward.details.tm.value.toFixed(1)}</td>
                            <td>${p.forward.details.gc.value.toFixed(1)}</td>
                        </tr>
                        <tr class="reverse">
                            <td>Reverse</td>
                            <td><code>${p.reverse.sequence}</code></td>
                            <td>${p.reverse.start}-${p.reverse.end}</td>
                            <td>${p.reverse.details.tm.value.toFixed(1)}</td>
                            <td>${p.reverse.details.gc.value.toFixed(1)}</td>
                        </tr>
                    </table>
                    ${p.warnings?.length ? `<p><strong>Предупреждения:</strong> ${p.warnings.join(', ')}</p>` : ''}
                    <hr>
                `).join('')}
            </body>
            </html>
        `;

        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `primers-${Date.now()}.html`;
        a.click();
        URL.revokeObjectURL(url);
    }
}
2.2 Добавляем кнопки экспорта в интерфейс
html
<!-- В popup.html, добавить панель экспорта -->
<div class="export-panel">
    <button class="btn btn-outline export-btn" data-format="pdf">
        📄 PDF
    </button>
    <button class="btn btn-outline export-btn" data-format="excel">
        📊 Excel
    </button>
    <button class="btn btn-outline export-btn" data-format="csv">
        📈 CSV
    </button>
    <button class="btn btn-outline export-btn" data-format="html">
        🖨️ HTML
    </button>
</div>
2.3 Добавляем обработчики
javascript
// В popup.js
function setupExportButtons() {
    document.querySelectorAll('.export-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            if (!currentResults || currentResults.length === 0) {
                showNotification('❌ Нет результатов для экспорта');
                return;
            }

            const format = e.currentTarget.dataset.format;
            const exportService = new ExportService();

            try {
                switch (format) {
                    case 'pdf':
                        exportService.exportToPDF(currentResults);
                        break;
                    case 'excel':
                        exportService.exportToExcel(currentResults);
                        break;
                    case 'csv':
                        exportService.exportToCSV(currentResults);
                        break;
                    case 'html':
                        exportService.exportToHTML(currentResults);
                        break;
                }
                showNotification(`✅ Экспортировано в ${format.toUpperCase()}`);
            } catch (error) {
                showNotification(`❌ Ошибка экспорта: ${error.message}`);
            }
        });
    });
}
2.4 Устанавливаем зависимости
json
// package.json (для расширения)
{
  "dependencies": {
    "jspdf": "^2.5.1",
    "jspdf-autotable": "^3.8.2",
    "xlsx": "^0.18.5"
  }
}
3. ☁️ Облачная синхронизация
3.1 Создаем облачный сервис на Django
python
# backend/cloudsync/models.py
from django.db import models
from django.contrib.auth.models import User
import json

class UserProfile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    sync_enabled = models.BooleanField(default=True)
    last_sync = models.DateTimeField(null=True, blank=True)
    device_id = models.CharField(max_length=100, unique=True)
    
class SyncData(models.Model):
    DATA_TYPES = [
        ('primers', 'Сохраненные праймеры'),
        ('history', 'История'),
        ('settings', 'Настройки'),
        ('feedback', 'Фидбек'),
    ]
    
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    data_type = models.CharField(max_length=20, choices=DATA_TYPES)
    data = models.JSONField()
    version = models.IntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        indexes = [
            models.Index(fields=['user', 'data_type', '-updated_at']),
        ]

class SyncLog(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    sync_type = models.CharField(max_length=20)  # push/pull
    status = models.CharField(max_length=20)     # success/failed
    details = models.JSONField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)
python
# backend/cloudsync/views.py
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.utils import timezone
from .models import SyncData, SyncLog, UserProfile
import hashlib
import json

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def sync_push(request):
    """Отправить локальные данные на сервер"""
    try:
        data = request.data
        user = request.user
        
        results = []
        for item in data.get('items', []):
            data_type = item.get('type')
            local_data = item.get('data')
            local_hash = hashlib.md5(
                json.dumps(local_data, sort_keys=True).encode()
            ).hexdigest()
            
            # Проверяем, есть ли уже такие данные
            existing = SyncData.objects.filter(
                user=user,
                data_type=data_type
            ).order_by('-updated_at').first()
            
            if existing:
                existing_hash = hashlib.md5(
                    json.dumps(existing.data, sort_keys=True).encode()
                ).hexdigest()
                
                if existing_hash != local_hash:
                    # Конфликт - нужно мержить
                    merged = merge_data(existing.data, local_data)
                    existing.data = merged
                    existing.updated_at = timezone.now()
                    existing.save()
                    results.append({
                        'type': data_type,
                        'status': 'merged',
                        'version': existing.version
                    })
                else:
                    results.append({
                        'type': data_type,
                        'status': 'unchanged',
                        'version': existing.version
                    })
            else:
                # Новые данные
                sync_item = SyncData.objects.create(
                    user=user,
                    data_type=data_type,
                    data=local_data
                )
                results.append({
                    'type': data_type,
                    'status': 'created',
                    'version': sync_item.version
                })
        
        # Обновляем профиль
        profile, _ = UserProfile.objects.get_or_create(user=user)
        profile.last_sync = timezone.now()
        profile.save()
        
        # Логируем
        SyncLog.objects.create(
            user=user,
            sync_type='push',
            status='success',
            details={'items': len(data.get('items', []))}
        )
        
        return Response({
            'status': 'success',
            'results': results,
            'timestamp': timezone.now().isoformat()
        })
        
    except Exception as e:
        SyncLog.objects.create(
            user=request.user,
            sync_type='push',
            status='failed',
            details={'error': str(e)}
        )
        return Response(
            {'error': str(e)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def sync_pull(request):
    """Получить данные с сервера"""
    try:
        user = request.user
        since = request.GET.get('since')
        
        queryset = SyncData.objects.filter(user=user)
        if since:
            queryset = queryset.filter(updated_at__gt=since)
        
        data = {}
        for item in queryset:
            if item.data_type not in data:
                data[item.data_type] = {
                    'data': item.data,
                    'version': item.version,
                    'updated_at': item.updated_at.isoformat()
                }
        
        SyncLog.objects.create(
            user=user,
            sync_type='pull',
            status='success',
            details={'types': list(data.keys())}
        )
        
        return Response({
            'status': 'success',
            'data': data,
            'timestamp': timezone.now().isoformat()
        })
        
    except Exception as e:
        return Response(
            {'error': str(e)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )

def merge_data(server_data, local_data):
    """Умное слияние данных при конфликте"""
    if isinstance(server_data, list) and isinstance(local_data, list):
        # Для списков - объединяем по ID
        merged = {item.get('id'): item for item in server_data}
        for item in local_data:
            if item.get('id') not in merged:
                merged[item.get('id')] = item
            else:
                # Если есть конфликт, берем новейший по timestamp
                if item.get('timestamp', 0) > merged[item.get('id')].get('timestamp', 0):
                    merged[item.get('id')] = item
        return list(merged.values())
    
    elif isinstance(server_data, dict) and isinstance(local_data, dict):
        # Для словарей - рекурсивно мержим
        merged = server_data.copy()
        for key, value in local_data.items():
            if key not in merged:
                merged[key] = value
            elif isinstance(value, dict) and isinstance(merged[key], dict):
                merged[key] = merge_data(merged[key], value)
        return merged
    
    else:
        # По умолчанию берем серверные данные
        return server_data
python
# backend/cloudsync/urls.py
from django.urls import path
from . import views

urlpatterns = [
    path('sync/push/', views.sync_push, name='sync-push'),
    path('sync/pull/', views.sync_pull, name='sync-pull'),
]
3.2 Добавляем синхронизацию в расширение
javascript
// lib/cloud-sync.js
export class CloudSyncManager {
    constructor(apiBaseUrl, storage) {
        this.apiUrl = `${apiBaseUrl}/cloudsync`;
        this.storage = storage;
        this.syncInProgress = false;
        this.retryDelay = 5000; // 5 секунд
    }

    /**
     * Полная синхронизация
     */
    async syncAll() {
        if (this.syncInProgress) {
            console.log('Sync already in progress');
            return;
        }

        this.syncInProgress = true;
        
        try {
            // Получаем токен (нужна аутентификация)
            const token = await this.getAuthToken();
            if (!token) {
                await this.authenticate();
            }

            // 1. Сначала пушим локальные изменения
            await this.pushLocalChanges();
            
            // 2. Затем тянем изменения с сервера
            await this.pullRemoteChanges();
            
            // 3. Обновляем статистику
            await this.updateSyncStats();
            
            this.showSyncNotification('✅ Синхронизация завершена');
            
        } catch (error) {
            console.error('Sync failed:', error);
            this.showSyncNotification('❌ Ошибка синхронизации', true);
            
            // Планируем повторную попытку
            setTimeout(() => this.syncAll(), this.retryDelay);
            
        } finally {
            this.syncInProgress = false;
        }
    }

    /**
     * Отправить локальные изменения
     */
    async pushLocalChanges() {
        const lastSync = await this.storage.get('lastSyncTime');
        
        // Собираем данные для синхронизации
        const items = [];
        
        // Сохраненные праймеры
        const savedPrimers = await this.storage.get('savedPrimers') || [];
        items.push({
            type: 'primers',
            data: savedPrimers,
            lastModified: lastSync
        });
        
        // История
        const history = await this.storage.get('history') || [];
        items.push({
            type: 'history',
            data: history,
            lastModified: lastSync
        });
        
        // Настройки
        const settings = await this.storage.get('settings') || {};
        items.push({
            type: 'settings',
            data: settings,
            lastModified: lastSync
        });

        const response = await fetch(`${this.apiUrl}/sync/push/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${await this.getAuthToken()}`
            },
            body: JSON.stringify({ items })
        });

        if (!response.ok) {
            throw new Error(`Push failed: ${response.status}`);
        }

        return await response.json();
    }

    /**
     * Получить изменения с сервера
     */
    async pullRemoteChanges() {
        const lastSync = await this.storage.get('lastSyncTime');
        
        const response = await fetch(
            `${this.apiUrl}/sync/pull/?since=${lastSync || ''}`,
            {
                headers: {
                    'Authorization': `Bearer ${await this.getAuthToken()}`
                }
            }
        );

        if (!response.ok) {
            throw new Error(`Pull failed: ${response.status}`);
        }

        const data = await response.json();
        
        // Применяем изменения
        for (const [type, item] of Object.entries(data.data)) {
            const localData = await this.storage.get(type) || [];
            const merged = this.mergeData(localData, item.data);
            await this.storage.set(type, merged);
        }

        // Обновляем время последней синхронизации
        await this.storage.set('lastSyncTime', data.timestamp);
    }

    /**
     * Аутентификация пользователя
     */
    async authenticate() {
        return new Promise((resolve, reject) => {
            // Создаем модальное окно для входа
            const authModal = document.createElement('div');
            authModal.className = 'auth-modal';
            authModal.innerHTML = `
                <div class="auth-modal-content">
                    <h3>🔐 Вход в облако</h3>
                    <p>Синхронизируйте данные между устройствами</p>
                    
                    <form id="authForm">
                        <div class="form-group">
                            <label>Email</label>
                            <input type="email" id="email" required>
                        </div>
                        
                        <div class="form-group">
                            <label>Пароль</label>
                            <input type="password" id="password" required>
                        </div>
                        
                        <div class="auth-actions">
                            <button type="submit" class="btn btn-primary">Войти</button>
                            <button type="button" class="btn btn-outline" id="registerBtn">
                                Регистрация
                            </button>
                        </div>
                    </form>
                    
                    <div class="auth-or">или</div>
                    
                    <button class="btn btn-google" id="googleAuth">
                        <img src="icons/google.svg" alt="Google">
                        Войти через Google
                    </button>
                </div>
            `;

            document.body.appendChild(authModal);

            // Обработчик формы
            authModal.querySelector('#authForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                
                const email = authModal.querySelector('#email').value;
                const password = authModal.querySelector('#password').value;
                
                try {
                    const response = await fetch(`${this.apiUrl}/auth/login/`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email, password })
                    });
                    
                    const data = await response.json();
                    if (response.ok) {
                        await this.storage.set('authToken', data.token);
                        await this.storage.set('user', data.user);
                        authModal.remove();
                        resolve(data.token);
                    } else {
                        alert('Ошибка входа: ' + data.error);
                    }
                } catch (error) {
                    reject(error);
                }
            });

            // Google OAuth
            authModal.querySelector('#googleAuth').addEventListener('click', () => {
                const width = 500;
                const height = 600;
                const left = (screen.width / 2) - (width / 2);
                const top = (screen.height / 2) - (height / 2);
                
                const authWindow = window.open(
                    `${this.apiUrl}/auth/google/`,
                    'Google Auth',
                    `width=${width},height=${height},top=${top},left=${left}`
                );

                window.addEventListener('message', async (event) => {
                    if (event.data.type === 'google-auth-success') {
                        authWindow.close();
                        await this.storage.set('authToken', event.data.token);
                        await this.storage.set('user', event.data.user);
                        authModal.remove();
                        resolve(event.data.token);
                    }
                });
            });
        });
    }

    mergeData(local, remote) {
        // Умное слияние данных
        if (Array.isArray(local) && Array.isArray(remote)) {
            const merged = new Map();
            
            // Добавляем локальные
            local.forEach(item => {
                merged.set(item.id || JSON.stringify(item), {
                    data: item,
                    source: 'local'
                });
            });
            
            // Добавляем/обновляем из удаленных
            remote.forEach(item => {
                const key = item.id || JSON.stringify(item);
                if (!merged.has(key)) {
                    merged.set(key, { data: item, source: 'remote' });
                } else {
                    // Если есть конфликт, берем новейший
                    const local = merged.get(key);
                    if (item.timestamp > local.data.timestamp) {
                        merged.set(key, { data: item, source: 'remote' });
                    }
                }
            });
            
            return Array.from(merged.values()).map(m => m.data);
        }
        
        return remote; // По умолчанию берем удаленные
    }

    showSyncNotification(message, isError = false) {
        const notification = document.createElement('div');
        notification.className = `sync-notification ${isError ? 'error' : 'success'}`;
        notification.textContent = message;
        document.body.appendChild(notification);
        
        setTimeout(() => notification.remove(), 3000);
    }

    async getAuthToken() {
        return await this.storage.get('authToken');
    }

    async updateSyncStats() {
        const stats = await this.storage.get('stats') || {};
        stats.syncsCompleted = (stats.syncsCompleted || 0) + 1;
        stats.lastSync = new Date().toISOString();
        await this.storage.set('stats', stats);
    }
}
3.3 Добавляем UI для синхронизации
html
<!-- В popup.html, добавить в настройки -->
<div class="sync-panel">
    <h4>☁️ Облачная синхронизация</h4>
    
    <div class="sync-status" id="syncStatus">
        <span class="sync-indicator" id="syncIndicator"></span>
        <span id="syncText">Не синхронизировано</span>
    </div>
    
    <div class="sync-actions">
        <button class="btn btn-primary" id="syncNowBtn">
            🔄 Синхронизировать сейчас
        </button>
        
        <label class="checkbox">
            <input type="checkbox" id="autoSync">
            <span>Автосинхронизация (каждые 30 мин)</span>
        </label>
    </div>
    
    <div class="sync-info" id="syncInfo" style="display: none;">
        <p>Последняя синхронизация: <span id="lastSyncTime"></span></p>
        <p>Устройств: <span id="deviceCount">1</span></p>
    </div>
</div>
4. 🧬 Шаблоны для популярных генов
4.1 Создаем базу шаблонов
javascript
// lib/gene-templates.js
export const GENE_TEMPLATES = {
    // Гены человека
    human: {
        tp53: {
            name: 'TP53 (опухолевый супрессор p53)',
            accession: 'NM_000546.6',
            description: 'Тumor protein p53, критический ген в онкологии',
            sequence: `ATGGAGGAGCCGCAGTCAGATCCTAGCGTCGAGCCCCCTCTGAGTCAGGAAACATTTTCAGACCTATGGAAACTACTTCCTGAAAACAACGTTCTGTCCCCCTTGCCGTCCCAAGCAATGGATGATTTGATGCTGTCCCCGGACGATATTGAACAATGGTTCACTGAAGACCCAGGTCCAGATGAAGCTCCCAGAATGCCAGAGGCTGCTCCCCGCGTGGCCCCTGCACCAGCAGCTCCTACACCGGCGGCCCCTGCACCAGCCCCCTCCTGGCCCCTGTCATCTTCTGTCCCTTCCCAGAAAACCTACCAGGGCAGCTACGGTTTCCGTCTGGGCTTCTTGCATTCTGGGACAGCCAAGTCTGTGACTTGCACGTACTCCCCTGCCCTCAACAAGATGTTTTGCCAACTGGCCAAGACCTGCCCTGTGCAGCTGTGGGTTGATTCCACACCCCCGCCCGGCACCCGCGTCCGCGCCATGGCCATCTACAAGCAGTCACAGCACATGACGGAGGTTGTGAGGCGCTGCCCCCACCATGAGCGCTGCTCAGATAGCGATGGTCTGGCCCCTCCTCAGCATCTTATCCGAGTGGAAGGAAATTTGCGTGTGGAGTATTTGGATGACAGAAACACTTTTCGACATAGTGTGGTGGTGCCCTATGAGCCGCCTGAGGTTGGCTCTGACTGTACCACCATCCACTACAACTACATGTGTAACAGTTCCTGCATGGGCGGCATGAACCGGAGGCCCATCCTCACCATCATCACACTGGAAGACTCCAGTGGTAATCTACTGGGACGGAACAGCTTTGAGGTGCGTGTTTGTGCCTGTCCTGGGAGAGACCGGCGCACAGAGGAAGAGAATCTCCGCAAGAAAGGGGAGCCTCACCACGAGCTGCCCCCAGGGAGCACTAAGCGAGCACTGCCCAACAACACCAGCTCCTCTCCCCAGCCAAAGAAGAAACCACTGGATGGAGAATATTTCACCCTTCAGATCCGTGGGCGTGAGCGCTTCGAGATGTTCCGAGAGCTGAATGAGGCCTTGGAACTCAAGGATGCCCAGGCTGGGAAGGAGCCAGGGGGGAGCAGGGCTCACTCCAGCCACCTGAAGTCCAAAAAGGGTCAGTCTACCTCCCGCCATAAAAAACTCATGTTCAAGACAGAAGGGCCTGACTCAGACTGA`,
            exons: [
                { start: 0, end: 200, name: 'Экзон 1' },
                { start: 201, end: 400, name: 'Экзон 2' },
                { start: 401, end: 600, name: 'Экзон 3' },
                { start: 601, end: 800, name: 'Экзон 4' },
                { start: 801, end: 1000, name: 'Экзон 5' },
                { start: 1001, end: 1200, name: 'Экзон 6' },
                { start: 1201, end: 1400, name: 'Экзон 7' },
                { start: 1401, end: 1600, name: 'Экзон 8' },
                { start: 1601, end: 1800, name: 'Экзон 9' },
                { start: 1801, end: 2000, name: 'Экзон 10' },
                { start: 2001, end: 2200, name: 'Экзон 11' }
            ],
            recommendedPrimers: [
                {
                    name: 'TP53 Exon 5-6',
                    forward: 'TACTCCCCTGCCCTCAACAAG',
                    reverse: 'CATCGCTATCTGAGCAGCGC',
                    productSize: 245,
                    use: 'Скрининг мутаций в экзонах 5-6'
                },
                {
                    name: 'TP53 Exon 7-8',
                    forward: 'CTTGCCACAGGTCTCCCCAA',
                    reverse: 'AGGGGTCAGAGGCAAGCAGA',
                    productSize: 312,
                    use: 'Скрининг мутаций в экзонах 7-8'
                }
            ]
        },
        
        brca1: {
            name: 'BRCA1 (рак молочной железы 1)',
            accession: 'NM_007294.4',
            description: 'Breast Cancer 1, ген предрасположенности к раку',
            sequence: `GGATCCATGGATTTATCTGCTCTTCGCGTTGAAGAAGTACAAAATGTCATTAATGCTATGCAGAAAATCTTAGAGTGTCCCATCTGTCTGGAGTTGATCAAGGAACCTGTCTCCACAAAGTGTGACCACATATTTTGCAAATTTTGCATGCTGAAACTTCTCAACCAGAAGAAAGGGCCTTCACAGTGTCCTTTATGTAAGAATGATATAACCAAAAGGAGCCTACAAGAAAGTACGAGATTTAGTCAACTTGTTGAAGAGCTATTGAAAATCATTTGTGCTTTTCAGCTTGACACAGGTTTGGAGTATGCAAACAGCTATAATTTTGCAAAAAAGGAAAATAACTCTCCTGAACATCTAAAAGATGAAGTTTCTATCATCCAAAGTATGGGCTACAGAAACCGTGCCAAAAGACTTCTACAGAGTGACCCGAAAATCTTCAATGAAGCCAAACTAACAAGCCTA...`,
            exons: [
                { start: 0, end: 500, name: 'Экзон 2' },
                { start: 501, end: 1000, name: 'Экзон 3' },
                { start: 1001, end: 1500, name: 'Экзон 5' },
                { start: 1501, end: 2000, name: 'Экзон 6' },
                { start: 2001, end: 2500, name: 'Экзон 7' },
                { start: 2501, end: 3000, name: 'Экзон 8' },
                { start: 3001, end: 3500, name: 'Экзон 9' },
                { start: 3501, end: 4000, name: 'Экзон 10' },
                { start: 4001, end: 4500, name: 'Экзон 11' },
                { start: 4501, end: 5000, name: 'Экзон 12' },
                { start: 5001, end: 5500, name: 'Экзон 13' },
                { start: 5501, end: 5589, name: 'Экзон 14' }
            ]
        },
        
        actb: {
            name: 'ACTB (β-актин)',
            accession: 'NM_001101.5',
            description: 'Домашний ген, контрольный для ПЦР',
            sequence: `ATGGATGATGATATCGCCGCGCTCGTCGTCGACAACGGCTCCGGCATGTGCAAGGCCGGCTTCGCGGGCGACGATGCCCCCCGGGCCGTCTTCCCCTCCATCGTGGGGCGCCCCAGGCACCAGGGCGTGATGGTGGGCATGGGTCAGAAGGATTCCTATGTGGGCGACGAGGCCCAGAGCAAGAGAGGCATCCTCACCCTGAAGTACCCCATCGAGCACGGCATCGTCACCAACTGGGACGACATGGAGAAAATCTGGCACCACACCTTCTACAATGAGCTGCGTGTGGCTCCCGAGGAGCACCCCGTGCTGCTGACCGAGGCCCCCCTGAACCCCAAGGCCAACCGCGAGAAGATGACCCAGATCATGTTTGAGACCTTCAACACCCCAGCCATGTACGTTGCTATCCAGGCTGTGCTATCCCTGTACGCCTCTGGCCGTACCACTGGCATCGTGATGGACTCCGGTGACGGGGTCACCCACACTGTGCCCATCTACGAGGGGTATGCCCTCCCCCATGCCATCCTGCGTCTGGACCTGGCTGGCCGGGACCTGACTGACTACCTCATGAAGATCCTCACCGAGCGCGGCTACAGCTTCACCACCACGGCCGAGCGGGAAATCGTGCGTGACATTAAGGAGAAGCTGTGCTACGTCGCCCTGGACTTCGAGCAAGAGATGGCCACGGCTGCTTCCAGCTCCTCCCTGGAGAAGAGCTACGAGCTGCCTGACGGCCAGGTCATCACCATTGGCAATGAGCGGTTCCGCTGCCCTGAGGCACTCTTCCAGCCTTCCTTCCTGGGCATGGAGTCCTGTGGCATCCACGAAACTACCTTCAACTCCATCATGAAGTGTGACGTGGACATCCGCAAAGACCTGTACGCCAACACAGTGCTGTCTGGCGGCACCACCATGTACCCTGGCATTGCCGACAGGATGCAGAAGGAGATCACTGCCCTGGCACCCAGCACAATGAAGATCAAGATCATTGCTCCTCCTGAGCGCAAGTACTCCGTGTGGATCGGCGGCTCCATCCTGGCCGCGCTGTCCACCTTCCAGCAGATGTGGATCAGCAAGCAGGAGTACGACGAGTCCGGCCCCTCCATCGTCCACCGCAAATGCTTCTAG`,
            recommendedPrimers: [
                {
                    name: 'ACTB контроль',
                    forward: 'TCACCCACACTGTGCCCATCTACGA',
                    reverse: 'CAGCGGAACCGCTCATTGCCAATGG',
                    productSize: 295,
                    use: 'qPCR контроль'
                }
            ]
        }
    },
    
    // Гены мыши
    mouse: {
        gapdh: {
            name: 'Gapdh (glyceraldehyde-3-phosphate dehydrogenase)',
            accession: 'NM_001289726.1',
            description: 'Домашний ген мыши',
            sequence: `ATGGTGAAGGTCGGTGTGAACGGATTTGGCCGTATTGGGCGCCTGGTCACCAGGGCTGCCATTTGCAGTGGCAAAGTGGAGATTGTTGCCATCAACGACCCCTTCATTGACCTCAACTACATGGTCTACATGTTCCAGTATGACTCCACTCACGGCAAATTCAACGGCACAGTCAAGGCCGAGAATGGGAAGCTTGTCATCAACGGGAAGCCCATCACCATCTTCCAGGAGCGAGATCCCGCTAACATCAAATGGGGTGATGCTGGTGCTGAGTATGTCGTGGAGTCTACTGGTGTCTTCACCACCATGGAGAAGGCCGGGGCCCACTTGAAGGGTGGAGCCAAAAGGGTCATCATCTCCGCCCCTTCTGCCGATGCACCCCATGTTTGTGATGGGTGTGAACCACGAGAAATATGACAACTCACTCAAGATTGTCAGCAATGCATCCTGCACCACCAACTGCTTAGCCCCCC`,
            recommendedPrimers: [
                {
                    name: 'Gapdh control',
                    forward: 'AGGTCGGTGTGAACGGATTTG',
                    reverse: 'TGTAGACCATGTAGTTGAGGTCA',
                    productSize: 123,
                    use: 'qPCR контроль мышь'
                }
            ]
        }
    }
};
4.2 Создаем менеджер шаблонов
javascript
// lib/template-manager.js
export class TemplateManager {
    constructor(storage) {
        this.storage = storage;
        this.templates = GENE_TEMPLATES;
        this.favorites = [];
    }

    /**
     * Получить список всех генов
     */
    async getAllGenes() {
        const genes = [];
        
        for (const [organism, organismGenes] of Object.entries(this.templates)) {
            for (const [geneId, geneData] of Object.entries(organismGenes)) {
                genes.push({
                    id: geneId,
                    organism: organism,
                    name: geneData.name,
                    accession: geneData.accession,
                    description: geneData.description,
                    hasSequence: !!geneData.sequence,
                    isFavorite: this.favorites.includes(geneId)
                });
            }
        }
        
        return genes.sort((a, b) => a.name.localeCompare(b.name));
    }

    /**
     * Загрузить последовательность гена
     */
    async loadGeneSequence(geneId) {
        // Ищем ген во всех организмах
        for (const organismGenes of Object.values(this.templates)) {
            if (organismGenes[geneId]) {
                const gene = organismGenes[geneId];
                
                // Если последовательности нет, пробуем загрузить из NCBI
                if (!gene.sequence && gene.accession) {
                    gene.sequence = await this.fetchFromNCBI(gene.accession);
                }
                
                return {
                    ...gene,
                    id: geneId
                };
            }
        }
        
        throw new Error(`Gene ${geneId} not found`);
    }

    /**
     * Загрузить последовательность из NCBI по accession номеру
     */
    async fetchFromNCBI(accession) {
        try {
            const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=${accession}&rettype=fasta&retmode=text`;
            
            const response = await fetch(url);
            const text = await response.text();
            
            // Парсим FASTA
            const lines = text.split('\n');
            // Пропускаем заголовок (первая строка с >)
            const sequence = lines.slice(1)
                .join('')
                .replace(/\s/g, '')
                .toUpperCase();
            
            return sequence;
        } catch (error) {
            console.error('NCBI fetch error:', error);
            return null;
        }
    }

    /**
     * Добавить в избранное
     */
    async addToFavorites(geneId) {
        if (!this.favorites.includes(geneId)) {
            this.favorites.push(geneId);
            await this.storage.set('favoriteGenes', this.favorites);
        }
    }

    /**
     * Поиск по генам
     */
    searchGenes(query) {
        query = query.toLowerCase();
        const results = [];
        
        for (const [organism, genes] of Object.entries(this.templates)) {
            for (const [id, gene] of Object.entries(genes)) {
                if (id.toLowerCase().includes(query) ||
                    gene.name.toLowerCase().includes(query) ||
                    gene.description.toLowerCase().includes(query) ||
                    (gene.accession && gene.accession.toLowerCase().includes(query))) {
                    
                    results.push({
                        id,
                        organism,
                        name: gene.name,
                        accession: gene.accession,
                        description: gene.description,
                        relevance: this.calculateRelevance(query, gene)
                    });
                }
            }
        }
        
        return results.sort((a, b) => b.relevance - a.relevance);
    }

    calculateRelevance(query, gene) {
        let score = 0;
        const q = query.toLowerCase();
        
        if (gene.id.toLowerCase() === q) score += 100;
        if (gene.id.toLowerCase().includes(q)) score += 50;
        if (gene.name.toLowerCase().includes(q)) score += 30;
        if (gene.description.toLowerCase().includes(q)) score += 20;
        if (gene.accession && gene.accession.toLowerCase().includes(q)) score += 40;
        
        return score;
    }

    /**
     * Получить рекомендуемые праймеры для гена
     */
    getRecommendedPrimers(geneId) {
        for (const genes of Object.values(this.templates)) {
            if (genes[geneId] && genes[geneId].recommendedPrimers) {
                return genes[geneId].recommendedPrimers;
            }
        }
        return [];
    }
}
4.3 Добавляем UI для выбора гена
html
<!-- В popup.html, добавить панель выбора гена -->
<div class="gene-panel">
    <div class="gene-search">
        <input type="text" id="geneSearch" placeholder="🔍 Поиск гена (TP53, BRCA1, ACTB...)" autocomplete="off">
        <button class="btn btn-primary" id="searchGeneBtn">Найти</button>
    </div>
    
    <div class="gene-results" id="geneResults" style="display: none;">
        <h4>Результаты поиска</h4>
        <div class="gene-list" id="geneList"></div>
    </div>
    
    <div class="popular-genes">
        <h4>Популярные гены</h4>
        <div class="gene-chips">
            <button class="gene-chip" data-gene="tp53">TP53 (p53)</button>
            <button class="gene-chip" data-gene="brca1">BRCA1</button>
            <button class="gene-chip" data-gene="brca2">BRCA2</button>
            <button class="gene-chip" data-gene="egfr">EGFR</button>
            <button class="gene-chip" data-gene="akt1">AKT1</button>
            <button class="gene-chip" data-gene="mapk1">MAPK1</button>
            <button class="gene-chip" data-gene="gapdh">GAPDH</button>
            <button class="gene-chip" data-gene="actb">ACTB (β-актин)</button>
        </div>
    </div>
    
    <div class="favorites-genes" id="favoritesGenes" style="display: none;">
        <h4>⭐ Избранное</h4>
        <div class="gene-list" id="favoritesList"></div>
    </div>
</div>
4.4 Добавляем логику поиска и загрузки
javascript
// В popup.js
class GeneSearchHandler {
    constructor() {
        this.templateManager = new TemplateManager(storage);
        this.setupEventListeners();
    }

    setupEventListeners() {
        const searchInput = document.getElementById('geneSearch');
        const searchBtn = document.getElementById('searchGeneBtn');
        
        searchInput.addEventListener('input', debounce(() => {
            this.searchGenes(searchInput.value);
        }, 300));
        
        searchBtn.addEventListener('click', () => {
            this.searchGenes(searchInput.value);
        });
        
        // Клик по чипу популярного гена
        document.querySelectorAll('.gene-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                this.loadGene(chip.dataset.gene);
            });
        });
    }

    async searchGenes(query) {
        if (!query || query.length < 2) {
            document.getElementById('geneResults').style.display = 'none';
            return;
        }
        
        const results = this.templateManager.searchGenes(query);
        const resultsDiv = document.getElementById('geneResults');
        const listDiv = document.getElementById('geneList');
        
        if (results.length === 0) {
            listDiv.innerHTML = '<p class="no-results">Гены не найдены</p>';
        } else {
            listDiv.innerHTML = results.slice(0, 10).map(gene => `
                <div class="gene-item" data-gene="${gene.id}" data-organism="${gene.organism}">
                    <div class="gene-item-name">
                        <strong>${gene.name}</strong>
                        ${gene.isFavorite ? '<span class="favorite-star">⭐</span>' : ''}
                    </div>
                    <div class="gene-item-accession">${gene.accession || ''}</div>
                    <div class="gene-item-description">${gene.description}</div>
                    <button class="btn btn-small btn-outline load-gene-btn">
                        📥 Загрузить
                    </button>
                </div>
            `).join('');
            
            // Добавляем обработчики
            listDiv.querySelectorAll('.gene-item').forEach(item => {
                item.querySelector('.load-gene-btn').addEventListener('click', () => {
                    this.loadGene(
                        item.dataset.gene,
                        item.dataset.organism
                    );
                });
            });
        }
        
        resultsDiv.style.display = 'block';
    }

    async loadGene(geneId, organism = null) {
        try {
            showProgress(true);
            
            const gene = await this.templateManager.loadGeneSequence(geneId);
            
            if (gene && gene.sequence) {
                // Вставляем последовательность
                const textarea = document.getElementById('sequence');
                textarea.value = gene.sequence;
                updateSequenceStats(gene.sequence);
                currentSequence = gene.sequence;
                
                // Показываем информацию о гене
                this.showGeneInfo(gene);
                
                // Показываем рекомендуемые праймеры
                const recommended = this.templateManager.getRecommendedPrimers(geneId);
                if (recommended.length > 0) {
                    this.showRecommendedPrimers(recommended);
                }
                
                showNotification(`✅ Загружен ген ${gene.name}`);
            } else {
                showNotification('❌ Не удалось загрузить последовательность');
            }
        } catch (error) {
            showNotification('❌ Ошибка: ' + error.message);
        } finally {
            showProgress(false);
        }
    }

    showGeneInfo(gene) {
        const infoDiv = document.getElementById('geneInfo') || this.createGeneInfoDiv();
        
        infoDiv.innerHTML = `
            <div class="gene-info">
                <h4>🧬 ${gene.name}</h4>
                <p><strong>Accession:</strong> ${gene.accession || 'N/A'}</p>
                <p><strong>Длина:</strong> ${gene.sequence.length} п.н.</p>
                <p><strong>GC%:</strong> ${calculateGC(gene.sequence).toFixed(1)}%</p>
                ${gene.exons ? this.renderExons(gene.exons) : ''}
                <div class="gene-actions">
                    <button class="btn btn-small btn-outline" id="addToFavoritesBtn">
                        ⭐ Добавить в избранное
                    </button>
                    <button class="btn btn-small btn-outline" id="designForGeneBtn">
                        🎯 Дизайн праймеров
                    </button>
                </div>
            </div>
        `;
        
        infoDiv.style.display = 'block';
        
        document.getElementById('addToFavoritesBtn').addEventListener('click', () => {
            this.templateManager.addToFavorites(gene.id);
            showNotification('⭐ Добавлено в избранное');
        });
        
        document.getElementById('designForGeneBtn').addEventListener('click', () => {
            designPrimers();
        });
    }

    renderExons(exons) {
        return `
            <div class="exons">
                <strong>Экзоны:</strong>
                <div class="exon-map">
                    ${exons.map(exon => `
                        <div class="exon" style="left: ${(exon.start / 1000) * 100}%; width: ${((exon.end - exon.start) / 1000) * 100}%">
                            <span class="exon-tooltip">${exon.name}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    showRecommendedPrimers(primers) {
        const recDiv = document.getElementById('recommendedPrimers') || this.createRecommendedDiv();
        
        recDiv.innerHTML = `
            <div class="recommended-primers">
                <h4>📋 Рекомендуемые праймеры</h4>
                ${primers.map(p => `
                    <div class="recommended-primer">
                        <div><strong>${p.name}</strong> (${p.productSize} п.н.)</div>
                        <div class="primer-seqs">
                            <code>F: ${p.forward}</code>
                            <code>R: ${p.reverse}</code>
                        </div>
                        <div class="primer-use">${p.use}</div>
                        <button class="btn btn-small btn-outline use-recommended-btn">
                            Использовать
                        </button>
                    </div>
                `).join('')}
            </div>
        `;
        
        recDiv.querySelectorAll('.use-recommended-btn').forEach((btn, i) => {
            btn.addEventListener('click', () => {
                const primer = primers[i];
                document.getElementById('tm').value = 60;
                document.getElementById('gc').value = 50;
                document.getElementById('length').value = primer.forward.length;
                // TODO: установить minProductSize/maxProductSize
                designPrimers();
            });
        });
        
        recDiv.style.display = 'block';
    }
}
📋 Итог: что получится после реализации
1. BLAST интеграция
✅ Проверка специфичности в один клик

✅ Визуализация нецелевых совпадений

✅ Цветовая индикация риска (🔴🟡🟢)

✅ Прямая ссылка на NCBI BLAST

2. Экспорт в PDF/Excel
✅ Профессиональные отчеты для протоколов

✅ 4 формата (PDF, Excel, CSV, HTML)

✅ Автоматическое форматирование

✅ Включает все метаданные

3. Облачная синхронизация
✅ Данные на всех устройствах

✅ Умное слияние при конфликтах

✅ Аутентификация (email/Google)

✅ Автосинхронизация по расписанию

4. Шаблоны генов
✅ Быстрый доступ к популярным генам

✅ Поиск по названию/accession

✅ Загрузка последовательностей из NCBI

✅ Рекомендуемые праймеры

✅ Визуализация экзонов

✅ Избранное

🚀 Пример рабочего процесса
Пользователь ищет ген "TP53"

Выбирает из результатов

Последовательность загружается автоматически

Видит карту экзонов

Выбирает рекомендуемые праймеры

Нажимает "Дизайн" → получает праймеры

Проверяет специфичность через BLAST

Экспортирует отчет в PDF

Синхронизирует с облаком