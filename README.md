# Codex Cursor Bridge

一个专门让 Codex Desktop/CLI 使用本机 Cursor Agent 模型的轻量兼容桥。

当前已完成常驻 ACP 原型、小型连接池，以及最小 `/healthz`、`/v1/models`、`/v1/responses` 文本接口。下一步实现模型规范化和完整 Responses SSE 事件兼容。

详细设计、已知问题和实施计划见 [PLAN.md](./PLAN.md)。

## 开发命令

```powershell
npm install
npm run check
npm run build
npm run probe
```

`probe` 会复用同一个 ACP 进程，连续创建三个独立 session，并输出排队、建会话、首字和总耗时。

启动开发服务：

```powershell
npm run build
npm start
```
