# Lite Therapy

**本地优先的 AI 心理咨询 TUI。** 一台只属于你的终端咨询室：有会谈的开始与结束，有可修正的连续性，也有明确的安全边界。

> **状态：M7 评估进行（M6 技术完成；M4 会后队列 6/6；M5 收尾）。M3 技术完成；DeepSeek 短会谈、危机卡与合成摘要已验，自然长对话待验。** 安全层、上下文预算、滚动摘要、预算设置与脱敏审计查看已落地。现在可以完成首次设置、配置模型、开始一场真实模型会谈、停止 / 重试、结束会谈、继续上次会谈与导出 Markdown；会谈会经过本地安全规则、模型复核、危机卡片与上下文预算。**检测不保证覆盖所有风险，也不能替代现实中的紧急支持。**

> **重要声明：** Lite Therapy 是情绪支持与自我探索工具，不提供诊断、治疗、疗效承诺或用药建议，不能替代专业心理咨询、精神科诊疗或紧急服务。AI 咨询师“知微”是模拟角色，不是真人，也不能联系急救。

---

## 现在能做什么

- **首次设置向导**：知情同意 → 启动密码 → 12 词恢复短语（随机抽 3 个词确认）→ 称呼 / 年龄提示 / 时区 → 模型配置与连接测试。
- **真实会谈**：OpenAI-compatible / Ollama；模型设置含 DeepSeek 预设（`https://api.deepseek.com/v1` + `deepseek-flash`）；SSE 流式回复；停止生成；重试最后一条；PgUp / PgDn 滚动。
- **会谈生命周期**：新建、继续当前会谈、继续上次会谈、结束、删除；空会谈自动清理；标题取首条用户消息前 24 个字符。
- **可靠落库**：用户消息与助手回复写入加密 SQLite；流式过程中每 500ms 落一次草稿；崩溃或断电后，未完成的回复标记为中断。
- **会后台账**：消息、token 估算与模型用量写入数据库；会后队列已跑通单次记录 / 纵向理解 / 独立督导 / 备忘录 / 来信 5 个任务；结束会谈进入整理进度页并自动运行，失败可单任务重试；启动时 running 任务重置为 queued；新建会谈可询问是否带入最近 ready 备忘录并冻结；来信有未读提示与阅读页。
- **内部记录只读页**：单次记录 / 纵向理解 / 督导 / 备忘录，带“不是对你的结论”警示；PgUp / PgDn 滚动，不提供编辑。
- **记忆卡**：会谈结束后从原文提取最多 8 条，带来源消息 ID、置信度、敏感度与标签；诊断式断言、方法性内容、无来源条目会被拒绝；文本哈希去重。
- **基础召回**：FTS5 trigram 召回，最多 5 条，过滤敏感/受限与 uncertain；注入为“可能相关的背景”，记录 recall 日志。
- **记忆库**：查看来源消息与会谈、编辑文本、归档、删除；主页显示记忆数量。
- **记忆设置**：全局启用/关闭、敏感记忆是否参与召回；新建会谈可选择“这次不带入过去理解”，该会谈不复用备忘录或记忆卡。
- **记忆筛选与忘记**：按类型、标签与会谈来源筛选；可删除当前筛选结果、按来源会谈删除或清空全部记忆卡，清空同时移除 FTS 索引。
- **冲突标记**：相近但不完全相同的记忆会标为“待确认”，默认不参与召回；用户可在详情里标记为已确认。
- **历史版本**：编辑记忆时保留修改前后文本，详情页可查看历史。
- **召回可解释**：记忆详情列出被哪些会谈引用、评分与日期。
- **命令面板**：主页 Ctrl+K 打开，可新建会谈、会谈列表、来信、记忆、设置、备份、锁定与退出；N/M/L/S 快捷键。
- **帮助与键位**：主页 `?` 或设置入口打开；列出主页/会谈/危机卡键位与安全边界。F1 受 Ink 输入解析限制未映射。
- **主题**：设置页切换深色/浅色；`NO_COLOR` 下不输出 ANSI 颜色，只靠标签与缩进区分。
- **真实光标**：聊天多行输入与单行输入用 Ink useCursor 定位终端光标，便于 IME 候选框跟随。
- **导出**：Markdown / 单会谈结构化 JSON / 全部数据 JSON；导出前再次输入启动密码；文件 0600；全量包含档案、模型配置、会谈与消息、会后最新产物、来信、记忆与历史，不含 API Key。
- **单实例锁**：同一数据目录同时只允许一个 TUI 写入；崩溃留下的陈旧锁会按 PID 判定。
- **Prompt 分层与快照**：冻结知微核心、共同价值、会谈场景、语言风格与模型契约；伦理与安全每轮实时注入；旧 M2 会谈会冻结为自己的 legacy 快照。
- **安全检测**：中英文规则初筛（含否定 / 假设 / 影视 / 第三人称 / 过去时抑制）+ 模型复核（严格 JSON、8 秒超时、失败不回退明确危险）；跨轮升级；风险事件落库，不保存风险原文。
- **危机卡片**：本地规则或分类结果独立触发；提供「我现在安全 / 继续谈 / 查看本地资源 / 结束会谈」，不会自动消失；AI 限制写清楚。
- **本地危机资源**：可选的 `crisis-resources.json`，程序不内置任何热线号码，也不编造号码。
- **上下文预算**：历史原文 24k、触发摘要 12k、单条用户消息 16k token 硬上限；当前表达始终完整保留，旧原文从最新往前保留。
- **滚动摘要**：较早原文被裁剪时增量生成摘要；摘要失败不阻断会谈，保留上一版摘要并记录警告。
- **脱敏审计**：每轮记录消息 ID、角色、token 估算、是否注入摘要 / 备忘录 / 记忆卡与警告，不记录正文。
- **预算设置与审计查看**：设置页可选择精简 / 保守 / 更长三档；最近上下文审计只显示消息 ID、角色、token、是否进入请求与警告，不显示正文。
- **备份与恢复**：手动备份加密数据库、vault.json 与 config.toml；可浏览、输入备份密码并二次确认恢复；恢复前自动生成 pre-restore 安全备份。
- **彻底删除**：警示 → 启动密码 → 输入“彻底删除”短语，删除数据库、vault、配置、日志与手动备份；明确提示 SSD 残留。
- **验证**：39 个测试文件 / 184 个测试；CLI doctor；真实终端（PTY）+ 本地 fake 模型/分类器完成设置、会谈、危机卡与导出；另有 DeepSeek flash 短会谈、6 轮多轮会谈、合成摘要、安全场景与备份恢复验收，见 docs/EVALUATION.md。

