// ==UserScript==
// @name         Shopify Admin BP + Shopify IDs Panel (product + variants)
// @namespace    https://trakracer.com/
// @version      3.3
// @description  Show BP + Shopify product/variant IDs and stock data from Metabase in Shopify admin (product + variant pages), keyed by store + product/variant ID
// @author       Erin Bond
// @match        https://admin.shopify.com/store/*/products*
// @updateURL    https://github.com/erinb-007/Tampermonkey/raw/refs/heads/main/Shopify%20Admin%20BP%20+%20Shopify%20IDs%20Panel%20(product%20+%20variants).user.js
// @downloadURL  https://github.com/erinb-007/Tampermonkey/raw/refs/heads/main/Shopify%20Admin%20BP%20+%20Shopify%20IDs%20Panel%20(product%20+%20variants).user.js
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      meta.trakracerusa.com
// ==/UserScript==

(function() {
    'use strict';

    /********************************************************************
     * CONFIG
     ********************************************************************/

    const MB_BASE_URL = 'https://meta.trakracerusa.com';

    const PUBLIC_UUID = '6d5224d0-e30c-4d1d-88df-fbdcbddce773'; // replace with real UUID

    const MB_API_KEY = '';

    const MB_SESSION_TOKEN = '';

    const PANEL_BG       = '#111827';
    const PANEL_BORDER   = '#374151';
    const PANEL_TEXT     = '#e5e7eb';
    const PANEL_ACCENT   = '#38bdf8';
    const PANEL_WARN     = '#f97316';
    const PANEL_ERROR    = '#f97373';

    const BP_BASE_URL = 'https://euw1.brightpearlapp.com/patt-op.php?scode=product&pID=';

    // Metabase column names
    const COL_BP_PRODUCT_ID   = 'Product ID';
    const COL_SKU             = 'Sku';
    const COL_WEIGHT          = 'Weight';
    const COL_BUNDLE          = 'Bundle';
    const COL_STATUS          = 'Status';
    const COL_COMPOSITION     = 'Product Composition';

    const COL_STORE           = 'All shopify Variants (all stores) Union ALL - Sku → store';
    const COL_SHOPIFY_PID     = 'All shopify Variants (all stores) Union ALL - Sku → shopify_product_id';
    const COL_SHOPIFY_VID     = 'All shopify Variants (all stores) Union ALL - Sku → shopify_variant_id';
    const COL_SHOPIFY_SKU     = 'All shopify Variants (all stores) Union ALL - Sku → sku';

    const COL_STOCK_EU        = 'BP Stock MASTER & Bundles - Product → Trak Racer EU Warehouse - On hand';
    const COL_STOCK_AU        = 'BP Stock MASTER & Bundles - Product → Trak Racer AU WFDS - On hand';
    const COL_STOCK_UK        = 'BP Stock MASTER & Bundles - Product → Trak Racer UK AMWorld - On hand';
    const COL_STOCK_CA        = 'BP Stock MASTER & Bundles - Product → Trak Racer CA GO BOLT - On hand';
    const COL_STOCK_ES        = 'BP Stock MASTER & Bundles - Product → Trak Racer ES Warehouse - On hand';
    const COL_STOCK_ARC       = 'BP Stock MASTER & Bundles - Product → Trak Racer ARC Sentry - On hand';

    /********************************************************************
     * UTILITIES
     ********************************************************************/

    function log(...args) {
        console.log('[BP+Shopify Panel]', ...args);
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function buildHeaders() {
        const headers = {
            'Content-Type': 'application/json'
        };
        if (MB_API_KEY && MB_API_KEY !== '') {
            headers['X-Metabase-Api-Key'] = MB_API_KEY;
        } else if (MB_SESSION_TOKEN && MB_SESSION_TOKEN !== '') {
            headers['X-Metabase-Session'] = MB_SESSION_TOKEN;
        }
        return headers;
    }

    function gmFetchJson(url, method = 'POST', body = null) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method,
                url,
                headers: buildHeaders(),
                data: body ? JSON.stringify(body) : null,
                onload: function(resp) {
                    if (resp.status >= 200 && resp.status < 300) {
                        try {
                            const data = JSON.parse(resp.responseText);
                            resolve(data);
                        } catch (e) {
                            reject(new Error('Failed to parse JSON from Metabase: ' + e.message));
                        }
                    } else {
                        reject(new Error('Metabase error ' + resp.status + ': ' + resp.responseText));
                    }
                },
                onerror: function(err) {
                    reject(new Error('GM_xmlhttpRequest error: ' + (err.error || 'unknown')));
                }
            });
        });
    }

    /********************************************************************
     * SHOPIFY HELPERS
     ********************************************************************/

    function getStoreConfigFromUrl() {
        const match = window.location.pathname.match(/\/store\/([^/]+)/i);
        if (!match) return null;
        const slug = match[1].toLowerCase();

        const cfg = { storeCode: null, stockField: null, stockLabel: null };

        if (slug.includes('aus') || slug.includes('au')) {
            cfg.storeCode = 'AU';
            cfg.stockField = COL_STOCK_AU;
            cfg.stockLabel = 'AU WFDS';
            return cfg;
        }

        if (slug.includes('eu')) {
            cfg.storeCode = 'EU';
            cfg.stockField = COL_STOCK_EU;
            cfg.stockLabel = 'EU WH';
            return cfg;
        }

        if (slug.includes('canada') || slug.includes('ca')) {
            cfg.storeCode = 'CA';
            cfg.stockField = COL_STOCK_CA;
            cfg.stockLabel = 'CA GO BOLT';
            return cfg;
        }

        if (slug.includes('trakraceres') || slug.includes('es')) {
            cfg.storeCode = 'SP';
            cfg.stockField = COL_STOCK_ES;
            cfg.stockLabel = 'ES WH';
            return cfg;
        }

        if (slug.includes('trakracer-uk') || slug.includes('uk')) {
            cfg.storeCode = 'UK';
            cfg.stockField = COL_STOCK_UK;
            cfg.stockLabel = 'UK AMWorld';
            return cfg;
        }

        if (slug === 'trakracer' || slug.includes('us')) {
            cfg.storeCode = 'US';
            cfg.stockField = COL_STOCK_ARC;
            cfg.stockLabel = 'ARC Sentry';
            return cfg;
        }

        return null;
    }

    function getProductAndVariantFromUrl() {
        const mVariant = window.location.pathname.match(/\/products\/(\d+)\/variants\/(\d+)/);
        if (mVariant) {
            return { productId: mVariant[1], variantId: mVariant[2], isVariant: true };
        }
        const mProd = window.location.pathname.match(/\/products\/(\d+)(\/)?$/);
        if (mProd) {
            return { productId: mProd[1], variantId: null, isVariant: false };
        }
        return { productId: null, variantId: null, isVariant: false };
    }

    /********************************************************************
     * BUNDLE PARSER
     ********************************************************************/

    function parseBundleComponents(composition) {
        if (!composition || typeof composition !== 'string') return [];

        const comps = [];
        let safe = composition;
        safe = safe.replace(/^{/, '').replace(/}$/, '');
        const tokens = safe.split(',');

        for (let i = 0; i < tokens.length - 1; i++) {
            const t = tokens[i].trim();
            const n = tokens[i + 1].trim();

            if (t.includes('productId') && n.includes('productQuantity')) {
                const idMatch = t.match(/productId"?[:]*"?(\d+)/i);
                const qtyMatch = n.match(/productQuantity"?[:]*"?(\d+)/i);
                const pid = idMatch ? idMatch[1] : null;
                const qty = qtyMatch ? qtyMatch[1] : '1';
                if (pid) {
                    comps.push({ productId: pid, quantity: qty });
                }
            }
        }

        return comps;
    }

    /********************************************************************
     * METABASE LOOKUP (returns all rows for store+product) + BP ID→SKU map
     ********************************************************************/

    async function fetchMetabaseRows(storeCode, productId) {
    const url = MB_BASE_URL + '/public/question/' + PUBLIC_UUID + '.json';
    const mbBody = null;

    const json = await gmFetchJson(url, 'GET', mbBody);
    if (!Array.isArray(json)) {
        throw new Error('Unexpected Metabase response shape (expected array)');
    }

        // Build BP ProductID -> SKU lookup from all rows
        const bpIdToSku = {};
        json.forEach(r => {
            const pid = r[COL_BP_PRODUCT_ID];
            const sku = r[COL_SKU];
            if (pid != null && sku) {
                const numPid = Number(String(pid).replace(/,/g, ''));
                if (!isNaN(numPid)) {
                    bpIdToSku[numPid] = sku;
                }
            }
        });

        const targetStore = (storeCode || '').trim().toUpperCase();
        const targetPidNum = Number(productId);

        const rows = json.filter(r => {
            const rowStore = (r[COL_STORE] || '').toString().trim().toUpperCase();
            const rowPidNum = Number(r[COL_SHOPIFY_PID]);
            return rowStore === targetStore && rowPidNum === targetPidNum;
        });

        return { rows, bpIdToSku };
    }

    /********************************************************************
     * UI RENDERING
     ********************************************************************/

    function findSidebarCard() {
        const headings = Array.from(document.querySelectorAll('h2, h3'));
        let publishing = headings.find(h => h.textContent.trim() === 'Publishing');
        if (publishing) {
            const card = publishing.closest('div[class*="Card"], section');
            if (card && card.parentElement) return card;
        }

        let status = headings.find(h => h.textContent.trim() === 'Status');
        if (status) {
            const card = status.closest('div[class*="Card"], section');
            if (card && card.parentElement) return card;
        }

        const sidebar = document.querySelector('[class*="Sidebar"]');
        return sidebar;
    }

    function findVariantLeftColumn() {
        const main = document.querySelector('main') || document.body;
        const headings = Array.from(main.querySelectorAll('h2, h3'));
        const optionsHeader = headings.find(h => h.textContent.trim() === 'Options');
        if (optionsHeader) {
            const card = optionsHeader.closest('div[class*="Card"], section, div');
            if (card && card.parentElement) return card.parentElement;
        }
        return null;
    }

    function createPanelSkeleton(isVariantPage) {
        const targetContainer = isVariantPage ? findVariantLeftColumn() : findSidebarCard();
        if (!targetContainer) {
            log('Could not find target container for panel (isVariantPage:', isVariantPage, ')');
            return null;
        }

        const existing = document.getElementById('bp-shopify-panel');
        if (existing) existing.remove();

        const panel = document.createElement('div');
        panel.id = 'bp-shopify-panel';
        panel.style.margin = '16px';
        panel.style.background = PANEL_BG;
        panel.style.border = '1px solid ' + PANEL_BORDER;
        panel.style.borderRadius = '6px';
        panel.style.color = PANEL_TEXT;
        panel.style.padding = '10px 12px';
        panel.style.fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        panel.style.fontSize = '13px';
        panel.style.display = 'flex';
        panel.style.flexDirection = 'column';
        panel.style.gap = '4px';

        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        header.innerHTML = `<span style="font-weight:600;color:${PANEL_ACCENT};">Metabase Data (upto 1 hour old)</span>
                            <span id="bp-shopify-panel-status" style="font-size:11px;color:${PANEL_TEXT};opacity:0.8;">Loading…</span>`;

        const body = document.createElement('div');
        body.id = 'bp-shopify-panel-body';
        body.style.display = 'flex';
        body.style.flexDirection = 'column';
        body.style.gap = '2px';

        panel.appendChild(header);
        panel.appendChild(body);

        if (isVariantPage) {
            targetContainer.insertBefore(panel, targetContainer.firstChild);
        } else {
            targetContainer.parentElement.insertBefore(panel, targetContainer);
        }

        return { panel, body };
    }

    function setPanelStatus(text, color) {
        const el = document.getElementById('bp-shopify-panel-status');
        if (!el) return;
        el.textContent = text;
        if (color) el.style.color = color;
    }

    function renderNoMatch(storeCode, productId) {
        const body = document.getElementById('bp-shopify-panel-body');
        if (!body) return;
        body.innerHTML = '';
        const line = document.createElement('div');
        line.textContent = `No Metabase row for ${storeCode || '?'} / product ${productId || '?'}`;
        body.appendChild(line);
    }

    // Detailed single-SKU view (used for single products and variant pages)
    function renderSingleRow(row, cfg, bpIdToSku) {
        const body = document.getElementById('bp-shopify-panel-body');
        if (!body) return;
        body.innerHTML = '';

        const store = row[COL_STORE] || cfg.storeCode || '—';
        const sku   = row[COL_SHOPIFY_SKU] || row[COL_SKU] || '—';
        const bpId  = row[COL_BP_PRODUCT_ID] ?? null;
        const weight = row[COL_WEIGHT] ?? null;
        const bundleFlag = row[COL_BUNDLE] ?? 0;
        const isBundle = !!bundleFlag;

        const shopifyProductId = row[COL_SHOPIFY_PID] || '—';
        const shopifyVariantId = row[COL_SHOPIFY_VID] || '—';

        const stockField = cfg.stockField;
        const stockLabel = cfg.stockLabel || cfg.storeCode;
        const bpStock = stockField ? (row[stockField] ?? null) : null;

        const composition = row[COL_COMPOSITION] || '';
        const bundleComponents = parseBundleComponents(composition);

        const skuLine = document.createElement('div');
        skuLine.style.fontWeight = '600';
        skuLine.innerHTML = `SKU = <span style="font-family:monospace;">${sku}</span>`;
        body.appendChild(skuLine);

        const stockLine = document.createElement('div');
        const stockVal = (bpStock != null && bpStock !== '') ? `${bpStock} (${stockLabel})` : '—';
        stockLine.innerHTML = `<span style="font-weight:600;">BP Stock =</span> ${stockVal}`;
        body.appendChild(stockLine);

        const bpIdLine = document.createElement('div');
        if (bpId) {
            const a = document.createElement('a');
            a.href = BP_BASE_URL + encodeURIComponent(bpId) + '&action=new_product';
            a.target = '_blank';
            a.style.color = PANEL_ACCENT;
            a.style.textDecoration = 'underline';
            a.textContent = bpId.toString();

            bpIdLine.innerHTML = `<span style="font-weight:600;">BP ID =</span> `;
            bpIdLine.appendChild(a);
        } else {
            bpIdLine.innerHTML = `<span style="font-weight:600;">BP ID =</span> —`;
        }
        body.appendChild(bpIdLine);

        const weightLine = document.createElement('div');
        const weightText = (weight != null && weight !== '') ? weight : '—';
        weightLine.innerHTML = `<span style="font-weight:600;">BP Weight =</span> ${weightText}`;
        body.appendChild(weightLine);

        const bundleLine = document.createElement('div');
        bundleLine.innerHTML = `<span style="font-weight:600;">Is Bundle =</span> ${isBundle ? 'Yes' : 'No'}`;
        body.appendChild(bundleLine);

        const partsLine = document.createElement('div');
        let partsText = '—';
        if (bundleComponents.length) {
            partsText = bundleComponents
                .map(c => {
                    const pidNum = Number(c.productId);
                    const sku = bpIdToSku && bpIdToSku[pidNum];
                    return `${sku || 'ProductID' + c.productId}×${c.quantity}`;
                })
                .join(', ');
        }
        partsLine.innerHTML = `<span style="font-weight:600;">Bundle Parts =</span> ${partsText}`;
        body.appendChild(partsLine);

        const shopifyLine = document.createElement('div');
        shopifyLine.style.fontSize = '11px';
        shopifyLine.style.opacity = '0.8';
        shopifyLine.innerHTML = `<span style="font-weight:600;">Shopify:</span> ${store} product ${shopifyProductId}, variant ${shopifyVariantId}`;
        body.appendChild(shopifyLine);
    }

    // Product parent page: multi-variant summary or single detailed
    function renderProductRows(rows, cfg, bpIdToSku) {
        const body = document.getElementById('bp-shopify-panel-body');
        if (!body) return;
        body.innerHTML = '';

        if (rows.length === 0) {
            body.innerHTML = '<div>No data</div>';
            return;
        }

        if (rows.length === 1) {
            renderSingleRow(rows[0], cfg, bpIdToSku);
            return;
        }

        const title = document.createElement('div');
        title.style.fontWeight = '600';
        title.style.marginBottom = '6px';
        title.textContent = 'Variant SKU';
        body.appendChild(title);

        rows.forEach((row, idx) => {
            const sku = row[COL_SHOPIFY_SKU] || row[COL_SKU] || '—';
            const bpId = row[COL_BP_PRODUCT_ID] ?? null;

            const skuLine = document.createElement('div');
            skuLine.style.fontWeight = '600';
            skuLine.style.marginTop = idx > 0 ? '4px' : '0';
            skuLine.innerHTML = `sku = <span style="font-family:monospace;">${sku}</span>`;
            body.appendChild(skuLine);

            const bpIdLine = document.createElement('div');
            if (bpId) {
                const a = document.createElement('a');
                a.href = BP_BASE_URL + encodeURIComponent(bpId) + '&action=new_product';
                a.target = '_blank';
                a.style.color = PANEL_ACCENT;
                a.style.textDecoration = 'underline';
                a.textContent = bpId.toString();

                bpIdLine.innerHTML = `<span style="font-weight:600;">BP ID =</span> `;
                bpIdLine.appendChild(a);
            } else {
                bpIdLine.innerHTML = `<span style="font-weight:600;">BP ID =</span> —`;
            }
            body.appendChild(bpIdLine);
        });
    }

    /********************************************************************
     * MAIN
     ********************************************************************/

    async function main() {
        try {
            const cfg = getStoreConfigFromUrl();
            const { productId, variantId, isVariant } = getProductAndVariantFromUrl();

            if (!cfg || !cfg.storeCode) {
                log('Could not derive store config from URL');
                return;
            }
            if (!productId) {
                log('Could not parse product ID from URL');
                return;
            }

            await sleep(3000);

            const skeleton = createPanelSkeleton(isVariant);
            if (!skeleton) return;

            const idLabel = isVariant ? `${productId}/${variantId}` : productId;
            setPanelStatus(`Loading ${cfg.storeCode}/${idLabel} from Metabase…`);

            const { rows, bpIdToSku } = await fetchMetabaseRows(cfg.storeCode, productId);
            if (!rows || rows.length === 0) {
                setPanelStatus('No Metabase match', PANEL_WARN);
                renderNoMatch(cfg.storeCode, productId);
                return;
            }

            if (isVariant && variantId) {
                const targetRow = rows.find(r => String(r[COL_SHOPIFY_VID]) === String(variantId));
                if (!targetRow) {
                    setPanelStatus('No Metabase row for variant', PANEL_WARN);
                    renderNoMatch(cfg.storeCode, `${productId}/${variantId}`);
                    return;
                }
                renderSingleRow(targetRow, cfg, bpIdToSku);
            } else {
                renderProductRows(rows, cfg, bpIdToSku);
            }

            setPanelStatus('Loaded from Metabase');
        } catch (e) {
            log('Error in main()', e);
            setPanelStatus('Error: ' + e.message, PANEL_ERROR);
        }
    }

    /********************************************************************
     * SIMPLE ROUTER
     ********************************************************************/

    function isProductOrVariantPath(path) {
        return /\/store\/[^/]+\/products\/\d+/.test(path);
    }

    function runForCurrentPath() {
        if (isProductOrVariantPath(location.pathname)) {
            main();
            setTimeout(() => {
                if (isProductOrVariantPath(location.pathname)) {
                    main();
                }
            }, 2000);
        }
    }

    runForCurrentPath();

    let lastUrl = location.href;
    setInterval(() => {
        const currentUrl = location.href;
        if (currentUrl !== lastUrl) {
            lastUrl = currentUrl;
            runForCurrentPath();
        }
    }, 800);

})();

