/* content.js */
// Disable all console.log statements
 // const originalConsoleLog = console.log; // Store the original console.log function
// console.log = function() {}; // Override console.log with a no-op function

// To re-enable logging later, you can restore the original function
// console.log = originalConsoleLog; // Uncomment this line to restore logging

console.log('Content script loaded');
console.log('Current URL:', window.location.href);

// Now you can use the globally available config objects
console.log('Loaded shops:', SHOPS);
console.log('Exchange rates:', EXCHANGE_RATES);

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
    console.log('Initialized enabled shops:', enabledShops);
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

// Get current site information
let { price: currentPrice, currency: currentCurrency } = getCurrentPriceAndCurrency();
console.log('Current price:', currentPrice, 'Currency:', currentCurrency);

/* // Convert to EUR for comparison
const currentPriceEUR = currentCurrency === 'EUR' ? currentPrice : currentPrice / EUR_TO_DKK_RATE;
console.log('Price in EUR:', currentPriceEUR); */

const convertEurToDkk = (priceInEur) => priceInEur * EUR_TO_DKK_RATE;
const convertDkkToEur = (priceInDkk) => priceInDkk / EUR_TO_DKK_RATE;


function showLoadingState() {
    const existingTable = document.querySelector('.price-comparison-table');
    if (existingTable) {
        existingTable.style.opacity = '0.5';
        const loading = document.createElement('div');
        loading.className = 'price-loading';
        loading.innerHTML = 'Henter priser...';
        loading.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);';
        existingTable.appendChild(loading);
    }
}

function hideLoadingState() {
    const existingTable = document.querySelector('.price-comparison-table');
    if (existingTable) {
        existingTable.style.opacity = '1';
        const loading = existingTable.querySelector('.price-loading');
        if (loading) loading.remove();
    }
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
        console.log(`❌ Invalid price for conversion: ${price}`);
        return null;
    }

    switch (currency?.toUpperCase()) {
        case 'EUR': return price;
        case 'DKK': return price / EXCHANGE_RATES.EUR_TO_DKK;
        case 'GBP': return price / EXCHANGE_RATES.EUR_TO_GBP;
        case 'USD': return price / EXCHANGE_RATES.EUR_TO_USD;
        default:
            console.log(`❌ Unsupported currency: ${currency}, defaulting to EUR`);
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
            console.warn(`Unsupported currency: ${currency}`);
            return null;
    }
}

