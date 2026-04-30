// Diagnostic script — run on OVH: node web/debug-bc.js [gtin]

const gtin = process.argv[2] || '8720299066984';

async function fetchHtml(url, lang = 'en-GB,en;q=0.9') {
    const res = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': lang,
            'Cache-Control': 'no-cache'
        },
        signal: AbortSignal.timeout(12000)
    });
    return { ok: res.ok, status: res.status, finalUrl: res.url, html: res.ok ? await res.text() : '' };
}

function showPrices(html, label) {
    console.log(`\n--- ${label} ---`);
    const pattern = /["']?price(?:Raw|Gross|Net|Brutto|Netto|WithVat|InclVat|ExclVat|Final|Display|Formatted|Current|Regular|Sale|Brut)?["']?\s*[:=]\s*["']?([€\d.,]+)/gi;
    const found = new Set();
    let m;
    while ((m = pattern.exec(html)) !== null) found.add(m[0].slice(0, 80));
    if (found.size === 0) console.log('Price fields: (none)');
    else { console.log('Price fields:'); [...found].slice(0, 15).forEach(f => console.log('  ', f)); }

    // JSON-LD — show Product type in full
    const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    while ((m = ldRe.exec(html)) !== null) {
        try {
            const d = JSON.parse(m[1]);
            const types = Array.isArray(d) ? d.map(x => x['@type']) : [d['@type']];
            if (types.includes('WebSite') || types.includes('BreadcrumbList') || types.includes('FAQPage')) continue;
            console.log('\nJSON-LD (full):', JSON.stringify(d, null, 2));
        } catch (e) {}
    }

    // Show context around 6.99 to see which product it belongs to
    let searchFrom = 0;
    let found699 = 0;
    while (found699 < 3) {
        const idx699 = html.indexOf('"6.99', searchFrom);
        if (idx699 === -1) break;
        console.log(`\n--- Context around "6.99" (occurrence ${++found699}) ---`);
        console.log(html.slice(Math.max(0, idx699 - 150), idx699 + 150));
        searchFrom = idx699 + 1;
    }

    // Context around priceRaw
    const idx = html.indexOf('"priceRaw"');
    if (idx !== -1) {
        console.log('\nContext around priceRaw:');
        console.log(html.slice(Math.max(0, idx - 200), idx + 200));
    }
}

async function probe(gtin) {
    const searchUrl = 'https://www.bike-components.de/en/s/?keywords=' + encodeURIComponent(gtin);
    console.log('=== SEARCH PAGE ===\nURL:', searchUrl);
    const search = await fetchHtml(searchUrl, 'en-GB,en;q=0.9');
    console.log('Status:', search.status, '| Length:', search.html.length);
    showPrices(search.html, 'Search page');

    // Extract product link — \/ are literal backslash+slash in the embedded JSON
    const linkMatch = search.html.match(new RegExp('"link":"(\\\\/en\\\\/[^"]+)"'));
    if (!linkMatch) {
        console.log('\nNo product link matched — check pattern');
        return;
    }
    const productPath = linkMatch[1].split('\\/').join('/');
    const productUrl = 'https://www.bike-components.de' + productPath;

    console.log('\n=== PRODUCT PAGE (EN headers) ===\nURL:', productUrl);
    const prodEN = await fetchHtml(productUrl, 'en-GB,en;q=0.9');
    console.log('Status:', prodEN.status, '| Length:', prodEN.html.length);
    showPrices(prodEN.html, 'Product EN');

    console.log('\n=== PRODUCT PAGE (DE headers) ===');
    const prodDE = await fetchHtml(productUrl, 'de-DE,de;q=0.9');
    console.log('Status:', prodDE.status, '| Length:', prodDE.html.length);
    showPrices(prodDE.html, 'Product DE');
}

probe(gtin).catch(e => { console.error('Error:', e.message); process.exit(1); });
