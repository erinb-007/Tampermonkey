// ==UserScript==
// @name         Shopify – Overwrite Columns with SKU Only
// @namespace    https://trakracer.com/
// @version      1.0
// @description
// @author       Erin Bond
// @match        https://admin.shopify.com/*
// @updateURL    https://raw.githubusercontent.com/username/repo/main/script.user.js
// @downloadURL  https://raw.githubusercontent.com/username/repo/main/script.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

;(function(){
  'use strict';

  // Cache to avoid repeated fetches
  const CACHE = {};

  function getBase() {
    return location.pathname.split('/products')[0];
  }

  // Fetch only product variant SKU
  function fetchSKU(id) {
    if (CACHE[id]) return CACHE[id];

    const origin = location.origin;
    const base = `${origin}${getBase()}`;

    const vPromise = fetch(`${base}/products/${id}.json?fields=variants`, {
      credentials: 'same-origin'
    })
    .then(r => r.json())
    .then(j => j.product.variants?.[0]?.sku || '')
    .catch(() => '');

    CACHE[id] = vPromise;
    return vPromise;
  }

  function inject() {
    const hdrs = [...document.querySelectorAll('[role="columnheader"]')];
    const b2bHdr = hdrs.find(h => h.textContent.trim() === 'B2B catalogs');
    if (!b2bHdr) return;

    const b2bI = hdrs.indexOf(b2bHdr);

    // Rename header to SKU (once)
    if (!b2bHdr.dataset.done) {
      b2bHdr.textContent = 'SKU';
      b2bHdr.dataset.done = '1';
    }

    // Overwrite each row in that column
    const rows = [...document.querySelectorAll('[role="rowgroup"]:nth-of-type(2) [role="row"]')];
    rows.forEach(row => {
      const cells = [...row.querySelectorAll('[role="gridcell"],[role="cell"]')];
      const b2bCell = cells[b2bI];
      if (!b2bCell || b2bCell.dataset.done) return;

      b2bCell.textContent = '…';  // placeholder
      b2bCell.dataset.done = '1';

      // extract product ID from link
      const link = row.querySelector('a[href*="/products/"]');
      const m = link?.href.match(/\/products\/(\d+)/);
      if (!m) return;
      const id = m[1];

      fetchSKU(id).then(sku => {
        b2bCell.textContent = sku;
      });
    });
  }

  // Observe DOM changes and apply inject
  new MutationObserver(inject).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('popstate', inject);
  inject();

})();
