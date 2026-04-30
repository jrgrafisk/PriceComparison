# Læringsopgave: Byg en prissammenligner som browser-extension

Denne opgave guider dig igennem at bygge et browser-extension der automatisk sammenligner priser på tværs af cykelbutikker. Du bygger det op lag for lag, præcis som PedalPricer er bygget.

---

## Hvad systemet gør

Når du besøger en produktside på f.eks. Cykelgear.dk:
1. Extensionen finder produktets GTIN (stregkode/EAN-nummer)
2. Søger det samme produkt på 10+ andre butikkers hjemmesider
3. Viser en prisoversigt direkte på siden — uden at du forlader siden

---

## Arkitektur-overblik

```
[Produktside i browseren]
        │
        ▼
  content.js          ← kører på siden, finder GTIN, indsætter prisoversigt
        │  browser.runtime.sendMessage("fetchUrl")
        ▼
  background.js       ← henter HTML fra andre butikker (omgår CORS)
        │  returnerer rå HTML
        ▼
  content.js          ← parser prisen ud af HTML'en
        │
        ▼
  [Prisoversigt i DOM]
```

**Nøglepointe:** Content scripts må ikke hente URLs fra andre domæner (CORS). Det er derfor background-scriptet fungerer som proxy — det kører uden CORS-begrænsninger.

---

## Trin 1: Manifest og struktur

Start med `manifest.json`. Det er "passet" for dit extension.

```json
{
    "manifest_version": 2,
    "name": "PrisComparer",
    "version": "1.0",
    "permissions": ["storage", "tabs", "<all_urls>"],
    "background": { "scripts": ["config.js", "background.js"] },
    "content_scripts": [{
        "matches": ["<all_urls>"],
        "js": ["config.js", "content.js"],
        "run_at": "document_idle"
    }],
    "browser_action": {
        "default_popup": "popup.html"
    }
}
```

**Opgave 1.1:** Opret mappestrukturen:
```
min-extension/
  manifest.json
  config.js
  background.js
  content.js
  popup.html
  popup.js
```

**Opgave 1.2:** Svar på disse spørgsmål uden at kigge:
- Hvorfor skal `config.js` stå i BÅDE `background.scripts` og `content_scripts.js`?
- Hvad betyder `"run_at": "document_idle"`?
- Hvad er forskellen på `manifest_version: 2` og `3`?

---

## Trin 2: Konfiguration — butik-definitioner

`config.js` definerer alle butikkerne. Det er data, ikke logik.

```js
const EXCHANGE_RATES = {
    EUR_TO_DKK: 7.45,
};

const SHOPS = [
    {
        name: "Bike24",
        domain: "bike24.com",
        url: "https://www.bike24.com/search-result?searchTerm=",
        priceSelector: ".text-xl.leading-none, [itemprop='price']",
        defaultCurrency: "EUR",
        gtinSelectors: [
            { type: "application/ld+json", paths: ["gtin", "gtin13"] }
        ],
        tablePosition: ".product-availability__title"
    },
    // ... flere butikker
];
```

**Opgave 2.1:** Tilføj en ny butik til `SHOPS`. Du skal bruge dit browsers DevTools til at:
1. Åbn en produktside i den ønskede butik
2. Højreklik på prisen → "Inspicér"
3. Find en CSS-selector der unikt identificerer priselementet
4. Søg i page source efter EAN/GTIN — typisk i `<script type="application/ld+json">` eller som `itemprop`

**Opgave 2.2:** Hvad sker der hvis `priceSelector` matcher 0 elementer? Hvad sker der hvis den matcher 3?

---

## Trin 3: Background script — HTTP-proxy

Background-scriptet er simpelt. Det eneste det gør er at hente URLs for content.js.

```js
function isSafeShopUrl(url) {
    try {
        const { protocol, hostname } = new URL(url);
        if (protocol !== 'https:') return false;
        return SHOPS.some(shop => hostname.endsWith(shop.domain));
    } catch { return false; }
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'fetchUrl') {
        if (!isSafeShopUrl(message.url)) {
            sendResponse({ html: null });
            return true;
        }
        fetch(message.url, {
            headers: { 'Accept-Language': 'da-DK,da;q=0.9' },
            signal: AbortSignal.timeout(10000)
        })
            .then(r => r.text())
            .then(html => sendResponse({ html, url: message.url }))
            .catch(() => sendResponse({ html: null, url: message.url }));
        return true; // ← VIGTIGT: betyder "svar kommer asynkront"
    }
});
```

**Opgave 3.1:** Hvorfor returnerer vi `true` i onMessage-listeneren?

**Opgave 3.2:** Hvad er sikkerhedsrisikoen ved at lade content.js sende en vilkårlig URL til background? Hvad gør `isSafeShopUrl()` for at beskytte mod det?

**Opgave 3.3:** Implementer `isSafeShopUrl()` selv, fra bunden, uden at kigge på koden ovenfor.

---

