// ==UserScript==
// @name         Brightpearl Bundle Stock and Inventory Enhancement + TR PO Tab
// @namespace    http://tampermonkey.net/
// @version      11.8
// @description  Bundle & inventory enhancements + TR Purchase Orders tab loaded from Metabase POs only when opened, using new PO question and correct columns/status filters, and hiding PO tab when other tabs are selected.
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

    // INVENTORY / BUNDLE CARD (unchanged)
    const INVENTORY_CARD_UUID = '2627b450-000b-4e2e-96fa-cc07aee37f8c';

    // NEW PO QUESTION (BP tampermonkey with PO - Duplicate)
    // Columns: Orderid, Statusid, Warehouseid, Delivery Date,
    //          Rows Productid, Rows Sku, Rows Quantity, Last Sync Time.
    const PO_QUESTION_UUID   = '5ecda805-c1d8-40dd-8d6a-da39b4a7cd1d';

    const PO_ORDER_URL_TEMPLATE = 'https://euw1.brightpearlapp.com/patt-op.php?scode=invoice&oID={{ORDERID}}';

    // Allowed PO statuses
    const ALLOWED_PO_STATUS_IDS = new Set(['6', '7', '34', '43', '45']);
    const STATUS_NAME_BY_ID = {
        '6':  'Pending PO',
        '7':  'Placed with supplier',
        '34': 'In transit',
        '43': 'Submitted for Payment',
        '45': 'Fully paid'
    };

    // Warehouseid → name mapping from latest warehouse export. [file:134]
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

    // PO DATA (lazy)
    let poRowsByProduct = {}; // productId -> rows
    let poDataLoaded = false;
    let poDataLoading = false;
    let poDataError = null;

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
        .bp-po-line {
            white-space: nowrap;
        }
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
    `;
    document.head.appendChild(style);

    // ---------- helpers ----------
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

    // ---------- inventory load ----------
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

                details.push({
                    sku: compData.sku,
                    stock: stockAtWh,
                    quantity: qty,
                    possible: possibleHere
                });
            });

            if (whMin === Infinity) whMin = 0;
            perWarehouseBundles[wh] = whMin;
            perWarehouseDetails[wh] = details;
        });

        const totalBundles = Object.values(perWarehouseBundles).reduce((sum, v) => sum + v, 0);

        return {
            perWarehouseBundles,
            perWarehouseDetails,
            maxBundles: totalBundles
        };
    }

    // ---------- BUNDLE TAB ----------
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
                    if (text === '0' || text === '-' || text === '') {
                        currentCell.style.display = 'none';
                    }
                }
                currentCell = currentCell.nextSibling;
            }

            const product = productDataCache[productId];
            if (!product || !product.sku) return;

            let skuCell = row.querySelector('td[data-bp-sku="' + productId + '"]');
            if (!skuCell) {
                skuCell = document.createElement('td');
                skuCell.setAttribute('data-bp-sku', productId);
                skuCell.style.padding = '2px 4px 2px 6px';
                skuCell.style.backgroundColor = '#f9f9f9';
                skuCell.style.fontFamily = 'monospace';
                skuCell.style.borderLeft = '2px solid #4CAF50';
                skuCell.style.whiteSpace = 'nowrap';
                skuCell.style.maxWidth = '130px';
                skuCell.style.overflow = 'hidden';
                skuCell.style.textOverflow = 'ellipsis';

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

            let stockCell = row.querySelector('td[data-bp-stock="' + productId + '"]');
            if (!stockCell) {
                stockCell = document.createElement('td');
                stockCell.setAttribute('data-bp-stock', productId);
                stockCell.style.textAlign = 'center';
                stockCell.style.fontWeight = 'bold';
                stockCell.style.fontSize = '12px';
                stockCell.style.padding = '2px 4px';
                stockCell.style.minWidth = '40px';
                stockCell.style.backgroundColor = '#f9f9f9';
                row.appendChild(stockCell);
            }

            let dimCell = row.querySelector('td[data-bp-dims="' + productId + '"]');
            if (!dimCell) {
                dimCell = document.createElement('td');
                dimCell.setAttribute('data-bp-dims', productId);
                dimCell.style.fontSize = '10px';
                dimCell.style.padding = '2px 4px';
                dimCell.style.lineHeight = '1.3';
                dimCell.style.whiteSpace = 'nowrap';
                dimCell.style.color = '#555';
                dimCell.style.backgroundColor = '#f9f9f9';
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
            tbody.appendChild(noticeRow);
        } else {
            tbody.appendChild(noticeRow);
        }
    }

    // ---------- INVENTORY TAB ----------
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
        if (isBundle) {
            html += ' <span class="bp-bundle-notice">⚙️ BUNDLE SKU</span>';
        }
        html += '</h3>';

        html += '<div class="bp-inventory-notice">📊 Data from Metabase - may be up to 1 hour old</div>';

        html += '<div class="bp-bundle-header">';
        if (isBundle) {
            html += 'Bundle SKU — bundles available per warehouse, limited by component stock.';
        } else {
            html += 'Data from Metabase — stock on hand per warehouse.';
        }
        html += '</div>';

        html += '<table id="bp-warehouse-table">';
        html += '<thead><tr><th>Warehouse</th><th>' +
            (isBundle ? 'Bundles Available' : 'On Hand') +
            '</th></tr></thead><tbody>';

        let total = 0;

        if (isBundle && bundleData) {
            const entries = Object.entries(bundleData.perWarehouseBundles).sort((a, b) => b[1] - a[1]);
            if (!entries.length) {
                html += '<tr><td colspan="2" style="text-align:center;color:#999;">No bundle component data available</td></tr>';
            } else {
                entries.forEach(([warehouse, bundles]) => {
                    total += bundles;
                    const cls = bundles > 0 ? 'positive' : 'zero';
                    html += `<tr><td>${warehouse}</td><td class="stock ${cls}">${bundles}</td></tr>`;
                });
            }
        } else {
            const warehouses = Object.entries(product.warehouseStock).sort((a, b) => b[1] - a[1]);
            if (!warehouses.length) {
                html += '<tr><td colspan="2" style="text-align:center;color:#999;">No warehouse data available</td></tr>';
            } else {
                warehouses.forEach(([warehouse, stock]) => {
                    total += stock;
                    const cls = stock > 0 ? 'positive' : 'zero';
                    html += `<tr><td>${warehouse}</td><td class="stock ${cls}">${stock}</td></tr>`;
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

    // ---------- PO DATA LOAD ----------
    function fetchPoDataIfNeeded(callback) {
        if (poDataLoaded) {
            callback();
            return;
        }
        if (poDataLoading) {
            const check = () => {
                if (poDataLoaded) callback();
                else setTimeout(check, 200);
            };
            check();
            return;
        }

        poDataLoading = true;
        poDataError = null;

        GM_xmlhttpRequest({
            method: 'GET',
            url: `${METABASE_URL}/api/public/card/${PO_QUESTION_UUID}/query/json`,
            timeout: 15000,
            onload: function(response) {
                try {
                    const raw = JSON.parse(response.responseText);
                    const rows = Array.isArray(raw) ? raw
                               : Array.isArray(raw.data) ? raw.data
                               : Array.isArray(raw.rows) ? raw.rows
                               : null;

                    if (!rows) {
                        console.error('Unexpected Metabase PO JSON shape', raw);
                        poDataError = 'Unexpected JSON format from Metabase PO question.';
                    } else {
                        rows.forEach(row => {
                            // Product ID comes from Rows Productid in this question
                            const productIdRaw = row['Rows Productid'] ?? row['Product ID'];
                            const productId = productIdRaw != null ? String(productIdRaw).trim() : '';
                            if (!productId) return;

                            const statusRaw = row['Statusid'] ?? row['Bp Po - Product → Statusid'];
                            const statusId = statusRaw != null ? String(statusRaw) : null;
                            if (!statusId || !ALLOWED_PO_STATUS_IDS.has(statusId)) return;

                            if (!poRowsByProduct[productId]) {
                                poRowsByProduct[productId] = [];
                            }

                            poRowsByProduct[productId].push({
                                orderId: row['Orderid'] ?? row['Bp Po - Product → Orderid'],
                                warehouseId: row['Warehouseid'] ?? row['Bp Po - Product → Warehouseid'],
                                delivery: row['Delivery Date'] ?? row['Bp Po - Product → Delivery Date'],
                                sku: row['Rows Sku'] ?? row['Bp Po - Product → Rows Sku'],
                                qty: row['Rows Quantity'] ?? row['Bp Po - Product → Rows Quantity'],
                                lastSync: row['Last Sync Time'] ?? row['Bp Po - Product → Last Sync Time'],
                                statusId: statusId
                            });
                        });
                    }
                } catch (err) {
                    console.error('TR PO tab Metabase parse/processing error', err, response.responseText && response.responseText.slice(0,200));
                    poDataError = 'Failed to read PO data from Metabase (parse error).';
                } finally {
                    poDataLoaded = true;
                    poDataLoading = false;
                    callback();
                }
            },
            onerror: function(err) {
                console.error('TR PO tab Metabase request error', err);
                poDataError = 'Error calling Metabase PO endpoint.';
                poDataLoaded = true;
                poDataLoading = false;
                callback();
            },
            ontimeout: function() {
                console.error('TR PO tab Metabase request timeout');
                poDataError = 'Timed out while loading PO data from Metabase.';
                poDataLoaded = true;
                poDataLoading = false;
                callback();
            }
        });
    }

    // ---------- TR PO TAB UI ----------
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

        // Direct click handler for TR PO nav
        poTabLink.addEventListener('click', function(e) {
            e.preventDefault();
            openPoTab();
        });
    }

    function openPoTab() {
        ensurePoTabExists();
        if (!poTabPanel || !poTabLink) return;

        // Hide all tab panels, then show ours
        const allTabs = document.querySelectorAll('.tabbertab');
        allTabs.forEach(t => t.classList.add('tabbertabhide'));
        poTabPanel.classList.remove('tabbertabhide');

        // Update active tab class in nav
        const navList = poTabLink.closest('ul');
        if (navList) {
            navList.querySelectorAll('li').forEach(li => li.classList.remove('tabberactive'));
            const li = poTabLink.closest('li');
            if (li) li.classList.add('tabberactive');
        }

        const productId = getCurrentProductId();
        if (!productId) {
            poTabPanel.innerHTML = '<div id="bp-po-tab-inner"><h3>TR Purchase Orders</h3><div>No Product ID detected on this page.</div></div>';
            return;
        }

        poTabPanel.innerHTML = '<div id="bp-po-tab-inner"><h3>TR Purchase Orders</h3><div class="bp-po-notice">Loading purchase orders from Metabase…</div></div>';

        fetchPoDataIfNeeded(() => {
            renderPoTab(productId);
        });
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
            html += `<div id="bp-po-error">${poDataError}</div>`;
            inner.innerHTML = html;
            poTabPanel.innerHTML = '';
            poTabPanel.appendChild(inner);
            return;
        }

        const rows = poRowsByProduct[productId] || [];

        if (!rows.length) {
            html += '<div id="bp-po-empty">No matching purchase orders found for this SKU in the allowed statuses.</div>';
            inner.innerHTML = html;
            poTabPanel.innerHTML = '';
            poTabPanel.appendChild(inner);
            return;
        }

        const byWh = {};
        rows.forEach(r => {
            const rawId = r.warehouseId != null ? String(r.warehouseId) : '';
            const whName = WAREHOUSE_ID_MAP[rawId] || (rawId ? `Warehouse ${rawId}` : 'Unknown warehouse');
            if (!byWh[whName]) byWh[whName] = [];
            byWh[whName].push(r);
        });

        const fmtDate = (val) => {
            if (!val) return '';
            const d = new Date(val);
            if (isNaN(d.getTime())) return String(val);
            return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        };

        const buildPoUrl = (orderId) => {
            if (!orderId) return null;
            return PO_ORDER_URL_TEMPLATE.replace('{{ORDERID}}', encodeURIComponent(orderId));
        };

        html += '<table id="bp-po-table">';
        html += '<thead><tr><th>Warehouse</th><th>Open Purchase Orders</th></tr></thead><tbody>';

        const whEntries = Object.entries(byWh).sort((a, b) => a[0].localeCompare(b[0]));

        whEntries.forEach(([warehouse, list]) => {
            const sorted = [...list].sort((a, b) => {
                const da = Date.parse(a.delivery) || 0;
                const db = Date.parse(b.delivery) || 0;
                return da - db;
            });

            let lines = '';
            sorted.forEach(o => {
                const qty = o.qty != null ? Number(o.qty) : 0;
                const delivery = fmtDate(o.delivery);
                const orderId = o.orderId ? String(o.orderId) : '';
                const url = buildPoUrl(orderId);
                const idLabel = orderId ? `PO ${orderId}` : 'PO';

                const linkHtml = url
                    ? `<a href="${url}" target="_blank" title="Open ${idLabel}">${idLabel}</a>`
                    : `<span>${idLabel}</span>`;

                lines += `<div class="bp-po-line">${linkHtml} — ${qty} due ${delivery}</div>`;
            });

            html += `<tr><td>${warehouse}</td><td>${lines}</td></tr>`;
        });

        html += '</tbody></table>';

        inner.innerHTML = html;
        poTabPanel.innerHTML = '';
        poTabPanel.appendChild(inner);
    }

    // ---------- events & init ----------
document.body.addEventListener('click', function(e) {
    // Existing behaviour for bundle & stock tabs
    if (e.target.id === 'undefinednav8' || e.target.closest('#undefinednav8')) {
        setTimeout(updateBundleTable, 300);
    }
    if (e.target.id === 'undefinednav2' || e.target.closest('#undefinednav2')) {
        setTimeout(updateStockInventoryTab, 300);
    }

    // When any other tab in the same nav as TR PO is clicked,
    // hide the TR PO panel and remove any PO notices so their
    // text cannot appear on other tabs.
    const a = e.target.closest('a');
    if (a && poTabPanel && poTabLink) {
        const navList = poTabLink.closest('ul');
        if (navList && navList.contains(a) && a.id !== 'trakpo-nav') {
            // Hide our custom tab
            poTabPanel.classList.add('tabbertabhide');
            const li = poTabLink.closest('li');
            if (li) li.classList.remove('tabberactive');

            // Remove any PO notice elements that might have been moved
            document.querySelectorAll('.bp-po-notice').forEach(el => el.remove());
        }
    }

    setTimeout(addSkuToTitle, 500);
});

fetchInventoryData().then(() => {
    setTimeout(() => {
        addSkuToTitle();
        updateBundleTable();
        updateStockInventoryTab();
        ensurePoTabExists();
    }, 1000);
});
})();
