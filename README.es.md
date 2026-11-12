🌐 [日本語](README.md) | [English](README.en.md) | [简体中文](README.zh-CN.md) | [한국어](README.ko.md) | **Español**

# Telegram Harness

Administra canales con la Bot API oficial y, además, la cuenta del propietario con GramJS (MTProto). Las escrituras pasan por la misma cola de aprobación. Límites no verificados: docs/user-account.md.

Las publicaciones, respuestas, ediciones y borrados son borradores. Aprobar cambia el estado y no envía. El publisher envía únicamente borradores ya aprobados y vencidos. El worker local es un dry-run y no arranca si `TELEGRAM_ALLOW_NETWORK=true`.

**Versión**: v0.3.0 · MIT · TypeScript / Cloudflare Workers + D1

Incluye varios bots y canales, borradores de texto, foto, vídeo, álbum y botones, cola de aprobación, envío programado, edición y borrado aprobados, `getChatMemberCount` (las vistas quedan en null), webhooks con respuestas que también esperan aprobación, intake desde otros borradores e integración MCP y SDK.

Los límites comprobados y los que siguen sin cifra están en [docs/bot-api-limits.md](docs/bot-api-limits.md). El arranque local está en [docs/manual/01-local.md](docs/manual/01-local.md).

Membresías, pagos con Stars, reservas, widgets, Mini App y MCP (36 herramientas) están en `apps/membership-bot`; también disponibles como servicio alojado en The Harness Cloud (https://theharness.cloud). Detalles en [README.en.md](README.en.md).

```bash
pnpm install
pnpm check
pnpm --filter worker dev
```
