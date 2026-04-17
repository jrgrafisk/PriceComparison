const cheerio = require('cheerio');
const { SHOPS } = require('../../config.js');

const GTIN_SELECTORS = [
    { sel: '[itemprop="gtin13"]',         attr: 'content' },
    { sel: '[itemprop="gtin"]',           attr: 'content' },
    { sel: 'meta[property="product:ean"]', attr: 'content' },
    { sel: '[data-ean]',                  attr: 'data-ean' },
    { sel: '[data-gtin]',                 attr: 'data-gtin' },
    { sel: '.netz-ean',                   attr: null },
];

function isValidGTIN(val) {
    return val && /^\d{8,14}$/.test(val.trim());
}

// Only allow URLs from known shop domains — prevents SSRF
function isAllowedShopUrl(url) {
    try {
        const { protocol, hostname } = new URL(url);
        if (protocol !== 'https:' && protocol !== 'http:') return false;
        return SHOPS.some(s => hostname === s.domain || hostname.endsWith('.' + s.domain));
    } catch { return false; }
}

function findGTINInObject(obj, depth = 0) {
    if (depth > 6 || !obj || typeof obj !== 'object') return null;
    const fields = ['gtin13', 'gtin', 'gtin8', 'gtin12', 'gtin14', 'ean', 'barcode', 'ean_code', 'product_ean'];
    for (const f of fields) {
        if (isValidGTIN(String(obj[f] ?? ''))) return String(obj[f]);
    }
    for (const key of Object.keys(obj)) {
        const found = findGTINInObject(obj[key], depth + 1);
        if (found) return found;
    }
    return null;
}

const FETCH_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
};

function extractGTINFromHTML(html) {
    const $ = cheerio.load(html);

    for (const { sel, attr } of GTIN_SELECTORS) {
        const el = $(sel).first();
        if (!el.length) continue;
        const val = attr ? el.attr(attr) : el.text().trim();
        if (isValidGTIN(val)) return val.trim();
    }

    const scripts = $('script[type="application/ld+json"]');
    for (let i = 0; i < scripts.length; i++) {
        try {
            const data = JSON.parse($(scripts[i]).html());
            const gtin = findGTINInObject(data);
            if (gtin) return gtin;
        } catch (e) {}
    }

    const dataPage = $('[data-page]').attr('data-page');
    if (dataPage) {
        try {
            const gtin = findGTINInObject(JSON.parse(dataPage));
            if (gtin) return gtin;
        } catch (e) {}
    }

    return null;
}

async function extractGTINFromURL(url) {
    // Reject URLs not on a known shop domain — prevents SSRF
    if (!isAllowedShopUrl(url)) return null;

    // 1. Try fetching the product URL directly
    try {
        const res = await fetch(url, {
            headers: FETCH_HEADERS,
            signal: AbortSignal.timeout(8000)
        });
        if (res.ok) {
            const gtin = extractGTINFromHTML(await res.text());
            if (gtin) return gtin;
        }
    } catch (e) {
        // blocked or timed out — fall through to shop search fallback
    }

    // 2. Fallback: search via the shop's own search URL using the product slug
    const shop = SHOPS.find(s => url.includes(s.domain));
    if (!shop) return null;

    const slug = url.split('/').filter(Boolean).pop() || '';
    if (!slug) return null;

    try {
        const searchUrl = shop.url + encodeURIComponent(slug);
        const res = await fetch(searchUrl, {
            headers: FETCH_HEADERS,
            signal: AbortSignal.timeout(8000)
        });
        if (!res.ok) return null;
        const gtin = extractGTINFromHTML(await res.text());
        return gtin || null;
    } catch (e) {
        return null;
    }
}

module.exports = { extractGTINFromURL };
