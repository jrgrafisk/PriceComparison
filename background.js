// background.js
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Handle GetRuleList request
    if (message === "GetRuleList") {
        sendResponse([{}]); // Send empty rules object for now
        return true;  // Keep the message channel open
    }
    
    // Handle GetTabUrl request
    if (message === "GetTabUrl") {
        if (sender.tab) {
            sendResponse(sender.tab.url);
        }
        return true;
    }

    // Handle findPrice action
    if (message.action === 'findPrice') {
        fetch(message.url)
            .then(response => response.text())
            .then(html => {
                sendResponse({ html, url: message.url });
            })
            .catch(error => {

                sendResponse({ html: null, url: message.url });
            });
        return true; // Keep the message channel open for async response
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
        const urls = message.urls || [];
        urls.forEach((url, i) => {
            browser.tabs.create({ url, active: i === urls.length - 1 });
        });
        return false;
    }

    // Handle shopsUpdated action
    if (message.action === 'shopsUpdated') {
        // Broadcast to all tabs
        browser.tabs.query({}).then(tabs => {
            tabs.forEach(tab => {
                browser.tabs.sendMessage(tab.id, {
                    action: 'shopsUpdated',
                    enabledShops: message.enabledShops
                }).catch(() => {
                    // Ignore errors for tabs that can't receive messages
                });
            });
        });
    }
});

// Initialize storage for enabled shops (all enabled by default)
browser.storage.sync.get("enabledShops").then(data => {
    if (!data.enabledShops) {
        // Set default enabled shops using SHOPS array
        const defaultEnabledShops = {};
        SHOPS.forEach(shop => {
            defaultEnabledShops[shop.domain] = true;
        });
        browser.storage.sync.set({ enabledShops: defaultEnabledShops });
    }

});