#!/usr/bin/env node
import { readFile, mkdir, stat, lstat, open } from 'node:fs/promises'
import { constants } from 'node:fs'
import { resolve, dirname, basename, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseSpec, compareSpecs, TYPES, LIMITS } from './spec.mjs'

const HELP = `DSH 架构图谱 — 本地、零依赖、离线产物

node lib/cli.mjs init --out architecture.spec.json
node lib/cli.mjs validate architecture.spec.json
node lib/cli.mjs render architecture.spec.json --out artifacts/architecture.html
node lib/cli.mjs compare before.spec.json after.spec.json [--out artifacts/diff.json]

render 同时输出 .html、.svg、.normalized.spec.json；默认保留现有文件，覆盖需 --force。
--out 是文件路径，不是目录。所有产物只使用本地资源。
类型: ${TYPES.join(', ')}
时间线与瀑布图须提供 start/end（统一数值单位），时序图按 edges 顺序排列。
compare 以稳定 id 对齐节点/边/分组，并报告 added、removed、changed。
`

function options(argv) {
  const positional = []; let out; let force = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--force') force = true
    else if (argv[i] === '--out') { out = argv[++i]; if (!out || out.startsWith('--')) throw new Error('--out 须跟文件路径') }
    else if (argv[i].startsWith('--')) throw new Error(`未知参数 ${argv[i]}`)
    else positional.push(argv[i])
  }
  return { positional, out, force }
}
async function load(path) {
  const file = resolve(path)
  const s = await stat(file)
  if (!s.isFile() || s.size > LIMITS.bytes) throw new Error('输入须为不超过 2 MiB 的 JSON 文件')
  return parseSpec(await readFile(file, 'utf8'))
}
// Windows and macOS compare paths case-insensitively, so path equality must too.
const CASE_INSENSITIVE_FS = process.platform === 'win32' || process.platform === 'darwin'
const pathKey = file => (CASE_INSENSITIVE_FS ? resolve(file).toLowerCase() : resolve(file))
// dev:ino is the strongest identity where the filesystem reports inodes. Windows network
// shares and FAT/exFAT volumes report ino 0 for every file, which would collapse all
// identities into one, so fall back to the resolved path there.
const identity = (info, file) => (info.ino === 0 ? `path:${pathKey(file)}` : `${info.dev}:${info.ino}`)
async function outputFiles(items, force, inputs = []) {
  const identities = new Set()
  const inputKeys = new Set()
  for (const p of inputs) {
    const file = resolve(p)
    inputKeys.add(pathKey(file))
    identities.add(identity(await stat(file), file))
  }
  const expected = new Map()
  for (const [file] of items) {
    if (inputKeys.has(pathKey(file))) throw new Error(`产物路径与输入相同: ${file}`)
    try {
      const info = await lstat(file)
      if (info.isSymbolicLink() || !info.isFile()) throw new Error(`产物位置须为普通文件: ${file}`)
      if (identities.has(identity(info, file))) throw new Error(`产物路径指向输入（含硬链接）: ${file}`)
      if (info.nlink > 1) throw new Error(`产物目标存在其他硬链接: ${file}`)
      if (!force) throw new Error(`文件已存在: ${file}；选择新路径或明确添加 --force`)
      expected.set(file, identity(info, file))
    } catch (e) { if (e.code !== 'ENOENT') throw e }
  }
  for (const [file, body] of items) {
    await mkdir(dirname(file), { recursive: true })
    const existing = expected.get(file)
    const flags = existing === undefined ? constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL : constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0)
    let handle
    try {
      handle = await open(file, flags, 0o644)
    } catch (e) {
      // Windows returns EPERM/EBUSY when another process (browser, editor, antivirus) holds the file.
      if (e.code === 'EPERM' || e.code === 'EBUSY') throw new Error(`写入 ${file} 失败：文件被其他程序占用（${e.code}）；关闭占用它的程序后重试`)
      throw e
    }
    try {
      const info = await handle.stat()
      if (!info.isFile() || identities.has(identity(info, file)) || info.nlink > 1 || (existing !== undefined && identity(info, file) !== existing)) throw new Error(`产物目标在预检后变化，停止写入: ${file}`)
      if (existing !== undefined) await handle.truncate(0)
      await handle.writeFile(body, { encoding: 'utf8' })
    } finally { await handle.close() }
  }
  return items.map(([path]) => path)
}
export async function run(argv = process.argv.slice(2)) {
  if (!argv.length || argv[0] === '--help' || argv[0] === 'help') { console.log(HELP); return }
  const command = argv[0]; const { positional, out, force } = options(argv.slice(1))
  if (command === 'init') {
    if (positional.length) throw new Error('init 不接收输入文件')
    const file = resolve(out ?? 'architecture.spec.json')
    if (extname(file).toLowerCase() !== '.json') throw new Error('init 输出扩展名须为 .json')
    const body = await readFile(new URL('../examples/plugin-flow.spec.json', import.meta.url), 'utf8')
    parseSpec(body)
    const paths = await outputFiles([[file, body]], force)
    console.log(JSON.stringify({ ok: true, command, files: paths }, null, 2)); return
  }
  if (command === 'validate') {
    if (positional.length !== 1 || out || force) throw new Error('validate 接收一个输入文件，不写入产物')
    const spec = await load(positional[0])
    console.log(JSON.stringify({ ok: true, command, type: spec.type, nodes: spec.nodes.length, edges: spec.edges.length, groups: spec.groups.length }, null, 2)); return
  }
  if (command === 'render') {
    if (positional.length !== 1) throw new Error('render 接收一个输入文件')
    const spec = await load(positional[0])
    const input = resolve(positional[0]); const file = resolve(out ?? join(dirname(input), `${basename(input).replace(/(?:\.spec)?\.json$/i, '')}.html`))
    if (extname(file).toLowerCase() !== '.html') throw new Error('render 输出扩展名须为 .html')
    const stem = file.slice(0, -5)
    const { renderHtml, renderSvg } = await import('./render.mjs')
    const paths = await outputFiles([[file, renderHtml(spec)], [`${stem}.svg`, renderSvg(spec)], [`${stem}.normalized.spec.json`, `${JSON.stringify(spec, null, 2)}\n`]], force, [input])
    console.log(JSON.stringify({ ok: true, command, type: spec.type, files: paths }, null, 2)); return
  }
  if (command === 'compare') {
    if (positional.length !== 2) throw new Error('compare 接收 before 与 after 两个输入文件')
    const result = compareSpecs(await load(positional[0]), await load(positional[1]))
    const body = `${JSON.stringify(result, null, 2)}\n`
    if (out) {
      const file = resolve(out)
      if (extname(file).toLowerCase() !== '.json') throw new Error('compare 输出扩展名须为 .json')
      const paths = await outputFiles([[file, body]], force, positional)
      console.log(JSON.stringify({ ok: true, command, summary: result.summary, files: paths }, null, 2))
    } else console.log(body)
    return
  }
  throw new Error(`未知命令 ${command}；运行 --help 查看用法`)
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run().catch(error => { console.error(JSON.stringify({ ok: false, error: error.message, ...(error.issues ? { issues: error.issues } : {}) }, null, 2)); process.exitCode = 1 })
}
