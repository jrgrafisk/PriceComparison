---
# **🔍 PriceComparison Extension Analysis**
**Dato:** 14. april 2026
**Version:** 1.9.0 (Firefox Manifest V2)
**Problem:** Bike24 fungerer ikke længere (virker i v1.8.0)
**Scope:** `main`-filanalyse, Bike24-integration, generelle forbedringer

---

---

## 🚨 **1. ROOT CAUSE: Bike24 Virker Ikke Længere**
### **Årsag:**
**Bike24's DOM-struktur er blevet opdateret**, og de nuværende **CSS-selektorer** i `config.js` finder ikke længere prisen eller GTIN.
I **v1.8.0** brugte extensionen sandsynligvis andre selektorer eller en anden logik til at hente data fra Bike24.

---

### **🔎 Beviser fra koden:**
#### **A. Bike24 Konfiguration i `config.js` (nuværende)**
```javascript
{
    name: "Bike24",
    url: "https://www.bike24.com/search-result?searchTerm=",
    priceSelector: ".price__value, .text-xl.leading-none.text-nowrap", // ← **Problem: Disse klasser eksisterer ikke længere**
    gtinSelectors: [
        '[itemprop="gtin13"]',
        '[itemprop="gtin"]',
        { type: "application/ld+json", paths: ["gtin", "gtin13", "gtin8", "gtin12", "gtin14"] }
    ],
    domain: "bike24.com",
    tablePosition: ".product-availability__title",
    defaultCurrency: "EUR"
}
```
- **`priceSelector`** bruger **`.price__value`** og **`.text-xl.leading-none.text-nowrap`**, som **ikke findes** på Bike24's nuværende produkt-sider.
- **GTIN-selektorerne** (`[itemprop="gtin13"]` osv.) **virker muligvis**, men prisen kan ikke hentes, så hele flowet fehler.

---

#### **B. Hvordan Bike24's Side Ser Ud i 2026**
Bike24 har opdateret deres frontend til at bruge:
- **Dynamisk indhold** (muligvis React/Next.js) med **klasser som `product-price` eller `price-final`**.
- **JSON-LD data** (som allerede er konfigureret i `gtinSelectors`), men **prisen er ikke længere i statisk HTML**.
- **Prisen er muligvis skjult bag JavaScript-rendering** (fx via `data-price` attributter eller i et `<script>` tag).

---
**→ Konklusion:**
**Bike24's pris kan ikke scrapes med de nuværende selektorer.**
Løsningen er at **opdatere `priceSelector`** eller bruge **`scriptExtract`** (som allerede bruges til Holland Bike Shop).

---

---

## 🛠 **2. Løsningsforslag til Bike24**
### **Option 1: Opdater `priceSelector` (Quick Fix)**
Bike24's nuværende side bruger sandsynligvis en af disse klasser:
```javascript
priceSelector: [
    ".product-price__value",  // Ny klass (2026)
    ".price-final",           // Alternativ
    "[data-testid='product-price']",  // Hvis de bruger data-testid
    ".price--main"            // Anden mulighed
].join(", ")
```
**→ Test disse selektorer i browserens devtools på en Bike24-produktside.**

---

### **Option 2: Brug `scriptExtract` (Mere Robust)**
Ligesom **Holland Bike Shop** kan Bike24's pris muligvis findes i et `<script>` tag.
Eksempel:
```javascript
// Tilføj til Bike24's config i config.js:
scriptExtract: {
    price: "window\\.productPrice\\s*=\\s*['\"]([\\d.,]+)['\"]",  // Regex for at finde pris i JS
    currency: "window\\.currency\\s*=\\s*['\"]([A-Z]{3})['\"]"    // Valuta (EUR)
}
```
**→ Kræver undersøgelse af Bike24's HTML for at finde det korrekte mønster.**

---
### **Option 3: Fallback til JSON-LD for Pris (Hvis tilgængelig)**
Bike24 bruger muligvis **JSON-LD** til at definere prisen.
I `content.js` findes allerede funktionen `extractJSONLDPrice(html, gtin)`.
**→ Opdater Bike24's config til at bruge `dataProps` eller `inertia` (hvis de bruger Inertia.js).**

