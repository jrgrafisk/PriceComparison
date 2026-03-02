// Import the existing configuration
import { SHOPS, findGTIN } from './config.js';

// DOM Elements
const productUrlInput = document.getElementById('productUrl');
const compareButton = document.getElementById('compareButton');
const loading = document.getElementById('loading');
const results = document.getElementById('results');
const noResults = document.getElementById('noResults');
const error = document.getElementById('error');

// Add event listener
compareButton.addEventListener('click', handleCompareClick);

async function handleCompareClick() {
    const url = productUrlInput.value.trim();
    
    if (!url) {
        showError('Please enter a product URL');
        return;
    }

    if (!isValidUrl(url)) {
        showError('Please enter a valid URL');
        return;
    }

    // Show loading state
    loading.classList.remove('hidden');
    results.classList.add('hidden');
    error.classList.add('hidden');

    try {
        // Get GTIN from the URL
        const gtin = await fetchGTIN(url);
        
        if (!gtin) {
            showError('Could not find GTIN for this product');
            return;
        }

        // Get price comparisons
        const comparisons = await getComparisons(gtin);

        if (comparisons.length === 0) {
            noResults.classList.remove('hidden');
        } else {
            displayComparisons(comparisons);
        }

    } catch (err) {
        showError(`Error: ${err.message}`);
    } finally {
        loading.classList.add('hidden');
        results.classList.remove('hidden');
    }
}

function isValidUrl(url) {
    try {
        new URL(url);
        return true;
    } catch {
        return false;
    }
}

async function fetchGTIN(url) {
    // Here you would make a request to your backend to fetch the GTIN
    // For now, we'll use a mock function
    return fetch(`/api/extract-gtin?url=${encodeURIComponent(url)}`)
        .then(response => response.json())
        .then(data => data.gtin);
}

async function getComparisons(gtin) {
    // Make request to your backend to get price comparisons
    return fetch(`/api/compare-prices?gtin=${encodeURIComponent(gtin)}`)
        .then(response => response.json())
        .then(data => data.comparisons);
}

function displayComparisons(comparisons) {
    const table = document.createElement('table');
    table.className = 'min-w-full divide-y divide-gray-200';

    // Create table header
    const thead = document.createElement('thead');
    thead.className = 'bg-gray-50';
    const headerRow = document.createElement('tr');
    
    const headers = ['Shop', 'Price (EUR)', 'Price (DKK)', 'Link'];
    headers.forEach(headerText => {
        const th = document.createElement('th');
        th.className = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
        th.textContent = headerText;
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Create table body
    const tbody = document.createElement('tbody');
    tbody.className = 'bg-white divide-y divide-gray-200';

    comparisons.forEach(comparison => {
        const row = document.createElement('tr');
        
        const shopCell = document.createElement('td');
        shopCell.className = 'px-6 py-4 whitespace-nowrap';
        shopCell.textContent = comparison.shop;

        const eurCell = document.createElement('td');
        eurCell.className = 'px-6 py-4 whitespace-nowrap';
        eurCell.textContent = comparison.eurPrice;

        const dkkCell = document.createElement('td');
        dkkCell.className = 'px-6 py-4 whitespace-nowrap';
        dkkCell.textContent = comparison.dkkPrice;

        const linkCell = document.createElement('td');
        linkCell.className = 'px-6 py-4 whitespace-nowrap';
        const link = document.createElement('a');
        link.href = comparison.url;
        link.target = '_blank';
        link.className = 'text-blue-600 hover:text-blue-800';
        link.textContent = 'View Product';
        linkCell.appendChild(link);

        row.appendChild(shopCell);
        row.appendChild(eurCell);
        row.appendChild(dkkCell);
        row.appendChild(linkCell);
        tbody.appendChild(row);
    });

    table.appendChild(tbody);
    document.getElementById('comparisonTable').innerHTML = '';
    document.getElementById('comparisonTable').appendChild(table);
}

function showError(message) {
    error.textContent = message;
    error.classList.remove('hidden');
    results.classList.add('hidden');
}
