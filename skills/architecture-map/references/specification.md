# 图谱规格 v1

根对象：`schemaVersion: 1`、`title`、`nodes` 必填；`type` 默认 architecture，`description`、`groups`、`edges`、`primaryPath`、`notes` 可省略。未知字段会报错，避免拼写错误静默丢失。

```json
{
  "schemaVersion": 1,
  "type": "architecture",
  "title": "请求处理路径",
  "description": "来自已读取的入口及路由代码",
  "groups": [{"id": "app", "label": "应用进程", "trustBoundary": true}],
  "nodes": [
    {"id": "user", "label": "用户", "kind": "actor", "description": "发起请求"},
    {"id": "api", "label": "API", "group": "app", "description": "处理请求", "details": ["验证输入", "调用存储"], "evidence": [{"path": "src/api.ts", "line": 24, "note": "请求处理入口"}]},
    {"id": "db", "label": "数据库", "kind": "store"}
  ],
  "edges": [
    {"id": "request", "from": "user", "to": "api", "label": "HTTP", "primary": true},
    {"id": "query", "from": "api", "to": "db", "label": "查询"}
  ],
  "primaryPath": ["user", "api", "db"],
  "notes": ["此例为结构示意，使用时替换成真实证据。"]
}
```

## 字段规则

- 标识符仅字母/数字/`_`/`.`/`-`，以字母数字开头，最多 80 字符。节点、边、分组各自须唯一；分组与端点引用须存在。
- 节点：`id` 必填；label 默认 id；kind 为 component/actor/external/store；description 默认空；details 为字符串数组；evidence 为 `{path,line?,note?}` 数组。line 为从 1 开始的整数。证据内容作为文本显示，不执行 URL 或代码。
- 边：from/to 必填；id 可省略，自动 edge-N，但架构比较请显式写稳定 id；primary 为布尔值；label 与 description 可省略。方向与标签由实际证据决定。自调用与循环边支持。
- 分组：id、label、trustBoundary；为组件划分进程、部署域或信任区。
- primaryPath 是不重复的节点 id 数组，相邻两个节点须有对应有向边，自动标记这些边为 primary。循环写 edges，不重复主路径节点。
- sequence 的边顺序即事件顺序，不按主路径重排。参与者为 nodes，支持自调用。
- erd/class 的 details 可写 `id: UUID (PK)`、`owner_id: UUID (FK)`、`+ handle(request)` 等文本。关系/基数用 label 表达，未实现 SQL/UML 语法解析。
- timeline/waterfall 每个节点需要数值 start/end，end > start；例如 `{ "id": "build", "label": "构建", "start": 0, "end": 120 }`。数值必须有限且绝对值不超过 1e12；统一时间单位在描述注明。可表示相对秒/毫秒或 epoch 数值，不接受日期字符串。
- 字符串上限：title 300、node/edge label 300、description 4000；单节点 details 40、evidence 30；notes 80。最多节点 120、边 400、组 30；输入文件最多 2 MiB。

## 输出

`render source.json --out artifacts/map.html` 创建：
- `artifacts/map.html`：内嵌 SVG、CSS、JS、规格，完全离线。
- `artifacts/map.svg`：可独立打开/导入文档的矢量图。
- `artifacts/map.normalized.spec.json`：补齐默认值的标准化规格。

保留 source.json，不覆盖输入。默认目标文件已有时整个写入在预检阶段中止。`--force` 只用于明确覆盖产物。写入发生中途的磁盘/权限错误可能留下已写的部分文件；本工具不宣称多文件事务或崩溃原子性。

compare 输出稳定 id 的新增/删除/内容变更，以及 metadata 字段和集合 id 顺序变化，比较的是规格而非源码事实；修改顺序可能改变内容差异。CLI 的 JSON 格式与 Archify 的 IR 无直接兼容性。
