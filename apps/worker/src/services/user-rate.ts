import type { UserRateKind } from "@telegram-harness/shared";
import { USER_RATE_LIMITS } from "@telegram-harness/user-account";
import type { Deps } from "../deps.js";

export class RateLimitError extends Error {
  readonly code: "rate_limited_interval" | "rate_limited";

  constructor(code: "rate_limited_interval" | "rate_limited") {
    super(code);
    this.name = "RateLimitError";
    this.code = code;
  }
}

export async function consumeUserRate(deps: Deps, kind: UserRateKind): Promise<void> {
  const now = deps.now().getTime();
  if (kind === "write") {
    const latest = await deps.repo.latestUserRateEvent("write");
    if (latest && now - Date.parse(latest) < USER_RATE_LIMITS.minWriteIntervalMs) {
      throw new RateLimitError("rate_limited_interval");
    }
    const count = await deps.repo.countUserRateEvents("write", new Date(now - 3_600_000).toISOString());
    if (count >= USER_RATE_LIMITS.maxWritesPerHour) throw new RateLimitError("rate_limited");
  } else if (kind === "read") {
    const count = await deps.repo.countUserRateEvents("read", new Date(now - 60_000).toISOString());
    if (count >= USER_RATE_LIMITS.maxReadsPerMinute) throw new RateLimitError("rate_limited");
  } else {
    const count = await deps.repo.countUserRateEvents("login", new Date(now - 3_600_000).toISOString());
    if (count >= USER_RATE_LIMITS.maxLoginPerHour) throw new RateLimitError("rate_limited");
  }
  await deps.repo.addUserRateEvent({
    id: crypto.randomUUID(),
    kind,
    createdAt: new Date(now).toISOString(),
  });
}
