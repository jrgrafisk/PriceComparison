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

        showResults(data);
    } catch (e) {
        showError('Kunne ikke oprette forbindelse til serveren. Prøv igen.');
    }
}

function showLoading() {
    const rows = SHOPS.map(name => `
        <div class="shop-status-row" data-shop="${name}">
            <span class="spinner"></span>
            <span>${name}</span>
        </div>
    `).join('');

    resultsEl.innerHTML = `
        <div class="loading-box">
            <div class="loading-title">Henter priser...</div>
            ${rows}
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
                    <a class="result-link" href="${r.url}" target="_blank" rel="noopener">
                        Besøg →
                    </a>
                </div>
            </div>
        `;
    }).join('');

    resultsEl.innerHTML = `
        <p class="result-gtin">Stregkode: <span>${data.gtin}</span> · ${data.results.length} butik${data.results.length !== 1 ? 'ker' : ''} fundet</p>
        ${cards}
    `;
}

function showError(msg) {
    resultsEl.innerHTML = `<div class="msg-box error">${msg}</div>`;
}
