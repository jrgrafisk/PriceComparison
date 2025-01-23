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
 
 // Function to find and store GTIN
function findGTIN() {
    if (gtinFound) return productData.gtin;  // If already found, return it

    const gtinSelectors = [
        '[itemprop="gtin"]',
        '.netz-ean',  // Bike-Discount specific
        '[data-ean]',
        'span[itemprop="productID"]'
    ];

    for (const selector of gtinSelectors) {
        const gtinElement = document.querySelector(selector);
        if (gtinElement) {
            const gtinValue = gtinElement.textContent.trim() || gtinElement.getAttribute('content') || gtinElement.getAttribute('data-ean');
            if (gtinValue) {
                productData.gtin = gtinValue;
                gtinFound = true;  // Mark as found
                console.log('GTIN found:', gtinValue);
                return gtinValue;
            }
        }
    }

    console.log('No GTIN found');
    return null;
}

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

    console.log('Price not found');
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
            console.log('Tracking click:', {
                store, url, name, price, gtin, mpn
            });

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
        console.log('GTIN not found, checking for MPN...');
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

    if (!price) return "Not Found";

    try {
        // Check and process if the price contains "€"
        if (price.toLowerCase().includes('€')) {
            const numericPrice = parseFloat(price.replace(/[^\d.,-]/g, '').replace(',', '.'));
            if (!isNaN(numericPrice)) {
                const dkkPrice = numericPrice * EUR_TO_DKK_RATE;
                return {
                    convertedPrice: `${dkkPrice.toFixed(2)} DKK`,
                    originalValue: numericPrice
                };
            }
        }

        // Check and process if the price contains "kr"
        if (price.toLowerCase().includes('kr')) {
            const numericPrice = parseFloat(price.replace(/[^\d.,-]/g, '').replace(',', '.'));
            if (!isNaN(numericPrice)) {
                const eurPrice = numericPrice / EUR_TO_DKK_RATE;
                return {
                    convertedPrice: `${eurPrice.toFixed(2)} €`,
                    originalValue: numericPrice
                };
            }
        }

        return "Not Found";
    } catch (error) {
        console.error('Error converting price:', error);
        return "Not Found";
    }
}


