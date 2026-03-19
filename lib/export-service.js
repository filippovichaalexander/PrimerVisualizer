export class ExportService {
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
            p.forward.details.tm.value?.toFixed?.(1) ?? '',
            p.forward.details.gc.value?.toFixed?.(1) ?? '',
            p.reverse.sequence,
            p.reverse.start,
            p.reverse.end,
            p.reverse.details.tm.value?.toFixed?.(1) ?? '',
            p.reverse.details.gc.value?.toFixed?.(1) ?? '',
            p.reverse.end - p.forward.start,
            p.totalScore ?? '',
            p.grade?.letter ?? '',
            (p.warnings || []).join('; ')
        ]);
        const csv = [headers.join(','), ...rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
        this.downloadText(`primers-${Date.now()}.csv`, csv, 'text/csv;charset=utf-8');
    }

    exportToHTML(primers) {
        const html = this.buildPrintableHtml(primers);
        this.downloadText(`primers-${Date.now()}.html`, html, 'text/html;charset=utf-8');
    }

    exportToExcel(primers) {
        const headers = [
            '№', 'Forward', 'F start', 'F end', 'F Tm', 'F GC',
            'Reverse', 'R start', 'R end', 'R Tm', 'R GC',
            'Product', 'Score', 'Grade', 'Warnings'
        ];
        const lines = [headers.join('\t')];
        primers.forEach((p, idx) => {
            lines.push([
                idx + 1,
                p.forward.sequence,
                p.forward.start,
                p.forward.end,
                p.forward.details.tm.value?.toFixed?.(1) ?? '',
                p.forward.details.gc.value?.toFixed?.(1) ?? '',
                p.reverse.sequence,
                p.reverse.start,
                p.reverse.end,
                p.reverse.details.tm.value?.toFixed?.(1) ?? '',
                p.reverse.details.gc.value?.toFixed?.(1) ?? '',
                p.reverse.end - p.forward.start,
                p.totalScore ?? '',
                p.grade?.letter ?? '',
                (p.warnings || []).join('; ')
            ].join('\t'));
        });
        this.downloadText(`primers-${Date.now()}.xls`, lines.join('\n'), 'application/vnd.ms-excel;charset=utf-8');
    }

    exportToPDF(primers) {
        const html = this.buildPrintableHtml(primers);
        const w = window.open('', '_blank');
        if (!w) throw new Error('Не удалось открыть окно печати');
        w.document.write(html);
        w.document.close();
        w.focus();
        w.print();
    }

    buildPrintableHtml(primers) {
        return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>PrimerDesigner report</title>
        <style>
        body{font-family:Arial,sans-serif;margin:20px;color:#1f2937}
        table{border-collapse:collapse;width:100%;font-size:12px}
        th,td{border:1px solid #d1d5db;padding:6px;text-align:left}
        th{background:#f3f4f6}
        h1{font-size:18px;margin-bottom:4px}
        .meta{font-size:12px;color:#4b5563;margin-bottom:10px}
        </style></head><body>
        <h1>PrimerDesigner Pro - Report</h1>
        <div class="meta">Дата: ${new Date().toLocaleString()} | Всего пар: ${primers.length}</div>
        <table><thead><tr><th>#</th><th>Forward</th><th>Reverse</th><th>Tm F/R</th><th>GC F/R</th><th>Score</th><th>Grade</th><th>Warnings</th></tr></thead><tbody>
        ${primers.map((p, idx) => `<tr><td>${idx + 1}</td><td>${p.forward.sequence}</td><td>${p.reverse.sequence}</td><td>${p.forward.details.tm.value?.toFixed?.(1) ?? ''}/${p.reverse.details.tm.value?.toFixed?.(1) ?? ''}</td><td>${p.forward.details.gc.value?.toFixed?.(1) ?? ''}/${p.reverse.details.gc.value?.toFixed?.(1) ?? ''}</td><td>${p.totalScore ?? ''}</td><td>${p.grade?.letter ?? ''}</td><td>${(p.warnings || []).join('; ')}</td></tr>`).join('')}
        </tbody></table></body></html>`;
    }

    downloadText(filename, content, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
}
