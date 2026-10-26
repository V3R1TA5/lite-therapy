# Lite Therapy — 交接档

> 状态：M3 技术完成；DeepSeek flash 短会谈、危机卡 TUI 与合成长上下文摘要验收通过；自然长对话待验收；M4 会后队列 6/6；M5 可选 embedding 已接；M6 技术完成；M7 评估进行中
> 更新：2026-10-26
> 仓库标识：lite-therapy
> 产品名：Lite Therapy
> 咨询师人设：知微

这份文档是给“移动目录后重开对话”的接续说明。先读它，再读 **docs/REQUIREMENTS.md** 与 **docs/PROGRESS.md**。

---

## 0. 30 秒确认

在项目根目录执行：

~~~bash
pwd
git status --short --branch
npm run doctor
~~~

期望：

- pwd 以 lite-therapy 结尾。
- git 仍显示 No commits yet（当前仓库还没有首个提交）。
- doctor 全部 PASS。

如果 pwd 还是 Agent_Psycho，说明目录还没移动，按第 1 节处理。移动不会改变任何相对路径。

---

## 1. 目录改名（如果还没做）

先确认目标不存在：

~~~bash
ls -d /home/sishen/Projects/lite-therapy 2>/dev/null
~~~

然后移动：

~~~bash
cd /home/sishen/Projects
mv Agent_Psycho lite-therapy
cd lite-therapy
~~~

.git、node_modules、docs、src 会一起移动；原生模块使用相对路径，移动后不需要重装。

---

## 2. 当前状态

**M3 技术完成：Prompt 分层、快照、规则 + 模型复核、危机卡、上下文预算、滚动摘要、预算设置与审计查看已落地；DeepSeek 短会谈与合成摘要已验，自然长对话还没做。M4 会后队列与单次记录 / 纵向理解 / 督导 / 备忘录 / 来信落地；M5 记忆提取（第 6 类任务）与基础召回已接。**

现在能跑：

- 首次设置：知情同意、启动密码、12 词恢复短语展示与随机 3 词确认、称呼 / 年龄提示 / 时区、模型配置与连接测试，模型可暂时跳过。
- 保险库与锁定：create / unlock / recover / rewrap；手动锁定与 0/5/10/30 分钟闲置自动锁定；失败递增等待；锁定时先停止流式并等待落库，再清空内存密钥。
- 真实会谈：OpenAI-compatible / Ollama；SSE 流式；停止、重试、PgUp/PgDn 滚动；单实例锁。
- 会谈生命周期：新建、继续当前、继续上次、结束、删除；空会谈清理；标题取首条用户消息前 24 字。
- 持久化：sessions / messages / model_usage；流式草稿每 500ms 落库；崩溃后 streaming 标 interrupted；消息与 token 估算入库。
- 导出：Markdown 或 JSON，导出前再次验证启动密码，文件 0600；默认含来信，备忘录/记忆卡/内部记录需勾选；不含 API Key。
- TUI：设置向导、锁定屏、主页、会谈、会谈列表、危机卡、模型配置、设置、数据去向、系统自检、关于。
- Prompt：冻结 core / values / dialogue / voice / contract；伦理与安全每轮实时注入；M2 旧会谈冻结为 legacy 快照。
- 安全：规则初筛 + 模型复核 + 跨轮升级 + risk_events；危机卡动作与本地资源；不内置号码。
- 上下文：历史 24k / 摘要触发 12k / 单条 16k token；设置页三档可调；摘要增量更新；审计只记 ID、token 与警告。
- 会后：005 队列；结束会谈进入进度页自动运行六类任务；5s/20s/60s 退避；备忘录五段结构校验；继续会谈失效；备忘录带入；来信信箱；内部记录只读。
- 39 个测试文件 / 184 个测试、构建、真实 PTY + 本地 fake 模型/分类器冒烟。
- 规格、进度、来源说明、NOTICE、Apache-2.0、CI。

现在还不能：

