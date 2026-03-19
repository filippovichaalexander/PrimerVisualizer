import { GENE_TEMPLATES } from './gene-templates.js';

export class TemplateManager {
    getFlatTemplates() {
        const out = [];
        Object.entries(GENE_TEMPLATES).forEach(([organism, genes]) => {
            Object.values(genes).forEach((g) => out.push({ ...g, organism }));
        });
        return out;
    }

    search(query) {
        const q = query.trim().toLowerCase();
        if (!q) return [];
        return this.getFlatTemplates().filter((g) =>
            g.id.toLowerCase().includes(q) ||
            g.name.toLowerCase().includes(q) ||
            (g.accession || '').toLowerCase().includes(q) ||
            (g.description || '').toLowerCase().includes(q)
        );
    }

    async fetchFromNCBI(accession) {
        const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=${encodeURIComponent(accession)}&rettype=fasta&retmode=text`;
        const response = await fetch(url);
        const text = await response.text();
        if (!response.ok || !text.includes('>')) {
            throw new Error(`NCBI fetch failed (${response.status})`);
        }
        const sequence = text
            .split('\n')
            .slice(1)
            .join('')
            .replace(/\s/g, '')
            .toUpperCase();
        if (!sequence) throw new Error('Пустая последовательность из NCBI');
        return sequence;
    }
}
