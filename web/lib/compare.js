const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { SHOPS, EXCHANGE_RATES } = require('../../config.js');

// Track consecutive misses per shop for health monitoring
const shopHealth = {};
const HEALTH_WARNING_THRESHOLD = 5;
const LOG_FILE = path.join(__dirname, '..', 'logs', 'health.log');

function writeHealthLog(message) {
    const line = `[${new Date().toISOString()}] ${message}\n`;
    console.warn(message);
    try {
        fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
        fs.appendFileSync(LOG_FILE, line);
    } catch (e) {
        // Don't crash the server if logging fails
    }
}

function buildUrl(shop, gtin) {
    if (shop.url.includes('{gtin}')) {
        return shop.url.replace('{gtin}', encodeURIComponent(gtin));
    }
    const url = shop.url + encodeURIComponent(gtin);
    return shop.urlSuffix ? url + shop.urlSuffix : url;
}

function parseJSONLDPrice(html, gtin, shop) {
    const $ = cheerio.load(html);
    const scripts = $('script[type="application/ld+json"]');

    for (let i = 0; i < scripts.length; i++) {
        try {
            const raw = $(scripts[i]).html();
            if (!raw) continue;
            const data = JSON.parse(raw);
            const items = Array.isArray(data) ? data : [data];

            for (const item of items) {
                // Must have offers with a price
                if (!item.offers) continue;

                // If product has a GTIN, verify it matches
                const productGtin = item.gtin13 || item.gtin || item.gtin8 || item.gtin12 || item.gtin14;
                if (productGtin && String(productGtin).trim() !== gtin) continue;

                const offerList = Array.isArray(item.offers) ? item.offers : [item.offers];
                for (const offer of offerList) {
                    const price = parseFloat(offer.price);
                    if (isNaN(price) || price <= 0) continue;
                    const currency = offer.priceCurrency || shop.defaultCurrency;
                    const priceText = currency === 'DKK'
                        ? `${price.toFixed(2).replace('.', ',')} kr.`
                        : `${price.toFixed(2)} €`;
                    return { priceText, price, currency };
                }
            }
        } catch (e) {}
    }
    return null;
}

function parseCSSPrice(html, shop) {
    const $ = cheerio.load(html);
    const selectors = shop.priceSelector.split(',').map(s => s.trim());

    for (const selector of selectors) {
        const el = $(selector).first();
        if (!el.length) continue;

        const raw = el.is('meta') ? el.attr('content') : el.text().trim();
        if (!raw) continue;

        const cleaned = raw.replace(/[^0-9.,]/g, '').replace(',', '.');
        const price = parseFloat(cleaned);
        if (isNaN(price) || price <= 0) continue;

        const currency = shop.defaultCurrency;
        const priceText = currency === 'DKK'
            ? `${price.toFixed(2).replace('.', ',')} kr.`
            : `${price.toFixed(2)} €`;

        return { priceText, price, currency };
    }
    return null;
}

function parseDataPropsPrice(html, shop) {
    const $ = cheerio.load(html);
    const { selector, attribute, productPaths, priceField } = shop.dataProps;
    const raw = $(selector).first().attr(attribute);
    if (!raw) return null;

    let data;
    try { data = JSON.parse(raw); } catch (e) { return null; }

    for (const path of productPaths) {
        const products = path.split('.').reduce((obj, key) => obj?.[key], data);
        if (Array.isArray(products) && products.length > 0) {
            const price = parseFloat(products[0][priceField]);
            if (!isNaN(price) && price > 0) {
                const currency = shop.defaultCurrency;
                const priceText = currency === 'DKK'
                    ? `${price.toFixed(2).replace('.', ',')} kr.`
                    : `${price.toFixed(2)} €`;
                return { priceText, price, currency };
            }
        }
    }
    return null;
}

function parseScriptPrice(html, shop) {
    const { price: priceRegex, currency: currencyRegex, container } = shop.scriptExtract;

    let searchHtml = html;
    if (container) {
        const $ = cheerio.load(html);
        const el = $(container).first();
        if (el.length) {
            searchHtml = el.find('script').map((i, s) => $(s).html() || '').get().join('\n');
        }
    }

    const priceMatch = searchHtml.match(new RegExp(priceRegex));
    if (!priceMatch) return null;
    const price = parseFloat(priceMatch[1]);
    if (isNaN(price) || price <= 0) return null;

    let currency = shop.defaultCurrency;
    if (currencyRegex) {
        const currMatch = searchHtml.match(new RegExp(currencyRegex));
        if (currMatch) currency = currMatch[1];
    }

    const priceText = currency === 'DKK'
        ? `${price.toFixed(2).replace('.', ',')} kr.`
        : `${price.toFixed(2)} €`;
    return { priceText, price, currency };
}