## Trin 4: GTIN-detektion

GTIN (Global Trade Item Number) er produktets "fingeraftryk" — det er det der lader os finde det samme produkt på tværs af butikker.

### Metode A: JSON-LD structured data
```js
function findGTINFromJSONLD() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
        try {
            const json = JSON.parse(script.textContent);
            const gtin = json.gtin13 || json.gtin || json.gtin8;
            if (gtin && /^\d{8,14}$/.test(gtin)) return gtin;
        } catch {}
    }
    return null;
}
```

### Metode B: CSS-selectors (shop-specifik)
```js
function findGTINFromShopSelectors(shop) {
    for (const selector of (shop.gtinSelectors || [])) {
        if (typeof selector === 'string') {
            const el = document.querySelector(selector);
            if (el) {
                const text = el.textContent || el.getAttribute('content') || '';
                const match = text.match(/\d{8,14}/);
                if (match) return match[0];
            }
        }
    }
    return null;
}
```

### Validering
```js
function validateGTIN(gtin) {
    if (!/^\d{8,14}$/.test(gtin)) return false;
    // Luhn-lignende checksum (forenklet)
    const digits = gtin.padStart(14, '0').split('').map(Number);
    let sum = 0;
    digits.forEach((d, i) => { sum += i % 2 === 0 ? d * 3 : d; });
    return sum % 10 === 0;
}
```

**Opgave 4.1:** Åbn en produktside fra en cykelbutik. Brug DevTools → Sources → Søg i page source efter `gtin` eller `ean`. Find GTIN'en manuelt.

**Opgave 4.2:** Mange sider gemmer GTIN som `gtin13` i JSON-LD men andre bruger bare `identifier`. Udvid `findGTINFromJSONLD()` til at søge i en liste af felter i stedet for hardcodede navne.

**Opgave 4.3 (svær):** Implementer GTIN-13 checksum-validering. GTIN-13 checksummen beregnes med vægtene 1 og 3 på skift fra højre mod venstre (eksklusive det sidste ciffer).

---

## Trin 5: Pris-parsing

Priser på nettet er rod: `"1.299,00 kr"`, `"€ 149.99"`, `"DKK1.499"`. Du skal rydde op.

```js
function parsePrice(html, shop) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Forsøg 1: CSS selector
    const el = doc.querySelector(shop.priceSelector);
    if (el) {
        const text = el.textContent || el.getAttribute('content') || '';
        return normalizePrice(text, shop.defaultCurrency);
    }

    // Forsøg 2: JSON-LD i search-result-siden
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
        try {
            const json = JSON.parse(script.textContent);
            if (json.offers?.price) return parseFloat(json.offers.price);
        } catch {}
    }

    return null;
}

function normalizePrice(text, defaultCurrency) {
    // Fjern valutasymboler og mellemrum
    let clean = text.replace(/[^\d.,]/g, '');
    // Håndter europæisk format: 1.299,00 → 1299.00
    if (/\d+\.\d{3},\d{2}/.test(clean)) {
        clean = clean.replace('.', '').replace(',', '.');
    } else {
        clean = clean.replace(',', '');
    }
    return parseFloat(clean) || null;
}
```

**Opgave 5.1:** Hvad returnerer `normalizePrice("1.299,00 kr", "DKK")`? Regn det igennem i dit hoved.

**Opgave 5.2:** Ovenstående kode håndterer ikke `"€ 1,499.00"` (engelsk format). Tilpas `normalizePrice()` til at detektere formatet automatisk.

**Opgave 5.3 (svær):** Nogle shops returnerer prisen i Next.js `__NEXT_DATA__`-objektet i stedet for som HTML. Skriv en funktion `extractNextDataPrice(html, shop)` der finder `<script id="__NEXT_DATA__">`, parser JSON'en, og traverserer en sti som `"props.pageProps.product.price.regular.value"`.

---

## Trin 6: Parallel søgning

I stedet for at søge i butikkerne en ad gangen, søg i dem alle på én gang med `Promise.all`.

```js
async function searchAllShops(gtin) {
    const activeShops = SHOPS.filter(shop => !isCurrentSite(shop));

    const promises = activeShops.map(async shop => {
        const searchUrl = shop.url + encodeURIComponent(gtin);
        try {
            const response = await browser.runtime.sendMessage({
                action: 'fetchUrl',
                url: searchUrl
            });
            if (!response.html) return null;
            const price = parsePrice(response.html, shop);
            return price ? { shop: shop.name, price, url: searchUrl } : null;
        } catch {
            return null;
        }
    });

    const results = await Promise.all(promises);
    return results.filter(Boolean);
}
```

**Opgave 6.1:** Hvad er fordelen ved `Promise.all` frem for at awaite dem én ad gangen?

**Opgave 6.2:** Hvad sker der hvis 1 butik tager 15 sekunder at svare? Modificer koden så en enkelt langsom butik ikke bremser hele resultatlisten — vis resultater efterhånden som de kommer ind.

