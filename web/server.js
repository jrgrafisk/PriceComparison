const express = require('express');
const path = require('path');
const { compareByGTIN } = require('./lib/compare');
const { extractGTINFromURL } = require('./lib/gtinExtract');

const app = express();
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Support + privacy page — also reachable at /support+privacy (add-on store link format)
const supportPage = path.join(__dirname, 'public', 'support.html');
app.get('/support', (req, res) => res.sendFile(supportPage));
app.get('/support+privacy', (req, res) => res.sendFile(supportPage));
app.get('/privacy', (req, res) => res.sendFile(supportPage));

// Simple in-memory rate limiter — 20 requests per minute per IP
const rateLimiter = new Map();
const RATE_LIMIT = 20;
const RATE_WINDOW = 60_000;

setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of rateLimiter) {
        if (now > entry.resetAt) rateLimiter.delete(ip);
    }
}, 5 * 60_000);

function rateLimit(req, res, next) {
    const ip = req.ip;
    const now = Date.now();
    const entry = rateLimiter.get(ip) || { count: 0, resetAt: now + RATE_WINDOW };
    if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + RATE_WINDOW; }
    entry.count++;
    rateLimiter.set(ip, entry);
    if (entry.count > RATE_LIMIT) {
        return res.status(429).json({ error: 'For mange anmodninger. Prøv igen om lidt.' });
    }
    next();
}

app.post('/api/compare', rateLimit, async (req, res) => {
    try {
        const { input } = req.body;
        if (!input || !input.trim()) {
            return res.status(400).json({ error: 'Indsæt en produkt-URL eller stregkode.' });
        }

        let gtin = input.trim();

        if (gtin.startsWith('http')) {
            gtin = await extractGTINFromURL(gtin);
            if (!gtin) {
                return res.status(404).json({ error: 'Kunne ikke finde en stregkode på den side. Prøv at indsætte EAN/GTIN direkte.' });
            }
        }

        if (!/^\d{8,14}$/.test(gtin)) {
            return res.status(400).json({ error: 'Ugyldigt format. Indsæt en gyldig EAN/GTIN (8–14 cifre) eller en produkt-URL.' });
        }

        const { results, shopStatus } = await compareByGTIN(gtin);
        res.json({ gtin, results, shopStatus });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Der opstod en fejl. Prøv igen.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PedalPricer kører på port ${PORT}`));