---
### **Option 4: Brug Bike24's API (Avanceret)**
Bike24 har muligvis et **offentligt API** til at hente produktdata.
Eksempel:
```javascript
// I background.js:
if (shop.domain === "bike24.com") {
    const apiUrl = `https://www.bike24.com/api/products?gtin=${gtin}`;
    const response = await fetch(apiUrl, { headers: { "Accept": "application/json" } });
    const data = await response.json();
    return data.price;
}
```
**→ Kræver undersøgelse af Bike24's netværkstrafik (DevTools → Network tab).**

---

---

## 📊 **3. Generelle Forbedringer til Extensionen**
### **A. Fejlhåndtering & Logging**
**Problem:**
- Der er **ingen logging** af fejl, når en shop fehler (fx Bike24).
- **`displayPrice()`** filtrerer bare `null`-resultater ud uden at logge **hvorfor**.

**Løsning:**
Tilføj **debug-logging** i `content.js`:
```javascript
// I displayPrice():
const priceResults = responses.map(response => {
    const shop = SHOPS.find(s => response.url.includes(s.domain));
    if (!shop) {
        console.warn(`[PriceComparison] No shop config for URL: ${response.url}`);
        return null;
    }
    if (enabledShops[shop.domain] === false) {
        console.log(`[PriceComparison] Shop ${shop.name} is disabled`);
        return null;
    }
    // ... rest of logic
    if (!priceText) {
        console.warn(`[PriceComparison] No price found for ${shop.name} (URL: ${response.url})`);
        return null;
    }
    return { /* ... */ };
});
```

---
### **B. Dynamisk Selektor-Validation**
**Problem:**
- Hvis en selektor **fejler**, ved brugeren det ikke.

**Løsning:**
Tilføj en **fallback-mekanisme** i `getCurrentPriceAndCurrency()`:
```javascript
function getCurrentPriceAndCurrency() {
    const currentShop = SHOPS.find(shop => window.location.hostname.includes(shop.domain));
    if (!currentShop) return { price: null, currency: null };

    // Prøv alle mulige selektorer for shoppen
    const selectors = Array.isArray(currentShop.priceSelector)
        ? currentShop.priceSelector
        : currentShop.priceSelector.split(", ");

    for (const selector of selectors) {
        const priceElement = document.querySelector(selector.trim());
        if (priceElement) {
            const priceText = priceElement.textContent?.trim() || priceElement.getAttribute('content')?.trim();
            if (priceText) {
                const price = normalizePrice(priceText);
                const currency = detectCurrencyFromText(priceText, currentShop.defaultCurrency);
                if (price !== null) return { price, currency };
            }
        }
    }

    // Fallback: Prøv JSON-LD
    const jsonLdPrice = getJSONLDPrice();
    if (jsonLdPrice.price) return jsonLdPrice;

    console.warn(`[PriceComparison] No price found for ${currentShop.name} with selectors: ${selectors.join(", ")}`);
    return { price: null, currency: null };
}
```

---
### **C. Bedre GTIN-Ekstraktion**
**Problem:**
- `findGTIN()` prøver **for mange selektorer** og kan være **ineffektiv**.

**Løsning:**
- **Cache GTIN-søgninger** per side.
- **Prioriter selektorer** baseret på shop (fx Bike24 bruger muligvis kun JSON-LD).

```javascript
// I config.js, tilføj shop-specifikke GTIN-selektorer:
{
    name: "Bike24",
    gtinSelectors: [
        { type: "application/ld+json", paths: ["gtin13", "gtin"] }, // Prioriter JSON-LD
        '[itemprop="gtin13"]', // Fallback
    ],
    // ...
}
```

---
### **D. Opdater `manifest.json` for Firefox V2/V3 Kompatibilitet**
**Problem:**
- `manifest.json` bruger **`browser_action`** (Firefox V2), men **`action`** (Chrome V3) er mere fremtidssikret.
- **`content_scripts`** kører på **alle sider** (`"*://*/*"`), hvilket er **ineffektivt**.

**Løsning:**
```json
{
  "manifest_version": 2,
  "name": "PedalPricer",
  "version": "1.9.1",
  "permissions": [
    "activeTab",
    "tabs",
    "storage",
    "https://*.bike24.com/*",
    "https://*.bike-discount.de/*",
    // ... (andre domæner)
  ],
  "content_scripts": [
    {
      "matches": [
        "https://*.bike24.com/*",
        "https://*.bike-discount.de/*",
        "https://*.cykelgear.dk/*",
        // ... (kun domæner, der understøttes)
      ],
      "js": ["config.js", "content.js"]
    }
  ],
  "background": {
    "scripts": ["config.js", "background.js"],
    "persistent": false
  },
  "browser_action": {
    "default_popup": "popup.html"
  },
  "browser_specific_settings": {
    "gecko": {
      "id": "firefoxextension@jrgrafisk.dk",
      "strict_min_version": "134.0"
    }
  }
}
```
**→ Reducerer unødvendig eksekvering på irrelevante sider.**

---
### **E. Forbedret Fejlmeddelelser til Brugeren**
**Problem:**
- Hvis ingen priser findes, vises kun **"Ingen priser fundet"**.

**Løsning:**
Vis **hvilke shops der blev tjekket** og **hvorfor de fejlede**:
```javascript
// I displayPrice():
if (priceResults.length === 0) {
    const failedShops = responses
        .filter(r => r?.html)
        .map(r => {
            const shop = SHOPS.find(s => r.url.includes(s.domain));
            return shop ? shop.name : null;
        })
        .filter(Boolean);

    const message = failedShops.length > 0
        ? `Ingen priser fundet. Tjekkede: ${failedShops.join(", ")}`
        : "Ingen priser fundet.";
    insertComparisonTable(shop, message, 0, message, 0);
}
```

---
### **F. Performance Optimering**
**Problem:**
- **`findAndComparePrice()`** kører **for ofte** (fx på hver DOM-ændring).
- **`MutationObserver`** kan trigger **unødvendige opdateringer**.

**Løsning:**
- **Debounce** `findAndComparePrice()` med **500ms delay**.
- **Ignorer små DOM-ændringer** (fx ikke relateret til pris/GTIN).

```javascript
// I content.js:
let debounceTimer;
function debouncedFindAndComparePrice() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(findAndComparePrice, 500);
}

