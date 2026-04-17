// =============================================
// Bike24 Test Configuration
// Formål: Teste forskellige konfigurationer for at finde ud af, hvilken der virker for Bike24.
// Instruktioner:
// 1. Kopier én af konfigurationerne nedenfor ind i din `config.js` (erstatt Bike24's nuværende config).
// 2. Test på en Bike24-produktside (fx: https://www.bike24.com/p/shimano-105-r7000).
// 3. Åbn browser-konsollen (F12) for at se debug-output.
// =============================================

// --- DEBUG HJÆLPEFUNKTIONER (tilføj til content.js midlertidigt) ---
// Kopier dette ind i din content.js for at se, hvilke elementer der findes:
function testBike24Selectors() {
    console.log("=== Testing Bike24 Selectors ===");

    // Test alle mulige selektorer
    const selectorsToTest = [
        // v1.9.0 (nuværende, fehler)
        ".price__value",
        ".text-xl.leading-none.text-nowrap",

        // Typiske Bike24-klasser (2026)
        ".price",
        ".product-price",
        ".product-price__value",
        ".price-final",
        ".price--main",
        "[itemprop='price']",
        ".product-availability__price",
        ".pdp-price",

        // JSON-LD
        "script[type='application/ld+json']",

        // Meta-tags
        "meta[itemprop='price']",
        "meta[property='product:price']",

        // Data-attributter
        "[data-price]",
        "[data-testid='product-price']"
    ];

    selectorsToTest.forEach(selector => {
        const element = document.querySelector(selector);
        if (element) {
            console.log(`✅ FOUND: ${selector}`, {
                textContent: element.textContent?.trim(),
                outerHTML: element.outerHTML.substring(0, 200) + "..."
            });
        } else {
            console.log(`❌ NOT FOUND: ${selector}`);
        }
    });

    // Test JSON-LD
    const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
    jsonLdScripts.forEach((script, i) => {
        try {
            const data = JSON.parse(script.textContent);
            if (data.offers?.price) {
                console.log(`✅ JSON-LD (${i}): Price = ${data.offers.price} ${data.offers.priceCurrency || 'EUR'}`);
            }
            if (data.gtin13 || data.gtin) {
                console.log(`✅ JSON-LD (${i}): GTIN = ${data.gtin13 || data.gtin}`);
            }
        } catch (e) {
            console.log(`❌ JSON-LD (${i}): Invalid JSON`);
        }
    });
}

// Kald denne funktion på en Bike24-side for at se, hvad der findes:
// testBike24Selectors();

// =============================================
// KONFIGURATION 1: Original v1.9.0 (FEJLER)
// Beskrivelse: Den nuværende konfiguration, der ikke virker.
// Årsag: Tailwind-klasserne eksisterer ikke på Bike24.
// =============================================
const BIKE24_CONFIG_V1_9_0 = {
    name: "Bike24",
    url: "https://www.bike24.com/search-result?searchTerm=",
    priceSelector: ".price__value, .text-xl.leading-none.text-nowrap", // ❌ FEJLER
    gtinSelectors: [
        '[itemprop="gtin13"]',
        '[itemprop="gtin"]',
        { type: "application/ld+json", paths: ["gtin", "gtin13", "gtin8", "gtin12", "gtin14"] }
    ],
    domain: "bike24.com",
    tablePosition: ".product-availability__title",
    defaultCurrency: "EUR"
};

// =============================================
// KONFIGURATION 2: v1.8.0-lignende (FALLBACK TIL JSON-LD)
// Beskrivelse: Fjern priceSelector, så den falder tilbage til JSON-LD.
// Forventet resultat: ✅ Burde virke, hvis Bike24 bruger JSON-LD.
// =============================================
const BIKE24_CONFIG_V1_8_0_STYLE = {
    name: "Bike24",
    url: "https://www.bike24.com/search-result?searchTerm=",
    // priceSelector: FJERNET - falder tilbage til JSON-LD
    gtinSelectors: [
        { type: "application/ld+json", paths: ["gtin", "gtin13", "gtin8", "gtin12", "gtin14"] },
        '[itemprop="gtin13"]',
        '[itemprop="gtin"]'
    ],
    domain: "bike24.com",
    tablePosition: ".product-availability__title",
    defaultCurrency: "EUR"
};

// =============================================
// KONFIGURATION 3: Opdaterede CSS-selektorer (2026)
// Beskrivelse: Prøv typiske Bike24-klasser.
// Forventet resultat: ✅ Burde virke, hvis Bike24 bruger standard CSS.
// =============================================
const BIKE24_CONFIG_UPDATED_SELECTORS = {
    name: "Bike24",
    url: "https://www.bike24.com/search-result?searchTerm=",
    priceSelector: [
        ".price",                          // Standard pris-klass
        ".product-price",                 // Typisk for e-commerce
        ".product-price__value",          // Bike24-specifik?
        "[itemprop='price']",             // Schema.org
        ".pdp-price",                     // Produktdetail-side
        ".price-final"                    // Final pris (uden rabatter)
    ].join(", "),
    gtinSelectors: [
        { type: "application/ld+json", paths: ["gtin", "gtin13", "gtin8", "gtin12", "gtin14"] },
        '[itemprop="gtin13"]',
        '[itemprop="gtin"]',
        'meta[itemprop="gtin13"]'
    ],
    domain: "bike24.com",
    tablePosition: ".product-availability__title",
    defaultCurrency: "EUR"
};

