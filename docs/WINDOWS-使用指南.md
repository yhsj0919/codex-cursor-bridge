# Windows 使用指南

## 一、这套程序做什么

Bridge 在本机启动 `cursor-agent acp`，并在 `http://127.0.0.1:8765/v1` 提供 Codex 所需的 Responses API。

- 批处理只选择“大类”：Codex 官方模型或 Cursor 模型。
- 具体模型和思考档位仍在 Codex 自带的模型选择器中选择。
- Cursor 的 `Auto` 在 ACP 中不强制设置模型，因此不会再出现 `auto-low` 或“不支持 low”的错误。
- Cursor 提出的 Codex 工具调用会交还 Codex 执行，文件、命令和提权仍走 Codex 自己的权限流程。

## 二、首次安装

需要：

- Windows 10/11
- Node.js 22 或更高版本
- Cursor Agent
- Codex Desktop 或 Codex CLI

在 PowerShell 中确认 Cursor 登录：

```powershell
agent status
agent --list-models
```

如果没有登录：

```powershell
agent login
```

进入项目目录安装并构建：

```powershell
cd E:\codex-cursor-bridge
npm install
npm run check
npm run build
```

## 三、启动 Bridge

双击以下入口会打开常驻的 Bridge 管理工具：

```text
启动代理.bat
```

管理工具提供：

```text
[1] 启动 Bridge（后台运行）
[2] 停止 Bridge
[3] 查看运行状态
[4] 重启 Bridge
[5] 环境/安装检测
[6] 查看可用模型
[7] 测试 API
[8] 查看最近日志
[9] 安装或更新 Bridge
[10] 模型来源管理
[0] 退出
```

Bridge 会在隐藏的后台进程中运行，管理菜单不会因启动或停止操作而退出。日志和进程记录保存在项目的 `.bridge-runtime` 目录中；停止操作会校验进程身份，不会终止其他 Node.js 程序。

“环境/安装检测”会统一检查 Windows、PowerShell、Node.js/npm 的版本和路径、Cursor Agent 版本与登录状态、Cursor 原始模型数量、项目依赖、构建产物、端口监听进程、Bridge API、规范化模型数量和当前 Codex 模型来源。“安装或更新 Bridge”会依次运行 `npm install`、完整检查和构建。

如果希望像旧版一样在当前窗口直接启动并查看实时日志，双击：

```text
控制台启动代理.bat
```

该入口会自动检查 Node.js、安装依赖（如果尚未安装）、构建 TypeScript、检查 Cursor 登录，然后以前台模式运行 Bridge。按 `Ctrl+C` 停止。它同样支持传入工作区根目录：

```powershell
.\控制台启动代理.bat E:\my-projects
```

默认允许的工作区根目录是 Bridge 自己的目录。若要让 Cursor 处理另一个项目，请把项目根目录作为参数传入：

```powershell
.\启动代理.bat E:\my-projects
```

这样只允许 `E:\my-projects` 及其子目录。也可以预先设置：

```powershell
$env:CURSOR_BRIDGE_WORKSPACE = 'E:\my-projects'
.\启动代理.bat
```

可选设置：

```powershell
$env:CURSOR_BRIDGE_PORT = '8765'
$env:CURSOR_BRIDGE_POOL_SIZE = '2'
```

连接池数量允许 `1` 到 `8`。默认 `2`，意味着最多同时保持两个 Cursor ACP 连接；每个连接同一时间只处理一个会话，不会把不同 Codex 任务的聊天上下文混在一起。

启动成功后可检查：

```powershell
Invoke-RestMethod http://127.0.0.1:8765/healthz
Invoke-RestMethod http://127.0.0.1:8765/v1/models
Invoke-RestMethod http://127.0.0.1:8765/v1/cursor/account
```

`/v1/cursor/account` 返回经过白名单筛选的 Cursor 登录用户、订阅等级、CLI 版本和默认模型，不返回 access token、refresh token 或本机路径。Cursor Agent 当前没有提供用量总数、剩余额度或重置时间，因此 `usage.available` 会明确为 `false`。

## 四、切换模型来源

双击以下入口会打开一个常驻的模型来源管理菜单：

```text
切换模型来源.bat
```

菜单会显示当前状态，并可以反复执行：

```text
1. 切换到 Codex 官方模型
2. 切换到 Cursor 模型
3. 查看/刷新当前状态
0. 退出
```

查看状态时不需要关闭 Codex。只有选择切换时，如果 Codex 仍在运行，菜单才会提示从系统托盘完全退出 Codex，并在当前窗口等待重试。切换完成后会自动返回菜单，不需要重新打开脚本。

选择 Cursor 时，脚本会：

