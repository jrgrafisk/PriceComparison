/* content.js */
// Disable all console.log statements
 // const originalConsoleLog = console.log; // Store the original console.log function
// console.log = function() {}; // Override console.log with a no-op function

// To re-enable logging later, you can restore the original function
// console.log = originalConsoleLog; // Uncomment this line to restore logging




// Now you can use the globally available config objects



// Add shop filtering support - SINGLE DECLARATION
let enabledShops = {};

// Timeout
let timeout;

// URL tracking
let lastUrl = location.href;

// Update state tracking
let isUpdating = false;

// Get initial enabled shops state
browser.storage.sync.get('enabledShops').then(data => {
    enabledShops = data.enabledShops || {};
});

// Add message listener for shop updates
browser.runtime.onMessage.addListener((message) => {
    if (message.action === 'shopsUpdated') {
        enabledShops = message.enabledShops;
        // Re-run price comparison with new shop settings
        findAndComparePrice();
    }
});

// Store referrer on page load
if (document.referrer) {
    sessionStorage.setItem('lastReferrer', document.referrer);
}

// Reuse parser instance
const parser = new DOMParser();

// Cache selectors
const selectorCache = new Map();

function getCachedSelector(selector) {
    if (!selectorCache.has(selector)) {
        selectorCache.set(selector, document.querySelector(selector));
    }
    return selectorCache.get(selector);
}

// Single initialization flag
let isInitialized = false;

// Use the config for your productInfo object
let productInfo = {
    gtin: [],
    mpn: [],
    shop: {
        name: '',
        url: window.location.href,
        domain: window.location.hostname
    },
    price: {
        amount: null,
        currency: null,
        rawText: '',
        source: ''
    },
    product: {
        name: null,
        brand: '',
        category: ''
    },
    referrer: {
        url: window.location.href,
        price: null,
        timestamp: new Date().toISOString()
    },
    detectedOn: window.location.hostname,
    foundTimestamp: new Date().toISOString()
};

async function initializeEnabledShops() {
    const data = await browser.storage.sync.get('enabledShops');
    enabledShops = data.enabledShops || {};

}
// Single init function
function initialize() {
    if (isInitialized) return;
    isInitialized = true;

    // Initialize shops state once
    initializeEnabledShops();

    // Single mutation observer setup
    setupMutationObserver();

    // Initial price comparison
    findAndComparePrice();
}


function getCurrencyCodeFromSymbol(symbol) {
    switch (symbol) {
      case '€': return 'EUR';
      case '£': return 'GBP';
      case '$': return 'USD';
      // ...
      default:  return null; // or 'DKK' or your fallback
    }
  }
  function detectCurrency(priceText) {
    if (!priceText) return null;
    const text = priceText.trim();
    if (text.includes('€')) return 'EUR';
    if (text.includes('kr') || text.includes('DKK')) return 'DKK';
    if (text.includes('£')) return 'GBP';
    if (text.includes('$')) return 'USD';
    return 'EUR'; // Default to EUR if no currency symbol found
}



let gtinFound = false;
let priceFound = false;
let productData = {
    gtin: null,
    price: null,
    mpn: null
};
let processedGTINs = new Map();
let observer = null;
let currentUrl = window.location.href;
const EUR_TO_DKK_RATE = 7.45;
const EUR_TO_GBP_RATE = 0.86;
const EUR_TO_USD_RATE = 1.08;

let gtinSearchAttempts = 0;
const MAX_GTIN_SEARCH_ATTEMPTS = 2;
let cachedGTIN = null;  // Add this at the top with other global variables
let lastCartPayload = null;

// Get current site information
let { price: currentPrice, currency: currentCurrency } = getCurrentPriceAndCurrency();


/* // Convert to EUR for comparison
const currentPriceEUR = currentCurrency === 'EUR' ? currentPrice : currentPrice / EUR_TO_DKK_RATE; */

const convertEurToDkk = (priceInEur) => priceInEur * EUR_TO_DKK_RATE;
const convertDkkToEur = (priceInDkk) => priceInDkk / EUR_TO_DKK_RATE;


function insertLoadingPlaceholder(shop, activeShops, onSkip) {
    if (document.querySelector('.price-comparison-table')) return;

    const style = document.createElement('style');
    style.textContent = '@keyframes pp-spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(style);

    const widget = document.createElement('div');
    widget.classList.add('price-comparison-table');
    widget.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:2147483647;font-family:Arial,sans-serif;';

    // Hidden status container — still needed for onShopResult DOM updates
    const panel = document.createElement('div');
    panel.id = 'pp-shop-status';
    panel.style.display = 'none';
    (activeShops || []).forEach(s => {
        const row = document.createElement('div');
        row.dataset.domain = s.domain;
        panel.appendChild(row);
    });

    const btn = document.createElement('div');
    btn.style.cssText = 'background:#f2994b;color:white;border-radius:28px;padding:10px 18px;box-shadow:0 4px 16px rgba(0,0,0,.2);font-size:13px;font-weight:600;display:flex;align-items:center;gap:8px;white-space:nowrap;';
    const sp = document.createElement('span');
    sp.style.cssText = 'display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,.5);border-top-color:white;border-radius:50%;animation:pp-spin 0.7s linear infinite;flex-shrink:0;';
    const lbl = document.createElement('span');
    lbl.textContent = 'Søger priser...';
    const skipBtn = document.createElement('span');
    skipBtn.textContent = '✕';
    skipBtn.style.cssText = 'margin-left:4px;opacity:.7;cursor:pointer;font-size:14px;padding:2px;';
    skipBtn.addEventListener('click', (e) => { e.stopPropagation(); onSkip?.(); });
    btn.appendChild(sp);
    btn.appendChild(lbl);
    btn.appendChild(skipBtn);

    widget.appendChild(panel);
    widget.appendChild(btn);
    document.body.appendChild(widget);
}


/**
 * Converts a given numeric price from a specified currency to EUR.
 * 
 * @param {number} price - The price to convert.
 * @param {string} currency - Currency code (e.g., 'EUR', 'DKK', 'USD', 'GBP').
 * @returns {number|null} The price in EUR if conversion is possible, otherwise null.
 */
function convertToEUR(price, currency) {
    if (typeof price !== 'number' || isNaN(price)) {

        return null;
    }

    switch (currency?.toUpperCase()) {
        case 'EUR': return price;
        case 'DKK': return price / EXCHANGE_RATES.EUR_TO_DKK;
        case 'GBP': return price / EXCHANGE_RATES.EUR_TO_GBP;
        case 'USD': return price / EXCHANGE_RATES.EUR_TO_USD;
        default:

            return price; // Default to EUR
    }
}




// Helper function to safely convert to number
function safeNumber(value) {
    const num = Number(value);
    return isNaN(num) ? null : num;
}

// Helper function to normalize price to EUR
function normalizePriceToEUR(price, currency) {
    const numPrice = safeNumber(price);
    if (numPrice === null) return null;
    
    switch(currency.toUpperCase()) {
        case 'EUR': return numPrice;
        case 'DKK': return numPrice / EXCHANGE_RATES.EUR_TO_DKK;
        case 'GBP': return numPrice / EXCHANGE_RATES.EUR_TO_GBP;
        case 'USD': return numPrice / EXCHANGE_RATES.EUR_TO_USD;
        default:

            return null;
    }
}

function extractInertiaPrice(html, shop) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const appEl = doc.querySelector('[data-page]');
    if (!appEl) return null;

    let pageData;
    try {
        pageData = JSON.parse(appEl.getAttribute('data-page'));
    } catch (e) {

        return null;
    }

    const { productPaths, priceField } = shop.inertia;
    for (const path of productPaths) {
        const products = path.split('.').reduce((obj, key) => obj?.[key], pageData);
        if (Array.isArray(products) && products.length > 0) {
            const price = products[0][priceField];
            if (price != null) return String(price);
        }
    }
    return null;
}

function extractDataPropsPrice(html, shop) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const { selector, attribute, productPaths, priceField } = shop.dataProps;
    const el = doc.querySelector(selector);
    if (!el) return null;

    let data;
    try { data = JSON.parse(el.getAttribute(attribute)); } catch (e) { return null; }

    for (const path of productPaths) {
        const products = path.split('.').reduce((obj, key) => obj?.[key], data);
        if (Array.isArray(products) && products.length > 0) {
            const price = parseFloat(products[0][priceField]);
            if (!isNaN(price) && price > 0) return price.toFixed(2) + '\u20ac';
        }
    }
    return null;
}

function extractJSONLDPrice(html, gtin) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
        try {
            const data = JSON.parse(script.textContent);
            const items = Array.isArray(data) ? data : [data];
            for (const item of items) {
                if (!item.offers) continue;
                const productGtin = item.gtin13 || item.gtin || item.gtin8 || item.gtin12 || item.gtin14;
                if (productGtin && String(productGtin).trim() !== gtin) continue;
                const offerList = Array.isArray(item.offers) ? item.offers : [item.offers];
                for (const offer of offerList) {
                    const price = parseFloat(offer.price);
                    if (!isNaN(price) && price > 0) return String(offer.price);
                }
            }
        } catch (e) {}
    }
    return null;
}