function displayPrice(responses, identifier, identifierType) {
    const currentPriceInfo = getCurrentPriceAndCurrency();
    if (!currentPriceInfo.price) {
        console.log('❌ No price found on current page');
        return;
    }

    // Process all responses in parallel
    const priceResults = responses
        .filter(response => response?.html)
        .map(response => {
            const shop = SHOPS.find(s => response.url.includes(s.domain));
            if (!shop || (enabledShops[shop.domain] === false)) return null;

            const doc = new DOMParser().parseFromString(response.html, 'text/html');
            const priceElement = doc.querySelector(shop.priceSelector);
            if (!priceElement) return null;

            const priceText = priceElement.textContent.trim();
            const { price, currency } = extractPriceAndCurrency(priceText);
            if (!price) return null;

/*             const validation = validatePrice(
                price,
                currentPriceInfo.price,
                currency,
                currentPriceInfo.currency,
                { debugLog: true }
            ); */

/*             if (!validation.isValid) return null; */

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
        generateComparisonTable(priceResults, identifierType, productName);

    console.log('Generated comparisonMessage:', comparisonMessage); // Debugging log

    // Ensure the shop object is passed correctly
    const shop = SHOPS.find(s => window.location.href.includes(s.domain));
    if (shop) {
        insertComparisonTable(shop, comparisonMessage);
    } else {
        console.error('No matching shop found for the current URL');
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

    // Use the configured price selector for the current shop
    const priceElement = document.querySelector(currentShop.priceSelector);
    if (!priceElement) {
        console.log('❌ No price element found using configured selector');
        return { price: null, currency: null };
    }

    // Extract price text from the configured selector
    let priceText = priceElement.textContent?.trim() || priceElement.getAttribute('content')?.trim();
    if (!priceText) {
        console.log('❌ No price text found in the price element');
        return { price: null, currency: null };
    }

    // Normalize and extract the price
    const price = normalizePrice(priceText);
    const currency = detectCurrencyFromText(priceText, currentShop.defaultCurrency);

    if (price !== null) {
        console.log('✅ Found price using configured selector:', { price, currency });
        return { price, currency };
    }

    console.log('❌ Failed to extract a valid price');
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
            console.log('❌ Failed to parse price:', priceText);
            return null;
        }

        console.log('✅ Parsed price:', { original: priceText, normalized: numericPrice });
        return numericPrice;
    } catch (error) {
        console.error('Error normalizing price:', error);
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
        console.error('Error parsing JSON-LD:', e);
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
    let currency = 'EUR';
    if (text.includes('kr') || text.includes('DKK')) currency = 'DKK';

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
        console.log('❌ Failed to parse price:', priceText);
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
        if (debugLog) console.log('❌ Invalid price values:', { sourcePrice, targetPrice });
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
        if (debugLog) console.log('❌ Currency conversion failed:', { sourcePriceEUR, targetPriceEUR });
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

    if (debugLog) {
        console.log('Price validation:', {
            sourcePriceEUR: sourcePriceEURNum.toFixed(2),
            targetPriceEUR: targetPriceEURNum.toFixed(2),
            minimumPrice: minimumPriceNum.toFixed(2),
            maximumPrice: maximumPriceNum.toFixed(2),
            isValid,
            isTooLow,
            isTooHigh
        });
    }

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
    console.log('Gtin from JSON LD initiated')
	try {
        const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
        for (const script of scripts) {
            try {
                const parsedData = JSON.parse(script.textContent);
                // Normalize to an array if it's not already one
                const dataArray = Array.isArray(parsedData) ? parsedData : [parsedData];
                
                console.log('Parsed JSON-LD data:', dataArray);
                
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
                                        console.log('✅ Found GTIN in product variant offer:', offer.gtin);
                                        productInfo.gtin.push({
                                            value: offer.gtin,
                                            source: 'JSON-LD Product Variant Offer',
                                            url: window.location.href
                                        });
                                        return offer.gtin;
                                    } else {
                                        console.log('❌ GTIN not found in offer:', offer);
                                    }
                                }
                            }
                        }
                    }
                    
                    // Case 2: Single Product schema
                    if (data['@type'] === 'Product') {
                        if (data.gtin) {
                            console.log('✅ Found GTIN in product schema:', data.gtin);
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
                    console.log('✅ Found 13-digit number(s) as fallback:', matches);
                    productInfo.gtin.push({
                        value: matches[0],
                        source: 'Fallback 13-digit number',
                        url: window.location.href
                    });
                    return matches[0];
                }
            } catch (e) {
                console.error('Error parsing individual JSON-LD script:', e);
            }
        }
    } catch (e) {
        console.error('Error accessing scripts:', e);
    }
    return null;
} */

