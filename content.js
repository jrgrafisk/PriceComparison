let processedGTINs = new Map();
let observer = null;
let currentUrl = window.location.href;
const EUR_TO_DKK_RATE = 7.45;

const PriceTracker = (function() {
    async function trackClick(store, productUrl, productName, price, gtin, mpn) {
        try {
            const clickData = {
                store: store,
                productUrl: productUrl,
                productName: productName,
                price: price,
                gtin: gtin,
                mpn: mpn
            };
            
            console.log('Sending data:', clickData); // Debug what we're sending
            
            const response = await fetch('https://jrgrafisk.dk/php-endpoint.php', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(clickData)
            });
            
            // Get the raw response text first
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

function findMPN() {
     // Try meta tag first
    const mpnMeta = document.querySelector('[itemprop=mpn]');
    if (mpnMeta && mpnMeta.getAttribute('content')) {
        return mpnMeta.getAttribute('content');
    }

    // Try JSON-LD
    const jsonLdScript = document.querySelector('script[type="application/ld+json"]');
	if (jsonLdScript) {
        try {
            const jsonLd = JSON.parse(jsonLdScript.textContent);
            if (jsonLd.mpn) {
                return jsonLd.mpn;
            }
        } catch (e) {
            console.error('Error parsing JSON-LD', e);
        }
    }

     //Try dataLayer
    if (window.dataLayer) {
        const productData = dataLayer.find(data = data.productSku);
        if (productData && productData.productSku) {
            return productData.productSku;
        }
    }

    return null;
}

function convertEurToDkk(eurPrice) {
    if (!eurPrice) {
        return "Not Found";
    }

    try {
        // Remove from text and € symbol, then trim
        eurPrice = eurPrice.replace("from", "").replace("€", "").trim();
        
        // If comma exists, check digits after it
        if (eurPrice.includes(',')) {
            const digitsAfterComma = eurPrice.split(',')[1].length;
            if (digitsAfterComma === 2) {
                // Treat comma as decimal separator
                eurPrice = eurPrice.replace(',', '.');
            } else {
                // It's a thousand separator, remove it
                eurPrice = eurPrice.replace(',', '');
            }
        }
        
        const eurPriceFloat = parseFloat(eurPrice);
        if (isNaN(eurPriceFloat)) {
            return "Not Found";
        }
        
        const dkkPrice = eurPriceFloat * EUR_TO_DKK_RATE;
        return {
            dkkPrice: `${dkkPrice.toFixed(2)} DKK`,
            eurValue: eurPriceFloat
        };
    } catch (ValueError) {
        console.error('Error converting price', ValueError);
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
    const productNameElement = document.querySelector('h1.text-2xl.leading-10.break-words[itemprop=name]');
    
    if (productNameElement) {
        return productNameElement.textContent.trim();
    }
    
     // console.log('Could not find product name');
    return null;
}

async function findAndComparePrice() {
    // // console.log(findAndComparePrice called);

if (!window.location.href.includes('cykelgear.dk') && !window.location.href.includes('bikable')) {
     // console.log(Not on cykelgear.dk or bikable, exiting.);
    return;
}
    // Extract product name
    const productName = findProductName();
     // console.log(Product Name, productName);

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
         // console.log('Using GTIN', searchIdentifier, 'with MPN', fallbackIdentifier);
    } else if (mpn) {
        searchIdentifier = mpn;
        identifierType = "MPN";
         // console.log('Using MPN', searchIdentifier);
    }

    if (!searchIdentifier) {
         // console.log('No GTIN or MPN found on this page');
        return;
    }

    if (processedGTINs.has(searchIdentifier)) {
         // console.log(`Identifier ${searchIdentifier} already being processed or processed. Skipping.`);
        const existingPromise = processedGTINs.get(searchIdentifier);
        if (existingPromise) {
            existingPromise.then(responses = {
                if (responses) {
                    displayPrice(responses, searchIdentifier, identifierType);
                }
            });
        }
        return;
    }

async function searchWithIdentifier(identifier, idType) {
    const bikeDiscountPromise = new Promise(resolve => {
        browser.runtime.sendMessage({ 
            action: 'findPrice', 
            identifier: identifier, 
            url: 'https://www.bike-discount.de/en/search?sSearch=' + identifier 
        }, response => {
            if (browser.runtime.lastError) {
                console.error('Error sending message to Bike-Discount:', browser.runtime.lastError);
                resolve({ 
                    html: null,
                    url: 'https://www.bike-discount.de/en/search?sSearch=' + identifier 
                });
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
            resolve({ 
                html: null, 
                url: 'https://www.bike-components.de/en/s/?keywords=' + identifier 
            });
            return;
        }
        resolve(response);
    });
});

const responses = await Promise.all([bikeDiscountPromise, bikeComponentsPromise]);
        
// Check if we got any valid prices
let foundPrice = false;
for (const response of responses) {
    if (response && response.html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(response.html, 'text/html');  // Fixed content type string
        
        let priceElement;
        if (response.url.includes('bike-discount')) {
            priceElement = doc.querySelector('.price--default') || 
                         doc.querySelector('[data-test="product-price"]') ||  // Added quotes around attribute value
                         doc.querySelector('.price');
        } else if (response.url.includes('bike-components')) {
            priceElement = doc.querySelector('.price.site-price');
        }
        
        if (priceElement && priceElement.textContent.trim()) {
            foundPrice = true;
            break;
        }
    }
}

return { responses, foundPrice };
    }

    // Try with primary identifier (GTIN or MPN)
const { responses: primaryResponses, foundPrice: primaryFound } = await searchWithIdentifier(searchIdentifier, identifierType);

// If using GTIN and no prices found, try MPN fallback
if (identifierType === "GTIN" && !primaryFound && fallbackIdentifier) {
    // console.log('No prices found with GTIN, trying MPN fallback');
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



function displayPrice(responses, identifier, identifierType) {
    let bikeDiscountPrice = null;
    let bikeDiscountUrl = null;
    let bikeComponentsPrice = null;
    let bikeComponentsUrl = null;

    for (const response of responses) {
        if (response && response.html) {
            const parser = new DOMParser();
            const doc = parser.parseFromString(response.html, 'text/html');  

let priceElement;
if (response.url.includes('bike-discount')) {
    // First check for "No results for" message
    const noResultsText = doc.body.textContent.includes('No results for');
    if (noResultsText) {
        bikeDiscountPrice = null;   // This will result in "Not Found" being displayed
        bikeDiscountUrl = response.url;
    } else {
        priceElement = doc.querySelector('.price--default');
        if (!priceElement) {
            priceElement = doc.querySelector('[data-test="product-price"]');
        }
        if (!priceElement) {
            priceElement = doc.querySelector('.price');
        }
        const productLink = doc.querySelector('.product--title');
        if (productLink) {
            bikeDiscountUrl = productLink.href || response.url;
        } else {
            bikeDiscountUrl = response.url;
        }

        const priceText = priceElement ? priceElement.textContent.trim() : null;
        if (priceText) {
            const priceMatch = priceText.match(/€\d+([.,]\d+)?/);
            bikeDiscountPrice = priceMatch ? priceMatch[0] : null;
        }
    }
} else if (response.url.includes('bike-components')) {
    priceElement = doc.querySelector('.price.site-price');
    const productLink = doc.querySelector('.product-tile__link');
    if (productLink) {
        bikeComponentsUrl = productLink.href || response.url;
    } else {
        bikeComponentsUrl = response.url;
    }

    const priceText = priceElement ? priceElement.textContent.trim() : null;
    if (priceText) {
        bikeComponentsPrice = priceText.replace('.', ',');
    }
}
        }
    }

// Get Cykelgear's price
const cykelgearPriceElement = document.querySelector('.cykelgear-price') || // try dedicated class
                             document.querySelector('[itemprop="price"]') || // try schema markup
                             document.querySelector('.product-price'); // try generic price class

const cykelgearPrice = cykelgearPriceElement ? 
    parseFloat(cykelgearPriceElement.textContent.replace(',-', '').replace('.', '').trim()) : 
    null;

console.log('Price element found:', !!cykelgearPriceElement);
console.log('Extracted price:', cykelgearPrice);

// console.log('Cykelgear price:', cykelgearPrice);

let bikeDiscountPriceObj = convertEurToDkk(bikeDiscountPrice);
let bikeComponentsPriceObj = bikeComponentsPrice ? convertEurToDkk(bikeComponentsPrice) : "Not Found";

// Validate each price against Cykelgear's price
const bikeDiscountValid = validatePrice(bikeDiscountPriceObj, cykelgearPrice);
const bikeComponentsValid = validatePrice(bikeComponentsPriceObj, cykelgearPrice);

if (!bikeDiscountValid) {
    const bdPrice = bikeDiscountPriceObj.eurValue;
    const cgPrice = cykelgearPrice / EUR_TO_DKK_RATE;
    const message = bdPrice > (cgPrice * 1.8) ? "mismatch↑" : "mismatch↓";
    // console.log(`Price on Bike-Discount is ${message} compared to Cykelgear`);
    bikeDiscountPrice = `Not Found (${message})`;
    bikeDiscountPriceObj = "Not Found";
}

if (!bikeComponentsValid) {
    const bcPrice = bikeComponentsPriceObj.eurValue;
    const cgPrice = cykelgearPrice / EUR_TO_DKK_RATE;
    const message = bcPrice > (cgPrice * 1.8) ? "mismatch↑" : "mismatch↓";
    // console.log(`Price on Bike-Components is ${message} compared to Cykelgear`);
    bikeComponentsPrice = `Not Found (${message})`;
    bikeComponentsPriceObj = "Not Found";
}

const noProductsFound = (!bikeDiscountPrice || bikeDiscountPrice.includes('Not Found')) && 
                       (!bikeComponentsPrice || bikeComponentsPrice.includes('Not Found'));

const productName = findProductName();  // Get product name directly in this function

const comparisonMessage = noProductsFound ? `
    <h4 style="display: inline;">No matches found - try a google search 
        <a href="https://www.google.com/search?q=${encodeURIComponent(productName || '')}" target="_blank" title="Search for ${(productName)} on Google">🔍</a>
    </h4>
` : ` 
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
<tr>
        <td style="padding: 5px;">Bike-Discount</td>
        <td style="padding: 5px;">${bikeDiscountPrice || 'Not Found'}</td>
        <td style="padding: 5px;">${bikeDiscountPriceObj === "Not Found" ? 'Not Found' : bikeDiscountPriceObj.dkkPrice}</td>
        <td style="padding: 5px;">${bikeDiscountPrice && !bikeDiscountPrice.includes('too') ? 
            `<a href="${bikeDiscountUrl}" 
                class="track-click"
                data-store="Bike-Discount"
                data-url="${bikeDiscountUrl}"
                data-name="${productName?.replace(/"/g, '&quot;')}"
                data-price="${bikeDiscountPrice}"
                target="_blank">View Product</a>` : '-'}</td>
    </tr>
    <tr>
        <td style="padding: 5px;">Bike-Components</td>
        <td style="padding: 5px;">${bikeComponentsPrice || 'Not Found'}</td>
        <td style="padding: 5px;">${bikeComponentsPriceObj === "Not Found" ? 'Not Found' : bikeComponentsPriceObj.dkkPrice}</td>
        <td style="padding: 5px;">${bikeComponentsPrice && !bikeComponentsPrice.includes('too') ? 
            `<a href="${bikeComponentsUrl}" 
                class="track-click"
                data-store="Bike-Components"
                data-url="${bikeComponentsUrl}"
                data-name="${productName?.replace(/"/g, '&quot;')}"
                data-price="${bikeComponentsPrice}"
                target="_blank">View Product</a>` : '-'}</td>
    </tr>
    </table>
    <div class="md:mr-12" style="margin-top: 10px; font-size: 8px !important; color: #666;">
        <p style="font-size: 10px;">Fixed exchange rate of ${EUR_TO_DKK_RATE}.</p>
        <p style="font-size: 10px;">Prices might be for a different quantity/version (or even product in rare cases) with the same ${identifierType}.</p>
        <p style="font-size: 10px;">This is only a guide.</p>
    </div>
`;

// Prevent multiple insertion of the table by checking for its existence
if (document.querySelector('.price-comparison-table')) {
    return;
}
insertPriceComparison(comparisonMessage);
}
function insertPriceComparison(comparisonMessage, retryCount = 0) {
    const maxRetries = 5;   // Increased max retries
    const retryDelay = 1000;   // Increased delay to 1 second
    
    if (document.querySelector('.price-comparison-table')) {
        return;
    }

    const mpnElement = document.querySelector('[itemprop="mpn"]');
    
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
        const body = document.body;
        const newElement = document.createElement('div');
        newElement.classList.add('price-comparison-table');
        newElement.innerHTML = comparisonMessage;
        body.insertBefore(newElement, body.firstChild);
    }

    // Attach click handlers to the tracking links
    PriceTracker.attachTrackingHandlers();
}

function observeMutations() {
    if (observer) {
        observer.disconnect();
    }

    // Find the GTIN meta tag first
    const gtinMeta = document.querySelector('meta[itemprop="gtin13"]');
    // Get its closest table cell or parent container
    const targetNode = gtinMeta ? gtinMeta.closest('td') || gtinMeta.parentElement : null;

    if (!targetNode) {
        // console.log('Product container not found. Will retry in 1 second.');
        // Retry after a delay
        setTimeout(observeMutations, 1000);
        return;
    }

    const config = { childList: true, subtree: true, attributes: true };
    
    observer = new MutationObserver(mutationsList => {
        for (const mutation of mutationsList) {
            if (mutation.type === 'childList' || mutation.type === 'attributes') {
                findAndComparePrice();
            }
        }
    });

    observer.observe(targetNode, config);
}

function handleNavigation() {
    // console.log('Navigation detected!');
    currentUrl = window.location.href;
    processedGTINs.clear();
    
    setTimeout(() => {
        findAndComparePrice();
        observeMutations();
    }, 1000);
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

