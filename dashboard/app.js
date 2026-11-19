// Token Radar dashboard: renders window.__RADAR__ (written by main.ts from
// the sealed snapshot), with search, status/category/chain filters, sorting
// and a detail view per protocol. No network: every byte comes from data.js.
// Deep-link states for the three screenshots: #detail=<slug> opens a
// protocol, #filter=status:watchlist (or category:<name>) applies a filter.

(function () {
  'use strict';
  var data = window.__RADAR__;
  if (!data) { document.getElementById('meta').textContent = 'data.js missing — run main.ts first.'; return; }
  var rows = data.rows;
  var meta = data.meta;

  var $ = function (id) { return document.getElementById(id); };
  var money = function (n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n;
  };
  var fmtInt = function (n) { return n.toLocaleString('en-US'); };
  var esc = function (s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  var ageText = function (d) {
    if (d === null || d === undefined) return '—';
    if (d < 365) return Math.round(d / 30.4) + ' mo';
    return (d / 365).toFixed(1) + ' y';
  };
  var growthHtml = function (g) {
    if (g === null || g === undefined) return '<span class="flat">—</span>';
    var cls = g > 0 ? 'up' : g < 0 ? 'down' : 'flat';
    return '<span class="' + cls + '">' + (g > 0 ? '+' : '') + g.toFixed(1) + '%</span>';
  };

  $('meta').textContent = 'Snapshot ' + meta.as_of + ' · ' + fmtInt(meta.protocols_scanned) +
    ' protocols scanned · floor $' + fmtInt(meta.floor_usd);
  $('asof').textContent = meta.as_of;
  var watchlistN = rows.filter(function (r) { return r.status === 'watchlist'; }).length;
  var earlyN = rows.filter(function (r) { return r.status === 'early'; }).length;
  var longN = rows.length - watchlistN - earlyN;
  $('stats').innerHTML =
    stat(fmtInt(rows.length), 'pre-token protocols ranked') +
    stat(fmtInt(watchlistN), 'on the house watchlist') +
    stat(fmtInt(earlyN), 'early — below the $50M floor') +
    stat(fmtInt(longN), 'long-shot — unlikely to launch') +
    stat(meta.global_multiple.toFixed(2) + '×', 'global median mcap / TVL');
  function stat(b, s) { return '<div class="stat"><b>' + b + '</b><span>' + s + '</span></div>'; }

  var catSel = $('f-category');
  var cats = [];
  rows.forEach(function (r) { var c = r.category || '(no category)'; if (cats.indexOf(c) === -1) cats.push(c); });
  cats.sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; catSel.appendChild(o);
  });
  var chainSel = $('f-chain');
  var chains = [];
  rows.forEach(function (r) { r.chains.forEach(function (c) { if (chains.indexOf(c) === -1) chains.push(c); }); });
  chains.sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; chainSel.appendChild(o);
  });

  var openSlug = null;

  function filtered() {
    var q = $('q').value.trim().toLowerCase();
    var status = $('f-status').value;
    var cat = $('f-category').value;
    var chain = $('f-chain').value;
    var sort = $('f-sort').value;
    var list = rows.filter(function (r) {
      if (status !== 'all' && r.status !== status) return false;
      if (cat !== 'all' && (r.category || '(no category)') !== cat) return false;
      if (chain !== 'all' && r.chains.indexOf(chain) === -1) return false;
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    if (sort === 'tvl') list.sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
    else if (sort === 'growth') list.sort(function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); });
    else if (sort === 'age') list.sort(function (a, b) { return (b.age_days || 0) - (a.age_days || 0); });
    else list.sort(function (a, b) { return a.rank - b.rank; });
    return list;
  }

  function render() {
    var list = filtered();
    var tbody = $('rows');
    tbody.innerHTML = list.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"' + (r.slug === openSlug ? ' class="open"' : '') + '>' +
        '<td class="num rank">' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + growthHtml(r.change_7d) + '</td>' +
        '<td class="num">' + ageText(r.age_days) + '</td>' +
        '<td class="num"><b>' + money(r.implied_value_usd) + '</b></td>' +
        '<td><span class="badge ' + r.status + '">' + r.status + '</span></td>' +
        '<td><button class="btn" data-open="' + esc(r.slug) + '">Farm plan</button></td></tr>';
    }).join('');
    $('empty').hidden = list.length > 0;
    $('count').textContent = fmtInt(list.length) + ' of ' + fmtInt(rows.length) + ' shown';
  }

  function detailHtml(r) {
    var comps = r.comparables.map(function (c) {
      return '<tr><td>' + esc(c.name) + '</td><td class="num">' + money(c.mcap_usd) + '</td><td class="num">' + c.multiple.toFixed(2) + '×</td></tr>';
    }).join('');
    return '<button class="btn close" id="d-close">Close ✕</button>' +
      '<h2>#' + r.rank + ' · ' + esc(r.name) + '</h2>' +
      '<p class="sub">' + esc(r.slug) + ' · ' + esc(r.category || 'no category') + ' · ' + esc(r.chains.join(', ')) +
      ' · TVL ' + money(r.tvl_usd) + ' · <span class="badge ' + r.status + '">' + r.status + '</span></p>' +
      '<div class="math">' +
      '<div><b>' + money(r.base_fdv_usd) + '</b><span>base FDV = TVL × ' + r.multiple.toFixed(2) + '×</span></div>' +
      '<div><b>×' + r.growth_factor.toFixed(2) + '</b><span>growth (' + (r.change_7d === null ? 'unreported' : r.change_7d.toFixed(1) + '% / 7d') + ')</span></div>' +
      '<div><b>×' + r.maturity_factor.toFixed(2) + '</b><span>maturity (' + ageText(r.age_days) + ' listed, no token)</span></div>' +
      '<div><b>×' + r.breadth_factor.toFixed(2) + '</b><span>breadth (' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ')</span></div>' +
      '<div><b>×' + r.likelihood_factor.toFixed(2) + '</b><span>launch-likelihood</span></div>' +
      '<div><b>' + money(r.implied_value_usd) + '</b><span>implied value</span></div>' +
      '</div>' +
      '<p class="why">' + esc(r.likelihood_reason) + ' Multiple source: ' + esc(r.multiple_source) + '.</p>' +
      '<h3>How to farm it — concrete steps</h3>' +
      '<ol class="steps">' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      (comps ? '<h3>Comparables — trading protocols in ' + esc(r.category || 'this category') + '</h3>' +
      '<table class="comps"><thead><tr><th>Protocol</th><th class="num">Market cap</th><th class="num">mcap / TVL</th></tr></thead><tbody>' + comps + '</tbody></table>' : '');
  }

  function openDetail(slug) {
    var r = null;
    rows.forEach(function (x) { if (x.slug === slug) r = x; });
    var panel = $('detail');
    if (!r) { panel.hidden = true; openSlug = null; render(); return; }
    openSlug = slug;
    panel.innerHTML = detailHtml(r);
    panel.hidden = false;
    $('d-close').addEventListener('click', function () { panel.hidden = true; openSlug = null; render(); });
    render();
    panel.scrollIntoView({ block: 'nearest' });
  }

  $('rows').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-open]');
    if (btn) { openDetail(btn.getAttribute('data-open')); return; }
    var tr = e.target.closest('tr[data-slug]');
    if (tr) openDetail(tr.getAttribute('data-slug'));
  });
  ['q', 'f-status', 'f-category', 'f-chain', 'f-sort'].forEach(function (id) {
    $(id).addEventListener('input', render);
    $(id).addEventListener('change', render);
  });

  // Deep links: #detail=<slug> opens a protocol, #filter=status:watchlist
  // (or category:<name>) applies a filter, #view=board compacts the page
  // so the board's rows sit above the fold.
  var hash = window.location.hash || '';
  var m = hash.match(/(?:#|&)detail=([A-Za-z0-9._-]+)/);
  var f = hash.match(/(?:#|&)filter=(status|category):([^&]+)/);
  var v = hash.match(/(?:#|&)view=board/);
  if (v) document.body.classList.add('focus');
  if (m) document.body.classList.add('detail-mode');
  $('focus').addEventListener('click', function () {
    document.body.classList.toggle('focus');
  });
  if (f) {
    var key = f[1] === 'status' ? 'f-status' : 'f-category';
    $(key).value = decodeURIComponent(f[2]);
  }
  render();
  if (m) openDetail(m[1]);
})();
