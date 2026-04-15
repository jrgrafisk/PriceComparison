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
    resultsEl.innerHTML = `
        <div class="loading-box">
            <span class="spinner"></span>
            <span class="loading-title">Henter priser...</span>
        </div>
    `;
}

function showResults(data) {
    if (!data.results || data.results.length === 0) {
        resultsEl.innerHTML = `
            <div class="msg-box">
                Ingen priser fundet for stregkode <strong>${data.gtin}</strong>.
                Produktet er muligvis ikke tilgængeligt i de understøttede butikker.
            </div>
        `;
        return;
    }

    const cards = data.results.map((r, i) => {
        const isCheapest = i === 0;
        return `
            <div class="result-card ${isCheapest ? 'cheapest' : ''}">
                <div class="result-shop">
                    ${r.shop}
                    ${isCheapest ? '<span class="result-badge">Billigst</span>' : ''}
                </div>
                <div class="result-right">
                    <div class="result-price">${r.priceText}</div>
                    <a class="result-link" href="${r.url}" target="_blank" rel="noopener"
                       data-shop="${r.shop}" data-price="${r.dkk}" data-rank="${i + 1}">
                        Besøg →
                    </a>
                </div>
            </div>
        `;
    }).join('');

    const statusLabels = { timeout: 'timeout', 'http-403': 'blokeret', 'http-429': 'rate-limit', 'no-match': 'ikke fundet', error: 'fejl', 'extension-only': 'kun extension' };
    const failed = data.shopStatus
        ? Object.entries(data.shopStatus).filter(([, s]) => s !== 'ok').map(([name, s]) => `${name} (${statusLabels[s] || s})`).join(', ')
        : '';

    resultsEl.innerHTML = `
        <p class="result-gtin">Stregkode: <span>${data.gtin}</span> · ${data.results.length} butik${data.results.length !== 1 ? 'ker' : ''} fundet</p>
        ${cards}
        ${failed ? `<p style="font-size:11px;color:#bbb;margin-top:12px;">Ikke tilgængelig på webversionen: ${failed}</p>` : ''}
    `;

    // Track shop clicks
    if (typeof umami !== 'undefined') {
        resultsEl.querySelectorAll('.result-link').forEach(link => {
            link.addEventListener('click', () => {
                umami.track('click-shop', {
                    shop: link.dataset.shop,
                    price: parseInt(link.dataset.price),
                    rank: parseInt(link.dataset.rank),
                    gtin: data.gtin
                });
            });
        });
    }
}

function showError(msg) {
    resultsEl.innerHTML = `<div class="msg-box error">${msg}</div>`;
}