function findGTIN() {
    // Return cached GTIN if we already found one
    if (cachedGTIN) {
        console.log('✅ Using cached GTIN:', cachedGTIN);
        return cachedGTIN;
    }

    // Check if we've exceeded the maximum attempts
    if (gtinSearchAttempts >= MAX_GTIN_SEARCH_ATTEMPTS) {
        console.log('🛑 Maximum GTIN search attempts reached');
        return null;
    }
    gtinSearchAttempts++;

    console.log('🔄 Searching for GTIN...');

    // Reset GTIN list before extracting new GTINs
    productInfo.gtin = [];

    // 1. Try to find GTIN in a table cell labeled "EAN"
    const eanRows = document.querySelectorAll('tr');
    for (const row of eanRows) {
        const cells = row.getElementsByTagName('td');
        if (cells.length >= 2 && cells[0].textContent.trim().toLowerCase() === 'ean') {
            const gtin = cells[1].textContent.trim().replace(/[^0-9]/g, '');
            if (gtin.length >= 8 && gtin.length <= 14) {
                console.log(`✅ Found GTIN from table: ${gtin}`);
                productInfo.gtin.push({
                    value: gtin,
                    source: 'Table EAN cell',
                    url: window.location.href
                });
                cachedGTIN = gtin;
                return gtin;
            }
        }
    }

    // 2. Bike-Discount specific: check for netz-ean element
    if (window.location.hostname.includes('bike-discount.de')) {
        const netzEan = document.querySelector('.netz-ean');
        if (netzEan) {
            const gtin = netzEan.textContent?.trim().replace(/[^0-9]/g, '') || '';
            if (gtin.length >= 8 && gtin.length <= 14) {
                console.log(`✅ Found GTIN from netz-ean: ${gtin}`);
                productInfo.gtin.push({
                    value: gtin,
                    source: 'netz-ean class',
                    url: window.location.href
                });
                cachedGTIN = gtin;
                return gtin;
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

    console.log("🔍 Searching for GTIN using HTML selectors...");
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
                console.log(`✅ Found GTIN: ${finalGTIN} (Selector: '${selector}')`);
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
    console.log("🔍 No GTIN found in HTML. Checking JSON-LD...");
    let foundGtinFromJSONLD = null;
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (let i = 0; i < scripts.length; i++) {
        try {
            const parsedData = JSON.parse(scripts[i].textContent);
            // Normalize to an array if not already
            const dataArray = Array.isArray(parsedData) ? parsedData : [parsedData];
            console.log('Parsed JSON-LD data:', dataArray);
            for (const data of dataArray) {
                // Case A: ProductGroup with variants
                if (data['@type'] === 'ProductGroup' && data.hasVariant) {
                    const variants = Array.isArray(data.hasVariant) ? data.hasVariant : [data.hasVariant];
                    for (const variant of variants) {
                        if (variant.offers) {
                            const offers = Array.isArray(variant.offers) ? variant.offers : [variant.offers];
                            for (const offer of offers) {
                                if (offer.gtin) {
                                    console.log('✅ Found GTIN in JSON-LD product variant offer:', offer.gtin);
                                    productInfo.gtin.push({
                                        value: offer.gtin,
                                        source: `JSON-LD Script #${i + 1} (Variant Offer)`,
                                        url: window.location.href
                                    });
                                    foundGtinFromJSONLD = offer.gtin;
                                    break;
                                } else {
                                    console.log('❌ GTIN not found in JSON-LD variant offer:', offer);
                                }
                            }
                        }
                        if (foundGtinFromJSONLD) break;
                    }
                }
                // Case B: Single Product schema
                if (!foundGtinFromJSONLD && data['@type'] === 'Product') {
                    if (data.gtin) {
                        console.log('✅ Found GTIN in JSON-LD product schema:', data.gtin);
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
                    console.log('✅ Found fallback 13-digit number(s) in JSON-LD:', matches);
                    productInfo.gtin.push({
                        value: matches[0],
                        source: 'Fallback 13-digit number in JSON-LD',
                        url: window.location.href
                    });
                    foundGtinFromJSONLD = matches[0];
                }
            }
        } catch (e) {
            console.error(`❌ Error parsing JSON-LD script #${i + 1}:`, e);
        }
        if (foundGtinFromJSONLD) break;
    }

    // Cache and return the found GTIN if found either by HTML or JSON-LD
    const foundGTIN = productInfo.gtin.length > 0 ? productInfo.gtin[0].value : null;
    if (foundGTIN) {
        cachedGTIN = foundGTIN;
    }
    console.log("Found GTINs:", productInfo.gtin);
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
                console.log(`✅ Found MPN: ${mpnValue} (Selector: '${selector}')`);
                return mpnValue; // STOP once we find a valid MPN
            }
        }
    }

    console.log('❌ No MPN found');
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
            
            console.log('Sending data:', clickData); 
            
            const response = await fetch('https://jrgrafisk.dk/php-endpoint.php', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(clickData)
            });
            
            const responseText = await response.text();
            console.log('Raw response:', responseText);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}, response: ${responseText}`);
            }
            
            try {
                const result = JSON.parse(responseText);
                console.log('Click tracked successfully:', result);
            } catch (parseError) {
                console.error('JSON Parse Error:', parseError);
                console.error('Invalid JSON response:', responseText);
            }
        } catch (error) {
            console.error('Error tracking click:', {
                message: error.message,
                error: error
            });
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
                console.error('Missing required tracking data');
                return;
            }

            // Log the collected data
            console.log('Tracking click:', { store, url, name, price, gtin, mpn, referrer });

            // Prevent default navigation temporarily
            event.preventDefault();

            // Track click then navigate
            trackClick(store, url, name, price, gtin, mpn, referrer)
                .then(() => {
                    window.location.href = url;
                })
                .catch(error => {
                    console.error('Error:', error);
                    window.location.href = url; // Navigate anyway
                });
        } catch (error) {
            console.error('Error in click handler:', error);
        }
    }

    function attachTrackingHandlers() {
        try {
            const links = document.querySelectorAll('.track-click');
            console.log('Found tracking links:', links.length);
            
            links.forEach(link => {
                // Remove existing handlers to prevent duplicates
                link.removeEventListener('click', handleClick);
                link.addEventListener('click', handleClick);
            });
        } catch (error) {
            console.error('Error attaching tracking handlers:', error);
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
        console.error('Error adding UTM parameters:', error);
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
            console.log('MPN element HTML:', mpnElement.outerHTML);

            // Retrieve MPN value from text content, content attribute, or data-ean attribute
            const mpnValue = mpnElement.textContent.trim() || 
                             mpnElement.getAttribute('content') || 
                             mpnElement.getAttribute('data-ean');
                             
            // Log found MPN value
            console.log(`MPN found with selector ${selector}:`, mpnValue);
            
            // Return the value if it's not empty
            if (mpnValue) return mpnValue; 
        }
    }

    // If no MPN found, log and return null
    console.log('No MPN found');
    return null;
} */

/* function extractProductData() {
    const gtin = findGTIN(); // Prioritize GTIN

    if (gtin) {
        console.log('Using GTIN:', gtin);
    } else {
        console.log('GTIN No match, checking for MPN...');
        const mpn = findMPN(); // Only check MPN if GTIN is not available

        if (mpn) {
            console.log('Using MPN:', mpn);
        } else {
            console.log('No GTIN or MPN found, cannot proceed.');
        }
    }
} */


function checkIdentifiers() {
    findGTIN();  // This now collects GTINs into productInfo
    findMPN();   // This should collect MPNs into productInfo

    console.log('Found product identifiers:', {
        gtins: productInfo.gtin,
        mpns: productInfo.mpn
    });

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
        console.error('Error converting price:', error);
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
                console.log(`✅ Product name found with selector ${selector}:`, productName);
                productInfo.product.name = productName; // Store the name
                return productName;
            }
        }
    }

    console.log('❌ Could not find product name');
    return null;
}




/* function findMPN() {
    // Try to get the MPN (Sku) from the <span itemprop="sku">
    const mpn = document.querySelector('[itemprop="sku"]');
    if (mpn) {
        const mpnValue = mpn.textContent.trim();
        if (mpnValue) {
            console.log('MPN found:', mpnValue);
            return mpnValue;
        } else {
            console.log('MPN found but it was empty after trimming');
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
                console.log('MPN found via fallback selector:', selector, fallbackMPNValue);
                return fallbackMPNValue;
            } else {
                console.log(`Fallback MPN found with selector ${selector}, but value was empty`);
            }
        }
    }

    // If no MPN is found, return null
    console.log('No MPN found');
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
                        console.log('Found product data in JSON-LD:', { gtin, price });
                        return { gtin, price };
                    }
                }
            }
        } catch (e) {
            console.error('Error parsing JSON-LD:', e);
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



async function searchWithIdentifier(identifier, identifierType) {
    console.log(`🔍 Starter søgning efter ${identifier} (${identifierType})`);

    // Clean the identifier
    const cleanIdentifier = identifier.replace(/^Item number:\s*/i, '').trim();

    // Only search enabled shops
    const activeShops = SHOPS.filter(shop => !enabledShops.hasOwnProperty(shop.domain) || enabledShops[shop.domain]);

    // Make all requests in parallel
    const responses = await Promise.all(
        activeShops.map(async shop => {
            try {
                console.log(`🔎 Søger på ${shop.name} med selector: ${shop.priceSelector}...`);
                const url = shop.domain === 'r2-bike.com' 
                    ? buildSearchUrl(shop, cleanIdentifier, cleanIdentifier)  // Use GTIN for R2 Bike
                    : shop.url + encodeURIComponent(cleanIdentifier);  // Use regular search for other shops
                const response = await browser.runtime.sendMessage({
                    action: 'findPrice',
                    identifier: cleanIdentifier,
                    url: url
                });
                return response || { html: null, url: shop.url + encodeURIComponent(cleanIdentifier) };
            } catch (error) {
                console.error(`❌ Fejl ved søgning på ${shop.name}:`, error);
                return { html: null, url: shop.url + encodeURIComponent(cleanIdentifier) };
            }
        })
    );

    return {
        responses,
        foundPrice: responses.some(res => res?.html)
    };
}










// Hovedfunktion til at finde og sammenligne pris
async function findAndComparePrice() {
    try {
        showLoadingState();
        console.log('🔍 Starter prissammenligning...');

        // Clear previous price data before fetching new ones
        let priceResults = [];

        const allowedShops = SHOPS.map(shop => shop.domain);
        const isAllowed = allowedShops.some(domain => window.location.href.includes(domain));

        if (!isAllowed) {
            console.log('❌ Forkert side, stopper.');
            return;
        }

        // Find produktnavn
        const productName = findProductName();
        console.log('📌 Produktnavn fundet:', productName);

        // Find GTIN og MPN
        let gtin = findGTIN();
        let searchIdentifier = gtin;
        let identifierType = gtin ? "GTIN" : "MPN";

        console.log(`🔍 Bruger ${identifierType}:`, searchIdentifier);

        // Hvis ingen GTIN eller MPN findes, vis Google-søgning
        if (!searchIdentifier) {
            console.log('❌ Ingen GTIN eller MPN fundet.');
            const errorMessage = `
                <h4 style="display: inline; font-weight: 700;">Prissammenligning</h4>
                <p>Vi kunne ikke finde en stegkode eller varenummer for dette produkt.</p>
                ${productName ?
                    `<p><a href="https://www.ecosia.org/search?method=index&q=${encodeURIComponent(productName)}" target="_blank" title="Søg efter ${productName} på Ecosia">Prøv en web-søgning 🔍</a></p>` :
                    ''}
            `;
            const shop = SHOPS.find(s => window.location.href.includes(s.domain));
            if (shop) {
                insertComparisonTable(shop, errorMessage);
            } else {
                console.error('No matching shop found for the current URL');
            }
            return;
        }

        // 🔍 Undgå at søge efter samme GTIN flere gange
        if (processedGTINs.has(searchIdentifier)) {
            console.log(`⚠️ ${identifierType} ${searchIdentifier} er allerede behandlet. Skipping.`);
            return;
        }

        processedGTINs.set(searchIdentifier, true); // Markér som behandlet

        // 🔄 **Clear previous prices before fetching new ones**
        document.querySelectorAll('.price-comparison-table').forEach(el => el.remove());

        // 🔍 Fetch new prices
        const { responses: primaryResponses, foundPrice: primaryFound } = await searchWithIdentifier(searchIdentifier, identifierType);

        // Hvis vi fandt en pris, vis den på siden
        displayPrice(primaryResponses, searchIdentifier, identifierType);
    } catch (error) {
        console.error('Error in price comparison:', error);
        const errorMessage = `
            <h4 style="display: inline; font-weight: 700;">Prissammenligning</h4>
            <p>Der opstod en fejl under hentning af priser. Prøv igen senere.</p>
        `;
        const shop = SHOPS.find(s => window.location.href.includes(s.domain));
        if (shop) {
            insertComparisonTable(shop, errorMessage);
        } else {
            console.error('No matching shop found for the current URL');
        }
    } finally {
        hideLoadingState();
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
        console.log("🚨 Unknown shop:", url);
        return { shop: "Unknown", price: null, eurPrice: "No match", dkkPrice: "No match", shopUrl: url };
    }

    const priceElement = doc.querySelector(shop.priceSelector);
    if (!priceElement) {
        console.log(`❌ No price element found for ${shop.name}`);
        return { shop: shop.name, price: null, eurPrice: "No match", dkkPrice: "No match", shopUrl: url };
    }

    let priceText = priceElement.textContent.trim();
    // Remove "from" or "fra" (case insensitive)
    priceText = priceText.replace(/^(from|fra)\s*/i, "").trim();

    const priceData = convertPrice(priceText);
    
    console.log(`✅ Price found on ${shop.name}:`, {
        originalText: priceText,
        eurValue: priceData.eurValue,
        dkkValue: priceData.dkkValue
    });

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

    console.log('Product Info Setup Complete:', productInfo);
}

initializeEnabledShops();

function generateComparisonTable(priceResults, identifierType, gtin = null) {
    console.log("🔍 Running generateComparisonTable()...");

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
            <td style="padding: 5px;">${Number(result.eurPrice).toFixed(2)}${mpnIndicator}</td>
            <td style="padding: 5px;">${Number(result.dkkPrice).toFixed(2)}${mpnIndicator}</td>
            <td style="padding: 5px;">
                ${result.price ? `<a href="${addUTMParameters(result.shopUrl)}"
                    class="track-click"
                    data-store="${result.shop}"
                    data-url="${result.shopUrl}"
                    data-name="${productName?.replace(/"/g, '&quot;')}"
                    data-price="${result.price}"
                    data-price-amount="${result.eurPrice || ''}"
                    data-price-currency="EUR"
                    data-gtin="${cachedGTIN}"
                    data-referrer="${window.location.hostname}"
                    target="_blank">${window.location.hostname.includes('bike-components') || window.location.hostname.includes('r2-bike') || window.location.hostname.includes('bike-discount') ? 'Vis' : 'Se produkt'}</a>` : "-"}
            </td>
        </tr>`;
    };

    // Create arrays for visible and hidden rows
    const visibleRows = sortedResults.slice(0, 3).map(result => generateTableRow(result));
    const hiddenRows = sortedResults.slice(3).map(result => generateTableRow(result, true));

    // Build the toggle button HTML if there are any hidden rows
    const toggleButtonHtml = hiddenRows.length > 0 ? `
        <tr id="toggleRow">
            <td colspan="4" style="text-align: center; padding: 8px;">
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
            .price-comparison-table {
                font-family: Arial, sans-serif;
                border-collapse: collapse;
                width: 100%;
                border: 1px solid #f2994b;
                text-align: left !important;
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            }
            .price-comparison-table th, .price-comparison-table td {
                border: 1px solid #c0c0c0;
                padding: 1rem;
                text-align: left !important;
            }
            .price-comparison-table th {
                background-color: #f0f0f0;
            }
            .price-comparison-table .shop-row {
                cursor: pointer;
            }
            .price-comparison-table .shop-row:hover {
                background-color: #f1f1f1;
            }
            .price-comparison-table .hidden-shop {
                display: none;
            }
        </style>
        <h4 style="display: inline; font-weight: 700;">Prissammenligning</h4>
        <p style="display: inline;">
            ${productName ?
                `<a href="https://www.ecosia.org/search?method=index&q=${encodeURIComponent(productName)}" target="_blank" title="Søg efter ${productName} på Ecosia">🔍</a>` :
                '-'
            }
        </p>
        
        <table class="price-comparison-table">
            <tr>
                <th style="padding: 5px; font-size: 10px;">Forhandler</th>
                <th style="padding: 5px; font-size: 10px;">Pris i EUR</th>
                <th style="padding: 5px; font-size: 10px;">Pris i DKK</th>
                <th style="padding: 5px; font-size: 10px;">Link</th>
            </tr>
            ${visibleRows.join('')}
            ${hiddenRows.join('')}
            ${toggleButtonHtml}
        </table>
        <div class="md:mr-1" style="margin-top: 10px; font-size: 8px !important; color: #666;">
            <p style="font-size: 10px;">Dette er kun en vejledning. Fast valutakurs på EUR: ${EUR_TO_DKK_RATE}.</p>
            ${disclaimerText}
            <p style="font-size: 10px;"><strong>OBS:</strong> Sørg for at vælge Denmark øverst på Bike Discount for at få den korrekte pris.</p>
        </div>
    `;

    // Instead of inserting the table directly, return it so displayPrice can use it
    return tableHtml;
}





