 /* config.js */
// Exchange rates
const EXCHANGE_RATES = {
    EUR_TO_DKK: 7.45,
    EUR_TO_GBP: 0.86,
    EUR_TO_USD: 1.08
};

// Shop configurations
const SHOPS = [
    {
        name: "Bike24",
        url: "https://www.bike24.com/search-result?searchTerm=",
        priceSelector: ".text-xl.leading-none.text-nowrap, [itemprop='price'], .price, .product-price",
        nextData: {
            productPaths: [
                "props.pageProps.product",
                "props.pageProps.searchResult.products",
                "props.pageProps.data.products",
                "props.pageProps.initialData.products"
            ],
            priceField: "price.regular.value"
        },
        gtinSelectors: [
            {
                type: "application/ld+json",
                paths: ["gtin", "gtin13", "gtin8", "gtin12", "gtin14"]
            },
            '[itemprop="gtin13"]',
            '[itemprop="gtin"]'
        ],
        domain: "bike24.com",
        tablePosition: ".product-availability__title",
        defaultCurrency: "EUR"
    },
    {
        name: "Bike Discount",
        url: "https://www.bike-discount.de/en/search?sSearch=",
        priceSelector: "meta[itemprop='price'], #netz-price, .product--price",
        gtinSelectors: [".netz-ean", "[data-ean]", ".pd-ean"],
        domain: "bike-discount.de",
        tablePosition: ".product--tax",
        defaultCurrency: "EUR"
    },
    {
        name: "Bike Components",
        url: "https://www.bike-components.de/en/s/?keywords=",
        priceSelector: ".price.site-price, .price.block.pt-6[data-test='auto-product-price']",
        gtinSelectors: [
            {
                type: "application/ld+json",
                paths: ["gtin", "gtin13", "gtin8", "gtin12", "gtin14", "offers.gtin", "offers.gtin13", "offers.gtin8", "offers.gtin12", "offers.gtin14"]
            }
        ],
        domain: "bike-components.de",
        tablePosition: ".wrap-price",
        defaultCurrency: "EUR",
        vatMultiplier: 1.19,
        scriptExtract: {
            price: '"priceRaw":([\\d.]+)'
        }
    },
    {
        name: "Cykelgear",
        url: "https://cykelgear.dk/search?q=",
        priceSelector: ".text-lg.md\\:text-xl.leading-5.font-semibold.text-orange.whitespace-nowrap",
        gtinSelectors: ["[itemprop=\"gtin13\"]"],
        domain: "cykelgear.dk",
        tablePosition: ".flex.gap-4.flex-wrap.mt-6",
        defaultCurrency: "DKK",
        inertia: {
            productPaths: [
                "props.products.data",
                "props.hits",
                "props.results.data",
                "props.items.data"
            ],
            priceField: "formatted_price_float"
        }
    },
    {
        name: "Cykelshoppen",
        url: "https://cykelshoppen.dk/search?query=",
        priceSelector: ".price-purchase.text-sm, .price-purchase",
        gtinSelectors: [
            {
                type: "jsonld",
                paths: ["gtin", "gtin13", "gtin8", "gtin12", "gtin14"]
            }
        ],
        domain: "cykelshoppen.dk",
        tablePosition: ".text-xs.font-light.text-gray-400",
        defaultCurrency: "DKK"
    },
    {
        name: "Cykelpartner",
        url: "https://www.cykelpartner.dk/produktsogning?q=",
        priceSelector: ".price-separated, .price, .uk-h2.uk-text-bold.uk-text-primary",
        gtinSelectors: [
            '[itemprop="gtin13"]',
            '[itemprop="gtin"]',
            'meta[property="product:ean"]'
        ],
        domain: "cykelpartner.dk",
        tablePosition: ".uk-margin",
        defaultCurrency: "DKK",
        timeout: 2000
    },
    {
        name: "Cykelexperten",
        url: "https://cykelexperten.dk/?hr-search=(search_term:*",
        urlSuffix: "*)",
        priceSelector: ".hr-search-overlay-product-price-box .price, .product-price, .product-detail-price-container",
        gtinSelectors: [
            "[itemprop='gtin13']",
            "[itemprop='gtin']"
        ],
        domain: "cykelexperten.dk",
	    tablePosition: ".product-detail-price-container",
	    defaultCurrency: "DKK"
    },
	{
	        name: "AllTricks",
        url: "https://www.alltricks.com/Buy/",
        priceSelector: ".price, .alltricks-Product-wrapPrice",
        gtinSelectors: [
            "[itemprop='gtin13']",
            "[itemprop='gtin']"
        ],
        domain: "alltricks.com",
	    tablePosition: ".product-header-stock-delay",
	    defaultCurrency: "EUR"
    },
    {
        name: "Børkop Cykler",
        extensionOnly: true,
        url: "https://boerkopcykler.dk/?show_omnisearch=true&clerk_query=",
        priceSelector: ".myoclpuFinalPrice, .clerk-design-product-price.price-new",
        gtinSelectors: [
            {
                type: "application/ld+json",
                paths: ["gtin", "gtin13", "gtin8", "gtin12", "gtin14"]
            }
        ],
        domain: "boerkopcykler.dk",
        tablePosition: "#options",
        defaultCurrency: "DKK"
    },
    {
        name: "R2 Bike",
        url: "https://r2-bike.com/search/?qs={gtin}&lang=eng",
        priceSelector: "meta[name='ndGAfVKBrutto'], meta[itemprop='price'], .price.no-letter-spacing.productbox-price.mas-price-color",
        gtinSelectors: [
            '[itemprop="gtin13"]',
            '[itemprop="gtin"]'
        ],
        domain: "r2-bike.com",
        tablePosition: ".vat_info",
        defaultCurrency: "EUR"
    },
    {
        name: "CS Megastore",
        url: "https://www.csmegastore.dk/l/0/s?sq=",
        priceSelector: ".m-product-card__price-text, .v-product-details__price",
        gtinSelectors: [
            ".productidstable td.value",
            "[itemprop='gtin13']",
            "[itemprop='gtin']"
        ],
        domain: "csmegastore.dk",
        tablePosition: ".v-product-details__price",
        defaultCurrency: "DKK"
    },
    {
        name: "Pedalatleten",
        url: "https://pedalatleten.dk/search/suggest.json?q=",
        urlSuffix: "&resources[type]=product",
        shopifySearch: true,
        priceSelector: ".product-price-final .amount, .product-price-final",
        gtinSelectors: ["div.product-sku"],
        domain: "pedalatleten.dk",
        tablePosition: ".product-price-final",
        defaultCurrency: "DKK"
    },
    {
        name: "Holland Bike Shop",
        url: "https://hollandbikeshop.com/da-dk/advanced_search_result.php?keywords=",
        priceSelector: ".product-card__price",
        scriptExtract: {
            price: "product_obj\\.price\\s*=\\s*'([\\d.]+)'",
            container: ".filter-products__row"
        },
        gtinSelectors: [
            {
                type: "application/ld+json",
                paths: ["gtin13", "gtin"]
            }
        ],
        domain: "hollandbikeshop.com",
        tablePosition: ".color-sec__price",
        defaultCurrency: "EUR",
        timeout: 5000
    }
];

// Product info template
const PRODUCT_INFO_TEMPLATE = {
    gtin: [],
    mpn: [],
    shop: {
        name: '',
        url: '',
        domain: ''
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
        url: '',
        price: null,
        timestamp: ''
    },
    detectedOn: '',
    foundTimestamp: ''
};

/* Export for Node.js or attach to window for browser context */
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        SHOPS,
        EXCHANGE_RATES,
        PRODUCT_INFO_TEMPLATE
    };
} else if (typeof window !== 'undefined') {
    window.SHOPS = SHOPS;
    window.EXCHANGE_RATES = EXCHANGE_RATES;
    window.PRODUCT_INFO_TEMPLATE = PRODUCT_INFO_TEMPLATE;
}
