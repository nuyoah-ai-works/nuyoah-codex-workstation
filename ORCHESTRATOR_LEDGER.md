# 总管账本 CLI 合同（schema v7）

这个 CLI 是大总管与 Workstation 之间的最小稳定接口。它只保存会话/任务 ID、
短摘要、不可逆指纹和证据引用；不保存完整 prompt、完整 output、对话正文、规则或
Skill 正文、凭据。候选正文、验证生命周期和影响账本的唯一真源仍属于
“南鸢skill治理中心”，Workstation 只保存可回读的引用快照。

## 调用方式

所有命令都从 stdin 接收一个 JSON 对象，只向 stdout 写一行 JSON。成功退出码为
`0`，失败为 `1`；失败响应只包含安全错误码和可行动说明，不回显被拒绝的敏感值。

```bash
NUYOAH_ORCHESTRATOR_DB=/absolute/path/to/orchestrator.sqlite3 \
  node scripts/orchestrator-ledger.mjs <<'JSON'
{"command":"open.list"}
JSON
```

现役账本迁移必须先完成在线一致性备份、备份副本恢复演练和新旧数据指纹比对。
普通读写命令不会隐式迁移，也不能代替这些步骤。

新建或升级账本必须单独执行一次显式迁移；普通写命令不会代替调用方迁移：

```json
{"command":"migrate"}
```

`open.list`、`request.get` 和 `ownership.check` 始终以 SQLite 只读模式打开文件，
不会创建目录、切换 journal mode，也不会改变主 `.sqlite3` 内容、业务行、schema、
`user_version`、迁移状态或业务事件。为了正确读取活动 WAL 中尚未 checkpoint 的最新
提交，SQLite 可以创建或更新同一账本旁的 `<db>-wal` 和 `<db>-shm`；这两个数据库引擎
自管协调文件不属于业务写入或迁移，除此之外不得产生其他文件。

正常 live ledger 读取禁止使用 `immutable=1`，因为它会忽略尚未 checkpoint 的 WAL
记录。如果未来必须做到文件系统零写入，应由写端先冻结并 checkpoint，再提供独立
快照供 immutable 读取；这不属于当前实时账本路径。

## 新会话接管顺序

1. 先调用 `open.list`，不要先创建 request。
2. 用返回的 `request.id`、`dispatch.id`、`threadId` / `clientThreadId` 回读真实任务。
3. 找不到任务时用 `reconcile` 写成 `unknown + needsAttention`，不要创建替代任务。
4. 对要接管的 request 调用 `session.attach`，关系使用 `resume`。`rootSessionId` 保持不变。
5. 需要新派工时先调用 `ownership.check`；允许后再创建真实任务并调用
   `dispatch.register`。标题和 cwd 只供人阅读，绝不能用来猜血缘。

`open.list` 的机器可读顶层字段：

- `schemaVersion`: 当前数据库版本；新版为 `7`。
- `compatibility`: `current`、`read_only_degraded`、`unsupported_newer_schema` 或
  `unsupported_older_schema`。
- `requests[]`: 所有未结束 request。
- `requests[].rootSessionId` / `lineageStatus` / `sessions[]`: 固定来源与恢复会话。
- `requests[].dispatches[]`: 真实任务 ID、执行状态、验证状态、关系、依赖和所有权。
- `requests[].routeDecisions[]`: 规则、Skill、工具和候选引用分栏的路由证据。
- `requests[].outcomes[]` / `evidenceRefs[]`: 不可覆盖的尝试结果与短证据引用。
- `requests[].candidateRefs[]`: 治理真源引用、资格、价值门、固化/启用/发布和回滚状态。

读取单项及完整事件使用：

```json
{"command":"request.get","requestId":"req_..."}
```

## 建立和恢复会话血缘

新 request 应显式传入创建它的总管会话 ID：

```json
{
  "command": "request.create",
  "idempotencyKey": "request:stable-business-key",
  "request": {
    "rootSessionId": "01abc...",
    "goal": "短目标摘要",
    "projectId": "saved-project-id",
    "status": "planning"
  }
}
```

