export const TYPES = Object.freeze(['architecture', 'workflow', 'dataflow', 'tree', 'sequence', 'erd', 'class', 'lifecycle', 'timeline', 'waterfall'])
export const LIMITS = Object.freeze({ nodes: 120, edges: 400, groups: 30, bytes: 2 * 1024 * 1024 })
const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/
const KINDS = ['component', 'actor', 'external', 'store']
const rootKeys = ['schemaVersion', 'title', 'description', 'type', 'nodes', 'edges', 'groups', 'primaryPath', 'notes']
export class SpecError extends Error {
  constructor(issues) { super(issues.join('\n')); this.name = 'SpecError'; this.issues = issues }
}
export function validateSpec(input) {
  const issues = []
  const problem = (p, msg) => issues.push(`${p}: ${msg}`)
  function object(value, path, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) { problem(path, '须为对象'); return {} }
    for (const k of Object.keys(value)) if (!keys.includes(k)) problem(`${path}.${k}`, '未知字段')
    return value
  }
  function text(value, path, fallback = '', max = 4000) {
    if (value === undefined) return fallback
    if (typeof value !== 'string') { problem(path, '须为字符串'); return fallback }
    if (value.length > max) problem(path, `最多 ${max} 字符`)
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/u.test(value)) problem(path, '包含 XML 不接受的控制字符或孤立代理码位')
    return value
  }
  function identifier(value, path) {
    const v = text(value, path, '', 80)
    if (!ID.test(v)) problem(path, '标识符须以字母或数字开头，仅含字母、数字、_、.、-')
    return v
  }
  function array(value, path, max, required = false) {
    if (value === undefined && !required) return []
    if (!Array.isArray(value)) { problem(path, '须为数组'); return [] }
    if (value.length > max) problem(path, `最多 ${max} 项`)
    return value.slice(0, max)
  }
  function boolean(value, path, fallback = false) {
    if (value === undefined) return fallback
    if (typeof value !== 'boolean') { problem(path, '须为布尔值'); return fallback }
    return value
  }
  function unique(list, path) {
    const seen = new Set()
    for (const [i, item] of list.entries()) {
      if (seen.has(item.id)) problem(`${path}[${i}].id`, '重复标识符')
      seen.add(item.id)
    }
    return seen
  }
  const root = object(input, '$', rootKeys)
  if (root.schemaVersion !== 1) problem('$.schemaVersion', '须为 1')
  const title = text(root.title, '$.title', '', 300)
  if (!title.trim()) problem('$.title', '须填写图谱标题')
  const type = root.type ?? 'architecture'
  if (!TYPES.includes(type)) problem('$.type', `须为 ${TYPES.join(', ')}`)
  const groups = array(root.groups, '$.groups', LIMITS.groups).map((v, i) => {
    const p = `$.groups[${i}]`; const g = object(v, p, ['id', 'label', 'trustBoundary'])
    return { id: identifier(g.id, `${p}.id`), label: text(g.label, `${p}.label`, g.id, 200), trustBoundary: boolean(g.trustBoundary, `${p}.trustBoundary`) }
  })
  const groupIds = unique(groups, '$.groups')
  const nodes = array(root.nodes, '$.nodes', LIMITS.nodes, true).map((v, i) => {
    const p = `$.nodes[${i}]`; const n = object(v, p, ['id', 'label', 'kind', 'group', 'description', 'details', 'evidence', 'start', 'end'])
    const id = identifier(n.id, `${p}.id`)
    const kind = n.kind ?? 'component'
    if (!KINDS.includes(kind)) problem(`${p}.kind`, `须为 ${KINDS.join(', ')}`)
    const group = n.group === undefined ? undefined : identifier(n.group, `${p}.group`)
    if (group !== undefined && !groupIds.has(group)) problem(`${p}.group`, '分组不存在')
    const evidence = array(n.evidence, `${p}.evidence`, 30).map((v, j) => {
      const ep = `${p}.evidence[${j}]`; const e = object(v, ep, ['path', 'line', 'note'])
      const path = text(e.path, `${ep}.path`, '', 1000)
      if (!path.trim()) problem(`${ep}.path`, '须填写证据路径或公开来源')
      if (e.line !== undefined && (!Number.isSafeInteger(e.line) || e.line < 1)) problem(`${ep}.line`, '须为正整数行号')
      return { path, ...(e.line === undefined ? {} : { line: e.line }), note: text(e.note, `${ep}.note`, '', 1000) }
    })
    for (const field of ['start', 'end']) if (n[field] !== undefined && (typeof n[field] !== 'number' || !Number.isFinite(n[field]) || Math.abs(n[field]) > 1e12)) problem(`${p}.${field}`, '须为有限数值，绝对值最多 1e12')
    if (['timeline', 'waterfall'].includes(type)) {
      if (n.start === undefined || n.end === undefined) problem(p, '时间图须提供 start、end（统一数值单位）')
      else if (n.end <= n.start) problem(`${p}.end`, '须大于 start')
    }
    return { id, label: text(n.label, `${p}.label`, id, 300), kind, ...(group === undefined ? {} : { group }), description: text(n.description, `${p}.description`), details: array(n.details, `${p}.details`, 40).map((d, j) => text(d, `${p}.details[${j}]`, '', 2000)), evidence, ...(n.start === undefined ? {} : { start: n.start }), ...(n.end === undefined ? {} : { end: n.end }) }
  })
  if (!nodes.length) problem('$.nodes', '至少一个节点')
  const nodeIds = unique(nodes, '$.nodes')
  const edges = array(root.edges, '$.edges', LIMITS.edges).map((v, i) => {
    const p = `$.edges[${i}]`; const e = object(v, p, ['id', 'from', 'to', 'label', 'primary', 'description'])
    const from = identifier(e.from, `${p}.from`), to = identifier(e.to, `${p}.to`)
    if (!nodeIds.has(from)) problem(`${p}.from`, '节点不存在')
    if (!nodeIds.has(to)) problem(`${p}.to`, '节点不存在')
    return { id: e.id === undefined ? `edge-${i + 1}` : identifier(e.id, `${p}.id`), from, to, label: text(e.label, `${p}.label`, '', 300), primary: boolean(e.primary, `${p}.primary`), description: text(e.description, `${p}.description`) }
  })
  unique(edges, '$.edges')
  const primaryPath = array(root.primaryPath, '$.primaryPath', LIMITS.nodes).map((v, i) => identifier(v, `$.primaryPath[${i}]`))
  if (new Set(primaryPath).size !== primaryPath.length) problem('$.primaryPath', '主路径节点须唯一；循环请使用 edges 表达')
  for (const [i, id] of primaryPath.entries()) {
    if (!nodeIds.has(id)) problem(`$.primaryPath[${i}]`, '节点不存在')
    if (i > 0 && !edges.some(e => e.from === primaryPath[i - 1] && e.to === id)) problem(`$.primaryPath[${i}]`, '相邻主路径节点间须存在有向边')
  }
  const description = text(root.description, '$.description')
  const notes = array(root.notes, '$.notes', 80).map((v, i) => text(v, `$.notes[${i}]`, '', 4000))
  if (issues.length) throw new SpecError(issues)
  for (const e of edges) if (primaryPath.some((id, i) => i > 0 && primaryPath[i - 1] === e.from && id === e.to)) e.primary = true
  return { schemaVersion: 1, title, description, type, nodes, edges, groups, primaryPath, notes }
}

