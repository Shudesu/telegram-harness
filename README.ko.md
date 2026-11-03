🌐 [日本語](README.md) | [English](README.en.md) | [简体中文](README.zh-CN.md) | **한국어** | [Español](README.es.md)

# Telegram Harness

공식 Bot API만으로 여러 Telegram 채널과 그룹을 관리한다. 사용자 계정 자동화와 MTProto는 쓰지 않는다.

게시, 답장, 수정, 삭제는 초안이 된다. 승인은 상태를 바꿀 뿐 전송하지 않는다. publisher가 이미 승인되었고 시각이 된 초안만 보낸다. 로컬 worker는 dry-run이며 `TELEGRAM_ALLOW_NETWORK=true`이면 시작을 거부한다.

**버전**: v0.1.0 · MIT · TypeScript / Cloudflare Workers + D1

여러 봇과 채널 등록, 텍스트·이미지·동영상·앨범·버튼 초안, 승인 큐, 예약 발행, 발행된 메시지의 수정·삭제, `getChatMemberCount`(조회수는 null), Webhook 수신과 승인 전 답장 초안, 다른 SNS 초안 intake, MCP와 TypeScript SDK를 포함한다.

확인한 한도와 모르는 항목은 [docs/bot-api-limits.md](docs/bot-api-limits.md), 로컬 실행은 [docs/manual/01-local.md](docs/manual/01-local.md)에 있다.

```bash
pnpm install
pnpm check
pnpm --filter worker dev
```
