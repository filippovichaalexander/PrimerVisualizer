// Мягкая пастельная палитра с прозрачностью (fill и stroke с alpha)
const PASTEL_PALETTE = [
    { fill: 'rgba(167, 243, 208, 0.55)', stroke: 'rgba(5, 150, 105, 0.75)' },   // мягкий зелёный
    { fill: 'rgba(191, 219, 254, 0.55)', stroke: 'rgba(37, 99, 235, 0.75)' },   // мягкий синий
    { fill: 'rgba(253, 230, 138, 0.55)', stroke: 'rgba(217, 119, 6, 0.75)' },   // мягкий янтарный
    { fill: 'rgba(233, 213, 255, 0.55)', stroke: 'rgba(124, 58, 237, 0.75)' },   // мягкий фиолетовый
    { fill: 'rgba(254, 202, 202, 0.5)',  stroke: 'rgba(185, 28, 28, 0.7)' },    // мягкий красный (не яркий)
];

export class DNAVisualizer {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.canvas = null;
        this.ctx = null;
        this.sequence = '';
        this.scale = 1;
        this.highlightedPairIndex = -1;
    }

    render(sequence, pairs, highlightedPairIndex = -1, zoom = 1) {
        if (!this.container) return;
        this.sequence = sequence;
        this.highlightedPairIndex = highlightedPairIndex;
        this.zoom = typeof zoom === 'number' && zoom > 0 ? zoom : 1;
        this.clear();
        this.createCanvas();
        this.drawDNALine();
        this.drawPrimers(pairs || [], highlightedPairIndex);
    }

    clear() {
        this.container.innerHTML = '';
    }

    createCanvas() {
        if (!this.container) return;
        const scrollParent = this.container.parentElement;
        const viewW = scrollParent ? scrollParent.clientWidth : (this.container.clientWidth || 400);
        const baseW = Math.max(1, viewW - 32);
        const zoom = typeof this.zoom === 'number' && this.zoom > 0 ? this.zoom : 1;
        const seqLength = Math.max(this.sequence.length, 1);
        const baseScale = (baseW - 40) / seqLength;
        this.scale = baseScale * zoom;
        const rightPad = 24;
        const canvasW = Math.min(8192, Math.max(baseW, Math.ceil(20 + seqLength * this.scale + rightPad)));

        this.canvas = document.createElement('canvas');
        this.canvas.width = canvasW;
        this.canvas.height = 150;
        this.canvas.style.cssText = 'display: block; width: ' + canvasW + 'px; height: 150px; border-radius: 8px; background: #f0f9ff; margin: 16px 0; border: 1px solid #e0f2fe; box-sizing: border-box;';

        this.ctx = this.canvas.getContext('2d');
        this.container.appendChild(this.canvas);
        this.container.style.minWidth = canvasW + 'px';
    }

    drawDNALine() {
        const ctx = this.ctx;
        const width = this.canvas.width;
        const rightEdge = width - 20;

        ctx.beginPath();
        ctx.strokeStyle = '#bae6fd';
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.moveTo(20, 75);
        ctx.lineTo(rightEdge, 75);
        ctx.stroke();

        ctx.fillStyle = '#7dd3fc';
        for (let x = 30; x < rightEdge; x += 15) {
            ctx.beginPath();
            ctx.arc(x, 75, 2, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    drawPrimers(pairs, highlightedPairIndex = -1) {
        const ctx = this.ctx;
        if (!this.sequence) return;

        pairs.slice(0, 5).forEach((pair, idx) => {
            const palette = PASTEL_PALETTE[idx % PASTEL_PALETTE.length];
            const isHighlighted = idx === highlightedPairIndex;

            this.drawPrimer(
                pair.forward.start,
                pair.forward.end,
                50,
                palette.fill,
                palette.stroke,
                'right',
                isHighlighted
            );

            this.drawPrimer(
                pair.reverse.start,
                pair.reverse.end,
                100,
                palette.fill,
                palette.stroke,
                'left',
                isHighlighted
            );
        });
    }

    drawPrimer(start, end, y, fillColor, strokeColor, direction, isHighlighted = false) {
        const ctx = this.ctx;
        const x1 = 20 + start * this.scale;
        const x2 = 20 + end * this.scale;
        const w = x2 - x1;
        const h = 24;

        const fill = typeof fillColor === 'string' && fillColor.startsWith('rgba') ? fillColor : this.hexToRgba(fillColor, 0.55);
        const stroke = typeof strokeColor === 'string' && strokeColor.startsWith('rgba') ? strokeColor : this.hexToRgba(strokeColor, 0.75);

        ctx.fillStyle = fill;
        ctx.fillRect(x1, y - 12, w, h);

        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x1, y - 12, w, h);

        if (isHighlighted) {
            const outPad = 10;
            ctx.strokeStyle = 'rgba(30, 64, 175, 0.9)';
            ctx.lineWidth = 6;
            ctx.setLineDash([]);
            ctx.strokeRect(x1 - outPad, y - 12 - outPad, w + outPad * 2, h + outPad * 2);
        }

        const arrowColor = typeof strokeColor === 'string' && strokeColor.startsWith('rgba') ? strokeColor : this.hexToRgba(strokeColor, 0.85);
        ctx.fillStyle = arrowColor;
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

    hexToRgba(hex, alpha) {
        if (typeof hex !== 'string' || !hex.startsWith('#')) return hex;
        const c = hex.replace('#', '');
        const r = parseInt(c.substring(0, 2), 16);
        const g = parseInt(c.substring(2, 4), 16);
        const b = parseInt(c.substring(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    withAlpha(hex, alpha) {
        const c = hex.replace('#', '');
        const r = parseInt(c.substring(0, 2), 16);
        const g = parseInt(c.substring(2, 4), 16);
        const b = parseInt(c.substring(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
}


// Отображение пересечений праймеров на канвасе (опционально используется из popup)

export class OverlapVisualizer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.hitAreas = [];
        this._boundMouseMove = this._onMouseMove.bind(this);
    }

    drawOverlaps(overlaps, sequenceLength, highlightedIndex = -1) {
        if (!overlaps || overlaps.length === 0) {
            this.hitAreas = [];
            return;
        }

        this._overlaps = overlaps;
        this._highlightedIndex = highlightedIndex;

        const width = this.canvas.width;
        const scale = (width - 40) / Math.max(sequenceLength, 1);
        this.hitAreas = [];

        const getColors = (level, isHighlighted) => {
            switch (level) {
                case 'high':
                    return {
                        fill: isHighlighted ? 'rgba(244, 114, 182, 0.38)' : 'rgba(251, 207, 232, 0.28)',
                        stroke: 'rgba(219, 39, 119, 0.85)'
                    };
                case 'medium':
                    return {
                        fill: isHighlighted ? 'rgba(250, 204, 21, 0.38)' : 'rgba(254, 240, 138, 0.28)',
                        stroke: 'rgba(202, 138, 4, 0.85)'
                    };
                default:
                    return {
                        fill: isHighlighted ? 'rgba(74, 222, 128, 0.38)' : 'rgba(187, 247, 208, 0.28)',
                        stroke: 'rgba(22, 163, 74, 0.85)'
                    };
            }
        };

        const segmentData = [];

        const drawOneSegment = (overlap, idx, isHighlighted) => {
            const colors = getColors(overlap.conflictLevel || 'low', isHighlighted);
            const x1 = 20 + overlap.overlapStart * scale;
            const x2 = 20 + overlap.overlapEnd * scale;
            const w = x2 - x1;

            this.ctx.fillStyle = colors.fill;
            this.ctx.fillRect(x1, 20, w, 110);

            this.ctx.strokeStyle = colors.stroke;
            this.ctx.lineWidth = isHighlighted ? 2 : 1.5;
            this.ctx.setLineDash(isHighlighted ? [] : [4, 3]);
            this.ctx.strokeRect(x1, 20, w, 110);
            this.ctx.setLineDash([]);

            if (isHighlighted) {
                const pad = 4;
                this.ctx.strokeStyle = 'rgba(30, 64, 175, 0.95)';
                this.ctx.lineWidth = 6;
                this.ctx.strokeRect(x1 - pad, 20 - pad, w + pad * 2, 110 + pad * 2);
            }

            const cx = (x1 + x2) / 2;
            const cy = 75;
            segmentData.push({ overlap, idx, isHighlighted, cx, cy, stroke: colors.stroke });
        };

        overlaps.forEach((overlap, idx) => {
            if (idx === highlightedIndex) return;
            drawOneSegment(overlap, idx, false);
        });
        if (highlightedIndex >= 0 && highlightedIndex < overlaps.length) {
            drawOneSegment(overlaps[highlightedIndex], highlightedIndex, true);
        }

        segmentData.forEach(({ overlap, idx, cx, cy, stroke, isHighlighted }) => {
            const pointRadius = isHighlighted ? 10 : 8;
            const hitRadius = 14;
            this.hitAreas.push({ cx, cy, hitRadius, overlap, index: idx });
            this.ctx.beginPath();
            this.ctx.fillStyle = stroke;
            this.ctx.arc(cx, cy, pointRadius, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
            this.ctx.lineWidth = 2.5;
            this.ctx.stroke();
        });

        this.canvas.removeEventListener('mousemove', this._boundMouseMove);
        this.canvas.addEventListener('mousemove', this._boundMouseMove);
    }

    _onMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        const mouseX = (e.clientX - rect.left) * scaleX;
        const mouseY = (e.clientY - rect.top) * scaleY;

        for (const area of this.hitAreas) {
            const dx = mouseX - area.cx;
            const dy = mouseY - area.cy;
            if (dx * dx + dy * dy <= area.hitRadius * area.hitRadius) {
                this.canvas.style.cursor = 'pointer';
                this.showOverlapTooltip(area.overlap, e.clientX, e.clientY, area.index);
                return;
            }
        }
        this.canvas.style.cursor = 'default';
        const tooltip = document.getElementById('overlap-tooltip');
        if (tooltip) tooltip.style.display = 'none';
    }

    showOverlapTooltip(overlap, x, y, overlapIndex = 0) {
        const tooltip = document.getElementById('overlap-tooltip') || this.createTooltip();
        const warnings = Array.isArray(overlap.warning) ? overlap.warning : (overlap.warning ? [overlap.warning] : []);
        const num = (overlapIndex != null ? overlapIndex : 0) + 1;

        let html = `
            <div class="overlap-tooltip">
                <h4>🔍 Пересечение праймеров № ${num}</h4>
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

        warnings.forEach(w => { html += `<p class="warning">${w}</p>`; });

        html += '</div>';

        tooltip.innerHTML = html;
        tooltip.style.left = (x + 16) + 'px';
        tooltip.style.top = (y + 8) + 'px';
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

