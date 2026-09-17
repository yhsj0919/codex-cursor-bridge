# Codex Cursor Bridge 重构计划

## 1. 项目目标

创建一个独立、精简的 Node.js + TypeScript 服务，让 Codex Desktop/CLI 可以把本机已经登录的 Cursor Agent 当作自定义模型提供方使用。

项目只解决 Codex 与 Cursor Agent 的兼容问题，不继承旧项目的管理后台、多账户池、Anthropic API、通用代理等功能。

目标使用方式：

1. 启动本地 Bridge。
2. 通过中文批处理在“Codex 官方模型”和“Cursor 模型”两类提供方之间切换。
3. 在 Codex 自带的模型选择器中选择 Cursor 的具体模型和思考档位。
4. 正常使用 Codex 的文件编辑、命令执行、测试和工具调用能力。

## 2. 已确认的运行环境

- Windows。
- Node.js 已安装并可用。
- Cursor Agent 路径通常为：
  `C:\Users\<用户名>\AppData\Local\cursor-agent\agent.cmd`
- `agent status` 可以确认登录状态。
- `agent --list-models` 可以列出当前账号真实可用的模型。
- Codex 自定义提供方通过本地 Responses API 接入。
- 默认监听地址计划为 `http://127.0.0.1:8765`。

## 3. 旧实现中已经遇到的问题

### 3.1 ACP 重复登录

旧实现会在每次建立 ACP 会话时调用：

```text
authenticate(methodId = cursor_login)
```

即使 `cursor-agent` 已经登录，也会拉起 Cursor 登录页。

处理原则：

- 启动时使用 `agent status` 或 `agent --list-models`做一次登录预检。
- 预检成功后，ACP 连接不得再次主动调用 `cursor_login`。
- 预检失败必须明确报错，不允许静默启动。

### 3.2 chat-only 隔离会隐藏登录凭据

旧实现的 chat-only 模式同时覆盖了 `HOME`、`USERPROFILE`、`APPDATA`、`LOCALAPPDATA` 和 `CURSOR_CONFIG_DIR`，导致 ACP 无法读取当前 Windows 用户的 Cursor 登录状态，返回：

```text
Authentication required
```

直接关闭隔离可以工作，但不同任务会共享真实工作区文件状态。

新实现必须把两个概念分开：

- 认证环境：复用真实 Windows 用户的 Cursor 凭据。
- 工作目录：每个 Codex 项目或任务独立管理，不能通过伪造用户目录实现隔离。

### 3.3 Auto 在 CLI 和 ACP 中表示不同

Cursor CLI 的模型列表包含：

```text
auto - Auto
```

但 ACP 的会话模型目录不一定存在名为 `auto` 的条目。直接调用 `session/set_config_option` 会报：

```text
ACP model catalog has no match for "auto"
```

处理原则：

- Codex 模型目录继续显示 `Auto (Cursor)`。
- 对外模型 ID 使用 `auto`。
- 进入 ACP 后，`auto` 表示不设置具体模型，使用 ACP 会话默认模型。
- `auto` 忽略 Codex 自动附带的 reasoning effort，不能拼成 `auto-low`。

### 3.4 模型列表重复与思考档位

`agent --list-models` 会把同一个基础模型的不同思考档位、Fast 版本分别列成多个 ID，例如：

```text
gpt-5.6-sol-high
gpt-5.6-sol-xhigh
gpt-5.6-sol-high-fast
```

Codex 需要看到基础模型，并通过 reasoning effort 选择 `low`、`medium`、`high`、`xhigh` 或 `max`。

处理原则：

- 按基础模型合并思考档位。
- Fast 模型保持为独立模型项。
- Claude 可能使用 `模型-档位-thinking` 顺序，必须正确解析。
- 模型不支持请求的档位时返回明确错误，不能静默改用其他模型。
- Composer 等确实没有思考档位的模型，可以忽略 Codex 继承的 reasoning effort。

### 3.5 获取模型失败时写入空目录

旧流程可能在 `agent --list-models` 失败时仍覆盖 Codex 配置，造成模型列表为空。

处理原则：

- 模型获取失败或结果为空时立即停止。
- 保留原 `config.toml` 和原模型目录。
- 使用临时文件加原子替换。
- TOML 和 JSON 使用 UTF-8 无 BOM。

### 3.6 Windows 批处理编码错误

中文直接写入 `.bat` 曾出现乱码，并把注释残片当作命令执行。

处理原则：

- `.bat` 只保留 ASCII 启动包装。
- 中文交互放在 UTF-8 PowerShell 脚本中。
- 所有脚本支持直接双击，并始终从脚本所在目录运行。

### 3.7 Codex 模式与 Cursor 模式不是一回事

