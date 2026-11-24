import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { validateSpec, TYPES } from '../lib/spec.mjs'
import { renderSvg, renderHtml } from '../lib/render.mjs'
import { checkSvgXml, MISSING_PYTHON } from './helpers/xml.mjs'

function fixture(type = 'architecture') {
  return validateSpec({ schemaVersion: 1, type, title: '测试 · 架构', groups: [{ id: 'g', label: '进程', trustBoundary: true }], nodes: [{ id: 'a', label: '入口', group: 'g', details: ['id UUID (PK)', '+ handle()'], start: 170000000000, end: 170000000100, evidence: [{ path: 'src/a.js', line: 1 }] }, { id: 'b', label: '存储', kind: 'store', start: 170000000100, end: 170000000300 }], edges: [{ id: 'ab', from: 'a', to: 'b', label: '调用' }, { id: 'self', from: 'b', to: 'b', label: '自调用' }], primaryPath: ['a', 'b'] })
}
for (const type of TYPES) test(`${type} produces self-contained valid SVG XML and HTML`, t => {
  const spec = fixture(type); const svg = renderSvg(spec); const html = renderHtml(spec)
  assert.match(svg, new RegExp(`data-diagram-type="${type}"`))
  assert.equal((svg.match(/data-node="/g) || []).length, 2)
  assert.equal((svg.match(/data-edge="/g) || []).length, 2)
  assert.ok(!/\b(?:NaN|Infinity|undefined)\b/.test(svg))
  const xml = checkSvgXml(svg)
  if (!xml.available) t.diagnostic(MISSING_PYTHON)
  else assert.equal(xml.status, 0, xml.stderr)
  assert.match(html, /^<!doctype html>/)
  assert.ok(!/<(?:script|link|iframe|img)[^>]+(?:src|href)\s*=/i.test(html))
  assert.match(html, /connect-src 'none'/)
  const data = html.match(/<script id="architecture-spec" type="application\/json">([\s\S]*?)<\/script>/)[1]
  assert.deepEqual(JSON.parse(data), spec)
})
test('untrusted labels, evidence and descriptions are escaped, never script elements', () => {
  const input = fixture(); const evil = '</script><script>globalThis.pwned=1</script><img src=x onerror=alert(1)>&"\u2028\u2029'
  input.title = evil; input.nodes[0].label = evil; input.nodes[0].description = evil
  input.nodes[0].details = [evil]; input.nodes[0].evidence = [{ path: evil, note: evil }]; input.notes = [evil]
  const spec = validateSpec(input); const html = renderHtml(spec), svg = renderSvg(spec)
  assert.ok(!html.includes(evil)); assert.ok(!svg.includes('<script>')); assert.ok(!svg.includes('<img'))
  assert.equal((html.match(/<script(?:\s|>)/g) || []).length, 2)
  const data = html.match(/<script id="architecture-spec" type="application\/json">([\s\S]*?)<\/script>/)[1]
  assert.ok(!/[<>&\u2028\u2029]/.test(data)); assert.deepEqual(JSON.parse(data), spec)
})
test('non-zero epoch spans use their own domain, not a forced zero origin', () => {
  const svg = renderSvg(fixture('timeline'))
  const widths = [...svg.matchAll(/class="time-bar"[^>]*width="([0-9.]+)"/g)].map(m => Number(m[1]))
  assert.equal(widths.length, 2); assert.ok(widths[0] > 300, widths.join(',')); assert.ok(widths[1] > widths[0])
  assert.ok(!svg.includes('补位'))
})
test('cycles, parallel edges, disconnected nodes and Unicode survive rendering', () => {
  const input = fixture(); input.primaryPath = []; input.nodes.push({ id: '孤立', label: '孤立' })
  input.nodes[2].id = 'isolated'; input.nodes[2].label = '孤立节点 😀'
  input.edges.push({ id: 'ba', from: 'b', to: 'a', label: '回调' }, { id: 'ab2', from: 'a', to: 'b', label: '并行' })
  const svg = renderSvg(validateSpec(input)); assert.match(svg, /孤立节点/)
  assert.equal((svg.match(/data-node="/g) || []).length, 3)
  assert.equal((svg.match(/data-edge="/g) || []).length, 4)
})
test('viewer uses local DOM operations, no requests, eval or dynamic HTML', async () => {
  const js = await readFile(new URL('../assets/viewer.js', import.meta.url), 'utf8')
  assert.ok(!/\b(?:fetch|XMLHttpRequest|WebSocket|eval)\s*\(/.test(js))
  assert.ok(!/\.innerHTML\s*=|insertAdjacentHTML|document\.write\s*\(/.test(js))
  assert.match(js, /textContent/); assert.match(js, /Escape/); assert.match(js, /ResizeObserver/)
})