- 自然长对话验收；DeepSeek flash 短会谈、危机卡 UI 与合成 30 轮摘要已验，但不能据此说“安全”。
- **M4 完成 6/6 个会后任务**：记忆提取由 M5 接入；结束即后台 worker、退出最多等 2 秒、解锁自动续跑、整理进度页、单任务重试、5s/20s/60s 退避、启动 running→queued、备忘录带入、来信信箱与内部记录只读页已接。
- 记忆：记忆卡提取/召回/记忆库/开关/导出勾选/冲突确认/历史版本/覆盖率评分/可选 embedding 召回/手动回填已接；支持独立 embedding 端点（如 Ollama）；敏感卡不发送向量请求。
- IME 真实终端视觉验收；备份、恢复、彻底删除、JSON 导出、主页命令面板、主题/NO_COLOR、真实光标已接。
- 多模型档案 UI 与分任务模型覆盖。
- macOS / Windows 验证。

这些属于 M3–M7。完整范围见 **docs/REQUIREMENTS.md** 第 4 节与第 16 节。

---

## 3. 五分钟验证

~~~bash
npm run doctor
npm run typecheck
npm test
npm run build
~~~

期望：

- doctor 全部 PASS，包括 migrations（001_init + 002_sessions + 003_safety + 004_context_audit_entries + 005_post_session + 006_memory + 007_session_memory_switch + 008_memory_history）、sqlcipher、fts5、reopen、wrong_key、vault、secrets、config、setup 与文件权限。
- typecheck 无输出。
- test 显示 39 个测试文件、184 个测试全部通过。
- build 产出 dist/cli.js，无报错。

想手动看界面：

~~~bash
npm run dev
~~~

首次运行会进入设置向导。配置模型后可以新建会谈；Ctrl+K 打开会谈菜单，Esc 停止生成，Ctrl+R 重试，Ctrl+L 锁定，Ctrl+Q 退出（会谈中先确认），Ctrl+C 从主页退出。锁定屏或闲置会自动锁定。

想从干净目录完整走一遍，不会碰真实数据：

~~~bash
LITE_THERAPY_HOME="$PWD/.tmp/demo" npm run dev
~~~

如果依赖缺失（例如 node_modules 被删）：

~~~bash
NODE_ENV=development npm install --include=dev
~~~

当前 shell 可能全局设置了 NODE_ENV=production，直接 npm install 会裁掉 devDependencies。

---

## 4. 已完成内容

### M5 已落地（进行中，基础层）

- **006_memory**：memory_cards、memory_recalls、memory_cards_fts（trigram）；文本哈希、来源消息、敏感度、uncertain、召回日志。
- **MemoryService**：会谈后提取最多 8 条；拒绝诊断式断言、方法性内容、缺失来源；文本哈希去重；FTS5 候选 + 覆盖率/置信度/新鲜度/重复惩罚排序；敏感/受限默认不召回。
- **ChatService**：每轮用最近消息召回最多 5 条，注入为“可能相关的背景”，审计 memoryUsed，记录 recall 日志；全局开关关闭时不召回，敏感条目需显式开启。
- **记忆库**：来源消息与会谈、召回记录与评分、编辑文本与历史版本、归档、删除、按类型/标签/会谈筛选、删除当前筛选结果、按来源会谈删除、清空全部；主页入口。
- **记忆设置**：全局启用/关闭、敏感记忆参与召回、单次会谈关闭过去理解。
- **导出勾选**：默认对话 + 来信；备忘录、记忆卡、内部记录显式勾选后写入，文件 0600。
- **全量 JSON**：设置页输入密码后导出档案/模型配置/全部会谈与消息/会后最新产物/来信/记忆与历史，不含 API Key。
- **冲突标记**：相近但不同的记忆标 uncertain，默认不召回；详情可“标记为已确认”。
- **测试**：memoryService（7）、memory UI（5）、chatService 召回/开关（3）、单次会谈开关（1）、迁移 001–008。
- **语义召回**：配置向量模型后，新记忆写入向量，召回合并 FTS 与余弦；未配置时回退 FTS + 覆盖率。旧卡片无向量。

### M4 已落地（技术完成，6/6 任务）

