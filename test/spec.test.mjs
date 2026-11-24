import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { validateSpec, parseSpec, compareSpecs, TYPES, SpecError } from '../lib/spec.mjs'

const minimal = () => ({ schemaVersion: 1, title: '测试图', nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ id: 'ab', from: 'a', to: 'b' }], primaryPath: ['a', 'b'] })
test('defaults, primary paths and original input are preserved', () => {
  const input = minimal(); const spec = validateSpec(input)
  assert.equal(spec.type, 'architecture'); assert.equal(spec.nodes[0].label, 'a')
  assert.equal(spec.nodes[0].kind, 'component'); assert.deepEqual(spec.nodes[0].evidence, [])
  assert.equal(spec.edges[0].primary, true); assert.equal(input.edges[0].primary, undefined)
  assert.notEqual(spec.nodes, input.nodes)
})
test('bundled example is valid', async () => {
  const spec = parseSpec(await readFile(new URL('../examples/plugin-flow.spec.json', import.meta.url), 'utf8'))
  assert.equal(spec.nodes.length, 8); assert.equal(spec.groups.length, 3)
})
for (const type of TYPES) test(`type ${type} accepted`, () => {
  const input = minimal(); input.type = type
  if (['timeline', 'waterfall'].includes(type)) for (const n of input.nodes) { n.start = 0; n.end = 1 }
  assert.equal(validateSpec(input).type, type)
})
const invalidCases = [
  ['wrong version', i => { i.schemaVersion = 2 }],
  ['empty title', i => { i.title = ' ' }],
  ['wrong title type', i => { i.title = 8 }],
  ['unknown root key', i => { i.typo = 'x' }],
  ['unknown node key', i => { i.nodes[0].typo = 'x' }],
  ['duplicate node', i => { i.nodes[1].id = 'a' }],
  ['invalid id', i => { i.nodes[0].id = '<x>' }],
  ['missing endpoint', i => { i.edges[0].to = 'missing' }],
  ['missing group', i => { i.nodes[0].group = 'missing' }],
  ['duplicate edge', i => { i.edges.push({ ...i.edges[0] }) }],
  ['primary path not connected', i => { i.primaryPath = ['b', 'a'] }],
  ['duplicate path entry', i => { i.primaryPath = ['a', 'b', 'a'] }],
  ['boolean string', i => { i.edges[0].primary = 'true' }],
  ['unknown kind', i => { i.nodes[0].kind = 'script' }],
  ['invalid evidence line', i => { i.nodes[0].evidence = [{ path: 'src/a.js', line: 0 }] }],
  ['empty evidence', i => { i.nodes[0].evidence = [{}] }],
  ['unknown notes type', i => { i.notes = [4] }],
  ['wrong description type', i => { i.description = {} }],
  ['invalid XML control', i => { i.nodes[0].label = 'bad\u0000' }],
  ['isolated surrogate', i => { i.nodes[0].label = String.fromCharCode(0xd800) }],
  ['timeline missing range', i => { i.type = 'timeline' }],
  ['negative span', i => { i.type = 'waterfall'; i.nodes.forEach(n => { n.start = 2; n.end = 1 }) }],
  ['NaN value', i => { i.nodes[0].start = NaN }],
  ['Infinity value', i => { i.nodes[0].start = Infinity }],
  ['too many nodes', i => { i.nodes = Array.from({ length: 121 }, (_, n) => ({ id: `n${n}` })) }],
  ['too many edges', i => { i.edges = Array.from({ length: 401 }, (_, n) => ({ id: `e${n}`, from: 'a', to: 'b' })) }],
]
for (const [name, change] of invalidCases) test(`reject ${name}`, () => {
  const input = minimal(); change(input); assert.throws(() => validateSpec(input), SpecError)
})
test('null, arrays, syntax and byte limit rejected', () => {
  assert.throws(() => validateSpec(null), SpecError)
  assert.throws(() => validateSpec([]), SpecError)
  assert.throws(() => parseSpec('{'), /JSON/)
  assert.throws(() => parseSpec(' '.repeat(2 * 1024 * 1024 + 1)), /2 MiB/)
})
test('cycles and self loops are valid outside primaryPath', () => {
  const input = minimal(); input.primaryPath = []
  input.edges.push({ from: 'b', to: 'a' }, { from: 'a', to: 'a' })
  assert.equal(validateSpec(input).edges.length, 3)
})
test('compare stable ids recognizes content and additions/removals', () => {
  const before = validateSpec(minimal()); const next = minimal()
  next.nodes[0].description = 'changed'; next.nodes[1].id = 'c'
  next.edges[0].to = 'c'; next.primaryPath = ['a', 'c']
  const result = compareSpecs(before, validateSpec(next))
  assert.deepEqual(result.nodes, { added: ['c'], removed: ['b'], changed: ['a'] })
  assert.deepEqual(result.edges.changed, ['ab'])
})
test('group-only changes are visible in compare summary', () => {
  const input = minimal(); input.groups = [{ id: 'g', label: 'before', trustBoundary: false }]
  const before = validateSpec(input); input.groups[0].label = 'after'; input.groups[0].trustBoundary = true
  const result = compareSpecs(before, validateSpec(input))
  assert.deepEqual(result.groups.changed, ['g']); assert.match(result.summary, /分组 \+0\/-0\/~1/)
})
