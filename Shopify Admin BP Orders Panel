// ==UserScript==
// @name         Shopify Admin BP Orders Panel
// @namespace    https://trakracer.com/
// @version      1.4
// @description  Show BP order data from Metabase in Shopify admin order pages
// @author       Erin Bond
// @match        https://admin.shopify.com/store/*
// @updateURL    https://github.com/erinb-007/Tampermonkey/raw/refs/heads/main/Shopify%20Admin%20BP%20Orders%20Panel.user.js
// @downloadURL  https://github.com/erinb-007/Tampermonkey/raw/refs/heads/main/Shopify%20Admin%20BP%20Orders%20Panel.user.js
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      meta.trakracerusa.com
// ==/UserScript==

(function() {
    'use strict';

    /********************************************************************
     * CONFIG
     ********************************************************************/

    const MB_BASE_URL      = 'https://meta.trakracerusa.com';
    const ORDERS_UUID      = 'da8bee88-620e-4169-9835-8f671e97bbf8';
    const MB_API_KEY       = '';
    const MB_SESSION_TOKEN = '';

    const PANEL_BG     = '#111827';
    const PANEL_BORDER = '#374151';
    const PANEL_TEXT   = '#e5e7eb';
    const PANEL_ACCENT = '#38bdf8';
    const PANEL_WARN   = '#f97316';
    const PANEL_ERROR  = '#f97373';
    const PANEL_OK     = '#4ade80';

    const BP_ORDER_URL = 'https://euw1.brightpearlapp.com/patt-op.php?scode=invoice&oID=';

    const BP_STATUS_MAP = {
        1:  { label: 'Draft / Quote',         color: PANEL_TEXT },
        2:  { label: 'New Web Order',         color: PANEL_ACCENT },
        3:  { label: 'New Phone Order',       color: PANEL_ACCENT },
        4:  { label: 'Invoiced',              color: PANEL_OK },
        5:  { label: 'Cancelled',             color: PANEL_ERROR },
        17: { label: 'Back Order',            color: PANEL_WARN },
        18: { label: 'Quote Sent',            color: PANEL_TEXT },
        20: { label: 'On Hold',               color: PANEL_WARN },
        24: { label: 'Fraudulent Order',      color: PANEL_ERROR },
        25: { label: 'Pending Fulfilment',    color: PANEL_WARN },
        26: { label: 'Sent for Fulfilment',   color: PANEL_ACCENT },
        27: { label: 'Fulfilled',             color: PANEL_OK },
        28: { label: 'Partially Fulfilled',   color: PANEL_WARN },
        32: { label: 'New Order',             color: PANEL_ACCENT },
        33: { label: 'Drop Ship Requested',   color: PANEL_ACCENT },
        37: { label: 'TRX',                   color: PANEL_TEXT },
        39: { label: 'Returned',              color: PANEL_ERROR },
        40: { label: 'Claimed to Supplier',   color: PANEL_WARN },
        41: { label: 'Turnkey',               color: PANEL_TEXT },
        42: { label: 'Chargeback',            color: PANEL_ERROR },
    };

    const BP_SHIPPING_STATUS_MAP = {
        'ASS': { label: 'All Shipped',      color: PANEL_OK },
        'NST': { label: 'Not Shipped',      color: PANEL_ERROR },
        'SNS': { label: 'Some Not Shipped', color: PANEL_WARN },
        'SPS': { label: 'Part Shipped',     color: PANEL_WARN },
    };

    const BP_STOCK_STATUS_MAP = {
        'AAA': { label: 'All Allocated',         color: PANEL_OK },
        'APA': { label: 'Part Allocated',         color: PANEL_WARN },
        'ANA': { label: 'None Allocated',         color: PANEL_ERROR },
        'ANR': { label: 'Allocation Not Required', color: PANEL_TEXT },
    };

    /********************************************************************
     * CACHE
     ********************************************************************/

    const orderCache = {};
    const CACHE_TTL_MS = 0;

    /********************************************************************
     * UTILITIES
     ********************************************************************/

    function log(...args) { console.log('[BP Orders Panel]', ...args); }

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
     * SHOPIFY HELPERS
     ********************************************************************/

    function getStoreCodeFromUrl() {
        const match = window.location.pathname.match(/\/store\/([^/]+)/i);
        if (!match) return null;
        const slug = match[1].toLowerCase();
        if (slug.includes('aus') || slug.includes('au'))          return 'AU';
        if (slug.includes('eu'))                                   return 'EU';
        if (slug.includes('canada') || slug.includes('ca'))       return 'CA';
        if (slug.includes('trakraceres') || slug.includes('es'))  return 'SP';
        if (slug.includes('trakracer-uk') || slug.includes('uk')) return 'UK';
        if (slug === 'trakracer' || slug.includes('us'))          return 'US';
        return null;
    }

    function isOrderPath(path) {
        return /\/store\/[^/]+\/orders\/\d+/.test(path);
    }

    function getOrderNameFromPage() {
        const h1 = document.querySelector('h1');
        if (h1) {
            const text = h1.textContent.trim().replace(/^#/, '');
            if (text.match(/^[A-Z]{2,5}\d+$/)) return text;
        }
        const titleEls = document.querySelectorAll('[data-polaris-header-title], [class*="Title"]');
        for (const el of titleEls) {
            const text = el.textContent.trim().replace(/^#/, '');
            if (text.match(/^[A-Z]{2,5}\d+$/)) return text;
        }
        return null;
    }

    /********************************************************************
     * METABASE FETCH
     ********************************************************************/

    async function fetchOrderData(storeCode, orderName) {
        const cacheKey = `${storeCode}|${orderName}`;
        const cached = orderCache[cacheKey];
        if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
            log('Cache hit:', cacheKey);
            return cached.data;
        }

        const params = encodeURIComponent(JSON.stringify([
            { type: 'category', value: storeCode,  target: ['variable', ['template-tag', 'store']] },
            { type: 'category', value: orderName,  target: ['variable', ['template-tag', 'shopify_order_id']] },
        ]));

        const url = `${MB_BASE_URL}/public/question/${ORDERS_UUID}.json?parameters=${params}`;
        const json = await gmFetchJson(url);
        if (!Array.isArray(json)) throw new Error('Expected array from Metabase');

        log('Metabase returned', json.length, 'rows:', JSON.stringify(json[0]));
        orderCache[cacheKey] = { data: json, fetchedAt: Date.now() };
        return json;
    }

    /********************************************************************
     * WAIT HELPERS
     ********************************************************************/

    function waitForOrderName(timeout = 15000) {
        return new Promise((resolve, reject) => {
            const check = () => {
                const h1 = document.querySelector('h1');
                if (h1 && h1.textContent.trim().match(/^[A-Z]{2,5}\d+$/)) return h1;
                return null;
            };
            const found = check();
            if (found) return resolve(found);
            const obs = new MutationObserver(() => {
                const el = check();
                if (el) { obs.disconnect(); resolve(el); }
            });
            obs.observe(document.body, { childList: true, subtree: true });
            setTimeout(() => { obs.disconnect(); reject(new Error('Timed out')); }, timeout);
        });
    }

    function waitForDomSettle(quietMs = 400, timeout = 8000) {
        return new Promise(resolve => {
            let timer = null;
            const done = () => { obs.disconnect(); resolve(); };
            const reset = () => { if (timer) clearTimeout(timer); timer = setTimeout(done, quietMs); };
            const obs = new MutationObserver(reset);
            obs.observe(document.body, { childList: true, subtree: true });
            reset();
            setTimeout(() => { if (timer) clearTimeout(timer); obs.disconnect(); resolve(); }, timeout);
        });
    }

    /********************************************************************
     * DOM FINDER
     ********************************************************************/

    function findOrderRightColumn() {
        const main = document.querySelector('main') || document.body;

        // Strategy 1: Shopify order layout section
        const layout = main.querySelector('[class*="OrderDetailsLayout"], [class*="orderDetailsLayout"]');
        if (layout) {
            const children = Array.from(layout.children);
            if (children.length >= 2) {
                log('Found right column via OrderDetailsLayout');
                return children[children.length - 1];
            }
        }

        // Strategy 2: s-internal-heading web component wrappers
        const headingWrappers = Array.from(main.querySelectorAll('s-internal-heading'));
        for (const text of ['Notes', 'Customer', 'Conversion summary']) {
            const wrapper = headingWrappers.find(el => el.textContent.trim() === text);
            if (wrapper) {
                let el = wrapper;
                for (let i = 0; i < 10; i++) {
                    el = el.parentElement;
                    if (!el || el === main) break;
                    if (el.className && el.className.includes('Polaris')) {
                        log('Found right column via s-internal-heading:', text);
                        return el.parentElement || el;
                    }
                }
            }
        }

        // Strategy 3: Polaris layout stack last child
        const stack = main.querySelector('[class*="Polaris-BlockStack"], [class*="Polaris-InlineGrid"]');
        if (stack && stack.children.length >= 2) {
            log('Found right column via Polaris layout stack');
            return stack.children[stack.children.length - 1];
        }

        log('findOrderRightColumn: all strategies failed');
        return null;
    }

    /********************************************************************
     * PANEL BUILD
     ********************************************************************/

    function buildPanelElement() {
        document.getElementById('bp-orders-panel')?.remove();
        const p = document.createElement('div');
        p.id = 'bp-orders-panel';
        p.style.cssText = `
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
        p.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="font-weight:600;color:${PANEL_ACCENT};">BP Order Data</span>
                <span id="bp-orders-panel-status" style="font-size:11px;color:${PANEL_TEXT};opacity:0.8;">Loading…</span>
            </div>
            <div id="bp-orders-panel-body" style="display:flex;flex-direction:column;gap:4px;"></div>
        `;
        return p;
    }

    function injectPanel() {
        const panel = buildPanelElement();

        const col = findOrderRightColumn();
        if (col) {
            col.insertBefore(panel, col.firstChild);
            log('Injected at top of right column');
            return panel;
        }

        const mainEl = document.querySelector('main');
        if (mainEl) {
            mainEl.insertBefore(panel, mainEl.firstChild);
            log('Injected via main fallback');
            return panel;
        }

        log('All injection strategies failed');
        return null;
    }

    function setPanelStatus(text, color) {
        const el = document.getElementById('bp-orders-panel-status');
        if (!el) return;
        el.textContent = text;
        if (color) el.style.color = color;
    }

    /********************************************************************
     * RENDER
     ********************************************************************/

    function renderOrderData(rows, orderName) {
        const body = document.getElementById('bp-orders-panel-body');
        if (!body) return;
        body.innerHTML = '';

        const add = html => { const d = document.createElement('div'); d.innerHTML = html; body.appendChild(d); };

        if (!rows || rows.length === 0) {
            add(`<span style="color:${PANEL_WARN};">No BP order found for ${orderName}</span>`);
            setPanelStatus('No BP match', PANEL_WARN);
            return;
        }

        rows.forEach((row, idx) => {
            if (idx > 0) {
                const hr = document.createElement('div');
                hr.style.cssText = `border-top:1px solid ${PANEL_BORDER};margin:4px 0;`;
                body.appendChild(hr);
            }

            const bpOrderId      = row['bp_order_id'];
            const statusId       = Number(row['bp_status_id']);
            const stockStatus    = row['bp_stock_status'];
            const shippingStatus = row['bp_shipping_status'];

            // BP Order ID — clickable link
            const bpIdLine = document.createElement('div');
            if (bpOrderId) {
                const a = document.createElement('a');
                a.href = BP_ORDER_URL + encodeURIComponent(bpOrderId);
                a.target = '_blank';
                a.style.cssText = `color:${PANEL_ACCENT};text-decoration:underline;`;
                a.textContent = bpOrderId.toString();
                bpIdLine.innerHTML = `<span style="font-weight:600;">BP Order =</span> `;
                bpIdLine.appendChild(a);
            } else {
                bpIdLine.innerHTML = `<span style="font-weight:600;">BP Order =</span> —`;
            }
            body.appendChild(bpIdLine);

            const statusInfo = BP_STATUS_MAP[statusId] || { label: `Status ${statusId}`, color: PANEL_TEXT };
            add(`<span style="font-weight:600;">BP Status =</span> <span style="color:${statusInfo.color};">${statusInfo.label}</span>`);

            const stockInfo = BP_STOCK_STATUS_MAP[stockStatus] || { label: stockStatus || '—', color: PANEL_TEXT };
            add(`<span style="font-weight:600;">Stock Status =</span> <span style="color:${stockInfo.color};">${stockInfo.label}</span>`);

            const shippingLabel =
                [27, 4].includes(statusId)  ? { label: 'Shipped',          color: PANEL_OK } :
                statusId === 28             ? { label: 'Part Shipped',      color: PANEL_WARN } :
                statusId === 26             ? { label: 'Sent for Fulfil',   color: PANEL_ACCENT } :
                statusId === 25             ? { label: 'Pending Fulfil',    color: PANEL_WARN } :
                statusId === 5             ? { label: 'Cancelled',          color: PANEL_ERROR } :
                                             { label: 'Not Shipped',        color: PANEL_TEXT };
            add(`<span style="font-weight:600;">Shipping Status =</span> <span style="color:${shippingLabel.color};">${shippingLabel.label}</span>`);
        });

        setPanelStatus('Loaded', PANEL_OK);
    }

    /********************************************************************
     * MAIN
     ********************************************************************/

    async function main() {
        try {
            const storeCode = getStoreCodeFromUrl();
            if (!storeCode) { log('No store code'); return; }
            if (!isOrderPath(location.pathname)) return;

            const startUrl = location.href;

            try { await waitForOrderName(); }
            catch (e) { log('Order name never appeared:', e.message); return; }

            let orderName = null;
            for (let i = 0; i < 20; i++) {
                orderName = getOrderNameFromPage();
                if (orderName) break;
                await new Promise(r => setTimeout(r, 100));
            }
            if (!orderName) { log('Could not read order name'); return; }
            log('Order name:', orderName, '| Store:', storeCode);

            const dataPromise = fetchOrderData(storeCode, orderName);

            await waitForDomSettle(200, 3000);
            if (location.href !== startUrl) { log('URL changed, bailing'); return; }

            const panel = injectPanel();
            if (!panel) return;

            setPanelStatus('Loading…');

            const rows = await dataPromise;

            if (location.href !== startUrl) { log('URL changed during fetch, bailing'); return; }

            if (!document.getElementById('bp-orders-panel')) {
                const repanel = injectPanel();
                if (!repanel) return;
            }

            renderOrderData(rows, orderName);

        } catch (e) {
            log('Error:', e);
            setPanelStatus('Error: ' + e.message, PANEL_ERROR);
        }
    }

    /********************************************************************
     * ROUTER
     ********************************************************************/

    let activeRun = false;

    function runForCurrentPath() {
        if (!isOrderPath(location.pathname)) return;
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
