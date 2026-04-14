// popup.js
let hasChanges = false;
let enabledShops = {};

document.addEventListener('DOMContentLoaded', async () => {
    const shopList = document.getElementById('shopList');
    const saveButton = document.getElementById('saveButton');

    // Tab switching
    document.querySelectorAll('.pp-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.pp-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const isCart = tab.dataset.tab === 'cart';
            document.getElementById('panelShops').style.display = isCart ? 'none' : 'block';
            document.getElementById('panelCart').style.display = isCart ? 'block' : 'none';
            if (isCart) renderCart();
        });
    });

    async function renderCart() {
        const data = await browser.storage.local.get('cart');
        const cart = data.cart || [];
        const tabCartEl = document.getElementById('tabCart');
        const cartItemsEl = document.getElementById('cartItems');
        const cartTotalEl = document.getElementById('cartTotal');

        tabCartEl.textContent = cart.length > 0 ? `Kurv (${cart.length})` : 'Kurv';
        cartItemsEl.textContent = '';
        cartTotalEl.style.display = 'none';

        if (cart.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'cart-empty';
            empty.textContent = 'Din kurv er tom. Tilføj produkter via prissammenligningen.';
            cartItemsEl.appendChild(empty);
            return;
        }

        // Build per-shop totals
        const shopMap = {};
        cart.forEach(item => {
            (item.prices || []).forEach(p => {
                if (!shopMap[p.shop]) shopMap[p.shop] = { total: 0, count: 0 };
                shopMap[p.shop].total += p.dkkPrice;
                shopMap[p.shop].count++;
            });
        });
        const n = cart.length;
        const complete = Object.entries(shopMap).filter(([,s]) => s.count === n).sort((a,b) => a[1].total - b[1].total);
        const partial  = Object.entries(shopMap).filter(([,s]) => s.count  < n).sort((a,b) => a[1].total - b[1].total);
        const best = complete[0] || partial[0];

        // Recommendation box
        if (best) {
            const rec = document.createElement('div');
            rec.style.cssText = 'background:#fff8f0;border:1px solid #f2994b;border-radius:8px;padding:10px 12px;margin-bottom:12px;';

            const label = document.createElement('div');
            label.style.cssText = 'font-size:11px;color:#999;margin-bottom:3px;';
            label.textContent = complete.length ? 'Saml din ordre hos' : 'Bedste delvise match';

            const shopName = document.createElement('div');
            shopName.style.cssText = 'font-size:15px;font-weight:700;color:#e65100;';
            shopName.textContent = `${best[0]} — ${best[1].total} kr.`;

            rec.appendChild(label);
            rec.appendChild(shopName);

            if (!complete.length) {
                const caveat = document.createElement('div');
                caveat.style.cssText = 'font-size:11px;color:#bbb;margin-top:2px;';
                caveat.textContent = `${best[1].count} af ${n} produkter tilgængeligt`;
                rec.appendChild(caveat);
            }
            const openBtn = document.createElement('button');
            openBtn.textContent = `Åbn alle hos ${best[0]} →`;
            openBtn.style.cssText = 'width:100%;margin-top:8px;padding:6px 10px;border:none;border-radius:5px;background:#f2994b;color:#fff;font-size:12px;font-weight:600;cursor:pointer;';
            openBtn.addEventListener('click', async () => {
                const urls = cart.map(item => (item.prices || []).find(p => p.shop === best[0])?.url).filter(Boolean);
                for (let i = 0; i < urls.length; i++) {
                    await browser.tabs.create({ url: urls[i], active: i === urls.length - 1 });
                }
                window.close();
            });
            rec.appendChild(openBtn);
            cartItemsEl.appendChild(rec);
        }

        // Other complete shops
        complete.slice(1).forEach(([name, s]) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #f8f8f8;font-size:13px;';
            const nameEl = document.createElement('span');
            nameEl.textContent = name;
            const priceEl = document.createElement('span');
            priceEl.style.fontWeight = '600';
            priceEl.textContent = `${s.total} kr.`;
            row.appendChild(nameEl);
            row.appendChild(priceEl);
            cartItemsEl.appendChild(row);
        });

        // Incomplete shops (greyed)
        if (partial.length) {
            const sep = document.createElement('div');
            sep.style.cssText = 'font-size:11px;color:#ccc;margin:10px 0 5px;padding-top:8px;border-top:1px solid #f5f5f5;';
            sep.textContent = 'Ikke alle produkter tilgængeligt:';
            cartItemsEl.appendChild(sep);
            partial.forEach(([name, s]) => {
                const row = document.createElement('div');
                row.style.cssText = 'display:flex;justify-content:space-between;padding:4px 0;font-size:12px;color:#ccc;';
                const nameEl = document.createElement('span');
                nameEl.textContent = `${name} (${s.count}/${n})`;
                const priceEl = document.createElement('span');
                priceEl.textContent = `${s.total} kr.*`;
                row.appendChild(nameEl);
                row.appendChild(priceEl);
                cartItemsEl.appendChild(row);
            });
            const note = document.createElement('div');
            note.style.cssText = 'font-size:10px;color:#ddd;margin-top:3px;';
            note.textContent = '* Delsum — ikke alle produkter er med';
            cartItemsEl.appendChild(note);
        }

        // Product list with remove buttons
        const divider = document.createElement('div');
        divider.style.cssText = 'font-size:11px;color:#bbb;margin:12px 0 6px;padding-top:8px;border-top:1px solid #f0f0f0;';
        divider.textContent = `Produkter (${n})`;
        cartItemsEl.appendChild(divider);

        cart.forEach(item => {
            const div = document.createElement('div');
            div.className = 'cart-item';

            const info = document.createElement('div');
            info.className = 'cart-item-info';

            const name = document.createElement('div');
            name.className = 'cart-item-name';
            name.textContent = item.name || 'Ukendt produkt';
            name.title = item.name || '';

            info.appendChild(name);

            const removeBtn = document.createElement('button');
            removeBtn.className = 'cart-remove';
            removeBtn.textContent = '✕';
            removeBtn.addEventListener('click', async () => {
                const d = await browser.storage.local.get('cart');
                await browser.storage.local.set({ cart: (d.cart || []).filter(i => i.id !== item.id) });
                renderCart();
            });

            div.appendChild(info);
            div.appendChild(removeBtn);
            cartItemsEl.appendChild(div);
        });
    }
    
    // Get current enabled state from storage
    const data = await browser.storage.sync.get('enabledShops');
    enabledShops = data.enabledShops || {};

    // Create toggle switches for each shop
    SHOPS.forEach(shop => {
        const isEnabled = enabledShops[shop.domain] !== false; // Default to true if not set
        
        const shopItem = document.createElement('div');
        shopItem.className = 'shop-item';

        const label = document.createElement('label');
        label.className = 'toggle-switch';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.domain = shop.domain;
        checkbox.checked = isEnabled;
        const slider = document.createElement('span');
        slider.className = 'slider';
        label.appendChild(checkbox);
        label.appendChild(slider);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'shop-name';
        nameSpan.textContent = shop.name;

        shopItem.appendChild(label);
        shopItem.appendChild(nameSpan);

        // Add change listener to checkbox
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
            requestStatus.textContent = 'Kunne ikke sende – ';
            const mailLink = document.createElement('a');
            mailLink.href = 'mailto:admin@jrgrafisk.dk?subject=Site%20request&body=' + mailBody;
            mailLink.target = '_blank';
            mailLink.textContent = 'send email i stedet';
            requestStatus.appendChild(mailLink);
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

    renderCart(); // update tab badge on popup open
});