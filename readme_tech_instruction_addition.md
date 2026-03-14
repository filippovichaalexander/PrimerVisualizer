⚠️ Визуализация: схематичное изображение ДНК
Это единственный пункт, который реализован частично.

Что есть сейчас:

Текстовое отображение позиций (start-end)

Визуальные индикаторы качества (цвета, значки)

Предупреждения и рекомендации

Чего нет:

Графической схемы ДНК как линии

Стрелочек, показывающих направление праймеров


поэтому - 
вероятно -  нужно добавить для полной визуализации:

javascript
// Дополнительный файл: popup/visualization.js
export class DNAVisualizer {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.canvas = null;
        this.ctx = null;
    }
    
    render(sequence, pairs) {
        this.createCanvas();
        this.drawDNALine();
        this.drawPrimers(pairs);
        this.addInteraction();
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
    }
    
    drawDNALine() {
        const ctx = this.ctx;
        const width = this.canvas.width;
        
        // Основная линия
        ctx.beginPath();
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.moveTo(20, 75);
        ctx.lineTo(width - 20, 75);
        ctx.stroke();
        
        // Нуклеотиды (точки)
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
        const seqLength = this.sequence.length;
        const scale = (width - 40) / seqLength;
        
        pairs.slice(0, 3).forEach((pair, idx) => {
            const color = idx === 0 ? '#22c55e' : idx === 1 ? '#3b82f6' : '#f59e0b';
            
            // Forward primer
            this.drawPrimer(
                pair.forward.start,
                pair.forward.end,
                50,
                color,
                'right'
            );
            
            // Reverse primer
            this.drawPrimer(
                pair.reverse.start,
                pair.reverse.end,
                80,
                color,
                'left'
            );
        });
    }
    
    drawPrimer(start, end, y, color, direction) {
        const ctx = this.ctx;
        const x1 = 20 + start * this.scale;
        const x2 = 20 + end * this.scale;
        
        // Полупрозрачный прямоугольник
        ctx.fillStyle = color + '20';
        ctx.fillRect(x1, y - 15, x2 - x1, 30);
        
        // Рамка
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(x1, y - 15, x2 - x1, 30);
        
        // Стрелка направления
        ctx.fillStyle = color;
        if (direction === 'right') {
            ctx.beginPath();
            ctx.moveTo(x2 - 10, y);
            ctx.lineTo(x2, y);
            ctx.lineTo(x2 - 5, y - 5);
            ctx.lineTo(x2 - 5, y + 5);
            ctx.fill();
        } else {
            ctx.beginPath();
            ctx.moveTo(x1 + 10, y);
            ctx.lineTo(x1, y);
            ctx.lineTo(x1 + 5, y - 5);
            ctx.lineTo(x1 + 5, y + 5);
            ctx.fill();
        }
    }
}
