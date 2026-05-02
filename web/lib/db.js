const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'prices.db');

fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
    CREATE TABLE IF NOT EXISTS searches (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        gtin      TEXT    NOT NULL,
        source    TEXT    NOT NULL DEFAULT 'web',
        ts        INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_searches_gtin ON searches(gtin);
    CREATE INDEX IF NOT EXISTS idx_searches_ts   ON searches(ts);

    CREATE TABLE IF NOT EXISTS products (
        gtin        TEXT PRIMARY KEY,
        name        TEXT,
        updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS price_history (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        gtin       TEXT    NOT NULL,
        shop       TEXT    NOT NULL,
        price_dkk  INTEGER NOT NULL,
        url        TEXT,
        crawled_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_ph_gtin       ON price_history(gtin);
    CREATE INDEX IF NOT EXISTS idx_ph_crawled_at ON price_history(crawled_at);
`);

const stmts = {
    logSearch: db.prepare(
        `INSERT INTO searches (gtin, source) VALUES (?, ?)`
    ),

    topGtins: db.prepare(`
        SELECT gtin, COUNT(*) AS cnt
        FROM searches
        WHERE ts > unixepoch('now', '-30 days')
        GROUP BY gtin
        ORDER BY cnt DESC
        LIMIT ?
    `),

    upsertProduct: db.prepare(`
        INSERT INTO products (gtin, name, updated_at)
        VALUES (?, ?, unixepoch())
        ON CONFLICT(gtin) DO UPDATE SET
            name       = excluded.name,
            updated_at = excluded.updated_at
        WHERE excluded.name IS NOT NULL
    `),

    insertSnapshot: db.prepare(`
        INSERT INTO price_history (gtin, shop, price_dkk, url)
        VALUES (?, ?, ?, ?)
    `),

    priceHistory: db.prepare(`
        SELECT shop, price_dkk, crawled_at
        FROM price_history
        WHERE gtin = ?
        ORDER BY crawled_at DESC
        LIMIT 500
    `),

    latestPrices: db.prepare(`
        SELECT ph.shop, ph.price_dkk, ph.crawled_at
        FROM price_history ph
        INNER JOIN (
            SELECT shop, MAX(crawled_at) AS latest
            FROM price_history
            WHERE gtin = ?
            GROUP BY shop
        ) latest ON ph.shop = latest.shop AND ph.crawled_at = latest.latest
        WHERE ph.gtin = ?
        ORDER BY ph.price_dkk ASC
    `),
};

function logSearch(gtin, source = 'web') {
    stmts.logSearch.run(gtin, source);
}

function topGtins(limit = 100) {
    return stmts.topGtins.all(limit);
}

function upsertProduct(gtin, name) {
    stmts.upsertProduct.run(gtin, name ?? null);
}

function insertSnapshot(gtin, shop, price_dkk, url) {
    stmts.insertSnapshot.run(gtin, shop, price_dkk, url ?? null);
}

function priceHistory(gtin) {
    return stmts.priceHistory.all(gtin);
}

function latestPrices(gtin) {
    return stmts.latestPrices.all(gtin, gtin);
}

module.exports = { logSearch, topGtins, upsertProduct, insertSnapshot, priceHistory, latestPrices };
