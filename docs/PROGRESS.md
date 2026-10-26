# 进度

> 交接档：../HANDOFF.md
> 代理规则：../AGENTS.md

## 2026-10-26 — M7 评估开始

### 已完成

- **本地安全评估脚本**：scripts/evaluate-safety.ts + npm run eval:safety。
  - 明确计划、明确意念、已发生自伤、方法询问、第三人称、影视、普通困扰、否定句、混合表达，共 9 个场景。
  - 只调用本地规则，不调用模型、不读真实数据、不写数据库。
  - 当前 9/9 通过；否定句仍可能误报 concern，已在脚本与文档中标注。
- **评估文档**：docs/EVALUATION.md。
  - 真实模型验收步骤（连接、长会谈、风险、第三人称、分类失败、会后、续跑、记忆、导出、备份恢复、彻底删除、主题/IME、退出）。
  - 安全与伦理复核清单。
  - 发布前检查（check/doctor/build/eval:safety/npm pack）。
- **lint** 纳入 scripts。
- **发布检查脚本**：check:licenses 扫描 49 个运行时依赖，全部在许可证 allowlist；check:secrets 扫描仓库，无命中；release:check 串联 check、eval、license、secret、doctor、build。
- **CI**：Node 22/24 上跑 typecheck、lint、test、build、doctor，并加入 eval:safety、许可证、密钥与 npm pack --dry-run。
- **DeepSeek flash 真实验收**：`/models` 连接成功；普通会谈 risk none；6 轮多轮会谈均 done/risk none、回应连贯；imminent 风险触发并得到不提供方法/不编造热线的回复；六类会后任务全部 ready（memo/memory 提高 maxTokens 到 3000 后通过）；4 张记忆卡、1 封来信；Markdown 导出 0600。
- **DeepSeek 预设**：模型设置可选 DeepSeek，自动填 `https://api.deepseek.com/v1` 与 `deepseek-flash`，仍需手动输入 Key；TUI 测试校验预设地址/模型与 Key 提交。
- **长上下文/摘要真实验收**：30 轮合成历史触发摘要；DeepSeek 回复概括准确；审计 `summaryUsed=true`、`truncated=true`、62 entries、9899 history tokens。多样化 30 轮首次出现 `summary_failed`（17670 token），摘要 maxTokens 从 600 提到 3000 后复测 `summaryUsed=true`、9966 token、无失败；ChatScreen 在最新审计含 summary_failed 时显示非阻断提示。
- **真实安全场景**：朋友自杀 concern、电影 none、方法询问 imminent；否定句首次 concern，修正否定识别后真实复测 none。第三人称/否定-only concern 使用非阻断提示。
- **恢复/彻底删除副本演练**：真实数据目录副本上完成备份→标记会谈→恢复→标记消失→解锁→彻底删除，data/config/log 全部移除。
- **真实危机卡 TUI**：真实 DeepSeek 触发“此刻的安全更重要”，四个动作与 AI 限制说明可见；Esc 不能关闭；按 1 后继续。
- **真实第三人称 TUI**：朋友风险触发非阻断“他人风险”提示，不弹本人危机卡。

### 尚未完成（M7 剩余）

- 自然（非合成）长对话验收；DeepSeek 短会谈与合成长上下文已验，但不能据此说“安全”。
- **真实终端视觉验收**：80×24 验证浅色 truecolor、NO_COLOR 无颜色、锁屏/聊天 show-cursor/cursorTo；fake 模型下中文“你好”输入与回复正常；40×20 最小尺寸提示正确；IME 候选框仍无法自动化模拟。
- 发布版本、npm pack 检查与 git 提交未做。

### 已知风险

- 本地规则评估通过不等于安全；模型复核和真实场景仍可能漏报/误报。
- 评估脚本不覆盖模型分类器与真实终端危机卡交互。

---

## 2026-10-26 — M6 技术完成（备份/恢复/删除/主题/命令面板/IME）

### 已完成

