# AGENTS.md — Lite Therapy

本文件给在此仓库工作的 AI 编程代理。开始前先读 **HANDOFF.md** 与 **docs/REQUIREMENTS.md** 的相关章节。

## 项目

Lite Therapy 是一个本地优先的 AI 心理咨询 TUI。当前处于 M7 评估进行、M4 会后队列 6/6（技术完成）、M5 可选 embedding 已用 qwen3-embedding:0.6b 做单组真实回填/召回、M6 技术完成、M3 技术完成且 DeepSeek flash 短会谈、28 轮自然多轮会谈、默认 12k 自然摘要与 6k 精简摘要已验的状态：Prompt 分层与快照、安全规则、模型复核、危机卡、上下文预算、滚动摘要、预算设置与审计查看已落地；会后单次记录、纵向理解、督导、备忘录、来信、整理进度、内部记录与记忆提取/召回/记忆库/记忆设置/单次会谈开关/历史版本已接。安全检测是概率性的，不是保证。

## 开始前

1. 读 **HANDOFF.md**。
2. 读 **docs/REQUIREMENTS.md** 的第 2、4、5、8、9、10、17 节。
3. 读 **docs/PROGRESS.md**。
4. 运行 git status 与 git branch --show-current，保留用户已有修改。
5. 运行 npm run doctor 与 npm test，确认基线。

## 命令

~~~bash
npm run doctor
npm run typecheck
npm run lint
npm test
npm run build
npm run check
npm run release:check
npm run dev
npm run eval:safety
npm run eval:embedding
~~~

当前 shell 可能全局设置 NODE_ENV=production。安装依赖时用：

~~~bash
NODE_ENV=development npm install --include=dev
~~~

如果家目录的 npm 缓存不可写：

~~~bash
export npm_config_cache="$PWD/.npm-cache"
export XDG_CACHE_HOME="$PWD/.cache"
~~~

## 工作方式

- 小步推进；每个里程碑结束更新 docs/PROGRESS.md，并给用户可运行的验收清单。
- 不静默改已确认决策；要改先更新 docs/REQUIREMENTS.md 并在回复里说明。
- 先写规格再堆功能；已有测试必须保持绿色。
- 新增核心逻辑要有测试；TUI 用 ink-testing-library。
- 代码按职责分层：UI 不直接访问数据库；core 不依赖 UI；providers 不依赖 db。
- 新文案放 src/i18n/zh-CN.ts；敏感文件用 src/config/atomicFile.ts 的 0600 原子写。
- 会谈分层：UI → AppService → SessionService / ChatService → Provider；UI 不直接访问数据库或 HTTP。
- Prompt 分层在 src/prompts/：冻结层进入会谈快照，伦理/安全是实时层；旧 M2 会谈用 legacy 快照，不要静默改写。
- 安全评估在 src/core/safety 与 src/services/safetyService.ts：规则初筛 → 模型复核 → 跨轮升级 → risk_events；风险原文不落库。
- 上下文在 src/services/contextService.ts：历史从最新往前保留，当前用户消息始终完整；只有确实裁剪且摘要可用时才注入摘要；审计不记录正文。
- 滚动摘要在 src/services/summaryService.ts：只摘要被裁剪的较早消息；失败返回 null，调用方保留上一版摘要并继续会谈。
- 危机卡是安全补充，不是安全保证；不要移除卡片的 AI 限制说明，不要给热线号码硬编码。
- 改数据库结构要新增迁移，不要改已发布的迁移；迁移会走事务与迁移前备份。
- 注释解释“为什么”，不重复代码。
- 用 npm，不要换回 pnpm。
- 构建脚本不要加 --dts（TypeScript 7 不提供编译器 API）。

## 安全与伦理

- 这是心理健康相关软件。不要写诊断、治疗、疗效承诺或用药建议。
- 不要提供自伤 / 自杀的方法、工具或时机。
- 危机资源只给通用指引；不要编造热线号码。
- AI 必须如实披露身份，不冒充真人咨询师。
- 不鼓励依赖、不制造排他关系、不进行性 / 浪漫角色扮演。
- 涉及安全策略、Prompt 分层、危机检测的改动，要在回复里明确说明风险。
- 会谈内容与安全复核片段都会发送给用户配置的模型服务商；不要把它描述成适合危机或高风险使用的保证。
- 安全分类失败时，规则命中不得降级；明确 imminent 不得因模型说 none 而放行。
- 摘要失败不得阻断会谈；超上下文预算时优先保留当前表达与最近原文，不要为了塞入摘要丢掉当前用户消息。
- 会后任务在 src/services/postSessionService.ts：串行、可失效、备忘录结构校验；任务失败不阻塞其他任务。当前跑 session_note / case_formulation / supervision / memo / letter / memory。
- 记忆在 src/services/memoryService.ts 与 memoryRepository：提取必须有真实来源；诊断式断言/方法性内容拒绝；文本哈希去重；敏感条目默认不召回；召回写 recall 日志。
- 发布产物前必须检查会谈仍为 ended 且 ended_at 与 source_ended_at 一致；继续会谈会把任务标 stale、ready 备忘录归档。

## 许可