## 还不能做什么

- **安全检测仍是概率性的**，会有漏报与误报；危机卡片是补充，不是保证，也不能替你联系急救。紧急情况请直接联系当地急救、危机热线或可信任的人。
- **尚未用真实模型验收**自然长对话与分类失败；DeepSeek 短会谈、危机卡、合成摘要与其他安全场景已验，其余仍用 fake provider。
- **记忆功能只完成基础层**：记忆库页面、全局开关、编辑/归档/删除、敏感条目显式召回、embedding 与冲突标记还没做。
- **整理 worker 只在应用进程内**：结束会谈即自动后台运行，退出最多等待 2 秒；重启解锁后自动续跑 queued 任务。失败任务有 5s/20s/60s 自动退避。
- **语义召回（可选）**：设置记忆向量模型后，新记忆会生成向量，设置页可手动“回填旧记忆向量”；另可设置独立 embedding 端点（如本地 Ollama），聊天与向量服务可分开。未配置时仍是 FTS + 本地文本覆盖率。只为 normal 记忆发送向量请求。
- **本地 embedding 推荐**：中文优先 `qwen3-embedding:0.6b` 或 `bge-m3`；多语言可用 `snowflake-arctic-embed2`；英文且要小体积可用 `nomic-embed-text`。安装后用服务地址 `http://127.0.0.1:11434/v1`，模型名填对应 tag。
- IME 真实终端视觉验收未做；光标定位已接，但换行/极窄终端仍需实测。
- 模型配置 UI 目前只有单档案；分任务模型映射仍未做。DeepSeek flash 已完成短会谈、危机卡 TUI、合成 30 轮摘要、安全场景与备份/恢复/彻底删除副本演练；自然长对话未验收，否定/第三人称 concern 改为非阻断提示。
- 仅 Linux 验证；macOS 的预编译与 CI 尚未补。

## 环境

- Node.js 22 或 24（当前在 Node 24 上验证）。
- Linux 优先；macOS 后续补验证，Windows 暂不承诺。
- 编译 SQLCipher 原生模块需要 Python 3、make、g++；多数平台会优先使用预编译包。

## 快速开始

```bash
npm install
npm run doctor
npm run dev
```

**npm run dev** 首次启动会进入设置向导。完成设置后进入主页；**Ctrl+Q** 退出（会谈中会先确认），**Ctrl+C** 也可从主页退出，**Ctrl+L** 锁定。会谈中若卡片出现，Esc / Ctrl+C 不会绕过它，请先选择一项安全动作。

