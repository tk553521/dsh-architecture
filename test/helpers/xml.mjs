import { spawnSync } from 'node:child_process'

// Python 3 标准库只是测试依赖：运行时零依赖，但 XML 良构性由 expat 判定，避免自己写解析器。
// Windows 上通常没有 python3 别名，只有 py 启动器（也可能是 Microsoft Store 的占位 stub），
// 因此按平台顺序探测，并接受任意一个可用解释器。
const CANDIDATES = process.platform === 'win32'
  ? [['py', ['-3']], ['python', []], ['python3', []]]
  : [['python3', []], ['python', []]]

const PROBE = 'import sys; sys.exit(0)'

// 关键：用 sys.stdin.buffer.read() 读字节，而不是 sys.stdin.read()。
// Windows 下 stdin 文本模式按 ANSI 代码页解码（简中为 GBK）并启用 surrogateescape，
// Node 写入的 UTF-8 中文/emoji 会被解成孤立代理码位，expat 再编码回 UTF-8 时报
// UnicodeEncodeError: surrogates not allowed。传字节则完全绕开本地代码页。
const PARSE = [
  'import sys',
  'import xml.etree.ElementTree as ET',
  'root = ET.fromstring(sys.stdin.buffer.read())',
  'assert root.tag == "{http://www.w3.org/2000/svg}svg", root.tag',
].join('\n')

let cached
export function interpreter() {
  if (cached !== undefined) return cached
  for (const [command, prefix] of CANDIDATES) {
    const probe = spawnSync(command, [...prefix, '-c', PROBE], { timeout: 10000, stdio: 'ignore' })
    if (!probe.error && probe.status === 0) return (cached = { command, prefix })
  }
  return (cached = null)
}

/**
 * 用 expat 校验 SVG 是否良构且根元素为 svg。
 * 返回 available=false 表示本机没有可用的 Python 3，调用方应显式说明而不是静默通过。
 */
export function checkSvgXml(svg) {
  const found = interpreter()
  if (!found) return { available: false, status: null, stderr: '' }
  const run = spawnSync(found.command, [...found.prefix, '-c', PARSE], {
    input: Buffer.from(svg, 'utf8'),
    timeout: 20000,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  })
  return { available: true, status: run.status, stderr: String(run.stderr ?? '') }
}

export const interpreterName = () => {
  const found = interpreter()
  return found ? [found.command, ...found.prefix].join(' ') : null
}

export const MISSING_PYTHON = '本机未找到可用的 Python 3（已尝试 python3 / python / py -3），跳过 expat XML 良构性校验；Node 侧结构断言仍然生效。'