schema v7 新建 request 必须提供 `rootSessionId`，省略会被拒绝。只有从旧 schema
显式迁移来的既有记录允许保留 `rootSessionId:null` 和 `legacy_unknown`；不能按标题、
目录或相似文本补猜。恢复会话只追加关系：

```json
{
  "command": "session.attach",
  "idempotencyKey": "resume:req-id:session-id",
  "requestId": "req_...",
  "session": {"sessionId":"01resume...","relation":"resume"}
}
```

## 派工前所有权检查与真实任务登记

`objectKey` 必须是稳定别名，不能是绝对私有路径。`read` 可并行；同一对象、同一阶段
发生写冲突时返回 `allowed:false`。只有把冲突任务加入 `dependencies` 后才允许串行。

```json
{
  "command": "ownership.check",
  "requestId": "req_...",
  "ownershipCheck": {
    "dependencies": ["dsp_existing"],
    "ownership": [
      {"objectKey":"file:nuyoah/taskboard/orchestrator-ledger","accessMode":"write","phase":"implementation"}
    ]
  }
}
```

真实任务创建成功后登记其真实 ID，并在同一事务中写入关系、依赖和所有权：

```json
{
  "command": "dispatch.register",
  "idempotencyKey": "dispatch:stable-business-key",
  "requestId": "req_...",
  "dispatch": {
    "role": "worker",
    "model": "gpt-6-luna",
    "effort": "medium",
    "threadId": "01child...",
    "logicalUnitKey": "ledger-implementation",
    "dependencies": ["dsp_existing"],
    "ownership": [
      {"objectKey":"file:nuyoah/taskboard/orchestrator-ledger","accessMode":"write","phase":"implementation"}
    ]
  }
}
```

新派工的模型池固定为：

- `gpt-6-luna`: `medium` / `high`
- `gpt-6-sol`: `high` / `xhigh` / `max`
- `gpt-6-astra`: `medium` / `high` / `xhigh` / `max`

所有 worker 和 verifier 都禁止 `ultra`。v7 原样保留历史 `gpt-5.6-luna`（low/medium）、
`gpt-5.6-terra`（medium/high）、`gpt-5.6-sol`（high/xhigh/max），继续允许更新状态、
证据、摘要和真实任务 ID；历史 model 与 effort 不可改写。旧 `dispatch.register` 幂等键
以原模型和 effort 重放时回读同一 dispatch，不新增任务或事件；模型或 effort 不符返回
`IDEMPOTENCY_CONFLICT`。不同幂等键的新建、当前模型改回历史模型，以及通过 SQL INSERT、
UPDATE 或 INSERT OR REPLACE 改写历史模型的操作均被拒绝。

旧任务要使用新模型执行，可创建新的真实任务，再以新 dispatch 的 `retryOfDispatchId`
关联旧尝试。不得复用旧真实任务 ID 伪造新 dispatch，也不得把历史 model/effort 改成新值。
本版没有逐轮执行模型记录：同一真实任务跨模型续跑仍不能如实登记；必须先扩展该合同，
不能以状态更新、幂等重放或续派摘要代替模型执行记录。已存在的同模型续派行为保持不变。

纠正任务如果创建了新的真实 Codex 任务，就用新的 dispatch，并以
`retryOfDispatchId` 指向旧尝试；旧结果不会被覆盖。如果原 worker 或 verifier 任务仍是
同一个真实任务，则不得再次 `dispatch.register`，而是在它已经进入 `done`、`failed` 或
`cancelled` 后显式续派：

```json
{
  "command": "dispatch.resume",
  "idempotencyKey": "resume:dsp-id:attempt-2",
  "requestId": "req_...",
  "dispatchId": "dsp_...",
  "resume": {
    "summary": "继续在原任务修复验收问题",
    "evidence": "task:follow-up-2"
  }
}
```

成功响应保留原 `dispatch.id`、`threadId` / `clientThreadId`、角色、关系、依赖和所有权，
把 `status` 设为 `running`、`attemptCount` 加一，并把 dispatch 与 request 的验证状态重置为
`UNVERIFIED`。同时写入一个不可覆盖的 `dispatch.resumed` 事件；旧 outcome 与旧事件继续
可读。相同幂等键和相同输入只重放结果，不重复递增 attempt；换 dispatch、request 或输入
会返回 `IDEMPOTENCY_CONFLICT`。非终态任务返回 `DISPATCH_NOT_TERMINAL`，跨 request 的
dispatch 返回 `DISPATCH_RELATION_INVALID`。

