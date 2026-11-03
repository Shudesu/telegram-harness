/**
 * Harness policy, not a published Telegram limit.
 * MTProto ceilings change per account and are not fixed in this repo. Unknown official numbers stay unknown.
 */
export const USER_RATE_LIMITS = {
  minWriteIntervalMs: 3_000,
  maxWritesPerHour: 20,
  maxReadsPerMinute: 20,
  maxLoginPerHour: 3,
  maxBotFatherSteps: 6,
  floodWaitRetryMaxSeconds: 30,
  dialogLimit: 100,
  botFatherPolls: 8,
  botFatherPollMs: 500,
} as const;