function updateTableSafely(newHTML) {
    // Disconnect observer to prevent it from reacting to our changes
    if (observer) {
        observer.disconnect();
    }
    const tableContainer = document.querySelector('.price-comparison-table');
    if (tableContainer) {
        tableContainer.innerHTML = newHTML;
    } else {
        insertComparisonTable(newHTML);
    }
/*     // Reattach the observer after a short delay to ensure the update is complete
    setTimeout(() => {
        setupMutationObserver();
    }, 100); */
}

let retryCount = 0;
const maxRetries = 10;
function addDkkPriceDisplay() {
    console.log('[addDkkPriceDisplay] Starting conversion process.');

    // Determine the current shop from your config
    const currentShop = SHOPS.find(shop => window.location.hostname.includes(shop.domain));
    if (!currentShop) {
        console.log('[addDkkPriceDisplay] No matching shop found for domain:', window.location.hostname);
        return;
    }
    console.log('[addDkkPriceDisplay] Found shop:', currentShop.name);

    let priceElement;

    // If the current shop is Bike-Discount, use the netz-price element,
    // but if it's not yet available, wait for it.
    if (currentShop.domain === 'bike-discount.de') {
        priceElement = document.querySelector('#netz-price');
        if (!priceElement) {
            console.log('[addDkkPriceDisplay] #netz-price element not found. Waiting for it to appear...');
            // Wait a bit and try again
            setTimeout(addDkkPriceDisplay, 500);
            return;
        }
    } else {
        // For other shops, use the priceSelector from the shop config.
        priceElement = document.querySelector(currentShop.priceSelector);
        if (!priceElement) {
            console.log('[addDkkPriceDisplay] Price element not found using selector:', currentShop.priceSelector);
            return;
        }
    }
    console.log('[addDkkPriceDisplay] Price element found:', priceElement);

    // Get the current text content (for example, "15,75 €" or "5.881,31 €")
    const priceText = priceElement.textContent.trim();
    console.log('[addDkkPriceDisplay] Original price text:', priceText);

    // Only proceed if the text includes the Euro symbol
    if (!priceText.includes('€')) {
        console.log('[addDkkPriceDisplay] Price text does not include Euro symbol.');
        return;
    }

    // Check if the converted price is already displayed
    if (priceText.includes('kr')) {
        console.log('[addDkkPriceDisplay] Converted price already displayed. Skipping conversion.');
        return; // Exit if the converted price is already present
    }

    // Extract the numeric value using a regular expression that accounts for both comma and dot
    const match = priceText.match(/([\d.,]+)/);
    if (!match) {
        console.log('[addDkkPriceDisplay] No numeric value found in price text.');
        return;
    }
    console.log('[addDkkPriceDisplay] Extracted numeric string:', match[1]);

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
        console.log('[addDkkPriceDisplay] Parsed price is NaN for numeric string:', numericString);
        return;
    }
    console.log('[addDkkPriceDisplay] Parsed price (EUR):', numericPrice);

    // Convert the EUR price to DKK using the exchange rate from your config
    const convertedPrice = numericPrice * EXCHANGE_RATES.EUR_TO_DKK;
    console.log('[addDkkPriceDisplay] Converted price (DKK):', convertedPrice);

    // Update the element's text to include the conversion inline
    // For example: "15,75 € (117 kr)" — adjust formatting as needed.
    priceElement.textContent = `${priceText} (${convertedPrice.toFixed(0)} kr)`;
    console.log('[addDkkPriceDisplay] Updated price element text:', priceElement.textContent);
}






