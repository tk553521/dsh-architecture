import { readFileSync } from 'node:fs';

/** Standalone, deterministic renderer. Input has already passed the host's schema validation. */
const TYPES = Object.freeze({ architecture: '架构图', workflow: '工作流', dataflow: '数据流', tree: '树形图', sequence: '时序图', erd: '实体关系图', class: '类图', lifecycle: '生命周期', timeline: '时间线', waterfall: '瀑布图' });
const KINDS = Object.freeze({ component: '组件', actor: '参与者', external: '外部系统', store: '数据存储' });
const W = 268;
const esc = value => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '\ufffd').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeJSON = value => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, c => ({ '<': '\\u003c', '>': '\\u003e', '&': '\\u0026', '\u2028': '\\u2028', '\u2029': '\\u2029' })[c]);
const num = value => Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0;
const len = text => Array.from(String(text)).reduce((n, c) => n + (/[^\u0000-\u00ff]/u.test(c) ? 1 : .56), 0);
function wrap(value, width, max = Infinity) {
  const result = [];
  const paragraphs = String(value ?? '').replace(/\r/g, '').split('\n');
  for (const paragraph of paragraphs) {
    let line = '';
    for (const c of Array.from(paragraph)) {
      if (len(line + c) > width && line) { result.push(line); line = ''; }
      line += c;
    }
    result.push(line);
  }
  if (result.length > max) {
    result.length = max;
    result[max - 1] = Array.from(result[max - 1]).slice(0, Math.max(1, Array.from(result[max - 1]).length - 1)).join('') + '…';
  }
  return result;
}
function textLines(lines, x, y, cls = 'node-label', step = 20, anchor = 'start') {
  return `<text class="${cls}" x="${num(x)}" y="${num(y)}" text-anchor="${anchor}">${lines.map((s, i) => `<tspan x="${num(x)}" dy="${i ? step : 0}">${esc(s)}</tspan>`).join('')}</text>`;
}
function path(d, primary, extra = '') {
  return `<path class="edge-path" d="${d}" marker-end="url(#${primary ? 'dsha-primary-arrow' : 'dsha-arrow'})" ${extra}/>`;
}
function edgeLabel(lines, x, y, cls = '') {
  if (!lines.some(Boolean)) return '';
  const width = Math.min(300, Math.max(44, ...lines.map(line => len(line) * 12.5 + 20)));
  return `<g class="edge-label ${cls}" transform="translate(${num(x)} ${num(y)})"><rect x="${num(-width / 2)}" y="-14" width="${num(width)}" height="${lines.length * 16 + 7}" rx="5"/>${textLines(lines, 0, 0, 'edge-text', 16, 'middle')}</g>`;
}
function context(spec) {
  const nodeIndex = new Map(spec.nodes.map((n, i) => [n.id, i]));
  const main = new Set(spec.primaryPath);
  const pairs = new Set(spec.primaryPath.slice(1).map((id, i) => `${nodeIndex.get(spec.primaryPath[i])}:${nodeIndex.get(id)}`));
  const primaryEdge = e => e.primary || pairs.has(`${nodeIndex.get(e.from)}:${nodeIndex.get(e.to)}`);
  spec.edges.forEach(e => { if (primaryEdge(e)) { main.add(e.from); main.add(e.to); } });
  const groupMap = new Map(spec.groups.map(g => [g.id, g]));
  const buckets = spec.groups.map(g => ({ ...g, nodes: [] }));
  const bucketMap = new Map(buckets.map(g => [g.id, g]));
  const loose = { id: null, label: '未分组', trustBoundary: false, nodes: [] };
  spec.nodes.forEach((n, i) => (bucketMap.get(n.group) || loose).nodes.push(i));
  if (loose.nodes.length) buckets.push(loose);
  return { spec, nodeIndex, main, primaryEdge, groupMap, buckets: buckets.filter(b => b.nodes.length) };
}
function nodeMetrics(node, structured = false) {
  const labels = wrap(node.label, 16, 4);
  const rows = structured ? node.details.slice(0, 12).map(d => wrap(d, 25, 2)) : [];
  const description = structured ? [] : wrap(node.description, 27, 2).filter(Boolean);
  const header = 46 + labels.length * 21;
  const height = structured ? header + rows.reduce((h, r) => h + r.length * 17 + 12, 0) + (node.details.length > rows.length ? 26 : 0) + 14 : header + description.length * 17 + 17;
  return { labels, rows, description, header, height: Math.max(100, height) };
}
function nodeBox(ctx, index, box, structured = false, suffix = '') {
  const node = ctx.spec.nodes[index];
  const m = nodeMetrics(node, structured);
  const kind = Object.hasOwn(KINDS, node.kind) ? node.kind : 'component';
  const cls = `node kind-${kind}${ctx.main.has(node.id) ? ' is-primary' : ''} ${suffix}`;
  let body = `<rect class="node-surface" x="0" y="0" width="${box.w}" height="${box.h}" rx="12"/><rect class="node-accent" x="0" y="12" width="4" height="${box.h - 24}" rx="2"/>`;
  body += `<text class="kind-label" x="17" y="24">${esc(KINDS[kind])}</text>${textLines(m.labels, 17, 49)}`;
  if (structured) {
    let y = m.header;
    body += `<path class="row-divider" d="M 1 ${y - 5} H ${box.w - 1}"/>`;
    m.rows.forEach(row => { body += textLines(row, 17, y + 15, 'detail-row', 17); y += row.length * 17 + 12; body += `<path class="row-divider" d="M 12 ${y - 3} H ${box.w - 12}"/>`; });
    if (node.details.length > m.rows.length) body += `<text class="node-description" x="17" y="${y + 16}">另 ${node.details.length - m.rows.length} 项 · 点击查看</text>`;
  } else if (m.description.length) body += textLines(m.description, 17, m.header + 5, 'node-description', 17);
  return `<g class="${cls}" data-node="${index}" tabindex="0" role="button" aria-label="${esc(node.label)}，查看详情" transform="translate(${num(box.x)} ${num(box.y)})">${body}<title>${esc(node.label)}${node.description ? ' — ' + esc(node.description) : ''}</title></g>`;
}
function boundary(bucket, x, y, width, height, vertical = false) {
  if (bucket.id === null) return '';
  return `<g class="group${bucket.trustBoundary ? ' trust-boundary' : ''}"><rect class="group-boundary" x="${num(x)}" y="${num(y)}" width="${num(width)}" height="${num(height)}" rx="16"/>${textLines(wrap(`${bucket.label}${bucket.trustBoundary ? ' · 信任边界' : ''}`, vertical ? 17 : 70, 2), x + 18, y + 25, 'group-label', 18)}</g>`;
}
/** Collapse strongly connected components, then layer their DAG with primary-path ordering edges. */
function ranks(ctx) {
  const { spec, nodeIndex } = ctx;
  const adjacency = spec.nodes.map(() => new Set());
  spec.edges.forEach(e => { const a = nodeIndex.get(e.from), b = nodeIndex.get(e.to); if (a !== undefined && b !== undefined) adjacency[a].add(b); });
  spec.primaryPath.slice(1).forEach((id, i) => { const a = nodeIndex.get(spec.primaryPath[i]), b = nodeIndex.get(id); if (a !== undefined && b !== undefined) adjacency[a].add(b); });
  const serial = Array(spec.nodes.length).fill(-1), low = [], stack = [], onStack = new Set(), components = [], owner = [];
  let next = 0;
  function visit(v) {
    serial[v] = low[v] = next++; stack.push(v); onStack.add(v);
    for (const w of adjacency[v]) { if (serial[w] < 0) { visit(w); low[v] = Math.min(low[v], low[w]); } else if (onStack.has(w)) low[v] = Math.min(low[v], serial[w]); }
    if (low[v] === serial[v]) { const members = []; let w; do { w = stack.pop(); onStack.delete(w); owner[w] = components.length; members.push(w); } while (w !== v); components.push(members); }
  }
  spec.nodes.forEach((_, i) => { if (serial[i] < 0) visit(i); });
  const primaryOrder = new Map(spec.primaryPath.map((id, i) => [nodeIndex.get(id), i]));
  const bfs = [], seen = new Set(), queue = [...primaryOrder.keys(), ...spec.nodes.map((_, i) => i)];
  for (let q = 0; q < queue.length; q++) { const v = queue[q]; if (seen.has(v)) continue; seen.add(v); bfs.push(v); for (const w of adjacency[v]) if (!seen.has(w)) queue.push(w); }
  const order = new Map(bfs.map((v, i) => [v, i]));
  components.forEach(c => c.sort((a, b) => (primaryOrder.get(a) ?? Infinity) - (primaryOrder.get(b) ?? Infinity) || order.get(a) - order.get(b)));
  const outgoing = components.map(() => new Set()), indegree = components.map(() => 0), starts = components.map(() => 0);
  adjacency.forEach((targets, a) => targets.forEach(b => { if (owner[a] !== owner[b] && !outgoing[owner[a]].has(owner[b])) { outgoing[owner[a]].add(owner[b]); indegree[owner[b]]++; } }));
  const ready = indegree.flatMap((d, i) => d === 0 ? [i] : []), result = [];
  for (let q = 0; q < ready.length; q++) {
    const c = ready[q]; components[c].forEach((v, i) => { result[v] = starts[c] + i; });
    for (const target of outgoing[c]) { starts[target] = Math.max(starts[target], starts[c] + components[c].length); if (--indegree[target] === 0) ready.push(target); }
  }
  return { rank: result, order };
}
function graphLayout(ctx) {
  const structured = ctx.spec.type === 'erd' || ctx.spec.type === 'class';
  const { rank, order } = ranks(ctx);
  const maxRank = Math.max(0, ...rank), width = 320 + W + maxRank * (W + 108);
  const boxes = new Map(), groups = [];
  // Reserve title/return-edge lanes and the right-side self-loop/label gutter.
  let y = 174;
  for (const bucket of ctx.buckets) {
    const columns = new Map();
    bucket.nodes.forEach(i => { const r = rank[i]; if (!columns.has(r)) columns.set(r, []); columns.get(r).push(i); });
    columns.forEach(c => c.sort((a, b) => order.get(a) - order.get(b)));
    const header = bucket.id === null ? (ctx.spec.groups.length ? 36 : 6) : 56;
    const bandHeight = header + Math.max(0, ...[...columns.values()].map(c => c.reduce((h, i) => h + nodeMetrics(ctx.spec.nodes[i], structured).height + 28, 0))) + 4;
    groups.push(boundary(bucket, 34, y, width - 68, bandHeight));
    if (bucket.id === null && ctx.spec.groups.length) groups.push(textLines(['未分组'], 51, y + 24, 'group-label'));
    for (const [column, nodes] of columns) {
      let rowY = y + header;
      nodes.forEach(i => { const h = nodeMetrics(ctx.spec.nodes[i], structured).height; boxes.set(i, { x: 68 + column * (W + 108), y: rowY, w: W, h }); rowY += h + 28; });
    }
    y += bandHeight + 30;
  }
  let edges = '';
  ctx.spec.edges.forEach((edge, index) => {
    const a = boxes.get(ctx.nodeIndex.get(edge.from)), b = boxes.get(ctx.nodeIndex.get(edge.to));
    if (!a || !b) return;
    const primary = ctx.primaryEdge(edge), ay = a.y + a.h / 2, by = b.y + b.h / 2;
    const offset = (index % 7 - 3) * 4;
    let d, lx, ly;
    if (edge.from === edge.to) {
      const x = a.x + a.w, loop = 30 + index % 4 * 9;
      d = `M ${num(x)} ${num(ay - 15)} C ${num(x + loop * 2)} ${num(ay - 65)}, ${num(x + loop * 2)} ${num(ay + 65)}, ${num(x)} ${num(ay + 15)}`;
      lx = x + loop; ly = ay;
    } else if (b.x > a.x) {
      const ax = a.x + a.w, bx = b.x, mid = (ax + bx) / 2 + offset;
      d = `M ${num(ax)} ${num(ay)} C ${num(mid)} ${num(ay)}, ${num(mid)} ${num(by)}, ${num(bx)} ${num(by)}`;
      lx = (ax + bx) / 2; ly = (ay + by) / 2 - 7 + offset;
    } else if (b.x < a.x) {
      const ax = a.x, bx = b.x + b.w, lift = Math.max(26, 40 + index % 5 * 7), top = Math.min(a.y, b.y) - lift;
      d = `M ${num(ax)} ${num(ay)} C ${num(ax - 36)} ${num(ay)}, ${num(ax - 36)} ${num(top)}, ${num(ax - 36)} ${num(top)} L ${num(bx + 36)} ${num(top)} C ${num(bx + 36)} ${num(top)}, ${num(bx + 36)} ${num(by)}, ${num(bx)} ${num(by)}`;
      lx = (ax + bx) / 2; ly = top - 7;
    } else {
      const right = a.x + a.w, gutter = right + 26 + index % 5 * 10;
      d = `M ${num(right)} ${num(ay)} C ${num(gutter)} ${num(ay)}, ${num(gutter)} ${num(by)}, ${num(right)} ${num(by)}`;
      lx = gutter; ly = (ay + by) / 2 - 7;
    }
    edges += `<g class="edge-container${primary ? ' is-primary' : ''}" data-edge="${index}">${path(d, primary)}${edgeLabel(wrap(edge.label, 20, 2), lx, ly)}<title>${esc(edge.label || `${edge.from} → ${edge.to}`)}</title></g>`;
  });
  return { width: Math.max(500, width), height: Math.max(270, y + 15), body: groups.join('') + edges + [...boxes].map(([i, box]) => nodeBox(ctx, i, box, structured)).join('') };
}
function sequenceLayout(ctx) {
  const step = W + 54, boxes = new Map(), participants = ctx.buckets.flatMap(b => b.nodes);
  const top = 124, headerHeight = Math.max(100, ...ctx.spec.nodes.map(n => nodeMetrics(n).height));
  const events = ctx.spec.edges.map(e => ({ edge: e, lines: wrap(e.label || e.description || '消息', 29, 3) }));
  let eventY = top + headerHeight + 64;
  const eventRows = events.map(event => { const row = { ...event, y: eventY }; eventY += Math.max(70, event.lines.length * 19 + 38); return row; });
  const width = Math.max(560, participants.length * step + 90), height = Math.max(380, eventY + 46);
  participants.forEach((i, pos) => boxes.set(i, { x: 48 + pos * step, y: top, w: W, h: headerHeight }));
  let body = '', column = 0;
  ctx.buckets.forEach(bucket => { body += boundary(bucket, 32 + column * step, 70, bucket.nodes.length * step - 12, height - 104, true); column += bucket.nodes.length; });
  for (const [i, box] of boxes) body += `<path class="lifeline" d="M ${num(box.x + box.w / 2)} ${num(box.y + box.h)} V ${num(height - 40)}"/>`;
  eventRows.forEach(({ edge, lines, y }, index) => {
    const a = boxes.get(ctx.nodeIndex.get(edge.from)), b = boxes.get(ctx.nodeIndex.get(edge.to));
    if (!a || !b) return;
    const primary = ctx.primaryEdge(edge), ax = a.x + a.w / 2, bx = b.x + b.w / 2;
    let d = `M ${num(ax)} ${num(y)} H ${num(bx)}`, lx = (ax + bx) / 2;
    if (ax === bx) { d = `M ${num(ax)} ${num(y)} h 84 v 28 h -84`; lx = ax + 88; }
    body += `<g class="edge-container${primary ? ' is-primary' : ''}" data-edge="${index}"><text class="event-number" x="15" y="${num(y + 4)}">${index + 1}</text>${path(d, primary)}${edgeLabel(lines, lx, y - lines.length * 17 - 3)}<title>${esc(edge.description || edge.label)}</title></g>`;
  });
  body += [...boxes].map(([i, box]) => nodeBox(ctx, i, box)).join('');
  if (!events.length) body += textLines(['尚未定义事件：为参与者添加边即可展示消息顺序。'], 48, top + headerHeight + 70, 'canvas-note');
  return { width, height, body };
}
function tickText(value, span) {
  const magnitude = Math.abs(value), range = Math.abs(span) || 1;
  if (magnitude >= 1e15 || (magnitude > 0 && magnitude < .0001)) {
    const precision = Math.max(2, Math.min(15, Math.ceil(Math.log10(magnitude) - Math.log10(range)) + 2));
    return value.toExponential(Number.isFinite(precision) ? precision : 2);
  }
  return String(Number(value.toFixed(Math.max(0, Math.min(15, 2 - Math.floor(Math.log10(range)))))));
}
function timeLayout(ctx) {
  const ordered = ctx.buckets.flatMap(b => b.nodes);
  const spans = new Map(ordered.map((i, order) => { const n = ctx.spec.nodes[i], start = Number.isFinite(n.start) ? n.start : order, end = Number.isFinite(n.end) ? n.end : start + 1; return [i, { start, end, lo: Math.min(start, end), hi: Math.max(start, end) }]; }));
  let min = spans.size ? Math.min(...[...spans.values()].map(s => s.lo)) : 0;
  let max = spans.size ? Math.max(...[...spans.values()].map(s => s.hi)) : 1;
  if (min === max) { const padding = Math.max(1, Math.abs(min) * .01); min -= padding; max += padding; }
  const domain = max - min, divisor = Math.max(Math.abs(min), Math.abs(max), 1);
  const normalizedDomain = max / divisor - min / divisor;
  const scale = t => 340 + (Number.isFinite(domain) ? (t - min) / domain : (t / divisor - min / divisor) / normalizedDomain) * 1200;
  const width = 1600, boxes = new Map(), bands = [];
  let y = 134;
  ctx.buckets.forEach(bucket => {
    const startY = y; y += bucket.id === null ? 10 : 46;
    bucket.nodes.forEach(i => { const h = Math.max(66, wrap(ctx.spec.nodes[i].label, 17, 4).length * 18 + 22); boxes.set(i, { y, h }); y += h + 13; });
    bands.push(boundary(bucket, 30, startY, width - 60, y - startY + 4)); y += 26;
  });
  const height = Math.max(330, y + 45);
  let body = bands.join('') + `<text class="canvas-note" x="340" y="80">数值刻度（单位由规格定义）</text>`;
  for (let i = 0; i <= 8; i++) {
    const fraction = i / 8, value = min * (1 - fraction) + max * fraction, x = 340 + i * 150;
    body += `<path class="time-grid" d="M ${x} 114 V ${height - 48}"/>${textLines([tickText(value, domain)], x, 105, 'tick-label', 18, 'middle')}`;
  }
  ctx.spec.edges.forEach((edge, index) => {
    const ai = ctx.nodeIndex.get(edge.from), bi = ctx.nodeIndex.get(edge.to), a = boxes.get(ai), b = boxes.get(bi);
    if (!a || !b) return;
    const ax = scale(spans.get(ai).end), bx = scale(spans.get(bi).start), ay = a.y + a.h / 2, by = b.y + b.h / 2, primary = ctx.primaryEdge(edge);
    const bend = Math.max(ax, bx) + 22 + index % 4 * 7;
    const d = ai === bi ? `M ${num(ax)} ${num(ay)} c 55 -38 55 38 0 12` : `M ${num(ax)} ${num(ay)} C ${num(bend)} ${num(ay)}, ${num(bend)} ${num(by)}, ${num(bx)} ${num(by)}`;
    body += `<g class="edge-container time-dependency${primary ? ' is-primary' : ''}" data-edge="${index}">${path(d, primary)}<title>${esc(edge.label)}</title></g>`;
  });
  for (const [index, box] of boxes) {
    const n = ctx.spec.nodes[index], s = spans.get(index), x = scale(s.lo), w = Math.max(12, scale(s.hi) - x), mid = box.y + box.h / 2, primary = ctx.main.has(n.id);
    const milestone = s.lo === s.hi;
    const shape = milestone ? `<path class="time-bar" d="M ${num(x)} ${num(mid - 13)} l 13 13 -13 13 -13 -13 Z"/>` : `<rect class="time-bar" x="${num(x)}" y="${num(mid - 16)}" width="${num(w)}" height="32" rx="6"/>`;
    const hint = `${tickText(s.start, domain)} → ${tickText(s.end, domain)}`;
    body += `<g class="node timeline-node kind-${Object.hasOwn(KINDS, n.kind) ? n.kind : 'component'}${primary ? ' is-primary' : ''}" data-node="${index}" tabindex="0" role="button" aria-label="${esc(n.label)}，${esc(hint)}，查看详情"><rect class="time-row" x="46" y="${num(box.y)}" width="1508" height="${num(box.h)}" rx="7"/>${textLines(wrap(n.label, 17, 4), 57, box.y + 24)}${shape}${textLines([hint], Math.min(1510, Math.max(360, x + w / 2)), mid - 23, 'time-range', 17, 'middle')}<title>${esc(n.label)}：${esc(hint)}</title></g>`;
  }
  return { width, height, body };
}
const SVG_STYLE = `
svg{--bg:#f7f9fd;--surface:#fff;--ink:#18283e;--muted:#596a81;--line:#ccd6e4;--edge:#72859e;--primary:#1465d9;--primary-bg:#edf4ff;--group:#eef3fa;--trust:#a16618;--shadow:#0e234010;--match:#d89608;background:var(--bg);color:var(--ink);font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
@media(prefers-color-scheme:dark){svg:not(.theme-light){--bg:#111925;--surface:#1c2839;--ink:#e5ecf7;--muted:#a5b4c9;--line:#3e506b;--edge:#92a6c1;--primary:#77afff;--primary-bg:#172e4c;--group:#182233;--trust:#eebd70;--shadow:#0002;--match:#ffc35c}}
svg.theme-dark{--bg:#111925;--surface:#1c2839;--ink:#e5ecf7;--muted:#a5b4c9;--line:#3e506b;--edge:#92a6c1;--primary:#77afff;--primary-bg:#172e4c;--group:#182233;--trust:#eebd70;--shadow:#0002;--match:#ffc35c}
.canvas-title{fill:var(--ink);font-size:23px;font-weight:720}.canvas-note,.tick-label{fill:var(--muted);font-size:13px}.group-boundary{fill:var(--group);fill-opacity:.6;stroke:var(--line);stroke-width:1.3}.trust-boundary .group-boundary{stroke:var(--trust);stroke-width:1.7;stroke-dasharray:8 5}.group-label{fill:var(--muted);font-size:13px;font-weight:650}.trust-boundary .group-label{fill:var(--trust)}
.node{cursor:pointer;outline:none}.node-surface{fill:var(--surface);stroke:var(--line);stroke-width:1.4;filter:drop-shadow(0 3px 4px var(--shadow))}.node-accent{fill:var(--primary)}.kind-external .node-surface{stroke-dasharray:6 4}.kind-store .node-accent{fill:#8d66c5}.kind-actor .node-accent{fill:#228775}.kind-label{fill:var(--muted);font-size:11px;letter-spacing:.6px}.node-label{fill:var(--ink);font-size:15px;font-weight:650}.node-description{fill:var(--muted);font-size:12px}.detail-row{fill:var(--ink);font-size:12px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.row-divider{stroke:var(--line);stroke-width:.7}
.edge-path{fill:none;stroke:var(--edge);stroke-width:1.55;stroke-linejoin:round}.edge-container.is-primary .edge-path{stroke:var(--primary);stroke-width:2.7}.edge-label rect{fill:var(--surface);fill-opacity:.94;stroke:var(--line);stroke-width:.5}.edge-text{fill:var(--muted);font-size:12px}.is-primary .edge-text{fill:var(--primary)}.arrow{fill:var(--edge)}.primary-arrow{fill:var(--primary)}.lifeline{stroke:var(--line);stroke-width:1.4;stroke-dasharray:6 5}.event-number{fill:var(--muted);font-size:11px}
.time-grid{stroke:var(--line);stroke-dasharray:3 6;stroke-width:.8}.time-row{fill:transparent;stroke:transparent}.time-bar{fill:var(--primary-bg);stroke:var(--primary);stroke-width:1.6}.kind-store .time-bar{stroke:#8d66c5}.kind-actor .time-bar{stroke:#228775}.time-range{fill:var(--muted);font-size:11px}.time-dependency .edge-path{stroke-opacity:.55}
.node:hover .node-surface,.node:focus .node-surface,.node.is-selected .node-surface{stroke:var(--primary);stroke-width:3}.node.is-selected .time-row,.timeline-node:focus .time-row,.timeline-node:hover .time-row{stroke:var(--primary);stroke-width:2}.node.is-match .node-surface,.node.is-match .time-row{stroke:var(--match);stroke-width:3}.node.is-dim{opacity:.25}.only-primary .edge-container:not(.is-primary){display:none}.only-primary .node:not(.is-primary){opacity:.22}.node.is-selected{opacity:1!important}.empty-label{fill:var(--muted);font-size:17px}
`;

