# 架构图谱 · 独立 DSH 插件

`@local/dsh-architecture` 1.0.0，为 YG 的 DSH 编写。适配本机 `@deepseek-ai/dsh 0.2.2-rc.5`，Node 22.19+；本机实际宿主 Node 24.22.3。无 npm 依赖、安装脚本、网络上传、自动更新或后台服务。

## 在 DSH 中使用

安装后，技能列表新增 **architecture-map**。在对话输入：

> 用 architecture-map 分析 [项目目录] 的运行架构：8–12 个核心组件、一条主调用链、外部依赖与信任边界，生成交互 HTML、SVG 和 JSON 并发布文件。

也可说：

- 用 architecture-map 画这个 API 请求的时序图，按实际调用顺序说明。
- 用 architecture-map 画这些表的 ERD，把字段和源码证据放入详情卡。
- 用 architecture-map 比较重构前后架构，分别输出两张图和规格差异。

Agent 读取目标代码与运行证据后编写规格，CLI 校验和渲染。不是无提示自动采集器，也不对任意仓库做后台扫描。

## 功能

| 能力 | 实现 |
| --- | --- |
| 架构/流程/数据流/生命周期/树图 | 有向自动布局、节点/分组、信任边界、主要链路 |
| 时序图 | 参与者与按边数组顺序排列的消息，含自调用 |
| ERD/类图 | 简化关系图；details 展示字段、方法，边标签描述关联 |
| 时间线/瀑布图 | start/end 数值区间，单位由规格说明 |
| 交互解释 | 点选节点的描述、详情与证据卡；搜索、主题、缩放、SVG/JSON 下载 |
| 架构比较 | 稳定 id 对齐的新增/删除/内容变更、元信息与集合顺序 JSON；两张图分别渲染 |
| 离线交付 | 完整 HTML、独立 SVG、标准化 JSON，无 CDN、外部字体或图表服务 |

默认建议 8–12 个节点；上限 120 节点、400 边、30 组、2 MiB 输入。不是完整 UML/SQL 编译器或复杂图布局引擎；密集交叉边的大图需要分视图。生成器验证结构，图谱事实取决于 Agent 的源码证据分析。

## 本地 CLI

在插件目录下：

```bash
node lib/cli.mjs init --out /workspace/artifacts/architecture.source.json
node lib/cli.mjs validate /workspace/artifacts/architecture.source.json
node lib/cli.mjs render /workspace/artifacts/architecture.source.json --out /workspace/artifacts/architecture.html
node lib/cli.mjs compare before.source.json after.source.json --out /workspace/artifacts/diff.json
```

DSH shell 中优先使用 `"$DSH_NODE_EXECUTABLE"` 代替 `node`。Windows PowerShell 对应写法：

```powershell
$node = if ($env:DSH_NODE_EXECUTABLE) { $env:DSH_NODE_EXECUTABLE } else { 'node' }
& $node lib/cli.mjs init --out .\artifacts\architecture.source.json
& $node lib/cli.mjs render .\artifacts\architecture.source.json --out .\artifacts\architecture.html
```

render 输出：

- `architecture.html` — 下载后用浏览器打开，自包含交互图。
- `architecture.svg` — 独立矢量图。
- `architecture.normalized.spec.json` — 校验后补齐默认值的规格。

原始输入保留。目标已存在时预检中止；覆盖需 `--force`。路径为实际文件路径，CLI 返回绝对路径；Agent 使用 `present` 发布文件。DSH 内置预览对 HTML 脚本的支持可能不同，本插件不改变 DSH 主界面。

详见 `skills/architecture-map/references/specification.md`，结构样例 `examples/plugin-flow.spec.json`。

## 安装、停用与卸载