function displayPrice(responses, identifier, identifierType) {
    const currentPriceInfo = getCurrentPriceAndCurrency();
    if (!currentPriceInfo.price) {

        return;
    }

    // Process all responses in parallel
    const priceResults = responses
        .filter(response => response?.html)
        .map(response => {
            const shop = SHOPS.find(s => response.url.includes(s.domain));
            if (!shop || (enabledShops[shop.domain] === false)) return null;

            let priceText;
            if (shop.inertia) {
                priceText = extractInertiaPrice(response.html, shop);
                if (!priceText) return null;
            } else if (shop.dataProps) {
                priceText = extractDataPropsPrice(response.html, shop);
                if (!priceText) return null;
            } else if (shop.scriptExtract) {
                let searchHtml = response.html;
                if (shop.scriptExtract.container) {
                    const doc = new DOMParser().parseFromString(response.html, 'text/html');
                    const container = doc.querySelector(shop.scriptExtract.container);
                    if (container) {
                        searchHtml = Array.from(container.querySelectorAll('script'))
                            .map(s => s.textContent).join('\n');
                    }
                }
                const priceMatch = searchHtml.match(new RegExp(shop.scriptExtract.price));
                if (!priceMatch) return null;
                let extracted = priceMatch[1];
                if (shop.scriptExtract.currency) {
                    const currMatch = searchHtml.match(new RegExp(shop.scriptExtract.currency));
                    if (currMatch) extracted += ' ' + currMatch[1];
                }
                priceText = extracted;
            } else {
                const doc = new DOMParser().parseFromString(response.html, 'text/html');
                const priceElement = doc.querySelector(shop.priceSelector);
                if (priceElement) {
                    priceText = priceElement.textContent.trim()
                        .replace(/^(from|fra|ab|dès|vanaf)\s+/i, '').trim();
                } else {
                    priceText = extractJSONLDPrice(response.html, identifier);
                    if (!priceText) return null;
                }
            }
            const { price, currency: detectedCurrency } = extractPriceAndCurrency(priceText);
            const currency = detectedCurrency || shop.defaultCurrency || 'EUR';
            if (!price) return null;

/*             const validation = validatePrice(
                price,
                currentPriceInfo.price,
                currency,
                currentPriceInfo.currency,
                { debugLog: true }
            ); */

/*             if (!validation.isValid) return null; */

            // Validation: reject if price is >60% lower than current page price (likely wrong match)
            const priceInDkk = currency === 'DKK' ? price : price * EXCHANGE_RATES.EUR_TO_DKK;
            const currentPageDkk = currentPriceInfo.currency === 'DKK'
                ? currentPriceInfo.price
                : currentPriceInfo.price * EXCHANGE_RATES.EUR_TO_DKK;
            if (currentPageDkk && priceInDkk < currentPageDkk * 0.40) {
                return null; // >60% discount = likely wrong match
            }

            return {
                shop: shop.name,
                price: priceText,
                eurPrice: currency === 'EUR' ? price : price / EXCHANGE_RATES.EUR_TO_DKK,
                dkkPrice: currency === 'DKK' ? price : price * EXCHANGE_RATES.EUR_TO_DKK,
                shopUrl: response.url
            };
        })
        .filter(result => result !== null);

    const productName = findProductName();
    const comparisonMessage = priceResults.length === 0 ?
        generateNoProductsMessage(productName) :
        generateComparisonTable(priceResults, identifierType, productName); // Debugging log

    // Compute summary, savings and cheaper count
    const sortedForSummary = [...priceResults].sort((a, b) => Number(a.dkkPrice) - Number(b.dkkPrice));
    const best = sortedForSummary[0];

    const currentDkk = currentPriceInfo.currency === 'DKK'
        ? currentPriceInfo.price
        : currentPriceInfo.price * EXCHANGE_RATES.EUR_TO_DKK;
    const savings = (best && currentDkk) ? Math.round(currentDkk - Number(best.dkkPrice)) : 0;
    const cheaperCount = priceResults.filter(r => Number(r.dkkPrice) < currentDkk - 1).length;

    const summary = priceResults.length > 0
        ? `${priceResults.length} ${priceResults.length === 1 ? 'pris' : 'priser'} · Bedste: ${Math.round(Number(best.dkkPrice))} kr. (${best.shop})`
        : 'Ingen priser fundet';

    // Update extension badge with cheaper alternatives count
    try { browser.runtime.sendMessage({ action: 'setBadge', count: cheaperCount }); } catch(e) {}

    // Cache cart payload for cart button in widget
    lastCartPayload = priceResults.length > 0 ? {
        gtin: cachedGTIN,
        name: findProductName(),
        sourceDomain: window.location.hostname,
        sourceUrl: window.location.href,
        prices: priceResults.map(r => ({ shop: r.shop, dkkPrice: Math.round(Number(r.dkkPrice)), url: r.shopUrl })),
        bestPrice: { shop: best.shop, dkkPrice: Math.round(Number(best.dkkPrice)), url: best.shopUrl }
    } : null;

    // Ensure the shop object is passed correctly
    const shop = SHOPS.find(s => window.location.href.includes(s.domain));
    if (shop) {
        insertComparisonTable(shop, comparisonMessage, 0, summary, savings);
    } else {

    }
}


let priceUpdateTimeout = null;

function debouncedPriceUpdate() {
    clearTimeout(priceUpdateTimeout);
    priceUpdateTimeout = setTimeout(() => {
        findAndComparePrice();
    }, 300);
}
  


function getCurrentPriceAndCurrency() {
    const currentShop = SHOPS.find(shop => window.location.hostname.includes(shop.domain));
    if (!currentShop) return { price: null, currency: null };

    // Try scriptExtract first if configured (handles shops with ambiguous CSS price elements)
    if (currentShop.scriptExtract) {
        const bodyHtml = document.body.innerHTML;
        const priceMatch = bodyHtml.match(new RegExp(currentShop.scriptExtract.price));
        if (priceMatch) {
            const price = normalizePrice(priceMatch[1]);
            let currency = currentShop.defaultCurrency;
            if (currentShop.scriptExtract.currency) {
                const currMatch = bodyHtml.match(new RegExp(currentShop.scriptExtract.currency));
                if (currMatch) currency = currMatch[1];
            }
            if (price !== null) return { price, currency };
        }
    }

    // Use the configured price selector for the current shop
    const priceElement = document.querySelector(currentShop.priceSelector);
    if (!priceElement) {

        return { price: null, currency: null };
    }

    // Extract price text from the configured selector
    let priceText = priceElement.textContent?.trim() || priceElement.getAttribute('content')?.trim();
    if (!priceText) {

        return { price: null, currency: null };
    }

    // Normalize and extract the price
    const price = normalizePrice(priceText);
    const currency = detectCurrencyFromText(priceText, currentShop.defaultCurrency);

    if (price !== null) {

        return { price, currency };
    }


    return { price: null, currency: null };
}

// Helper function to normalize price
function normalizePrice(priceText) {
    if (!priceText) return null;

    try {
        // Clean up the price text
        let price = priceText.trim();

        // Remove "from" or "fra" prefix (case insensitive)
        price = price.replace(/^(from|fra)\s+/i, '');

        // Remove currency symbols and extra spaces
        price = price.replace(/[€$£kr]/g, '').trim();

        // Handle European number format (e.g., "27,95")
        if (price.includes(',') && /,\d{2}(?:\s|$)/.test(price)) {
            price = price.replace(/\./g, '').replace(',', '.');
        } else {
            // Remove thousand separators
            price = price.replace(/,/g, '');
        }

        // Convert to number
        const numericPrice = parseFloat(price);

        if (isNaN(numericPrice)) {

            return null;
        }


        return numericPrice;
    } catch (error) {

        return null;
    }
}

// Function to detect currency based on price text
function detectCurrencyFromText(priceText, defaultCurrency) {
    // Check for EUR or € for Euro
    if (priceText.includes('EUR') || priceText.includes('€')) {
        return 'EUR';
    }
    // Check for kr, DKK, or kr. for Danish Krone
    if (priceText.includes('kr') || priceText.includes('DKK') || priceText.includes('kr.')) {
        return 'DKK';
    }
    // If no currency is detected, return the default currency
    return defaultCurrency;
}



// Function to toggle visibility of additional shops
function toggleMoreShops() {
    const additionalShops = document.querySelectorAll('.additional-shop'); // Adjust the selector as needed
    additionalShops.forEach(shop => {
        shop.style.display = shop.style.display === 'none' ? 'block' : 'none';
    });
}