Codex 的模型选择器不会切换 Cursor 的 `ask`、`plan`、`agent` 模式。

处理原则：

- Bridge 默认使用 Cursor `agent` 模式。
- API 内部保留按请求覆盖模式的能力，但不依赖 Codex UI 提供该字段。
- 模型选择和 reasoning effort 与执行模式分别处理。

### 3.8 每次请求延迟高

实测极短的 `Auto` 请求连续两次都需要约 14 秒：

- 第一次约 13.8 秒。
- 第二次约 14.5 秒。
- 模型列表已有缓存，因此不是模型列表请求导致。

旧实现每次普通请求都会：

1. 启动新的 `cursor-agent` 子进程。
2. ACP initialize。
3. ACP session/new。
4. 设置模型。
5. 发送 prompt。
6. 结束子进程。

新实现的重点优化：

- 常驻 ACP 进程，避免每次冷启动 Cursor Agent。
- 每个 Codex 对话使用独立 ACP session，不能复用同一个聊天 session。
- ACP 进程可以复用，但消息、工具状态和上下文必须按 sessionId 隔离。
- 支持并发请求路由，不能把不同 session 的通知发给错误请求。
- 设置空闲超时、崩溃重启和最大连接数。
- 加入分阶段耗时日志，分别记录进程启动、initialize、session/new、首字和完成耗时。

注意：Cursor 上游模型本身的推理时间无法由 Bridge 消除。常驻池只能降低本地进程和协议初始化开销，必须通过基准测试确认收益。

### 3.9 错误信息被吞掉

旧实现捕获 ACP 异常后只返回：

```text
The Cursor agent process exited with code 1
```

真实原因没有写入日志。

处理原则：

- 保存 ACP JSON-RPC 错误、stderr 尾部和失败阶段。
- 对外返回安全、明确的错误码。
- 日志中记录完整诊断信息，但不得记录认证令牌和完整敏感提示词。

### 3.10 Cursor 权限请求无法显示为 Codex 提权确认

已观察到某些需要提权的操作不会在 Codex 中弹出确认，随后 Cursor 只报告“没有获取权限”。根因是 Cursor ACP 的 `session/request_permission` 和 Codex 客户端的审批/沙箱权限不是同一套协议，不能把 ACP 的 `allow-once` 简单当作 Codex 已授权。

处理原则：

- 未识别的 Cursor 原生文件、终端或系统权限默认拒绝，绝不静默批准。
- Codex 提供的工具通过 Bridge 自己的 MCP 工具服务暴露给 Cursor。
- Cursor 请求 Bridge 工具时，只允许生成标准 Responses tool call；真正执行仍交给 Codex，因此权限确认由 Codex 正常显示。
- 只有明确识别为 Bridge 自有、且尚未执行外部副作用的 MCP 调用，才可以在 ACP 层自动选择 `allow-once`。
- Cursor 自带 shell、文件编辑、浏览器或其他未知工具不能绕过 Codex 权限系统。
- 无法转交给 Codex 的提权请求返回明确的 `permission_required`/`unsupported_permission_bridge` 错误，包含工具名称和请求类型，不再只显示“没有权限”。
- Windows UAC 属于操作系统级确认，不能伪装成普通 ACP 权限；需要由 Codex 实际执行命令时走其现有提权流程。

## 4. 新项目范围

### 必须实现

- `GET /healthz`
- `GET /v1/models`
- `POST /v1/responses`
- Responses API 非流式文本输出
- Responses API SSE 流式输出
- function tool 调用
- custom tool 调用（Codex 实际使用时需要）
- 工具结果回传和 ACP 会话续接
- Cursor 模型发现与规范化
- reasoning effort 映射
- `Auto` 特殊映射
- Cursor 登录预检
- ACP 常驻连接管理
- session 隔离
- Codex `config.toml` 安全切换
- 中文 Windows 启动和切换脚本
- 最小日志与耗时诊断
- 自动测试

### 明确不实现

- Web 管理后台
- Anthropic Messages API
- Chat Completions API，除非 Codex 实测确实需要
- 多 Cursor 账号轮换
- API Key 计费或网关
- 公网监听
- macOS launchd 服务
- Linux systemd 服务
- 通用反向代理
- 与兼容目标无关的模型别名

## 5. 建议架构