function insertComparisonTable(shop, comparisonMessage, retryCount = 0) {
    const maxRetries = 5;
    const retryDelay = 1000;

    // Check that comparisonMessage is defined and is a string
    if (!comparisonMessage || typeof comparisonMessage !== 'string') {
        console.error("Comparison message is undefined or not a string. Aborting insertion.");
        return;
    }

    // Avoid duplicate tables
    if (document.querySelector('.price-comparison-table')) {
        return;
    }

    // Don't show the table if it's the "no barcode" message
    if (comparisonMessage.includes('Vi kunne ikke finde en stegkode eller varenummer for dette produkt')) {
        console.log('No barcode found - hiding comparison table');
        return;
    }

    const tableElement = document.createElement('div');
    tableElement.classList.add('price-comparison-table');
    tableElement.innerHTML = comparisonMessage;
    tableElement.style.marginTop = '10px';
    tableElement.style.padding = '10px';
    tableElement.style.border = '1px solid #ccc';

    let positionElement = document.querySelector(shop.tablePosition);
    if (positionElement) {
        positionElement.appendChild(tableElement);
    } else {
        const priceElements = document.querySelectorAll(shop.priceSelector);
        if (priceElements.length > 0) {
            priceElements[priceElements.length - 1].insertAdjacentElement('afterend', tableElement);
        } else if (retryCount < maxRetries) {
            setTimeout(() => {
                insertComparisonTable(shop, comparisonMessage, retryCount + 1);
            }, retryDelay);
        } else {
            console.error(`Neither primary position nor fallback (priceSelector) found for shop ${shop.name}`);
        }
    }

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
        console.log('No barcode found - hiding comparison table');
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
    console.log('🔄 Navigation detected:', location.href);
    gtinSearchAttempts = 0;
    cachedGTIN = null;
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
        console.log('Invalid price found:', priceText);
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
        console.log('No search results found');
        return;
    }

    searchResults.forEach(result => {
        if (result.price) {
            noProductsFound = false;  // Set to false if we find any products
            const currentPrice = extractPrice(result.priceElement);
            const comparisonPrice = result.price;

/*             if (!validatePrice(currentPrice, comparisonPrice)) {
                console.log('Price validation failed - skipping comparison');
                return;
            }
            // Continue processing the valid result... */
        }
    });

/*     if (noProductsFound) {
        console.log('No valid products found after price validation');
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