- **手动备份**：设置页输入启动密码后，在 data/manual-backups/backup-* 生成：
  - VACUUM INTO 的加密数据库快照；
  - vault.json、config.toml（0600）；
  - RESTORE.txt 恢复说明；
  - 不复制 secrets.enc（API Key 需重填）。
- **权限**：备份目录 0700，文件 0600。
- **备份浏览**：设置页列出 manual-backups，可查看 RESTORE.txt；路径做根目录校验。
- **恢复**：输入备份密码 → 二次确认；先 VACUUM INTO 生成 pre-restore 安全备份，再原子替换 DB/vault/config；secrets.enc 重命名为 restored-away；完成后锁屏。
- **彻底删除**：警示 → 密码 → 输入“彻底删除”短语；删除数据、配置、日志与手动备份目录；明确提示 SSD 残留。
- **JSON 导出**：导出页可切换 Markdown/JSON；结构化 payload 包含会话、消息与勾选产物，0600；不含 API Key。
- **全量 JSON 导出**：设置页“导出全部数据（JSON）”；含档案、模型配置、全部会谈与消息、会后最新产物、来信、记忆与历史；0600，不含 API Key。
- **命令面板**：主页 Ctrl+K；新建/会谈/来信/记忆/设置/备份/锁定/退出；N/M/L/S 快捷键；测试覆盖打开与 Esc 返回。
- **帮助与键位**：主页 `?` 或设置入口；含主页/会谈/危机卡键位与安全边界；测试覆盖打开与 Esc 返回。
- **主题/NO_COLOR**：config.theme 支持 dark/light；统一 uiColor 色板；NO_COLOR 下关闭 FORCE_COLOR，连 dim 也不输出。
- **设置/备份 TUI 测试**：主题切换持久化、备份列表打开恢复说明、Esc 返回；彻底删除警示可取消；恢复密码入口可退出；修复备份列表双 SelectList 抢 Enter 与 wipeWarning 无 Esc 的问题。
- **IME 光标**：MultilineInput / SingleLineInput 用 Ink useCursor + measureElement 定位；宽字符列测试。
- **验证**：appService（9）覆盖备份文件/权限、备份浏览、错误密码拒绝、恢复后的数据回退与服务锁定、彻底删除目录与 NOT_SETUP、全量 JSON 0600/无密钥；homeContext（10）覆盖全量导出密码与结果页；exportService（4）覆盖 Markdown/JSON、勾选与 0600；当前 39 个测试文件 / 185 个测试。

### 尚未完成（M6 剩余）

- **IME 真实终端视觉验收**：换行、窄终端与中文输入法候选框尚未实测。
- **恢复/删除 UI 自动化测试**：服务层有测试，TUI 流程尚未单独覆盖。
- **真实模型验收**仍未做。

### 已知风险

- 备份包含加密数据库与 vault，仍应视为敏感文件；请放在可信位置。
- 恢复会生成 pre-restore 安全备份，但替换过程中若进程崩溃仍可能留下部分文件；彻底删除不承诺 SSD 物理擦除。
- 恢复后 API Key 失效，需要重新填写。

---

## 2026-10-26 — M5 进行中（记忆基础层）

### 已完成