/* // Create and append the toggle button
function createToggleButton() {
    const toggleButton = document.createElement('button');
    toggleButton.textContent = 'Toggle More Shops';
    toggleButton.addEventListener('click', toggleMoreShops);
    document.body.appendChild(toggleButton); // Append to the body or a specific container
}

// Call the function to create the toggle button
createToggleButton(); */

 
function getJSONLDPrice() {
    try {
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (const script of scripts) {
            const data = JSON.parse(script.textContent);
            
            // Normalize to an array of items
            const items = Array.isArray(data) ? data : [data];
            
            for (const item of items) {
                // Case 1: Standard Product
                if (item['@type'] === 'Product' && item.offers) {
                    const offers = Array.isArray(item.offers) ? item.offers[0] : item.offers;
                    if (offers.price && offers.priceCurrency) {
                        const price = parseFloat(offers.price);
                        if (!isNaN(price)) {
                            return {
                                price,
                                currency: offers.priceCurrency
                            };
                        }
                    }
                }
                // Case 2: ProductGroup with variants
                else if (item['@type'] === 'ProductGroup' && item.hasVariant) {
                    const variants = Array.isArray(item.hasVariant) ? item.hasVariant : [item.hasVariant];
                    for (const variant of variants) {
                        if (variant.offers) {
                            const offers = Array.isArray(variant.offers) ? variant.offers[0] : variant.offers;
                            if (offers.price && offers.priceCurrency) {
                                const price = parseFloat(offers.price);
                                if (!isNaN(price)) {
                                    return {
                                        price,
                                        currency: offers.priceCurrency
                                    };
                                }
                            }
                        }
                    }
                }
            }
        }
    } catch (e) {

    }
    return { price: null, currency: null };
}

function extractPriceAndCurrency(priceText) {
    if (!priceText) return { price: null, currency: null };

    // Clean the text
    let text = priceText.trim();
    
    // Remove "from" or "fra" prefix
    text = text.replace(/^(from|fra)\s+/i, '');

    // Determine currency
    let currency = null;
    if (text.includes('kr') || text.includes('DKK')) currency = 'DKK';
    else if (text.includes('€') || text.includes('EUR')) currency = 'EUR';

    // Clean up the price
    let price = text.replace(/[€$£kr]/g, '').trim();

    // Handle European number format
    if (price.includes(',') && /,\d{2}(?:\s|$)/.test(price)) {
        price = price.replace(/\./g, '').replace(',', '.');
    } else {
        price = price.replace(/,/g, '');
    }

    const numericPrice = parseFloat(price);
    if (isNaN(numericPrice)) {

        return { price: null, currency: null };
    }

    return { price: numericPrice, currency };
}

/* 
function validatePrice(sourcePrice, targetPrice, sourceCurrency = 'EUR', targetCurrency = 'EUR', options = {}) {
    const {
        lowerThreshold = 0.2,  // Price can't be 80% lower
        upperThreshold = 1.8,  // Price can't be 80% higher
        debugLog = true
    } = options;

    // First, ensure we have valid numeric prices
    let sourcePriceNum = parseFloat(sourcePrice);
    let targetPriceNum = parseFloat(targetPrice);

    // Guard clauses for invalid inputs
    if (isNaN(sourcePriceNum) || isNaN(targetPriceNum)) {
        return {
            isValid: false,
            reason: 'INVALID_PRICES',
            details: { sourcePrice, targetPrice }
        };
    }

    // Convert both prices to EUR for comparison
    const sourcePriceEUR = normalizePriceToEUR(sourcePriceNum, sourceCurrency);
    const targetPriceEUR = normalizePriceToEUR(targetPriceNum, targetCurrency);

    if (sourcePriceEUR === null || targetPriceEUR === null) {
        return {
            isValid: false,
            reason: 'CURRENCY_CONVERSION_FAILED',
            details: { sourcePriceEUR, targetPriceEUR }
        };
    }

    // Calculate thresholds
    const minimumPrice = Number(targetPriceEUR) * lowerThreshold;
    const maximumPrice = Number(targetPriceEUR) * upperThreshold;

    // Ensure all values are numbers before using toFixed
    const sourcePriceEURNum = Number(sourcePriceEUR);
    const targetPriceEURNum = Number(targetPriceEUR);
    const minimumPriceNum = Number(minimumPrice);
    const maximumPriceNum = Number(maximumPrice);

    // Perform validation
    const isTooLow = sourcePriceEURNum < minimumPriceNum;
    const isTooHigh = sourcePriceEURNum > maximumPriceNum;
    const isValid = !isTooLow && !isTooHigh;

    return {
        isValid,
        reason: isValid ? 'VALID' : (isTooLow ? 'TOO_LOW' : 'TOO_HIGH'),
        details: {
            sourcePriceEUR: sourcePriceEURNum.toFixed(2),
            targetPriceEUR: targetPriceEURNum.toFixed(2),
            minimumPrice: minimumPriceNum.toFixed(2),
            maximumPrice: maximumPriceNum.toFixed(2),
            difference: ((sourcePriceEURNum - targetPriceEURNum) / targetPriceEURNum * 100).toFixed(2) + '%'
        }
    };
} */

/* function findGTINFromJSONLD() {

	try {
        const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
        for (const script of scripts) {
            try {
                const parsedData = JSON.parse(script.textContent);
                // Normalize to an array if it's not already one
                const dataArray = Array.isArray(parsedData) ? parsedData : [parsedData];
                

                
                // Iterate through each item in the array
                for (const data of dataArray) {
                    // Case 1: ProductGroup with variants
                    if (data['@type'] === 'ProductGroup' && data.hasVariant) {
                        const variants = Array.isArray(data.hasVariant) ? data.hasVariant : [data.hasVariant];
                        for (const variant of variants) {
                            if (variant.offers) {
                                // Normalize offers to an array
                                const offers = Array.isArray(variant.offers) ? variant.offers : [variant.offers];
                                for (const offer of offers) {
                                    if (offer.gtin) {

                                        productInfo.gtin.push({
                                            value: offer.gtin,
                                            source: 'JSON-LD Product Variant Offer',
                                            url: window.location.href
                                        });
                                        return offer.gtin;
                                    } else {

                                    }
                                }
                            }
                        }
                    }
                    
                    // Case 2: Single Product schema
                    if (data['@type'] === 'Product') {
                        if (data.gtin) {

                            productInfo.gtin.push({
                                value: data.gtin,
                                source: 'JSON-LD Product',
                                url: window.location.href
                            });
                            return data.gtin;
                        }
                    }
                }
                
                // Fallback: Search for 13-digit numbers in the JSON-LD data
                const jsonString = JSON.stringify(dataArray);
                const regex = /\b\d{13}\b/g; // Matches 13-digit numbers
                const matches = jsonString.match(regex);
                if (matches && matches.length > 0) {
                    productInfo.gtin.push({
                        value: matches[0],
                        source: 'Fallback 13-digit number',
                        url: window.location.href
                    });
                    return matches[0];
                }
            } catch (e) {

            }
        }
    } catch (e) {

    }
    return null;
} */

