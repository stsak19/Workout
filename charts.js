/* Μικρά γραφήματα SVG χωρίς εξαρτήσεις. */

const NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

const fmt = (n) => (Math.round(n * 10) / 10).toLocaleString('el-GR');

/**
 * Γραμμή με σημεία.
 * points: [{ label, value }]
 */
export function lineChart(points, opts = {}) {
  const W = 320;
  const H = 150;
  const padL = 34;
  const padR = 8;
  const padT = 12;
  const padB = 22;

  const svg = el('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: 'chart',
    role: 'img',
    'aria-label': opts.label || 'Γράφημα προόδου'
  });

  if (!points.length) return svg;

  const values = points.map((p) => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  min -= span * 0.12;
  max += span * 0.12;

  const x = (i) => padL + (i * (W - padL - padR)) / Math.max(points.length - 1, 1);
  const y = (v) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);

  /* Οριζόντιοι οδηγοί */
  [max, (max + min) / 2, min].forEach((v) => {
    svg.appendChild(el('line', {
      x1: padL, x2: W - padR, y1: y(v), y2: y(v), class: 'chart-grid'
    }));
    const t = el('text', { x: 4, y: y(v) + 3.5, class: 'chart-tick' });
    t.textContent = fmt(v);
    svg.appendChild(t);
  });

  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`).join(' ');

  /* Γέμισμα κάτω από τη γραμμή */
  const area = `${d} L${x(points.length - 1)},${H - padB} L${x(0)},${H - padB} Z`;
  svg.appendChild(el('path', { d: area, class: 'chart-area' }));
  svg.appendChild(el('path', { d, class: 'chart-line' }));

  points.forEach((p, i) => {
    const dot = el('circle', { cx: x(i), cy: y(p.value), r: 3.5, class: 'chart-dot' });
    const title = el('title');
    title.textContent = `${p.label}: ${fmt(p.value)}${opts.unit ? ' ' + opts.unit : ''}`;
    dot.appendChild(title);
    svg.appendChild(dot);
  });

  /* Πρώτη και τελευταία ετικέτα μόνο, για να μη στριμώχνεται σε κινητό */
  [0, points.length - 1].forEach((i, idx) => {
    if (points.length < 2 && idx === 1) return;
    const t = el('text', {
      x: x(i),
      y: H - 6,
      class: 'chart-tick',
      'text-anchor': idx === 0 ? 'start' : 'end'
    });
    t.textContent = points[i].label;
    svg.appendChild(t);
  });

  return svg;
}

/** Οριζόντιες μπάρες για τον εβδομαδιαίο όγκο. */
export function barRow(value, max) {
  const wrap = document.createElement('div');
  wrap.className = 'bar-track';
  const fill = document.createElement('div');
  fill.className = 'bar-fill';
  fill.style.width = Math.min(100, (value / max) * 100) + '%';
  wrap.appendChild(fill);
  return wrap;
}
