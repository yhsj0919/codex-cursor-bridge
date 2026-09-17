# Codex Cursor Bridge

一个专门让 Codex Desktop/CLI 使用本机 Cursor Agent 模型的轻量兼容桥。

它只做一件事：把本机已登录的 Cursor Agent 转成 Codex 可用的 Responses API。没有网页后台、账号池或其他代理接口。

详细设计、已知问题和实施计划见 [PLAN.md](./PLAN.md)。

## 最快使用

1. 安装 Node.js 22 或更高版本，以及 Cursor Agent。
2. 在 PowerShell 中确认 `agent status` 已登录。
3. 首次安装时运行 `npm install` 和 `npm run build`。
4. 双击 `启动代理.bat`。
5. 完全退出 Codex 后，双击 `切换模型来源.bat`，选择 `2. Cursor 模型`。
6. 重新打开 Codex，在其模型选择器中选择 Cursor 模型及思考档位。

切回官方模型时，完全退出 Codex，再运行 `切换模型来源.bat` 并选择 `1`。脚本会恢复切换前保存的完整官方配置。

详细配置、项目工作区和换机步骤见 [Windows 使用指南](./docs/WINDOWS-使用指南.md)。

## 开发与检查

```powershell
npm install
npm run check
npm run build
npm run probe
```

`probe` 会复用同一个 ACP 进程，连续创建三个独立 session，并输出排队、建会话、首字和总耗时。

命令行启动：

```powershell
npm run build
npm start
```