function findGTIN() {
    // Return cached GTIN if we already found one
    if (cachedGTIN) {

        return cachedGTIN;
    }

    // Check if we've exceeded the maximum attempts
    if (gtinSearchAttempts >= MAX_GTIN_SEARCH_ATTEMPTS) {

        return null;
    }
    gtinSearchAttempts++;



    // Reset GTIN list before extracting new GTINs
    productInfo.gtin = [];

    // 1. Try to find GTIN in a table cell OR paragraph labeled "EAN/GTIN"
    const eanRows = document.querySelectorAll('tr');
    for (const row of eanRows) {
        const cells = row.getElementsByTagName('td');
        if (cells.length >= 2 && /^(ean|gtin|gtins?)[\s:]*$/i.test(cells[0].textContent.trim())) {
            const gtin = cells[1].textContent.trim().replace(/[^0-9]/g, '');
            if (gtin.length >= 8 && gtin.length <= 14) {
                productInfo.gtin.push({ value: gtin, source: 'Table EAN cell', url: window.location.href });
                cachedGTIN = gtin;
                return gtin;
            }
        }
    }
    // Also check <p>EAN:<span>VALUE</span></p> pattern (e.g. Børkop Cykler)
    for (const p of document.querySelectorAll('p')) {
        if (!/^(ean|gtin)[\s:]*/i.test(p.textContent.trim())) continue;
        const span = p.querySelector('span');
        if (!span) continue;
        const gtin = span.textContent.trim().replace(/[^0-9]/g, '');
        if (gtin.length >= 8 && gtin.length <= 14) {
            productInfo.gtin.push({ value: gtin, source: 'Paragraph EAN span', url: window.location.href });
            cachedGTIN = gtin;
            return gtin;
        }
    }

    // 2. Bike-Discount specific: check for netz-ean element, then dataLayer
    if (window.location.hostname.includes('bike-discount.de')) {
        const netzEan = document.querySelector('.netz-ean');
        if (netzEan) {
            const gtin = netzEan.textContent?.trim().replace(/[^0-9]/g, '') || '';
            if (gtin.length >= 8 && gtin.length <= 14) {
                productInfo.gtin.push({ value: gtin, source: 'netz-ean class', url: window.location.href });
                cachedGTIN = gtin;
                return gtin;
            }
        }
        // Fallback: parse productEAN from dataLayer push script
        for (const script of document.querySelectorAll('script:not([type])')) {
            const m = script.textContent.match(/"productEAN"\s*:\s*"(\d{8,14})"/);
            if (m) {
                productInfo.gtin.push({ value: m[1], source: 'dataLayer productEAN', url: window.location.href });
                cachedGTIN = m[1];
                return m[1];
            }
        }
    }

    // 3. Other HTML selectors
    const gtinSelectors = [
        '[itemprop="gtin13"]', '[itemprop="gtin"]', '[itemprop="gtin8"]',
        '[itemprop="gtin12"]', '[itemprop="gtin14"]', '.netz-ean',
        '[data-ean]', 'span[itemprop="productID"]', 'meta[property="product:ean"]',
        'meta[property="og:ean"]', '.ean-code', '.product-ean',
        '[data-gtin]', '.gtin-code', '.product-gtin', 'span.ean', 'div.ean',
        'p.ean', '[data-product-code]', '[data-barcode]', 'meta[name="gtin"]',
        'meta[name="ean"]', '[itemprop="productID"]', '.barcode-number',
        '.product-barcode', 'span[data-ean]', 'div[data-gtin]', '.code-ean',
        '.sku-ean', '[data-product-ean]', 'meta[property="product:barcode"]',
        '.gtin', '.product-identifier', '[data-identifier]', 'span.product-code',
        'div.product-code','td.col.data[data-th="EAN"]'
    ];


    for (const selector of gtinSelectors) {
        const element = document.querySelector(selector);
        if (element) {
            let gtin = element.textContent?.trim().replace(/[^0-9]/g, '') || '';
            let attrValue = element.getAttribute("content")?.trim() ||
                            element.getAttribute("data-ean")?.trim() ||
                            element.getAttribute("data-gtin")?.trim() ||
                            element.getAttribute("value")?.trim() || '';
            let finalGTIN = attrValue || gtin;
            if (finalGTIN.length >= 8 && finalGTIN.length <= 14) {
                productInfo.gtin.push({
                    value: finalGTIN,
                    source: `HTML Selector: ${selector}`,
                    url: window.location.href
                });
                // Do not return immediately; we want to allow the JSON‑LD method to run if no valid GTIN is returned by our cache logic.
            }
        }
    }

    // 4. If no GTIN was found in the HTML, check JSON-LD scripts

    let foundGtinFromJSONLD = null;
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (let i = 0; i < scripts.length; i++) {
        try {
            const parsedData = JSON.parse(scripts[i].textContent);
            // Normalize to an array if not already
            const dataArray = Array.isArray(parsedData) ? parsedData : [parsedData];

            for (const data of dataArray) {
                // Case A: ProductGroup with variants
                if (data['@type'] === 'ProductGroup' && data.hasVariant) {
                    const variants = Array.isArray(data.hasVariant) ? data.hasVariant : [data.hasVariant];
                    for (const variant of variants) {
                        if (variant.offers) {
                            const offers = Array.isArray(variant.offers) ? variant.offers : [variant.offers];
                            for (const offer of offers) {
                                if (offer.gtin) {

                                    productInfo.gtin.push({
                                        value: offer.gtin,
                                        source: `JSON-LD Script #${i + 1} (Variant Offer)`,
                                        url: window.location.href
                                    });
                                    foundGtinFromJSONLD = offer.gtin;
                                    break;
                                } else {

                                }
                            }
                        }
                        if (foundGtinFromJSONLD) break;
                    }
                }
                // Case B: Single Product schema
                if (!foundGtinFromJSONLD && data['@type'] === 'Product') {
                    if (data.gtin) {

                        productInfo.gtin.push({
                            value: data.gtin,
                            source: `JSON-LD Script #${i + 1} (Product)`,
                            url: window.location.href
                        });
                        foundGtinFromJSONLD = data.gtin;
                        break;
                    }
                }
            }
            // Fallback: use regex to find any 13-digit number if still not found
            if (!foundGtinFromJSONLD) {
                const jsonString = JSON.stringify(dataArray);
                const regex = /\b\d{13}\b/g;
                const matches = jsonString.match(regex);
                if (matches && matches.length > 0) {
                    productInfo.gtin.push({
                        value: matches[0],
                        source: 'Fallback 13-digit number in JSON-LD',
                        url: window.location.href
                    });
                    foundGtinFromJSONLD = matches[0];
                }
            }
        } catch (e) {

        }
        if (foundGtinFromJSONLD) break;
    }

    // Cache and return the found GTIN if found either by HTML or JSON-LD
    const foundGTIN = productInfo.gtin.length > 0 ? productInfo.gtin[0].value : null;
    if (foundGTIN) {
        cachedGTIN = foundGTIN;
    }

    return foundGTIN;
}


function extractGTINFromJSON(json) {
    if (!json) return null;

    if (json.gtin13) return json.gtin13;
    if (json.gtin) return json.gtin;
    if (json.gtin8) return json.gtin8;
    if (json.gtin12) return json.gtin12;
    if (json.gtin14) return json.gtin14;
    if (json.productID && json.productID.match(/^\d{8,14}$/)) return json.productID;
    
    if (json.offers) {
        if (Array.isArray(json.offers)) {
            for (const offer of json.offers) {
                let gtin = extractGTINFromJSON(offer);
                if (gtin) return gtin;
            }
        } else {
            let gtin = extractGTINFromJSON(json.offers);
            if (gtin) return gtin;
        }
    }

    if (Array.isArray(json)) {
        for (const obj of json) {
            let gtin = extractGTINFromJSON(obj);
            if (gtin) return gtin;
        }
    }

    return null;
}





// Function to find and store MPN
function findMPN() {
    const mpnSelectors = [
        '[itemprop="mpn"]',
        '[itemprop="sku"]',
        '.product-id',
        '.netz-ean',  // Bike-Discount specific
        '[data-ean]',
        'span[itemprop="productID"]'
    ];

    for (const selector of mpnSelectors) {
        const mpnElement = document.querySelector(selector);
        if (mpnElement) {
            const mpnValue = mpnElement.textContent?.trim() || 
                             mpnElement.getAttribute('content') || 
                             mpnElement.getAttribute('data-ean');

            if (mpnValue) {
                return mpnValue; // STOP once we find a valid MPN
            }
        }
    }


    return null;
}
 
