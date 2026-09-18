# Codex Cursor Bridge 交接说明

更新日期：2026-09-18  
项目目录：`E:\codex-cursor-bridge`  
GitHub：<https://github.com/yhsj0919/codex-cursor-bridge>  
当前分支：`main`

## 1. 项目目标

这个项目只负责一件事：让 Codex Desktop/CLI 通过本机 Responses API 使用当前 Windows 用户已经登录的 Cursor Agent 模型。

项目刻意不包含旧版 `cursor-api-proxy` 的网页后台、多账号池、Anthropic API、Chat Completions API和其他通用代理功能。

基本链路：

```text
Codex
  -> http://127.0.0.1:8765/v1/responses
  -> codex-cursor-bridge
  -> 常驻 cursor-agent acp
  -> Cursor 模型
```

当 Cursor 需要工具时，链路为：

```text
Cursor ACP
  -> Bridge 临时 MCP 服务
  -> Responses function/custom tool call
  -> Codex 执行工具及权限确认
  -> 工具结果返回 Bridge
  -> 原 ACP session 继续运行
```

## 2. 当前完成状态

已经实现：

- Cursor Agent 路径发现、登录/模型列表预检。
- 常驻 ACP 连接和小型连接池，默认最多两个连接。
- 每个普通请求创建独立 ACP session，避免不同 Codex 任务串上下文。
- ACP 进程异常退出后淘汰连接，后续请求自动创建新连接。
- 客户端断开时发送 `session/cancel`。
- `GET /healthz`。
- 规范化后的 `GET /v1/models`。
- `POST /v1/responses` 非流式文本响应。
- Codex 所需的 SSE 文本事件序列。
- Function Tool 和 Custom Tool。
- 工具结果回传及原 ACP session 续接。
- 工具 session 的随机 call ID、客户端归属校验、TTL 和数量上限。
- Cursor `Auto` 特殊语义：不向 ACP 强制设置模型。
- Cursor 模型思考档位合并，Fast 版本保持独立模型。
- 不支持的 reasoning effort 返回明确错误，不静默降级。
- 工作区根目录约束及 `X-Cursor-Workspace` 子目录校验。
- Codex 官方/Cursor 模型大类切换。
- 切换 Cursor 前保存完整官方配置，切回时原样恢复。
- 模型获取失败或为空时不覆盖 Codex 配置。
- 中文 PowerShell 交互和 ASCII `.bat` 包装。
- Windows 安装、使用和换机文档。

## 3. 已验证结果

最后一次完整检查：

```powershell
npm run check
npm run build
```

结果：

```text
6 个测试文件
21 项测试通过
TypeScript 构建通过
```

真实 Cursor Agent 联调结果：

- 成功读取当前账号的 223 个原始 Cursor 模型。
- 普通 Responses 请求返回 `BRIDGE_OK`。
- SSE 请求包含 `response.created`、文本 delta/done 和 `response.completed`。
- Cursor 成功发起 `echo_value({"value":42})` function call。
- 工具结果续传后，Cursor 在同一个 ACP session 中完成最终答复。
- 未触发重复 Cursor 登录。

常驻 ACP 的短请求实测：第一次约 11 秒，后续约 6～7 秒。旧实现每次冷启动约 14 秒。上游模型推理时间仍无法由 Bridge 消除。

## 4. 关键文件

```text
src/main.ts                    服务入口
src/config.ts                  环境变量配置
src/http/server.ts             Models/Responses/SSE 和工具续接
src/acp/connection.ts          单个常驻 ACP 进程
src/acp/pool.ts                ACP 连接池
src/cursor/discovery.ts        Cursor Agent 路径发现
src/cursor/models.ts           agent --list-models 解析
src/cursor/model-catalog.ts    模型与 reasoning effort 规范化
src/tools/bridge.ts            临时回环 MCP 服务
src/tools/session.ts           跨工具调用的 ACP session
src/codex/config.ts            TOML 安全编辑函数
src/codex/switch.ts            Codex 提供方和模型目录切换
scripts/start.ps1              中文启动逻辑
scripts/switch.ps1             中文切换逻辑
启动代理.bat                   双击启动入口
切换模型来源.bat              双击切换入口
docs/WINDOWS-使用指南.md       用户使用和换机说明
PLAN.md                        设计、问题记录和实施状态
```

## 5. 开始下一轮工作的步骤

切换到新项目后，先运行：

