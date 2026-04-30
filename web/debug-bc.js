// Diagnostic script — run on OVH: node web/debug-bc.js
// Dumps all price-related fields from bike-components.de for a given GTIN

const gtin = process.argv[2] || '8720299066984';

async function probe(gtin) {
    const url = 'https://www.bike-components.de/en/s/?keywords=' + encodeURIComponent(gtin);
    console.log('URL:', url, '\n');

    const res = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-GB,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Cache-Control': 'no-cache'
        },
        signal: AbortSignal.timeout(12000)
    });

    console.log('HTTP status:', res.status);
    console.log('Final URL:', res.url, '\n');

    const html = await res.text();
    console.log('HTML length:', html.length, '\n');

    // --- All price-related patterns in inline scripts ---
    const pricePatterns = [
        /["']price(?:Raw|Gross|Net|Brutto|Netto|WithVat|InclVat|ExclVat|Final|Display|Formatted|Current|Regular|Sale)?["']\s*:\s*["']?([\d.]+)/gi,
        /price(?:Raw|Gross|Net|Brutto|Netto|WithVat|InclVat|ExclVat|Final|Display|Formatted|Current|Regular|Sale)\s*[=:]\s*([\d.]+)/gi,
    ];

    console.log('=== PRICE PATTERNS IN HTML ===');
    const found = new Set();
    for (const pattern of pricePatterns) {
        let m;
        while ((m = pattern.exec(html)) !== null) {
            found.add(m[0].slice(0, 80));
        }
    }
    if (found.size === 0) console.log('(none found)');
    else [...found].slice(0, 20).forEach(f => console.log(' ', f));

    // --- JSON-LD blocks ---
    console.log('\n=== JSON-LD SCRIPTS ===');
    const jsonLdRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    let ldCount = 0;
    while ((m = jsonLdRegex.exec(html)) !== null) {
        ldCount++;
        try {
            const parsed = JSON.parse(m[1]);
            console.log(`\nBlock ${ldCount}:`, JSON.stringify(parsed, null, 2).slice(0, 600));
        } catch (e) {
            console.log(`Block ${ldCount}: (parse error)`);
        }
    }
    if (ldCount === 0) console.log('(none found)');

    // --- Nuxt / Vue initial state ---
    console.log('\n=== NUXT/VUE INITIAL STATE ===');
    const nuxtMatch = html.match(/<script[^>]*>\s*window\.__NUXT__\s*=\s*([\s\S]{1,2000}?)<\/script>/);
    if (nuxtMatch) {
        console.log(nuxtMatch[1].slice(0, 800));
    } else {
        const nuxtData = html.match(/id="__NUXT_DATA__"[^>]*>([\s\S]{1,2000}?)<\/script>/);
        if (nuxtData) console.log(nuxtData[1].slice(0, 800));
        else console.log('(none found)');
    }

    // --- Any script containing a 4–digit number that looks like DKK prices or 2-digit EUR ---
    console.log('\n=== SCRIPT SNIPPETS WITH LIKELY PRICES ===');
    const scriptTags = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
    for (const s of scriptTags) {
        const content = s[1];
        if (/\b[5-9]\.\d{2}\b/.test(content) && content.length < 50000) {
            const lines = content.split('\n').filter(l => /\b[5-9]\.\d{2}\b/.test(l));
            if (lines.length) {
                console.log('\n--- Script snippet ---');
                lines.slice(0, 5).forEach(l => console.log(' ', l.trim().slice(0, 120)));
            }
        }
    }
}

probe(gtin).catch(e => {
    console.error('Error:', e.message);
    process.exit(1);
});
