import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import { apply, createProvider, skillName, inject } from '../index.js'

test('provider publishes exactly one unique bundled skill with a real resource base', async () => {
  const provider = createProvider(); const list = await provider.list()
  assert.equal(list.length, 1); assert.equal(list[0].name, 'architecture-map')
  assert.equal(list[0].rank, 600); assert.equal(list[0].source, 'bundled')
  assert.equal(list[0].resourceBase.kind, 'directory'); await access(list[0].path)
  const body = await provider.get(list[0])
  assert.equal(body.name, skillName); assert.match(body.content, /# 架构图谱/)
  assert.ok(!body.content.startsWith('---')); assert.match(body.content, /present/)
  assert.equal(body.invocation.userInvocable, true); assert.equal(body.invocation.modelInvocable, true)
})
test('host apply registers using official effect-owned provider API', () => {
  let provider; let calls = 0
  apply({ skills: { registerProvider(factory) { provider = factory({}); calls++ } } })
  assert.equal(calls, 1); assert.equal(provider.name, 'local-architecture-map')
  assert.deepEqual(inject, ['skills'])
})
test('provider honors cancelled loading', async () => {
  const provider = createProvider(); const [candidate] = await provider.list()
  const controller = new AbortController(); controller.abort()
  await assert.rejects(() => provider.get(candidate, { signal: controller.signal }), { name: 'AbortError' })
})
test('display metadata and runtime exports refer to existing shipped files', async () => {
  const root = new URL('../', import.meta.url)
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  assert.equal(manifest.name, '@local/dsh-architecture'); assert.equal(manifest.engines.dsh, '0.2.2-rc.5')
  assert.equal(manifest.dependencies, undefined)
  assert.equal(manifest.dsh.client, undefined)
  for (const file of ['index.js', 'cordis.patch.yml', 'icon.svg', 'README.md', 'LICENSE', 'locale/en.json', 'locale/zh.json', 'skills/architecture-map/SKILL.md', 'lib/cli.mjs', 'lib/render.mjs', 'assets/viewer.js', 'assets/viewer.css']) await access(new URL(file, root))
  for (const locale of ['en', 'zh']) {
    const metadata = JSON.parse(await readFile(new URL(`locale/${locale}.json`, root), 'utf8')).meta
    assert.ok(metadata.title && metadata.description); assert.ok(!metadata.detail)
  }
})
