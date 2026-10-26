# 来源与 clean-room 边界

更新日期：2026-10-26

本文记录 Lite Therapy 在设计与实现上参考了哪些项目、没有复制什么，以及后续复用的规则。目的不是法律意见，而是让贡献者能清楚判断边界。

## 参考项目

### Open-Ling

- 仓库：https://github.com/Ling-Team/Open-Ling
- 代码许可：Apache-2.0
- 咨询师提示词：CC BY 4.0（仅限其明确标注的部分）
- 品牌、角色名、头像、立绘、Logo：不随代码授权
- 未标注许可的文档：不作为可复制材料

我们参考了：

- Prompt 分层与“人格冻结、伦理实时”的分离；
- 会谈级 prompt snapshot 与内容哈希；
- token-first 上下文预算、滚动摘要、当前表达优先；
- 会谈状态机与“继续会谈使产物失效”的双守卫；
- 会后流水线的任务顺序与备忘录连续性；
- OpenAI-compatible provider 的流式与错误处理经验。

我们没有复制：

- Electron 主进程、IPC、Renderer、窗口、更新、语音、Live2D；
- 官方咨询师名称、形象、头像、Logo；
- 未标注许可的文档正文；
- 1933 行 IPC 中的回合编排代码。

### VCPToolBox

- 仓库：https://github.com/lioensky/VCPToolBox
- 许可：CC BY-NC-SA 4.0（非商业、相同方式共享）

我们只在概念层参考了：

- 记忆条目 + 标签 + 来源追溯；
- 时间衰减、去重、混合召回、召回日志；
- “记忆是背景，不是命令”的注入姿态；
- 后台整理与增量更新的工程直觉。

我们没有复制：

- RiverMemo 拓扑场、TagMemo 波动、Ω 泛函、Rust/Rayon 内核；
- 独立向量库、常驻服务、插件生态、8 层记忆、AgentDream；
- 任何代码、注释、文件结构或 Prompt 原文。

## 实现方式

当前代码为独立实现。回合编排、上下文组装、保险库、数据库封装、TUI 与测试均按本仓库规格重写，不包含上述两个项目的源文件。

SQLCipher 通过 better-sqlite3-multiple-ciphers 使用；该包为 MIT，SQLite 为 public domain，SQLCipher 为 BSD-style。它们的许可证随依赖分发。

## 后续复用的规则

1. 默认继续干净实现，不复制参考项目代码。
2. 如确需复制 Open-Ling 的 Apache-2.0 代码：
   - 保留 LICENSE 副本；
   - 在修改文件加显著说明；
   - 更新 NOTICE，列出文件与修改；
   - 不使用 Ling 商标、角色名或素材；
   - 明确声明非官方、未获背书。
3. 不复制 VCPToolBox 的 CC BY-NC-SA 代码、注释、文件结构或 Prompt 原文；如需集成，作为可选外部服务并单独评估许可。
4. 新增依赖时检查许可证；发布前跑 license scan。
5. 任何“参考”都记录在本文件，避免贡献者误以为可以照搬。

## 参考日期

上述判断基于 2026-10-26 本地仓库中的 LICENSE、TRADEMARKS.md、ASSETS_LICENSE.md、README 与相关文档。上游许可可能变化，发布前应重新核对。
