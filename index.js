import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

export const name = 'local-dsh-architecture'
export const inject = ['skills']
export const skillName = 'architecture-map'
export const description = '分析代码仓库或系统运行架构，依据源码证据生成架构图、流程图、数据流、时序图、生命周期、ERD、类图、树图、时间线或瀑布图，交付可离线打开的交互 HTML、SVG 与 JSON 规格；也用于解释模块协作及比较架构变化。'
const bodyUrl = new URL('./skills/architecture-map/SKILL.md', import.meta.url)
const basePath = fileURLToPath(new URL('./skills/architecture-map/', import.meta.url))
const providerName = 'local-architecture-map'
const invocation = Object.freeze({ modelInvocable: true, userInvocable: true })
const candidate = Object.freeze({
  name: skillName, description, provider: providerName, source: 'bundled',
  invocation, rank: 600, path: fileURLToPath(bodyUrl),
  resourceBase: Object.freeze({ kind: 'directory', path: basePath }), locator: bodyUrl,
})

export function createProvider() {
  return {
    name: providerName,
    async list() { return [candidate] },
    async get(_candidate, options = {}) {
      const raw = await readFile(bodyUrl, { encoding: 'utf8', signal: options.signal })
      const content = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
      const { rank, locator, ...summary } = candidate
      return { ...summary, content }
    },
  }
}

export function apply(ctx) {
  // registerProvider owns a Cordis scope effect: unloading removes this provider.
  ctx.skills.registerProvider(() => createProvider())
}
