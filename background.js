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
                console.error('Error fetching URL:', error);
                sendResponse({ html: null, url: message.url });
            });
        return true; // Keep the message channel open for async response
    }
});