```powershell
cd E:\codex-cursor-bridge
git status
git pull --ff-only
npm install
npm run check
npm run build
```

预期 Git 状态：

```text
main...origin/main
工作区干净
```

当前已推送的最后提交应为：

```text
82a0761 test: harden Codex configuration switching
```

## 6. 本机启动和测试

确认 Cursor Agent 已登录：

```powershell
agent status
agent --list-models
```

启动固定工作区：

```powershell
.\启动代理.bat E:\需要操作的项目父目录
```

不传参数时，允许工作区默认为 Bridge 项目自身目录。

健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:8765/healthz
Invoke-RestMethod http://127.0.0.1:8765/v1/models
```

切换模型来源前，必须从系统托盘完全退出 Codex，然后运行：

```text
切换模型来源.bat
```

批处理只切换模型大类。具体 Cursor 模型和思考档位在 Codex 自带的模型选择器中选择。

## 7. 需要在新任务中优先完成的外部验收

代码和协议级测试已经完成。下一步最重要的是使用真实 Codex Desktop 做最终用户链路验收：

1. 启动 Bridge。
2. 完全退出 Codex。
3. 运行切换脚本，选择 Cursor。
4. 重新打开 Codex，确认模型选择器显示规范化后的 Cursor 模型。
5. 测试 `Auto`，确认没有 `auto-low` 或重复登录问题。
6. 选择一个明确支持的模型和思考档位进行普通问答。
7. 在测试项目中要求读取文件、修改文件、运行测试。
8. 发起需要 Codex 权限确认的命令，观察提权弹窗和拒绝后的错误信息。
9. 完全退出 Codex，切回官方模型，确认原官方配置和模型列表恢复。

这一步需要重启承载当前任务的 Codex 客户端，所以之前无法在同一任务内自动完成。

## 8. 已知边界和注意事项

### 工作区传递

Bridge 支持 `X-Cursor-Workspace`，但还需通过真实 Codex Desktop 抓包确认当前版本是否发送该请求头。

如果 Codex 不发送，就会使用 Bridge 启动时设置的固定工作区。因此当前最稳妥的用法是按项目或共同父目录启动 Bridge。

### 权限模型

未知 Cursor 原生权限请求默认拒绝，不会偷偷批准。Bridge 自己暴露给 Cursor 的 MCP 工具只生成 Responses tool call，实际副作用仍由 Codex 执行。

Windows UAC 不能由 ACP 模拟，必须由 Codex 实际执行相关命令时触发。

### 工具 session

工具 session 默认保留十分钟，Bridge 重启后会失效。此时客户端收到 `tool_session_expired`，重新发起任务即可。

### 模型目录

不要把某台电脑生成的 `%USERPROFILE%\.codex\cursor-models.json` 当作固定清单复制到其他电脑。它必须根据新电脑当前登录的 Cursor 账号重新生成。

### 配置切换

`src/codex/switch.ts` 会修改真实的 `%USERPROFILE%\.codex\config.toml`，测试切换逻辑时不要直接拿真实配置做破坏性试验。纯 TOML 编辑逻辑已有 `src/codex/config.test.ts` 覆盖。

## 9. 环境变量

```text
CURSOR_AGENT_BIN             可选，指定 Cursor Agent
CURSOR_BRIDGE_HOST           默认 127.0.0.1
CURSOR_BRIDGE_PORT           默认 8765
CURSOR_BRIDGE_POOL_SIZE      默认 2，允许 1～8
CURSOR_BRIDGE_WORKSPACE      允许的工作区根目录
```

不要覆盖 `HOME`、`USERPROFILE`、`APPDATA` 或 `LOCALAPPDATA` 来做隔离，否则 Cursor ACP 会看不到当前用户的登录凭据。

## 10. Git 和提交记录

远程仓库：

```text
origin  https://github.com/yhsj0919/codex-cursor-bridge.git
```

主要阶段提交：

```text
389b874 feat: prototype persistent Cursor ACP sessions
afac4f6 fix: make ACP permission handling explicit
d90f7a9 feat: add ACP pool and minimal Responses server
337875f feat: normalize Cursor models and reasoning efforts
a0d9835 feat: complete text streaming event sequence
fb48682 feat: bridge Responses tools through ACP MCP
02851c7 feat: finish Windows integration and tool session lifecycle
82a0761 test: harden Codex configuration switching
```

旧项目 `E:\cursor-api-proxy` 只作为历史行为参考，不要把它的管理后台或通用代理架构重新合并进来。
