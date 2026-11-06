import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenSession } from "./client.js";
import { openGramJsSession } from "./gramjs.js";
import { readOnlyAccountSnapshot } from "./readonly.js";
vi.mock("./gramjs.js", () => ({ openGramJsSession: vi.fn() }));
function setup() {
  const opened = {
    socket: {
      invoke: vi.fn(async () => [{ id: 123n, firstName: "Demo", phone: "private-phone", accessHash: "private-self-hash" }]),
      getDialogEntities: vi.fn(async () => [
        { className: "User", id: 42n, phone: "private-phone", message: "private-message" },
        { className: "Channel", id: 9n, accessHash: 4n, title: "Owned", creator: true, broadcast: true },
        { className: "Channel", id: 10n, accessHash: 5n, title: "Member", creator: false, broadcast: true },
      ]),
    },
    close: vi.fn(async () => undefined), exportSession: vi.fn(),
  };
  vi.mocked(openGramJsSession).mockResolvedValue(opened as unknown as OpenSession);
  return opened;
}
const options = { apiId: 1, apiHash: "test-only", session: "never-output-this-session" };
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
describe("read-only account adapter", () => {
  it("uses getMe equivalent and bounded owned/admin dialogs, omits secrets and personal messages", async () => {
    const opened = setup(), value = await readOnlyAccountSnapshot(options);
    expect(opened.socket.invoke).toHaveBeenCalledTimes(1);
    const request = opened.socket.invoke.mock.calls[0] as unknown as [{ className: string; id: Array<{ className: string }> }];
    expect(request[0].className).toBe("users.GetUsers"); expect(request[0].id[0]?.className).toBe("InputUserSelf");
    expect(opened.socket.getDialogEntities).toHaveBeenCalledWith(100);
    expect(value.chats).toHaveLength(1); expect(value.account.id).toBe("123");
    for (const forbidden of ["accessHash", "private-phone", "private-message", options.session]) expect(JSON.stringify(value)).not.toContain(forbidden);
    expect(opened.close).toHaveBeenCalledTimes(1); expect(opened.exportSession).not.toHaveBeenCalled();
  });
  it("disconnects on authorization failure without listing dialogs", async () => {
    const opened = setup(); opened.socket.invoke.mockRejectedValue(new Error("unauthorized"));
    await expect(readOnlyAccountSnapshot(options)).rejects.toThrow("unauthorized");
    expect(opened.close).toHaveBeenCalledTimes(1); expect(opened.socket.getDialogEntities).not.toHaveBeenCalled();
  });
  it("disconnects stalled requests after the read deadline", async () => {
    vi.useFakeTimers(); const opened = setup(); opened.socket.invoke.mockImplementation(() => new Promise(() => {}));
    const result = expect(readOnlyAccountSnapshot(options)).rejects.toThrow("read_timeout");
    await vi.advanceTimersByTimeAsync(20000); await result; expect(opened.close).toHaveBeenCalledTimes(1);
  });
});