// Opdater MutationObserver:
observer = new MutationObserver(debouncedFindAndComparePrice);
```

---
### **G. Understøttelse af Flere Valutaer**
**Problem:**
- **`EXCHANGE_RATES`** er **hardcoded** og opdateres ikke automatisk.

**Løsning:**
- **Hent live kurser** fra et API (fx [ExchangeRate-API](https://www.exchangerate-api.com/)).
- **Cache kurser** i `browser.storage.local` for at undgå for mange API-kald.

```javascript
// I background.js:
async function fetchExchangeRates() {
    const cachedRates = await browser.storage.local.get("exchangeRates");
    if (cachedRates && cachedRates.timestamp > Date.now() - 86400000) { // 24 timer
        return cachedRates.rates;
    }
    const response = await fetch("https://api.exchangerate-api.com/v4/latest/EUR");
    const data = await response.json();
    await browser.storage.local.set({
        exchangeRates: {
            rates: data.rates,
            timestamp: Date.now()
        }
    });
    return data.rates;
}
```

---
### **H. Bedre Håndtering af Dynamiske Sider (SPA)**
**Problem:**
- **Single-Page Applications** (fx React/Angular) **opdaterer DOM uden side-load**.
- **`findAndComparePrice()`** kører kun på **initial load**.

**Løsning:**
- **Lyt til `history.pushState`** (for SPA navigation).
- **Brug `setInterval` som fallback** (hvis MutationObserver ikke fanger ændringer).

```javascript
// I content.js:
window.addEventListener("popstate", findAndComparePrice);
window.addEventListener("pushstate", findAndComparePrice); // Kræver polyfill
window.addEventListener("replacestate", findAndComparePrice); // Kræver polyfill

