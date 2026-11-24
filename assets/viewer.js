/* Original standalone viewer. No library, request, dynamic code evaluation, or HTML injection. */
(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const status = byId('viewer-status');
  const announce = message => { status.textContent = message; };
  let spec;
  try { spec = JSON.parse(byId('architecture-spec').textContent); }
  catch { announce('图谱数据读取失败，请重新生成此文件。'); return; }
  const stage = byId('graph-stage');
  const transform = byId('graph-transform');
  const svg = transform.querySelector('svg');
  if (!svg) { announce('缺少图谱图像，请重新生成此文件。'); return; }
  const search = byId('node-search');
  const primaryToggle = byId('primary-toggle');
  const help = byId('help-dialog');
  const nodeElements = Array.from(svg.querySelectorAll('[data-node]'));
  const nodeMap = new Map(nodeElements.map(element => [Number(element.getAttribute('data-node')), element]));
  svg.setAttribute('role', 'group');
  const width = Number(svg.getAttribute('width')) || 720;
  const height = Number(svg.getAttribute('height')) || 400;
  const nodeIndices = new Map(spec.nodes.map((node, index) => [node.id, index]));
  const kindNames = { component: '组件', actor: '参与者', external: '外部系统', store: '数据存储' };
  const primaryIds = new Set(spec.primaryPath);
  const primaryPairs = new Set(spec.primaryPath.slice(1).map((id, i) => `${nodeIndices.get(spec.primaryPath[i])}:${nodeIndices.get(id)}`));
  const edgeIsPrimary = edge => edge.primary || primaryPairs.has(`${nodeIndices.get(edge.from)}:${nodeIndices.get(edge.to)}`);
  spec.edges.forEach(edge => { if (edgeIsPrimary(edge)) { primaryIds.add(edge.from); primaryIds.add(edge.to); } });
  if (primaryIds.size === 0) {
    primaryToggle.disabled = true;
    primaryToggle.setAttribute('aria-label', '未定义主链路：在规格中设置 primaryPath 或 primary 边');
    const label = primaryToggle.closest('label');
    if (label) {
      label.title = '此图未定义主链路；可在规格中设置 primaryPath 或 primary 边。';
      label.querySelector('span').textContent = '未定义主链路';
    }
  }
  const searchable = spec.nodes.map(node => [node.id, node.label, node.description, node.group || '', ...node.details, ...node.evidence.map(e => `${e.path} ${e.line ?? ''} ${e.note}`)].join('\n').toLocaleLowerCase());
  let selected = null, scale = 1, tx = 0, ty = 0, fitScale = 1;
  let drag = null, pinch = null, moved = false;
  const pointers = new Map();
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  transform.style.width = `${width}px`;
  transform.style.height = `${height}px`;
  function updateTransform() {
    transform.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    byId('zoom-value').textContent = scale < .01 ? `${(scale * 100).toFixed(2)}%` : `${Math.round(scale * 100)}%`;
  }
  function fit(quiet = false) {
    const bounds = stage.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    fitScale = Math.min((bounds.width - 32) / width, (bounds.height - 32) / height, 1.2);
    scale = Math.max(.0001, fitScale);
    tx = (bounds.width - width * scale) / 2;
    ty = (bounds.height - height * scale) / 2;
    updateTransform();
    if (!quiet) announce('已适应全图。可继续放大或搜索节点。');
  }
  function zoom(factor, x = stage.clientWidth / 2, y = stage.clientHeight / 2) {
    const next = clamp(scale * factor, Math.min(.0001, fitScale / 4), 5);
    tx = x - (x - tx) * next / scale;
    ty = y - (y - ty) * next / scale;
    scale = next;
    updateTransform();
  }
  function locate(index) {
    const element = nodeMap.get(index);
    if (!element) return;
    // getBBox is a browser SVG API used only by the actual delivered viewer.
    const local = element.getBBox();
    const matrix = element.transform.baseVal.consolidate();
    const x = local.x + (matrix ? matrix.matrix.e : 0), y = local.y + (matrix ? matrix.matrix.f : 0);
    scale = clamp(Math.min(stage.clientWidth / (local.width + 140), stage.clientHeight / (local.height + 160)), .15, 1.4);
    tx = stage.clientWidth / 2 - (x + local.width / 2) * scale;
    ty = stage.clientHeight / 2 - (y + local.height / 2) * scale;
    updateTransform();
  }
  function element(tag, text, className) {
    const e = document.createElement(tag);
    if (text !== undefined) e.textContent = String(text);
    if (className) e.className = className;
    return e;
  }
  function section(parent, heading) {
    const block = element('section', undefined, 'detail-section');
    block.append(element('h3', heading));
    parent.append(block);
    return block;
  }
  function clearSelection(quiet = false) {
    selected = null;
    nodeElements.forEach(e => { e.classList.remove('is-selected'); e.setAttribute('aria-pressed', 'false'); });
    byId('detail-title').textContent = '选择一个节点';
    byId('detail-close').hidden = true;
    const content = byId('detail-content');
    content.replaceChildren(element('p', '从图中或节点导航选择一个节点，查看说明、字段/方法、连接关系与证据。', 'subtle'));
    byId('search-results').querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', 'false'));
    if (!quiet) announce('已清除节点选择。');
  }
  function selectNode(index, center = false, revealDetail = false) {
    const node = spec.nodes[index];
    if (!node) return;
    selected = index;
    nodeElements.forEach(e => { const active = Number(e.getAttribute('data-node')) === index; e.classList.toggle('is-selected', active); e.setAttribute('aria-pressed', String(active)); });
    byId('search-results').querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.index) === index)));
    byId('detail-title').textContent = node.label;
    byId('detail-close').hidden = false;
    const content = byId('detail-content');
    content.replaceChildren();
    const badges = element('div', undefined, 'badges');
    badges.append(element('span', kindNames[node.kind] || '组件', 'badge'));
    const group = spec.groups.find(g => g.id === node.group);
    if (group) badges.append(element('span', group.label + (group.trustBoundary ? ' · 信任边界' : ''), 'badge'));
    if (primaryIds.has(node.id)) badges.append(element('span', '主链路节点', 'badge primary-badge'));
    content.append(badges);
    const identity = section(content, '节点标识');
    identity.append(element('code', node.id));
    const description = section(content, '说明');
    description.append(element('p', node.description || '暂无补充说明。', 'preserve-lines'));
    if (Number.isFinite(node.start) || Number.isFinite(node.end)) {
      const timing = section(content, '数值区间');
      timing.append(element('p', `开始：${Number.isFinite(node.start) ? node.start : '未指定'}；结束：${Number.isFinite(node.end) ? node.end : '未指定'}`));
    }
    if (node.details.length) {
      const details = section(content, spec.type === 'erd' ? '表字段' : spec.type === 'class' ? '字段 / 方法' : '详细信息');
      const list = element('ul', undefined, 'detail-list');
      node.details.forEach(value => list.append(element('li', value, 'preserve-lines')));
      details.append(list);
    }
    const connections = spec.edges.filter(edge => edge.from === node.id || edge.to === node.id);
    const relation = section(content, `连接关系（${connections.length}）`);
    if (!connections.length) relation.append(element('p', '此节点尚无连接关系。', 'subtle'));
    else {
      const list = element('ul', undefined, 'connection-list');
      connections.forEach(edge => {
        const from = spec.nodes[nodeIndices.get(edge.from)], to = spec.nodes[nodeIndices.get(edge.to)];
        const item = element('li');
        item.append(element('p', `${from ? from.label : edge.from} → ${to ? to.label : edge.to}`, 'connection-name'));
        if (edge.label) item.append(element('p', edge.label));
        if (edge.description) item.append(element('p', edge.description, 'subtle preserve-lines'));
        if (edgeIsPrimary(edge)) item.append(element('span', '主链路', 'badge primary-badge'));
        const other = edge.from === node.id ? nodeIndices.get(edge.to) : nodeIndices.get(edge.from);
        if (other !== undefined && other !== index) {
          const button = element('button', '定位关联节点', 'text-button');
          button.type = 'button';
          button.addEventListener('click', () => selectNode(other, true));
          item.append(button);
        }
        list.append(item);
      });
      relation.append(list);
    }
    const evidence = section(content, `证据（${node.evidence.length}）`);
    if (!node.evidence.length) evidence.append(element('p', '暂无证据记录。', 'subtle'));
    else {
      const list = element('ul', undefined, 'evidence-list');
      node.evidence.forEach(record => {
        const item = element('li');
        item.append(element('code', record.path + (Number.isFinite(record.line) ? `:${record.line}` : '')));
        if (record.note) item.append(element('p', record.note, 'preserve-lines'));
        list.append(item);
      });
      evidence.append(list);
    }
    if (center) locate(index);
    announce(`已选择「${node.label}」，详情已更新。`);
    if (revealDetail && window.matchMedia('(max-width: 900px)').matches) byId('node-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function renderResults() {
    const query = search.value.trim().toLocaleLowerCase();
    const results = byId('search-results');
    const matches = [];
    spec.nodes.forEach((node, index) => {
      const visible = (!query || searchable[index].includes(query)) && (!primaryToggle.checked || primaryIds.has(node.id));
      if (visible) matches.push(index);
      const graphic = nodeMap.get(index);
      if (graphic) { graphic.classList.toggle('is-match', Boolean(query) && visible); graphic.classList.toggle('is-dim', Boolean(query) && !visible); }
    });
    results.replaceChildren();
    matches.forEach(index => {
      const node = spec.nodes[index], button = element('button', undefined, 'node-result');
      button.type = 'button'; button.dataset.index = String(index); button.setAttribute('aria-pressed', String(selected === index));
      button.append(element('span', node.label, 'result-label'), element('span', `${kindNames[node.kind] || '组件'}${primaryIds.has(node.id) ? ' · 主链路' : ''}`, 'result-meta'));
      button.addEventListener('click', () => selectNode(index, true, true));
      results.append(button);
    });
    if (!matches.length) results.append(element('p', spec.nodes.length ? '没有匹配节点。尝试缩短关键词，或关闭主链路筛选。' : '图谱尚无节点。', 'subtle empty-results'));
    byId('result-count').textContent = `${matches.length} / ${spec.nodes.length}`;
    byId('search-feedback').textContent = query ? `找到 ${matches.length} 个节点；点击结果定位。` : primaryToggle.checked ? '当前仅列出主链路节点；其他节点在图中淡化显示。' : '搜索会高亮匹配节点；点击列表项可定位。';
  }
  search.addEventListener('input', renderResults);
  primaryToggle.addEventListener('change', () => {
    svg.classList.toggle('only-primary', primaryToggle.checked);
    renderResults();
    announce(primaryToggle.checked ? '已显示主链路，其他节点淡化；选中节点仍保持清晰。' : '已恢复全部关系。');
  });
  byId('zoom-in').addEventListener('click', () => zoom(1.25));
  byId('zoom-out').addEventListener('click', () => zoom(.8));
  byId('fit-view').addEventListener('click', () => fit());
  byId('detail-close').addEventListener('click', () => clearSelection());
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
  let manualTheme = false;
  function applyTheme(dark) {
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.classList.toggle('light', !dark);
    svg.classList.toggle('theme-dark', dark);
    svg.classList.toggle('theme-light', !dark);
    const button = byId('theme-toggle');
    button.textContent = dark ? '浅色主题' : '深色主题';
    button.setAttribute('aria-label', dark ? '切换到浅色主题' : '切换到深色主题');
  }
  applyTheme(systemDark.matches);
  if (systemDark.addEventListener) systemDark.addEventListener('change', e => { if (!manualTheme) applyTheme(e.matches); });
  byId('theme-toggle').addEventListener('click', () => { manualTheme = true; applyTheme(!document.documentElement.classList.contains('dark')); });
  const filename = spec.title.replace(/[\u0000-\u001f<>:"/\\|?*\u007f]/g, '-').replace(/^\.+|\.+$/g, '').slice(0, 80).trim() || 'architecture';
  function download(content, mime, extension) {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const link = element('a');
    link.href = url; link.download = `${filename}.${extension}`;
    document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
    announce(`已准备 ${extension.toUpperCase()} 下载。${extension === 'svg' && primaryToggle.checked ? '保留当前主链路筛选。' : ''}`);
  }
  byId('download-json').addEventListener('click', () => download(JSON.stringify(spec, null, 2), 'application/json;charset=utf-8', 'json'));
  byId('download-svg').addEventListener('click', () => {
    const copy = svg.cloneNode(true);
    copy.setAttribute('role', 'img');
    copy.querySelectorAll('.is-selected,.is-match,.is-dim').forEach(e => e.classList.remove('is-selected', 'is-match', 'is-dim'));
    copy.querySelectorAll('[tabindex]').forEach(e => { e.removeAttribute('tabindex'); e.removeAttribute('aria-pressed'); e.removeAttribute('role'); });
    download(`<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(copy)}`, 'image/svg+xml;charset=utf-8', 'svg');
  });
  stage.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = stage.getBoundingClientRect();
    const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? stage.clientHeight : 1);
    zoom(Math.exp(-clamp(delta, -160, 160) * .002), e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });
  function point(e) { const rect = stage.getBoundingClientRect(); return { x: e.clientX - rect.left, y: e.clientY - rect.top }; }
  function startPinch() {
    const [a, b] = [...pointers.values()];
    pinch = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), scale, tx, ty, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  stage.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers.set(e.pointerId, point(e));
    stage.setPointerCapture(e.pointerId);
    if (pointers.size === 1) {
      const p = point(e), target = e.target instanceof Element ? e.target.closest('[data-node]') : null;
      drag = { x: p.x, y: p.y, tx, ty, node: target ? Number(target.getAttribute('data-node')) : null };
      moved = false;
    } else { startPinch(); moved = true; }
    stage.classList.add('is-panning');
  });
  stage.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, point(e));
    if (pointers.size >= 2 && pinch) {
      const [a, b] = [...pointers.values()], x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
      const next = clamp(pinch.scale * Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance, Math.min(.0001, fitScale / 4), 5);
      tx = x - (pinch.x - pinch.tx) * next / pinch.scale;
      ty = y - (pinch.y - pinch.ty) * next / pinch.scale;
      scale = next; updateTransform();
    } else if (drag) {
      const p = point(e), dx = p.x - drag.x, dy = p.y - drag.y;
      if (Math.hypot(dx, dy) > 4) moved = true;
      if (moved) { tx = drag.tx + dx; ty = drag.ty + dy; updateTransform(); }
    }
  });
  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    const tappedNode = !moved && drag && drag.node !== null ? drag.node : null;
    pointers.delete(e.pointerId);
    if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
    if (pointers.size >= 2) startPinch();
    else if (pointers.size === 1) {
      const p = [...pointers.values()][0]; drag = { x: p.x, y: p.y, tx, ty, node: null }; pinch = null;
    } else { drag = null; pinch = null; stage.classList.remove('is-panning'); }
    if (e.type === 'pointerup' && tappedNode !== null) selectNode(tappedNode, false, true);
  }
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);
  stage.addEventListener('lostpointercapture', e => { if (pointers.has(e.pointerId)) { pointers.delete(e.pointerId); drag = null; pinch = null; stage.classList.remove('is-panning'); } });
  nodeElements.forEach(e => {
    e.setAttribute('aria-pressed', 'false');
    e.addEventListener('click', event => { if (event.detail === 0) selectNode(Number(e.getAttribute('data-node')), false, true); });
    e.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); selectNode(Number(e.getAttribute('data-node')), false, true); }
    });
  });
  function closeHelp() { if (typeof help.close === 'function' && help.open) help.close(); else help.removeAttribute('open'); byId('help-open').focus(); }
  byId('help-open').addEventListener('click', () => { if (typeof help.showModal === 'function') help.showModal(); else { help.setAttribute('open', ''); byId('help-close').focus(); } });
  byId('help-close').addEventListener('click', () => { if (typeof help.close === 'function') closeHelp(); else { help.removeAttribute('open'); byId('help-open').focus(); } });
  help.addEventListener('click', event => { if (event.target === help) { const r = help.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeHelp(); } });
  document.addEventListener('keydown', e => {
    const typing = e.target instanceof Element && (e.target.matches('input,textarea,select') || e.target.closest('[contenteditable="true"]'));
    if (e.key === 'Escape') {
      if (help.open) { e.preventDefault(); closeHelp(); }
      else if (search.value) { e.preventDefault(); search.value = ''; renderResults(); announce('已清除搜索。'); }
      else if (selected !== null) { e.preventDefault(); clearSelection(); }
      return;
    }
    if (!typing && !help.open && e.key === '/') { e.preventDefault(); search.focus(); return; }
    if (typing || help.open || !stage.contains(document.activeElement)) return;
    const moves = { ArrowLeft: [70, 0], ArrowRight: [-70, 0], ArrowUp: [0, 70], ArrowDown: [0, -70] };
    if (moves[e.key]) { e.preventDefault(); tx += moves[e.key][0]; ty += moves[e.key][1]; updateTransform(); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoom(1.25); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoom(.8); }
    else if (e.key === '0' || e.key.toLowerCase() === 'f') { e.preventDefault(); fit(); }
  });
  let resizeFrame = 0;
  const resize = () => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(() => fit(true)); };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(stage);
  else window.addEventListener('resize', resize);
  renderResults();
  requestAnimationFrame(() => fit(true));
})();
