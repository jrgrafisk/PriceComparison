# Security Headers — TODO

Mozilla Observatory audit fejl:

## 1. HSTS (-20 points)
Tilføj i `web/server.js` efter Referrer-Policy:
```js
res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
```

## 2. CSP unsafe-inline i script-src (-20 points)
- Fjern `'unsafe-inline'` fra script-src i `web/server.js`
- Flyt begge inline `<script>`-blokke fra `index.html` til bunden af `web/public/js/app.js`
- Flyt `<script src="/js/app.js">` til allersidst i `<body>` (efter consent-banner HTML)
- **Bonus-fix:** Fjern den statiske Umami `<script defer>` fra `<head>` — den loader analytics uden samtykke (bug)

## 3. SRI mangler på Umami script (-5 points)
Beregn hash under implementering:
```bash
curl -s https://analytics.jrgrafisk.dk/script.js | openssl dgst -sha384 -binary | openssl base64 -A
```
Prefix med `sha384-` og tilføj til det dynamisk oprettede script-element i consent-koden:
```js
s.integrity = 'sha384-<HASH>';
s.crossOrigin = 'anonymous';
```

## OBS
SRI-hash skal opdateres hvis Umami opdateres på analytics.jrgrafisk.dk.