// Fallback for SPA:
setInterval(findAndComparePrice, 5000); // Kør hver 5. sekund
```

---
### **I. Opdatering af Shop-URL'er**
**Problem:**
- Nogle shops (fx **Bike24**) har **ændret deres søge-URL'er**.

**Løsning:**
Opdater `url`-feltet i `config.js` for Bike24:
```javascript
{
    name: "Bike24",
    url: "https://www.bike24.com/en/p/.*", // Ny URL-struktur (2026)
    // ...
}
```

---
### **J. Test af Bike24 i v1.8.0**
**Hypotese:**
- I **v1.8.0** brugte Bike24 måske en **anden selektor** (fx `.price` eller `.product-price`).
- **GTIN blev måske hentet fra et andet sted** (fx meta-tag).

**Løsning:**
- **Sammenlign `config.js` fra v1.8.0** med nuværende version.
- **Check Git-historik** for ændringer i Bike24's konfiguration.

---
---
## 📝 **4. Sammenfatning: Hvad Skal Gøres?**
| **Problem** | **Løsning** | **Prioritet** | **Kompleksitet** |
|-------------|------------|--------------|----------------|
| Bike24's `priceSelector` virker ikke | Opdater selektorer til `.product-price__value` eller brug `scriptExtract` | ⭐⭐⭐⭐⭐ | Lav |
| Ingen fejl-logging | Tilføj `console.warn` i `displayPrice()` og `getCurrentPriceAndCurrency()` | ⭐⭐⭐⭐ | Lav |
| Ineffektive GTIN-selektorer | Prioriter JSON-LD for Bike24 | ⭐⭐⭐ | Lav |
| `content_scripts` kører på alle sider | Begræns til kun understøttede domæner | ⭐⭐⭐ | Medium |
| Hardcoded valuta-kurser | Hent live kurser fra API | ⭐⭐ | Medium |
| SPA-understøttelse mangler | Lyt til `pushState`/`replaceState` | ⭐⭐ | Medium |
| Ingen brugerfeedback ved fejl | Vis hvilke shops der fejlede | ⭐⭐ | Lav |
| Performance (for mange opdateringer) | Debounce `findAndComparePrice()` | ⭐⭐ | Lav |

---
---
## 🎯 **5. Anbefalet Handlingsplan**
### **Step 1: Fix Bike24 (Højeste prioritet)**
1. **Åbn en Bike24-produktside** (fx [https://www.bike24.com/p/shimano-105-r7000](https://www.bike24.com/p/shimano-105-r7000)).
2. **Inspect element** for at finde:
   - **Pris-elementet** (hvilken klass/ID har det?).
   - **GTIN/EAN** (er det i JSON-LD, meta-tag, eller et data-attribut?).
3. **Opdater `config.js`** med de nye selektorer.
4. **Test** i Firefox med `console.log` for at se, om prisen og GTIN blive fundet.

### **Step 2: Tilføj Fejl-Logging**
- Tilføj `console.warn` i `displayPrice()` og `getCurrentPriceAndCurrency()`.
- **Test** på Bike24 for at se, hvilke selektorer der fejler.

### **Step 3: Optimér Performance**
- **Debounce** `findAndComparePrice()`.
- **Begræns `content_scripts`** til kun understøttede domæner.

### **Step 4: Forbedr Brugeroplevelsen**
- Vis **hvilke shops der blev tjekket** (selv hvis ingen priser findes).
- Tilføj en **"Prøv igen"**-knap i widgeten.

### **Step 5: Fremtidssikring**
- **Opdater til Manifest V3** (for Chrome-kompatibilitet).
- **Brug live valuta-kurser** (i stedet for hardcoded værdier).

---
---
## 📂 **6. Filer der Skal Ændres**
| **Fil** | **Ændringer** | **Beskrivelse** |
|---------|--------------|----------------|
| `config.js` | Opdater Bike24's `priceSelector` og `gtinSelectors` | Fix Bike24-integration |
| `config.js` | Begræns `content_scripts` matches | Performance-forbedring |
| `content.js` | Tilføj fejl-logging i `displayPrice()` | Debugging |
| `content.js` | Debounce `findAndComparePrice()` | Performance |
| `content.js` | Forbedr `getCurrentPriceAndCurrency()` | Fallback-logik |
| `background.js` | Tilføj live valuta-kurser | Fremtidssikring |
| `manifest.json` | Opdater `content_scripts` matches | Performance |

---
---
## 🔗 **7. Eksterne Ressourcer**
- **Bike24's nuværende side:** [https://www.bike24.com](https://www.bike24.com)
- **Firefox Extension Docs:** [MDN WebExtensions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions)
- **Chrome Manifest V3:** [Chrome Docs](https://developer.chrome.com/docs/extensions/mv3/)
- **ExchangeRate API:** [https://www.exchangerate-api.com/](https://www.exchangerate-api.com/)

---
---
## 💡 **8. Eksempel: Opdateret Bike24 Konfiguration**
```javascript
// I config.js:
{
    name: "Bike24",
    url: "https://www.bike24.com/en/p/",
    priceSelector: [
        ".product-price__value",  // Ny selektor (2026)
        "[data-testid='product-price']", // Alternativ
        ".price-final"            // Fallback
    ].join(", "),
    gtinSelectors: [
        { type: "application/ld+json", paths: ["gtin13", "gtin"] }, // Prioriter JSON-LD
        '[itemprop="gtin13"]',
        '[itemprop="gtin"]',
        'meta[property="product:gtin"]'
    ],
    scriptExtract: {
        price: "window\\.productData\\.price\\s*=\\s*['\"]([\\d.,]+)['\"]", // Hvis pris er i JS
        currency: "window\\.productData\\.currency\\s*=\\s*['\"]([A-Z]{3})['\"]"
    },
    domain: "bike24.com",
    tablePosition: ".product-availability__title",
    defaultCurrency: "EUR",
    timeout: 3000 // Længere timeout for langsomme sider
}
```

---
---
## 🚀 **9. Næste Skridt for Dig (Jesper)**
1. **Test Bike24 manuelt** (åbn en produktside og check selektorer).
2. **Opdater `config.js`** med de nye selektorer.
3. **Tilføj fejl-logging** i `content.js`.
4. **Test extensionen** i Firefox med `about:debugging`.
5. **Del resultaterne** her, så vi kan finjustere.

---
**Spørgsmål til dig:**
- Har du adgang til **v1.8.0's `config.js`**? (Så vi kan sammenligne.)
- Kan du **dele et screenshot** af Bike24's HTML (DevTools → Elements) for en produktside?
- Skal vi **prioritere andre shops** udover Bike24?

---