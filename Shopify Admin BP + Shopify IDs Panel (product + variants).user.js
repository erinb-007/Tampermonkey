// ==UserScript==
// @name         Shopify Admin BP + Shopify IDs Panel (product + variants)
// @namespace    https://trakracer.com/
// @version      4.0
// @description  Show BP + Shopify product/variant IDs and stock data from Metabase in Shopify admin (product + variant pages), keyed by store + product/variant ID
// @author       Erin Bond
// @match        https://admin.shopify.com/store/*
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

    const MB_BASE_URL     = 'https://meta.trakracerusa.com';
    const USE_FAST_QUERY  = true;
    const FAST_UUID       = '6d5224d0-e30c-4d1d-88df-fbdcbddce773';
    const FULL_UUID       = '6d5224d0-e30c-4d1d-88df-fbdcbddce773';
    const MB_API_KEY      = '';
    const MB_SESSION_TOKEN = '';

    const PANEL_BG     = '#111827';
    const PANEL_BORDER = '#374151';
    const PANEL_TEXT   = '#e5e7eb';
    const PANEL_ACCENT = '#38bdf8';
    const PANEL_WARN   = '#f97316';
    const PANEL_ERROR  = '#f97373';

    const BP_BASE_URL = 'https://euw1.brightpearlapp.com/patt-op.php?scode=product&pID=';

    const STORE_TO_WAREHOUSE = {
        'AU': 'Trak Racer AU WFDS',
        'EU': 'Trak Racer EU Warehouse',
        'CA': 'Trak Racer CA GO BOLT',
        'SP': 'Trak Racer ES Warehouse',
        'UK': 'Trak Racer UK AMWorld',
        'US': 'Trak Racer ARC Sentry',
    };

    const COL_BP_PRODUCT_ID = 'Product ID';
    const COL_SKU           = 'Sku';
    const COL_WEIGHT        = 'Weight';
    const COL_BUNDLE        = 'Bundle';
    const COL_COMPOSITION   = 'Product Composition';
    const COL_STORE         = 'All shopify Variants (all stores) Union ALL - Sku → store';
    const COL_SHOPIFY_PID   = 'All shopify Variants (all stores) Union ALL - Sku → product_id';
    const COL_SHOPIFY_VID   = 'All shopify Variants (all stores) Union ALL - Sku → variantsid';
    const COL_SHOPIFY_SKU   = 'All shopify Variants (all stores) Union ALL - Sku → sku';
    const COL_STOCK_EU      = 'BP Stock MASTER & Bundles - Product → Trak Racer EU Warehouse - On hand';
    const COL_STOCK_AU      = 'BP Stock MASTER & Bundles - Product → Trak Racer AU WFDS - On hand';
    const COL_STOCK_UK      = 'BP Stock MASTER & Bundles - Product → Trak Racer UK AMWorld - On hand';
    const COL_STOCK_CA      = 'BP Stock MASTER & Bundles - Product → Trak Racer CA GO BOLT - On hand';
    const COL_STOCK_ES      = 'BP Stock MASTER & Bundles - Product → Trak Racer ES Warehouse - On hand';
    const COL_STOCK_ARC     = 'BP Stock MASTER & Bundles - Product → Trak Racer ARC Sentry - On hand';

    /********************************************************************
     * CACHE
     ********************************************************************/

    const rowCache = {};
    let fullDatasetCache = null;
    let fullDatasetFetchedAt = null;
    const CACHE_TTL_MS = 60 * 60 * 1000;

    /********************************************************************
     * UTILITIES
     ********************************************************************/

    function log(...args) { console.log('[BP+Shopify Panel]', ...args); }
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    function buildHeaders() {
        const h = { 'Content-Type': 'application/json' };
        if (MB_API_KEY) h['X-Metabase-Api-Key'] = MB_API_KEY;
        else if (MB_SESSION_TOKEN) h['X-Metabase-Session'] = MB_SESSION_TOKEN;
        return h;
    }

    function gmFetchJson(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET', url,
                headers: buildHeaders(),
                onload: resp => {
                    if (resp.status >= 200 && resp.status < 300) {
                        try { resolve(JSON.parse(resp.responseText)); }
                        catch (e) { reject(new Error('JSON parse error: ' + e.message)); }
                    } else {
                        reject(new Error('Metabase ' + resp.status + ': ' + resp.responseText.substring(0, 200)));
                    }
                },
                onerror: err => reject(new Error('Request error: ' + (err.error || 'unknown')))
            });
        });
    }

    /********************************************************************
     * WAIT FOR DOM TO SETTLE
     * Watches for mutations and resolves once nothing has changed for
     * quietMs milliseconds — meaning Shopify has finished re-rendering
     ********************************************************************/

    function waitForDomSettle(quietMs = 500, timeout = 15000) {
        return new Promise((resolve, reject) => {
            let timer = null;

            const done = () => {
                obs.disconnect();
                resolve();
            };

            const reset = () => {
                if (timer) clearTimeout(timer);
                timer = setTimeout(done, quietMs);
            };

            const obs = new MutationObserver(reset);
            obs.observe(document.body, { childList: true, subtree: true });

            // Start the timer immediately in case DOM is already settled
            reset();

            // Hard timeout fallback
            setTimeout(() => {
                if (timer) clearTimeout(timer);
                obs.disconnect();
                resolve(); // resolve anyway, don't reject
            }, timeout);
        });
    }

    /********************************************************************
     * SHOPIFY HELPERS
     ********************************************************************/

    function getStoreConfigFromUrl() {
        const match = window.location.pathname.match(/\/store\/([^/]+)/i);
        if (!match) return null;
        const slug = match[1].toLowerCase();
        const cfg = { storeCode: null, stockLabel: null };
        if (slug.includes('aus') || slug.includes('au'))        { cfg.storeCode = 'AU'; cfg.stockLabel = 'AU WFDS';    return cfg; }
        if (slug.includes('eu'))                                 { cfg.storeCode = 'EU'; cfg.stockLabel = 'EU WH';      return cfg; }
        if (slug.includes('canada') || slug.includes('ca'))     { cfg.storeCode = 'CA'; cfg.stockLabel = 'CA GO BOLT'; return cfg; }
        if (slug.includes('trakraceres') || slug.includes('es')){ cfg.storeCode = 'SP'; cfg.stockLabel = 'ES WH';      return cfg; }
        if (slug.includes('trakracer-uk') || slug.includes('uk')){ cfg.storeCode = 'UK'; cfg.stockLabel = 'UK AMWorld'; return cfg; }
        if (slug === 'trakracer' || slug.includes('us'))        { cfg.storeCode = 'US'; cfg.stockLabel = 'ARC Sentry'; return cfg; }
        return null;
    }

    function stockFieldForStore(storeCode) {
        return { AU: COL_STOCK_AU, EU: COL_STOCK_EU, CA: COL_STOCK_CA, SP: COL_STOCK_ES, UK: COL_STOCK_UK, US: COL_STOCK_ARC }[storeCode] || null;
    }

    function getProductAndVariantFromUrl() {
        const mv = window.location.pathname.match(/\/products\/(\d+)\/variants\/(\d+)/);
        if (mv) return { productId: mv[1], variantId: mv[2], isVariant: true };
        const mp = window.location.pathname.match(/\/products\/(\d+)(\/)?$/);
        if (mp) return { productId: mp[1], variantId: null, isVariant: false };
        return { productId: null, variantId: null, isVariant: false };
    }

    /********************************************************************
     * BUNDLE PARSER
     ********************************************************************/

    function parseBundleComponents(composition) {
        if (!composition || typeof composition !== 'string') return [];
        const comps = [];
        const tokens = composition.replace(/^{/, '').replace(/}$/, '').split(',');
        for (let i = 0; i < tokens.length - 1; i++) {
            const t = tokens[i].trim(), n = tokens[i + 1].trim();
            if (t.includes('productId') && n.includes('productQuantity')) {
                const pid = (t.match(/productId"?[:]*"?(\d+)/i) || [])[1];
                const qty = (n.match(/productQuantity"?[:]*"?(\d+)/i) || [])[1] || '1';
                if (pid) comps.push({ productId: pid, quantity: qty });
            }
        }
        return comps;
    }

    /********************************************************************
     * METABASE FETCH
     ********************************************************************/

    async function fetchMetabaseRowsFast(storeCode, productId) {
        const cacheKey = `${storeCode}|${productId}`;
        const cached = rowCache[cacheKey];
        if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
            log('Cache hit:', cacheKey);
            return { rows: cached.rows, bpIdToSku: cached.bpIdToSku };
        }

        const warehouse = STORE_TO_WAREHOUSE[storeCode];
        if (!warehouse) throw new Error('No warehouse mapping for: ' + storeCode);

        const params = encodeURIComponent(JSON.stringify([
            { type: 'category', value: storeCode,         target: ['variable', ['template-tag', 'store']] },
            { type: 'category', value: String(productId), target: ['variable', ['template-tag', 'shopify_product_id']] },
            { type: 'category', value: warehouse,         target: ['variable', ['template-tag', 'warehouse']] },
        ]));

        const url = `${MB_BASE_URL}/public/question/${FAST_UUID}.json?parameters=${params}`;
        const json = await gmFetchJson(url);
        if (!Array.isArray(json)) throw new Error('Expected array from Metabase');

        const bpIdToSku = {};
        json.forEach(r => {
            const pid = r['Product ID'], sku = r['Sku'];
            if (pid != null && sku) {
                const n = Number(String(pid).replace(/,/g, ''));
                if (!isNaN(n)) bpIdToSku[n] = sku;
            }
        });

        rowCache[cacheKey] = { rows: json, bpIdToSku, fetchedAt: Date.now() };
        return { rows: json, bpIdToSku };
    }

    async function fetchMetabaseRowsSlow(storeCode, productId) {
        const cacheKey = `${storeCode}|${productId}`;
        const cached = rowCache[cacheKey];
        if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) return { rows: cached.rows, bpIdToSku: cached.bpIdToSku };

        let json;
        if (fullDatasetCache && (Date.now() - fullDatasetFetchedAt) < CACHE_TTL_MS) {
            json = fullDatasetCache;
        } else {
            json = await gmFetchJson(`${MB_BASE_URL}/public/question/${FULL_UUID}.json`);
            if (!Array.isArray(json)) throw new Error('Expected array from Metabase');
            fullDatasetCache = json;
            fullDatasetFetchedAt = Date.now();
        }

        const bpIdToSku = {};
        json.forEach(r => {
            const pid = r[COL_BP_PRODUCT_ID], sku = r[COL_SKU];
            if (pid != null && sku) {
                const n = Number(String(pid).replace(/,/g, ''));
                if (!isNaN(n)) bpIdToSku[n] = sku;
            }
        });

        const rows = json.filter(r =>
            (r[COL_STORE] || '').toString().trim().toUpperCase() === storeCode.toUpperCase() &&
            Number(r[COL_SHOPIFY_PID]) === Number(productId)
        );

        rowCache[cacheKey] = { rows, bpIdToSku, fetchedAt: Date.now() };
        return { rows, bpIdToSku };
    }

    async function fetchMetabaseRows(storeCode, productId) {
        return USE_FAST_QUERY
            ? fetchMetabaseRowsFast(storeCode, productId)
            : fetchMetabaseRowsSlow(storeCode, productId);
    }

    /********************************************************************
     * DOM FINDERS
     ********************************************************************/

    function findSidebarCard() {
        for (const text of ['Publishing', 'Status']) {
            const h = Array.from(document.querySelectorAll('h2, h3')).find(el => el.textContent.trim() === text);
            if (h) {
                const card = h.closest('div[class*="Card"], section');
                if (card?.parentElement) return card;
            }
        }
        return document.querySelector('[class*="Sidebar"]');
    }

    function findVariantRightColumn() {
        const main = document.querySelector('main') || document.body;

        const priceH = Array.from(main.querySelectorAll('h2,h3,h4')).find(el => el.textContent.trim() === 'Price');
        if (priceH) {
            let el = priceH;
            for (let i = 0; i < 8; i++) {
                el = el.parentElement;
                if (!el || el.tagName === 'MAIN') break;
                const r = el.getBoundingClientRect();
                if (r.width > 400 && r.height > 300) return el;
            }
        }

        const rightDivs = Array.from(main.querySelectorAll('div')).filter(d => {
            const r = d.getBoundingClientRect();
            return r.left > 600 && r.width > 400 && r.height > 400 && r.top < 400;
        });
        if (rightDivs.length > 0) {
            rightDivs.sort((a, b) => {
                const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
                return (ra.width * ra.height) - (rb.width * rb.height);
            });
            return rightDivs[0];
        }
        return null;
    }

    /********************************************************************
     * PANEL
     ********************************************************************/

    function injectPanel(isVariantPage) {
        document.getElementById('bp-shopify-panel')?.remove();

        const panel = document.createElement('div');
        panel.id = 'bp-shopify-panel';
        panel.style.cssText = `
            margin: 16px;
            background: ${PANEL_BG};
            border: 1px solid ${PANEL_BORDER};
            border-radius: 6px;
            color: ${PANEL_TEXT};
            padding: 10px 12px;
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            font-size: 13px;
            display: flex;
            flex-direction: column;
            gap: 4px;
            position: relative;
            z-index: 10;
        `;
        panel.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="font-weight:600;color:${PANEL_ACCENT};">Metabase Data (upto 1 hour old)</span>
                <span id="bp-shopify-panel-status" style="font-size:11px;color:${PANEL_TEXT};opacity:0.8;">Loading…</span>
            </div>
            <div id="bp-shopify-panel-body" style="display:flex;flex-direction:column;gap:2px;"></div>
        `;

        if (isVariantPage) {
            const col = findVariantRightColumn();
            const target = col || document.querySelector('main');
            if (!target) return null;
            target.insertBefore(panel, target.firstChild);
        } else {
            const card = findSidebarCard();
            if (!card) return null;
            card.parentElement.insertBefore(panel, card);
        }

        return panel;
    }

    function setPanelStatus(text, color) {
        const el = document.getElementById('bp-shopify-panel-status');
        if (!el) return;
        el.textContent = text;
        if (color) el.style.color = color;
    }

    /********************************************************************
     * RENDER
     ********************************************************************/

    function renderNoMatch(storeCode, id) {
        const body = document.getElementById('bp-shopify-panel-body');
        if (body) body.innerHTML = `<div>No Metabase row for ${storeCode || '?'} / product ${id || '?'}</div>`;
    }

    function renderSingleRow(row, cfg, bpIdToSku) {
        const body = document.getElementById('bp-shopify-panel-body');
        if (!body) return;
        body.innerHTML = '';

        const store            = row['store']               || row[COL_STORE]        || cfg.storeCode || '—';
        const sku              = row['shopify_sku']         || row[COL_SHOPIFY_SKU]  || row[COL_SKU]  || '—';
        const bpId             = row['Product ID']          ?? row[COL_BP_PRODUCT_ID] ?? null;
        const weight           = row['Weight']              ?? row[COL_WEIGHT]        ?? null;
        const isBundle         = !!(row['Bundle']           ?? row[COL_BUNDLE]        ?? 0);
        const shopifyProductId = row['shopify_product_id']  || row[COL_SHOPIFY_PID]  || '—';
        const shopifyVariantId = row['variantsid']          || row[COL_SHOPIFY_VID]  || '—';
        const composition      = row['Product Composition'] || row[COL_COMPOSITION]  || '';

        let bpStock = null;
        if (USE_FAST_QUERY) {
            bpStock = row['stock_onhand'] ?? null;
        } else {
            const sf = stockFieldForStore(cfg.storeCode);
            bpStock = sf ? (row[sf] ?? null) : null;
        }

        const bundleComponents = parseBundleComponents(composition);
        const add = html => { const d = document.createElement('div'); d.innerHTML = html; body.appendChild(d); };

        add(`<span style="font-weight:600;">SKU = <span style="font-family:monospace;">${sku}</span></span>`);
        add(`<span style="font-weight:600;">BP Stock =</span> ${bpStock != null && bpStock !== '' ? `${bpStock} (${cfg.stockLabel})` : '—'}`);

        const bpIdLine = document.createElement('div');
        if (bpId) {
            const a = document.createElement('a');
            a.href = BP_BASE_URL + encodeURIComponent(bpId) + '&action=new_product';
            a.target = '_blank';
            a.style.cssText = `color:${PANEL_ACCENT};text-decoration:underline;`;
            a.textContent = bpId.toString();
            bpIdLine.innerHTML = `<span style="font-weight:600;">BP ID =</span> `;
            bpIdLine.appendChild(a);
        } else {
            bpIdLine.innerHTML = `<span style="font-weight:600;">BP ID =</span> —`;
        }
        body.appendChild(bpIdLine);

        add(`<span style="font-weight:600;">BP Weight =</span> ${weight != null && weight !== '' ? weight : '—'}`);
        add(`<span style="font-weight:600;">Is Bundle =</span> ${isBundle ? 'Yes' : 'No'}`);

        let partsText = '—';
        if (bundleComponents.length) {
            partsText = bundleComponents.map(c => {
                const s = bpIdToSku?.[Number(c.productId)];
                return `${s || 'ProductID' + c.productId}×${c.quantity}`;
            }).join(', ');
        }
        add(`<span style="font-weight:600;">Bundle Parts =</span> ${partsText}`);

        const shopifyLine = document.createElement('div');
        shopifyLine.style.cssText = 'font-size:11px;opacity:0.8;';
        shopifyLine.innerHTML = `<span style="font-weight:600;">Shopify:</span> ${store} product ${shopifyProductId}, variant ${shopifyVariantId}`;
        body.appendChild(shopifyLine);
    }

    function renderProductRows(rows, cfg, bpIdToSku) {
        const body = document.getElementById('bp-shopify-panel-body');
        if (!body) return;
        body.innerHTML = '';
        if (rows.length === 0) { body.innerHTML = '<div>No data</div>'; return; }
        if (rows.length === 1) { renderSingleRow(rows[0], cfg, bpIdToSku); return; }

        const title = document.createElement('div');
        title.style.cssText = 'font-weight:600;margin-bottom:6px;';
        title.textContent = 'Variant SKU';
        body.appendChild(title);

        rows.forEach((row, idx) => {
            const sku  = row['shopify_sku'] || row[COL_SHOPIFY_SKU] || row[COL_SKU] || '—';
            const bpId = row['Product ID']  ?? row[COL_BP_PRODUCT_ID] ?? null;

            const skuLine = document.createElement('div');
            skuLine.style.cssText = `font-weight:600;margin-top:${idx > 0 ? '4px' : '0'};`;
            skuLine.innerHTML = `sku = <span style="font-family:monospace;">${sku}</span>`;
            body.appendChild(skuLine);

            const bpIdLine = document.createElement('div');
            if (bpId) {
                const a = document.createElement('a');
                a.href = BP_BASE_URL + encodeURIComponent(bpId) + '&action=new_product';
                a.target = '_blank';
                a.style.cssText = `color:${PANEL_ACCENT};text-decoration:underline;`;
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

            if (!cfg?.storeCode) { log('No store config'); return; }
            if (!productId) { log('No product ID'); return; }

            log(`Running: ${cfg.storeCode} product=${productId} variant=${variantId}`);

            const startUrl = location.href;

            // Kick off the Metabase fetch immediately in the background
            // so data is ready by the time we finish waiting for the DOM
            const dataPromise = fetchMetabaseRows(cfg.storeCode, productId);

            // Wait for the DOM to fully settle (stop mutating for 600ms)
            // This handles Shopify's multiple re-render passes on SPA navigation
            // Wait for anchor to appear first, then just a short settle
            log('Waiting for anchor…');
            await waitForElement(isVariant ? findVariantRightColumn : findSidebarCard);
            log('Anchor found, settling…');
            await waitForDomSettle(300, 3000);
            log('DOM settled');

            if (location.href !== startUrl) { log('URL changed, bailing'); return; }

            // Make sure our anchor element exists after settle
            const anchorFn = isVariant ? findVariantRightColumn : findSidebarCard;
            if (!anchorFn()) {
                log('Anchor not found after DOM settle');
                return;
            }

            const panel = injectPanel(isVariant);
            if (!panel) { log('Inject failed'); return; }

            setPanelStatus('Loading…');

            // Wait for data (may already be done since we started it early)
            const { rows, bpIdToSku } = await dataPromise;

            if (location.href !== startUrl) { log('URL changed during fetch, bailing'); return; }

            // Re-inject if Shopify removed the panel while we awaited data
            if (!document.getElementById('bp-shopify-panel')) {
                log('Panel removed during fetch, re-injecting');
                const repanel = injectPanel(isVariant);
                if (!repanel) return;
            }

            if (!rows || rows.length === 0) {
                setPanelStatus('No Metabase match', PANEL_WARN);
                renderNoMatch(cfg.storeCode, productId);
                return;
            }

            if (isVariant && variantId) {
                const vidCol = USE_FAST_QUERY ? 'variantsid' : COL_SHOPIFY_VID;
                const targetRow = rows.find(r => String(r[vidCol]) === String(variantId));
                if (!targetRow) {
                    setPanelStatus('No row for variant', PANEL_WARN);
                    renderNoMatch(cfg.storeCode, `${productId}/${variantId}`);
                } else {
                    renderSingleRow(targetRow, cfg, bpIdToSku);
                    setPanelStatus('Loaded');
                }
            } else {
                renderProductRows(rows, cfg, bpIdToSku);
                setPanelStatus('Loaded');
            }

        } catch (e) {
            log('Error:', e);
            setPanelStatus('Error: ' + e.message, PANEL_ERROR);
        }
    }

    /********************************************************************
     * ROUTER
     ********************************************************************/

    function isProductOrVariantPath(path) {
        return /\/store\/[^/]+\/products\/\d+/.test(path);
    }

    let activeRun = false;

    function runForCurrentPath() {
        if (!isProductOrVariantPath(location.pathname)) return;
        if (activeRun) return;
        activeRun = true;
        main().finally(() => { activeRun = false; });
    }

    runForCurrentPath();

    let lastUrl = location.href;
    setInterval(() => {
        const cur = location.href;
        if (cur !== lastUrl) { lastUrl = cur; runForCurrentPath(); }
    }, 500);

})();