- **005_post_session**：session_notes、case_formulations、supervisions、memos、letters、post_session_jobs；任务唯一键与 ready 备忘录唯一索引。
- **src/services/postSessionService.ts**：串行 session_note → case_formulation → supervision → memo → letter → memory；纵向理解版本递增，督导独立审阅，备忘录五段结构校验；source_ended_at 双守卫；继续会谈标 stale；来信独立。
- **备忘录带入**：新建会谈询问是否带入最近 ready 备忘录，冻结为 memory_snapshot_json；ChatService 注入并记录 memoUsed。
- **来信信箱**：未读计数、阅读页、已读标记；主页入口。
- **整理进度**：结束后自动进入 PostSessionScreen；串行运行、轮询状态、失败单任务重试、完成/失效提示；主页可再次打开。
- **内部记录只读页**：单次记录 / 纵向理解 / 督导 / 备忘录，带警示与 PgUp/PgDn 滚动，不提供编辑。
- **启动恢复**：openDatabase 把 running 任务重置为 queued；解锁后自动续跑 queued 任务。
- **退避重试**：失败任务按 5s/20s/60s 重试，最多 3 次；测试可注入零延迟。
- **src/db/repositories/postSessionRepository.ts**：任务状态、notes / memos / letters 读写、未读来信计数。
- **AppService**：结束会谈后自动入队并后台运行；runPostSession / retryPostSession 共享 promise；退出最多等 2 秒；继续会谈归档 ready 备忘录并标 stale。
- **测试**：postSessionService（5）覆盖六任务、失效、备忘录失败、启动恢复与退避重试；AppService（7）覆盖入队、后台共享 promise、重启解锁续跑与备份。
- **未完成**：真实模型长会谈验收；M4 技术路径已完整。

### M3 已落地（技术完成；DeepSeek flash 短会谈已验，长上下文待验）

