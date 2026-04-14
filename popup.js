// popup.js
let hasChanges = false;
let enabledShops = {};

document.addEventListener('DOMContentLoaded', async () => {
    const shopList = document.getElementById('shopList');
    const saveButton = document.getElementById('saveButton');
    
    // Get current enabled state from storage
    const data = await browser.storage.sync.get('enabledShops');
    enabledShops = data.enabledShops || {};

    // Create toggle switches for each shop
    SHOPS.forEach(shop => {
        const isEnabled = enabledShops[shop.domain] !== false; // Default to true if not set
        
        const shopItem = document.createElement('div');
        shopItem.className = 'shop-item';
        
        shopItem.innerHTML = `
            <label class="toggle-switch">
                <input type="checkbox" data-domain="${shop.domain}" ${isEnabled ? 'checked' : ''}>
                <span class="slider"></span>
            </label>
            <span class="shop-name">${shop.name}</span>
        `;
        
        // Add change listener to checkbox
        const checkbox = shopItem.querySelector('input');
        checkbox.addEventListener('change', (e) => {
            const domain = e.target.dataset.domain;
            const isChecked = e.target.checked;
            
            // Update our temporary storage
            enabledShops[domain] = isChecked;
            hasChanges = true;
            
            // Enable save button
            saveButton.disabled = false;
            
            // Show brief confirmation
            const shopName = shopItem.querySelector('.shop-name');
            const originalText = shopName.textContent;
            shopName.textContent = isChecked ? '✓ Tilføjet' : '✗ Fjernet fra sammenligning';
            setTimeout(() => {
                shopName.textContent = originalText;
            }, 1000);
        });
        
        shopList.appendChild(shopItem);
    });

    // Initialize save button state
    saveButton.disabled = !hasChanges;

    // Request site addition button
    const requestSiteButton = document.getElementById('requestSiteButton');
    const requestStatus = document.getElementById('requestStatus');
    let siteUrl = null;

    // Get the current tab URL for display
    browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
        siteUrl = tabs[0]?.url || null;
        if (siteUrl) {
            const hostname = new URL(siteUrl).hostname.replace(/^www\./, '');
            requestSiteButton.title = siteUrl;
            requestSiteButton.textContent = `Anmod om tilføjelse af ${hostname}`;
        }
    });

    requestSiteButton.addEventListener('click', async () => {
        if (!siteUrl) return;
        requestSiteButton.disabled = true;
        requestStatus.textContent = 'Sender anmodning...';
        requestStatus.style.color = '#666';

        try {
            await fetch('https://jrgrafisk.dk/php-endpoint.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'siteRequest',
                    url: siteUrl,
                    timestamp: new Date().toISOString()
                })
            });
            requestStatus.style.color = 'green';
            requestStatus.textContent = '✓ Anmodning sendt! Tak.';
        } catch (e) {
            const mailBody = encodeURIComponent(`Hej,\n\nJeg ønsker, at følgende site tilføjes til PedalPricer:\n${siteUrl}`);
            requestStatus.style.color = '#333';
            requestStatus.innerHTML = `Kunne ikke sende – <a href="mailto:admin@jrgrafisk.dk?subject=Site%20request&body=${mailBody}" target="_blank">send email i stedet</a>`;
            requestSiteButton.disabled = false;
        }
    });

    // Add save button handler
    saveButton.addEventListener('click', async () => {
        if (!hasChanges) return;

        try {
            // Save to storage
            await browser.storage.sync.set({ enabledShops });

            // Get the active tab
            const tabs = await browser.tabs.query({ active: true, currentWindow: true });
            const activeTab = tabs[0];

            // Notify the tab about the changes
            if (activeTab) {
                await browser.tabs.sendMessage(activeTab.id, {
                    action: 'shopsUpdated',
                    enabledShops
                });

                // Reload the active tab
                await browser.tabs.reload(activeTab.id);
            }

            // Update button text to show success
            saveButton.textContent = 'Gemt!';
            saveButton.disabled = true;
            
            // Close the popup after a short delay
            setTimeout(() => {
                window.close();
            }, 1000);

        } catch (error) {
            console.error('Error saving settings:', error);
            saveButton.textContent = 'Fejl - Prøv igen';
            setTimeout(() => {
                saveButton.textContent = 'Gem';
                saveButton.disabled = false;
            }, 2000);
        }
    });
});