export function renderSvg(spec) {
  const ctx = context(spec);
  const layout = !spec.nodes.length ? { width: 720, height: 300, body: textLines(['暂无节点，请在图谱数据中添加组件或参与者。'], 50, 155, 'empty-label') } : spec.type === 'sequence' ? sequenceLayout(ctx) : spec.type === 'timeline' || spec.type === 'waterfall' ? timeLayout(ctx) : graphLayout(ctx);
  const title = wrap(spec.title, Math.max(20, Math.floor(layout.width / 24)), 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${num(layout.width)}" height="${num(layout.height)}" viewBox="0 0 ${num(layout.width)} ${num(layout.height)}" role="img" aria-labelledby="dsha-svg-title dsha-svg-description" data-diagram-type="${esc(spec.type)}"><title id="dsha-svg-title">${esc(spec.title)} · ${esc(TYPES[spec.type] || '图谱')}</title><desc id="dsha-svg-description">${esc(spec.description)}；${spec.nodes.length} 个节点，${spec.edges.length} 条边。节点支持查看详情。</desc><style>${SVG_STYLE}</style><defs><marker id="dsha-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="userSpaceOnUse"><path class="arrow" d="M 0 0 L 9 4.5 L 0 9 Z"/></marker><marker id="dsha-primary-arrow" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto" markerUnits="userSpaceOnUse"><path class="primary-arrow" d="M 0 0 L 10 5 L 0 10 Z"/></marker></defs>${textLines(title, 36, 37, 'canvas-title', 25)}${layout.body}<text class="canvas-note" x="36" y="${num(layout.height - 16)}">${esc(TYPES[spec.type] || '图谱')} · ${spec.nodes.length} 节点 / ${spec.edges.length} 边 · 蓝色为主链路 · 虚线框为信任边界</text></svg>`;
}

export function renderHtml(spec) {
  const css = readFileSync(new URL('../assets/viewer.css', import.meta.url), 'utf8');
  const js = readFileSync(new URL('../assets/viewer.js', import.meta.url), 'utf8');
  const svg = renderSvg(spec);
  const notes = spec.notes.length ? `<section class="notes" aria-labelledby="notes-heading"><h2 id="notes-heading">图谱备注</h2><ul>${spec.notes.map(note => `<li>${esc(note)}</li>`).join('')}</ul></section>` : '';
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><title>${esc(spec.title)} · 独立架构图谱</title><style>${css}</style></head>
<body><a class="skip-link" href="#graph-stage">跳到图谱</a><header class="page-header"><div class="heading"><p class="eyebrow">独立离线图谱 · ${esc(TYPES[spec.type] || '图谱')}</p><h1>${esc(spec.title)}</h1><p class="description">${esc(spec.description || '从整体关系到节点证据，逐层阅读这份图谱。')}</p></div><div class="header-actions"><button id="theme-toggle" type="button" aria-label="切换深浅色">切换主题</button><button id="help-open" type="button">快捷键</button><button id="download-svg" type="button">下载 SVG</button><button id="download-json" type="button">下载 JSON</button></div></header>
<main class="workspace"><section class="diagram-pane" aria-label="交互图谱"><div class="toolbar"><label class="search-box"><span>搜索节点</span><input id="node-search" type="search" placeholder="名称、描述、字段或证据" autocomplete="off" maxlength="500" aria-controls="search-results"></label><label class="switch"><input id="primary-toggle" type="checkbox"><span>只看主链路</span></label><div class="zoom-controls"><button id="zoom-out" type="button" aria-label="缩小">−</button><output id="zoom-value" aria-label="缩放比例">100%</output><button id="zoom-in" type="button" aria-label="放大">＋</button><button id="fit-view" type="button">适应</button></div></div><p class="guide">点击节点查看详情；拖动空白处平移，滚轮或双指缩放。先用「适应」查看全图，再搜索定位。</p><div id="graph-stage" class="graph-stage" tabindex="0" aria-label="图谱画布，方向键平移，加减号缩放，数字0适应"><div id="graph-transform" class="graph-transform">${svg}</div><div id="empty-overlay" class="empty-overlay"${spec.nodes.length ? ' hidden' : ''}>图谱还没有节点。添加节点与关系后重新生成即可。</div></div><footer class="canvas-footer"><span>${spec.nodes.length} 个节点 · ${spec.edges.length} 条边</span><span>蓝色主链路 · 虚线信任边界</span><span id="viewer-status" role="status" aria-live="polite">独立离线文件；没有网络请求。</span></footer></section>
<aside class="detail-pane" aria-label="节点导航与详情"><section class="navigation"><div class="section-heading"><h2 id="results-heading">节点导航</h2><span id="result-count">${spec.nodes.length}</span></div><p id="search-feedback" class="subtle">搜索会高亮匹配节点；点击列表项可定位。</p><div id="search-results" class="search-results" aria-labelledby="results-heading"></div></section><section id="node-detail" class="detail-card" aria-label="节点详情"><div class="detail-heading"><h2 id="detail-title">选择一个节点</h2><button id="detail-close" type="button" aria-label="清除节点选择" hidden>×</button></div><div id="detail-content"><p class="subtle">从图中或节点导航选择一个节点，即可查看说明、字段/方法、连接关系与证据。</p><p class="subtle">证据路径仅作文字展示；这里不会打开文件或执行链接。</p></div></section>${notes}<section class="offline-note"><h2>离线阅读</h2><p>图、样式、脚本与数据均在此文件中。下载 SVG 用于文档排版，下载 JSON 用于复用与审阅。</p></section></aside></main>
<dialog id="help-dialog" aria-labelledby="help-title"><div class="dialog-heading"><h2 id="help-title">操作与快捷键</h2><button id="help-close" type="button" aria-label="关闭帮助">×</button></div><dl><dt>鼠标 / 触屏</dt><dd>拖动空白处平移；滚轮 / 双指缩放；点击节点查看详情。</dd><dt>图谱画布获得焦点时</dt><dd>方向键平移；+ / − 缩放；0 或 F 适应全图。</dd><dt>/</dt><dd>聚焦搜索框。</dd><dt>Tab、Enter、空格</dt><dd>通过键盘选择节点与操作按钮。</dd><dt>Escape</dt><dd>关闭帮助、清除搜索或关闭节点详情。</dd></dl><p class="subtle">小屏幕上，节点详情显示在图谱下方。时间线采用输入数值，不推断日期单位。</p></dialog>
<script id="architecture-spec" type="application/json">${safeJSON(spec)}</script><script>${js.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
}
export default { renderSvg, renderHtml };