- **src/prompts/**：counselor/core、shared/values、counselor/dialogue、counselor/voice、model/contract；shared/ethics 与 shared/safety 实时注入；loader 负责快照、哈希、legacy 回退。
- **snapshot**：新建会谈写入 `prompt_snapshot_json`；解析时校验每层 SHA-256 与总哈希；旧 M2 会谈首次继续时冻结为 `legacy/m2`。
- **003_safety / 004_context_audit_entries**：risk_events、rolling_summaries、context_audits，以及每轮消息级 entries_json（ID/角色/token/included）。
- **src/core/safety/**：风险类型、规则扫描、否定 / 假设 / 影视 / 第三人称 / 过去时抑制、模型分类器（严格 JSON、8 秒超时）。
- **src/services/safetyService.ts**：规则 + 模型复核、跨轮升级、risk_events 落库、消息与会话风险标记；风险原文不落库。
- **ChatService**：发送前安全评估、按 level 注入安全强调、重试复用/重新评估、busy 标志防并发。
- **危机卡**：`src/ui/screens/CrisisCard.tsx`，不可用 Esc/Ctrl+C/Ctrl+Q 轻易关闭；动作「我现在安全 / 继续谈 / 查看本地资源 / 结束会谈」。
- **本地资源**：`src/services/crisisResources.ts`，可选 `crisis-resources.json`，默认空，不内置号码。
- **上下文预算**：`src/services/contextService.ts`；历史 24k、摘要触发 12k、档案 800、备忘录 1500、记忆卡 1200、单条 16k token；当前表达始终完整。
- **滚动摘要**：`src/services/summaryService.ts`；按 token 分块、增量更新、失败保留上一版并记录警告；`summaryRepository` 记录 covered_until。
- **审计**：`contextAuditRepository` 每轮写入 message_id、role、token、included、注入项与 warnings，不记录正文；doctor 检查 context_audits 表。
- **预算设置**：AppConfig.context（history / summaryTrigger / recentTarget）；设置页提供精简 / 保守 / 更长三档；ChatService 按配置注入预算。
- **审计查看**：设置页「最近上下文审计」只展示时间、token、消息数、裁剪/摘要、消息条目计数与警告，不显示正文。
- **测试**：prompts（4）、safetyRules（9）、riskClassifier（3）、safetyService（7）、crisisResources（4）、crisisCard TUI（2）、contextService（7）、homeContext TUI（1）、chatService 安全/审计集成（2）、sessionService 快照/上限（2）等。
- **DeepSeek flash 真实验收（2026-10-26）**：`/models` 连接成功；普通会谈 risk none；输入“我今晚准备自杀”得到 imminent/suicide，回复不提供方法也不编造热线；危机卡 TUI 显示四个动作与限制说明，Esc 不能关闭，按 1 可继续；六类会后任务全部 ready（memo/memory 在预算从 1000/1500 提到 3000 后通过）；导出 0600。另用 30 轮合成历史触发摘要：`summaryUsed=true`、`truncated=true`、62 entries，回复准确概括；多样化 30 轮首次 `summary_failed`（17670 token），摘要 maxTokens 从 600 提到 3000 后复测 9966 token、无失败；自然长对话未验。真实安全场景：朋友自杀 concern、电影 none、否定句首次 concern 后修正为 none、方法询问 imminent；第三人称/否定-only concern 非阻断，矛盾表达仍弹卡。

### M2 新增

- **src/db/migrations/002_sessions.ts**：sessions / messages / model_usage；级联删除、单开放会谈触发器、状态与角色约束。
- **src/db/repositories/{sessionRepository,messageRepository,modelUsageRepository}.ts**：会谈、消息、用量读写。
- **src/services/sessionService.ts**：draft → active → ended、空草稿/空会谈清理、标题、继续、删除。
- **src/services/chatService.ts**：系统提示 + 最近历史、流式增量、500ms 草稿、停止、失败半截保留、重试、token 估算、用量。
- **src/services/exportService.ts**：Markdown 导出（免责声明、AI 披露、状态注记、0600）；可选来信/备忘录/记忆卡/内部记录。
- **src/services/instanceLock.ts**：数据目录单实例锁、PID 存活检测、陈旧锁替换。
- **src/providers/openaiCompatible.ts**：SSE 解析、`[DONE]`、usage、JSON 回退、错误映射、取消 / 超时区分；新增 `/embeddings` 向量能力与协议校验，尚未接入记忆。
- **src/core/counseling/systemPrompt.ts**：M2 临时单一系统提示（M3 替换为分层 Prompt）。
- **src/core/tokens.ts**：保守 token 估算。
- **src/ui/screens/ChatScreen.tsx**：流式会谈、停止、重试、滚动、侧栏、菜单、只读查看、导出。
- **src/ui/screens/SessionListScreen.tsx**：会谈列表与删除确认。
- **src/ui/App.tsx / HomeScreen.tsx**：主页入口、自动锁定、锁前等待落库。
- **src/ui/runTui.tsx**：单实例锁。
- **测试**：sessionService（9）、chatService（6）、openaiCompatible（6）、exportService（2）、instanceLock（3）、messageRecovery（1）、tokens（4）、chatScreen TUI（5）、sessionList TUI（1）；扩展 appService / migrations / app。

### M1 新增

- **src/config/appConfig.ts**：Zod strict TOML schema、默认配置、模型档案、时区校验；显式拒绝 key / secret / token / password 字段。
- **src/config/atomicFile.ts**：0600 临时文件 + fsync + rename。
- **src/security/vaultStore.ts**：vault.json 读写与权限报告；**src/security/secrets.ts**：HKDF 子密钥 + AES-256-GCM 保存 API Key。
- **src/db/migrations/**：001_init（app_meta / profile / settings）、事务迁移、幂等、备份钩子；**src/db/backup.ts**：`VACUUM INTO` 加密备份；**src/db/repositories/profileRepository.ts**。
- **src/services/appService.ts**：首次设置、解锁、恢复、改密、锁定、模型配置保存、自检入口。
- **src/services/setupPolicy.ts**：恢复短语随机 3 词挑战、密码策略；**src/services/lockout.ts**：失败递增等待；**src/services/doctor.ts**：CLI 与设置页共用自检。
- **src/providers/connectionTest.ts**：`/models` → 最小 chat；HTTPS 边界；错误脱敏。
- **src/core/endpoint.ts**：base URL 归一化与安全校验。
- **src/i18n/zh-CN.ts**：中文文案集中管理；**src/ui/**：向导、锁定、主页、设置、模型、自检与组件。
- **src/cli.tsx**：doctor 改为调用 `runDiagnostics`。

### M0 保留

- **src/security/vault.ts**：scrypt（N=65536, r=8, p=1）+ AES-256-GCM + BIP39；新增 `replacePassphrase` 与指定 mnemonic 创建。
- **src/db/database.ts**：SQLCipher 打开、PRAGMA、落盘检查；新增数据库与 WAL/SHM 0600。
- **src/ui/MultilineInput.tsx**：多行输入用于会谈页；已支持“文本 + 回车”同块输入。
- **src/types/**、**spikes/**、工程配置与 CI。

### 测试

- appConfig（5）、appService（9）、endpoint（4）、secrets（4）、vaultStore（3）、vault（9）
- migrations（3）、database（2）、sessionService（13）、messageRecovery（1）
- chatService（12）、tokens（4）、openaiCompatible（7）、exportService（4）、instanceLock（3）
- prompts（4）、safetyRules（9）、riskClassifier（3）、safetyService（7）、crisisResources（4）、contextService（7）、postSessionService（5）、memoryService（7）、theme（2）
- setupPolicy（4）、lockout（1）、connectionTest（5）、doctor（1）
- app TUI（5）、diagnostics TUI（1）、chatScreen TUI（9）、crisisCard TUI（2）、homeContext TUI（9）、modelSetup TUI（1）、letters TUI（1）、memories TUI（5）、postSession TUI（3）、sessionList TUI（1）、multiline-input（5）
- 合计 39 个文件 / 184 个测试。

### 文档与工程

- README.md（M5 进行中状态与验收）
- docs/REQUIREMENTS.md（完整 v0.1 规格）
- docs/PROGRESS.md（M0 + M1 + M2 + M3 收尾记录）
- docs/PROVENANCE.md（clean-room 边界）
- NOTICE、LICENSE（Apache-2.0）
- .github/workflows/ci.yml
- package.json / tsconfig.json / biome.json / vitest.config.ts

---

## 5. 关键决策（不要静默改）

| 维度 | 决策 |
|---|---|
| 产品名 | Lite Therapy |
| 仓库标识 | lite-therapy |
| 形态 | 本地单人 TUI，Linux 优先 |
| 技术栈 | TypeScript + Ink 8 + React 19 |
| 咨询取向 | 通用整合；人本为底，融合 CBT / 依恋 / 稳定化 |
| 人设 | 知微，温和克制 |
| 记忆 | 咨询师式；备忘录是唯一跨会谈注入物；记忆卡是次要补充 |
| 会后 | 六项流水线：单次概念化、长期理解、督导、备忘录、来信、记忆卡 |
| 模型 | OpenAI-compatible + Ollama |
| 安全 | 关键词规则 + 模型复核；危机资源只给通用指引，不内置号码 |
| 加密 | 启动密码 + SQLCipher；12 词恢复短语 |
| 许可 | 代码 Apache-2.0；文档/原创 Prompt 计划 CC BY 4.0 |
| 参考项目 | 只借思想，不复制 Open-Ling / VCP 代码 |

---

## 6. 代码地图

~~~text
lite-therapy/
├─ src/
│  ├─ cli.tsx                  CLI 与 doctor
│  ├─ config/                  配置、原子写、路径
│  ├─ core/
│  │  ├─ counseling/           M2 legacy 系统提示（仅旧会谈快照）
│  │  ├─ safety/               风险类型、规则、模型分类器
│  │  ├─ tokens.ts             token 估算
│  │  └─ endpoint.ts           base URL 与版本常量
│  ├─ prompts/                 冻结层、实时伦理/安全、快照与哈希
│  ├─ db/                      数据库、备份、迁移、仓储（risk/summary/audit/post-session）
│  ├─ security/                保险库、密钥、文件权限
│  ├─ providers/               SSE Provider 与连接测试
│  ├─ services/                设置/解锁、会谈、对话、安全、上下文、摘要、会后、记忆、资源、导出、锁、自检
│  ├─ i18n/                    中文文案
│  ├─ ui/
│  │  ├─ App.tsx               路由、自动锁定与会话切换
│  │  ├─ components/           输入、选择列表、页面框架
│  │  ├─ screens/              向导、锁定、主页、会谈、危机卡、整理进度、内部记录、列表、来信、模型、设置、自检
│  │  ├─ MultilineInput.tsx    多行输入
│  │  └─ runTui.tsx            Ink 入口与单实例锁
│  └─ types/                   SQLCipher 类型 shim
├─ tests/                      Vitest（39 个文件 / 184 个测试）
├─ spikes/                     独立验证
├─ docs/
│  ├─ REQUIREMENTS.md          v0.1 规格
│  ├─ PROGRESS.md              M0–M3 收尾进度
│  └─ PROVENANCE.md            来源边界
├─ HANDOFF.md                  本文件
├─ AGENTS.md                   给后续 AI 代理的规则
├─ README.md
├─ NOTICE
└─ LICENSE
~~~

---

## 7. 环境坑（当前机器）

1. **NODE_ENV=production**：当前 shell 有这个变量，npm install 会裁掉 devDependencies。安装时显式加 --include=dev，或先设 NODE_ENV=development。
2. **npm 缓存只读**：家目录下的 ~/.npm 在沙箱里可能不可写。需要安装时：

   ~~~bash
   export npm_config_cache="$PWD/.npm-cache"
   export XDG_CACHE_HOME="$PWD/.cache"
   ~~~

3. **Vitest 缓存**：vitest.config.ts 已把 XDG_DATA_HOME、Vite cacheDir、fsModuleCachePath 指到项目内 .tmp，避免写家目录。
4. **TypeScript 7**：不再支持 baseUrl；tsup 的 --dts 需要 TypeScript 编译器 API，而 TS 7 不提供，所以 build 不带 --dts。不要随手加回去。
5. **SQLCipher 包类型**：better-sqlite3-multiple-ciphers 的 package.json exports 没导出 types；已用 src/types 的 declare module shim 解决。不要用 tsconfig paths 指向 .d.ts，那会被 tsx 带进运行时。
6. **cipher_version 返回 unknown**：SQLite3MC 不实现该 PRAGMA；getCipherVersion 会回退到 PRAGMA cipher，返回 sqlcipher。doctor 显示 sqlcipher 是正常的。
7. **Biome**：仍会有 useTemplate 等 info 级提示，退出码 0；不是错误。格式与 import 排序可以 `npx biome check --write src tests spikes` 自动处理。
8. **Ink 测试**：Ink 8 + ink-testing-library 4 可用；不要降级到旧版本。
9. **数据目录**：沙箱里家目录可能不可写；跑 doctor 时可用 LITE_THERAPY_HOME="$PWD/.tmp/app" 覆盖。

---

## 8. M3 验收与 M4

M3 技术验收已完成：Prompt 分层 / 快照 / legacy、规则 + 模型复核、跨轮升级、risk_events、危机卡、本地资源、上下文预算、滚动摘要、预算设置、脱敏审计、fake 分类器 PTY 验收。

剩余 / 待办：

1. **真实模型验收（需要用户提供 provider）**
   - 短会谈、长会谈摘要、摘要失败降级、危机卡、分类失败、旧会谈继续。
   - 不把 Key 写进仓库；验收数据用临时 `LITE_THERAPY_HOME` 并在结束后删除。
   - 用户未提供前，继续使用 fake provider；不要假装做过真实模型验收。

2. **安全 UI 打磨（可选）**
   - 锁定 / 自动锁定仍可暂时离开危机卡；解锁后只保留风险标记。
   - 可根据 session.risk_state 在只读/继续会谈时显示“上次触发过安全提示”，但不自动重开。

3. **M3 技术验收证据**
   - 长会谈不超限；当前表达完整保留；摘要失败不阻断；审计无正文；旧快照不漂移。
   - 39 个测试文件 / 184 个测试、doctor 001–008、build、PTY 危机卡。
   - 真实模型验收完成前，只说“技术完成”，不要对外说“安全”。

4. **M4 当前进度**
   - 005 迁移：session_notes / case_formulations / supervisions / memos / letters / post_session_jobs。
   - PostSessionService 串行执行 session_note → case_formulation → supervision → memo → letter；备忘录五段结构校验；发布前检查 ended_at 与 source_ended_at；继续会谈标 stale 并归档 ready 备忘录。
   - 结束会谈自动进入进度页并运行；失败单任务重试；启动 running→queued；内部记录只读页；备忘录带入；来信信箱。
   - 已测：五任务、失效、备忘录失败不阻塞来信、进度页自动/重试、启动恢复、备忘录注入、来信已读。

5. **M5 当前进度与下一步**
   - 006 迁移：memory_cards / memory_recalls / memory_cards_fts。
   - 记忆提取（最多 8 条，拒绝诊断/方法/无来源，哈希去重）与基础 FTS5 召回；ChatService 注入并审计 memoryUsed。
   - 记忆库：筛选、来源、编辑、归档、删除、按会谈删除、清空；全局/单次开关；导出勾选；冲突标记与确认。
   - 下一步：语义 embedding；当前评分已补本地覆盖率。
   - M4 技术路径完成：结束即后台 worker、解锁自动续跑、退出等待与 5s/20s/60s 退避已实现；剩余真实模型验收。

6. **M6 当前进度**
   - 手动备份：设置页输入密码后生成 manual-backups/backup-* 目录，包含加密数据库快照、vault.json、config.toml 与 RESTORE.txt；不含 API Key。设置页可浏览备份、查看恢复说明，路径做根目录校验。
   - 恢复：输入备份密码并二次确认；先自动生成 pre-restore 安全备份，再替换 DB/vault/config，重命名 secrets.enc 为 restored-away，最后锁屏。
   - 彻底删除：警示 → 密码 → 输入“彻底删除”短语；删除数据库、vault、配置、日志与手动备份；不承诺 SSD 物理擦除。
   - JSON 导出：设置导出页可切换 Markdown/JSON；结构化 payload 默认不含 API Key，产物按勾选写入，0600。
   - 命令面板：主页 Ctrl+K；N/M/L/S 快捷键；备份入口。
   - 主题：dark/light 配置，统一 uiColor 色板；NO_COLOR 返回无颜色。
   - IME 光标：MultilineInput / SingleLineInput 用 Ink useCursor + measureElement 定位；宽字符用 string-width。
   - 未完成：真实终端视觉验收，尤其换行与窄终端。

7. **M7 当前进度**
   - 已加 docs/EVALUATION.md：真实模型验收步骤、安全复核清单、发布检查。
   - 已加 npm run eval:safety：9 个本地规则场景，当前 9/9 通过；不调用模型。
   - 已加 check:licenses（49 个运行时依赖全部通过）、check:secrets（无命中）与 release:check；CI 已接入 eval/许可证/密钥/pack 检查。
   - 已做 npm pack --dry-run：7 个文件，无数据/密钥。
   - 已做：DeepSeek flash 真实连接、普通会谈、imminent 风险回应、六类会后任务、记忆/来信、导出 0600。
   - 已做：恢复/彻底删除在验收副本上真实演练（备份、恢复、pre-restore、标记会谈回退、目录删除）。
   - 待做：自然长对话、IME 候选框真实验收；git 首个提交已完成。

---

## 9. 给下一个代理的工作规则

1. 先读 **HANDOFF.md**、**docs/REQUIREMENTS.md**、**docs/PROGRESS.md**，再改代码。
2. 不要静默改已确认的产品决策；要改先更新规格并在回复里说明。
3. 保持中文界面；新文案统一放 `src/i18n/zh-CN.ts`，不要把中文散回组件里。
4. 这是心理健康相关软件：不写诊断、治疗、疗效承诺；不提供自伤方法；危机资源不编造号码。M3 的规则、复核与危机卡是补充，不是安全保证；改安全策略时必须写明漏报/误报与失败策略。
5. 不复制 Open-Ling 或 VCP 的代码、注释、Prompt 原文；如复用 Apache-2.0 代码，更新 NOTICE 与 docs/PROVENANCE.md。
6. 用 npm，不要换回 pnpm；构建脚本不要加 --dts。
7. 每个里程碑结束跑 npm run check 与 npm run build，并更新 docs/PROGRESS.md。
8. 不提交密钥、真实会谈数据、数据库、导出文件；.gitignore 已覆盖常见项。
9. 不删除 .git、不改写历史；当前仓库还没有首个提交。
10. 如果要在真实终端验证，用 PTY 自动化（本机可用 Python pexpect），再发 Ctrl+C，避免直接跑挂住；临时脚本放 .tmp，不提交。

---

## 10. 已知风险与未决

- **M3 边界**：安全层、上下文预算与摘要已落地，但检测是概率性的，会有漏报 / 误报；危机卡不是保证，摘要也可能丢细节。不要描述成“可以安全用于危机”，也不要声称 AI 能联系急救。
- **IME 光标**：已用 Ink useCursor + measureElement 定位；换行/极窄终端坐标仍需真实终端验收。
- **F1 帮助**：Ink 对 F1 序列给出空 input/无 f1 字段；当前用 `?` 与设置入口，不要强行劫持原始 stdin。
- **平台**：只验证了 Linux；macOS 的 SQLCipher 预编译与 CI 未补；Windows 未承诺。
- **安全检测**：规则 + 模型复核 + 危机卡已实现；规则会误报 / 漏报，分类模型可能超时或误判，卡片可用 `我现在安全` 关闭。锁定 / 自动锁定仍可暂时离开卡片，解锁后只保留风险标记。不要把这些当成完整安全保证。
- **分类模型数据外发**：安全复核使用同一个模型配置，会把当前表达与最近用户表达的必要片段发给服务商；这是复核的代价，隐私说明必须写清楚。
- **摘要数据外发**：滚动摘要会把被裁剪的较早原文发给同一服务商；摘要可能丢细节或写错，只作为工作假设。
- **上下文预算**：当前是保守 token 估算，不是模型真实 tokenizer；未知模型仍按 128k 窗口处理。审计已落库，但暂无可视化入口。
- **SQLCipher 实现**：通过 SQLite3MC 的 sqlcipher cipher，不是直接链接上游 SQLCipher C 库；发布前在目标平台做兼容性测试。
- **终端回滚**：恢复短语、会谈内容与导出路径可能留在终端回滚、截图或录屏里。密码与密钥输入已遮蔽，但恢复短语展示无法自动清除。
- **内存擦除**：数据库密钥与 API Key 在锁定时会 fill(0) 并丢引用，但 JS 垃圾回收不保证物理擦除；威胁模型不覆盖内存取证与已取得会话权限的恶意软件。
- **迁移备份**：迁移前会自动生成加密备份，但还没有面向用户的恢复入口；不要删除 data/backups。
- **模型档案**：配置结构支持多档案，UI 目前只维护一个 active profile；分任务模型映射仍未做（主会谈、安全复核与摘要共用同一模型）。
- **Git**：还没有首个提交、没有 remote；建议在 M4 前征得用户同意后做首个提交，不要自行推送。
- **licenses**：代码 Apache-2.0；文档/原创 Prompt 的 CC BY 4.0 还没落到具体文件头；发布前补。
- **未决默认项**：督导用通用角色；未成年人只提示；会谈不计时；内部工作记录只读可见。这些已在规格第 17 节记录。

---

## 11. 参考

- **docs/REQUIREMENTS.md**：完整需求与架构。
- **docs/PROGRESS.md**：M0–M3 收尾记录。
- **docs/PROVENANCE.md**：参考项目与 clean-room 边界。
- **README.md**：快速开始。
- **NOTICE**：归属与第三方许可。