- **006_memory 迁移**：memory_cards、memory_recalls、memory_cards_fts（trigram）；来源消息、文本哈希、敏感度、uncertain、召回计数。
- **提取**：会谈后最多 8 条；拒绝诊断式断言、方法性内容、缺失来源；confidence/sensitivity/tags 校验；文本哈希去重。
- **召回**：FTS5 三字片段检索；过滤 sensitive/restricted/uncertain；最多 5 条；记录 recall 日志与 recall_count。
- **ChatService 注入**：每轮用最近消息召回，注入“可能相关的背景”，审计 memoryUsed；全局开关关闭时不召回，敏感条目需显式开启。
- **记忆库**：来源消息与会谈、编辑文本、归档、删除；主页入口。
- **记忆设置**：全局启用/关闭、敏感记忆参与召回。
- **单次会谈开关**：新建会谈选择“这次不带入过去理解”时，session 的 memory_recall_enabled=0，不冻结备忘录也不召回记忆卡。
- **筛选与忘记**：记忆库按 kind / 标签 / 来源会谈筛选；删除当前筛选结果、按来源会谈删除或清空全部，清空同时移除 FTS。
- **导出勾选**：默认对话 + 来信；备忘录、记忆卡、内部记录需显式勾选；文件仍为 0600。
- **冲突标记**：相近但不同的记忆标 uncertain，默认不召回；记忆详情可“标记为已确认”。
- **历史版本**：008 迁移新增 memory_card_revisions；编辑记忆时记录修改前后文本，详情页可查看历史。
- **召回评分**：FTS 候选 + 本地卡片覆盖率、FTS 排名、置信度、新鲜度与重复引用惩罚；召回日志 reason 记录 fts5+coverage。
- **召回可解释**：记忆详情展示最近 5 次召回会谈、评分与日期。
- **验证**：39 个测试文件 / 185 个测试；memoryService（7）覆盖提取拒绝、去重、敏感过滤、召回日志、冲突标记、历史版本、覆盖率排序、embedding 召回与普通卡回填；memoriesScreen TUI（5）覆盖来源/编辑/归档/删除/筛选/标签/清空/按会谈删除；chatService（12）覆盖召回注入与开关；sessionService（13）覆盖单次会谈关闭记忆。

### 修改 / 新增文件

- `src/db/migrations/006_memory.ts`、`src/db/migrations/008_memory_history.ts`
- `src/db/repositories/memoryRepository.ts`
- `src/services/memoryService.ts`、`src/services/exportService.ts`
- `src/services/{postSessionService,chatService,appService}.ts`、`src/config/appConfig.ts`
- `src/ui/screens/{MemoriesScreen,HomeScreen,ChatScreen}.tsx`
- `tests/{memoryService,memoriesScreen,exportService}.test.*`，扩展 chatService / appConfig / appService / migrations 测试
- 更新 README / HANDOFF / AGENTS / docs/PROGRESS

### 尚未完成（M5 剩余）

- **语义召回（可选）**：配置 embedding 模型后，提取时批量写向量（BLOB），召回合并 FTS 与余弦；可单独配置 embedding 端点（如 Ollama），避免把聊天 Key 发给本地服务；设置页可手动回填旧 normal 卡片；敏感/受限卡不发送向量请求；未配置时回退本地覆盖率。

### 已知风险

- 记忆提取可能遗漏或误提取；敏感信息默认不召回，但仍会落库。
- 召回是关键词近似，可能把旧理解带进来；当前表达优先的提示已写入上下文。
- embedding/冲突未做，召回可能把相近但错误的旧条目带进来；当前表达优先的提示已写入上下文。

---

## 2026-10-26 — M4 技术完成（会后队列 6/6）

### 已完成

- **005_post_session 迁移**：session_notes、case_formulations、supervisions、memos、letters、post_session_jobs；任务唯一键 (session_id, kind, source_ended_at)，ready 备忘录部分唯一索引。
- **会后队列**：PostSessionService 单进程串行执行 session_note → case_formulation → supervision → memo → letter；状态 queued / running / ready / failed / stale / skipped；attempts 记录。
- **失效守卫**：发布前检查会话仍为 ended 且 ended_at === source_ended_at；继续会谈会把未完成任务标 stale、ready 备忘录归档。
- **纵向理解**：受上一版 + 最近 3 份单次记录 + 本次原文；版本递增，记录 covered_session_ids。
- **独立督导**：受原文 + 单次记录 + 纵向理解；2k 输出，内部只读。
- **备忘录**：受原文 + 单次记录 + 纵向理解 + 督导；五段结构（主题 / 重要背景 / 偏好与资源 / 未完成 / 下次可以）+ ≤600 字校验，不通过则 job failed，不写 ready。
- **来信**：独立任务；即使备忘录失败，来信仍可生成；≤800 字校验。
- **AppService**：结束会谈后自动入队并启动后台运行，runPostSession / retryPostSession 共享 promise；解锁时自动续跑 queued 任务；列表可读 jobs。
- **整理进度页**：结束后自动进入 PostSessionScreen；串行运行、轮询状态、失败单任务重试、完成/失效提示；主页可再次打开。
- **启动恢复**：openDatabase 把 running 任务重置为 queued；解锁后自动续跑 queued 任务，进度页可继续观察。
- **退避重试**：失败任务按 5s/20s/60s 重试，最多 3 次；测试可注入零延迟。
- **内部记录只读页**：单次记录 / 纵向理解 / 督导 / 备忘录；警示“不是对你的结论”，PgUp/PgDn 滚动，不提供编辑。
- **备忘录带入**：新建会谈询问是否带入最近 ready 备忘录，冻结到 memory_snapshot_json；ChatService 注入并审计 memoUsed。
- **来信信箱**：主页未读入口、阅读页、已读标记；来信正文不进入内部记录。
- **验证**：39 个测试文件 / 185 个测试；postSessionService（5）覆盖六任务成功、失效、备忘录失败不阻塞来信、running 重置、退避重试；postSessionScreen TUI（3）覆盖自动运行、失败重试与内部记录只读页；AppService 覆盖入队、后台共享 promise、重启解锁自动续跑与执行；断言 memo 请求包含督导意见。

