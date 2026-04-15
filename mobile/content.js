/* PedalPricer Mobile — content.js */
(function () {
    'use strict';
    if (window.__ppMobile) return;
    window.__ppMobile = true;

    const ORANGE = '#f2994b';
    const FETCH_TIMEOUT = 12000;

    /* ── Shop + GTIN detection ── */

    function shopForDomain() {
        const host = location.hostname.replace(/^www\./, '');
        return (window.SHOPS || []).find(s => host.includes(s.domain));
    }

    function extractGTIN() {
        // 1. JSON-LD
        for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
            try {
                const items = [].concat(JSON.parse(el.textContent));
                for (const item of items) {
                    for (const node of [item, item.offers].flat().filter(Boolean)) {
                        const g = node.gtin13 || node.gtin || node.gtin8 || node.gtin12 || node.gtin14;
                        if (g && /^\d{8,14}$/.test(String(g).trim())) return String(g).trim();
                    }
                }
            } catch {}
        }
        // 2. Shop CSS selectors
        const shop = shopForDomain();
        if (shop?.gtinSelectors) {
            for (const sel of shop.gtinSelectors) {
                if (typeof sel !== 'string') continue;
                const el = document.querySelector(sel);
                if (!el) continue;
                const raw = el.textContent.replace(/[^0-9]/g, '');
                if (/^\d{8,14}$/.test(raw)) return raw;
            }
        }
        return null;
    }

    /* ── Price parsing ── */

    function normalizeNum(text) {
        const s = String(text).replace(/[^\d.,]/g, '').trim();
        if (!s) return null;
        let n;
        if (/,\d{2}$/.test(s) && s.includes('.')) n = parseFloat(s.replace(/\./g, '').replace(',', '.'));
        else if (/\.\d{2}$/.test(s) && s.includes(',')) n = parseFloat(s.replace(/,/g, ''));
        else n = parseFloat(s.replace(',', '.'));
        return isFinite(n) && n > 0 ? n : null;
    }

    function parsePrice(html, shop, gtin) {
        // Shopify JSON API
        if (shop.shopifySearch) {
            try {
                const cents = parseInt(JSON.parse(html)?.resources?.results?.products?.[0]?.price, 10);
                if (cents > 0) return { price: cents / 100, currency: shop.defaultCurrency || 'DKK' };
            } catch {}
            return null;
        }

        const doc = new DOMParser().parseFromString(html, 'text/html');

        // Inertia.js
        if (shop.inertia) {
            const el = doc.querySelector('[data-page]');
            if (el) {
                try {
                    const page = JSON.parse(el.getAttribute('data-page'));
                    for (const path of shop.inertia.productPaths) {
                        const products = path.split('.').reduce((o, k) => o?.[k], page);
                        if (Array.isArray(products) && products.length > 0) {
                            const price = parseFloat(products[0][shop.inertia.priceField]);
                            if (price > 0) return { price, currency: 'DKK' };
                        }
                    }
                } catch {}
            }
            return null;
        }

        // scriptExtract
        if (shop.scriptExtract) {
            let src = html;
            if (shop.scriptExtract.container) {
                const container = doc.querySelector(shop.scriptExtract.container);
                if (container) src = Array.from(container.querySelectorAll('script')).map(s => s.textContent).join('\n');
            }
            const m = src.match(new RegExp(shop.scriptExtract.price));
            if (m) {
                const price = parseFloat(m[1]);
                if (price > 0) return { price, currency: shop.defaultCurrency || 'EUR' };
            }
            return null;
        }

        // CSS selector
        if (shop.priceSelector) {
            for (const sel of shop.priceSelector.split(',').map(s => s.trim())) {
                const el = doc.querySelector(sel);
                if (!el) continue;
                const amt = el.getAttribute('data-price-amount');
                if (amt) {
                    const price = parseFloat(amt);
                    if (price > 0) return { price, currency: shop.defaultCurrency || 'DKK' };
                }
                const price = normalizeNum(el.textContent);
                if (price) return { price, currency: shop.defaultCurrency || 'DKK' };
            }
        }

        // JSON-LD fallback on fetched page
        for (const el of doc.querySelectorAll('script[type="application/ld+json"]')) {
            try {
                const items = [].concat(JSON.parse(el.textContent));
                for (const item of items) {
                    const g = item.gtin13 || item.gtin || '';
                    if (gtin && g && String(g).trim() !== gtin) continue;
                    for (const offer of [].concat(item.offers || [])) {
                        const price = parseFloat(offer.price);
                        if (price > 0) return { price, currency: offer.priceCurrency || shop.defaultCurrency || 'EUR' };
                    }
                }
            } catch {}
        }
        return null;
    }

    async function fetchAllPrices(gtin) {
        const RATES = window.EXCHANGE_RATES || { EUR_TO_DKK: 7.45 };
        const tasks = (window.SHOPS || []).filter(s => !s.extensionOnly).map(shop =>
            new Promise(resolve => {
                const url = shop.url.includes('{gtin}')
                    ? shop.url.replace('{gtin}', encodeURIComponent(gtin))
                    : shop.url + encodeURIComponent(gtin) + (shop.urlSuffix || '');
                const timer = setTimeout(() => resolve(null), FETCH_TIMEOUT);
                browser.runtime.sendMessage({ action: 'fetchUrl', url })
                    .then(resp => {
                        clearTimeout(timer);
                        if (!resp?.html) return resolve(null);
                        const parsed = parsePrice(resp.html, shop, gtin);
                        if (!parsed) return resolve(null);
                        const dkk = parsed.currency === 'DKK'
                            ? parsed.price
                            : parsed.price * RATES.EUR_TO_DKK;
                        resolve({ shop: shop.name, dkk: Math.round(dkk), url });
                    })
                    .catch(() => { clearTimeout(timer); resolve(null); });
            })
        );
        return (await Promise.all(tasks)).filter(Boolean).sort((a, b) => a.dkk - b.dkk);
    }

    /* ── UI ── */

    let fab, overlay, sheet;

    function injectFAB() {
        fab = document.createElement('button');
        Object.assign(fab.style, {
            position: 'fixed', bottom: '20px', right: '16px', zIndex: '2147483646',
            background: ORANGE, color: '#fff', border: 'none', borderRadius: '24px',
            padding: '0 18px', height: '48px', fontSize: '15px', fontWeight: '700',
            fontFamily: 'system-ui, -apple-system, sans-serif', cursor: 'pointer',
            boxShadow: '0 4px 16px rgba(242,153,75,0.4)', display: 'flex',
            alignItems: 'center', gap: '7px', WebkitTapHighlightColor: 'transparent',
            letterSpacing: '-0.01em'
        });
        fab.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Priser';
        fab.addEventListener('click', onFABClick);
        document.body.appendChild(fab);
    }

    async function onFABClick() {
        fab.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> Henter…';
        fab.style.opacity = '0.8';
        fab.disabled = true;

        const gtin = extractGTIN();
        const results = gtin ? await fetchAllPrices(gtin) : [];

        fab.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Priser';
        fab.style.opacity = '1';
        fab.disabled = false;

        openSheet(results, gtin);
    }

    function openSheet(results, gtin) {
        // Dim overlay
        overlay = document.createElement('div');
        Object.assign(overlay.style, {
            position: 'fixed', inset: '0', zIndex: '2147483647',
            background: 'rgba(0,0,0,0.4)', opacity: '0',
            transition: 'opacity 0.25s'
        });
        overlay.addEventListener('click', closeSheet);

        // Sheet
        sheet = document.createElement('div');
        Object.assign(sheet.style, {
            position: 'fixed', bottom: '0', left: '0', right: '0',
            zIndex: '2147483647', background: '#fff',
            borderRadius: '20px 20px 0 0', maxHeight: '78vh',
            display: 'flex', flexDirection: 'column',
            transform: 'translateY(100%)',
            transition: 'transform 0.3s cubic-bezier(0.4,0,0.2,1)',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            boxShadow: '0 -8px 40px rgba(0,0,0,0.18)'
        });

        // Handle bar
        const handle = el('div', {
            width: '36px', height: '4px', background: '#e5e5e5',
            borderRadius: '2px', margin: '12px auto 0', flexShrink: '0'
        });

        // Header
        const hdr = el('div', {
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 20px 12px', borderBottom: '1px solid #f2f2f2', flexShrink: '0'
        });
        const logo = el('div', { display: 'flex', alignItems: 'center', gap: '8px' });
        logo.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="${ORANGE}"><circle cx="12" cy="12" r="10"/><text x="12" y="16" text-anchor="middle" fill="white" font-size="10" font-weight="700" font-family="system-ui">PP</text></svg>`;
        const logoText = el('span', { fontWeight: '700', fontSize: '16px', color: '#111' });
        logoText.textContent = 'PedalPricer';
        logo.appendChild(logoText);
        const closeBtn = el('button', {
            background: '#f2f2f2', border: 'none', borderRadius: '50%',
            width: '32px', height: '32px', fontSize: '16px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#666', WebkitTapHighlightColor: 'transparent', flexShrink: '0'
        });
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('click', closeSheet);
        hdr.appendChild(logo);
        hdr.appendChild(closeBtn);

        // Body
        const body = el('div', { overflowY: 'auto', flex: '1', padding: '16px 16px 32px' });

        if (!gtin) {
            body.appendChild(msgBox('Ingen stregkode fundet på denne side.'));
        } else if (results.length === 0) {
            body.appendChild(msgBox('Ingen priser fundet. Produktet er muligvis ikke tilgængeligt i de understøttede butikker.'));
        } else {
            const sub = el('p', { fontSize: '12px', color: '#aaa', margin: '0 0 14px', lineHeight: '1.4' });
            sub.textContent = `EAN ${gtin} · ${results.length} butik${results.length !== 1 ? 'ker' : ''} fundet`;
            body.appendChild(sub);

            results.forEach((r, i) => {
                const cheapest = i === 0;
                const card = document.createElement('a');
                card.href = r.url;
                card.target = '_blank';
                card.rel = 'noopener';
                Object.assign(card.style, {
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '14px 16px', marginBottom: '8px', borderRadius: '14px',
                    textDecoration: 'none', color: 'inherit',
                    background: cheapest ? '#f0fdf4' : '#f8f8f8',
                    border: cheapest ? '1.5px solid #86efac' : '1.5px solid transparent',
                    WebkitTapHighlightColor: 'transparent', minHeight: '64px'
                });

                const left = el('div', { display: 'flex', flexDirection: 'column', gap: '4px' });
                const name = el('div', { fontWeight: '600', fontSize: '15px', color: '#111' });
                name.textContent = r.shop;
                left.appendChild(name);
                if (cheapest) {
                    const badge = el('span', {
                        display: 'inline-block', fontSize: '11px', background: '#dcfce7',
                        color: '#16a34a', fontWeight: '700', padding: '2px 8px',
                        borderRadius: '20px', alignSelf: 'flex-start'
                    });
                    badge.textContent = 'Billigst';
                    left.appendChild(badge);
                }

                const right = el('div', { display: 'flex', alignItems: 'center', gap: '12px' });
                const price = el('div', {
                    fontWeight: '800', fontSize: '20px',
                    color: cheapest ? '#16a34a' : '#111', letterSpacing: '-0.03em'
                });
                price.textContent = `${r.dkk} kr.`;
                const arrow = el('div', { fontSize: '20px', color: '#ccc', flexShrink: '0' });
                arrow.textContent = '→';
                right.appendChild(price);
                right.appendChild(arrow);

                card.appendChild(left);
                card.appendChild(right);
                body.appendChild(card);
            });
        }

        sheet.appendChild(handle);
        sheet.appendChild(hdr);
        sheet.appendChild(body);
        document.body.appendChild(overlay);
        document.body.appendChild(sheet);

        requestAnimationFrame(() => {
            overlay.style.opacity = '1';
            sheet.style.transform = 'translateY(0)';
        });
    }

    function closeSheet() {
        if (overlay) overlay.style.opacity = '0';
        if (sheet) sheet.style.transform = 'translateY(100%)';
        setTimeout(() => { overlay?.remove(); sheet?.remove(); overlay = null; sheet = null; }, 300);
    }

    /* ── Tiny helpers ── */

    function el(tag, styles = {}) {
        const node = document.createElement(tag);
        Object.assign(node.style, styles);
        return node;
    }

    function msgBox(text) {
        const p = el('p', { color: '#999', fontSize: '14px', textAlign: 'center', padding: '32px 16px', lineHeight: '1.6' });
        p.textContent = text;
        return p;
    }

    /* ── Boot ── */

    function init() {
        if (!shopForDomain()) return;
        injectFAB();
    }

    document.readyState === 'loading'
        ? document.addEventListener('DOMContentLoaded', init)
        : init();
})();
