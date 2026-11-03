# Local dry-run

```bash
pnpm install
pnpm --filter worker dev
```

The worker listens on port 8787 and refuses to start if `TELEGRAM_ALLOW_NETWORK=true`. Its default API key is the placeholder `dev-local-api-key` unless `API_KEY` is set. The bot token variable may be the placeholder `local-dry-run-token`. Neither value is a real credential.

Register a bot with `tokenEnvName: "TELEGRAM_BOT_TOKEN_MAIN"`, register a channel, create a draft, approve it, then `POST /api/publisher/run`. The debug route `GET /api/debug/telegram-calls` lists the dry-run methods. It is not mounted for a live client.

The approval screen:

```bash
TELEGRAM_HARNESS_API_URL=http://localhost:8787 API_KEY=dev-local-api-key pnpm --filter web dev
```

Open http://localhost:3005. API_KEY stays on the server. Do not put it in `NEXT_PUBLIC_*`.

MCP, from a checkout, with the same base URL and key:

```bash
TELEGRAM_HARNESS_API_URL=http://localhost:8787 TELEGRAM_HARNESS_API_KEY=dev-local-api-key pnpm exec tsx packages/mcp/src/index.ts
```

`pnpm exec tsx` uses the `tsx` installed with the worker package.
