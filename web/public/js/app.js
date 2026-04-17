const SHOPS = [
    'Bike Discount', 'Bike Components', 'Cykelgear', 'Cykelshoppen',
    'AllBike', 'Cykelpartner', 'Cykelexperten', 'Børkop Cykler',
    'Bike24', 'AllTricks', 'R2 Bike', 'Holland Bike Shop'
];

const form = document.getElementById('compareForm');
const input = document.getElementById('searchInput');
const resultsEl = document.getElementById('results');

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const val = input.value.trim();
    if (!val) return;
    await runSearch(val);
});

document.getElementById('exampleBtn').addEventListener('click', async () => {
    input.value = '4019238054415';
    await runSearch('4019238054415');
});

async function runSearch(query) {
    showLoading();

    try {
        const res = await fetch('/api/compare', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ input: query })
        });

        const data = await res.json();

        if (!res.ok) {
            showError(data.error || 'Der opstod en fejl.');
            return;
        }

        // Track search
        if (typeof umami !== 'undefined') {
            umami.track('search', {
                query: query.startsWith('http') ? 'url' : query,
                results: data.results?.length ?? 0,
                gtin: data.gtin
            });
        }

        showResults(data);
    } catch (e) {
        showError('Kunne ikke oprette forbindelse til serveren. Prøv igen.');
    }
}

function showLoading() {
    const box = document.createElement('div');
    box.className = 'loading-box';

    const spinner = document.createElement('span');
    spinner.className = 'spinner';

    const label = document.createElement('span');
    label.className = 'loading-title';
    label.textContent = 'Henter priser...';

    box.appendChild(spinner);
    box.appendChild(label);
    resultsEl.replaceChildren(box);
}

function showResults(data) {
    resultsEl.replaceChildren();

    if (!data.results || data.results.length === 0) {
        const box = document.createElement('div');
        box.className = 'msg-box';
        box.textContent = 'Ingen priser fundet for stregkode ';
        const strong = document.createElement('strong');
        strong.textContent = data.gtin;
        box.appendChild(strong);
        box.appendChild(document.createTextNode('. Produktet er muligvis ikke tilgængeligt i de understøttede butikker.'));
        resultsEl.appendChild(box);
        return;
    }

    const meta = document.createElement('p');
    meta.className = 'result-gtin';
    meta.textContent = 'Stregkode: ';
    const gtinSpan = document.createElement('span');
    gtinSpan.textContent = data.gtin;
    const countText = ` · ${data.results.length} butik${data.results.length !== 1 ? 'ker' : ''} fundet`;
    meta.appendChild(gtinSpan);
    meta.appendChild(document.createTextNode(countText));
    resultsEl.appendChild(meta);

    data.results.forEach((r, i) => {
        const isCheapest = i === 0;
        const card = document.createElement('div');
        card.className = 'result-card' + (isCheapest ? ' cheapest' : '');

        const shopEl = document.createElement('div');
        shopEl.className = 'result-shop';
        shopEl.textContent = r.shop;
        if (isCheapest) {
            const badge = document.createElement('span');
            badge.className = 'result-badge';
            badge.textContent = 'Billigst';
            shopEl.appendChild(badge);
        }

        const right = document.createElement('div');
        right.className = 'result-right';

        const priceEl = document.createElement('div');
        priceEl.className = 'result-price';
        priceEl.textContent = r.priceText;

        const link = document.createElement('a');
        link.className = 'result-link';
        link.href = r.url;
        link.target = '_blank';
        link.rel = 'noopener';
        link.dataset.shop = r.shop;
        link.dataset.price = r.dkkPrice;
        link.dataset.rank = i + 1;
        link.textContent = 'Besøg →';

        if (typeof umami !== 'undefined') {
            link.addEventListener('click', () => {
                umami.track('click-shop', {
                    shop: r.shop,
                    price: r.dkkPrice,
                    rank: i + 1,
                    gtin: data.gtin
                });
            });
        }

        right.appendChild(priceEl);
        right.appendChild(link);
        card.appendChild(shopEl);
        card.appendChild(right);
        resultsEl.appendChild(card);
    });

    const statusLabels = { timeout: 'timeout', 'http-403': 'blokeret', 'http-429': 'rate-limit', 'no-match': 'ikke fundet', error: 'fejl', 'extension-only': 'kun extension' };
    if (data.shopStatus) {
        const failed = Object.entries(data.shopStatus)
            .filter(([, s]) => s !== 'ok')
            .map(([name, s]) => `${name} (${statusLabels[s] || s})`)
            .join(', ');
        if (failed) {
            const note = document.createElement('p');
            note.style.cssText = 'font-size:11px;color:#bbb;margin-top:12px;';
            note.textContent = `Ikke tilgængelig på webversionen: ${failed}`;
            resultsEl.appendChild(note);
        }
    }
}

function showError(msg) {
    const box = document.createElement('div');
    box.className = 'msg-box error';
    box.textContent = msg;
    resultsEl.replaceChildren(box);
}