有未完成依赖或运行中所有权冲突时，`dispatch.resume` 不写入任何业务变化，并分别返回
`DEPENDENCY_NOT_READY` 或 `OWNERSHIP_CONFLICT`。普通新 dispatch 只能保持 `registered`；
`dispatch.register(status:"running")` 与 `dispatch.update(status:"running")` 使用同一运行门。
依赖全部 `done` 且不存在重叠运行写者后，才允许进入 `running`。

## 路由证据

先记录规则结论，再记录 Skill/工具选择。`ruleOutcome` 为 `blocked` 或 `conflict` 时，
任何 Skill/工具都不能标为已选择。`actualHit:true` 必须同时有
`eligibleExposure:true` 和精确、当前可路由的 candidate reference。

```json
{
  "command": "route.record",
  "idempotencyKey": "route:req-id:1",
  "requestId": "req_...",
  "route": {
    "inputFingerprint": "sha256:...",
    "targetProjectId": "saved-project-id",
    "ruleMatches": [
      {"id":"user-instruction","scope":"current-request","version":"2026-09-04","contentHash":"sha256:...","priority":1,"reasonCode":"explicit-user-scope","selected":true}
    ],
    "ruleOutcome": "selected",
    "skillMatches": [
      {"id":"skill-id","source":"runtime-skills-list","version":"v1","reasonCode":"intent-match","selected":true}
    ],
    "toolMatches": [],
    "candidateRefs": [],
    "eligibleExposure": false,
    "actualHit": false,
    "reasonCode": "rules-before-capabilities",
    "reasonSummary": "规则允许当前只读范围，然后选择所需能力",
    "environmentFingerprint": "sha256:..."
  }
}
```

## 结果与验证证据

`outcome.record` 以 `dispatchId + attempt` 唯一，旧尝试不可覆盖。工人完成可以记录为
`done + UNVERIFIED`，不能自动升级为总体 PASS。

`evidence.record` 保存证据引用而非证据正文。记录 `PASS` 时必须把证据附到真实
`verifier` dispatch，并提供不同的 `producerDispatchId`；证据记录一经写入不可更新或
删除。`outcome.record(PASS)` 还必须显式提供该独立证据的 `evidenceRefId`。
`request.update(verification:"PASS")` 同样会检查账本内是否已有独立 PASS 证据。任一
dispatch 进入新一轮后，该 request 在最后一次 `dispatch.resumed` 之前产生的 PASS 证据
只保留为历史，不得验证当前轮；新一轮必须重新登记之后产生的独立 PASS 证据。

## 候选引用与价值门

`candidate.ref.record` 只接收治理真源的稳定引用快照：`candidateRef`、
`candidateFingerprint`、`assetVersion`、`governanceSourceId`、环境指纹、资格和状态摘要。
它不接受 mechanism、applies_when、must_not_apply、完整验证正文或完整影响记录。

M0 安全默认值是 `PAUSE`。只有下面五项全部为 `true` 且 `capacityStatus` 为
`available`，调用方请求的 `GO` 才会保留：

- `budgetLocked`
- `samplePlanLocked`
- `pilotClusterLocked`
- `rollbackSlaLocked`
- `governanceEndpointLocked`

`routingEligible` 是账本计算结果，调用方传入的同名布尔值不能强制打开或关闭它。
任何缺失、容量为 `full` / `unknown`、治理真源不可读、候选未通过独立验证、缺少
`canonicalRef`、未达到 `localRecordStatus:"recorded"` 或未启用，都会使它为 `false`。
这组门对 `write_is_activation` 同样完整生效。`sourceStatus:unavailable` 可携带短
`readErrorCode` 和 `lastTrustedAt`，Taskboard 会显示上次可信时间，不推断当前状态。

候选的以下状态始终分开：

