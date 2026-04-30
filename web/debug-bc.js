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

function showPricesAndContext(html, label) {
    console.log(`\n--- ${label} ---`);

    // All price fields
    const pattern = /["']?price(?:Raw|Gross|Net|Brutto|Netto|WithVat|InclVat|ExclVat|Final|Display|Formatted|Current|Regular|Sale|Brut)?["']?\s*[:=]\s*["']?([€\d.,]+)/gi;
    const found = new Set();
    let m;
    while ((m = pattern.exec(html)) !== null) found.add(m[0].slice(0, 80));
    if (found.size === 0) console.log('Price fields: (none)');
    else { console.log('Price fields:'); [...found].slice(0, 15).forEach(f => console.log('  ', f)); }

    // JSON-LD
    const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let ldCount = 0;
    while ((m = ldRe.exec(html)) !== null) {
        ldCount++;
        try {
            const d = JSON.parse(m[1]);
            if (d['@type'] !== 'WebSite') {
                console.log(`\nJSON-LD block ${ldCount}:`, JSON.stringify(d, null, 2).slice(0, 1000));
            }
        } catch (e) {}
    }
    if (ldCount === 0) console.log('JSON-LD: (none)');

    // Context around priceRaw
    const idx = html.indexOf('"priceRaw"');
    if (idx !== -1) {
        console.log('\nContext around priceRaw:');
        console.log(html.slice(Math.max(0, idx - 300), idx + 300));
    }
}

async function probe(gtin) {
    // Step 1: Search page with EN headers
    const searchUrl = 'https://www.bike-components.de/en/s/?keywords=' + encodeURIComponent(gtin);
    console.log('=== SEARCH PAGE (EN) ===');
    console.log('URL:', searchUrl);
    const searchEN = await fetchHtml(searchUrl, 'en-GB,en;q=0.9');
    console.log('Status:', searchEN.status, '| Length:', searchEN.html.length);
    showPricesAndContext(searchEN.html, 'Search EN');

    // Extract product link from embedded JSON
    const linkMatch = searchEN.html.match(/"link":"(\/en\/[^"]+)"/);
    if (!linkMatch) {
        console.log('\nNo product link found in search HTML — Vue renders links client-side');
        return;
    }
    const productUrl = 'https://www.bike-components.de' + linkMatch[1].replace(/\\/g, '');
    console.log('\n=== PRODUCT PAGE ===');
    console.log('URL:', productUrl);

    // Step 2: Fetch product page with EN headers
    const prodEN = await fetchHtml(productUrl, 'en-GB,en;q=0.9');
    console.log('Status (EN):', prodEN.status, '| Length:', prodEN.html.length);
    showPricesAndContext(prodEN.html, 'Product page EN');

    // Step 3: Fetch same product page with DE headers to compare
    const prodDE = await fetchHtml(productUrl, 'de-DE,de;q=0.9');
    console.log('\nStatus (DE):', prodDE.status, '| Length:', prodDE.html.length);
    showPricesAndContext(prodDE.html, 'Product page DE');
}

probe(gtin).catch(e => { console.error('Error:', e.message); process.exit(1); });