function validatePrice(sitePrice, cykelgearPrice) {
    if (sitePrice === "Not Found" || !cykelgearPrice) {
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

function findGTIN() {
    // Try to get GTIN from the <span itemprop="gtin13">
    const gtin = document.querySelector('[itemprop="gtin13"]');
    if (gtin) {
        const gtinValue = gtin.textContent.trim();
        if (gtinValue) {
            console.log('GTIN found:', gtinValue);
            return gtinValue;
        } else {
            console.log('GTIN found but it was empty after trimming');
        }
    }
    
    // If GTIN is not found, try to use the fallback (e.g., data-ean or other attributes)
    const fallbackGtin = document.querySelector('[data-ean]');
    if (fallbackGtin) {
        const gtinValue = fallbackGtin.getAttribute('data-ean').trim();
        if (gtinValue) {
            console.log('GTIN found via fallback:', gtinValue);
            return gtinValue;
        } else {
            console.log('Fallback GTIN found but it was empty');
        }
    }

    // If no GTIN is found, return null
    console.log('GTIN not found');
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

    // Fallback: Try additional selectors if MPN is not found in the primary selector
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
    
    // Only check MPN if GTIN was not found
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


// Call the main extraction function when the page is loaded
extractProductData();


function findPrice() {
    // First, try to get the price from the #netz-price selector
    let priceElement = document.querySelector('#netz-price');
    
    if (!priceElement) {
        // If #netz-price is not found, fallback to the .price .amount selector
        console.log('#netz-price not found, falling back to .price .amount');
        priceElement = document.querySelector('.price .amount');
    }

    if (priceElement) {
        // Clean up the price text to remove any non-numeric characters (like currency symbols)
        let priceText = priceElement.textContent.trim().replace(/[^\d,.-]/g, ''); // Remove everything except digits, commas, and decimal points
        
        // Handle comma as thousands separator (optional based on regional format)
        priceText = priceText.replace(',', '.'); // Replace comma with dot for decimal if needed
        
        // Attempt to parse the cleaned-up price
        let price = parseFloat(priceText);

        if (!isNaN(price)) {
            console.log('Price found:', price);
            return price;
        } else {
            console.log('Price element found but invalid format:', priceText);
        }
    } else {
        console.log('Price element not found.');
    }

    return NaN; // Return NaN if price cannot be extracted
}


// Main Function to Run on Page Load
function extractProductData() {
    const gtin = findGTIN();
    const price = findPrice();

    // Check if GTIN is missing or price is invalid
    if (!gtin) {
        console.log('GTIN not found, cannot proceed.');
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
    const bikeDiscountPromise = new Promise(resolve => {
        browser.runtime.sendMessage({ 
            action: 'findPrice', 
            identifier: identifier, 
            url: 'https://www.bike-discount.de/en/search?sSearch=' + identifier 
        }, response => {
            if (browser.runtime.lastError) {
                console.error('Error sending message to Bike-Discount:', browser.runtime.lastError);
                resolve({ html: null, url: 'https://www.bike-discount.de/en/search?sSearch=' + identifier });
                return;
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

// Main function to run on page load
async function findAndComparePrice() {
    if (!window.location.href.includes('cykelgear.dk') && !window.location.href.includes('bikable') && !window.location.href.includes('bike-discount')) {
        console.log('Wrong site');
        return;
    }

    // Extract product name
    const productName = findProductName();
    console.log('Product Name:', productName);  // Fixed logging statement

    // Try GTIN first
    const gtinMeta = document.querySelector('meta[itemprop=gtin13]');
    const mpn = findMPN();
    let searchIdentifier = null;
    let fallbackIdentifier = null;
    let identifierType = "";

    if (gtinMeta && gtinMeta.getAttribute('content')) {
        searchIdentifier = gtinMeta.getAttribute('content');
        fallbackIdentifier = mpn;
        identifierType = "GTIN";
        console.log('Using GTIN', searchIdentifier, 'with MPN', fallbackIdentifier);
    } else if (mpn) {
        searchIdentifier = mpn;
        identifierType = "MPN";
        console.log('Using MPN', searchIdentifier);
    }

    if (!searchIdentifier) {
        console.log('No GTIN or MPN found on this page');
        return;
    }

    // Ensure that identifier hasn't been processed already
    if (processedGTINs.has(searchIdentifier)) {
        console.log(`Identifier ${searchIdentifier} already being processed or processed. Skipping.`);
        const existingPromise = processedGTINs.get(searchIdentifier);
        if (existingPromise) {
            existingPromise.then(responses => {
                if (responses) {
                    displayPrice(responses, searchIdentifier, identifierType);
                }
            });
        }
        return;
    }

    // Proceed with identifier search
    const { responses: primaryResponses, foundPrice: primaryFound } = await searchWithIdentifier(searchIdentifier, identifierType);

    // If using GTIN and no prices found, try MPN fallback
    if (identifierType === "GTIN" && !primaryFound && fallbackIdentifier) {
        console.log('No prices found with GTIN, trying MPN fallback');
        const { responses: fallbackResponses, foundPrice: fallbackFound } = await searchWithIdentifier(fallbackIdentifier, "MPN");

        if (fallbackFound) {
            identifierType = "MPN (from GTIN)";
            searchIdentifier = fallbackIdentifier;
            displayPrice(fallbackResponses, fallbackIdentifier, identifierType);
            return;
        }
    }

    // If we get here, either we found prices with primary identifier or no prices were found at all
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
   if (typeof bikeDiscountPriceObj !== 'undefined' && bikeDiscountPriceObj !== "Not Found") {
       const bikeDiscountValid = validatePrice(bikeDiscountPriceObj, currentPrice);
       if (!bikeDiscountValid) {
           const bdPrice = bikeDiscountPriceObj.eurValue;
           const message = bdPrice > (currentPriceEUR * 1.8) ? "mismatch↑" : "mismatch↓";
           console.log(`Price on Bike-Discount is ${message} compared to current site`);
           bikeDiscountPrice = `Not Found (${message})`;
           bikeDiscountPriceObj = "Not Found";
       }
   }

   // Bike-Components validation
   if (typeof bikeComponentsPriceObj !== 'undefined' && bikeComponentsPriceObj !== "Not Found") {
       const bikeComponentsValid = validatePrice(bikeComponentsPriceObj, currentPrice);
       if (!bikeComponentsValid) {
           const bcPrice = bikeComponentsPriceObj.eurValue;
           const message = bcPrice > (currentPriceEUR * 1.8) ? "mismatch↑" : "mismatch↓";
           console.log(`Price on Bike-Components is ${message} compared to current site`);
           bikeComponentsPrice = `Not Found (${message})`;
           bikeComponentsPriceObj = "Not Found";
       }
   }

   // Cykelgear validation
   if (typeof cykelgearPriceObj !== 'undefined' && cykelgearPriceObj !== "Not Found") {
       const cykelgearValid = validatePrice(cykelgearPriceObj, currentPrice);
       if (!cykelgearValid) {
           const cgPrice = cykelgearPriceObj.eurValue;
           const message = cgPrice > (currentPriceEUR * 1.8) ? "mismatch↑" : "mismatch↓";
           console.log(`Price on Cykelgear is ${message} compared to current site`);
           cykelgearPrice = `Not Found (${message})`;
           cykelgearPriceObj = "Not Found";
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
   bikeDiscountPriceObj = convertEurToDkk(bikeDiscountPrice);
   bikeComponentsPriceObj = bikeComponentsPrice ? convertEurToDkk(bikeComponentsPrice) : "Not Found";
   cykelgearPriceObj = cykelgearPrice ? convertEurToDkk(cykelgearPrice) : "Not Found";

   // Validate and prepare display
   validatePrices();
   const productName = findProductName();
   const noProductsFound = (!bikeDiscountPrice || bikeDiscountPrice.includes('Not Found')) && 
                          (!bikeComponentsPrice || bikeComponentsPrice.includes('Not Found')) &&
                          (!cykelgearPrice || cykelgearPrice.includes('Not Found'));

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
       const noResultsText = doc.body.textContent.includes('No results for');
       if (noResultsText) {
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
           bikeDiscountPrice = priceMatch ? priceMatch[0] : null;
       }
   }

   function processBikeComponents(doc, url) {
       const priceElement = doc.querySelector('.price.site-price');
       const productLink = doc.querySelector('.product-tile__link');
       bikeComponentsUrl = (productLink?.href || url);

       if (priceElement) {
           const priceText = priceElement.textContent.trim();
           bikeComponentsPrice = priceText?.replace('.', ',');
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
           const convertedPriceObj = convertPrice(bikeDiscountPrice || 'Not Found');
			const convertedPrice = convertedPriceObj.convertedPrice || 'Not Found';
	   return `
    <tr>
        <td style="padding: 5px;">Bike-Discount</td>
        <td style="padding: 5px;">${bikeDiscountPrice || 'Not Found'}</td>
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
    const convertedPriceObj = convertPrice(bikeComponentsPrice || 'Not Found');
    const convertedPrice = convertedPriceObj.convertedPrice || 'Not Found';
    return `
    <tr>
        <td style="padding: 5px;">Bike-Components</td>
        <td style="padding: 5px;">${bikeComponentsPrice || 'Not Found'}</td>
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
    const convertedPriceObj = convertPrice(cykelgearPrice || 'Not Found');
    const convertedPrice = convertedPriceObj.convertedPrice || 'Not Found';

    return `
    <tr>
        <td style="padding: 5px;">Cykelgear</td>
        <td style="padding: 5px;">${cykelgearPrice || 'Not Found'}</td>
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
            console.log('Product container not found after 10 retries. Stopping.');
            return; // Stop further retries
        }

        console.log(`Product container not found. Retrying (${retryCount}/10) in 1 second.`);
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
        console.log('GTIN container not found. Retrying in 1 second.');
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
            bikeDiscountPrice = `Not Found (${message})`;
            bikeDiscountPriceObj = "Not Found";
        }
    }

    if (typeof bikeComponentsPriceObj !== 'undefined') {
        const bikeComponentsValid = validatePrice(bikeComponentsPriceObj, currentPrice);
        if (!bikeComponentsValid) {
            const bcPrice = bikeComponentsPriceObj.eurValue;
            const message = bcPrice > (currentPriceEUR * 1.8) ? "mismatch↑" : "mismatch↓";
            console.log(`Price on Bike-Components is ${message} compared to current site`);
            bikeComponentsPrice = `Not Found (${message})`;
            bikeComponentsPriceObj = "Not Found";
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