- `candidateStatus` / `validationStatus`
- `localRecordStatus`
- `enableStatus`
- `publishStatus`
- `valueGateStage` / `valueGateDecision`

`write_is_activation` 回滚还必须依次记录三个不可互换的时间戳：

1. `orchestratorRouteBlockedAt`
2. `canonicalSourceRolledBackAt`
3. `freshSessionNoLoadVerifiedAt`

后一步没有前一步会被拒绝；已有里程碑不能清除或改写。

## 兼容与失败处理

- schema v2 以只读方式打开时，API 返回 `schemaStatus:"read_only_degraded"`，新字段为空，旧记录
  血缘为 `legacy_unknown`；界面明确说明降级，不制造候选或路由状态。
- 只读命令不会隐式迁移或写业务状态；WAL 模式下只允许 SQLite 自管的同名
  `<db>-wal` / `<db>-shm` 协调文件。它们不得作为迁移或业务写入失败处理。
- 普通写命令遇到旧 schema 返回 `MIGRATION_REQUIRED`；只有显式 `migrate` 才会把
  v2/v3/v4/v5 经 v6 升级到 v7，一次命令即可完成。v6→v7 只重建 `dispatches` 的模型约束，
  并在同一事务中恢复原有索引和非模型触发器，仅替换两项模型守卫；不新增业务事件。
  迁移失败会回滚整个事务并保留旧版本与全部旧行。
- 高于 v7 的 schema 返回 `unsupported_newer_schema` 和 HTTP 409；不会伪装成重连，
  不读取记录，也不修改数据库。
- 并发写入使用 WAL、`BEGIN IMMEDIATE` 和全局幂等键；超时后必须使用相同键回读或
  重试，不能换键绕过唯一约束。
- Taskboard 暂时读不到数据库时保留上次可信快照、版本和时间，并显示正在重连。
- `reconcile` 只接受显式观察；`not_found` / `unknown` 会写成
  `unknown + needsAttention`，不会重新派工。

## 迁移前检查、在线备份与恢复演练

`database.inspect` 以只读模式运行完整性与外键检查，并返回 schema digest、全库 data
digest，以及每张业务表的行数和 digest。它不输出行内容，可用于证明 request、dispatch、
ID、关系、状态、事件和证据在备份、恢复和迁移前后一致：

```json
{"command":"database.inspect"}
```

`backup.create` 使用 SQLite 在线备份 API，从包含活动 WAL 的一致快照生成一个权限为
`0600` 的新数据库。目标必须是绝对路径；目标已存在时返回 `BACKUP_EXISTS`，绝不覆盖。
命令会在发布目标文件前打开临时备份执行完整性、外键、schema digest 和 data digest
验证；失败的临时文件会清理，源账本保持不变。

```json
{"command":"backup.create","destinationPath":"/absolute/private/ignored/ledger.pre-v7.sqlite3"}
```

恢复演练不覆盖现役账本。把第一次备份作为 `NUYOAH_ORCHESTRATOR_DB`，再次执行同一个
`backup.create`，写到另一个全新路径，再对备份和恢复副本分别执行 `database.inspect`。
两者的 `schemaDigest`、`dataDigest` 和每表 digest 必须一致。现役迁移时的最小顺序是：

1. 对现役账本执行 `database.inspect` 并保存迁移前指纹。
2. 对现役账本执行 `backup.create`，再从备份生成新的恢复演练副本。
3. 对备份和恢复副本执行 `database.inspect`，确认完整性、外键和全部 digest 一致。
4. 只在备份副本上先执行 `migrate`，确认 v7 的 data digest 与迁移前完全相同；schema digest
   应变化。
5. 对现役账本执行一次显式 `migrate`，再执行 `database.inspect`；现役迁移前后的
   `dataDigest` 和每表 digest 必须一致，`schemaVersion` 必须为 `7`。
6. 在现役 request 上登记一个真实 GPT-6 verifier dispatch 并用 `request.get` 回读真实 ID。

任一步完整性、外键、数据 digest、历史 ID 或关系不一致，都停止后续步骤。恢复仍只使用
独立新副本；本 CLI 不提供覆盖现役文件的通用 restore 命令。