- 代码 Apache-2.0；文档与原创 Prompt 计划 CC BY 4.0。
- 不复制 Open-Ling 或 VCPToolBox 的代码、注释、文件结构、Prompt 原文。
- 如复制 Open-Ling 的 Apache-2.0 代码：保留 LICENSE、在修改文件加说明、更新 NOTICE 与 docs/PROVENANCE.md、声明非官方。
- VCPToolBox 是 CC BY-NC-SA 4.0；只借鉴思想，不复制代码。
- 新增依赖时检查许可证；发布前做 license / secret scan。

## Git

- master 上已有本地提交；不要删除 .git，不要改写历史，未经同意不要推送或强制改写。
- 不提交密钥、真实会谈数据、数据库、导出文件、node_modules、dist。
- 不在未经用户同意时推送 remote 或改写分支。
- 用户移动目录后，路径会变成 /home/sishen/Projects/lite-therapy；不要假设仍是 Agent_Psycho。

## 已知坑

- Vitest 5 会写 XDG_DATA_HOME 与缓存；vitest.config.ts 已指到项目内 .tmp。
- SQLCipher 包的 exports 缺 types；用 src/types 的 shim，不要用 tsconfig paths 指 .d.ts。
- getCipherVersion 会回退到 PRAGMA cipher，返回 sqlcipher 是正常的。
- Ink 8 输入已用 useCursor + measureElement 定位真实光标；换行/窄终端坐标仍需真实终端验收。
- SQLCipher 下 better-sqlite3 的 `db.backup()` 会报源/目标 cipher 不兼容；迁移备份用 `VACUUM INTO`。
- 终端自动化可用 Python pexpect；临时脚本与日志放 .tmp，不提交。验收模型流式可用本地 fake OpenAI SSE 服务，不调用真实模型。
- 多行输入与单行输入都要处理“文本 + 回车”在同一个 stdin 数据块里的情况；否则自动化与快速粘贴会不发送。
- SelectList 的状态会在同位置的菜单之间复用；不同菜单分支要加不同的 key，否则高亮会串页。
- 单实例锁只在 src/ui/runTui.tsx 获取；直接创建 AppService 不会加锁，测试可并行。
- 安全规则与分类器共用模型 Provider；测试用 fake provider / fake classifier，不要调用真实模型。
- 危机卡显示时，ChatScreen 忽略 Esc/Ctrl+C/Ctrl+Q；锁定仍可离开卡片，解锁后只保留风险标记。
- 新增安全规则时同时补否定/影视/第三人称/过去时测试，避免把“朋友说他想自杀”误判为用户当下风险。否定-only 与第三人称 concern 在 ChatScreen 用非阻断提示；不要移除“不想”前的 `(?<!想)`，否则“我不确定想不想自杀”会被误判为否定。
- `scanRiskText` 必须扫描每条规则的全部命中，并按分句收窄语境；只看第一个命中会把“朋友说他想自杀，其实我也想过自杀”整体压成第三人称。分句后的“我妈/我爸/我朋友”等仍是第三人称，不能因有“我”就重置为本人。第三人称风险后出现“我也有过/我也想过/我也是”等明确本人续接时，要补 self concern；但“我也有过很多疑问/我也想过怎么帮他/我也一样担心”必须排除。
- 会后任务不要记录或打印会谈正文；错误信息截断。备忘录只有通过五段结构校验才写 ready。
- 记忆卡来源必须在当前会谈消息 ID 集合中；不要为了让提取“成功”放宽来源校验。
- 记忆可配置独立 embedding 端点（`memory.embeddingBaseUrl`）；独立端点时不要发送聊天 API Key。更新记忆设置必须保留 embeddingModel/embeddingBaseUrl，否则会静默丢失配置。
- `provider.embed` 必须作为方法调用（`provider.embed(...)`），不要先解构再单独调用；OpenAICompatibleProvider 会读 `this.fetchImpl`，解构会丢绑定并在真实调用时崩溃。
- 真实 embedding 只用 qwen3-embedding:0.6b 验过 1024 维；应用内是单查询/两张卡，另有 `npm run eval:embedding` 的 8 卡/6 查询抽查（top1 5/6）。模型/端点变化时 updateMemorySettings 会清空旧向量并需重新回填，但仍无自动重建或维度校验，别把单组结果当质量保证。
- 编辑记忆会写 memory_card_revisions（008）；历史文本是敏感数据，仍只存在本机。
- 记忆库 UI 在 src/ui/screens/MemoriesScreen.tsx：编辑/归档/删除只动本机卡片；全局关闭后 ChatService 不召回，但卡片仍保留。
- 备份/恢复在 AppService.createBackup / restoreBackup：备份用 VACUUM INTO + vault/config 复制，不含 secrets.enc；恢复前生成 pre-restore 安全备份并锁屏。
- 彻底删除在 AppService.wipeAllData：校验密码与路径后删除 data/config/log；不要把它改成可绕过密码的操作。
- 仅 Linux 验证；macOS / Windows 未验证。
- 本地安全评估用 npm run eval:safety；它只测规则，不代表安全，也不调用真实模型。
- DeepSeek flash 短会谈验收发现推理 token 会吃满预算：memo/memory 的 maxTokens 已提到 3000，安全分类器提到 1000、默认超时 12s；修改这些预算要有真实模型回归。`.env` 只用于本机验收，已被 gitignore，权限 0600，不要把 Key 写进代码/日志。

## 完成汇报

默认简洁说明：

~~~text
完成内容：
修改文件：
验证：
风险/未完成项：
~~~