### 修改 / 新增的主要文件

- `src/db/migrations/005_post_session.ts`
- `src/db/repositories/postSessionRepository.ts`
- `src/services/postSessionService.ts`、`src/services/memoSnapshot.ts`、`src/ui/screens/{LettersScreen,PostSessionScreen,InternalRecordsScreen}.tsx`
- `src/services/appService.ts`（入队、后台运行/重试、退出等待、解锁续跑、继续会谈失效、备忘录带入、来信）
- `src/services/{sessionService,chatService}.ts`（记忆快照与 memo 注入）
- `tests/{postSessionService,letters,postSessionScreen}.test.*`，扩展 migrations / appService / sessionService / chatService / homeContext 测试
- 更新 README / HANDOFF / AGENTS / docs/PROGRESS

### 尚未完成（M4 剩余）

- **双守卫边界**：已检查 source_ended_at，但实际运行中继续会谈与 worker 并发还需要更完整的取消/串行测试。
- **真实模型验收**：仍未做，全部 fake。

### 已知风险

- 会后任务会把整场会谈原文发给模型服务商；隐私说明需要持续更新。
- 会后产物是工作记录，不是诊断或事实；备忘录可能丢细节。
- M4 六个任务与技术路径已完成；真实模型长会谈与并发取消仍未验收，不能说“会后流水线已在真实使用中验证”。

---

## 2026-10-26 — M3 技术完成（待真实模型验收）

### 已完成