```text
src/
  main.ts                 启动入口
  config.ts               环境变量和本地配置
  http/
    server.ts             HTTP 路由、请求限制、错误处理
    responses.ts          Responses API
    models.ts             模型目录接口
    sse.ts                SSE 编码
  cursor/
    discovery.ts          agent 路径、登录和模型发现
    model-catalog.ts      模型分组与 reasoning 映射
  acp/
    protocol.ts           ACP 类型和 JSON-RPC 编解码
    connection.ts         单个常驻 ACP 进程
    pool.ts               连接池、空闲回收、崩溃恢复
    session.ts            sessionId 与请求状态
    router.ts             通知按 sessionId 路由
  tools/
    bridge.ts             Codex 工具与 ACP MCP 桥接
    registry.ts           工具调用和结果续接
  codex/
    config.ts             TOML 备份、原子更新和恢复
    catalog.ts            生成 Codex 模型目录 JSON
  logging/
    logger.ts             安全日志
    timing.ts             分阶段耗时
scripts/
  start.ps1
  switch-provider.ps1
启动代理.bat
切换模型来源.bat
docs/
  WINDOWS-使用指南.md
```

## 6. ACP 常驻池设计要求

这是重构的核心，必须先验证再扩展功能。

- 一个 ACP 进程完成一次 initialize 后保持运行。
- 每个新 Codex 请求创建新的 ACP session，除非它是同一工具调用链的续接。
- `session/update`、权限请求和 Cursor 扩展消息必须依据 sessionId 分派。
- 如果某种 ACP 通知不携带 sessionId，则该连接同一时间只能服务一个活动 session。
- 首版可以使用“连接池 + 每连接单活动 session”，避免并发串流。
- 请求结束后销毁 session 状态，但连接可以进入空闲池。
- 工具调用未完成时 session 必须保留，并设置 TTL。
- 客户端断开时取消对应 session，不能杀掉整个共享进程，除非协议不支持安全取消。
- ACP 进程退出后，当前请求失败；后续请求自动创建新进程。
- 进程池设置最大容量，避免每个模型永久保留一个子进程。

## 7. 工作区与会话隔离

- 不覆盖 Windows 用户的认证相关环境变量。
- `cwd` 使用 Codex 请求传入的真实项目目录。
- 必须校验项目路径位于允许的工作区根目录中。
- 不同 Codex 任务使用不同 ACP session。
- 相同项目的不同任务可以看见相同文件，这是正常的；不能共享聊天上下文。
- 工具调用链通过内部不可猜测 ID 关联，不只依赖客户端 IP。
- 不把整个项目复制到临时目录，否则修改无法回到真实工作区。

待验证：Codex Desktop 自定义提供方请求是否会携带可用的工作区标识。如果没有，需要选择以下方案之一：

1. 启动每个项目专用 Bridge，并固定工作区。
2. 通过自定义请求头传递工作区（需要确认 Codex 是否支持）。
3. 由切换脚本根据当前项目生成独立配置和端口。

## 8. 安全边界

- 默认只监听 `127.0.0.1`。
- 默认不要求入站 API Key，但允许用户配置。
- 不记录 Cursor token、Authorization header 或完整环境变量。
- 限制请求体大小。
- 限制并发数、ACP 进程数和工具 session TTL。
- 工作区路径必须规范化并校验，防止目录穿越。
- 修改 Codex 配置前必须备份。
- 切换失败时不能留下半写入配置。
- 不自动执行 Cursor 登录；只提示用户在控制台登录。

## 9. 分阶段实施

### 阶段 A：协议验证原型

- 创建 TypeScript 项目和测试框架。
- 实现 Cursor Agent 路径发现、登录预检和模型发现。
- 实现一个常驻 ACP 连接。
- 测量 initialize、session/new、首字和完成时间。
- 验证同一 ACP 进程连续创建多个 session 是否稳定。
- 验证 ACP 通知是否始终携带 sessionId。

验收：连续发送 10 个独立短请求，无串线、无重复登录，并得到延迟对比数据。

### 阶段 B：最小 Codex Responses API

- 实现 `/healthz`、`/v1/models` 和 `/v1/responses`。
- 支持非流式和 SSE 文本。
- 实现 Auto 和 reasoning effort 映射。
- 使用真实 Codex Desktop 测试模型选择。

验收：Codex 可选择 Cursor 模型并完成普通对话。

### 阶段 C：工具调用

- 实现 MCP 工具桥。
- 支持 function 与 custom tool。
- 支持工具结果回传、并行工具和超时。
- 验证 Codex 修改文件、执行命令、运行测试的完整闭环。

验收：在示例仓库完成“修改代码—运行测试—汇报结果”。

### 阶段 D：配置和 Windows 使用体验

- 生成规范化模型目录。
- 实现官方/Cursor 大类切换。
- 添加中文批处理和 PowerShell。
- 编写迁移文档。

验收：新电脑按照文档完成安装、登录、启动、切换和恢复官方模型。

### 阶段 E：稳定性与性能

- 并发与隔离测试。
- ACP 崩溃恢复测试。
- 客户端断开测试。
- 长工具链测试。
- 对比冷启动与常驻池的 P50/P95 首字延迟。

