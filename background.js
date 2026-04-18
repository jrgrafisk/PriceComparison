// background.js

function isSafeShopUrl(url) {
    try {
        const { protocol, hostname } = new URL(url);
        if (protocol !== 'https:' && protocol !== 'http:') return false;
        return SHOPS.some(shop => hostname.endsWith(shop.domain));
    } catch { return false; }
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Handle GetRuleList request
    if (message === "GetRuleList") {
        sendResponse([{}]);
        return true;
    }

    // Handle GetTabUrl request
    if (message === "GetTabUrl") {
        if (sender.tab) sendResponse(sender.tab.url);
        return true;
    }

    // Handle findPrice action
    if (message.action === 'findPrice') {
        if (!isSafeShopUrl(message.url)) {
            sendResponse({ html: null, url: message.url });
            return true;
        }
        fetch(message.url, {
            headers: {
                'Accept-Language': 'da-DK,da;q=0.9,en-US;q=0.8,en;q=0.7',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            },
            signal: AbortSignal.timeout(10000)
        })
            .then(response => response.text())
            .then(html => sendResponse({ html, url: message.url }))
            .catch(() => sendResponse({ html: null, url: message.url }));
        return true;
    }

    // Handle badge update from content script
    if (message.action === 'setBadge') {
        const text = message.count > 0 ? message.count.toString() : '';
        browser.browserAction.setBadgeText({ text, tabId: sender.tab?.id });
        if (message.count > 0) {
            browser.browserAction.setBadgeBackgroundColor({ color: '#4caf50', tabId: sender.tab?.id });
        }
        return false;
    }

    // Handle openTabs action (from cart widget in content script)
    if (message.action === 'openTabs') {
        const safeUrls = (message.urls || []).filter(isSafeShopUrl);
        safeUrls.forEach((url, i) => {
            browser.tabs.create({ url, active: i === safeUrls.length - 1 });
        });
        return false;
    }

    // Handle shopsUpdated action — broadcast to all tabs
    if (message.action === 'shopsUpdated') {
        browser.tabs.query({}).then(tabs => {
            tabs.forEach(tab => {
                browser.tabs.sendMessage(tab.id, {
                    action: 'shopsUpdated',
                    enabledShops: message.enabledShops
                }).catch(() => {});
            });
        });
    }
});

// Initialize storage for enabled shops (all enabled by default)
browser.storage.sync.get("enabledShops").then(data => {
    if (!data.enabledShops) {
        const defaultEnabledShops = {};
        SHOPS.forEach(shop => { defaultEnabledShops[shop.domain] = true; });
        browser.storage.sync.set({ enabledShops: defaultEnabledShops });
    }
});
