import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile, link, symlink, access, realpath } from 'node:fs/promises'
import { join, basename, dirname, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
const cli = fileURLToPath(new URL('../lib/cli.mjs', import.meta.url))
// Windows and macOS resolve paths case-insensitively, so path comparisons must follow.
const CASE_INSENSITIVE_FS = process.platform === 'win32' || process.platform === 'darwin'
const samePath = (a, b) => (CASE_INSENSITIVE_FS ? a.toLowerCase() === b.toLowerCase() : a === b)
function invoke(args, cwd) { return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 20000 }) }
async function workspace(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-architecture-test-'))
  try {
    // Tests receive the resolved path: process.cwd() reports the physical directory, so CLI
    // output never carries Windows 8.3 short names or the macOS /var -> /private/var prefix.
    await fn(await realpath(dir))
  } finally {
    // Delete only the unique test directory created above, never a user-supplied path.
    // Compare resolved paths: realpath expands 8.3 short names on Windows (RUNNER~1) and
    // follows the /var -> /private/var symlink on macOS, so it never equals resolve() there.
    const realDir = await realpath(dir), realTemp = await realpath(tmpdir())
    assert.ok(isAbsolute(dir) && basename(realDir).startsWith('dsh-architecture-test-'), `unexpected test directory ${realDir}`)
    assert.ok(samePath(dirname(realDir), realTemp), `${realDir} is not inside ${realTemp}`)
    // Windows releases handles lazily (antivirus, indexer), so recursive removal needs retries.
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}
const fixture = { schemaVersion: 1, title: 'test', nodes: [{ id: 'a' }], edges: [] }
test('CLI help, errors and init', () => workspace(async dir => {
  assert.equal(invoke(['--help'], dir).status, 0)
  const bad = invoke(['surprise'], dir); assert.equal(bad.status, 1); assert.match(bad.stderr, /未知命令/)
  const init = invoke(['init', '--out', 'source.json'], dir); assert.equal(init.status, 0, init.stderr)
  const result = JSON.parse(init.stdout); assert.equal(result.files[0], join(dir, 'source.json'))
  assert.equal(invoke(['init', '--out', 'source.json'], dir).status, 1)
  assert.equal(invoke(['validate', 'source.json'], dir).status, 0)
}))
test('render preserves input, creates three outputs and no-clobber prechecks all', () => workspace(async dir => {
  const source = join(dir, 'architecture.spec.json'); const raw = JSON.stringify(fixture)
  await writeFile(source, raw)
  const rendered = invoke(['render', source], dir); assert.equal(rendered.status, 0, rendered.stderr)
  const files = JSON.parse(rendered.stdout).files
  assert.equal(files.length, 3); assert.ok(files.includes(join(dir, 'architecture.normalized.spec.json')))
  assert.equal(await readFile(source, 'utf8'), raw)
  const before = await readFile(files[0], 'utf8')
  const second = invoke(['render', source], dir); assert.equal(second.status, 1)
  assert.equal(await readFile(files[0], 'utf8'), before)
  assert.equal(invoke(['render', source, '--force'], dir).status, 0)
  for (const file of files) await access(file)
  assert.equal(await readFile(source, 'utf8'), raw)
}))
test('invalid specification writes no outputs', () => workspace(async dir => {
  await writeFile(join(dir, 'source.json'), '{"schemaVersion":1,"nodes":[]}')
  const res = invoke(['render', 'source.json', '--out', 'map.html'], dir)
  assert.equal(res.status, 1); await assert.rejects(access(join(dir, 'map.html')))
}))
test('hardlinked and symlinked output never truncates input with force', t => workspace(async dir => {
  const input = join(dir, 'source.json'), raw = JSON.stringify(fixture)
  await writeFile(input, raw); await link(input, join(dir, 'hard.html'))
  const hard = invoke(['render', input, '--out', 'hard.html', '--force'], dir)
  assert.equal(hard.status, 1); assert.match(hard.stderr, /硬链接/)
  assert.equal(await readFile(input, 'utf8'), raw)
  try {
    // Windows only permits symlink creation for elevated processes or Developer Mode.
    await symlink(input, join(dir, 'sym.html'), 'file')
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOSYS', 'UNKNOWN'].includes(error.code)) throw error
    t.diagnostic(`跳过符号链接断言：当前 Windows 账户无权创建符号链接（${error.code}）。`)
    return
  }
  assert.equal(invoke(['render', input, '--out', 'sym.html', '--force'], dir).status, 1)
  assert.equal(await readFile(input, 'utf8'), raw)
}))
test('compare includes root metadata/order and protects input output identity', () => workspace(async dir => {
  const before = { ...fixture, type: 'architecture', nodes: [{ id: 'a' }, { id: 'b' }] }
  const after = { ...fixture, type: 'sequence', description: 'changed', nodes: [{ id: 'b' }, { id: 'a' }] }
  await writeFile(join(dir, 'before.json'), JSON.stringify(before)); await writeFile(join(dir, 'after.json'), JSON.stringify(after))
  const result = invoke(['compare', 'before.json', 'after.json'], dir)
  assert.equal(result.status, 0, result.stderr)
  const diff = JSON.parse(result.stdout); assert.deepEqual(diff.metadata, ['type', 'description']); assert.deepEqual(diff.order, ['nodes'])
  assert.equal(invoke(['compare', 'before.json', 'after.json', '--out', 'diff.json'], dir).status, 0)
  assert.equal(invoke(['compare', 'before.json', 'after.json', '--out', 'before.json', '--force'], dir).status, 1)
}))
test('all targets checked before the first output write', () => workspace(async dir => {
  await writeFile(join(dir, 'source.json'), JSON.stringify(fixture)); await writeFile(join(dir, 'map.svg'), 'existing-svg')
  const result = invoke(['render', 'source.json', '--out', 'map.html'], dir)
  assert.equal(result.status, 1); await assert.rejects(access(join(dir, 'map.html')))
  assert.equal(await readFile(join(dir, 'map.svg'), 'utf8'), 'existing-svg')
}))
test('uppercase extensions work and case-folded paths follow platform semantics', () => workspace(async dir => {
  assert.equal(invoke(['init', '--out', 'SOURCE.JSON'], dir).status, 0)
  assert.equal(invoke(['validate', 'SOURCE.JSON'], dir).status, 0)
  const rendered = invoke(['render', 'SOURCE.JSON', '--out', 'MAP.HTML'], dir)
  assert.equal(rendered.status, 0, rendered.stderr)
  const files = JSON.parse(rendered.stdout).files
  assert.ok(files.includes(join(dir, 'MAP.HTML')), files.join(','))
  assert.ok(files.includes(join(dir, 'MAP.svg')), files.join(','))
  const clash = invoke(['render', 'SOURCE.JSON', '--out', 'map.html'], dir)
  // Target names differ only by case: same file on Windows/macOS, distinct on Linux.
  if (CASE_INSENSITIVE_FS) assert.equal(clash.status, 1, '同名不同大小写的产物应判定为已存在')
  else assert.equal(clash.status, 0, clash.stderr)
}))
