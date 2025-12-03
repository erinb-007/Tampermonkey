// ==UserScript==
// @name         Brightpearl Bundle Stock and Inventory Enhancement
// @namespace    https://trakracer.com/
// @version      1.0
// @description  Show extra enchancments in BP
// @author       Erin Bond
// @match        https://euw1.brightpearlapp.com/*
// @updateURL    https://github.com/erinb-007/Tampermonkey/raw/refs/heads/main/Brightpearl%20Bundle%20Stock%20and%20Inventory%20Enhancement.user.js
// @downloadURL  https://github.com/erinb-007/Tampermonkey/raw/refs/heads/main/Brightpearl%20Bundle%20Stock%20and%20Inventory%20Enhancement.user.js
// @grant        GM_xmlhttpRequest
// @connect      52.31.172.165
// ==/UserScript==

(function() {
    'use strict';

    const METABASE_URL = 'http://52.31.172.165:3000';
    const PUBLIC_UUID = '2627b450-000b-4e2e-96fa-cc07aee37f8c';

    let productDataCache = {};
    let dataLoaded = false;

    // Add CSS
    const style = document.createElement('style');
    style.textContent = `
        .tabbertab table tr td[data-bp-stock],
        .tabbertab table tr td[data-bp-dims],
        .tabbertab table tr td[data-bp-sku] {
            background-color: #f9f9f9 !important;
        }
        .tabbertab table tr td[data-bp-sku] {
            border-left: 2px solid #4CAF50 !important;
            max-width: 120px !important;
        }
        #bp-sku-display {
            display: inline-block;
            margin-left: 15px;
            padding: 5px 12px;
            background: #e8f4f8;
            border: 1px solid #b8d4e0;
            border-radius: 3px;
            font-size: 14px;
            font-weight: normal;
            color: #2c5aa0;
            vertical-align: middle;
        }
        #bp-sku-display strong {
            font-weight: 600;
        }
        #bp-warehouse-breakdown {
            margin: 20px 0;
            padding: 15px;
            border: 1px solid #ddd;
            border-radius: 5px;
            background: #f9f9f9;
        }
        #bp-warehouse-breakdown h3 {
            margin: 0 0 10px 0;
            font-size: 14px;
            font-weight: bold;
            color: #333;
        }
        #bp-warehouse-table {
            width: 100%;
            max-width: 500px;
            border-collapse: collapse;
            font-size: 12px;
        }
        #bp-warehouse-table th {
            background: #e8e8e8;
            padding: 8px;
            text-align: left;
            font-weight: bold;
            border-bottom: 2px solid #ccc;
        }
        #bp-warehouse-table td {
            padding: 6px 8px;
            border-bottom: 1px solid #e0e0e0;
        }
        #bp-warehouse-table tr:hover {
            background: #f0f0f0;
        }
        #bp-warehouse-table td.stock {
            text-align: center;
            font-weight: bold;
        }
        #bp-warehouse-table td.stock.positive {
            color: #009900;
        }
        #bp-warehouse-table td.stock.zero {
            color: #999;
        }
        #bp-warehouse-table tfoot td {
            font-weight: bold;
            background: #e8e8e8;
            border-top: 2px solid #ccc;
            padding: 8px;
        }
    `;
    document.head.appendChild(style);

    function fetchMetabaseData() {
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `${METABASE_URL}/api/public/card/${PUBLIC_UUID}/query/json`,
                onload: function(response) {
                    const data = JSON.parse(response.responseText);

                    data.forEach(row => {
                        const productId = String(row['Product ID']).trim();
                        if (!productId) return;

                        if (!productDataCache[productId]) {
                            productDataCache[productId] = {
                                sku: row['Sku'] || '',
                                weight: row['Weight'] || 0,
                                height: row['Height'] || 0,
                                length: row['Length'] || 0,
                                width: row['Width'] || 0,
                                totalStock: 0,
                                warehouseStock: {}
                            };
                        }

                        const warehouse = row['Products Inventory Summary - Product → Warehouse Name'];
                        const onhand = parseInt(row['Products Inventory Summary - Product → Onhand']) || 0;

                        if (warehouse) {
                            productDataCache[productId].warehouseStock[warehouse] = onhand;
                            productDataCache[productId].totalStock += onhand;
                        }
                    });

                    dataLoaded = true;
                    resolve();
                }
            });
        });
    }

    function getCurrentProductId() {
        const match = window.location.href.match(/pID=(\d+)/);
        return match ? match[1] : null;
    }

    // Add SKU to the h1 title
    function addSkuToTitle() {
        if (!dataLoaded) return;

        const productId = getCurrentProductId();
        if (!productId) return;

        const product = productDataCache[productId];
        if (!product || !product.sku) return;

        // Check if already added
        if (document.getElementById('bp-sku-display')) return;

        // Find the h1 element
        const h1 = document.querySelector('h1');
        if (!h1) return;

        // Create SKU badge
        const skuSpan = document.createElement('span');
        skuSpan.id = 'bp-sku-display';
        skuSpan.innerHTML = `<strong>SKU:</strong> ${product.sku}`;

        // Append to h1
        h1.appendChild(skuSpan);
    }

    // BUNDLE TAB
    function updateBundleTable() {
        if (!dataLoaded) return;

        let bundleTab = document.querySelector('#undefinednav8');
        if (!bundleTab || !bundleTab.closest('li').classList.contains('tabberactive')) {
            return;
        }

        document.querySelectorAll('.tabbertab:not(.tabbertabhide) input[type="text"]').forEach(input => {
            const productId = input.value.trim();
            if (!/^\d+$/.test(productId)) return;

            const cell = input.closest('td');
            if (!cell) return;

            const row = cell.closest('tr');
            if (!row) return;

            // Hide extra columns
            let currentCell = cell.nextSibling;
            while (currentCell && !currentCell.hasAttribute('data-bp-sku')) {
                if (currentCell.nodeType === 1 && currentCell.tagName === 'TD') {
                    const text = currentCell.textContent.trim();
                    if (text === '0' || text === '-' || text === '') {
                        currentCell.style.display = 'none';
                    }
                }
                currentCell = currentCell.nextSibling;
            }

            // Add link
            if (!cell.querySelector('.bp-id-link')) {
                const link = document.createElement('a');
                link.href = `https://euw1.brightpearlapp.com/patt-op.php?scode=product&pID=${productId}&action=new_product`;
                link.textContent = '[page]';
                link.className = 'bp-id-link';
                link.target = '_blank';
                link.style.marginLeft = '5px';
                link.style.fontSize = '10px';
                link.style.color = '#0066cc';
                cell.appendChild(link);
            }

            const product = productDataCache[productId];

            // Only add cells if product exists
            if (product && product.sku) {
                // SKU cell - compact version
                let skuCell = row.querySelector('td[data-bp-sku="' + productId + '"]');
                if (!skuCell) {
                    skuCell = document.createElement('td');
                    skuCell.setAttribute('data-bp-sku', productId);
                    skuCell.style.fontSize = '11px';
                    skuCell.style.padding = '4px 6px';
                    skuCell.style.fontWeight = '600';
                    skuCell.style.color = '#2c5aa0';
                    skuCell.style.backgroundColor = '#f9f9f9';
                    skuCell.style.fontFamily = 'monospace';
                    skuCell.style.borderLeft = '2px solid #4CAF50';
                    skuCell.style.whiteSpace = 'nowrap';
                    skuCell.style.maxWidth = '120px';
                    skuCell.style.overflow = 'hidden';
                    skuCell.style.textOverflow = 'ellipsis';

                    // Insert after the current cell (product ID cell)
                    if (cell.nextSibling) {
                        row.insertBefore(skuCell, cell.nextSibling);
                    } else {
                        row.appendChild(skuCell);
                    }
                }

                // Stock cell
                let stockCell = row.querySelector('td[data-bp-stock="' + productId + '"]');
                if (!stockCell) {
                    stockCell = document.createElement('td');
                    stockCell.setAttribute('data-bp-stock', productId);
                    stockCell.style.textAlign = 'center';
                    stockCell.style.fontWeight = 'bold';
                    stockCell.style.fontSize = '13px';
                    stockCell.style.padding = '4px 8px';
                    stockCell.style.minWidth = '50px';
                    stockCell.style.backgroundColor = '#f9f9f9';
                    row.appendChild(stockCell);
                }

                // Dims cell
                let dimCell = row.querySelector('td[data-bp-dims="' + productId + '"]');
                if (!dimCell) {
                    dimCell = document.createElement('td');
                    dimCell.setAttribute('data-bp-dims', productId);
                    dimCell.style.fontSize = '10px';
                    dimCell.style.padding = '4px 6px';
                    dimCell.style.lineHeight = '1.3';
                    dimCell.style.whiteSpace = 'nowrap';
                    dimCell.style.color = '#555';
                    dimCell.style.backgroundColor = '#f9f9f9';
                    row.appendChild(dimCell);
                }

                skuCell.textContent = product.sku;
                skuCell.title = product.sku; // Show full SKU on hover
                stockCell.textContent = product.totalStock;
                stockCell.style.color = product.totalStock > 0 ? '#009900' : '#cc0000';
                dimCell.innerHTML = `<div style="font-size:10px;"><strong>W:</strong> ${product.weight}kg<br><strong>D:</strong> ${product.length}×${product.width}×${product.height}cm</div>`;
            }
        });
    }

    // STOCK/INVENTORY TAB
    function updateStockInventoryTab() {
        if (!dataLoaded) return;

        let stockTab = document.querySelector('#undefinednav2');
        if (!stockTab || !stockTab.closest('li').classList.contains('tabberactive')) {
            return;
        }

        const productId = getCurrentProductId();
        if (!productId) return;

        const product = productDataCache[productId];
        if (!product) return;

        // Remove existing breakdown
        let existing = document.getElementById('bp-warehouse-breakdown');
        if (existing) {
            existing.remove();
        }

        // Find visible tab
        const visibleTab = document.querySelector('.tabbertab:not(.tabbertabhide)');
        if (!visibleTab) return;

        // Create breakdown
        const breakdownDiv = document.createElement('div');
        breakdownDiv.id = 'bp-warehouse-breakdown';

        let html = '<h3>📦 Warehouse Stock Breakdown</h3>';
        html += '<table id="bp-warehouse-table">';
        html += '<thead><tr><th>Warehouse</th><th>On Hand</th></tr></thead>';
        html += '<tbody>';

        let totalStock = 0;
        const warehouses = Object.entries(product.warehouseStock).sort((a, b) => b[1] - a[1]);

        if (warehouses.length === 0) {
            html += '<tr><td colspan="2" style="text-align:center;color:#999;">No warehouse data available</td></tr>';
        } else {
            warehouses.forEach(([warehouse, stock]) => {
                totalStock += stock;
                const stockClass = stock > 0 ? 'positive' : 'zero';
                html += `<tr><td>${warehouse}</td><td class="stock ${stockClass}">${stock}</td></tr>`;
            });
        }

        html += '</tbody>';
        html += '<tfoot><tr><td>Total</td><td class="stock positive">' + totalStock + '</td></tr></tfoot>';
        html += '</table>';

        breakdownDiv.innerHTML = html;
        visibleTab.appendChild(breakdownDiv);
    }

    // Tab clicks
    document.body.addEventListener('click', function(e) {
        if (e.target.id === 'undefinednav8' || e.target.closest('#undefinednav8')) {
            setTimeout(updateBundleTable, 300);
        }
        if (e.target.id === 'undefinednav2' || e.target.closest('#undefinednav2')) {
            setTimeout(updateStockInventoryTab, 300);
        }
        setTimeout(addSkuToTitle, 500);
    });

    // Initialize
    fetchMetabaseData().then(() => {
        setTimeout(() => {
            addSkuToTitle();
            updateBundleTable();
            updateStockInventoryTab();
        }, 1000);
    });
})();

