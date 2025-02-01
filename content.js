console.log('Content script loaded');
console.log('Current URL:', window.location.href);

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
 
// Get current site information
let { price: currentPrice, currency: currentCurrency } = getCurrentPriceAndCurrency();
console.log('Current price:', currentPrice, 'Currency:', currentCurrency);

// Convert to EUR for comparison
const currentPriceEUR = currentCurrency === 'EUR' ? currentPrice : currentPrice / EUR_TO_DKK_RATE;
console.log('Price in EUR:', currentPriceEUR);

const convertEurToDkk = (priceInEur) => priceInEur * EUR_TO_DKK_RATE;
const convertDkkToEur = (priceInDkk) => priceInDkk / EUR_TO_DKK_RATE;

 
 function getCurrentPriceAndCurrency() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    
    for (const script of scripts) {
        try {
            const data = JSON.parse(script.textContent);
            if (data['@type'] === 'Product' && data.offers) {
                return {
                    price: parseFloat(data.offers.price),
                    currency: data.offers.priceCurrency
                };
            }
        } catch (e) {
            console.error('Error parsing JSON-LD:', e);
        }
    }
    return { price: null, currency: null };
}
 
function findGTIN() {
    const gtinSelectors = [
        // Standard GTIN selectors
        '[itemprop="gtin13"]', '[itemprop="gtin"]', '[itemprop="gtin8"]',
        '[itemprop="gtin12"]', '[itemprop="gtin14"]', '.netz-ean',
        '[data-ean]', 'span[itemprop="productID"]', 'meta[property="product:ean"]',
        'meta[property="og:ean"]', '.ean-code', '.product-ean',
        
        // Additional selectors
        '[data-gtin]', '.gtin-code', '.product-gtin', 'span.ean', 'div.ean',
        'p.ean', '[data-product-code]', '[data-barcode]', 'meta[name="gtin"]',
        'meta[name="ean"]', '[itemprop="productID"]', '.barcode-number',
        '.product-barcode', 'span[data-ean]', 'div[data-gtin]', '.code-ean',
        '.sku-ean', '[data-product-ean]', 'meta[property="product:barcode"]',
        '.gtin', '.product-identifier', '[data-identifier]', 'span.product-code',
        'div.product-code'
    ];

    console.log("🔍 Søger efter GTIN...");

    let foundGTINs = new Set(); // Store unique GTINs

    gtinSelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(element => {
            let value = element.textContent?.trim() || '';
            
            // Check common GTIN attributes
            const attrValue = element.getAttribute("content")?.trim() ||
                              element.getAttribute("data-ean")?.trim() ||
                              element.getAttribute("data-gtin")?.trim() ||
                              element.getAttribute("value")?.trim() || '';

            // Use the first valid value found
            let gtin = (attrValue || value).replace(/[^0-9]/g, ''); 

            if (gtin.length >= 8 && gtin.length <= 14) {
                foundGTINs.add(gtin);
                console.log(`✅ Fundet GTIN: ${gtin} (Selector: '${selector}')`);
            }
        });
    });

    // If no GTIN found via selectors, fallback to raw text search
    if (foundGTINs.size === 0) {
        console.log("❌ GTIN ikke fundet i standardselektorer. Prøver fallback...");

        const pageText = document.body.textContent;
        const matches = pageText.match(/\b\d{8,14}\b/g);

        if (matches) {
            matches.forEach(match => {
                if (match.length >= 8 && match.length <= 14) {
                    foundGTINs.add(match);
                    console.log(`✅ Fallback GTIN fundet: ${match}`);
                }
            });
        }
    }

    if (foundGTINs.size > 0) {
        return Array.from(foundGTINs); // Return array of found GTINs
    } else {
        console.log("❌ Ingen GTIN fundet på denne side.");
        return null;
    }
}




