import { describe, expect, it } from "vitest";
import { BOT_API_LIMITS, redactSecrets, validatePublishPayload } from "./index.js";

describe("validatePublishPayload", () => {
  it("accepts a text draft and rejects an over-long raw string", () => {
    expect(validatePublishPayload("text", { text: "hello" })).toBeNull();
    expect(validatePublishPayload("text", { text: "x".repeat(BOT_API_LIMITS.textMax + 1) })).toBe("text_length");
  });

  it("rejects buttons on albums because sendMediaGroup has no reply_markup", () => {
    const error = validatePublishPayload("album", {
      text: "cap",
      media: [
        { type: "photo", url: "https://example.com/a.jpg" },
        { type: "video", url: "https://example.com/b.mp4" },
      ],
      buttons: [{ text: "open", url: "https://example.com" }],
    });
    expect(error).toBe("album_reply_markup_unsupported");
  });

  it("rejects albums outside 2-10 items", () => {
    expect(
      validatePublishPayload("album", {
        media: [{ type: "photo", url: "https://example.com/a.jpg" }],
      }),
    ).toBe("album_size");
  });
});

describe("redactSecrets", () => {
  it("removes token material from error text", () => {
    const hidden = redactSecrets("failed with 123456789:AA-example-token-value", [
      "123456789:AA-example-token-value",
    ]);
    expect(hidden).not.toContain("AA-example");
    expect(hidden).toContain("[redacted]");
  });
});
