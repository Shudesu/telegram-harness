🌐 [日本語](README.md) | [English](README.en.md) | **简体中文** | [한국어](README.ko.md) | [Español](README.es.md)

# Telegram Harness

用官方 Bot API 管理多个 Telegram 频道和群组。不使用用户账号自动化，也不使用 MTProto。

发帖、回复、编辑和删除都会先成为草稿。批准只改变状态，不会发送。publisher 只处理已经批准且到期的草稿。本地 worker 是 dry-run，并且会拒绝 `TELEGRAM_ALLOW_NETWORK=true`。

**版本**: v0.1.0 · MIT · TypeScript / Cloudflare Workers + D1

功能包括多机器人与频道注册、图文与相册草稿、审批队列、定时发布、已发布消息的编辑和删除、`getChatMemberCount`（阅读数保持为 null）、Webhook 收件与待审批回复、从其他 SNS 草稿导入的 intake，以及 MCP 和 TypeScript SDK。

已核对的限制和未确认的项目见 [docs/bot-api-limits.md](docs/bot-api-limits.md)。本地运行见 [docs/manual/01-local.md](docs/manual/01-local.md)。

```bash
pnpm install
pnpm check
pnpm --filter worker dev
```