function waitForGTIN(callback) {
    console.log("Overvåger ændringer i DOM for GTIN...");
    
    const observer = new MutationObserver(() => {
        const gtin = findGTIN();
        if (gtin) {
            observer.disconnect();
            callback(gtin);
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
}

// Brug funktionen til at vente på GTIN
waitForGTIN(gtin => console.log("GTIN fundet dynamisk:", gtin));


// Function to find and store Price
function findPrice() {
    if (priceFound) return productData.price;  // If already found, return it

    const priceSelector = '.price .amount';  // Fallback selector
    const priceElement = document.querySelector(priceSelector);
    if (priceElement) {
        const priceValue = priceElement.textContent.trim().replace('€', '').trim();
        productData.price = priceValue;
        priceFound = true;  // Mark as found
        console.log('Price found:', priceValue);
        return priceValue;
    }

    console.log('Price No match');
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
            const mpnValue = mpnElement.textContent.trim() || 
                             mpnElement.getAttribute('content') || 
                             mpnElement.getAttribute('data-ean');
            console.log('MPN found with selector', selector, ':', mpnValue);
            return mpnValue;
        }
    }

    console.log('No MPN found');
    return null;
}
 
const PriceTracker = (function() {
    async function trackClick(store, productUrl, productName, price, gtin, mpn) {
        try {
            const clickData = {
                store: store,
                productUrl: productUrl,
                productName: productName,
                price: price,
                gtin: gtin,
                mpn: mpn,
                referringUrl: window.location.href  
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
    // Prevent default only if we successfully get all data
    try {
        const store = link.getAttribute('data-store');
        const url = link.getAttribute('data-url');
        const name = link.getAttribute('data-name');
        const price = link.getAttribute('data-price');
        const gtin = document.querySelector('meta[itemprop="gtin13"]')?.getAttribute('content');
        const mpn = document.querySelector('[itemprop="mpn"]')?.getAttribute('content');

        if (!store || !url) {
            console.error('Missing required tracking data');
            return;
        }

        // Log the collected data
        console.log('Tracking click:', { store, url, name, price, gtin, mpn });

        trackClick(store, url, name, price, gtin, mpn);
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
        // Expose for debugging
        _debug: {
            trackClick,
            handleClick
        }
    };
})();

function addUTMParameters(originalUrl) {
    try {
        // Use the findGTIN() function to get the GTIN value
        const gtinValue = findGTIN();

        // Use findMPN() as fallback if no GTIN found
        const mpnValue = findMPN();

        const productName = findProductName() || 'unknown_product';

        // Search identifier is GTIN if available, otherwise MPN
        const searchIdentifier = gtinValue || mpnValue || 'unknown_identifier';

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
        urlObject.searchParams.append('ref', 'cykelgear_price_comparison');
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

function findMPN() {
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
}

function extractProductData() {
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
}



function convertPrice(price) {
    const EUR_TO_DKK_RATE = 7.45;

    if (!price) return "No match";

    try {
        if (price.toLowerCase().includes('€')) {
            const numericPrice = parseFloat(price.replace(/[^\d.,-]/g, '').replace(',', '.'));
            if (!isNaN(numericPrice)) {
                const dkkPrice = numericPrice * EUR_TO_DKK_RATE;
                return {
                    convertedPrice: `${dkkPrice.toFixed(2)} DKK`,
                    originalValue: numericPrice,
                    eurValue: numericPrice
                };
            }
        }

        if (price.toLowerCase().includes('kr')) {
            const numericPrice = parseFloat(price.replace(/[^\d.,-]/g, '').replace(',', '.'));
            if (!isNaN(numericPrice)) {
                const eurPrice = numericPrice / EUR_TO_DKK_RATE;
                return {
                    convertedPrice: `${eurPrice.toFixed(2)} €`,
                    originalValue: numericPrice,
                    eurValue: eurPrice
                };
            }
        }

        return "No match";
    } catch (error) {
        console.error('Error converting price:', error);
        return "No match";
    }
}


function validatePrice(sitePrice, cykelgearPrice) {
    if (sitePrice === "No match" || !cykelgearPrice) {
        return true;  // Allow display if either price is missing
    }

    // Extract numeric value
    const sitePriceEUR = sitePrice.eurValue;
    
    // Convert Cykelgear's DKK price to EUR for comparison
    const cykelgearPriceEUR = cykelgearPrice / EUR_TO_DKK_RATE;

    // Check if the site's price is 80% lower or higher than Cykelgear's price
    const tooLow = sitePriceEUR < (cykelgearPriceEUR * 0.2);
    const tooHigh = sitePriceEUR > (cykelgearPriceEUR * 1.8);

    return !tooLow && !tooHigh;  // Return true only if price is within acceptable range
}

function findProductName() {
    const productNameSelectors = [
        'h1.product-title',
        'h1[itemprop="name"]',
        'h1',
        '.product--title',  // Bike-Discount specific
        '.product-details h1'
    ];

    for (const selector of productNameSelectors) {
        const nameElement = document.querySelector(selector);
        if (nameElement) {
            // Get and clean up product name (trim and normalize spaces)
            const productName = nameElement.textContent.trim().replace(/\s+/g, ' ');
            
            // If the product name is empty after trimming, skip this selector
            if (productName) {
                console.log(`Product name found with selector ${selector}:`, productName);
                return productName;
            } else {
                console.log(`Empty product name found with selector ${selector}`);
            }
        }
    }

    console.log('Could not find product name');
    return null;
}




function findMPN() {
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
}


// Main extraction function
function extractProductData() {
    const gtin = findGTIN(); // Prioritize GTIN
    
    // Only check MPN if GTIN was No match
    let mpn = null;
    if (!gtin) {
        mpn = findMPN(); // Check MPN if no GTIN
    }

    // Log the results
    if (gtin) {
        console.log('Using GTIN:', gtin);
    } else if (mpn) {
        console.log('Using MPN:', mpn);
    } else {
        console.log('No GTIN or MPN found, cannot proceed.');
    }
}

function validateGTIN(gtin) {
    if (!gtin) return false;
    const cleanGTIN = gtin.toString().replace(/[^0-9]/g, '');
    return cleanGTIN.length >= 8 && cleanGTIN.length <= 14;
}



// Call the main extraction function when the page is loaded
extractProductData();

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


// Main Function to Run on Page Load
function extractProductData() {
    const gtin = findGTIN();
    const price = findPrice();

    // Check if GTIN is missing or price is invalid
    if (!gtin) {
        console.log('GTIN No match, cannot proceed.');
        return;
    }

    if (isNaN(price)) {
        console.log('Invalid price format, cannot proceed.');
        return;
    }

    // Use the GTIN and price for further processing
    console.log('GTIN:', gtin);
    console.log('Price:', price)
}


// Call the main function when the page is loaded or ready
extractProductData();


// Helper function to search for prices with identifier
async function searchWithIdentifier(identifier, idType) {
    console.log(`Starting search for ${identifier} (${idType})`);

    const bikeDiscountPromise = new Promise(resolve => {
        console.log('Sending request to Bike-Discount...');
        browser.runtime.sendMessage({ 
            action: 'findPrice', 
            identifier: identifier, 
            url: 'https://www.bike-discount.de/en/search?sSearch=' + identifier 
        }, response => {
            if (chrome.runtime.lastError) {
                console.error('Error sending message to Bike-Discount:', chrome.runtime.lastError);
                resolve({ html: null, url: 'https://www.bike-discount.de/en/search?sSearch=' + identifier });
                return;
            }
            console.log('Raw Bike-Discount response:', response);
            if (response?.html) {
                console.log('Bike-Discount HTML received, length:', response.html.length);
                const doc = new DOMParser().parseFromString(response.html, 'text/html');
                const eanElements = doc.querySelectorAll('.netz-ean, [data-ean], .pd-ean');
                console.log('Found EAN elements on Bike-Discount:', eanElements.length);
                eanElements.forEach(el => {
                    console.log('EAN element content:', el.textContent);
                });
            }
            resolve(response);
        });
    });

    const bikeComponentsPromise = new Promise(resolve => {
        browser.runtime.sendMessage({ 
            action: 'findPrice', 
            identifier: identifier, 
            url: 'https://www.bike-components.de/en/s/?keywords=' + identifier 
        }, response => {
            if (browser.runtime.lastError) {
                console.error('Error sending message to Bike-Components:', browser.runtime.lastError);
                resolve({ html: null, url: 'https://www.bike-components.de/en/s/?keywords=' + identifier });
                return;
            }
            resolve(response);
        });
    });

    const cykelGearPromise = new Promise(resolve => {
        browser.runtime.sendMessage({ 
            action: 'findPrice', 
            identifier: identifier, 
            url: 'https://cykelgear.dk/search?q=' + identifier 
        }, response => {
            if (browser.runtime.lastError) {
                console.error('Error sending message to cykelgear:', browser.runtime.lastError);
                resolve({ html: null, url: 'https://cykelgear.dk/search?q=' + identifier });
                return;
            }
            resolve(response);
        });
    });

    const responses = await Promise.all([bikeDiscountPromise, bikeComponentsPromise, cykelGearPromise]);

    let foundPrice = false;
    for (const response of responses) {
        if (response && response.html) {
            const parser = new DOMParser();
            const doc = parser.parseFromString(response.html, 'text/html');

            let priceElement;
            if (response.url.includes('bike-discount')) {
                priceElement = doc.querySelector('.price--default') || 
                               doc.querySelector('[data-test="product-price"]') || 
                               doc.querySelector('.price');
            } else if (response.url.includes('bike-components')) {
                priceElement = doc.querySelector('.price.site-price');
            } else if (response.url.includes('cykelgear')) {
                priceElement = doc.querySelector('.text-lg.md\\:text-xl.leading-5.font-semibold.text-orange.whitespace-nowrap');
            }

            if (priceElement && priceElement.textContent.trim()) {
                foundPrice = true;
                break;
            }
        }
    }

    return { responses, foundPrice };
}

function findGTINFromJSONLD() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
        try {
            const data = JSON.parse(script.textContent);
            if (data['@type'] === 'Product' && data.gtin13) {
                return data.gtin13;
            }
        } catch (e) {
            console.error('Error parsing JSON-LD:', e);
        }
    }
    return null;
}


// Hovedfunktion til at finde og sammenligne pris
async function findAndComparePrice() {
    console.log('findAndComparePrice startet...');

    if (!window.location.href.includes('cykelgear.dk') && !window.location.href.includes('bikable') && !window.location.href.includes('bike-discount')) {
        console.log('Forkert side, stopper.');
        return;
    }

    //  Find produktnavn
    const productName = findProductName();
    console.log('Produktnavn fundet:', productName);

    // Find GTIN og MPN
    let gtin = findGTIN();
    let mpn = findMPN();
    let searchIdentifier = gtin || mpn;
    let identifierType = gtin ? "GTIN" : "MPN";

    console.log(`🔍 Bruger ${identifierType}:`, searchIdentifier);

    if (!searchIdentifier) {
        console.log('❌ Ingen GTIN eller MPN fundet på denne side.');
        return;
    }

    // 🚧 Undgå at søge efter samme GTIN flere gange
    if (processedGTINs.has(searchIdentifier)) {
        console.log(`⚠️ ${identifierType} ${searchIdentifier} er allerede behandlet. Skipping.`);
        return;
    }

    processedGTINs.set(searchIdentifier, true); // Markér som behandlet

    // 🔍 Søg efter produktet på Bike Discount
    const { responses: primaryResponses, foundPrice: primaryFound } = await searchWithIdentifier(searchIdentifier, identifierType);

    // Hvis vi søgte med GTIN men ikke fandt en pris, prøv MPN som fallback
    if (identifierType === "GTIN" && !primaryFound && mpn) {
        console.log('❌ Ingen priser fundet med GTIN. Prøver MPN fallback...');
        const { responses: fallbackResponses, foundPrice: fallbackFound } = await searchWithIdentifier(mpn, "MPN");

        if (fallbackFound) {
            identifierType = "MPN (fra GTIN)";
            searchIdentifier = mpn;
            displayPrice(fallbackResponses, mpn, identifierType);
            return;
        }
    }

    // Hvis vi fandt en pris, vis den på siden
    displayPrice(primaryResponses, searchIdentifier, identifierType);
}


// Call the main function when the page is loaded or ready
findAndComparePrice();


function getCurrentPriceAndCurrency() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    
    for (const script of scripts) {
        try {
            const data = JSON.parse(script.textContent);
            if (data['@type'] === 'Product' && data.offers) {
                return {
                    price: parseFloat(data.offers.price),
                    currency: data.offers.priceCurrency
                };
            }
        } catch (e) {
            console.error('Error parsing JSON-LD:', e);
        }
    }
    
    // Fallback methods
    const priceSelectors = [
        '[itemprop="price"]',
        '.product-price',
        '.price',
        '.current-price',
        '.price--default'
    ];
    
    for (const selector of priceSelectors) {
        const element = document.querySelector(selector);
        if (element) {
            console.log('Found price with selector:', selector);
            return {
                price: parseFloat(element.textContent.replace(/[^0-9,.]/g, '').replace(',', '.')),
                currency: 'EUR' // Add logic to detect currency from page if needed
            };
        }
    }
    
    console.log('No prices found with any method');
    return { price: null, currency: null };
}


function validatePrices() {
   let { price: currentPrice, currency: currentCurrency } = getCurrentPriceAndCurrency();
   if (!currentPrice) return;
   console.log('Current price:', currentPrice, 'Currency:', currentCurrency);

   const currentPriceEUR = currentCurrency === 'EUR' ? currentPrice : currentPrice / EUR_TO_DKK_RATE;
   console.log('Price in EUR:', currentPriceEUR);

   // Bike-Discount validation
if (typeof bikeDiscountPriceObj !== 'undefined' && bikeDiscountPriceObj !== "No match") {
        const bikeDiscountValid = validatePrice(bikeDiscountPriceObj, currentPrice);
        if (!bikeDiscountValid) {
            const bdPrice = bikeDiscountPriceObj.eurValue;
            const message = bdPrice > (currentPriceEUR * 1.8) ? "mismatch↑" : "mismatch↓";
            console.log(`Bike-Discount: Product found with ${identifierType} ${identifier}, price (${bdPrice}€) ${message}`);
            bikeDiscountPrice = `No match (${message})`;
            bikeDiscountPriceObj = "No match";
        } else {
            console.log(`Bike-Discount: Product found with ${identifierType} ${identifier}, price matches range`);
        }
    }

   // Bike-Components validation
   if (typeof bikeComponentsPriceObj !== 'undefined' && bikeComponentsPriceObj !== "No match") {
       const bikeComponentsValid = validatePrice(bikeComponentsPriceObj, currentPrice);
       if (!bikeComponentsValid) {
           const bcPrice = bikeComponentsPriceObj.eurValue;
           const message = bcPrice > (currentPriceEUR * 1.8) ? "mismatch↑" : "mismatch↓";
           console.log(`Price on Bike-Components is ${message} compared to current site`);
           bikeComponentsPrice = `No match (${message})`;
           bikeComponentsPriceObj = "No match";
       }
   }

   // Cykelgear validation
   if (typeof cykelgearPriceObj !== 'undefined' && cykelgearPriceObj !== "No match") {
       const cykelgearValid = validatePrice(cykelgearPriceObj, currentPrice);
       if (!cykelgearValid) {
           const cgPrice = cykelgearPriceObj.eurValue;
           const message = cgPrice > (currentPriceEUR * 1.8) ? "mismatch↑" : "mismatch↓";
           console.log(`Price on Cykelgear is ${message} compared to current site`);
           cykelgearPrice = `No match (${message})`;
           cykelgearPriceObj = "No match";
       }
   }
}
function displayPrice(responses, identifier, identifierType) {
   let bikeDiscountPrice = null, bikeDiscountUrl = null, bikeDiscountPriceObj = null;
   let bikeComponentsPrice = null, bikeComponentsUrl = null, bikeComponentsPriceObj = null;
   let cykelgearPrice = null, cykelgearUrl = null, cykelgearPriceObj = null;

   // Process responses
   for (const response of responses) {
       if (!response?.html) continue;
       const doc = new DOMParser().parseFromString(response.html, 'text/html');
       
       if (response.url.includes('bike-discount')) {
           processBikeDiscount(doc, response.url);
       } else if (response.url.includes('bike-components')) {
           processBikeComponents(doc, response.url);
       } else if (response.url.includes('cykelgear')) {
           processCykelgear(doc, response.url);
       }
   }

   // Convert prices
	bikeDiscountPriceObj = convertPrice(bikeDiscountPrice, 'bike-discount.de');
	bikeComponentsPriceObj = bikeComponentsPrice ? convertPrice(bikeComponentsPrice, 'bike-components.de') : "No match";
	cykelgearPriceObj = cykelgearPrice ? convertPrice(cykelgearPrice, 'cykelgear.dk') : "No match";

   // Validate and prepare display
   validatePrices();
   const productName = findProductName();
   const noProductsFound = (!bikeDiscountPrice || bikeDiscountPrice.includes('No match')) && 
                          (!bikeComponentsPrice || bikeComponentsPrice.includes('No match')) &&
                          (!cykelgearPrice || cykelgearPrice.includes('No match'));

   // Generate and insert comparison message
function generateNoProductsMessage(productName) {
    return `
        <div class="no-products-message">
            <h4>No products found for ${productName || 'this item'}</h4>
            <p>We couldn't find any matching products at the moment. Please try again later or refine your search.</p>
        </div>
    `;
}

const comparisonMessage = noProductsFound ? 
    generateNoProductsMessage(productName) : 
    generateComparisonTable(productName, identifierType);

if (!document.querySelector('.price-comparison-table')) {
    insertPriceComparison(comparisonMessage);
}


function processBikeDiscount(doc, url) {
    console.log('Processing Bike-Discount page');
    
    // Tjek om der er et GTIN/EAN element
    const eanElement = doc.querySelector('.netz-ean') || 
                      doc.querySelector('[data-ean]') ||
                      doc.querySelector('.pd-ean');
                      
    if (eanElement) {
        console.log('Found EAN element on Bike-Discount:', eanElement.textContent);
    } else {
        console.log('No EAN element found on Bike-Discount');
    }

    const noResultsText = doc.body.textContent.includes('No results for');
    if (noResultsText) {
        console.log('Bike-Discount: No products found');
        bikeDiscountPrice = null;
        bikeDiscountUrl = url;
        return;
    }

    const priceElement = doc.querySelector('.price--default') || 
                        doc.querySelector('[data-test="product-price"]') || 
                        doc.querySelector('.price');
    const productLink = doc.querySelector('.product--title');
    bikeDiscountUrl = (productLink?.href || url);

    if (priceElement) {
        const priceText = priceElement.textContent.trim();
        const priceMatch = priceText.match(/€\d+([.,]\d+)?/);
        if (priceMatch) {
            // Udtræk det numeriske beløb og juster med tysk moms
            const basePrice = parseFloat(priceMatch[0].replace('€', '').trim());
            const adjustedPrice = basePrice * 1.05; // Tilføj 5% tysk moms
            bikeDiscountPrice = `€${adjustedPrice.toFixed(2)}`;
            console.log('Bike-Discount original price:', basePrice, '€');
            console.log('Bike-Discount adjusted price (with 5% VAT):', adjustedPrice, '€');
        }
    }
}

function processBikeComponents(doc, url) {
    const priceElement = doc.querySelector('.price.site-price');
    const productLink = doc.querySelector('.product-tile__link');
    bikeComponentsUrl = (productLink?.href || url);

    if (priceElement) {
        const priceText = priceElement.textContent.trim();
        console.log('Raw price text from BC:', priceText); // Debug log

        // Mere robust pris-udtrækning
        const priceMatch = priceText.match(/(\d+[.,]?\d*)/);
        if (priceMatch) {
            const basePrice = parseFloat(priceMatch[0].replace(',', '.'));
            if (!isNaN(basePrice)) {
                bikeComponentsPrice = `€${basePrice.toFixed(2)}`;
                console.log('Bike-Components price after parsing:', bikeComponentsPrice);
            } else {
                bikeComponentsPrice = null;
                console.log('Could not parse BC price');
            }
        } else {
            bikeComponentsPrice = null;
            console.log('No price match found in BC text');
        }
    } else {
        bikeComponentsPrice = null;
        console.log('No price element found on BC');
    }
}

   function processCykelgear(doc, url) {
       const priceElement = doc.querySelector('.text-lg.md\\:text-xl.leading-5.font-semibold.text-orange.whitespace-nowrap');
       const productLink = doc.querySelector('.product-tile__link');
       cykelgearUrl = (productLink?.href || url);

       if (priceElement) {
           cykelgearPrice = priceElement.textContent.trim();
           cykelgearPriceObj = convertEurToDkk(cykelgearPrice);
       }
   }

   function generateComparisonTable() {
       return ` 
           <td>
               <h4 style="display: inline; font-weight: 700;">Price Comparison</h4>
               <p style="display: inline;">
                   ${productName ? 
                       `<a href="https://www.google.com/search?q=${encodeURIComponent(productName)}" target="_blank" title="Search for ${(productName)} on Google">🔍</a>` : 
                       '-'
                   }
               </p>
           </td>
           <table cellpadding="5" style="border-collapse: separate; border-spacing: 5px;">
               <tr>
                   <th style="padding: 5px; font-size: 10px;">Website</th>
                   <th style="padding: 5px; font-size: 10px;">Price</th>
                   <th style="padding: 5px; font-size: 10px;">Converted Price</th>
                   <th style="padding: 5px; font-size: 10px;">Link</th>
               </tr>
               ${!window.location.href.includes('bike-discount') ? generateBikeDiscountRow() : ''}
               ${!window.location.href.includes('bike-components') ? generateBikeComponentsRow() : ''}
               ${!window.location.href.includes('cykelgear') ? generateCykelgearRow() : ''}
           </table>
           <div class="md:mr-12" style="margin-top: 10px; font-size: 8px !important; color: #666;">
               <p style="font-size: 10px;">Fixed exchange rate of ${EUR_TO_DKK_RATE}.</p>
               <p style="font-size: 10px;">Prices might be for a different quantity/version (or even product in rare cases) with the same ${identifierType}.</p>
               <p style="font-size: 10px;">This is only a guide.</p>
           </div>
       `;
   }

   function generateBikeDiscountRow() {
           const convertedPriceObj = convertPrice(bikeDiscountPrice || 'No match');
			const convertedPrice = convertedPriceObj.convertedPrice || 'No match';
	   return `
    <tr>
        <td style="padding: 5px;">Bike-Discount</td>
        <td style="padding: 5px;">${bikeDiscountPrice || 'No match'}</td>
        <td style="padding: 5px;">${convertedPrice}</td>
        <td style="padding: 5px;">${bikeDiscountPrice && !bikeDiscountPrice.includes('too') ? 
            `<a href="${addUTMParameters(bikeDiscountUrl)}" 
                class="track-click"
                data-store="Bike-Components"
                data-url="${bikeDiscountUrl}"
                data-name="${productName?.replace(/"/g, '&quot;')}"
                data-price="${bikeDiscountPrice}"
                target="_blank">View Product</a>` : '-'}</td>
    </tr>`;
}

function generateBikeComponentsRow() {
    const convertedPriceObj = convertPrice(bikeComponentsPrice || 'No match');
    const convertedPrice = convertedPriceObj.convertedPrice || 'No match';
    return `
    <tr>
        <td style="padding: 5px;">Bike-Components</td>
        <td style="padding: 5px;">${bikeComponentsPrice || 'No match'}</td>
        <td style="padding: 5px;">${convertedPrice}</td>
        <td style="padding: 5px;">${bikeComponentsPrice && !bikeComponentsPrice.includes('too') ? 
            `<a href="${addUTMParameters(bikeComponentsUrl)}" 
                class="track-click"
                data-store="Bike-Components"
                data-url="${bikeComponentsUrl}"
                data-name="${productName?.replace(/"/g, '&quot;')}"
                data-price="${bikeComponentsPrice}"
                target="_blank">View Product</a>` : '-'}</td>
    </tr>`;
}

