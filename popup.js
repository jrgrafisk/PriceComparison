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