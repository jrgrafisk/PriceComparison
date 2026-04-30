// Diagnostic script — run on OVH: node web/debug-bc.js [gtin]

const gtin = process.argv[2] || '8720299066984';

async function fetchHtml(url, extraHeaders = {}) {
    const res = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'da-DK,da;q=0.9,en;q=0.8',
            'Cache-Control': 'no-cache',
            ...extraHeaders
        },
        signal: AbortSignal.timeout(12000)
    });
    return { ok: res.ok, status: res.status, finalUrl: res.url, html: res.ok ? await res.text() : '' };
}

async function fetchJson(url, extraHeaders = {}) {
    const res = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'da-DK,da;q=0.9,en;q=0.8',
            'X-Requested-With': 'XMLHttpRequest',
            ...extraHeaders
        },
        signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return { status: res.status, data: null };
    try { return { status: res.status, data: await res.json() }; }
    catch (e) { const t = await res.text(); return { status: res.status, data: null, text: t.slice(0, 300) }; }
}

async function probe(gtin) {
    // Step 1: Get search page and extract product link + product ID
    const searchUrl = 'https://www.bike-components.de/en/s/?keywords=' + encodeURIComponent(gtin);
    console.log('=== SEARCH PAGE ===\nURL:', searchUrl);
    const search = await fetchHtml(searchUrl);
    console.log('Status:', search.status);

    const linkMatch = search.html.match(new RegExp('"link":"(\\\\/en\\\\/[^"]+)"'));
    const idMatch = search.html.match(/"productId":(\d+)/);
    const productId = idMatch?.[1];
    const productPath = linkMatch ? linkMatch[1].split('\\/').join('/') : null;
    console.log('Product ID:', productId);
    console.log('Product path:', productPath);

    if (!productPath || !productId) { console.log('Could not extract product info'); return; }

    const productUrl = 'https://www.bike-components.de' + productPath;

    // Step 2: Fetch product page and look for API endpoint patterns
    console.log('\n=== PRODUCT PAGE ===\nURL:', productUrl);
    const prod = await fetchHtml(productUrl, { 'Referer': searchUrl });
    console.log('Status:', prod.status);

    // Find API endpoint patterns in JS bundles referenced from the page
    const jsUrls = [...prod.html.matchAll(/src="([^"]+\.js[^"]*)"/g)].map(m => m[1]);
    console.log('\nJS bundles found:', jsUrls.length);

    // Look for price-fetching API patterns in the HTML itself
    console.log('\n=== API PATTERNS IN HTML ===');
    const apiPatterns = [
        /["'](\/[a-z/]+(?:price|product|variant|stock)[^"']*?)["']/gi,
        /["'](\/en\/Ajax[^"']*?)["']/gi,
        /["'](\/api\/[^"']*?)["']/gi,
        /fetch\(["']([^"']+)["']/g,
        /axios[.(]["']([^"']+)["']/g
    ];
    const apiFound = new Set();
    for (const p of apiPatterns) {
        let m;
        while ((m = p.exec(prod.html)) !== null) apiFound.add(m[1]);
    }
    if (apiFound.size === 0) console.log('(none found in HTML)');
    else [...apiFound].forEach(u => console.log(' ', u));

    // Step 3: Try common price API patterns for this site
    console.log('\n=== TRYING PRICE API ENDPOINTS ===');
    const candidates = [
        `https://www.bike-components.de/en/Ajax/getProductData/?productId=${productId}`,
        `https://www.bike-components.de/api/products/${productId}/price`,
        `https://www.bike-components.de/en/Ajax/getPrice/?id=${productId}`,
        `https://www.bike-components.de/api/v1/products/${productId}`,
    ];
    for (const url of candidates) {
        const r = await fetchJson(url);
        console.log(`${url}\n  → status ${r.status}`, r.data ? JSON.stringify(r.data).slice(0, 200) : r.text || '');
    }

    // Step 4: Current priceRaw on product page
    const rawIdx = prod.html.indexOf('"priceRaw"');
    if (rawIdx !== -1) {
        console.log('\n=== PRODUCT PAGE priceRaw CONTEXT ===');
        console.log(prod.html.slice(Math.max(0, rawIdx - 50), rawIdx + 100));
    }
}

probe(gtin).catch(e => { console.error('Error:', e.message); process.exit(1); });
