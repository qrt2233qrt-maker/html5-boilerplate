// Small SVG charts with no dependencies. Following the data-viz method:
// thin marks, one y-axis, recessive grid, a legend for 2+ series plus direct
// labels, hover/keyboard tooltips, and a table view for every chart.
// Series colours come from --series-N tokens (validated, light and dark).
import { html, mount } from './util.js';
import { t } from './i18n.js';
import { MOTION } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
export const seriesColor = (i) => `var(--series-${(i % 8) + 1})`;

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
}

function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) n.setAttribute(k, v);
  if (parent) parent.append(n);
  return n;
}

// Card shell: title, legend, chart area, table toggle.
export function chartCard(host, { title, legend = [], table }) {
  mount(host, html`<div class="chart-head"><h2>${title}</h2>
      <button class="btn small ghost" type="button" data-table aria-pressed="false">${t('showTable')}</button></div>
    ${legend.length > 1 ? html`<ul class="legend">${legend.map((l, i) => html`<li><i class="swatch s${(l.slot ?? i) % 8 + 1}"></i>${l.label}</li>`)}</ul>` : ''}
    <div class="chart" dir="ltr"></div><div class="chart-table" hidden></div>`);
  const btn = host.querySelector('[data-table]');
  const tbl = host.querySelector('.chart-table');
  btn.onclick = () => {
    const show = tbl.hidden;
    tbl.hidden = !show;
    host.querySelector('.chart').hidden = show;
    btn.setAttribute('aria-pressed', String(show));
    btn.textContent = show ? t('showChart') : t('showTable');
    if (show) mount(tbl, html`<div class="tablewrap"><table class="data"><thead><tr>${table.columns.map((c) => html`<th>${c}</th>`)}</tr></thead>
      <tbody>${table.rows.map((r) => html`<tr>${r.map((v) => html`<td>${v}</td>`)}</tr>`)}</tbody></table></div>`);
  };
  return host.querySelector('.chart');
}

function tooltip(box) {
  let tip = box.querySelector('.tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'tip';
    tip.setAttribute('role', 'status');
    box.append(tip);
  }
  return tip;
}

function placeTip(box, tip, x, y) {
  const w = box.clientWidth;
  tip.hidden = false;
  const left = Math.min(Math.max(8, x + 12), w - tip.offsetWidth - 8);
  tip.style.left = `${x + 12 + tip.offsetWidth > w ? Math.max(8, x - tip.offsetWidth - 12) : left}px`;
  tip.style.top = `${Math.max(0, y - 10)}px`;
}

function axis(svg, { w, h, pad, max, min = 0, format, labels, step }) {
  const g = el('g', { class: 'axis' }, svg);
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = min + ((max - min) * i) / ticks;
    const y = pad.t + (h - pad.t - pad.b) * (1 - i / ticks);
    el('line', { x1: pad.l, x2: w - pad.r, y1: y, y2: y, class: v === 0 ? 'zero' : 'grid' }, g);
    el('text', { x: pad.l - 6, y: y + 4, 'text-anchor': 'end' }, g).textContent = format(v);
  }
  const every = Math.max(1, Math.ceil(labels.length / Math.floor((w - pad.l - pad.r) / 64)));
  labels.forEach((lab, i) => {
    if (i % every) return;
    el('text', { x: pad.l + step * i + (step ? 0 : 0), y: h - 6, 'text-anchor': 'middle', class: 'xl' }, g).textContent = lab;
  });
}