const PriceTracker = (function() {
    async function trackClick(store, productUrl, productName, price, gtin, mpn, referrer) {
        try {
            const clickData = {
                store: store,
                productUrl: productUrl,
                productName: productName,
                price: price,
                gtin: gtin,
                mpn: mpn,
                referrer: referrer
            };
            

            
            const response = await fetch('https://jrgrafisk.dk/php-endpoint.php', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(clickData)
            });
            
            const responseText = await response.text();

            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}, response: ${responseText}`);
            }
            
            try {
                const result = JSON.parse(responseText);

            } catch (parseError) {


            }
        } catch (error) {
        }
    }

    function handleClick(event) {
        const link = event.currentTarget;
        try {
            const store = link.getAttribute('data-store');
            const url = link.getAttribute('data-url');
            const name = link.getAttribute('data-name');
            const price = link.getAttribute('data-price');
            const gtin = link.getAttribute('data-gtin');
            const mpn = link.getAttribute('data-mpn');
			const referrer = link.getAttribute('data-referrer');
            // Get the current domain as the referrer
            

            if (!store || !url) {

                return;
            }

            // Log the collected data


            // Prevent default navigation temporarily
            event.preventDefault();

            // Track click then navigate
            trackClick(store, url, name, price, gtin, mpn, referrer)
                .then(() => {
                    window.location.href = url;
                })
                .catch(error => {

                    window.location.href = url; // Navigate anyway
                });
        } catch (error) {

        }
    }

    function attachTrackingHandlers() {
        try {
            const links = document.querySelectorAll('.track-click');

            
            links.forEach(link => {
                // Remove existing handlers to prevent duplicates
                link.removeEventListener('click', handleClick);
                link.addEventListener('click', handleClick);
            });
        } catch (error) {

        }
    }

    return {
        attachTrackingHandlers: attachTrackingHandlers,
        _debug: {
            trackClick,
            handleClick
        }
    };
})(); 

// Initialize tracking
document.addEventListener('DOMContentLoaded', () => {
    PriceTracker.attachTrackingHandlers();
});

function addUTMParameters(originalUrl) {
    try {
        // Use the findGTIN() function to get the GTIN value
        const gtinValue = findGTIN();
        const productName = findProductName() || 'unknown_product';

        // Search identifier is GTIN only
        const searchIdentifier = gtinValue || 'unknown_identifier';

        // Define UTM parameters
        const utm = {
            utm_source: 'Price Comparison Extension',
            utm_medium: 'price_comparison',
            utm_campaign: 'product_search',
            utm_content: encodeURIComponent(productName),
            utm_term: searchIdentifier
        };

        // Create a URL object from the original URL
        const urlObject = new URL(originalUrl);

        // Append UTM parameters to the URL
        Object.entries(utm).forEach(([key, value]) => {
            urlObject.searchParams.append(key, value);
        });

        // Optional: Add additional tracking parameters
        urlObject.searchParams.append('ref', 'bike_parts_price_comparison');
        urlObject.searchParams.append('tracking_id', Math.random().toString(36).substring(2, 15) + 
                                                     Math.random().toString(36).substring(2, 15));

        // Return the URL with appended UTM parameters
        return urlObject.toString();
    } catch (error) {

        return originalUrl;  // Return the original URL in case of error
    }
}


function generateTrackingId() {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
}

/* function findMPN() {
    const mpnSelectors = [
        '[itemprop="mpn"]',
        '[itemprop="sku"]',
        '.product-id',
        'span[itemprop="productID"]',  // Refined selector for product ID
        '.netz-ean',  // Bike-Discount specific
        '[data-ean]'
    ];

    // Loop through selectors
    for (const selector of mpnSelectors) {
        const mpnElement = document.querySelector(selector);
        if (mpnElement) {
            // Log the HTML content of the found MPN element (only for debugging)


            // Retrieve MPN value from text content, content attribute, or data-ean attribute
            const mpnValue = mpnElement.textContent.trim() || 
                             mpnElement.getAttribute('content') || 
                             mpnElement.getAttribute('data-ean');
                             
            // Log found MPN value

            
            // Return the value if it's not empty
            if (mpnValue) return mpnValue; 
        }
    }

    // If no MPN found, log and return null

    return null;
} */

/* function extractProductData() {
    const gtin = findGTIN(); // Prioritize GTIN

    if (gtin) {

    } else {

        const mpn = findMPN(); // Only check MPN if GTIN is not available

        if (mpn) {

        } else {

        }
    }
} */


function checkIdentifiers() {
    findGTIN();  // This now collects GTINs into productInfo
    findMPN();   // This should collect MPNs into productInfo

    // If you still need a single primary identifier for some purposes
    return {
        primaryIdentifier: productInfo.gtin[0]?.value || productInfo.mpn[0]?.value || null,
        type: productInfo.gtin[0] ? 'GTIN' : (productInfo.mpn[0] ? 'MPN' : null)
    };
}


function convertPrice(priceText) {
    if (!priceText) return { convertedPrice: "No match", eurValue: null, dkkValue: null };

    try {
        // Normalize the price first
        const numericPrice = normalizePrice(priceText);
        if (numericPrice === null) {
            return { convertedPrice: "No match", eurValue: null, dkkValue: null };
        }

        // Determine if it's EUR or DKK based on the original text
        const isEUR = priceText.includes('€');
        
        if (isEUR) {
            return {
                convertedPrice: `${(numericPrice * EXCHANGE_RATES.EUR_TO_DKK).toFixed(2)}`,
                eurValue: numericPrice,
                dkkValue: numericPrice * EXCHANGE_RATES.EUR_TO_DKK
            };
        }

        // If price contains 'kr', it's already DKK
        if (priceText.includes('kr')) {
            return {
                convertedPrice: numericPrice.toFixed(2),
                eurValue: (numericPrice / EXCHANGE_RATES.EUR_TO_DKK).toFixed(2),
                dkkValue: numericPrice
            };
        }

        // Default case: assume it's in EUR
        return {
            convertedPrice: `${(numericPrice * EXCHANGE_RATES.EUR_TO_DKK).toFixed(2)}`,
            eurValue: numericPrice,
            dkkValue: numericPrice * EXCHANGE_RATES.EUR_TO_DKK
        };
    } catch (error) {

        return { convertedPrice: "No match", eurValue: null, dkkValue: null };
    }
}


function findProductName() {
    const productNameSelectors = [
        'h1.product-title',
        'h1[itemprop="name"]',
        'h1.page-title span',  // Added for AllBike
        'h1',
        '.product--title',
        '.product-details h1'
    ];

    for (const selector of productNameSelectors) {
        const nameElement = document.querySelector(selector);
        if (nameElement) {
            const productName = nameElement.textContent.trim().replace(/\s+/g, ' ');
            if (productName) {

                productInfo.product.name = productName; // Store the name
                return productName;
            }
        }
    }


    return null;
}




/* function findMPN() {
    // Try to get the MPN (Sku) from the <span itemprop="sku">
    const mpn = document.querySelector('[itemprop="sku"]');
    if (mpn) {
        const mpnValue = mpn.textContent.trim();
        if (mpnValue) {

            return mpnValue;
        } else {

        }
    }

    // Fallback: Try additional selectors if MPN is No match in the primary selector
    const fallbackSelectors = [
        '.product-id', 
        '[data-sku]', 
        '.netz-ean',  // Bike-Discount specific
        'span[itemprop="productID"]'
    ];

    for (const selector of fallbackSelectors) {
        const fallbackMPN = document.querySelector(selector);
        if (fallbackMPN) {
            const fallbackMPNValue = fallbackMPN.textContent.trim() || 
                                      fallbackMPN.getAttribute('content') || 
                                      fallbackMPN.getAttribute('data-ean');
            if (fallbackMPNValue) {

                return fallbackMPNValue;
            } else {

            }
        }
    }

    // If no MPN is found, return null

    return null;
} */


function validateGTIN(gtin) {
    if (!gtin) return false;
    const cleanGTIN = gtin.toString().replace(/[^0-9]/g, '');
    return cleanGTIN.length >= 8 && cleanGTIN.length <= 14;
}



function findProductData() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
        try {
            const data = JSON.parse(script.textContent);
            
            // Håndter både enkelte produkter og lister
            const products = Array.isArray(data) ? data : [data];
            
            for (const product of products) {
                if (product['@type'] === 'Product') {
                    const gtin = product.gtin13 || product.gtin14 || product.gtin12 || product.gtin8 || product.gtin;
                    const price = product.offers?.price;
                    if (gtin || price) {

                        return { gtin, price };
                    }
                }
            }
        } catch (e) {

        }
    }
    return null;
}

function findPrice() {
    const priceSelectors = [
        // Strukturerede data
        '[itemprop="price"]',
        '[property="og:price:amount"]',
        'meta[property="product:price:amount"]',
        
        // Almindelige klasser
        '.price .amount',
        '.product-price',
        '.price--default',
        '.current-price',
        '.actual-price',
        '.sale-price',
        
        // Site-specifikke selektorer
        '#netz-price',
        '.price.site-price',
        '.text-lg.md\\:text-xl.leading-5.font-semibold.text-orange'
    ];

    for (const selector of priceSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
            const priceText = element.textContent || element.getAttribute('content');
            if (priceText) {
                // Rens prisen for alt undtagen tal og decimaltegn
                const cleanPrice = priceText.replace(/[^0-9.,]/g, '').replace(',', '.');
                const price = parseFloat(cleanPrice);
                if (!isNaN(price) && price > 0) {
                    return price;
                }
            }
        }
    }

    return null;
}



async function searchWithIdentifier(identifier, identifierType, onShopResult, skipSignal) {

    const cleanIdentifier = identifier.replace(/^Item number:\s*/i, '').trim();
    const activeShops = SHOPS.filter(shop => !enabledShops.hasOwnProperty(shop.domain) || enabledShops[shop.domain]);

    // Collect results as each shop resolves (so skip can use partial results)
    const partialResults = new Array(activeShops.length).fill(null);

    const shopPromises = activeShops.map(async (shop, i) => {
        try {

            const url = shop.domain === 'r2-bike.com'
                ? buildSearchUrl(shop, cleanIdentifier, cleanIdentifier)
                : shop.url + encodeURIComponent(cleanIdentifier);

            const fetchPromise = browser.runtime.sendMessage({
                action: 'findPrice',
                identifier: cleanIdentifier,
                url: url
            }).then(r => r || { html: null, url });

            // Per-shop timeout (e.g. Cykelpartner)
            const result = shop.timeout
                ? await Promise.race([
                    fetchPromise,
                    new Promise(resolve =>
                        setTimeout(() => resolve({ html: null, url, timedOut: true }), shop.timeout)
                    )
                  ])
                : await fetchPromise;

            partialResults[i] = result;
            onShopResult?.(shop.domain, result.timedOut ? 'timeout' : !!result.html);
            return result;
        } catch (error) {

            onShopResult?.(shop.domain, false);
            return { html: null, url: shop.url + encodeURIComponent(cleanIdentifier) };
        }
    });

    // Race all shops against optional skip signal
    await Promise.race([
        Promise.all(shopPromises),
        ...(skipSignal ? [skipSignal] : [])
    ]);

    // Fill nulls for shops that hadn't responded yet (skipped by user)
    const responses = activeShops.map((shop, i) =>
        partialResults[i] || { html: null, url: shop.url + encodeURIComponent(cleanIdentifier) }
    );

    return {
        responses,
        foundPrice: responses.some(res => res?.html)
    };
}










// Hovedfunktion til at finde og sammenligne pris
async function findAndComparePrice() {
    const allowedShops = SHOPS.map(shop => shop.domain);
    const isAllowed = allowedShops.some(domain => window.location.href.includes(domain));
    if (!isAllowed) return;

    const shop = SHOPS.find(s => window.location.href.includes(s.domain));
    if (!shop) return;

    try {
        const productName = findProductName();
        const gtin = findGTIN();

        if (!gtin) {
            // Ingen GTIN fundet – vis besked direkte, ingen loader
            const noGtinMessage = `
                <h4 style="display:inline;font-weight:700;">Prissammenligning</h4>
                <p>Kan ikke finde match for dette produkt.</p>
                ${productName ? `<p><a href="https://www.ecosia.org/search?method=index&q=${encodeURIComponent(productName)}" target="_blank">Prøv en web-søgning 🔍</a></p>` : ''}
            `;
            insertComparisonTable(shop, noGtinMessage);
            return;
        }

        if (processedGTINs.has(gtin)) return;
        processedGTINs.set(gtin, true);

        // Beregn aktive shops (samme filter som searchWithIdentifier bruger)
        const activeShops = SHOPS.filter(s => !enabledShops.hasOwnProperty(s.domain) || enabledShops[s.domain]);

        // Skip-signal: resolves når brugeren trykker "Spring over"
        let skipResolve;
        const skipSignal = new Promise(resolve => { skipResolve = resolve; });

        // Fjern gammel tabel og vis loader med per-shop rækker + skip-knap
        document.querySelectorAll('.price-comparison-table').forEach(el => el.remove());
        insertLoadingPlaceholder(shop, activeShops, skipResolve);

        // Callback: opdater den pågældende shop-række når dens promise resolver
        const onShopResult = (domain, status) => {
            const row = document.querySelector(`[data-domain="${domain}"]`);
            if (!row) return;
            const spinner = row.querySelector('.shop-spinner');
            if (spinner) spinner.remove();
            const icon = document.createElement('span');
            icon.style.cssText = 'width:10px;height:10px;font-size:11px;line-height:10px;display:inline-block;flex-shrink:0;';
            if (status === 'timeout') {
                icon.textContent = '⏱';
                icon.style.color = '#bbb';
            } else {
                icon.textContent = status ? '✓' : '✗';
                icon.style.color = status ? '#4caf50' : '#bbb';
            }
            row.prepend(icon);
        };

        // Hent priser fra alle shops (med skip-mulighed)
        let { responses } = await searchWithIdentifier(gtin, 'GTIN', onShopResult, skipSignal);

        // Tilføj det aktuelle site med den allerede-indlæste produktside
        // så det originale shop altid indgår i sammenligningen
        const currentShop = SHOPS.find(s => window.location.hostname.includes(s.domain));
        if (currentShop) {
            // Fjern eventuel søgesideresultat for det aktuelle shop (produktsiden er mere præcis)
            responses = responses.filter(r => !r.url.includes(currentShop.domain));
            responses.push({
                html: document.documentElement.outerHTML,
                url: window.location.href
            });
        }

        // Markér eventuelle shops der stadig ventede (brugeren trykkede spring over)
        document.querySelectorAll('#pp-shop-status [data-domain] .shop-spinner').forEach(spinner => {
            const row = spinner.closest('[data-domain]');
            spinner.remove();
            const icon = document.createElement('span');
            icon.style.cssText = 'width:10px;height:10px;font-size:11px;line-height:10px;display:inline-block;flex-shrink:0;color:#bbb;';
            icon.textContent = '–';
            row.prepend(icon);
        });

        // Erstat loader med resultat
        document.querySelectorAll('.price-comparison-table').forEach(el => el.remove());
        displayPrice(responses, gtin, 'GTIN');
    } catch (error) {

        document.querySelectorAll('.price-comparison-table').forEach(el => el.remove());
        insertComparisonTable(shop, `
            <h4 style="display:inline;font-weight:700;">Prissammenligning</h4>
            <p>Der opstod en fejl. Prøv igen senere.</p>
        `);
    }
}




function generateNoProductsMessage(productName) {
    return `
        <div class="no-products-message">
            <h4 style="text-align: left !important;">Ingen match på ${productName || 'dette produkt'}</h4>
            <p style="text-align: left !important;">Vi kunne ikke finde dette produkt på andre shops</p>
        </div>
    `;
}




function processShopResponse(doc, url) {
    const shop = SHOPS.find(s => url.includes(s.domain));
    if (!shop) {

        return { shop: "Unknown", price: null, eurPrice: "No match", dkkPrice: "No match", shopUrl: url };
    }

    const priceElement = doc.querySelector(shop.priceSelector);
    if (!priceElement) {

        return { shop: shop.name, price: null, eurPrice: "No match", dkkPrice: "No match", shopUrl: url };
    }

    let priceText = priceElement.textContent.trim();
    // Remove "from" or "fra" (case insensitive)
    priceText = priceText.replace(/^(from|fra)\s*/i, "").trim();

    const priceData = convertPrice(priceText);

    return {
        shop: shop.name,
        price: priceText,
        eurPrice: priceData.eurValue || "No match",
        dkkPrice: priceData.dkkValue ? `${priceData.dkkValue.toFixed(2)}` : "No match",
        shopUrl: url
    };
}


function setupProductInfo() {
    // Get current URL info
    const currentUrl = window.location.href;
    const currentDomain = window.location.hostname;
    const timestamp = new Date().toISOString();

    // Get current shop info from SHOPS array
    const currentShop = SHOPS.find(shop => currentDomain.includes(shop.domain));

    // Get price information
    const { price, currency } = getCurrentPriceAndCurrency();

    // Get product name
    const productName = findProductName();

    // Initialize productInfo
    productInfo = {
        gtin: [],        // Will be filled by findGTIN()
        mpn: [],         // Will be filled by findMPN()
        shop: {
            name: currentShop?.name || '',
            url: currentUrl,
            domain: currentDomain
        },
        price: {
            amount: price,
            currency: currency,
            rawText: '',  // Will be filled by getCurrentPriceAndCurrency
            source: ''    // Will be filled by getCurrentPriceAndCurrency
        },
        product: {
            name: productName,
            category: '',  // Could be added if you have category detection
            brand: ''     // Could be added if you have brand detection
        },
        referrer: {
            url: currentUrl,
            price: price,
            timestamp: timestamp
        },
        detectedOn: currentDomain,
        foundTimestamp: timestamp
    };

    // Find identifiers
    findGTIN();  // This will populate productInfo.gtin
    findMPN();   // This will populate productInfo.mpn


}

initializeEnabledShops();

function generateComparisonTable(priceResults, identifierType, gtin = null) {

    const productName = productInfo.product.name;
    const currentDomain = window.location.hostname;
    const filteredResults = priceResults.filter(result =>
        !currentDomain.includes(new URL(result.shopUrl).hostname)
    );
    const sortedResults = [...filteredResults].sort((a, b) => Number(a.eurPrice) - Number(b.eurPrice));

    // If no products are found, return a "no products" message.
    if (filteredResults.length === 0) {
        return `
            <h4 style="display: inline; font-weight: 700;">Prissammenligning</h4>
            <p>
                <a href="https://www.ecosia.org/search?method=index&q=${encodeURIComponent(productName)}" target="_blank" title="Søg efter ${productName} på Ecosia">
                    Ingen andre butikker at sammenligne med.<br>Prøv en web-søgning 🔍
                </a>
            </p>
        `;
    }

    // Get current site's price (if available)
    const currentShop = SHOPS.find(shop => window.location.hostname.includes(shop.domain));
    const currentPrice = currentShop ? getCurrentPriceAndCurrency().price : null;
    const lowestPrice = Math.min(...filteredResults.map(result => Number(result.eurPrice)));
    const shouldHighlight = currentPrice === null || lowestPrice < currentPrice;

    // Generate a single table row for a shop
    const generateTableRow = (result, isHidden = false) => {
        const isLowestPrice = shouldHighlight && Number(result.eurPrice) === lowestPrice;
        const rowStyle = `${isLowestPrice ? 'font-weight: bold;' : 'font-weight: normal;'} ${isHidden ? 'display: none;' : ''}`;
        const mpnIndicator = identifierType === "MPN" ? '*' : '';

        return `
        <tr style="${rowStyle}" class="shop-row ${isHidden ? 'hidden-shop' : ''}">
            <td style="padding: 5px;">${result.shop}</td>
            <td style="padding: 5px;">${Math.round(Number(result.dkkPrice))} kr.${mpnIndicator}</td>
            <td style="padding: 5px;">
                ${result.price ? `<a href="${addUTMParameters(result.shopUrl)}"
                    class="track-click"
                    data-store="${result.shop}"
                    data-url="${result.shopUrl}"
                    data-name="${productName?.replace(/"/g, '&quot;')}"
                    data-price="${result.price}"
                    data-price-amount="${result.dkkPrice || ''}"
                    data-price-currency="DKK"
                    data-gtin="${cachedGTIN}"
                    data-referrer="${window.location.hostname}"
                    target="_blank">Se produkt</a>` : "-"}
            </td>
        </tr>`;
    };

    // Create arrays for visible and hidden rows
    const visibleRows = sortedResults.slice(0, 3).map(result => generateTableRow(result));
    const hiddenRows = sortedResults.slice(3).map(result => generateTableRow(result, true));

    // Build the toggle button HTML if there are any hidden rows
    const toggleButtonHtml = hiddenRows.length > 0 ? `
        <tr id="toggleRow">
            <td colspan="3" style="text-align: center; padding: 8px;">
                <a href="#" id="toggleShops" style="color: #f2994b; text-decoration: none; display: flex; align-items: center; justify-content: center;">
                    Vis alle shops (${hiddenRows.length} mere) ▼
                </a>
            </td>
        </tr>
    ` : '';

    // Prepare disclaimer text based on identifier type
    const disclaimerText = identifierType === "MPN" ?
        `<p style="font-size: 10px;"><strong>*Match fundet via butikkens varenummer - dette er et kvalificeret gæt</strong></p>` :
        `<p style="font-size: 10px;">Priser kan variere grundet anden model og/eller moms.</p>`;

    // Build the full table HTML with drop shadow added
    const tableHtml = `
        <style>
            .pp-table {
                font-family: Arial, sans-serif;
                border-collapse: collapse;
                width: 100%;
                text-align: left;
            }
            .pp-table th, .pp-table td {
                border: 1px solid #e8e8e8;
                padding: 8px 10px;
                text-align: left;
                font-size: 13px;
            }
            .pp-table th {
                background-color: #f8f8f8;
                font-size: 11px;
                color: #555;
                font-weight: 600;
            }
            .pp-table .shop-row { cursor: pointer; }
            .pp-table .shop-row:hover { background-color: #fafafa; }
            .pp-table .hidden-shop { display: none; }
            .pp-table a { color: #f2994b; text-decoration: none; }
            .pp-table a:hover { text-decoration: underline; }
        </style>
        ${cachedGTIN ? `<p style="margin:0 0 8px;font-size:11px;color:#999;"><a href="https://www.ecosia.org/search?method=index&q=${encodeURIComponent(cachedGTIN)}" target="_blank" style="color:#f2994b;">🔍 Søg EAN ${cachedGTIN} på nettet</a></p>` : ''}

        <table class="pp-table">
            <tr>
                <th style="padding: 5px; font-size: 10px;">Forhandler</th>
                <th style="padding: 5px; font-size: 10px;">Pris (DKK)</th>
                <th style="padding: 5px; font-size: 10px;">Link</th>
            </tr>
            ${visibleRows.join('')}
            ${hiddenRows.join('')}
            ${toggleButtonHtml}
        </table>
        <div style="margin-top:8px;font-size:10px;color:#888;">
            ${disclaimerText}
            <p style="margin:2px 0;">EUR-priser er omregnet med fast kurs ${EUR_TO_DKK_RATE} kr./€ og kan variere.</p>
        </div>
    `;

    // Instead of inserting the table directly, return it so displayPrice can use it
    return tableHtml;
}





function updateTableSafely(newHTML) {
    if (observer) {
        observer.disconnect();
    }
    const contentArea = document.querySelector('.pp-panel-content');
    if (contentArea) {
        const parsed = new DOMParser().parseFromString(newHTML, 'text/html');
        contentArea.replaceChildren(...Array.from(parsed.body.childNodes));
    } else {
        const tableContainer = document.querySelector('.price-comparison-table');
        if (tableContainer) {
            const parsed = new DOMParser().parseFromString(newHTML, 'text/html');
            tableContainer.replaceChildren(...Array.from(parsed.body.childNodes));
        } else {
            insertComparisonTable(null, newHTML);
        }
    }
/*     // Reattach the observer after a short delay to ensure the update is complete
    setTimeout(() => {
        setupMutationObserver();
    }, 100); */
}

let retryCount = 0;
const maxRetries = 10;
function addDkkPriceDisplay() {


    // Determine the current shop from your config
    const currentShop = SHOPS.find(shop => window.location.hostname.includes(shop.domain));
    if (!currentShop) {

        return;
    }


    let priceElement;

    // If the current shop is Bike-Discount, use the netz-price element,
    // but if it's not yet available, wait for it.
    if (currentShop.domain === 'bike-discount.de') {
        priceElement = document.querySelector('#netz-price');
        if (!priceElement) {

            // Wait a bit and try again
            setTimeout(addDkkPriceDisplay, 500);
            return;
        }
    } else {
        // For other shops, use the priceSelector from the shop config.
        priceElement = document.querySelector(currentShop.priceSelector);
        if (!priceElement) {

            return;
        }
    }


    // Get the current text content (for example, "15,75 €" or "5.881,31 €")
    const priceText = priceElement.textContent.trim();


    // Only proceed if the text includes the Euro symbol
    if (!priceText.includes('€')) {

        return;
    }

    // Check if the converted price is already displayed
    if (priceText.includes('kr')) {

        return; // Exit if the converted price is already present
    }

    // Extract the numeric value using a regular expression that accounts for both comma and dot
    const match = priceText.match(/([\d.,]+)/);
    if (!match) {

        return;
    }


    // Normalize the numeric string by removing thousands separators and converting decimal separators
    let numericString = match[1];
    // Check if the last occurrence of a comma or dot is a decimal separator
    const lastCommaIndex = numericString.lastIndexOf(',');
    const lastDotIndex = numericString.lastIndexOf('.');

    if (lastCommaIndex > lastDotIndex) {
        // Comma is the decimal separator
        numericString = numericString.replace(/\./g, '').replace(',', '.');
    } else {
        // Dot is the decimal separator
        numericString = numericString.replace(/,/g, '');
    }

    const numericPrice = parseFloat(numericString);
    if (isNaN(numericPrice)) {

        return;
    }

    // Convert the EUR price to DKK using the exchange rate from your config
    const convertedPrice = numericPrice * EXCHANGE_RATES.EUR_TO_DKK;

    // Update the element's text to include the conversion inline
    // For example: "15,75 € (117 kr)" — adjust formatting as needed.
    priceElement.textContent = `${priceText} (${convertedPrice.toFixed(0)} kr)`;

}






function insertComparisonTable(shop, comparisonMessage, retryCount = 0, summary = null, savings = 0) {
    if (!comparisonMessage || typeof comparisonMessage !== 'string') return;
    if (document.querySelector('.price-comparison-table')) return;
    if (comparisonMessage.includes('Vi kunne ikke finde en stegkode eller varenummer for dette produkt')) return;

    const widget = document.createElement('div');
    widget.classList.add('price-comparison-table');

    // Restore saved position, default bottom-right
    const savedPos = JSON.parse(sessionStorage.getItem('pp-pos') || 'null');
    widget.style.cssText = `position:fixed;bottom:${savedPos?.bottom ?? 24}px;right:${savedPos?.right ?? 24}px;z-index:2147483647;font-family:Arial,sans-serif;`;

    // Popup panel
    const panel = document.createElement('div');
    panel.className = 'pp-panel';
    panel.style.cssText = 'background:white;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.18);width:400px;max-width:calc(100vw - 48px);overflow:hidden;margin-bottom:8px;';

    // Panel header
    const hdr = document.createElement('div');
    hdr.style.cssText = 'background:#f2994b;color:white;padding:12px 16px;font-weight:700;font-size:14px;display:flex;justify-content:space-between;align-items:center;';
    const hdrTitle = document.createElement('span');
    hdrTitle.textContent = 'Prissammenligning';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'background:none;border:none;color:white;cursor:pointer;font-size:16px;padding:0;line-height:1;opacity:.85;';
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        panel.style.display = 'none';
        sessionStorage.setItem('pp-open', 'false');
    });
    hdr.appendChild(hdrTitle);
    hdr.appendChild(closeBtn);
    panel.appendChild(hdr);

    // Panel body
    const body = document.createElement('div');
    body.className = 'pp-panel-content';
    body.style.cssText = 'overflow-y:auto;max-height:60vh;padding:12px 16px;';
    const parsed = new DOMParser().parseFromString(comparisonMessage, 'text/html');
    Array.from(parsed.body.childNodes).forEach(node => body.appendChild(node));
    panel.appendChild(body);

    // Cart button
    if (lastCartPayload) {
        const cartFooter = document.createElement('div');
        cartFooter.style.cssText = 'padding:10px 16px 12px;border-top:1px solid #f0f0f0;';
        const cartBtn = document.createElement('button');
        cartBtn.style.cssText = 'width:100%;padding:8px 12px;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;';
        const itemId = lastCartPayload.gtin || (lastCartPayload.name + '|' + lastCartPayload.sourceDomain);

        isInCart(itemId).then(inCart => {
            cartBtn.textContent = inCart ? '✓ I kurven' : '➕ Tilføj til kurv';
            cartBtn.style.background = inCart ? '#e8f5e9' : '#fff3e0';
            cartBtn.style.color = inCart ? '#2e7d32' : '#e65100';
            cartBtn._ppInCart = inCart;
        });

        cartBtn.addEventListener('click', async () => {
            if (cartBtn._ppInCart) {
                await removeFromCart(itemId);
                cartBtn.textContent = '➕ Tilføj til kurv';
                cartBtn.style.background = '#fff3e0';
                cartBtn.style.color = '#e65100';
                cartBtn._ppInCart = false;
            } else {
                await addToCart(lastCartPayload);
                cartBtn.textContent = '✓ I kurven';
                cartBtn.style.background = '#e8f5e9';
                cartBtn.style.color = '#2e7d32';
                cartBtn._ppInCart = true;
            }
        });
        cartFooter.appendChild(cartBtn);
        panel.appendChild(cartFooter);
    }

    // Trigger button
    const btn = document.createElement('div');
    btn.style.cssText = 'background:#f2994b;color:white;border-radius:28px;padding:10px 18px;cursor:grab;box-shadow:0 4px 16px rgba(0,0,0,.2);font-size:13px;font-weight:600;display:flex;align-items:center;gap:8px;user-select:none;white-space:nowrap;';
    const btnIcon = document.createElement('span');
    btnIcon.textContent = '🔍';
    const btnLabel = document.createElement('span');
    btnLabel.textContent = summary || 'Vis prissammenligning';
    btn.appendChild(btnIcon);
    btn.appendChild(btnLabel);

    // Drag logic — distinguish click from drag
    let isDragging = false, hasDragged = false, dragX, dragY, dragRight, dragBottom;

    btn.addEventListener('mousedown', (e) => {
        isDragging = true;
        hasDragged = false;
        dragX = e.clientX;
        dragY = e.clientY;
        dragRight = parseInt(widget.style.right) || 24;
        dragBottom = parseInt(widget.style.bottom) || 24;
        btn.style.cursor = 'grabbing';
        e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - dragX, dy = e.clientY - dragY;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) hasDragged = true;
        widget.style.right = Math.max(0, dragRight - dx) + 'px';
        widget.style.bottom = Math.max(0, dragBottom - dy) + 'px';
    });
    document.addEventListener('mouseup', () => {
        if (!isDragging) return;
        isDragging = false;
        btn.style.cursor = 'grab';
        if (hasDragged) {
            sessionStorage.setItem('pp-pos', JSON.stringify({
                right: parseInt(widget.style.right),
                bottom: parseInt(widget.style.bottom)
            }));
        }
    });

    // Toggle open/close on click (ignored if was a drag)
    btn.addEventListener('click', () => {
        if (hasDragged) return;
        const isOpen = panel.style.display !== 'none';
        panel.style.display = isOpen ? 'none' : 'block';
        sessionStorage.setItem('pp-open', isOpen ? 'false' : 'true');
    });

    widget.appendChild(panel);
    widget.appendChild(btn);
    document.body.appendChild(widget);

    // Restore open/closed state — default open so user sees results immediately
    panel.style.display = sessionStorage.getItem('pp-open') === 'false' ? 'none' : 'block';

    PriceTracker.attachTrackingHandlers();
    initializeToggleFunctionality();
}



/* function insertPriceComparison(comparisonMessage, retryCount = 0) {
    const maxRetries = 5;
    const retryDelay = 1000;

    if (document.querySelector('.price-comparison-table')) {
        return;
    }
    // Don't show the table if it's the "no barcode" message
    if (comparisonMessage.includes('Vi kunne ikke finde en stegkode eller varenummer for dette produkt')) {

        return;
    }
    const mpnElement = document.querySelector('[itemprop="mpn"]') || 
                       document.querySelector('[itemprop="sku"]') || 
                       document.querySelector('.product-id.site-text-xs') || 
                       document.querySelector('h1');

    if (!mpnElement && retryCount < maxRetries) {
        setTimeout(() => {
            insertPriceComparison(comparisonMessage, retryCount + 1);
        }, retryDelay);
        return;
    }
    const comparisonDiv = document.createElement('div');
    comparisonDiv.classList.add('price-comparison-table');
    comparisonDiv.innerHTML = comparisonMessage;
    comparisonDiv.style.marginTop = '10px';
    comparisonDiv.style.padding = '10px';
    comparisonDiv.style.border = '1px solid #ccc';
    if (mpnElement) {
        mpnElement.parentNode.insertBefore(comparisonDiv, mpnElement.nextSibling);
    } else {
        document.body.insertBefore(comparisonDiv, document.body.firstChild);
    }
    PriceTracker.attachTrackingHandlers();
} */


function setupMutationObserver() {
    if (observer) {
        observer.disconnect();
    }

    const targetNode = document.querySelector('.product-details') ||
                      document.querySelector('.main-content') ||
                      document.body;

    if (!targetNode) return;

    const config = {
        childList: true,
        subtree: false,
        attributes: true,
        attributeFilter: ['content', 'value', 'itemprop', 'class']
    };

    observer = new MutationObserver((mutations) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            if (!isUpdating) {
                const shouldUpdate = mutations.some(mutation => {
                    if (mutation.target.closest && mutation.target.closest('.price-comparison-table')) return false;
                    return mutation.target.matches && mutation.target.matches('.price, [itemprop="price"]');
                });
                if (shouldUpdate) {
                    debouncedPriceUpdate();
                }
            }
        }, 250);
    });

    observer.observe(targetNode, config);
}




// URL change detection (for SPAs)
new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
        lastUrl = url;
        handleNavigation();
        setupMutationObserver();
    }
}).observe(document.querySelector('body'), {subtree: true, childList: true});

function handleNavigation() {

    gtinSearchAttempts = 0;
    cachedGTIN = null;
    lastCartPayload = null;
    processedGTINs.clear();
    findAndComparePrice();
    addDkkPriceDisplay();
}

// Initial run
handleNavigation();

/* // Listen for URL changes
let lastUrl = location.href;
new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
        lastUrl = url;
        handleNavigation();
    }
}).observe(document.querySelector('body'), {subtree: true, childList: true}); */

// Standard navigation events
window.addEventListener('pushstate', handleNavigation);
window.addEventListener('replacestate', handleNavigation);
window.addEventListener('popstate', handleNavigation);

/* // Additional events that might indicate page changes
window.addEventListener('load', handleNavigation);
document.addEventListener('DOMContentLoaded', handleNavigation); */

// Add URL change detection through History API override
const pushState = history.pushState;
history.pushState = function() {
    pushState.apply(history, arguments);
    handleNavigation();
};

const replaceState = history.replaceState;
history.replaceState = function() {
    replaceState.apply(history, arguments);
    handleNavigation();
};

function extractPrice(element) {
    if (!element) return null;

    // Get text content and clean it
    let priceText = element.textContent.trim();
    
    // Remove any currency symbols and normalize decimal separator
    priceText = priceText.replace(/[£$€]/g, '')  // Remove currency symbols
                         .replace(/,/g, '.')       // Normalize decimal separator
                         .replace(/[^\d.]/g, '')   // Remove any non-digit characters except decimal point
                         .trim();

    // Convert to number
    const price = parseFloat(priceText);

    // Validate the price
    if (isNaN(price) || price <= 0 || price > 100000) { // Assuming no bike part costs more than 100,000

        return null;
    }

    return price;
}

function buildSearchUrl(shop, searchTerm, gtin) {
    // Replace GTIN placeholder in URL if it exists
    let url = shop.url.replace('{gtin}', encodeURIComponent(gtin || searchTerm));
    
    // For shops with a urlSuffix property
    if (shop.urlSuffix) {
        return `${url}${shop.urlSuffix}`;
    }
    // For standard shops
    return url;
}

function formatPriceWithConversion(price, currency) {
    if (currency === 'EUR') {
        const convertedPrice = price * EXCHANGE_RATES.EUR_TO_DKK;
        // You can adjust the decimal formatting as needed.
        return `${price} € (${convertedPrice.toFixed(0)} kr)`;
    }
    // If the price is not in EUR, just return it as is (or add other conversions if needed)
    return `${price} ${currency}`;
}

function processSearchResults(searchResults) {
    let noProductsFound = true;  // Define the variable at the start of the function
    
    if (!searchResults || searchResults.length === 0) {

        return;
    }

    searchResults.forEach(result => {
        if (result.price) {
            noProductsFound = false;  // Set to false if we find any products
            const currentPrice = extractPrice(result.priceElement);
            const comparisonPrice = result.price;

/*             if (!validatePrice(currentPrice, comparisonPrice)) {

                return;
            }
            // Continue processing the valid result... */
        }
    });

/*     if (noProductsFound) {

    } */
}




function initializeToggleFunctionality() {
    const hiddenRowsNodes = document.querySelectorAll('.hidden-shop');
    const toggleButton = document.getElementById('toggleShops');

    if (!toggleButton) return;
    if (toggleButton.getAttribute('data-listener-attached') === 'true') return;

    toggleButton.addEventListener('click', function(e) {
        e.preventDefault();
        const currentlyHidden = Array.from(hiddenRowsNodes).some(row => {
            return window.getComputedStyle(row).display === 'none';
        });

        if (currentlyHidden) {
            hiddenRowsNodes.forEach(row => { row.style.display = 'table-row'; });
            toggleButton.textContent = 'Skjul ekstra shops ▲';
        } else {
            hiddenRowsNodes.forEach(row => { row.style.display = 'none'; });
            toggleButton.textContent = `Vis alle shops (${hiddenRowsNodes.length} mere) ▼`;
        }
    });

    toggleButton.setAttribute('data-listener-attached', 'true');
}

async function addToCart(payload) {
    const data = await browser.storage.local.get('cart');
    const cart = data.cart || [];
    const id = payload.gtin || (payload.name + '|' + payload.sourceDomain);
    const filtered = cart.filter(item => item.id !== id);
    await browser.storage.local.set({ cart: [...filtered, {
        id, gtin: payload.gtin, name: payload.name,
        addedAt: new Date().toISOString(),
        sourceDomain: payload.sourceDomain, sourceUrl: payload.sourceUrl,
        prices: payload.prices, bestPrice: payload.bestPrice
    }] });
}

async function removeFromCart(id) {
    const data = await browser.storage.local.get('cart');
    await browser.storage.local.set({ cart: (data.cart || []).filter(i => i.id !== id) });
}

async function isInCart(id) {
    const data = await browser.storage.local.get('cart');
    return (data.cart || []).some(item => item.id === id);
}

