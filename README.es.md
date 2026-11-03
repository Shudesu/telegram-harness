🌐 [日本語](README.md) | [English](README.en.md) | [简体中文](README.zh-CN.md) | [한국어](README.ko.md) | **Español**

# Telegram Harness

Administra canales y grupos de Telegram solo con la Bot API oficial. No automatiza cuentas de usuario ni usa MTProto.

Las publicaciones, respuestas, ediciones y borrados son borradores. Aprobar cambia el estado y no envía. El publisher envía únicamente borradores ya aprobados y vencidos. El worker local es un dry-run y no arranca si `TELEGRAM_ALLOW_NETWORK=true`.

**Versión**: v0.1.0 · MIT · TypeScript / Cloudflare Workers + D1

Incluye varios bots y canales, borradores de texto, foto, vídeo, álbum y botones, cola de aprobación, envío programado, edición y borrado aprobados, `getChatMemberCount` (las vistas quedan en null), webhooks con respuestas que también esperan aprobación, intake desde otros borradores e integración MCP y SDK.

Los límites comprobados y los que siguen sin cifra están en [docs/bot-api-limits.md](docs/bot-api-limits.md). El arranque local está en [docs/manual/01-local.md](docs/manual/01-local.md).

```bash
pnpm install
pnpm check
pnpm --filter worker dev
```
