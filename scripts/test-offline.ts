// Test-suite network tripwire. All transports must be injected mocks; no live sockets or fetch.
import net from "node:net";
import { beforeEach, vi } from "vitest";
beforeEach(() => {
  vi.spyOn(net.Socket.prototype, "connect").mockImplementation(() => { throw new Error("network_forbidden_in_tests"); });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("network_forbidden_in_tests"); }));
});