- **Prompt 分层**：`src/prompts/` 的 counselor/core、shared/values、counselor/dialogue、counselor/voice、model/contract；伦理与安全作为实时层，不进入冻结快照。
- **会谈级快照**：新建会谈写入 `prompt_snapshot_json`，包含冻结层文本、版本、SHA-256、模型契约与总哈希；解析时校验每层与总哈希。
- **旧会谈兼容**：M2 会谈没有快照，首次继续时冻结为 `legacy/m2`，不静默套用新人格；实时伦理/安全仍然注入。
- **003_safety + 004_context_audit_entries 迁移**：risk_events、rolling_summaries、context_audits，以及每轮消息级 entries_json；M3 完成时 doctor 与迁移测试覆盖 001–004（005 在 M4 加入）。
- **本地安全规则**：自杀、自伤、他伤、虐待、精神病性体验、医疗急症；否定、假设、影视、第三人称、过去时抑制；跨轮风险状态。
- **模型复核**：严格 JSON（level / category / evidence / rationale / confidence / context）、8 秒超时、协议错误处理；规则命中时分类失败至少保持 concern，明确 imminent 不降级。
- **风险落库**：risk_events 不保存原文；会话 `risk_state` 只升不降；用户消息与助手消息写入 `risk_level`。
- **ChatService 接入**：发送前评估风险；按 level 注入额外安全强调；重试复用/重新评估风险；流式期间 busy 标志防止并发发送。
- **危机卡片**：规则或分类结果独立触发；Esc / Ctrl+C / Ctrl+Q 不能轻易关闭；动作「我现在安全 / 继续谈 / 查看本地资源 / 结束会谈」；侧栏保留“已记录风险线索”。
- **本地资源**：`crisis-resources.json`（可选，默认空），不内置任何热线号码；读取失败或缺失时显示通用指引与文件路径。
- **上下文预算**：ContextService 默认历史 24k、摘要触发 12k、档案 800、备忘录 1500、记忆卡 1200、单条用户消息 16k token；历史从最新往前保留，当前表达始终完整；超硬上限在写入前拒绝并提示拆分。
- **滚动摘要**：只摘要被裁剪的较早消息，按 token 分块、增量更新；上一版摘要保留，失败返回 null，不阻断会谈；covered_until_message_id 记录覆盖范围。
- **脱敏审计**：每轮写入 context_audits（message_id、prompt/history token、消息数、truncated、summary/memo/memory 注入、warnings）与消息级 entries_json（角色、token、是否进入请求），不记录正文。
- **预算设置**：AppConfig.context 暴露 history / summaryTrigger / recentTarget；设置页提供精简 / 保守 / 更长三档；ChatService 按配置注入预算。
- **审计查看**：设置页「最近上下文审计」按会谈展示时间、token、消息数、裁剪/摘要、条目计数与警告，不显示正文。
- **验证**：M3 完成时 32 个测试文件 / 135 个测试；当前总 39 个文件 / 185 个测试；真实 PTY + fake 模型/分类器验证危机卡出现、安全动作与会话继续；长历史/摘要失败/增量摘要/预算裁剪/审计/设置页由测试覆盖。

### 修改 / 新增的主要文件

- `src/prompts/**`、`src/core/safety/{types,rules,classifier}.ts`
- `src/services/{safetyService,crisisResources,contextService,summaryService}.ts`
- `src/db/migrations/{003_safety,004_context_audit_entries}.ts`、`src/db/repositories/{riskRepository,summaryRepository,contextAuditRepository}.ts`
- `src/services/{sessionService,chatService,appService}.ts`、`src/config/appConfig.ts`、`src/db/repositories/{sessionRepository,messageRepository}.ts`
- `src/ui/screens/{CrisisCard,ChatScreen,HomeScreen}.tsx`、`src/ui/App.tsx`、`src/i18n/zh-CN.ts`
- `tests/{prompts,safetyRules,riskClassifier,safetyService,crisisResources,crisisCard,contextService}.test.*`、`tests/homeContext.test.tsx`，并扩展 session/chat/appConfig/appService 测试

### 尚未完成（M3 收尾）

- **真实模型验收**：DeepSeek 已跑短会谈、危机卡、六类会后、合成摘要与安全场景；自然长对话、分类失败与 IME 未验。
- **安全 UI 打磨**：锁定 / 自动锁定仍可暂时离开危机卡；解锁后只保留风险标记，不自动重开卡片。检测有漏报与误报，卡片不是保证。
- **测试补强**：更多否定 / 影视 / 第三人称组合；分类模型超时、解析失败与跨轮升级的 PTY 场景；资源文件权限与损坏情况。
- **M4 仍在进行**：会后 5/6 任务、备忘录带入、来信信箱、进度页与内部记录页已完成；常驻 worker 与记忆提取仍待做。

### 已知风险

- **安全检测不保证覆盖所有风险**；规则会误报/漏报，分类模型也可能失败或判断错误。不要因为 M3 收尾就把产品描述为“安全”。
- 分类模型、滚动摘要与主会谈使用同一个配置，会把必要片段发送给同一服务商；这是模型复核与摘要的代价。
- 提醒/卡片不能替代现实紧急支持；AI 不能到场或联系急救。
- 摘要可能丢失细节或写错；它只是工作假设，当前表达始终优先。

---

## 2026-10-26 — M2 完成

### 已完成