function parseShopifySearchPrice(text, shop) {
    let json;
    try { json = JSON.parse(text); } catch (e) { return null; }
    const products = json?.resources?.results?.products;
    if (!products || products.length === 0) return null;
    // Shopify returns price in cents (e.g. "39900" = 399.00 DKK)
    const cents = parseInt(products[0].price, 10);
    if (isNaN(cents) || cents <= 0) return null;
    const price = cents / 100;
    const currency = shop.defaultCurrency || 'DKK';
    const priceText = currency === 'DKK'
        ? `${price.toFixed(2).replace('.', ',')} kr.`
        : `${price.toFixed(2)} €`;
    return { priceText, price, currency };
}

function parseInertiaPrice(html, shop) {
    const $ = cheerio.load(html);
    const dataPage = $('[data-page]').attr('data-page');
    if (!dataPage) return null;

    let pageData;
    try { pageData = JSON.parse(dataPage); } catch (e) { return null; }

    const { productPaths, priceField } = shop.inertia;
    for (const path of productPaths) {
        const products = path.split('.').reduce((obj, key) => obj?.[key], pageData);
        if (Array.isArray(products) && products.length > 0) {
            const price = parseFloat(products[0][priceField]);
            if (!isNaN(price) && price > 0) {
                return {
                    priceText: `${price.toFixed(2).replace('.', ',')} kr.`,
                    price,
                    currency: 'DKK'
                };
            }
        }
    }

    console.log(`[Inertia] Ingen pris fundet for ${shop.name}. Props:`, JSON.stringify(pageData?.props, null, 2));
    return null;
}

async function fetchShopPrice(shop, gtin) {
    const url = buildUrl(shop, gtin);
    const timeout = shop.timeout || 8000;

    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' },
            signal: AbortSignal.timeout(timeout)
        });

        if (!res.ok) return null;
        const html = await res.text();

        let priceData = shop.shopifySearch
            ? parseShopifySearchPrice(html, shop)
            : shop.inertia
            ? parseInertiaPrice(html, shop)
            : shop.dataProps
            ? parseDataPropsPrice(html, shop)
            : shop.scriptExtract
            ? parseScriptPrice(html, shop)
            : parseCSSPrice(html, shop);

        // Fallback to JSON-LD when no structured data config and CSS/script finds nothing
        if (!priceData && !shop.inertia && !shop.dataProps) {
            priceData = parseJSONLDPrice(html, gtin, shop);
        }

        if (!priceData) {
            // Track miss
            shopHealth[shop.domain] = (shopHealth[shop.domain] || 0) + 1;
            if (shopHealth[shop.domain] === HEALTH_WARNING_THRESHOLD) {
                writeHealthLog(`[HEALTH] ${shop.name} has failed ${HEALTH_WARNING_THRESHOLD} times in a row — may be blocked or selector broken`);
            }
            return null;
        }

        // Reset miss counter on success
        shopHealth[shop.domain] = 0;

        const dkkPrice = priceData.currency === 'DKK'
            ? priceData.price
            : priceData.price * EXCHANGE_RATES.EUR_TO_DKK;

        return {
            shop: shop.name,
            priceText: priceData.priceText,
            dkkPrice: Math.round(dkkPrice),
            url
        };
    } catch (e) {
        shopHealth[shop.domain] = (shopHealth[shop.domain] || 0) + 1;
        if (shopHealth[shop.domain] === HEALTH_WARNING_THRESHOLD) {
            writeHealthLog(`[HEALTH] ${shop.name} has errored ${HEALTH_WARNING_THRESHOLD} times in a row — ${e.message}`);
        }
        if (e.name !== 'AbortError' && e.name !== 'TimeoutError') {
            // Only log first error, not every retry
            if (shopHealth[shop.domain] === 1) {
                console.error(`[${shop.name}]`, e.message);
            }
        }
        return null;
    }
}

async function compareByGTIN(gtin) {
    const results = await Promise.all(SHOPS.map(shop => fetchShopPrice(shop, gtin)));
    return results
        .filter(Boolean)
        .sort((a, b) => a.dkkPrice - b.dkkPrice);
}

module.exports = { compareByGTIN };