测试或便携使用可以指定独立目录，不会碰真实数据：

```bash
LITE_THERAPY_HOME="$PWD/.tmp/demo" npm run dev
```

如果只想验证环境：

```bash
npm run doctor
```

它会检查 Node、数据目录、SQLCipher、SQLite、FTS5、迁移、加密库重开、错误密钥、保险库、API Key 加密、配置读写，以及已有文件的权限与落盘形态。

### 模型与数据去向

- 支持 OpenAI-compatible `/chat/completions` 与 Ollama 的兼容端点。
- 除 localhost / 127.0.0.1 外只允许 HTTPS。
- 会谈内容会发送给你显式配置的模型服务商；安全分类也只使用同一个配置发送必要片段。Lite Therapy 没有遥测、云同步或账号体系。
- API Key 只保存在本机，用数据库密钥派生的子密钥加密，不写进 config.toml、日志或导出。
- 危机资源不内置号码；可在配置目录创建 `crisis-resources.json`，只填写自己核对过的当地信息。

### 忘记密码

在锁定屏按 **Tab** 切换到恢复模式，输入 12 词恢复短语，再设置新的启动密码。恢复短语只在首次设置时显示一次；忘记密码且丢失短语，数据无法恢复。

## 命令

| 命令 | 说明 |
|---|---|
| npm run dev | 启动 TUI |
| npm run doctor | 检查加密、迁移、保险库、密钥、配置与文件权限 |
| npm run build | 构建 dist/cli.js |
| npm run typecheck | TypeScript 检查 |
| npm run lint | Biome 检查 |
| npm test | Vitest（39 个文件 / 184 个测试） |
| npm run check | typecheck + lint + test |
| npm run eval:safety | 本地安全规则评估，不调用模型 |
| npm run check:licenses | 检查运行时依赖许可证 |
| npm run check:secrets | 扫描仓库中的明显密钥 |
| npm run release:check | 发布前一键检查 |
| npm run spike:sqlcipher | 单独跑 SQLCipher + FTS5 验证 |
| npm run spike:vault | 单独跑保险库验证 |

真实模型验收、场景清单与发布检查见 [docs/EVALUATION.md](docs/EVALUATION.md)。

## 数据位置

Linux 默认：

- 数据：`$XDG_DATA_HOME/lite-therapy`（默认 `~/.local/share/lite-therapy`），数据库 `counsel.db`、迁移备份、手动备份与 `exports/`。
- 配置：`$XDG_CONFIG_HOME/lite-therapy`（默认 `~/.config/lite-therapy`），`vault.json`、`config.toml`、`secrets.enc`、可选的 `crisis-resources.json`。
- 日志：`$XDG_STATE_HOME/lite-therapy/logs`。
- `LITE_THERAPY_HOME` 可整体覆盖，便于测试与便携使用。

数据库（含 WAL/SHM）、保险库、配置、密钥文件与导出文件权限均为 0600，目录为 0700。配置文件中不保存 API Key。

## 目录

