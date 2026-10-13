# Nuyoah Codex Workstation

一个直接长在 Codex / ChatGPT 桌面界面里的本地一体化工作站。

它保留中间的原生对话，把项目上下文、Taskboard、当前可调用 Skills 和本地资产统一放进右侧工作站；左侧通过顶部项目切换和双列胶囊卡片快速打开原生对话。用户只需要一个“工作站”入口，不需要在多个独立工具间来回切换。

当前版本：**0.33.1**。公开源码：[nuyoah-ai-works/nuyoah-codex-workstation](https://github.com/nuyoah-ai-works/nuyoah-codex-workstation)。更新记录见 [CHANGELOG.md](./CHANGELOG.md)。

自 2026-09-02 起，本仓库是唯一现役产品线。旧 Swift Sidecar 已只读归档到
`<archive-root>/Nuyoah Codex Workspace Swift/2026-09-02/`，不再用于开发、安装或运行。

## 已实现的第一条完整链路

- 中央聊天支持四宫格：每格可独立新建会话、选择会话工作文件夹，或打开本机、已配置远程设备的已有对话，独立输入与滚动；工作站跟随当前选中格，任务卡直接进入该格。拖动边界调整大小，支持单格放大、恢复比例与返回单聊。复用宿主原生组件与任务连接，兼容性失败时恢复单聊。
- 新会话可使用原生模型与推理强度选择；用户发送后，回读真实任务工作目录并核对选中文件夹。
- 项目三页采用轻工具栏与按需详情：任务地图占据主视区，当前项目突出摘要和最近产出，工作事项保持简洁画布；浅深色和字号设置跟随宿主。
- 事项库为空时保留创建入口，不再自动灌入项目历史任务。

- 任务地图可就地选卡，补充要求、拆出子任务、将成果交给主任务继续；明确发送才影响真实对话，布局操作保持独立。
- 项目名称完整换行显示，项目与组内任务胶囊支持拖动或 Alt+方向键排序，并记住自定义顺序。
- 左侧以顶部横栏切换项目、双列胶囊卡片展示对话；“工作站”入口位于对话顶部栏，保留 `/工作站` 命令入口。
- 右侧统一使用 `项目 / 任务 / 技能 / 资产` 四个顶层 Tab。
- 切换模块时不离开当前对话，不丢失输入框和滚动位置。
- “项目”读取当前任务与项目关系，展示项目内任务、执行中数量和可用 Skill 数量。
- 对话按今天、昨天、更早分组，保留一行摘要；按设备与任务身份复用卡片，并分别记住各项目筛选与滚动位置。主题、字体、焦点与原生界面一致，注入失败恢复原生导航。
- 点击项目内任务时，转交给 Codex 原生任务行完成跳转。
- 当前对话的“关联任务”与“本任务产出”集中展示可打开的任务和明确交付文件；
  大对话仍可收录近期记录，文件可直接只读预览。安装与验收边界见更新记录。
- Taskboard 保留并显示任务创建时的执行目录；旧目录不存在时明确标记为失效，可靠
  绑定到已迁移项目时才另行显示当前项目目录，不改写 Codex 历史记录。
- Taskboard 任务卡片收紧留白；“委托”视图接入已有的本机总管账本，优先显示需要关注和
  进行中的委托，可打开当前任务目录中可定位的来源或子任务。较早的结束记录、路由原因、
  分层验证、治理候选引用和价值门按需展开；工人完成、本地固化、启用与发布互不冒充。
- “Skills”优先调用 Codex 本机 `app-server` 的 `skills/list`，只展示当前工作区真实可调用的个人、系统和已启用插件 Skill；运行时不可用才降级到兼容扫描。卡片显示本地生成的中文标题、30–60 字中文简介和原始调用名；“当前任务”会按任务标题与项目绑定筛选，右上角刷新按钮会重新读取当前可调用清单，不扫描整个硬盘。
- Skills 支持八个用途分类、分类数量与卡片标签，可配合搜索筛选；新出现的名称进入“未分类”，不读取或修改 Skill 源文件。
- 工作站顶部导航、项目页和 Skills 页默认使用 17px，可在 11–18px 范围内按 1px 调整并本地记忆；按钮、图标和面板尺寸不随之缩放。
- Taskboard 复用固定上游；资产使用独立的只读目录、索引和预览服务，统一在工作站外壳内。
- 资产分为“项目文件 / Eagle / 当前任务”，通过“导入文件夹”明确添加来源；清空后不会自动恢复旧目录。
- Eagle 来源保留所选文件夹下面的目录树，可按子文件夹浏览，空目录和同名目录也有独立位置。
- 来源名称和左侧箭头都能展开或收起目录；从子目录点来源名称返回该来源全部资产。
- Eagle 只收录有效原文件，忽略删除标记和内部文件；每页最多 60 项，图片只加载缩略图。
- 资产原文件不可编辑、移动或删除，移除来源只清理索引；插入前核对文件仍然存在。
- Skill 与资产都通过明确的“插入到任务”按钮写入当前输入框，不自动发送。
- 记住上次打开的工作站模块与面板宽度。

## 产品结构

```text
Codex 原生窗口
├── 左侧：原生项目与任务 + 单一“工作站”入口
├── 中间：原生对话与输入框
└── 右侧：Nuyoah Workstation
    ├── 项目
    ├── Taskboard
    ├── Skills
    └── 资产
```

## 源码边界

- `inject/`：注入 Codex 页面、统一工作站外壳与交互。
- `lib/`：会话、项目、Skill 兼容扫描与安装配置。
- `nuyoah/`：Nuyoah 自有适配层。目前包含 Codex 运行时 Skill 目录适配器。
- `vendor/`：固定版本的 Taskboard 与资产模块。
- `scripts/`：运行时、安装、诊断和 GUI 验收脚本。
- `test/`：确定性合约与回归测试。

当前体验与状态语义见 [PRODUCT.md](./PRODUCT.md)。上游来源、固定提交和本地改动见
[UPSTREAM.md](./UPSTREAM.md)。项目规则见 [AGENTS.md](./AGENTS.md)。
大总管接管与机器可读字段见 [ORCHESTRATOR_LEDGER.md](./ORCHESTRATOR_LEDGER.md)。

## 本地验证

首次公开版尚未启用 GitHub Actions，以下检查在本地运行：

```bash
npm ci
npm test
npm run test:taskboard
```

委托页首次使用时，指定已有总管账本的 SQLite 文件；工作站只读打开它，并将配置保存
在当前用户的 Application Support 中。可用 `status` 检查连接来源，`clear` 移除保存的
配置。设置后重新加载工作站增强器，界面会显示已有委托。

```bash
node scripts/configure-orchestrator-reader.mjs set '/绝对路径/总管账本.sqlite3'
node scripts/configure-orchestrator-reader.mjs status
```

只读验证当前 Codex 是否能返回真实 Skill 清单：

```bash
node --input-type=module -e 'import("./nuyoah/skills/runtime-catalog.mjs").then(async ({readRuntimeSkillCatalog}) => console.log((await readRuntimeSkillCatalog({cwd: process.cwd()})).length))'
```

## 本地安装

需要 Node.js 22.5 或更新版本，以及已安装的 Codex / ChatGPT 桌面应用。macOS 与 Windows 提供本地安装入口。先克隆本仓库、检查源码，再运行本地脚本：

```bash
git clone https://github.com/nuyoah-ai-works/nuyoah-codex-workstation.git
cd nuyoah-codex-workstation
npm ci
```

macOS：

```bash
CODEX_SIDEBAR_SOURCE_DIR="$PWD" bash install.sh
```

Windows PowerShell：

```powershell
$env:CODEX_SIDEBAR_SOURCE_DIR = (Get-Location).Path
.\install.ps1
```

安装会沿用上游的兼容运行时名称和用户目录，避免与已有本机数据、LaunchAgent 和卸载逻辑断裂。它不会修改应用包或对话文件，但为了挂载页面增强，首次启用时需要让 Codex / ChatGPT 以本地调试端口重新打开。

本地 Commit 可以回退代码版本，但不能替代跨设备或设备故障备份。

维护者每次更新会同步版本号并创建本地 Commit。公开仓库从通过检查的源码快照发布；
本机历史、运行数据、日志、截图和会话记录不包含在公开版本中。后续远端更新需要维护者明确授权。

## GUI 验收

完成本地安装并以 `9231` 调试端口启动桌面应用后运行：

```bash
node scripts/verify-workstation.mjs
```

该脚本验证单一入口、四个 Tab、模块切换、真实 Skill 内容和关闭行为。当前对话承载开发任务时不要中途安装或重启；先完成静态与运行时验证，再单独执行 GUI 验收。

## 隐私与副作用

- Codex 会话和项目索引只读。
- Skill 清单优先由 Codex 官方本地运行时返回，不把缓存目录当成启用状态。
- 本地服务只监听 `127.0.0.1`。
- Skill 与资产不会自动发送到对话。
- 不修改 `/Applications/ChatGPT.app`、`/Applications/Codex.app` 或 `app.asar`。

## License

本项目基于 `yubowen123/codex-sidebar-enhancer` 的 MIT 授权源码继续开发。详见 [LICENSE](./LICENSE) 与 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

## 本机任务工作台

项目页新增当前任务的接续摘要、独立笔记、产出与引用。默认阅读摘要，
需要手动修改时点击“编辑摘要”；“请助手更新”只预填维护请求，不自动发送。
保存遇到冲突时重新读取，草稿保留供合并。引用不存在时标记失效，不读取正文。

任务记录位于用户 Application Support 的
`Codex Sidebar Enhancer Data/Workstation/tasks/<threadId>.json`。
助手可用 `node scripts/task-context.mjs read <threadId>` 读取；
更新使用 `node scripts/task-context.mjs update <threadId> summary <JSON文件> <revision>`。
JSON 为 summary 对象，可含 goal、progress、nextStep、agreements、assistantVerification、
userConfirmation 六个文本字段。notes 为独立字符串，references 为独立数组；
更新 summary 不覆盖另外两区。摘要不是新授权，不将助手推测写成用户确认。

同一 Workstation 目录的 `preferences.json` 支持：

```json
{ "skills": { "categories": [{ "label": "写作", "keywords": ["写作", "文章"] }], "defaultFavorites": ["nuyoah-writer"] } }
```

分类使用普通关键词，不执行正则；初始收藏使用原始 Skill 名称，不覆盖已有收藏。
省略配置沿用现有分类。修改后重新加载增强器后台。

资产页可按来源、类型、文件夹、标签搜索筛选，并切换网格或列表。
通过“导入文件夹”添加来源。导入 Eagle 内的指定文件夹时，选择“Eagle 文件夹”，
填入 `.library` 资料库根目录路径，读取文件夹清单并选中目标；资产页只收录该文件夹
及其子文件夹，不修改 Eagle 原件。同一资料库可导入多个文件夹或整个资料库。
需要查看新增文件时点击“刷新”。
Office 提取正文，HTML 显示源码，PDF 等格式提示在本机打开。媒体预览有尺寸、
响应体积和并发限制；文件本身不会被修改。0.7 的新目录与旧索引分离，不自动导入旧配置。

本次未安装摘要 Hooks、每轮默认 Skills，也未引入上游的文件修改功能。

## 工作事项与计划

打开 **工作站 → 项目 → 工作事项**，记下一件要推进的事，填写方向、下一步并关联相关任务。事项可以暂时没有任务，也可以汇集跨项目的多个任务。重点事项排在前面；已结束的事项可归档和恢复。

默认以画布展开方向、事项和关联任务。拖动节点调整位置，拖动画布空白处平移，使用缩放按钮或 Ctrl/Command + 滚轮缩放；“适应全部”找回全图，“整理布局”恢复自动排布。布局与视口在本机保存，拖动不会改变事项内容或状态；仍可切回列表。

复杂事项再添加计划节点，用可拖动的计划画布或列表查看和编辑。点击节点打开编辑区，记录状态由助手按已知进展维护，手动选择的显示状态优先；选择“跟随记录”即可取消覆盖。打开关联任务后，继续使用原有的目标、进展、摘要和产出。事项完成与任务是否正在执行分别记录。

日常使用可以直接让 Codex“把这件事记入工作事项，并关联相关任务”，或“读取这个事项，继续下一步”。界面中的“请助手更新”会把对应事项的维护请求放进输入框，发送后执行。适合跨多次任务的工作；一次性的简单问题不用建立计划。

助手与界面使用同一份记录：

```sh
node scripts/work-items.mjs read
node scripts/work-items.mjs read <事项ID>
node scripts/work-items.mjs save <完整事项JSON文件> <刚读取的revision>
node scripts/work-items.mjs archive <事项ID> <刚读取的revision>
node scripts/work-items.mjs restore <事项ID> <刚读取的revision>
node scripts/work-items.mjs export
node scripts/work-items.mjs --help
```

维护时只更新已知进展、下一步及必要节点，保留稳定节点 ID 与手动状态；结构变化应有明确原因。没有实质变化就不保存。任务停止运行不等于事项完成，记录也不构成新的执行授权。文件保存在现有工作站数据目录，版本冲突时保留草稿并重新读取，旧记录不自动淘汰；JSON 可导出留存。

任务地图位于“工作站 → 项目 → 任务地图”：默认只看当前对话的实际关联，可切换当前项目或全局。父子、派生与关联分别连线；卡片以中文名称和任务说明为主，运行时显示绿色呼吸边框、扫光和脉冲点；等待或结束时停止。确认完成后显示 6 秒“已完成”再自动收起，可展开回看，续接运行时重新出现。收起不删除或归档对话，当前对话与仍连接进行中任务的父节点保留。每种范围独立记住布局。从地图进入子任务后，点击地图顶部“返回上一对话”可逐级回到来源对话，并恢复原来的地图范围与布局。
