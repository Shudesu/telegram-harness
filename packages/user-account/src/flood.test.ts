import { describe, expect, it } from "vitest";
import { floodWaitSeconds, withFloodWait } from "./flood.js";

describe("FLOOD_WAIT", () => {
  it("waits once for a short wait and does not wait for a long one", async () => {
    const slept: number[] = [];
    let calls = 0;
    const value = await withFloodWait(
      async () => {
        calls += 1;
        if (calls === 1) throw Object.assign(new Error("FLOOD_WAIT_2"), { seconds: 2 });
        return "ok";
      },
      async (ms) => {
        slept.push(ms);
      },
    );
    expect(value).toBe("ok");
    expect(slept).toEqual([2000]);

    await expect(
      withFloodWait(
        async () => {
          throw new Error("FLOOD_WAIT_45");
        },
        async () => {
          throw new Error("should not sleep");
        },
      ),
    ).rejects.toThrow("flood_wait:45");
  });

  it("does not retry a login send", async () => {
    let calls = 0;
    await expect(
      withFloodWait(
        async () => {
          calls += 1;
          throw new Error("FLOOD_WAIT_1");
        },
        async () => undefined,
        { retry: false },
      ),
    ).rejects.toThrow("flood_wait:1");
    expect(calls).toBe(1);
    expect(floodWaitSeconds(Object.assign(new Error("x"), { seconds: 9 }))).toBe(9);
  });
});
