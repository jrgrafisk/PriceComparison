const express = require('express');
const puppeteer = require('puppeteer');
const { SHOPS, findGTIN } = require('./config.js');
const app = express();

app.use(express.json());
app.use(express.static('public'));

// Endpoint to extract GTIN from URL
app.get('/api/extract-gtin', async (req, res) => {
    try {
        const { url } = req.query;
        const browser = await puppeteer.launch();
        const page = await browser.newPage();
        
        await page.goto(url, { waitUntil: 'networkidle2' });
        const gtin = await page.evaluate(findGTIN);
        
        await browser.close();
        res.json({ gtin });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to extract GTIN' });
    }
});

// Endpoint to compare prices
app.get('/api/compare-prices', async (req, res) => {
    try {
        const { gtin } = req.query;
        const browser = await puppeteer.launch();
        
        const comparisons = await Promise.all(
            SHOPS.map(async shop => {
                try {
                    const page = await browser.newPage();
                    const url = shop.domain === 'r2-bike.com' 
                        ? buildSearchUrl(shop, gtin, gtin)
                        : shop.url + encodeURIComponent(gtin);
                    
                    await page.goto(url, { waitUntil: 'networkidle2' });
                    
                    const priceElement = await page.$(shop.priceSelector);
                    if (!priceElement) return null;
                    
                    const priceText = await page.evaluate(el => el.textContent.trim(), priceElement);
                    const priceData = convertPrice(priceText);
                    
                    return {
                        shop: shop.name,
                        eurPrice: priceData.eurValue || 'No match',
                        dkkPrice: priceData.dkkValue ? `${priceData.dkkValue.toFixed(2)}` : 'No match',
                        url: url
                    };
                } catch (error) {
                    console.error(`Error checking ${shop.name}:`, error);
                    return null;
                }
            })
        );

        await browser.close();
        
        // Filter out null results
        const validComparisons = comparisons.filter(Boolean);
        res.json({ comparisons: validComparisons });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to compare prices' });
    }
});

function buildSearchUrl(shop, searchTerm, gtin) {
    if (shop.domain === 'r2-bike.com') {
        return shop.url.replace('{gtin}', encodeURIComponent(gtin));
    }
    return shop.url + encodeURIComponent(searchTerm);
}

function convertPrice(priceText) {
    // This should be implemented based on your existing price conversion logic
    const cleanPrice = priceText.replace(/[^0-9.,]/g, '').replace(',', '.');
    const price = parseFloat(cleanPrice);
    
    if (isNaN(price)) return { eurValue: null, dkkValue: null };
    
    // Add your currency conversion logic here
    const eurValue = price;
    const dkkValue = eurValue * 7.45; // Example conversion rate
    
    return { eurValue, dkkValue };
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