1. 调用当前已登录的 `agent --list-models`。
2. 获取失败或列表为空时立即报错，绝不会写入空模型列表。
3. 把不同思考档位合并到同一个 Codex 模型项，Fast 版保留为单独模型。
4. 原子写入 `%USERPROFILE%\.codex\cursor-models.json`。
5. 备份并更新 `%USERPROFILE%\.codex\config.toml`。

为了让 Cursor 模型发起的写文件、删除和终端命令能进入 Codex 自带的授权弹窗，Cursor 模式会同时设置 `sandbox_mode = "read-only"` 和 `approval_policy = "on-request"`。切回官方模型时，会恢复首次切换前的完整官方配置。

如果 Cursor 仍尝试原生 Delete/Shell/Edit，Bridge 会拒绝该原生权限请求，并在响应中加入 `native_tool_blocked`、工具名和可用的请求参数。Cursor 随后应改用 Bridge MCP 中的等价 Codex 工具。Bridge 不会用“无副作用审批探针”冒充真实操作的授权，因为探针授权不能安全地转授给 Cursor 进程。

只有真实的 Codex 工具调用才会进入 Codex 自带的授权流程。若当前请求暴露了 `request_permissions`，Cursor 会先通过 Bridge MCP 调用它，请求文件系统或网络权限；用户批准后，再通过 Bridge MCP 重试原操作。这样授权对象与实际执行对象始终都是 Codex。

选择官方模型时，脚本会恢复首次切到 Cursor 前保存的完整官方配置。每次切换还会额外生成带时间戳的 `.bak` 文件。

重新打开 Codex 后，在模型选择器中选择具体模型。例如：

- `Auto`：交给 Cursor 自动选择。
- `GPT-5.6 Sol`：再在 Codex 中选择该模型实际支持的 `low/high/xhigh` 等档位。
- `GPT-5.6 Sol Fast`：Fast 版本是独立模型。
- Composer 等无思考档位模型：Codex 继承的思考设置会被忽略。

如果所选模型不支持某个思考档位，Bridge 会明确返回 400，不会偷偷换成其他档位。

## 五、Codex 配置示例

脚本生成的关键配置等价于：

```toml
model_provider = "cursor"
model = "auto"
model_catalog_json = "C:/Users/你的用户名/.codex/cursor-models.json"

[model_providers.cursor]
name = "Cursor Bridge"
base_url = "http://127.0.0.1:8765/v1"
wire_api = "responses"
requires_openai_auth = false
```

不建议手工复制模型条目。Cursor 可用模型会随账号和版本变化，应重新运行切换脚本获取真实列表。

## 六、工作区和不同会话

每个普通请求都会创建新的 ACP session；同一个项目下的不同 Codex 任务只共享磁盘文件，不共享聊天上下文。

工具调用链会暂时保留自己的 ACP session，使用随机 call ID、客户端标识、十分钟过期时间和数量上限隔离。Bridge 关闭后会清理这些会话。

如果 Codex 请求带有 `X-Cursor-Workspace`，Bridge 会使用该目录，但目录必须位于启动时允许的工作区根目录下。当前 Codex 版本若不发送此请求头，就使用启动时设置的固定工作区。因此，最稳妥的用法是按项目或共同父目录启动 Bridge。

## 七、复制到另一台电脑

1. 把整个 `codex-cursor-bridge` 文件夹复制到新电脑，不要复制旧电脑的 `%USERPROFILE%\.codex`。
2. 安装 Node.js 22+、Cursor Agent 和 Codex。
3. 在新电脑运行 `agent login`，再用 `agent --list-models`确认模型可见。
4. 在 Bridge 目录运行 `npm install`、`npm run check`、`npm run build`。
5. 用新电脑的实际项目根目录启动 `启动代理.bat`。
6. 完全退出 Codex，运行 `切换模型来源.bat`，选择 Cursor。
7. 重新打开 Codex测试普通问答、文件读取、文件修改和命令执行。

不要复制 `cursor-models.json`：它应由新电脑上实际登录的 Cursor 账号重新生成。

## 八、常见错误

`Cursor 尚未登录或无法获取模型`

- 在普通 PowerShell 中运行 `agent status` 和 `agent --list-models`。
- 确保启动 Bridge 的 Windows 用户与登录 Cursor Agent 的用户相同。

Codex 打开后要求重新设置 Windows 或登录

- 切换配置时 Codex 没有完全退出。退出托盘进程后重新切换。
- 不要用临时 `HOME`、`USERPROFILE` 或 `LOCALAPPDATA` 启动 Cursor Agent。

`invalid_workspace`

- 请求的项目不在启动时指定的工作区根目录中。停止 Bridge，用正确根目录重新启动。

`tool_session_expired`

- 工具结果返回太晚、Bridge 曾重启，或工具结果来自另一个客户端。重新发起任务即可。

请求仍然需要几秒

- 常驻 ACP 已消除每次启动 Cursor Agent 的大部分开销，但 Cursor 上游模型的排队和推理时间无法由 Bridge 消除。