```text
src/
├─ cli.tsx                  CLI 入口与 doctor
├─ config/                  配置、原子写、路径
├─ core/
│  ├─ counseling/           M2 legacy 系统提示（仅用于旧会谈快照）
│  ├─ safety/               风险类型、本地规则、严格 JSON 分类器
│  ├─ tokens.ts             token 估算
│  ├─ endpoint.ts           base URL 归一化与 HTTP/HTTPS 边界
│  └─ version.ts            应用名、版本、免责声明
├─ prompts/
│  ├─ counselor/            知微核心、会谈场景、语言风格
│  ├─ shared/               共同价值、实时伦理、实时安全
│  ├─ model/                模型契约
│  └─ loader.ts             快照、哈希、实时层与 legacy 回退
├─ db/
│  ├─ database.ts           SQLCipher 打开、PRAGMA、文件权限
│  ├─ backup.ts             VACUUM INTO 加密备份
│  ├─ migrations/           001_init、002_sessions、003_safety、004_context_audit_entries、005_post_session、006_memory、007_session_memory_switch、008_memory_history
│  └─ repositories/         profile / session / message / usage / risk / summary / audit / post-session / memory
├─ security/                保险库、密钥、文件权限
├─ providers/
│  ├─ openaiCompatible.ts   SSE 流式、错误映射、取消与超时
│  └─ connectionTest.ts     /models → 最小 chat 的连接测试
├─ services/
│  ├─ appService.ts         设置 / 解锁 / 恢复 / 锁定 / 会谈与导出编排
│  ├─ sessionService.ts     会谈生命周期、消息写入与 Prompt 快照
│  ├─ chatService.ts        流式生成、安全评估、部分回复、重试、用量
│  ├─ safetyService.ts      规则 + 模型复核、跨轮升级、风险落库
│  ├─ contextService.ts     预算、裁剪顺序、摘要注入与脱敏审计
│  ├─ summaryService.ts     滚动摘要生成与增量更新
│  ├─ postSessionService.ts 会后队列（记录 / 纵向理解 / 督导 / 备忘录 / 来信）
│  ├─ memoSnapshot.ts      会谈创建时冻结的备忘录快照
│  ├─ memoryService.ts      记忆提取校验、去重与基础召回
│  ├─ crisisResources.ts    本地危机资源读取
│  ├─ exportService.ts      Markdown 导出
│  ├─ instanceLock.ts       单实例锁
│  ├─ setupPolicy.ts        恢复短语挑战与密码校验
│  ├─ lockout.ts            失败递增等待
│  └─ doctor.ts             自检（CLI 与设置页共用）
├─ i18n/zh-CN.ts            中文文案集中管理
├─ ui/
│  ├─ App.tsx               路由、自动锁定与会话切换
│  ├─ components/           输入、选择列表、页面框架
│  └─ screens/              设置向导、锁定、主页、会谈、危机卡、整理进度、内部记录、列表、来信、记忆、模型、设置、自检
└─ types/                   SQLCipher 包的类型 shim
tests/                      保险库 / 数据库 / 迁移 / 会谈 / 上下文 / 会后 / Provider / TUI
spikes/                     SQLCipher、保险库、Ink 壳
docs/REQUIREMENTS.md        v0.1 需求与设计基线
```

## 设计要点

- **当前表达优先**：M3 还没有备忘录与长期理解，因此不会用旧理解压过来访者此刻的话。
- **连续性靠冻结的备忘录**（M4）：旧原文和长期档案不直接倒进上下文；记忆卡是次要补充。
- **Prompt 可冻结，伦理实时更新**：旧会谈使用自己的快照；AI 披露、非诊断、危机转介与不提供方法每轮注入。
- **安全是双通道**：本地规则先拦截，疑似时再用模型复核；危机卡片不依赖主模型“想起来”。规则和模型都可能漏判，卡片不是保证。
- **数据默认只在本机**：SQLCipher 加密，API Key 单独加密，配置与导出不含密钥。
- **干净实现**：不复制 Open-Ling 或 VCP 的代码；只借鉴架构与流程。见 [NOTICE](NOTICE) 与 [docs/PROVENANCE.md](docs/PROVENANCE.md)。

## 安全与隐私

- 不是医疗器械，不宣称诊断、治疗或疗效。
- **M3 有规则、模型复核与危机卡片，但检测是概率性的，会有漏报与误报**；遇到紧急情况请直接联系当地急救、危机热线或可信任的人，不要等待应用提示。
- 危机场景只提供通用指引，不内置具体热线号码；发布前请自行核对所在地区的资源。
- 当前版本没有遥测、没有云同步、没有账号体系。
- 会谈内容会发送给你配置的模型服务商；安全分类与滚动摘要也使用同一配置发送必要片段，这是使用模型功能的必要条件。
- 终端滚动缓冲区、截图与录屏不在威胁模型内。恢复短语只在设置时显示一次，但当时可能留在终端回滚里。
- 内存密钥无法保证被 JavaScript 垃圾回收彻底擦除；锁定时会主动清零并丢弃引用。
- 释放内存、备份与磁盘残留的边界见规格第 8 节。

## 文档

- [交接档 HANDOFF.md](HANDOFF.md)
- [给后续 AI 代理的规则 AGENTS.md](AGENTS.md)
- [进度 docs/PROGRESS.md](docs/PROGRESS.md)
- [v0.1 需求与设计基线](docs/REQUIREMENTS.md)
- [来源与 clean-room 边界](docs/PROVENANCE.md)
- [NOTICE](NOTICE)

## 许可

代码采用 [Apache-2.0](LICENSE)。文档与原创 Prompt 计划采用 CC BY 4.0；正式发布前会在规格与 NOTICE 中同步。

## 致谢

设计受 [Open-Ling](https://github.com/Ling-Team/Open-Ling)（Apache-2.0）与 [VCPToolBox](https://github.com/lioensky/VCPToolBox)（CC BY-NC-SA 4.0）启发。未复制其代码、角色、素材或 Prompt 原文，也不表示对方认可或背书。详见 [NOTICE](NOTICE)。
