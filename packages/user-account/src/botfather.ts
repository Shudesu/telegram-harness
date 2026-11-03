import { USER_RATE_LIMITS } from "./limits.js";
import { redactUserText } from "./redact.js";

export interface BotFatherStep {
  text?: string;
  file?: Uint8Array;
}

export interface BotFatherScript {
  steps: BotFatherStep[];
  expectToken: boolean;
}

const REJECTED = /sorry|already taken|username is invalid|invalid username|too many attempts|too many requests|I don't understand/i;

export function botFatherRejected(reply: string): boolean {
  return REJECTED.test(reply);
}

export function buildBotFatherScript(action: string, payload: Record<string, unknown>): BotFatherScript {
  const username = typeof payload.username === "string" ? payload.username : "";
  const mention = `@${username}`;
  switch (action) {
    case "botfather_create_bot":
      return {
        steps: [{ text: "/newbot" }, { text: String(payload.displayName ?? "") }, { text: username }],
        expectToken: true,
      };
    case "botfather_set_name":
      return { steps: [{ text: "/setname" }, { text: mention }, { text: String(payload.name ?? "") }], expectToken: false };
    case "botfather_set_description":
      return {
        steps: [{ text: "/setdescription" }, { text: mention }, { text: String(payload.text ?? "") }],
        expectToken: false,
      };
    case "botfather_set_about":
      return { steps: [{ text: "/setabouttext" }, { text: mention }, { text: String(payload.text ?? "") }], expectToken: false };
    case "botfather_set_commands":
      return {
        steps: [
          { text: "/setcommands" },
          { text: mention },
          { text: formatCommands(payload.commands) },
        ],
        expectToken: false,
      };
    case "botfather_set_photo":
      return { steps: [{ text: "/setuserpic" }, { text: mention }, { file: new Uint8Array() }], expectToken: false };
    case "botfather_fetch_token":
      return { steps: [{ text: "/token" }, { text: mention }], expectToken: true };
    case "botfather_revoke_token":
      return { steps: [{ text: "/revoke" }, { text: mention }], expectToken: true };
    default:
      throw new Error("invalid_action");
  }
}

export function extractBotToken(replies: readonly string[]): string | null {
  const token = replies.join("\n").match(/\d{6,12}:[A-Za-z0-9_-]{20,}/);
  return token ? token[0] : null;
}

export function rejectionError(reply: string): Error {
  const snippet = redactUserText(reply).replace(/\s+/g, " ").slice(0, 80);
  return new Error(`botfather_rejected:${snippet}`);
}

export interface BotFatherTransport {
  send(peer: string, step: BotFatherStep): Promise<void>;
  maxId(peer: string): Promise<number>;
  incomingAfter(peer: string, afterId: number): Promise<{ id: number; text: string } | null>;
}

export async function exchangeWithBotFather(
  transport: BotFatherTransport,
  steps: BotFatherStep[],
  sleep: (ms: number) => Promise<void>,
): Promise<string[]> {
  if (steps.length < 1 || steps.length > USER_RATE_LIMITS.maxBotFatherSteps) throw new Error("botfather_script_too_long");
  const peer = "botfather";
  const replies: string[] = [];
  for (const step of steps) {
    const before = await transport.maxId(peer);
    await transport.send(peer, step);
    let incoming: { id: number; text: string } | null = null;
    for (let attempt = 0; attempt < USER_RATE_LIMITS.botFatherPolls; attempt += 1) {
      incoming = await transport.incomingAfter(peer, before);
      if (incoming) break;
      await sleep(USER_RATE_LIMITS.botFatherPollMs);
    }
    if (!incoming) throw new Error("botfather_no_reply");
    if (botFatherRejected(incoming.text)) throw rejectionError(incoming.text);
    replies.push(incoming.text);
  }
  return replies;
}

function formatCommands(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => {
      const command = (item as { command?: string }).command ?? "";
      const description = (item as { description?: string }).description ?? "";
      return `${command} - ${description}`;
    })
    .join("\n");
}
