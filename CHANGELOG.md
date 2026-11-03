# Changelog

## 0.1.0

First version of Telegram Harness.

- Multi-bot, multi-channel registration through the official Bot API only
- Drafts for text, photo, video, album, and inline buttons
- Approval queue. Publish, reply, edit, and delete wait for an explicit approve, then for the publisher
- Scheduled send of approved drafts
- Webhook storage and approved reply drafts
- Intake of cross-post drafts
- Channel member counts. Message views are reported as unavailable via Bot API
- MCP server and TypeScript SDK
- Tests against a mocked Bot API. No live sends