## 10. 测试清单

- 模型列表为空时不覆盖配置。
- Cursor 未登录时启动失败并显示登录命令。
- 已登录时不会打开登录页。
- Auto 请求成功。
- reasoning effort 正确匹配。
- 不支持的 reasoning effort 返回 400。
- Fast 与普通模型不混淆。
- 两个并发 session 的文本不串线。
- 两个工具调用链不串 call ID。
- ACP 进程崩溃后自动恢复。
- 客户端断开后取消对应 session。
- SSE 事件顺序符合 Codex 预期。
- TOML 写入无 BOM。
- 切换失败能恢复原配置。
- 路径中包含空格和中文时可运行。
- Windows 批处理无乱码。

## 11. 当前已知待处理事项

- [ ] 确认 Codex Desktop 实际发送的 Responses API 字段全集。
- [ ] 确认 Codex 工具调用使用 function tool、custom tool，还是两者都会使用。
- [ ] 确认请求是否携带稳定的任务 ID、previous_response_id 或工作区信息。
- [ ] 捕获真实 ACP `session/update`，确认 sessionId 字段位置。
- [ ] 验证一个 ACP 进程支持多少并发 session。
- [ ] 验证按模型切换是否必须创建不同 ACP 进程。
- [ ] 验证 Cursor `agent` 模式下的权限请求处理。
- [ ] 确认 Cursor Agent 更新后 ACP 协议兼容性。
- [ ] 设计连接池容量、排队和超时默认值。
- [ ] 确认新电脑迁移时 Cursor Agent 的安装方式和路径变化。
- [ ] 决定是否需要自动检测 Codex 正在运行并拒绝切换配置。
- [ ] 捕获真实 `session/request_permission` 样本，区分 Bridge MCP、Cursor 原生 shell、文件编辑和其他工具。
- [ ] 验证 Codex Desktop 对 Responses tool call 的审批展示和提权行为。
- [ ] 为未知权限、用户拒绝和操作系统提权分别设计明确错误码。

## 11.1 阶段 A 首次实测结果

2026-09-17 已完成“单个常驻 ACP 进程、串行创建三个独立 session”的首次真实测试：

```text
请求 1：约 11.0 秒，返回 OK
请求 2：约 6.5 秒，返回 OK
请求 3：约 6.1 秒，返回 OK
```

结论：

- 同一个 Cursor ACP 进程可以连续创建多个独立 session。
- 复用进程后短请求耗时从旧实现约 14 秒下降到约 6 秒。
- 首次请求仍包含 Cursor 侧冷启动成本。
- 当前原型在单连接内串行执行，因此不会发生通知串线。
- 下一步需要实现小型连接池，在保持“每连接单活动 session”的前提下支持并发。

阶段 B 首次 HTTP 实测：

```text
GET /healthz：200
GET /v1/models：返回 223 个 Cursor 原始模型
POST /v1/responses 请求 1：约 11.4 秒，返回 OK
POST /v1/responses 请求 2：约 7.4 秒，返回 OK
连接池状态：size=1, busy=0, idle=1, waiting=0
```

已完成最小连接池：默认最多两个常驻 ACP 连接；每个连接只允许一个活动 session；空闲连接复用；满池请求排队；失效连接淘汰。

## 12. 已验证的参考实现行为

旧项目 `E:\cursor-api-proxy` 可作为行为参考，但不直接复制架构。

已验证可工作的链路：

- ACP 开启。
- 跳过重复 `cursor_login`。
- chat-only 关闭时读取现有 Cursor 登录凭据。
- `auto` 映射为 ACP 会话默认模型。
- `/v1/responses` 返回 HTTP 200 和 `OK`。
- Codex 模型目录可以显示 Cursor 模型。

已验证的失败链路：

- chat-only 覆盖用户目录后返回 `Authentication required`。
- 把 `auto` 当作 ACP 目录模型时返回无匹配错误。
- ACP 异常被吞掉时只能看到无意义的退出代码。

旧项目最近的兼容提交：

```text
42edd1a feat: add Codex Cursor model compatibility
```

远程参考仓库：

```text
https://github.com/yhsj0919/cursor-api-proxy
```

## 13. 新任务开始步骤

切换到 `E:\codex-cursor-bridge` 后：

1. 阅读本文件。
2. 检查 Git 状态。
3. 从“阶段 A：协议验证原型”开始。
4. 不复制旧项目的管理后台和多 API 框架。
5. 先用真实 Cursor Agent 做 ACP 常驻与 session 隔离实验，再确定最终连接池结构。
6. 每完成一个阶段都运行测试并提交独立 Git commit。
