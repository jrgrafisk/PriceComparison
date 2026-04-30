// Diagnostic script — run on OVH: node web/debug-bc.js [gtin]

const gtin = process.argv[2] || '8720299066984';
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-GB,en;q=0.9',
    'Cache-Control': 'no-cache'
};

function extractPrices(html, label) {
    console.log(`\n=== PRICE PATTERNS IN ${label} ===`);
    const found = new Set();
    const pattern = /["']?price(?:Raw|Gross|Net|Brutto|Netto|WithVat|InclVat|ExclVat|Final|Display|Formatted|Current|Regular|Sale|Brut)?["']?\s*[:=]\s*["']?([\d.]+)/gi;
    let m;
    while ((m = pattern.exec(html)) !== null) found.add(m[0].slice(0, 80));
    if (found.size === 0) console.log('(none)');
    else [...found].slice(0, 20).forEach(f => console.log(' ', f));
}

function extractJSONLD(html, label) {
    console.log(`\n=== JSON-LD IN ${label} ===`);
    const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m, count = 0;
    while ((m = re.exec(html)) !== null) {
        count++;
        try {
            const d = JSON.parse(m[1]);
            console.log(`Block ${count}:`, JSON.stringify(d, null, 2).slice(0, 800));
        } catch (e) { console.log(`Block ${count}: parse error`); }
    }
    if (count === 0) console.log('(none)');
}

async function fetchHtml(url) {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(12000) });
    return { ok: res.ok, status: res.status, finalUrl: res.url, html: res.ok ? await res.text() : '' };
}

async function probe(gtin) {
    // 1. Fetch search page
    const searchUrl = 'https://www.bike-components.de/en/s/?keywords=' + encodeURIComponent(gtin);
    console.log('=== STEP 1: SEARCH PAGE ===');
    console.log('URL:', searchUrl);
    const search = await fetchHtml(searchUrl);
    console.log('Status:', search.status, '| Length:', search.html.length);

    extractPrices(search.html, 'SEARCH PAGE');
    extractJSONLD(search.html, 'SEARCH PAGE');

    // 2. Extract product page URLs from search results
    const productLinks = [...search.html.matchAll(/href="(\/en\/p\/[^"]+)"/g)]
        .map(m => 'https://www.bike-components.de' + m[1]);
    const uniqueLinks = [...new Set(productLinks)];
    console.log('\n=== PRODUCT LINKS FOUND IN SEARCH ===');
    if (uniqueLinks.length === 0) {
        console.log('(none found — Vue renders these client-side)');
    } else {
        uniqueLinks.slice(0, 3).forEach(l => console.log(' ', l));
    }

    // 3. If we found product links, fetch the first one
    if (uniqueLinks.length > 0) {
        console.log('\n=== STEP 2: PRODUCT PAGE ===');
        console.log('URL:', uniqueLinks[0]);
        const product = await fetchHtml(uniqueLinks[0]);
        console.log('Status:', product.status, '| Length:', product.html.length);

        extractPrices(product.html, 'PRODUCT PAGE');
        extractJSONLD(product.html, 'PRODUCT PAGE');
    } else {
        // 4. Try a known product URL pattern as fallback
        console.log('\n=== STEP 2: TRYING GTIN AS DIRECT SEARCH (no product link found) ===');
        console.log('The search page is fully Vue-rendered — product links not in SSR HTML.');
        console.log('Gross price (6.99 EUR) is only available after client-side render.');
    }

    // 5. Check the context around priceRaw
    console.log('\n=== CONTEXT AROUND priceRaw ===');
    const idx = search.html.indexOf('"priceRaw"');
    if (idx !== -1) {
        console.log(search.html.slice(Math.max(0, idx - 200), idx + 200));
    } else {
        console.log('(not found)');
    }
}

probe(gtin).catch(e => { console.error('Error:', e.message); process.exit(1); });