- **002_sessions 迁移**：sessions / messages / model_usage；外键级联、单开放会谈触发器、状态与角色约束、会话/消息索引。
- **会谈生命周期**：draft → active → ended；同一时间只允许一个未完成会谈；空 draft 清理；空会谈结束时删除；标题取首条用户消息前 24 字；继续最近一场 ended；删除级联消息。
- **Provider**：OpenAI-compatible / Ollama `/chat/completions` SSE；手写 data 行解析、`[DONE]`、usage、非流式 JSON 回退；401/403、404、429、5xx 与协议错误映射；用户取消与 180s 超时区分；错误不包含 Key。
- **ChatService**：用户消息落库、系统提示 + 最近历史（默认 40 条）、流式助手消息、每 500ms 草稿落库、停止后标 interrupted、失败标 failed 并保留半截内容、重试替换最后一条助手回复、模型用量入库。
- **会谈 TUI**：主页新建 / 继续 / 会谈列表；流式消息；停止、重试、滚动、侧栏、计时；Ctrl+K 菜单（结束、导出、删除、锁定、返回）；只读查看已结束会谈。
- **Markdown 导出**：导出前再次输入启动密码；文件 0600；默认含免责声明、AI 披露、会话信息、消息与来信；备忘录/记忆卡/内部记录由导出页勾选。
- **单实例锁**：数据目录 `instance.lock`，PID 存活检测与陈旧锁替换；第二个实例被拒绝；正常退出释放。
- **崩溃恢复**：启动时把 streaming 消息标为 interrupted；锁定时先停止流式并等待落库，再关闭数据库。
- **临时安全基线**：单一系统提示包含 AI 披露、非诊断、危机转介与不提供方法；这是 M3 分层 Prompt 与危机卡之前的过渡实现。
- **验证**：24 个测试文件 / 92 个测试；真实 PTY + 本地 fake OpenAI 服务完成设置 → 会谈 → 停 / 退出 → 解锁继续 → 结束 → 只读查看 → 导出，不调用真实模型。

### 修改 / 新增的主要文件

- `src/db/migrations/002_sessions.ts`、`src/db/repositories/{sessionRepository,messageRepository,modelUsageRepository}.ts`
- `src/services/{sessionService,chatService,exportService,instanceLock}.ts`、`src/core/tokens.ts`、`src/core/counseling/systemPrompt.ts`
- `src/providers/{types,openaiCompatible}.ts`
- `src/ui/screens/{ChatScreen,SessionListScreen}.tsx`、`src/ui/format.ts`
- `src/ui/App.tsx`、`src/ui/screens/HomeScreen.tsx`、`src/ui/components/SelectList.tsx`、`src/ui/MultilineInput.tsx`、`src/ui/runTui.tsx`
- `src/i18n/zh-CN.ts`
- `tests/{sessionService,chatService,openaiCompatible,exportService,instanceLock,messageRecovery,tokens,chatScreen,sessionList}.test.*`
- 更新 `tests/{appService,migrations,app}.test.*`、`src/services/{appService,doctor}.ts`

### 验证

~~~bash
npm run check
npm run build
npm run doctor
~~~

结果：typecheck 通过；lint 退出码 0；24 个测试文件 / 92 个测试通过；构建成功；doctor 全部 PASS（migrations 显示 001_init + 002_sessions）。

真实终端冒烟（临时脚本在 .tmp，不提交）：

- 本地 fake OpenAI 服务提供 `/v1/models` 与 SSE `/v1/chat/completions`。
- 首次设置 → 新建会谈 → 流式回复 → Ctrl+C 回主页 → 退出 → 重新解锁 → 继续当前会谈 → 结束 → 会谈列表只读 → 导出。
- 导出文件 0600，包含对话原文，不包含启动密码；数据库 / 保险库 / 配置 / secrets 均为 0600。
- 第二实例在锁被占用时被拒绝；退出后锁文件被删除。

### 已知限制

