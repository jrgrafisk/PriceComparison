// Use chrome namespace for Chrome MV3
const browser = chrome;

// Initialize storage for enabled shops (all enabled by default)
browser.storage.sync.get("enabledShops").then(data => {
    if (!data.enabledShops) {
        const defaultEnabledShops = {};
        SHOPS.forEach(shop => {
            defaultEnabledShops[shop.domain] = true;
        });
        browser.storage.sync.set({ enabledShops: defaultEnabledShops });
    }
    console.log("Enabled shops:", data.enabledShops);
});

// Handle messages
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message === "GetRuleList") {
        sendResponse([{}]);
        return true;
    }
    if (message === "GetTabUrl") {
        if (sender.tab) {
            sendResponse(sender.tab.url);
        }
        return true;
    }
    if (message.action === 'findPrice') {
        fetch(message.url)
            .then(response => response.text())
            .then(html => {
                sendResponse({ html, url: message.url });
            })
            .catch(error => {
                console.error('Error fetching URL:', error);
                sendResponse({ html: null, url: message.url });
            });
        return true;
    }
    if (message.action === "trackClick") {
        trackClick(message.data);
        return true;
    }
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