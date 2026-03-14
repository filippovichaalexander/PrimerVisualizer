export class DNAVisualizer {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.canvas = null;
        this.ctx = null;
        this.sequence = '';
        this.scale = 1;
    }

    render(sequence, pairs) {
        if (!this.container) return;
        this.sequence = sequence;
        this.clear();
        this.createCanvas();
        this.drawDNALine();
        this.drawPrimers(pairs || []);
    }

    clear() {
        this.container.innerHTML = '';
    }

    createCanvas() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = this.container.clientWidth - 32;
        this.canvas.height = 150;
        this.canvas.style.borderRadius = '8px';
        this.canvas.style.background = '#f8fafc';
        this.canvas.style.margin = '16px 0';

        this.ctx = this.canvas.getContext('2d');
        this.container.appendChild(this.canvas);

        const seqLength = Math.max(this.sequence.length, 1);
        this.scale = (this.canvas.width - 40) / seqLength;
    }

    drawDNALine() {
        const ctx = this.ctx;
        const width = this.canvas.width;

        ctx.beginPath();
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.moveTo(20, 75);
        ctx.lineTo(width - 20, 75);
        ctx.stroke();

        ctx.fillStyle = '#94a3b8';
        for (let x = 30; x < width - 20; x += 15) {
            ctx.beginPath();
            ctx.arc(x, 75, 2, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    drawPrimers(pairs) {
        const ctx = this.ctx;
        const width = this.canvas.width;
        if (!this.sequence) return;

        pairs.slice(0, 3).forEach((pair, idx) => {
            const color = idx === 0 ? '#22c55e' : idx === 1 ? '#3b82f6' : '#f59e0b';

            this.drawPrimer(
                pair.forward.start,
                pair.forward.end,
                50,
                color,
                'right'
            );

            this.drawPrimer(
                pair.reverse.start,
                pair.reverse.end,
                100,
                color,
                'left'
            );
        });
    }

    drawPrimer(start, end, y, color, direction) {
        const ctx = this.ctx;
        const x1 = 20 + start * this.scale;
        const x2 = 20 + end * this.scale;

        ctx.fillStyle = this.withAlpha(color, 0.15);
        ctx.fillRect(x1, y - 12, x2 - x1, 24);

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(x1, y - 12, x2 - x1, 24);

        ctx.fillStyle = color;
        if (direction === 'right') {
            ctx.beginPath();
            ctx.moveTo(x2 - 10, y);
            ctx.lineTo(x2, y);
            ctx.lineTo(x2 - 5, y - 5);
            ctx.lineTo(x2 - 5, y + 5);
            ctx.closePath();
            ctx.fill();
        } else {
            ctx.beginPath();
            ctx.moveTo(x1 + 10, y);
            ctx.lineTo(x1, y);
            ctx.lineTo(x1 + 5, y - 5);
            ctx.lineTo(x1 + 5, y + 5);
            ctx.closePath();
            ctx.fill();
        }
    }

    withAlpha(hex, alpha) {
        const c = hex.replace('#', '');
        const r = parseInt(c.substring(0, 2), 16);
        const g = parseInt(c.substring(2, 4), 16);
        const b = parseInt(c.substring(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
}


// popup/visualization.js - добавить отображение пересечений

class OverlapVisualizer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
    }

    drawOverlaps(overlaps, sequenceLength, pairs) {
        if (!overlaps || overlaps.length === 0) return;
        
        const width = this.canvas.width;
        const scale = (width - 40) / sequenceLength;
        
        overlaps.forEach(overlap => {
            // Цвет в зависимости от уровня конфликта
            let color;
            switch (overlap.conflictLevel) {
                case 'high': color = '#ef4444'; break;
                case 'medium': color = '#f59e0b'; break;
                default: color = '#3b82f6'; break;
            }
            
            // Рисуем зону перекрытия
            const x1 = 20 + overlap.overlapStart * scale;
            const x2 = 20 + overlap.overlapEnd * scale;
            
            // Полупрозрачная заливка
            this.ctx.fillStyle = color + '30';
            this.ctx.fillRect(x1, 20, x2 - x1, 110);
            
            // Рамка
            this.ctx.strokeStyle = color;
            this.ctx.lineWidth = 2;
            this.ctx.setLineDash([5, 3]);
            this.ctx.strokeRect(x1, 20, x2 - x1, 110);
            this.ctx.setLineDash([]);
            
            // Маркер пересечения
            this.ctx.beginPath();
            this.ctx.fillStyle = color;
            this.ctx.arc((x1 + x2) / 2, 75, 5, 0, Math.PI * 2);
            this.ctx.fill();
            
            // Подпись при наведении
            this.addOverlayTooltip(overlap, (x1 + x2) / 2, 75);
        });
    }

    addOverlayTooltip(overlap, x, y) {
        // Создаем область для ховера
        const hitArea = {
            x: x - 10,
            y: y - 10,
            width: 20,
            height: 20,
            overlap: overlap
        };
        
        this.canvas.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            
            if (mouseX >= hitArea.x && mouseX <= hitArea.x + hitArea.width &&
                mouseY >= hitArea.y && mouseY <= hitArea.y + hitArea.height) {
                this.showOverlapTooltip(overlap, mouseX, mouseY);
            }
        });
    }

    showOverlapTooltip(overlap, x, y) {
        const tooltip = document.getElementById('overlap-tooltip') || this.createTooltip();
        
        let html = `
            <div class="overlap-tooltip">
                <h4>🔍 Пересечение праймеров</h4>
                <p><strong>Тип:</strong> ${this.formatOverlapType(overlap.type)}</p>
                <p><strong>Длина перекрытия:</strong> ${overlap.overlapLength} п.н.</p>
                <p><strong>Конфликт:</strong> ${this.formatConflictLevel(overlap.conflictLevel)}</p>
        `;
        
        if (overlap.complementaryRisk?.hasComplementarity) {
            html += `
                <p class="warning">
                    ⚠️ Комплементарность: ${overlap.complementaryRisk.matchPercent}%
                </p>
            `;
        }
        
        if (overlap.warning && overlap.warning.length > 0) {
            html += `<p class="warning">${overlap.warning[0]}</p>`;
        }
        
        html += '</div>';
        
        tooltip.innerHTML = html;
        tooltip.style.left = x + 20 + 'px';
        tooltip.style.top = y + 'px';
        tooltip.style.display = 'block';
    }

    formatOverlapType(type) {
        const types = {
            'forward_forward': 'Прямой-Прямой',
            'forward_reverse': 'Прямой-Обратный',
            'reverse_reverse': 'Обратный-Обратный',
            'product_overlap': 'Перекрытие продуктов'
        };
        return types[type] || type;
    }

    formatConflictLevel(level) {
        const levels = {
            'low': '🟢 Низкий',
            'medium': '🟡 Средний',
            'high': '🔴 Высокий'
        };
        return levels[level] || level;
    }

    createTooltip() {
        const tooltip = document.createElement('div');
        tooltip.id = 'overlap-tooltip';
        tooltip.style.cssText = `
            position: fixed;
            background: white;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 12px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            display: none;
            z-index: 10000;
            max-width: 300px;
            font-size: 12px;
        `;
        document.body.appendChild(tooltip);
        return tooltip;
    }
}

