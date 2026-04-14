const cheerio = require('cheerio');

const GTIN_SELECTORS = [
    { sel: '[itemprop="gtin13"]',        attr: 'content' },
    { sel: '[itemprop="gtin"]',          attr: 'content' },
    { sel: 'meta[property="product:ean"]', attr: 'content' },
    { sel: '[data-ean]',                 attr: 'data-ean' },
    { sel: '[data-gtin]',               attr: 'data-gtin' },
    { sel: '.netz-ean',                  attr: null },
];

function isValidGTIN(val) {
    return val && /^\d{8,14}$/.test(val.trim());
}

function findGTINInObject(obj, depth = 0) {
    if (depth > 6 || !obj || typeof obj !== 'object') return null;
    const fields = ['gtin13', 'gtin', 'gtin8', 'gtin12', 'gtin14', 'ean'];
    for (const f of fields) {
        if (isValidGTIN(String(obj[f] ?? ''))) return String(obj[f]);
    }
    for (const key of Object.keys(obj)) {
        const found = findGTINInObject(obj[key], depth + 1);
        if (found) return found;
    }
    return null;
}

async function extractGTINFromURL(url) {
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' },
            signal: AbortSignal.timeout(10000)
        });
        if (!res.ok) return null;
        const html = await res.text();
        const $ = cheerio.load(html);

        // 1. CSS selectors
        for (const { sel, attr } of GTIN_SELECTORS) {
            const el = $(sel).first();
            if (!el.length) continue;
            const val = attr ? el.attr(attr) : el.text().trim();
            if (isValidGTIN(val)) return val.trim();
        }

        // 2. JSON-LD
        const scripts = $('script[type="application/ld+json"]');
        for (let i = 0; i < scripts.length; i++) {
            try {
                const data = JSON.parse($(scripts[i]).html());
                const gtin = findGTINInObject(data);
                if (gtin) return gtin;
            } catch (e) {}
        }

        // 3. Inertia data-page
        const dataPage = $('[data-page]').attr('data-page');
        if (dataPage) {
            try {
                const gtin = findGTINInObject(JSON.parse(dataPage));
                if (gtin) return gtin;
            } catch (e) {}
        }

        return null;
    } catch (e) {
        console.error('GTIN extraction error:', e.message);
        return null;
    }
}

module.exports = { extractGTINFromURL };