export function parseSpec(source) {
  if (Buffer.byteLength(source, 'utf8') > LIMITS.bytes) throw new SpecError(['输入超过 2 MiB 限制'])
  let input
  try { input = JSON.parse(source) } catch (e) { throw new SpecError([`JSON 语法错误: ${e.message}`]) }
  return validateSpec(input)
}

export function compareSpecs(before, after) {
  const diff = (a, b, key) => {
    const am = new Map(a.map(v => [v[key], v])), bm = new Map(b.map(v => [v[key], v]))
    return { added: [...bm.keys()].filter(k => !am.has(k)), removed: [...am.keys()].filter(k => !bm.has(k)), changed: [...bm.keys()].filter(k => am.has(k) && JSON.stringify(am.get(k)) !== JSON.stringify(bm.get(k))) }
  }
  const metadata = ['title', 'type', 'description', 'primaryPath', 'notes'].filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
  const order = ['nodes', 'edges', 'groups'].filter(k => JSON.stringify(before[k].map(v => v.id)) !== JSON.stringify(after[k].map(v => v.id)))
  const result = { schemaVersion: 1, before: before.title, after: after.title, metadata, order, nodes: diff(before.nodes, after.nodes, 'id'), edges: diff(before.edges, after.edges, 'id'), groups: diff(before.groups, after.groups, 'id') }
  result.summary = `节点 +${result.nodes.added.length}/-${result.nodes.removed.length}/~${result.nodes.changed.length}；连线 +${result.edges.added.length}/-${result.edges.removed.length}/~${result.edges.changed.length}；分组 +${result.groups.added.length}/-${result.groups.removed.length}/~${result.groups.changed.length}；元信息 ${metadata.length} 项，集合顺序 ${order.length} 项变化`
  return result
}