- **没有危机检测与危机卡片**；M3 完成前不应用于高风险或紧急场景。
- **没有 Prompt 分层、快照、上下文预算、滚动摘要**；当前是单一临时系统提示，历史只按最近 40 条截断。
- 没有会后六项流水线、备忘录、来信（M4）。
- 没有记忆卡、召回、记忆库（M5）。
- 没有备份 / 彻底删除 / 主题 / 完整命令面板（M6）。
- 模型配置 UI 只有单档案；分任务模型映射未做。
- 停止生成与重试有服务层测试；PTY 冒烟未覆盖每个键位组合。
- 终端回滚、截图、录屏可能包含会谈内容与恢复短语；JS 内存无法保证物理擦除。
- 仅 Linux 验证。

### 下一步 M3

- Prompt 分层与冻结快照：counselor/core、shared/values、shared/ethics、counselor/dialogue、counselor/voice、model/contract；伦理与安全每轮实时注入。
- 上下文预算与裁剪顺序、滚动摘要、脱敏上下文审计。
- 安全规则层 + 模型复核：level / evidence / rationale / confidence / context；跨轮升级；失败不放行明确危险。
- 危机卡片与本地资源模板；「我现在安全 / 继续谈 / 查看资源 / 结束会谈」。
- 用 fake 分类模型与规则测试危机场景、否定 / 第三人称 / 影视 / 过去时误报。
- 在 M3 前不要用 M2 做真实高风险会谈。

---

## 2026-10-26 — M1 完成

### 已完成

- **首次设置**：知情同意、启动密码、12 词恢复短语展示与随机 3 词确认、称呼 / 年龄提示 / 时区、模型配置与连接测试；模型可暂时跳过。
- **保险库落盘**：`vault.json` 0600 原子写；create / unlock / recover / rewrap 接到 UI；恢复短语在创建保险库之前完成确认，中途退出不会留下未抄写的保险库。
- **解除锁定**：启动密码解锁、恢复短语恢复并设置新密码、修改密码；失败递增等待（1s、2s、4s…，上限 30s）；手动锁定与闲置自动锁定（0/5/10/30 分钟）；锁定时关闭数据库、清空数据库密钥与内存中的 API Key。
- **配置**：`config.toml` 用 Zod strict schema 校验，拒绝未知字段与任何 key / secret / token / password 字段；TOML 0600 原子写；时区校验与回退。
- **API Key**：用数据库密钥经 HKDF-SHA256 派生独立子密钥，AES-256-GCM 加密到 `secrets.enc`（0600）；配置、日志、错误信息都不含明文 Key。
- **数据库初始化**：001_init 创建 `app_meta`、`profile`、`settings`；迁移执行器逐版本事务、幂等、失败回滚；已有数据迁移前用 `VACUUM INTO` 生成加密备份。
- **文件权限**：数据 / 配置目录 0700，数据库（含 WAL/SHM）、保险库、配置、secrets 0600。
- **模型连接**：base URL 归一化；除 localhost / 127.0.0.1 外只允许 HTTPS；先 `GET /models`，失败再发最小 `/chat/completions`；超时 8 秒；错误信息脱敏。
- **TUI**：设置向导、锁定屏、恢复屏、主页、设置、模型重配、数据去向、系统自检、关于；启用中文文案集中管理（`src/i18n/zh-CN.ts`）。
- **doctor**：新增迁移、API Key 加密、配置往返、已有文件权限、setup 状态、数据库落盘形态检查；同一套检查进入设置页“系统自检”。
- **验证**：15 个测试文件 / 53 个测试；真实 PTY 完成首次设置 → 退出 → 解锁 → 退出 → 恢复短语恢复 → 新密码解锁，并确认所有敏感文件 0600、配置无明文密码、数据库非明文。

### 修改 / 新增的主要文件