**Hint:** I stedet for `Promise.all`, brug en kombination af `Promise.race` eller send resultater til en callback:
```js
async function searchAllShops(gtin, onResult) {
    const promises = activeShops.map(async shop => {
        const result = await fetchShop(shop, gtin);
        if (result) onResult(result); // ← kald callback med det samme
    });
    await Promise.all(promises);
}
```

---

## Trin 7: Indsæt resultaterne i DOM'en

Nu har du priser — de skal vises på siden.

```js
function insertPriceTable(results, anchorSelector) {
    // Find eksisterende tabel eller opret ny
    let table = document.getElementById('pp-price-table');
    if (!table) {
        table = document.createElement('div');
        table.id = 'pp-price-table';
        table.style.cssText = `
            border: 1px solid #ddd;
            border-radius: 8px;
            padding: 12px;
            margin: 16px 0;
            font-family: sans-serif;
        `;
        const anchor = document.querySelector(anchorSelector);
        anchor?.parentNode?.insertBefore(table, anchor);
    }

    // Sorter efter pris
    results.sort((a, b) => a.price - b.price);

    table.innerHTML = `
        <strong>Prissammenligning</strong>
        <table style="width:100%; border-collapse:collapse; margin-top:8px">
            ${results.map(r => `
                <tr>
                    <td>${r.shop}</td>
                    <td style="text-align:right; font-weight:bold">
                        ${r.price.toFixed(2)} DKK
                    </td>
                </tr>
            `).join('')}
        </table>
    `;
}
```

**Opgave 7.1:** Ovenstående kode bruger `innerHTML` med data fra eksterne hjemmesider. Hvilken sikkerhedsrisiko er der? Hvordan fikser du det?

**Hint:** En pris fra en ondsindet hjemmeside kunne indeholde `<script>alert('XSS')</script>`.

**Opgave 7.2:** Implementer tabellen uden `innerHTML` — brug udelukkende `document.createElement`, `textContent` og `appendChild`.

---

## Trin 8: Tilkobling og SPA-navigation

Moderne webshops er ofte Single Page Applications (SPAs). Når du navigerer fra produkt til produkt, genindlæses siden ikke — content.js kører kun én gang.

```js
// Lyt efter URL-ændringer (SPA)
let lastUrl = location.href;
const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
        lastUrl = location.href;
        // Fjern gammel prisoversigt
        document.getElementById('pp-price-table')?.remove();
        // Start ny søgning
        findAndComparePrice();
    }
});
observer.observe(document.body, { childList: true, subtree: true });

// Start ved første indlæsning
findAndComparePrice();
```

**Opgave 8.1:** Hvad er problemet hvis `findAndComparePrice()` kører to gange på samme side? (f.eks. fordi en MutationObserver udløses under din egen DOM-indsættelse)

**Opgave 8.2:** Implementer debouncing så `findAndComparePrice()` ikke kan køre oftere end hvert 500ms.

---

## Bonusopgaver

### B1: Valutaomregning
Priser fra tyske butikker er i EUR. Læg konvertering til DKK til i din `searchAllShops()`-funktion vha. `EXCHANGE_RATES` fra config.js.

### B2: Popup
Lav en `popup.html` der viser hvilke butikker der er aktive, og lader brugeren slå dem til/fra med checkboxes. Gem indstillingerne med `browser.storage.sync`.

### B3: Badge
Vis antallet af fundne billigere priser som et tal på extension-ikonet:
```js
browser.runtime.sendMessage({
    action: 'setBadge',
    count: results.filter(r => r.price < currentPrice).length
});
```
Tilføj en handler for `setBadge` i `background.js` der bruger `browser.browserAction.setBadgeText()`.

### B4: Mobil-version
Firefox for Android understøtter extensions. Men mobilbrowseren har ingen browserAction-popup. Lav en FAB-knap (Floating Action Button) der vises på siden i stedet, og som udløser søgningen når man trykker.

---

## Opsummering: flowet fra start til slut

```
1. content.js injiceres på produktside
2. findGTIN() → JSON-LD → CSS selectors → URL-mønster
3. Ingen GTIN fundet? → afslut stille
4. searchAllShops(gtin) → sender fetchUrl til background.js for hver butik
5. background.js henter HTML → returnerer til content.js
6. parsePrice(html, shop) → normalizePrice() → konverter til DKK
7. Resultater akkumuleres → insertPriceTable() opdaterer DOM
8. setBadge(count) → viser antal billigere priser på ikonet
9. MutationObserver → gentag fra trin 2 ved URL-ændring
```

---

## Ressourcer

- [MDN: Browser Extensions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions)
- [MDN: content_scripts](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts)
- [MDN: runtime.sendMessage](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/sendMessage)
- [Schema.org Product](https://schema.org/Product) — standard for JSON-LD produktdata
- [GS1 GTIN info](https://www.gs1.org/standards/id-keys/gtin) — GTIN-format og checksum