function generateCykelgearRow() {
    const convertedPriceObj = convertPrice(cykelgearPrice || 'No match');
    const convertedPrice = convertedPriceObj.convertedPrice || 'No match';

    return `
    <tr>
        <td style="padding: 5px;">Cykelgear</td>
        <td style="padding: 5px;">${cykelgearPrice || 'No match'}</td>
        <td style="padding: 5px;">${convertedPrice}</td>
        <td style="padding: 5px;">${cykelgearPrice && !cykelgearPrice.includes('too') ? 
            `<a href="${addUTMParameters(cykelgearUrl)}" 
                class="track-click"
                data-store="Cykelgear"
                data-url="${cykelgearUrl}"
                data-name="${productName?.replace(/"/g, '&quot;')}"
                data-price="${cykelgearPrice}"
                target="_blank">View Product</a>` : '-'}</td>
    </tr>`;
}



function insertPriceComparison(comparisonMessage, retryCount = 0) {
    const maxRetries = 5;
    const retryDelay = 1000;
    
    if (document.querySelector('.price-comparison-table')) {
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
}
}

function observeMutations() {
    // Attempt to find the product container
    const productContainer = document.querySelector('.product-container');

    if (!productContainer) {
        retryCount++; // Increment the retry counter
        if (retryCount > 10) {
            console.log('Product container No match after 10 retries. Stopping.');
            return; // Stop further retries
        }

        console.log(`Product container No match. Retrying (${retryCount}/10) in 1 second.`);
        setTimeout(observeMutations, 1000); // Retry after 1 second
        return;
    }

    // If product container is found, reset the retry counter
    retryCount = 0;
    console.log('Product container found:', productContainer);

    // Disconnect the observer if it was already observing
    if (observer) {
        observer.disconnect();
    }

    // Find the GTIN meta tag
    const gtinMeta = document.querySelector('meta[itemprop="gtin13"]');
    const targetNode = gtinMeta ? gtinMeta.closest('td') || gtinMeta.parentElement : null;

    if (!targetNode) {
        console.log('GTIN container No match. Retrying in 1 second.');
        setTimeout(observeMutations, 1000); // Retry for the GTIN container
        return;
    }

    // Configure the observer for mutations
    const config = { childList: true, subtree: true, attributes: true };

    // Only create the observer if it's not already created
    if (!observer) {
        observer = new MutationObserver(mutationsList => {
            for (const mutation of mutationsList) {
                if (mutation.type === 'childList' || mutation.type === 'attributes') {
                    findAndComparePrice(); // Your custom function for price comparison
                }
            }
        });
    }

    observer.observe(targetNode, config);
    console.log('Observer started on target node:', targetNode);
}