// =============================================
// KONFIGURATION 4: scriptExtract (hvis prisen er i JS)
// Beskrivelse: Hvis prisen er gemt i JavaScript-variabler.
// Forventet resultat: ✅ Virker, hvis Bike24 bruger JS til at indsætte prisen.
// =============================================
const BIKE24_CONFIG_SCRIPT_EXTRACT = {
    name: "Bike24",
    url: "https://www.bike24.com/search-result?searchTerm=",
    scriptExtract: {
        price: "window\\.productPrice\\s*=\\s*['\"]([\\d.,]+)['\"]",  // Søg efter: window.productPrice = "99.99"
        currency: "window\\.currency\\s*=\\s*['\"]([A-Z]{3})['\"]", // Søg efter: window.currency = "EUR"
        container: ".product-detail"       // Søg kun inden for dette element (valgfrit)
    },
    gtinSelectors: [
        { type: "application/ld+json", paths: ["gtin", "gtin13"] },
        '[itemprop="gtin13"]'
    ],
    domain: "bike24.com",
    tablePosition: ".product-availability__title",
    defaultCurrency: "EUR"
};

// =============================================
// KONFIGURATION 5: Kombineret (CSS + JSON-LD + scriptExtract)
// Beskrivelse: Prøv alle metoder i rækkefølge.
// Forventet resultat: ✅ Mest robust løsning.
// =============================================
const BIKE24_CONFIG_COMBINED = {
    name: "Bike24",
    url: "https://www.bike24.com/search-result?searchTerm=",
    priceSelector: [
        ".price",
        ".product-price",
        "[itemprop='price']"
    ].join(", "),
    scriptExtract: {
        price: "window\\.productPrice\\s*=\\s*['\"]([\\d.,]+)['\"]",
        currency: "window\\.currency\\s*=\\s*['\"]([A-Z]{3})['\"]"
    },
    gtinSelectors: [
        { type: "application/ld+json", paths: ["gtin", "gtin13", "gtin8", "gtin12", "gtin14"] },
        '[itemprop="gtin13"]',
        '[itemprop="gtin"]'
    ],
    domain: "bike24.com",
    tablePosition: ".product-availability__title",
    defaultCurrency: "EUR"
};

// =============================================
// KONFIGURATION 6: Debug-version (med logging)
// Beskrivelse: Tilføjer logging for at se, hvilke selektorer der virker.
// Brug denne til at diagnosticere problemer.
// =============================================
const BIKE24_CONFIG_DEBUG = {
    name: "Bike24 (DEBUG)",
    url: "https://www.bike24.com/search-result?searchTerm=",
    priceSelector: [
        ".price",
        ".product-price",
        "[itemprop='price']"
    ].join(", "),
    gtinSelectors: [
        { type: "application/ld+json", paths: ["gtin", "gtin13"] },
        '[itemprop="gtin13"]'
    ],
    domain: "bike24.com",
    tablePosition: ".product-availability__title",
    defaultCurrency: "EUR",
    // Tilføj dette til din content.js for at aktivere debug:
    debug: true // Vil logge alle forsøg til konsollen
};

// =============================================
// ANBEFALET TEST-FLOW
// =============================================
/*
1. Start med KONFIGURATION 2 (v1.8.0-style):
   - Hvis det virker: ✅ Problem løst! (JSON-LD fungerer)
   - Hvis det ikke virker: Gå til trin 2.

2. Prøv KONFIGURATION 3 (opdaterede selektorer):
   - Hvis det virker: ✅ CSS-selektorer fungerer.
   - Hvis det ikke virker: Gå til trin 3.

3. Prøv KONFIGURATION 4 (scriptExtract):
   - Hvis det virker: ✅ Prisen er i JS-variabler.
   - Hvis det ikke virker: Gå til trin 4.

4. Prøv KONFIGURATION 5 (kombineret):
   - Hvis det virker: ✅ Flere metoder fungerer.

5. Brug KONFIGURATION 6 (debug) til at se, hvilke selektorer der findes.
   - Kør `testBike24Selectors()` i konsollen på en Bike24-side.
*/

// =============================================
// EKSPORT (vælg én konfiguration til test)
// =============================================
// Udkommenter den konfiguration, du vil teste:
// module.exports = { BIKE24_CONFIG_V1_9_0 };          // ❌ Fejler
// module.exports = { BIKE24_CONFIG_V1_8_0_STYLE };     // ✅ Anbefalet først
// module.exports = { BIKE24_CONFIG_UPDATED_SELECTORS }; // ✅ Prøv dette
// module.exports = { BIKE24_CONFIG_SCRIPT_EXTRACT };   // ✅ Hvis prisen er i JS
// module.exports = { BIKE24_CONFIG_COMBINED };        // ✅ Mest robust
// module.exports = { BIKE24_CONFIG_DEBUG };           // ✅ Til debugging

// For at teste direkte i browseren:
// 1. Åbn en Bike24-side.
// 2. Kør dette i konsollen:
//    testBike24Selectors();
// 3. Se hvilke selektorer der returnerer resultater.