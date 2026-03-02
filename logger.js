const Logger = {
    baseUrl: 'https://jrgrafisk.dk/updatesheet.php',
    
    async logClick(data) {
        // Send message to background script instead of direct fetch
        browser.runtime.sendMessage({
            action: "trackClick",
            data: {
                click_timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
                store: data.store,
                product_url: data.url,  // Keep this field since the database requires it
                product_name: data.name,
                price: data.price,
                gtin: data.gtin || data.name,
                referrer: window.location.hostname
            }
        });
    }
};

// Make available in both browser and Node.js environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Logger;
} else {
    window.Logger = Logger;
} 