// Multi-series line chart with a crosshair tooltip.
export function lineChart(box, { labels, series, format, axisFormat = format, tipLabel = (i) => labels[i] }) {
  const draw = () => {
    box.innerHTML = '';
    const w = Math.max(280, box.clientWidth);
    const h = 240;
    const pad = { t: 12, r: 16, b: 26, l: 64 };
    const all = series.flatMap((s) => s.values);
    const max = niceMax(Math.max(0, ...all));
    const min = Math.min(0, ...all) < 0 ? -niceMax(-Math.min(...all)) : 0;
    const n = labels.length;
    const step = n > 1 ? (w - pad.l - pad.r) / (n - 1) : 0;
    const x = (i) => pad.l + step * i + (n === 1 ? (w - pad.l - pad.r) / 2 : 0);
    const y = (v) => pad.t + (h - pad.t - pad.b) * (1 - (v - min) / (max - min));
    const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, width: '100%', height: h, role: 'img', 'aria-label': series.map((s) => s.label).join(', ') }, box);
    axis(svg, { w, h, pad, max, min, format: axisFormat, labels: labels.map((l, i) => (n > 1 ? l : i === 0 ? l : '')), step });
    series.forEach((s, si) => {
      const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('');
      const path = el('path', { d, class: 'line', stroke: seriesColor(s.slot ?? si) }, svg);
      if (!MOTION.reduced && n > 1) {
        const len = path.getTotalLength();
        path.animate([{ strokeDasharray: len, strokeDashoffset: len }, { strokeDasharray: len, strokeDashoffset: 0 }], { duration: MOTION.emph, easing: MOTION.out });
      }
      // Direct label at the end of each line (selective, not every point).
      const last = s.values.length - 1;
      if (series.length <= 4 && last >= 0) {
        const lbl = el('text', { x: Math.min(x(last), w - pad.r), y: y(s.values[last]) - 8, 'text-anchor': 'end', class: 'dl' }, svg);
        lbl.textContent = s.label;
      }
    });
    const cross = el('line', { y1: pad.t, y2: h - pad.b, class: 'cross', visibility: 'hidden' }, svg);
    const dots = series.map((s, si) => el('circle', { r: 5, class: 'dot', fill: seriesColor(s.slot ?? si), visibility: 'hidden' }, svg));
    const hit = el('rect', { x: pad.l - step / 2, y: 0, width: w - pad.l - pad.r + step, height: h, fill: 'transparent', tabindex: 0, class: 'hit' }, svg);
    hit.setAttribute('aria-label', t('chartHint'));
    const tip = tooltip(box);
    tip.hidden = true;
    let idx = -1;
    const show = (i) => {
      idx = Math.max(0, Math.min(n - 1, i));
      cross.setAttribute('x1', x(idx)); cross.setAttribute('x2', x(idx)); cross.setAttribute('visibility', 'visible');
      series.forEach((s, si) => { dots[si].setAttribute('cx', x(idx)); dots[si].setAttribute('cy', y(s.values[idx])); dots[si].setAttribute('visibility', 'visible'); });
      mount(tip, html`<b>${tipLabel(idx)}</b>${series.map((s, si) => html`<div><i class="swatch s${(s.slot ?? si) % 8 + 1}"></i>${s.label}: <span class="num">${format(s.values[idx])}</span></div>`)}`);
      placeTip(box, tip, x(idx) * (box.clientWidth / w), y(Math.max(...series.map((s) => s.values[idx]))));
    };
    const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dots.forEach((d) => d.setAttribute('visibility', 'hidden')); };
    hit.addEventListener('pointermove', (e) => {
      const r = svg.getBoundingClientRect();
      show(Math.round(((e.clientX - r.left) * (w / r.width) - pad.l) / (step || 1)));
    });
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('focus', () => show(n - 1));
    hit.addEventListener('blur', hide);
    hit.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); show(idx + (e.key === 'ArrowRight' ? 1 : -1)); }
    });
  };
  draw();
  observe(box, draw);
}

// Vertical bars. With `diverging`, positive and negative values use the
// two poles and grow from zero (profit vs loss).
export function barChart(box, { labels, values, format, axisFormat = format, slot = 0, diverging = false, tipLabel = (i) => labels[i], onSelect }) {
  const draw = () => {
    box.innerHTML = '';
    const w = Math.max(280, box.clientWidth);
    const h = 220;
    const pad = { t: 12, r: 12, b: 26, l: 64 };
    const max = niceMax(Math.max(0, ...values));
    const min = Math.min(...values, 0) < 0 ? -niceMax(-Math.min(...values)) : 0;
    const n = values.length;
    const band = (w - pad.l - pad.r) / Math.max(1, n);
    const bw = Math.max(3, Math.min(28, band - 2));
    const y = (v) => pad.t + (h - pad.t - pad.b) * (1 - (v - min) / (max - min));
    const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, width: '100%', height: h, role: 'img' }, box);
    axis(svg, { w, h, pad, max, min, format: axisFormat, labels: labels.map(() => ''), step: band });
    const every = Math.max(1, Math.ceil(n / Math.floor((w - pad.l - pad.r) / 56)));
    const tip = tooltip(box);
    tip.hidden = true;
    values.forEach((v, i) => {
      const cx = pad.l + band * i + band / 2;
      const top = Math.min(y(v), y(0));
      const height = Math.max(v === 0 ? 0 : 1, Math.abs(y(v) - y(0)));
      const color = diverging ? (v < 0 ? 'var(--neg)' : 'var(--pos)') : seriesColor(slot);
      // Rounded 4px data end, square at the baseline.
      const r = Math.min(4, bw / 2, height);
      const up = v >= 0;
      const d = up
        ? `M${cx - bw / 2} ${top + height}V${top + r}q0 ${-r} ${r} ${-r}h${bw - 2 * r}q${r} 0 ${r} ${r}V${top + height}Z`
        : `M${cx - bw / 2} ${top}V${top + height - r}q0 ${r} ${r} ${r}h${bw - 2 * r}q${r} 0 ${r} ${-r}V${top}Z`;
      const bar = el('path', { d, fill: color, class: 'bar' }, svg);
      if (!MOTION.reduced) {
        // Grow from the zero line.
        bar.style.transformOrigin = `${cx}px ${y(0)}px`;
        bar.animate([{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], { duration: MOTION.emph, easing: MOTION.out, delay: Math.min(i, 20) * 12, fill: 'backwards' });
      }
      if (i % every === 0) el('text', { x: cx, y: h - 6, 'text-anchor': 'middle', class: 'xl' }, svg).textContent = labels[i];
      const hit = el('rect', { x: cx - band / 2, y: pad.t, width: band, height: h - pad.t - pad.b, fill: 'transparent', tabindex: 0, class: 'hit' }, svg);
      hit.setAttribute('aria-label', `${tipLabel(i)}: ${format(v)}`);
      const showTip = () => {
        mount(tip, html`<b>${tipLabel(i)}</b><div class="num">${format(v)}</div>`);
        placeTip(box, tip, cx * (box.clientWidth / w), top);
        bar.classList.add('on');
      };
      hit.addEventListener('pointerenter', showTip);
      hit.addEventListener('focus', showTip);
      const off = () => { tip.hidden = true; bar.classList.remove('on'); };
      hit.addEventListener('pointerleave', off);
      hit.addEventListener('blur', off);
      if (onSelect) {
        hit.style.cursor = 'pointer';
        hit.addEventListener('click', () => onSelect(i));
        hit.addEventListener('keydown', (e) => { if (e.key === 'Enter') onSelect(i); });
      }
    });
  };
  draw();
  observe(box, draw);
}