- `src/config/appConfig.ts`、`src/config/atomicFile.ts`、`src/config/paths.ts`
- `src/core/endpoint.ts`、`src/security/vaultStore.ts`、`src/security/secrets.ts`
- `src/db/migrations/index.ts`、`src/db/migrations/001_init.ts`、`src/db/backup.ts`、`src/db/repositories/profileRepository.ts`
- `src/services/appService.ts`、`src/services/setupPolicy.ts`、`src/services/lockout.ts`、`src/services/doctor.ts`
- `src/providers/connectionTest.ts`
- `src/i18n/zh-CN.ts`、`src/ui/App.tsx`、`src/ui/runTui.tsx`
- `src/ui/components/{SingleLineInput,SelectList,ScreenFrame}.tsx`
- `src/ui/screens/{SetupWizard,LockScreen,HomeScreen,ModelSetup,DiagnosticsScreen}.tsx`
- `tests/{appConfig,appService,endpoint,secrets,vaultStore,migrations,setupPolicy,lockout,connectionTest,doctor}.test.ts`
- `tests/{app,diagnostics}.test.tsx`

### 验证命令

```bash
npm run doctor
npm run typecheck
npm run lint
npm test
npm run build
```

期望：doctor 全部 PASS；typecheck 无输出；lint 退出码 0；15 个测试文件、53 个测试通过；build 产出 dist/cli.js。

真实终端冒烟（脚本在 `.tmp/pty_smoke.py`，不提交）：

```bash
python3 .tmp/pty_smoke.py
```

覆盖：首次同意 → 密码 → 恢复短语 → 3 词确认 → 档案 → 跳过模型 → 主页 → 退出 → 再启动解锁 → 恢复短语恢复 → 新密码解锁。

### 已知限制

- 仍然不会调用模型，也没有会谈、消息、摘要、记忆、来信、会后产物。
- 模型配置 UI 只有单档案；配置结构与数据库还没有分任务模型覆盖。
- 没有 Prompt 分层、上下文预算、安全规则、危机卡片。
- 没有备份 / 导出 / 彻底删除；迁移备份已有，但用户侧恢复入口未做。
- 没有单实例锁；同一数据目录同时开两个进程尚未拦截。
- 输入光标已改为终端真实光标；IME 候选框定位仍需真实终端验收。
- 仅 Linux 验证；macOS 的预编译与 CI 尚未补。
- 终端回滚、截图、录屏可能包含恢复短语；文档已说明，软件无法清除。

### 下一步 M2

- 002 迁移：sessions、messages、rolling_summaries、post_session_jobs 等会谈表。
- 会谈状态机：draft → active → ended；空会谈删除；继续上一次会谈。
- Provider：OpenAI-compatible / Ollama 的 SSE 流式、停止生成、超时与错误处理。
- 会谈 TUI：流式消息、滚动、发送 / 停止 / 重试、侧栏显示模型与状态。
- Markdown 导出；消息与用量落库。
- 首次真实会谈的验收清单与 fake provider 集成测试。

---

## 2026-10-26 — M0 完成

### 已完成

- 项目骨架：TypeScript strict、ESM、Biome、Vitest、tsup、npm scripts。
- SQLCipher：better-sqlite3-multiple-ciphers 13 + SQLite 3.53.4；使用 SQLCipher 兼容 cipher；落盘非明文；错误密钥拒绝；重开正常。
- FTS5：trigram 分词，中文检索可用。
- 保险库：scrypt（N=65536, r=8, p=1）+ AES-256-GCM 包裹 32 字节数据库密钥；12 词 BIP39 恢复短语；改密后恢复短语仍有效。
- TUI：Ink 8 全屏壳、alternate screen、可折叠侧栏、多行输入、Ctrl+J 换行、Ctrl+B 侧栏、中文输入、粘贴、窄终端提示。
- CLI：默认启动 TUI；doctor 子命令检查 Node、数据目录、SQLCipher、FTS5、重开、错误密钥、保险库。
- 文档：README、规格、来源说明、NOTICE、Apache-2.0、CI。
- 测试：4 个文件 / 14 个测试；PTY 冒烟启动与退出正常。

### 已知限制（M0 当时）

- 界面是回显探针：不调用模型、不持久化会谈、没有首次启动流程。
- 输入光标是绘制块，不是终端真实光标。
- SQLCipher 通过 SQLite3MC 的 sqlcipher cipher 实现，不是直接链接上游 SQLCipher C 库。
- 仅 Linux 验证。