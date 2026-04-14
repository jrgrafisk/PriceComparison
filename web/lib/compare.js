const cheerio = require('cheerio');
const { SHOPS, EXCHANGE_RATES } = require('../../config.js');

function buildUrl(shop, gtin) {
    if (shop.url.includes('{gtin}')) {
        return shop.url.replace('{gtin}', encodeURIComponent(gtin));
    }
    const url = shop.url + encodeURIComponent(gtin);
    return shop.urlSuffix ? url + shop.urlSuffix : url;
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

        const priceData = shop.inertia
            ? parseInertiaPrice(html, shop)
            : parseCSSPrice(html, shop);

        if (!priceData) return null;

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
        if (e.name !== 'AbortError' && e.name !== 'TimeoutError') {
            console.error(`[${shop.name}]`, e.message);
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