// Donut for shares of a whole, with a value legend (identity never by
// colour alone). More than 7 parts fold into "Other".
export function donut(box, { items, format, total, onSelect, centerLabel }) {
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const shown = sorted.length > 8 ? [...sorted.slice(0, 7), { key: '__other', label: t('other'), value: sorted.slice(7).reduce((a, x) => a + x.value, 0), other: true }] : sorted;
  const sum = total ?? shown.reduce((a, x) => a + x.value, 0);
  box.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'donut';
  box.append(wrap);
  const size = 200;
  const R = 90;
  const rIn = 60;
  const svg = el('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, role: 'img', 'aria-label': centerLabel || '' }, wrap);
  let a0 = -Math.PI / 2;
  shown.forEach((it, i) => {
    const frac = sum ? it.value / sum : 0;
    const a1 = a0 + frac * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (a, r) => `${(size / 2 + r * Math.cos(a)).toFixed(2)} ${(size / 2 + r * Math.sin(a)).toFixed(2)}`;
    const d = frac >= 0.9999
      ? `M${p(0, R)}A${R} ${R} 0 1 1 ${p(Math.PI, R)}A${R} ${R} 0 1 1 ${p(0, R)}M${p(0, rIn)}A${rIn} ${rIn} 0 1 0 ${p(Math.PI, rIn)}A${rIn} ${rIn} 0 1 0 ${p(0, rIn)}Z`
      : `M${p(a0, R)}A${R} ${R} 0 ${large} 1 ${p(a1, R)}L${p(a1, rIn)}A${rIn} ${rIn} 0 ${large} 0 ${p(a0, rIn)}Z`;
    const seg = el('path', { d, fill: it.other ? 'var(--series-other)' : seriesColor(i), class: 'seg', tabindex: onSelect && !it.other ? 0 : undefined }, svg);
    seg.setAttribute('aria-label', `${it.label}: ${format(it.value)}`);
    if (onSelect && !it.other) {
      seg.style.cursor = 'pointer';
      seg.addEventListener('click', () => onSelect(it));
      seg.addEventListener('keydown', (e) => { if (e.key === 'Enter') onSelect(it); });
    }
    a0 = a1;
  });
  const c = el('text', { x: size / 2, y: size / 2 - 2, 'text-anchor': 'middle', class: 'center-v' }, svg);
  c.textContent = format(sum);
  if (centerLabel) el('text', { x: size / 2, y: size / 2 + 18, 'text-anchor': 'middle', class: 'center-l' }, svg).textContent = centerLabel;
  const list = document.createElement('ul');
  list.className = 'donut-legend';
  list.setAttribute('dir', 'auto');
  mount(list, html`${shown.map((it, i) => html`<li>${onSelect && !it.other ? html`<button type="button" data-k="${it.key}">` : html`<span>`}
      <i class="swatch ${it.other ? 'so' : `s${(i % 8) + 1}`}"></i><span class="nm">${it.label}</span>
      <span class="vl num">${format(it.value)}</span><span class="pc num">${sum ? Math.round((it.value / sum) * 100) : 0}%</span>
    ${onSelect && !it.other ? html`</button>` : html`</span>`}</li>`)}`);
  if (onSelect) list.querySelectorAll('[data-k]').forEach((b) => { b.onclick = () => onSelect(shown.find((x) => x.key === b.dataset.k)); });
  wrap.append(list);
}

const observers = new WeakMap();
function observe(box, draw) {
  observers.get(box)?.disconnect();
  let last = box.clientWidth;
  let raf = 0;
  const ro = new ResizeObserver(() => {
    if (Math.abs(box.clientWidth - last) < 8) return;
    last = box.clientWidth;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(draw);
  });
  ro.observe(box);
  observers.set(box, ro);
}

// Animated number for KPI tiles (tabular digits, final value announced once).
export function countUp(node, to, format) {
  node.setAttribute('aria-label', format(to));
  if (MOTION.reduced) { node.textContent = format(to); return; }
  const start = performance.now();
  const ease = (x) => 1 - (1 - x) ** 3;
  (function step(now) {
    const p = Math.min(1, (now - start) / MOTION.emph);
    node.textContent = format(Math.round(to * ease(p)));
    if (p < 1) requestAnimationFrame(step);
  })(start);
}