源码仓库：[tk553521/dsh-architecture](https://github.com/tk553521/dsh-architecture)。先克隆，再通过 DSH 的 **插件 → 添加插件 → 本地目录** 选择克隆目录，或使用命令行：

```bash
git clone https://github.com/tk553521/dsh-architecture.git
cd dsh-architecture
dsh plugin --profile web add "$PWD"
```

Windows PowerShell 在克隆目录中运行：

```powershell
dsh plugin --profile web add (Get-Location).Path
```

卸载：

```bash
dsh plugin --profile web remove @local/dsh-architecture
```

私有仓库需使用已登录的 GitHub 凭据克隆。本项目尚未发布 npm 包，不能直接用 npm 包名安装。

安装只新增 `local-dsh-architecture` Host 行；`inject=['skills']`，通过官方 `ctx.skills.registerProvider()` 注册一个 rank=600 的 bundled Skill，按需读取正文。卸载/停用自动注销 Provider，不修改系统提示词、预设、其他插件或 DSH 核心。

文件系统的同名项目/用户技能可能优先，本插件用独立名字 architecture-map 避免与 archify 冲突。更新插件 JS 模块通常需要宿主重启；以插件管理器 application/nextStep 为准。

## 原项目实现核实

核实时间：2026-11-24；本插件根据功能独立实现，不复制原作者源码、图标、HTML 模板或品牌资产，JSON 格式也不与 Archify 兼容。

上游 [DSH integration](https://github.com/tt-a1i/archify/tree/main/integrations/deepseek-harness) 当前适配器 1.2.0，固定打包 Archify 3.3.0，源提交 `af3aaf3c36762f2afb62a4a09533f6c7273b07e5`。核心 [patch](https://github.com/tt-a1i/archify/blob/main/integrations/deepseek-harness/cordis.patch.yml) 仅挂载 `@deepseek-ai/dsh-skill-filesystem`，用宿主 `!!js` 从包身份定位 skills 根目录。没有原生工具、自定义 Web client、凭据系统或后台服务；Skill 调用普通 shell/文件工具，typed JSON IR 经校验后生成内嵌 Viewer 的 HTML/SVG。

上游支持 10 类图、explain、compare 与多语言 Code Analysis；其中语言解析器有不同依赖，例如 Go/Rust/C/C++ 不能统称全语言零依赖。本插件提供相同方向的图谱与解释/比较功能，代码建模由 DSH Agent 完成，未移植上游语言 AST 分析器、其专用布局/动画/质量门禁或浏览器自动验收系统。原适配器 MIT，原 Archify Skill Apache-2.0；本插件的原创实现采用 MIT。

## Windows 支持

插件本身是纯 Node ESM，无原生模块、无构建步骤，Windows 与 Linux/macOS 行为一致。以下平台差异已在实现中显式处理：

| 差异 | 处理方式 |
| --- | --- |
| 路径大小写不敏感 | 判断“产物路径是否等于输入”“目标是否已存在”时按 `resolve()` 后不区分大小写比较（Windows 与 macOS），避免 `MAP.html` 与 `map.html` 被当成两个文件而互相覆盖 |
| `dev`/`ino` 不稳定 | NTFS 返回真实 ino；网络盘与 FAT/exFAT 会让所有文件 ino 为 0，此时回退为解析后的路径作为同一性判断，不会误报“产物指向输入” |
| 没有 `O_NOFOLLOW` | Windows 不提供该标志，符号链接/联接点由写入前的 `lstat` 预检拦截 |
| 文件被占用 | 浏览器、编辑器或杀毒软件持有句柄时 `open` 返回 `EPERM`/`EBUSY`，CLI 给出明确指出占用原因的报错 |
| 符号链接需特权 | 普通账户默认不能创建符号链接（需管理员或开发者模式），相关测试在无权限时以诊断信息跳过，硬链接断言仍执行 |
| 下载文件名 | 清洗 `< > : " / \ \| ? *` 等非法字符，并规避 `CON`/`PRN`/`AUX`/`NUL`/`COM1-9`/`LPT1-9` 设备名与结尾的点、空格 |
| 换行 | `.gitattributes` 强制 LF，即使 Git for Windows 默认 `core.autocrlf=true` 也不把 CRLF 带进工作区 |
| 扩展名大小写 | `--out MAP.HTML`、`init --out SOURCE.JSON` 均可接受 |

需要留意的两点：扩展名与路径大小写在 **Linux 上仍按原样区分**（同一仓库在两种系统上的产物命名可能不同）；`artifacts/` 已在 `.gitignore` 中，产物不会被误提交。

## 测试与验证

```bash
node --test test/*.test.mjs
node --check assets/viewer.js
```

PowerShell 下同样可直接运行；`test/*.test.mjs` 由 Node 测试运行器自己展开，不依赖 shell 通配符。

本插件包含规格、引用、数量边界、注入转义、10 类渲染、CLI 文件保护和 Provider 注册测试。完整测试用 Python 3 标准库检查 SVG XML（测试依赖，生成器运行只需 Node）。测试按 `python3` → `python` → `py -3`（Windows 优先 `py -3`）顺序探测解释器，SVG 以 **字节流** 送入 expat：Windows 的 stdin 文本模式会按 ANSI 代码页（简中为 GBK）解码并启用 surrogateescape，UTF-8 中文会被解成孤立代理码位而报 `UnicodeEncodeError`，用字节流可完全绕开本地代码页。本机没有可用 Python 3 时，XML 良构性断言以诊断信息跳过，Node 侧结构断言仍生效。CI 在 Ubuntu、Windows、macOS 三平台 × Node 22/24 上运行。没有浏览器控制的环境中，只验证脚本语法、文件/XML 结构和真实技能加载，不声称已验收交互、布局或深浅色的视觉效果。

多文件写入不是事务：磁盘/权限中途错误可能留下部分产物，CLI 会报失败。默认 no-clobber，输入与输出不得重叠，输出目标不接受符号链接，产物目标被其他程序占用时按平台给出明确报错。
