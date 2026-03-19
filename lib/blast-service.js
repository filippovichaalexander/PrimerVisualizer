export class BlastService {
    constructor() {
        this.baseUrl = 'https://blast.ncbi.nlm.nih.gov/Blast.cgi';
        this.pollInterval = 2500;
        this.maxAttempts = 30;
    }

    async checkPrimerSpecificity(primerSequence, options = {}) {
        const organism = options.organism || 'human';
        const database = this.getDatabaseForOrganism(organism);
        const rid = await this.submitBlastJob({
            sequence: primerSequence,
            database,
            program: 'blastn-short',
        });
        const report = await this.pollBlastResults(rid);
        return this.analyzeBlastResults(report);
    }

    async submitBlastJob(params) {
        const formData = new URLSearchParams();
        formData.set('QUERY', params.sequence);
        formData.set('DATABASE', params.database);
        formData.set('PROGRAM', params.program);
        formData.set('CMD', 'Put');
        formData.set('MEGABLAST', 'off');
        formData.set('FILTER', 'L');

        const response = await fetch(this.baseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formData.toString()
        });
        const text = await response.text();
        const ridMatch = text.match(/RID = ([A-Z0-9-]+)/);
        if (!ridMatch) throw new Error('NCBI BLAST: не удалось получить RID');
        return ridMatch[1];
    }

    async pollBlastResults(rid) {
        let attempts = 0;
        while (attempts < this.maxAttempts) {
            const params = new URLSearchParams({
                RID: rid,
                FORMAT_TYPE: 'JSON2_S',
                CMD: 'Get'
            });
            const response = await fetch(`${this.baseUrl}?${params.toString()}`);
            const text = await response.text();
            if (text.includes('Status=WAITING')) {
                attempts++;
                await this.sleep(this.pollInterval);
                continue;
            }
            if (text.includes('Status=FAILED') || text.includes('Status=UNKNOWN')) {
                throw new Error('BLAST задание завершилось ошибкой');
            }
            try {
                const json = JSON.parse(text);
                const report = Array.isArray(json.BlastOutput2) ? json.BlastOutput2[0]?.report : json.BlastOutput2?.report;
                if (!report) throw new Error('BLAST вернул пустой отчет');
                return report;
            } catch (_e) {
                attempts++;
                await this.sleep(this.pollInterval);
            }
        }
        throw new Error('BLAST проверка превысила лимит ожидания');
    }

    analyzeBlastResults(blastReport) {
        const hits = blastReport?.results?.search?.hits || [];
        const analysis = {
            totalHits: hits.length,
            offTargetHits: 0,
            highRisk: [],
            mediumRisk: [],
            lowRisk: []
        };
        for (const hit of hits.slice(0, 20)) {
            const hsp = hit.hsps?.[0];
            if (!hsp || !hsp.align_len) continue;
            const identity = (hsp.identity / hsp.align_len) * 100;
            const rec = {
                description: hit.description?.[0]?.title || 'Unknown hit',
                identity,
                accession: hit.description?.[0]?.accession || ''
            };
            if (identity >= 95) analysis.highRisk.push(rec);
            else if (identity >= 80) analysis.mediumRisk.push(rec);
            else analysis.lowRisk.push(rec);
        }
        analysis.offTargetHits = analysis.highRisk.length + analysis.mediumRisk.length + analysis.lowRisk.length;
        return analysis;
    }

    getDatabaseForOrganism(organism) {
        const db = {
            human: 'refseq_genomic',
            mouse: 'refseq_genomic',
            rat: 'refseq_genomic',
            zebrafish: 'refseq_genomic',
            arabidopsis: 'refseq_genomic',
            ecoli: 'refseq_genomic'
        };
        return db[organism] || 'nt';
    }

    getBlastSearchUrl(sequence) {
        const params = new URLSearchParams({
            PAGE_TYPE: 'BlastSearch',
            PROGRAM: 'blastn',
            QUERY: sequence
        });
        return `${this.baseUrl}?${params.toString()}`;
    }

    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