function handleNavigation() {
    currentUrl = window.location.href;
    processedGTINs.clear();
    
    // Get current site's price and currency
    const { price: currentPrice, currency: currentCurrency } = getCurrentPriceAndCurrency();
    const currentPriceEUR = currentCurrency === 'EUR' ? currentPrice : currentPrice / EUR_TO_DKK_RATE;

    // Only proceed with validation if we have prices to compare
    if (typeof bikeDiscountPriceObj !== 'undefined') {
        const bikeDiscountValid = validatePrice(bikeDiscountPriceObj, currentPrice);
        if (!bikeDiscountValid) {
            const bdPrice = bikeDiscountPriceObj.eurValue;
            const message = bdPrice > (currentPriceEUR * 1.8) ? "mismatch↑" : "mismatch↓";
            console.log(`Price on Bike-Discount is ${message} compared to current site`);
            bikeDiscountPrice = `No match (${message})`;
            bikeDiscountPriceObj = "No match";
        }
    }

    if (typeof bikeComponentsPriceObj !== 'undefined') {
        const bikeComponentsValid = validatePrice(bikeComponentsPriceObj, currentPrice);
        if (!bikeComponentsValid) {
            const bcPrice = bikeComponentsPriceObj.eurValue;
            const message = bcPrice > (currentPriceEUR * 1.8) ? "mismatch↑" : "mismatch↓";
            console.log(`Price on Bike-Components is ${message} compared to current site`);
            bikeComponentsPrice = `No match (${message})`;
            bikeComponentsPriceObj = "No match";
        }
    }
}

// Initialize and set up all event listeners
handleNavigation();

// Listen for URL changes
let lastUrl = location.href;
new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
        lastUrl = url;
        handleNavigation();
    }
}).observe(document.querySelector('body'), {subtree: true, childList: true});

// Standard navigation events
window.addEventListener('pushstate', handleNavigation);
window.addEventListener('replacestate', handleNavigation);
window.addEventListener('popstate', handleNavigation);

// Additional events that might indicate page changes
window.addEventListener('load', handleNavigation);
document.addEventListener('DOMContentLoaded', handleNavigation);

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
