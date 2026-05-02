#!/usr/bin/env node
// Daily price crawler — run via cron:
//   0 6 * * * cd /var/www/pedalpricer && node web/crawler.js >> web/logs/crawler.log 2>&1

const { compareByGTIN } = require('./lib/compare');
const db = require('./lib/db');

const LIMIT        = parseInt(process.env.CRAWL_LIMIT  || '100', 10);
const CONCURRENCY  = parseInt(process.env.CRAWL_CONCUR || '3',   10);
const DELAY_MS     = parseInt(process.env.CRAWL_DELAY  || '2000', 10);

function log(msg) {
    console.log(`[${new Date().toISOString()}] ${msg}`);
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function crawlGtin(gtin) {
    try {
        const { results } = await compareByGTIN(gtin);
        for (const r of results) {
            db.insertSnapshot(gtin, r.shop, r.dkkPrice, r.url);
        }
        return results.length;
    } catch (e) {
        log(`ERROR ${gtin}: ${e.message}`);
        return 0;
    }
}

async function runBatch(gtins) {
    let done = 0;
    for (let i = 0; i < gtins.length; i += CONCURRENCY) {
        const batch = gtins.slice(i, i + CONCURRENCY);
        const counts = await Promise.all(batch.map(g => crawlGtin(g)));
        done += counts.reduce((a, b) => a + b, 0);
        log(`Progress: ${Math.min(i + CONCURRENCY, gtins.length)}/${gtins.length} GTINs — ${done} price snapshots saved`);
        if (i + CONCURRENCY < gtins.length) await sleep(DELAY_MS);
    }
    return done;
}

async function main() {
    const rows = db.topGtins(LIMIT);

    if (rows.length === 0) {
        log('Ingen søgninger i databasen endnu — seed med GTINS env-variabel eller vent på brugersøgninger.');
        const seed = process.env.GTINS ? process.env.GTINS.split(',').map(s => s.trim()).filter(Boolean) : [];
        if (seed.length === 0) return;
        log(`Seeder med ${seed.length} manuelle GTINs`);
        for (const g of seed) db.logSearch(g, 'seed');
        rows.push(...seed.map(gtin => ({ gtin })));
    }

    const gtins = rows.map(r => r.gtin);
    log(`Starter crawl af ${gtins.length} GTINs (concurrency=${CONCURRENCY}, delay=${DELAY_MS}ms)`);

    const start = Date.now();
    const total = await runBatch(gtins);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    log(`Færdig: ${total} price snapshots på ${elapsed}s`);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
