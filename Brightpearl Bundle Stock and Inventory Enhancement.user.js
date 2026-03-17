// ==UserScript==
// @name         Brightpearl Bundle Stock and Inventory Enhancement + TR PO Tab
// @namespace    http://tampermonkey.net/
// @version      11.20
// @description  Bundle & inventory enhancements + TR Purchase Orders tab loaded from Metabase POs only when opened, showing coloured status chips and hiding PO tab when other tabs are selected. Now includes cost price breakdown per currency on the Prices tab.
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

    // INVENTORY / BUNDLE CARD
    const INVENTORY_CARD_UUID = '2627b450-000b-4e2e-96fa-cc07aee37f8c';

    // PO QUESTION – "Tampermonkeyly PO Final"
    const PO_QUESTION_UUID = 'fcd1f170-b73a-4537-8f8b-105e126c938b';

    // COST PRICE CARD — public Metabase question using bpproductprice table
    // ⚠️  Replace the UUID below with your actual public card UUID
    const COST_PRICE_CARD_UUID = 'ffcefd81-7e86-4189-a6ca-e6e379c90469';
    const COST_PRICE_PRODUCT_ID_TEMPLATE_TAG = 'product_id';

    // ─── METABASE FILTERING ────────────────────────────────────────────────────
    const PO_PRODUCT_ID_TEMPLATE_TAG = 'product_id';
    // ──────────────────────────────────────────────────────────────────────────

    const PO_ORDER_URL_TEMPLATE = 'https://euw1.brightpearlapp.com/patt-op.php?scode=invoice&oID={{ORDERID}}';

    const ALLOWED_PO_STATUS_IDS = new Set(['6', '7', '34', '43', '46', '45']);

    const STATUS_NAME_BY_ID = {
        '6':  'Pending PO',
        '7':  'Placed with supplier',
        '34': 'In transit',
        '36': 'Cancelled PO',
        '38': 'Delivered',
        '43': 'Submitted for Payment',
        '46': 'Ready for Submission',
        '45': 'Fully paid'
    };

    const STATUS_COLOR_BY_ID = {
        '6':  '#EEEEEE',
        '7':  '#AAFFEE',
        '34': '#FAFD21',
        '36': '#E6515A',
        '38': '#F3A930',
        '43': '#C8DAEE',
        '46': '#9159F8',
        '45': '#EA85D3'
    };

    const WAREHOUSE_ID_MAP = {
        '2':  'Trak Racer US TX ShipBob',
        '3':  'Trak Racer UK AMWorld',
        '4':  'China Stock',
        '5':  'Trak Racer NZ OnlineDist',
        '6':  'Trak Racer AU WFDS',
        '7':  'Trak Racer EU Warehouse',
        '8':  'HikeIt US TX ShipBob',
        '9':  'TR USA OFF Location',
        '15': 'HikeIt AU WFDS',
        '16': 'Trak Racer US Hollingsworth LLC',
        '17': 'Trak Racer ES Warehouse',
        '18': 'Trak Racer AE Warehouse',
        '19': 'Reseller Warehouse',
        '20': 'Shenzhen TROS Warehouse',
        '21': 'Hunan Warehouse',
        '23': 'NL Office',
        '24': 'BOM WAREHOUSE',
        '25': 'AU office',
        '26': 'US office',
        '27': 'TR UNDER CLAIM EU',
        '28': 'TR UNDER CLAIM US',
        '29': 'TR UNDER CLAIM UK',
        '30': 'TR UNDER CLAIM AU',
        '31': 'Trak Racer CANADA',
        '32': 'Trak Racer ARC Sentry',
        '33': 'Trak Racer NZ AE Logistics',
        '34': 'Trak Racer CA GO BOLT'
    };

    // INVENTORY / BUNDLE DATA
    let productDataCache = {};
    let inventoryDataLoaded = false;

    // PO DATA
    let poRowsByProductId     = {};
    let poFullDataLoaded      = false;
    let poFullDataLoading     = false;
    let poLoadedProductIds    = new Set();
    let poLoadingProductIds   = new Set();
    let poDataError           = null;

    // COST PRICE DATA
    let cpRowsByProductId     = {};       // productId → rows[]
    let cpLoadedProductIds    = new Set();
    let cpLoadingProductIds   = new Set();
    let cpDataError           = null;

    // ─────────────────────────────────────────────────────────────────────────
    // STYLES
    // ─────────────────────────────────────────────────────────────────────────
    const style = document.createElement('style');
    style.textContent = `
        .tabbertab table tr td[data-bp-stock],
        .tabbertab table tr td[data-bp-dims],
        .tabbertab table tr td[data-bp-sku] {
            background-color: #f9f9f9 !important;
        }
        .tabbertab table tr td[data-bp-sku] {
            border-left: 2px solid #4CAF50 !important;
            max-width: 130px !important;
            padding: 2px 4px 2px 6px !important;
        }
        .tabbertab table tr td[data-bp-sku] a {
            color: #2c5aa0;
            text-decoration: none;
            font-weight: 600;
            font-size: 12px;
        }
        .tabbertab table tr td[data-bp-sku] a:hover {
            text-decoration: underline;
            color: #1a3a6b;
        }
        .tabbertab table tr td[data-bp-stock] {
            padding: 2px 4px !important;
            min-width: 40px !important;
        }
        .tabbertab table tr td[data-bp-dims] {
            padding: 2px 4px !important;
        }
        .bp-data-notice-row td {
            font-size: 11px;
            color: #666;
            font-style: italic;
            padding-top: 4px !important;
            border-top: 1px solid #ddd;
        }
        #bp-sku-display {
            display: inline-block;
            margin-left: 15px;
            padding: 5px 12px;
            background: #e8f4f8;
            border: 1px solid #b8d4e0;
            border-radius: 3px;
            font-size: 14px;
            color: #2c5aa0;
            vertical-align: middle;
        }
        #bp-sku-display strong { font-weight: 600; }
        #bp-warehouse-breakdown {
            margin: 20px 0 10px 0;
            padding: 15px;
            border: 1px solid #ddd;
            border-radius: 5px;
            background: #f9f9f9;
        }
        #bp-warehouse-breakdown h3 {
            margin: 0 0 6px 0;
            font-size: 14px;
            font-weight: bold;
            color: #333;
        }
        .bp-inventory-notice {
            font-size: 11px;
            color: #666;
            font-style: italic;
            margin-bottom: 8px;
        }
        #bp-warehouse-table {
            width: 100%;
            max-width: 600px;
            border-collapse: collapse;
            font-size: 12px;
            table-layout: fixed;
        }
        #bp-warehouse-table th {
            background: #e8e8e8;
            padding: 8px;
            text-align: left;
            font-weight: bold;
            border-bottom: 2px solid #ccc;
        }
        #bp-warehouse-table th:first-child { width: 70%; }
        #bp-warehouse-table th:last-child  { width: 30%; text-align: center; }
        #bp-warehouse-table td {
            padding: 6px 8px;
            border-bottom: 1px solid #e0e0e0;
        }
        #bp-warehouse-table tr:hover { background: #f0f0f0; }
        #bp-warehouse-table td.stock {
            text-align: center;
            font-weight: bold;
        }
        #bp-warehouse-table td.stock.positive { color: #009900; }
        #bp-warehouse-table td.stock.zero     { color: #999; }
        #bp-warehouse-table tfoot td {
            font-weight: bold;
            background: #e8e8e8;
            border-top: 2px solid #ccc;
            padding: 8px;
        }
        #bp-warehouse-table tfoot td:last-child { text-align: center; }
        .bp-bundle-header {
            margin: 8px 0;
            padding: 4px 8px;
            background: #f8d7da;
            border: 1px solid #f5c2c7;
            border-radius: 3px;
            color: #842029;
            font-size: 12px;
            font-weight: bold;
        }
        .bp-bundle-notice {
            display: inline-block;
            margin-left: 10px;
            padding: 4px 10px;
            background: #fff3cd;
            border: 1px solid #ffc107;
            border-radius: 3px;
            font-size: 12px;
            font-weight: bold;
            color: #856404;
        }
        #bp-po-tab-inner {
            margin: 15px 0;
            padding: 12px 15px;
            border-radius: 5px;
            border: 1px solid #ddd;
            background: #fdfdfd;
            font-size: 11px;
        }
        #bp-po-tab-inner h3 {
            margin: 0 0 6px 0;
            font-size: 13px;
            font-weight: bold;
            color: #333;
        }
        #bp-po-tab-inner .bp-po-notice {
            font-size: 11px;
            color: #666;
            font-style: italic;
            margin-bottom: 6px;
        }
        #bp-po-table {
            width: 100%;
            max-width: 800px;
            border-collapse: collapse;
            font-size: 11px;
            table-layout: fixed;
        }
        #bp-po-table th {
            background: #e8e8e8;
            padding: 6px;
            text-align: left;
            font-weight: bold;
            border-bottom: 2px solid #ccc;
        }
        #bp-po-table th:first-child { width: 30%; }
        #bp-po-table th:last-child  { width: 70%; }
        #bp-po-table td {
            padding: 5px 6px;
            border-bottom: 1px solid #e0e0e0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            vertical-align: top;
        }
        #bp-po-table tr:hover { background: #f5f5f5; }
        .bp-po-line { white-space: nowrap; }
        .bp-po-line a {
            color: #2c5aa0;
            font-weight: 600;
            text-decoration: none;
            margin-right: 4px;
        }
        .bp-po-line a:hover {
            text-decoration: underline;
            color: #1a3a6b;
        }
        .bp-po-status-chip {
            display: inline-block;
            margin-left: 4px;
            padding: 1px 6px;
            border-radius: 3px;
            font-size: 10px;
            border: 1px solid #999;
        }
        #bp-po-empty {
            font-size: 11px;
            color: #777;
            margin-top: 4px;
        }
        #bp-po-error {
            font-size: 11px;
            color: #b00020;
            margin-top: 4px;
        }
        .bp-po-retry {
            margin-left: 8px;
            font-size: 11px;
            color: #2c5aa0;
            cursor: pointer;
            text-decoration: underline;
        }

        /* ── Cost Price Breakdown ───────────────────────────────────────────── */
        #bp-cost-price-breakdown {
            margin: 20px 0 10px 0;
            padding: 15px;
            border: 1px solid #ddd;
            border-radius: 5px;
            background: #f9f9f9;
        }
        #bp-cost-price-breakdown h3 {
            margin: 0 0 6px 0;
            font-size: 14px;
            font-weight: bold;
            color: #333;
        }
        #bp-cost-price-breakdown .bp-cp-notice {
            font-size: 11px;
            color: #666;
            font-style: italic;
            margin-bottom: 8px;
        }
        #bp-cost-price-table {
            width: 100%;
            max-width: 480px;
            border-collapse: collapse;
            font-size: 12px;
        }
        #bp-cost-price-table th {
            background: #e8e8e8;
            padding: 7px 10px;
            text-align: left;
            font-weight: bold;
            border-bottom: 2px solid #ccc;
        }
        #bp-cost-price-table td {
            padding: 6px 10px;
            border-bottom: 1px solid #e0e0e0;
        }
        #bp-cost-price-table tr:hover { background: #f0f0f0; }
        #bp-cost-price-table td.bp-cp-currency {
            font-weight: bold;
            color: #2c5aa0;
            white-space: nowrap;
        }
        #bp-cost-price-table td.bp-cp-price {
            font-family: monospace;
            font-size: 13px;
        }
        #bp-cost-price-table td.bp-cp-price.has-value { color: #1a1a1a; }
        #bp-cost-price-table td.bp-cp-price.no-value  { color: #aaa; font-style: italic; }
        #bp-cost-price-no-data {
            font-size: 11px;
            color: #888;
            font-style: italic;
            margin-top: 4px;
        }
    `;
    document.head.appendChild(style);

    // ─────────────────────────────────────────────────────────────────────────
    // HELPERS
    // ─────────────────────────────────────────────────────────────────────────
    function getCurrentProductId() {
        const match = window.location.href.match(/pID=(\d+)/);
        return match ? match[1] : null;
    }

    function addSkuToTitle() {
        if (!inventoryDataLoaded) return;
        const productId = getCurrentProductId();
        if (!productId) return;
        const product = productDataCache[productId];
        if (!product || !product.sku) return;
        if (document.getElementById('bp-sku-display')) return;

        const h1 = document.querySelector('h1');
        if (!h1) return;

        const skuSpan = document.createElement('span');
        skuSpan.id = 'bp-sku-display';
        skuSpan.innerHTML = `<strong>SKU:</strong> ${product.sku}`;
        h1.appendChild(skuSpan);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // INVENTORY LOAD
    // ─────────────────────────────────────────────────────────────────────────
    function fetchInventoryData() {
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `${METABASE_URL}/api/public/card/${INVENTORY_CARD_UUID}/query/json`,
                onload: function(response) {
                    try {
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
                                    bundleFlag: row['Bundle'] || 0,
                                    compositionRaw: row['Product Composition'] || null,
                                    totalStock: 0,
                                    warehouseStock: {},
                                    bundleComponents: []
                                };
                            }

                            const product = productDataCache[productId];
                            const wh = row['Products Inventory Summary - Product → Warehouse Name'];
                            const onhand = parseInt(row['Products Inventory Summary - Product → Onhand']) || 0;
                            if (wh) {
                                product.warehouseStock[wh] = onhand;
                                product.totalStock += onhand;
                            }

                            if (row['Product Composition'] && !product.bundleComponents.length) {
                                try {
                                    const comp = JSON.parse(row['Product Composition']);
                                    if (comp.bundle && Array.isArray(comp.bundleComponents)) {
                                        product.bundleComponents = comp.bundleComponents.map(c => ({
                                            productId: String(c.productId),
                                            quantity: c.productQuantity || 1
                                        }));
                                    }
                                } catch (e) { /* ignore bad JSON */ }
                            }
                        });

                        inventoryDataLoaded = true;
                        resolve();
                    } catch (err) {
                        console.error('Inventory parse error', err);
                        inventoryDataLoaded = true;
                        resolve();
                    }
                }
            });
        });
    }

    function isBundleByMetabase() {
        const productId = getCurrentProductId();
        if (!productId) return false;
        const product = productDataCache[productId];
        if (!product) return false;
        return product.bundleFlag === 1 || product.bundleFlag === '1' || product.bundleFlag === true;
    }

    function getBundleAvailabilityPerWarehouseWithDetails() {
        const productId = getCurrentProductId();
        if (!productId) return null;
        const product = productDataCache[productId];
        if (!product || !product.bundleComponents.length) return null;

        const allWarehouses = new Set();
        product.bundleComponents.forEach(comp => {
            const compData = productDataCache[comp.productId];
            if (!compData) return;
            Object.keys(compData.warehouseStock).forEach(w => allWarehouses.add(w));
        });

        const perWarehouseBundles = {};
        const perWarehouseDetails = {};

        allWarehouses.forEach(wh => {
            let whMin = Infinity;
            const details = [];

            product.bundleComponents.forEach(comp => {
                const compData = productDataCache[comp.productId];
                if (!compData) return;
                const qty = comp.quantity || 1;
                const stockAtWh = compData.warehouseStock[wh] || 0;
                const possibleHere = Math.floor(stockAtWh / qty);
                if (possibleHere < whMin) whMin = possibleHere;
                details.push({ sku: compData.sku, stock: stockAtWh, quantity: qty, possible: possibleHere });
            });

            if (whMin === Infinity) whMin = 0;
            perWarehouseBundles[wh] = whMin;
            perWarehouseDetails[wh] = details;
        });

        const totalBundles = Object.values(perWarehouseBundles).reduce((sum, v) => sum + v, 0);
        return { perWarehouseBundles, perWarehouseDetails, maxBundles: totalBundles };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // BUNDLE TAB
    // ─────────────────────────────────────────────────────────────────────────
    function updateBundleTable() {
        if (!inventoryDataLoaded) return;
        const bundleTab = document.querySelector('#undefinednav8');
        if (!bundleTab || !bundleTab.closest('li').classList.contains('tabberactive')) return;

        const visibleTab = document.querySelector('.tabbertab:not(.tabbertabhide)');
        if (!visibleTab) return;
        const rightBlock = visibleTab.querySelector('table');
        if (!rightBlock) return;

        rightBlock.querySelectorAll('td').forEach(td => {
            td.style.paddingTop = '3px';
            td.style.paddingBottom = '3px';
        });

        document.querySelectorAll('.tabbertab:not(.tabbertabhide) input[type="text"]').forEach(input => {
            const productId = input.value.trim();
            if (!/^\d+$/.test(productId)) return;
            const cell = input.closest('td');
            if (!cell) return;
            const row = cell.closest('tr');
            if (!row) return;

            let currentCell = cell.nextSibling;
            while (currentCell && !currentCell.hasAttribute('data-bp-sku')) {
                if (currentCell.nodeType === 1 && currentCell.tagName === 'TD') {
                    const text = currentCell.textContent.trim();
                    if (text === '0' || text === '-' || text === '') currentCell.style.display = 'none';
                }
                currentCell = currentCell.nextSibling;
            }

            const product = productDataCache[productId];
            if (!product || !product.sku) return;

            let skuCell = row.querySelector(`td[data-bp-sku="${productId}"]`);
            if (!skuCell) {
                skuCell = document.createElement('td');
                skuCell.setAttribute('data-bp-sku', productId);
                Object.assign(skuCell.style, {
                    padding: '2px 4px 2px 6px', backgroundColor: '#f9f9f9',
                    fontFamily: 'monospace', borderLeft: '2px solid #4CAF50',
                    whiteSpace: 'nowrap', maxWidth: '130px',
                    overflow: 'hidden', textOverflow: 'ellipsis'
                });
                if (cell.nextSibling) row.insertBefore(skuCell, cell.nextSibling);
                else row.appendChild(skuCell);
            }

            const skuLink = document.createElement('a');
            skuLink.href = `https://euw1.brightpearlapp.com/patt-op.php?scode=product&pID=${productId}&action=new_product`;
            skuLink.textContent = product.sku;
            skuLink.target = '_blank';
            skuLink.title = `Open product ${product.sku} (${productId})`;
            skuCell.innerHTML = '';
            skuCell.appendChild(skuLink);

            let stockCell = row.querySelector(`td[data-bp-stock="${productId}"]`);
            if (!stockCell) {
                stockCell = document.createElement('td');
                stockCell.setAttribute('data-bp-stock', productId);
                Object.assign(stockCell.style, {
                    textAlign: 'center', fontWeight: 'bold', fontSize: '12px',
                    padding: '2px 4px', minWidth: '40px', backgroundColor: '#f9f9f9'
                });
                row.appendChild(stockCell);
            }

            let dimCell = row.querySelector(`td[data-bp-dims="${productId}"]`);
            if (!dimCell) {
                dimCell = document.createElement('td');
                dimCell.setAttribute('data-bp-dims', productId);
                Object.assign(dimCell.style, {
                    fontSize: '10px', padding: '2px 4px', lineHeight: '1.3',
                    whiteSpace: 'nowrap', color: '#555', backgroundColor: '#f9f9f9'
                });
                row.appendChild(dimCell);
            }

            stockCell.textContent = product.totalStock;
            stockCell.style.color = product.totalStock > 0 ? '#009900' : '#cc0000';
            dimCell.innerHTML =
                `<div style="font-size:10px;"><strong>W:</strong> ${product.weight}kg<br>` +
                `<strong>D:</strong> ${product.length}×${product.width}×${product.height}cm</div>`;
        });

        const tbody = rightBlock.tBodies[0] || rightBlock.createTBody();
        let noticeRow = rightBlock.querySelector('.bp-data-notice-row');
        if (!noticeRow) {
            noticeRow = document.createElement('tr');
            noticeRow.className = 'bp-data-notice-row';
            const noticeCell = document.createElement('td');
            noticeCell.colSpan = 3;
            noticeCell.textContent = '📊 Data from Metabase - may be up to 1 hour old';
            noticeRow.appendChild(noticeCell);
        }
        tbody.appendChild(noticeRow);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STOCK / INVENTORY TAB
    // ─────────────────────────────────────────────────────────────────────────
    function updateStockInventoryTab() {
        if (!inventoryDataLoaded) return;
        const stockTab = document.querySelector('#undefinednav2');
        if (!stockTab || !stockTab.closest('li').classList.contains('tabberactive')) return;

        const productId = getCurrentProductId();
        if (!productId) return;
        const product = productDataCache[productId];
        if (!product) return;

        let existing = document.getElementById('bp-warehouse-breakdown');
        if (existing) existing.remove();

        const visibleTab = document.querySelector('.tabbertab:not(.tabbertabhide)');
        if (!visibleTab) return;

        const isBundle = isBundleByMetabase();
        const bundleData = isBundle ? getBundleAvailabilityPerWarehouseWithDetails() : null;

        const breakdownDiv = document.createElement('div');
        breakdownDiv.id = 'bp-warehouse-breakdown';

        let html = '<h3>📦 Warehouse Stock Breakdown';
        if (isBundle) html += ' <span class="bp-bundle-notice">⚙️ BUNDLE SKU</span>';
        html += '</h3>';
        html += '<div class="bp-inventory-notice">📊 Data from Metabase - may be up to 1 hour old</div>';
        html += '<div class="bp-bundle-header">';
        html += isBundle
            ? 'Bundle SKU — bundles available per warehouse, limited by component stock.'
            : 'Data from Metabase — stock on hand per warehouse.';
        html += '</div>';

        html += '<table id="bp-warehouse-table"><thead><tr><th>Warehouse</th><th>';
        html += isBundle ? 'Bundles Available' : 'On Hand';
        html += '</th></tr></thead><tbody>';

        let total = 0;

        if (isBundle && bundleData) {
            const entries = Object.entries(bundleData.perWarehouseBundles).sort((a, b) => b[1] - a[1]);
            if (!entries.length) {
                html += '<tr><td colspan="2" style="text-align:center;color:#999;">No bundle component data available</td></tr>';
            } else {
                entries.forEach(([warehouse, bundles]) => {
                    total += bundles;
                    html += `<tr><td>${warehouse}</td><td class="stock ${bundles > 0 ? 'positive' : 'zero'}">${bundles}</td></tr>`;
                });
            }
        } else {
            const warehouses = Object.entries(product.warehouseStock).sort((a, b) => b[1] - a[1]);
            if (!warehouses.length) {
                html += '<tr><td colspan="2" style="text-align:center;color:#999;">No warehouse data available</td></tr>';
            } else {
                warehouses.forEach(([warehouse, stock]) => {
                    total += stock;
                    html += `<tr><td>${warehouse}</td><td class="stock ${stock > 0 ? 'positive' : 'zero'}">${stock}</td></tr>`;
                });
            }
        }

        html += '</tbody>';
        if (isBundle && bundleData) {
            html += `<tfoot><tr><td>Total Bundles Across Warehouses</td><td class="stock positive">${bundleData.maxBundles}</td></tr></tfoot>`;
        } else {
            html += `<tfoot><tr><td>Total</td><td class="stock positive">${total}</td></tr></tfoot>`;
        }
        html += '</table>';

        breakdownDiv.innerHTML = html;
        visibleTab.appendChild(breakdownDiv);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // COST PRICE TAB  (#undefinednav3 — "Prices")
    // ─────────────────────────────────────────────────────────────────────────

    function fetchCostPriceDataIfNeeded(productId, callback) {
        cpDataError = null;
        if (!productId) { callback(); return; }
        if (cpLoadedProductIds.has(productId)) { callback(); return; }

        if (cpLoadingProductIds.has(productId)) {
            const check = () => cpLoadedProductIds.has(productId) ? callback() : setTimeout(check, 200);
            check();
            return;
        }

        cpLoadingProductIds.add(productId);

        const params = JSON.stringify([{
            type: 'number/=',
            value: [String(productId)],
            target: ['variable', ['template-tag', COST_PRICE_PRODUCT_ID_TEMPLATE_TAG]]
        }]);
        const url = `${METABASE_URL}/api/public/card/${COST_PRICE_CARD_UUID}/query/json?parameters=${encodeURIComponent(params)}`;

        GM_xmlhttpRequest({
            method: 'GET',
            url,
            timeout: 15000,
            onload(response) {
                try {
                    const raw  = JSON.parse(response.responseText);
                    const rows = Array.isArray(raw)      ? raw
                               : Array.isArray(raw.data) ? raw.data
                               : Array.isArray(raw.rows) ? raw.rows
                               : null;
                    if (!rows) {
                        console.error('Unexpected cost price JSON shape', raw);
                        cpDataError = 'Unexpected JSON format from Metabase cost price card.';
                    } else {
                        cpRowsByProductId[productId] = rows.map(r => ({
                            priceListId:  r['pricelistid']  != null ? String(r['pricelistid'])  : '',
                            currencyCode: r['currencycode'] != null ? String(r['currencycode']).trim() : '',
                            price:        r['price']        != null ? r['price']                : null,
                            lastSync:     r['last_sync_time'] ?? null
                        }));
                    }
                } catch (err) {
                    console.error('Cost price parse error', err);
                    cpDataError = 'Failed to parse cost price data from Metabase.';
                } finally {
                    cpLoadedProductIds.add(productId);
                    cpLoadingProductIds.delete(productId);
                    callback();
                }
            },
            onerror(err) {
                console.error('Cost price request error', err);
                cpDataError = 'Error calling Metabase cost price endpoint.';
                cpLoadedProductIds.add(productId);
                cpLoadingProductIds.delete(productId);
                callback();
            },
            ontimeout() {
                cpDataError = 'Timed out loading cost price data from Metabase.';
                cpLoadedProductIds.add(productId);
                cpLoadingProductIds.delete(productId);
                callback();
            }
        });
    }

    // Finds the right-hand sidebar on the Prices tab (contains Tax class, Net price calculator etc.)
    // Falls back to appending inside the visible tab if not found.
    function getCostPriceTarget() {
        // The right panel wraps the Tax class dropdown and Net price calculator.
        // BP renders it as a div/td that contains an element with text "Net price calculator".
        const netCalc = Array.from(document.querySelectorAll('*')).find(el =>
            el.childNodes.length &&
            [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.includes('Net price calculator')) &&
            el.tagName !== 'SCRIPT'
        );
        if (netCalc) {
            // Go up to a block-level container
            let container = netCalc.closest('td, div, section');
            if (container) return container;
        }
        // Fallback: visible tab
        return document.querySelector('.tabbertab:not(.tabbertabhide)');
    }

    // Parses the price field which Metabase may return as:
    //   - a plain number: 19.86
    //   - a JSON string: {"1":"19.8600"}  (break qty → price map)
    //   - a JSON object already parsed
    function parsePriceField(val) {
        if (val === null || val === undefined || val === '') return null;
        // Already a number
        if (typeof val === 'number') return val;
        // String — try JSON parse
        if (typeof val === 'string') {
            const trimmed = val.trim();
            if (trimmed.startsWith('{')) {
                try {
                    const obj = JSON.parse(trimmed);
                    // Take the value for key "1" (break qty 1), or the first value
                    const keys = Object.keys(obj);
                    const baseKey = keys.includes('1') ? '1' : keys[0];
                    return baseKey !== undefined ? parseFloat(obj[baseKey]) : null;
                } catch (e) { /* fall through */ }
            }
            const n = parseFloat(trimmed);
            return isNaN(n) ? null : n;
        }
        // Object already
        if (typeof val === 'object') {
            const keys = Object.keys(val);
            const baseKey = keys.includes('1') ? '1' : keys[0];
            return baseKey !== undefined ? parseFloat(val[baseKey]) : null;
        }
        return null;
    }

    function updateCostPricesTab() {
        const pricesNavLink = document.querySelector('#undefinednav3');
        if (!pricesNavLink || !pricesNavLink.closest('li').classList.contains('tabberactive')) return;

        const existing = document.getElementById('bp-cost-price-breakdown');
        if (existing) existing.remove();

        const productId = getCurrentProductId();
        if (!productId) return;

        const target = getCostPriceTarget();
        if (!target) return;

        const breakdownDiv = document.createElement('div');
        breakdownDiv.id = 'bp-cost-price-breakdown';
        breakdownDiv.innerHTML = `<h3>💰 Cost Prices by Currency</h3>
            <div class="bp-cp-notice">⏳ Loading cost prices from Metabase…</div>`;
        target.appendChild(breakdownDiv);

        fetchCostPriceDataIfNeeded(productId, () => renderCostPricesTab(productId));
    }

    function renderCostPricesTab(productId) {
        let breakdownDiv = document.getElementById('bp-cost-price-breakdown');
        if (!breakdownDiv) {
            const target = getCostPriceTarget();
            if (!target) return;
            breakdownDiv = document.createElement('div');
            breakdownDiv.id = 'bp-cost-price-breakdown';
            target.appendChild(breakdownDiv);
        }

        let html = `<h3>💰 Cost Prices by Currency</h3>`;
        html += `<div class="bp-cp-notice">📊 Data from Metabase — may be up to 1 hour old.</div>`;

        if (cpDataError) {
            html += `<div id="bp-cost-price-no-data" style="color:#b00020;">${cpDataError}
                <span class="bp-po-retry" id="bp-cp-retry-btn">Retry</span></div>`;
            breakdownDiv.innerHTML = html;
            const retryBtn = breakdownDiv.querySelector('#bp-cp-retry-btn');
            if (retryBtn) {
                retryBtn.addEventListener('click', () => {
                    cpLoadedProductIds.delete(productId);
                    cpLoadingProductIds.delete(productId);
                    cpDataError = null;
                    updateCostPricesTab();
                });
            }
            return;
        }

        const rows = cpRowsByProductId[productId] || [];

        if (!rows.length) {
            html += `<div id="bp-cost-price-no-data">No cost prices found for this product in Metabase.</div>`;
            breakdownDiv.innerHTML = html;
            return;
        }

        // Group by currency — pick the row with the lowest parsed base price per currency
        const byCurrency = {};
        rows.forEach(r => {
            const parsed = parsePriceField(r.price);
            if (!byCurrency[r.currencyCode] || (parsed !== null && parsed < byCurrency[r.currencyCode].parsedPrice)) {
                byCurrency[r.currencyCode] = { ...r, parsedPrice: parsed };
            }
        });

        // Sort: USD first, then alphabetically
        const sortedEntries = Object.entries(byCurrency).sort(([a], [b]) => {
            if (a === 'USD') return -1;
            if (b === 'USD') return 1;
            return a.localeCompare(b);
        });

        const fmtPrice = val => {
            if (val === null || val === undefined || isNaN(val)) return '—';
            return val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
        };

        html += `<table id="bp-cost-price-table">
            <thead><tr><th>Currency</th><th>Cost Price</th></tr></thead>
            <tbody>`;

        sortedEntries.forEach(([currency, row]) => {
            const hasValue   = row.parsedPrice !== null && row.parsedPrice > 0;
            const priceClass = hasValue ? 'has-value' : 'no-value';
            html += `<tr>
                <td class="bp-cp-currency">${currency || '—'}</td>
                <td class="bp-cp-price ${priceClass}">${fmtPrice(row.parsedPrice)}</td>
            </tr>`;
        });

        html += `</tbody></table>`;
        breakdownDiv.innerHTML = html;
    }

        // ─────────────────────────────────────────────────────────────────────────
    // PO DATA LOAD
    // ─────────────────────────────────────────────────────────────────────────
    function buildPoQueryUrl(productId) {
        const base = `${METABASE_URL}/api/public/card/${PO_QUESTION_UUID}/query/json`;
        if (PO_PRODUCT_ID_TEMPLATE_TAG && productId) {
            const params = JSON.stringify([{
                type: 'number/=',
                value: [String(productId)],
                target: ['variable', ['template-tag', PO_PRODUCT_ID_TEMPLATE_TAG]]
            }]);
            return `${base}?parameters=${encodeURIComponent(params)}`;
        }
        return base;
    }

    function parseAndStorePoRows(rows) {
        rows.forEach(row => {
            const productId = row['productid'] != null
                ? String(row['productid']).replace(/,/g, '').trim()
                : '';
            const statusId = row['statusid'] != null ? String(row['statusid']) : null;

            if (!statusId || !ALLOWED_PO_STATUS_IDS.has(statusId)) return;

            const entry = {
                orderId:     row['orderid']      != null ? String(row['orderid'])               : '',
                warehouseId: row['warehouseid']  != null ? String(row['warehouseid'])            : '',
                delivery:    row['delivery_date'] ?? null,
                sku:         row['productsku']   != null ? String(row['productsku']).trim()      : '',
                qty:         row['quantity']     != null ? Number(row['quantity'])               : 0,
                statusId
            };

            if (productId) {
                if (!poRowsByProductId[productId]) poRowsByProductId[productId] = [];
                poRowsByProductId[productId].push(entry);
            }
        });
    }

    function fetchPoDataIfNeeded(productId, callback) {
        poDataError = null;

        if (PO_PRODUCT_ID_TEMPLATE_TAG) {
            if (!productId) { callback(); return; }
            if (poLoadedProductIds.has(productId)) { callback(); return; }
            if (poLoadingProductIds.has(productId)) {
                const check = () => poLoadedProductIds.has(productId) ? callback() : setTimeout(check, 200);
                check();
                return;
            }

            poLoadingProductIds.add(productId);

            GM_xmlhttpRequest({
                method: 'GET',
                url: buildPoQueryUrl(productId),
                timeout: 15000,
                onload(response) {
                    try {
                        const raw  = JSON.parse(response.responseText);
                        const rows = Array.isArray(raw)       ? raw
                                   : Array.isArray(raw.data)  ? raw.data
                                   : Array.isArray(raw.rows)  ? raw.rows
                                   : null;
                        if (!rows) {
                            console.error('Unexpected Metabase PO JSON shape', raw);
                            poDataError = 'Unexpected JSON format from Metabase PO question.';
                        } else {
                            parseAndStorePoRows(rows);
                            if (!poRowsByProductId[productId]) poRowsByProductId[productId] = [];
                        }
                    } catch (err) {
                        console.error('TR PO tab parse error', err);
                        poDataError = 'Failed to read PO data from Metabase (parse error).';
                    } finally {
                        poLoadedProductIds.add(productId);
                        poLoadingProductIds.delete(productId);
                        callback();
                    }
                },
                onerror(err) {
                    console.error('TR PO tab request error', err);
                    poDataError = 'Error calling Metabase PO endpoint.';
                    poLoadedProductIds.add(productId);
                    poLoadingProductIds.delete(productId);
                    callback();
                },
                ontimeout() {
                    console.error('TR PO tab request timeout');
                    poDataError = 'Timed out while loading PO data from Metabase.';
                    poLoadedProductIds.add(productId);
                    poLoadingProductIds.delete(productId);
                    callback();
                }
            });
            return;
        }

        if (poFullDataLoaded) { callback(); return; }
        if (poFullDataLoading) {
            const check = () => poFullDataLoaded ? callback() : setTimeout(check, 200);
            check();
            return;
        }

        poFullDataLoading = true;

        GM_xmlhttpRequest({
            method: 'GET',
            url: buildPoQueryUrl(null),
            timeout: 15000,
            onload(response) {
                try {
                    const raw  = JSON.parse(response.responseText);
                    const rows = Array.isArray(raw)      ? raw
                               : Array.isArray(raw.data) ? raw.data
                               : Array.isArray(raw.rows) ? raw.rows
                               : null;
                    if (!rows) {
                        console.error('Unexpected Metabase PO JSON shape', raw);
                        poDataError = 'Unexpected JSON format from Metabase PO question.';
                    } else {
                        parseAndStorePoRows(rows);
                    }
                } catch (err) {
                    console.error('TR PO tab parse/processing error', err,
                        response.responseText && response.responseText.slice(0, 200));
                    poDataError = 'Failed to read PO data from Metabase (parse error).';
                } finally {
                    poFullDataLoaded  = true;
                    poFullDataLoading = false;
                    callback();
                }
            },
            onerror(err) {
                console.error('TR PO tab request error', err);
                poDataError = 'Error calling Metabase PO endpoint.';
                poFullDataLoaded  = true;
                poFullDataLoading = false;
                callback();
            },
            ontimeout() {
                console.error('TR PO tab request timeout');
                poDataError = 'Timed out while loading PO data from Metabase.';
                poFullDataLoaded  = true;
                poFullDataLoading = false;
                callback();
            }
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TR PO TAB UI
    // ─────────────────────────────────────────────────────────────────────────
    let poTabPanel = null;
    let poTabLink  = null;

    function ensurePoTabExists() {
        if (poTabPanel && poTabLink) return;

        const anyNavLink = document.querySelector('#undefinednav2') || document.querySelector('#undefinednav8');
        if (!anyNavLink) return;
        const navList = anyNavLink.closest('ul');
        if (!navList) return;

        if (document.getElementById('trakpo-nav')) {
            poTabLink = document.getElementById('trakpo-nav');
        } else {
            const li = document.createElement('li');
            const a  = document.createElement('a');
            a.href = '#';
            a.id = 'trakpo-nav';
            a.textContent = 'TR Purchase Orders';
            li.appendChild(a);
            navList.appendChild(li);
            poTabLink = a;
        }

        const anyTab = document.querySelector('.tabbertab');
        if (!anyTab) return;
        const tabContainer = anyTab.parentNode;

        if (document.getElementById('trakpo-tab')) {
            poTabPanel = document.getElementById('trakpo-tab');
        } else {
            const div = document.createElement('div');
            div.id = 'trakpo-tab';
            div.className = 'tabbertab tabbertabhide';
            div.innerHTML = '<p style="font-size:11px;">TR Purchase Orders will load here…</p>';
            tabContainer.appendChild(div);
            poTabPanel = div;
        }

        poTabLink.addEventListener('click', function(e) {
            e.preventDefault();
            openPoTab();
        });
    }

    function openPoTab() {
        ensurePoTabExists();
        if (!poTabPanel || !poTabLink) return;

        document.querySelectorAll('.tabbertab').forEach(t => t.classList.add('tabbertabhide'));
        poTabPanel.classList.remove('tabbertabhide');

        const navList = poTabLink.closest('ul');
        if (navList) {
            navList.querySelectorAll('li').forEach(li => li.classList.remove('tabberactive'));
            poTabLink.closest('li').classList.add('tabberactive');
        }

        const productId = getCurrentProductId();
        if (!productId) {
            poTabPanel.innerHTML = '<div id="bp-po-tab-inner"><h3>TR Purchase Orders</h3><div>No Product ID detected on this page.</div></div>';
            return;
        }

        poTabPanel.innerHTML = '<div id="bp-po-tab-inner"><h3>TR Purchase Orders</h3><div class="bp-po-notice">⏳ Loading purchase orders from Metabase…</div></div>';

        fetchPoDataIfNeeded(productId, () => renderPoTab(productId));
    }

    function renderPoTab(productId) {
        ensurePoTabExists();
        if (!poTabPanel) return;

        const inner = document.createElement('div');
        inner.id = 'bp-po-tab-inner';

        const statusList = Array.from(ALLOWED_PO_STATUS_IDS)
            .map(id => STATUS_NAME_BY_ID[id] || id)
            .join(', ');

        let html = `<h3>TR Purchase Orders for this SKU</h3>`;
        html += `<div class="bp-po-notice">📊 Data from Metabase - may be up to 1 hour old. Showing only POs with statuses: ${statusList}.</div>`;

        if (poDataError) {
            html += `<div id="bp-po-error">${poDataError} <span class="bp-po-retry" id="bp-po-retry-btn">Retry</span></div>`;
            inner.innerHTML = html;
            poTabPanel.innerHTML = '';
            poTabPanel.appendChild(inner);

            inner.querySelector('#bp-po-retry-btn').addEventListener('click', () => {
                if (PO_PRODUCT_ID_TEMPLATE_TAG) {
                    poLoadedProductIds.delete(productId);
                    poLoadingProductIds.delete(productId);
                } else {
                    poFullDataLoaded  = false;
                    poFullDataLoading = false;
                    poRowsByProductId = {};
                }
                openPoTab();
            });
            return;
        }

        const rows = poRowsByProductId[productId] || [];

        if (!rows.length) {
            html += '<div id="bp-po-empty">No matching purchase orders found for this SKU in the allowed statuses.</div>';
            inner.innerHTML = html;
            poTabPanel.innerHTML = '';
            poTabPanel.appendChild(inner);
            return;
        }

        const byWh = {};
        rows.forEach(r => {
            const whName = WAREHOUSE_ID_MAP[r.warehouseId] || (r.warehouseId ? `Warehouse ${r.warehouseId}` : 'Unknown warehouse');
            if (!byWh[whName]) byWh[whName] = [];
            byWh[whName].push(r);
        });

        const fmtDate = val => {
            if (!val) return '';
            const d = new Date(val);
            return isNaN(d.getTime()) ? String(val) : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        };

        const buildStatusChip = statusId => {
            const label = STATUS_NAME_BY_ID[statusId] || statusId;
            const color = STATUS_COLOR_BY_ID[statusId] || '#EEEEEE';
            return `<span class="bp-po-status-chip" style="background:${color};">${label}</span>`;
        };

        html += '<table id="bp-po-table"><thead><tr><th>Warehouse</th><th>Open Purchase Orders</th></tr></thead><tbody>';

        Object.entries(byWh).sort((a, b) => a[0].localeCompare(b[0])).forEach(([warehouse, list]) => {
            const sorted = [...list].sort((a, b) => (Date.parse(a.delivery) || 0) - (Date.parse(b.delivery) || 0));

            const lines = sorted.map(o => {
                const orderId = o.orderId || '';
                const url     = orderId
                    ? PO_ORDER_URL_TEMPLATE.replace('{{ORDERID}}', encodeURIComponent(orderId))
                    : null;
                const idLabel  = orderId ? `PO ${orderId}` : 'PO';
                const linkHtml = url
                    ? `<a href="${url}" target="_blank" title="Open ${idLabel}">${idLabel}</a>`
                    : `<span>${idLabel}</span>`;
                return `<div class="bp-po-line">${linkHtml} — ${Number(o.qty)} due ${fmtDate(o.delivery)} ${buildStatusChip(o.statusId)}</div>`;
            }).join('');

            html += `<tr><td>${warehouse}</td><td>${lines}</td></tr>`;
        });

        html += '</tbody></table>';
        inner.innerHTML = html;
        poTabPanel.innerHTML = '';
        poTabPanel.appendChild(inner);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // EVENTS & INIT
    // ─────────────────────────────────────────────────────────────────────────
    function waitForElement(selector, callback, timeout = 5000) {
        const el = document.querySelector(selector);
        if (el) { callback(el); return; }

        const observer = new MutationObserver(() => {
            const found = document.querySelector(selector);
            if (found) {
                observer.disconnect();
                callback(found);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => observer.disconnect(), timeout);
    }

    document.body.addEventListener('click', function(e) {
        if (e.target.id === 'undefinednav8' || e.target.closest('#undefinednav8')) {
            setTimeout(updateBundleTable, 150);
        }
        if (e.target.id === 'undefinednav2' || e.target.closest('#undefinednav2')) {
            setTimeout(updateStockInventoryTab, 150);
        }

        // Prices tab — inject cost price breakdown
        if (e.target.id === 'undefinednav3' || e.target.closest('#undefinednav3')) {
            setTimeout(updateCostPricesTab, 150);
        }

        // Hide PO tab panel when any other nav tab is clicked
        if (poTabPanel && poTabLink) {
            const clickedLi = e.target.closest('li');
            const poLi      = poTabLink.closest('li');
            if (clickedLi && poLi && clickedLi !== poLi) {
                const navList = poTabLink.closest('ul');
                if (navList && navList.contains(clickedLi)) {
                    poTabPanel.classList.add('tabbertabhide');
                    poLi.classList.remove('tabberactive');
                }
            }
        }

        if (!document.getElementById('bp-sku-display')) {
            setTimeout(addSkuToTitle, 100);
        }
    });

    fetchInventoryData().then(() => {
        waitForElement('h1', () => {
            addSkuToTitle();
            updateBundleTable();
            updateStockInventoryTab();
            ensurePoTabExists();
        });
    });
})();
