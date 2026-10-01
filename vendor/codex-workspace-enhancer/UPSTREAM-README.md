# Codex Workspace Enhancer

把 Codex 的任务侧栏、Skill 目录和本地素材工作流接成一个连续工作台。

![Codex Workspace Enhancer 一图流](docs/codex-workspace-enhancer-onepage.png)

## 它解决什么

- **任务更好找**：任务摘要、最近输入/输出、项目筛选、最近使用排序和卡片视图。
- **入口更顺手**：保留高频入口，把低频站点与插件收进次级位置，并加入 Skill 管理。
- **Skill 不再堆成一长列**：常用置顶、按工作类型归类、相关 Skill 合并为可展开组，支持搜索与收藏。
- **资产直接接进任务**：在不遮挡对话的右侧面板打开资产控制台，新建项目和文件夹、改名、切换层级、移动与自动整理。
- **回到对话但不替你发送**：最多附加 8 个本地绝对路径，只写入输入框，不自动提交。
- **额度显示以原生数据为准**：只展示 Codex 自己记录的剩余比例与重置时间，不做猜测。

## 安装

### 推荐：完整 Skill 包

从 [Latest Release](https://github.com/q2522879285-source/codex-workspace-enhancer/releases/latest) 下载 `codex-workspace-enhancer-skill.zip`，解压到（压缩包内已经包含 `codex-workspace-enhancer` 目录）：

```text
%USERPROFILE%\.codex\skills
```

然后在 PowerShell 中运行：

```powershell
powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\.codex\skills\codex-workspace-enhancer\scripts\install-bundled.ps1"
```

完整包会安装侧栏增强器和本地资产服务，并保留已有项目配置、素材与台账。

### 只安装侧栏前端

下载 `codex-sidebar-enhancer-windows.zip`，解压后运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
```

前端包适合已经有兼容 AssetBrowser 本地服务的环境。

## 主要能力

### 任务工作台

- 双列卡片 / 列表切换
- 任务摘要与最近消息预览
- 项目模糊搜索、最近使用优先
- 置顶 / 项目 / 最近分组
- 当前任务项目与资产上下文同步

### Skill 管理

- 常用 Skill 置顶
- 按视频创作、导演镜头、画面风格、资产工作台、写作研究、工具管理等分类
- 动作、Seedance 等相关 Skill 合并成折叠组
- 搜索、收藏、完整原生列表与原生详情保留
- 键盘和减少动态效果设置可用

### 资产控制台

- 内嵌 Codex 右侧面板，不新开窗口、不遮挡当前对话
- 新建项目 / 新建文件夹 / 文件夹改名
- 多扫描根与多层目录切换
- 移动到项目、按类型自动整理、撤销
- 待处理 / 项目素材 / 精选库工作流
- 缓存、近屏加载与异步防串页
- 附加路径后返回当前任务并聚焦输入框

## 隐私与安全

- 只监听 `127.0.0.1`，不对外提供服务。
- 资产 API 使用安装时生成的本地随机令牌。
- 不上传任务、素材、额度或 Skill 内容。
- 不修改 Codex 应用包，也不修改对话正文。
- 安装和卸载只操作产品专属目录；已有资产配置和媒体不会被清空。
- 默认只接收已经登记的生图/生视频任务：能识别当前任务或绑定项目的结果会直接归档，无法判断归属的生成结果进入“待确认”。普通下载文件不会被扫描、复制或移动。
- 浏览器生成结果必须通过资产 ID、准确文件名或直接文件绑定；不会再按“下一个下载文件”猜测归属。

## 本地开发

需要 Node.js 22 或更高版本：

```powershell
npm install
npm test
npm run inject
```

构建可发布安装包：

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\build-release.ps1
```

## 兼容性

- 主要支持 Windows 版 Codex 桌面应用。
- 侧栏适配依赖桌面端界面结构；Codex 大版本升级后可能需要同步适配。
- macOS 旧版注入与卸载脚本仍保留在源码中，但完整资产工作台以 Windows 为主。

## License

[MIT](LICENSE)
