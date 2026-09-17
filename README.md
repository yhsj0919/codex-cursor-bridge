# Codex Cursor Bridge

一个专门让 Codex Desktop/CLI 使用本机 Cursor Agent 模型的轻量兼容桥。

当前处于阶段 A：验证常驻 ACP 进程能否连续创建独立 session，并测量冷启动与复用后的延迟。

详细设计、已知问题和实施计划见 [PLAN.md](./PLAN.md)。

## 开发命令

```powershell
npm install
npm run check
npm run build
npm run probe
```

`probe` 会复用同一个 ACP 进程，连续创建三个独立 session，并输出排队、建会话、首字和总耗时。
