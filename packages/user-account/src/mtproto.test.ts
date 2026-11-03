import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { exchangeWithBotFather } from "./botfather.js";
import { LiveUserAccount } from "./client.js";
import { ADMIN_RIGHTS_ON } from "./mtproto.js";
import { mapEntity, mapMessageViews, mtprotoSignIn, mtprotoStats, type MtprotoApi, type MtprotoSocket } from "./mtproto.js";

describe("mocked GramJS mapping", () => {
  it("lists creator channels and skips users and ordinary members", () => {
    expect(mapEntity({ className: "User", id: 1, phone: "+15551212" })).toBeNull();
    expect(
      mapEntity({
        className: "Channel",
        id: 7n,
        accessHash: 8n,
        title: "Joined",
        broadcast: true,
        creator: false,
      })?.role,
    ).toBe("member");
    const owned = mapEntity({
      className: "Channel",
      id: 9n,
      accessHash: 4n,
      title: "Mine",
      username: "mine",
      broadcast: true,
      creator: true,
    });
    expect(owned).toMatchObject({ telegramId: "9", kind: "channel", role: "creator", username: "mine" });
  });

  it("reads view counts and drops chats and users that arrived with them", () => {
    const mapped = mapMessageViews(
      {
        className: "messages.MessageViews",
        views: [{ className: "MessageViews", views: 12 }],
        users: [{ id: 1, phone: "+19998887777" }],
        chats: [{ id: 2, title: "secret" }],
      },
      ["44"],
    );
    expect(mapped).toEqual([{ id: "44", views: 12 }]);
    expect(JSON.stringify(mapped)).not.toContain("+19998887777");
    expect(JSON.stringify(mapped)).not.toContain("secret");
  });

  it("refuses to sign up a new account", async () => {
    const socket = fakeSocket(async () => ({ className: "auth.AuthorizationSignUpRequired" }));
    await expect(
      mtprotoSignIn(socket, fakeApi(), { phone: "+10000000000", phoneCodeHash: "hash", code: "12345" }),
    ).rejects.toThrow("signup_refused");
  });

  it("does not return the user list from channel stats", async () => {
    const socket = fakeSocket(async (request) => {
      const kind = (request as { kind?: string }).kind;
      if (kind === "views") return { views: [{ views: 4 }], users: [{ phone: "+100" }] };
      if (kind === "full") return { fullChat: { participantsCount: 3, about: "hello" }, users: [{ id: 9 }] };
      if (kind === "stats") return { className: "stats.BroadcastStats", followers: { current: 3 }, viewsPerPost: { current: 4 } };
      throw new Error("unexpected");
    });
    const stats = await mtprotoStats(socket, fakeApi(), { telegramId: "1", accessHash: "2" }, ["8"]);
    expect(stats.messages).toEqual([{ id: "8", views: 4 }]);
    expect(stats.participantsCount).toBe(3);
    expect(stats.broadcastStats?.followers).toBe(3);
    expect(JSON.stringify(stats)).not.toContain("+100");
  });

  it("drives a live client through a fake socket and keeps the session off the call log", async () => {
    const seen: unknown[] = [];
    const api = fakeApi();
    api.createChannel = (input) => {
      seen.push(input);
      return { kind: "create", ...input };
    };
    const socket = fakeSocket(async () => ({
      chats: [{ className: "Channel", id: 55n, accessHash: 90n, title: "News", broadcast: true, creator: true }],
    }));
    const client = new LiveUserAccount(async () => ({
      api,
      socket,
      exportSession: () => "rotated-session",
      close: async () => undefined,
    }));
    const chat = await client.createChannel("old-session", { title: "News", about: "", megagroup: false });
    expect(chat).toMatchObject({ telegramId: "55", role: "creator", kind: "channel" });
    expect(seen).toEqual([{ title: "News", about: "", megagroup: false }]);
    expect(client.takeSessionUpdate()).toBe("rotated-session");
    expect(JSON.stringify(client.calls)).not.toContain("old-session");
    expect(JSON.stringify(client.calls)).not.toContain("rotated-session");
  });

  it("only talks to BotFather and stops when BotFather rejects the username", async () => {
    const peers: string[] = [];
    let sent = 0;
    await expect(
      exchangeWithBotFather(
        {
          async send(peer) {
            peers.push(peer);
            sent += 1;
          },
          async maxId(peer) {
            peers.push(peer);
            return 1;
          },
          async incomingAfter(peer) {
            peers.push(peer);
            return { id: 2, text: "Sorry, this username is already taken." };
          },
        },
        [{ text: "/newbot" }, { text: "Name" }, { text: "taken_bot" }],
        async () => undefined,
      ),
    ).rejects.toThrow(/botfather_rejected/);
    expect(sent).toBe(1);
    expect(new Set(peers)).toEqual(new Set(["botfather"]));
  });
});

describe("GramJS source boundaries", () => {
  it("does not scrape members, invite strangers, sign up accounts, or increment views", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "gramjs.ts"), "utf8");
    expect(source).not.toContain("GetParticipants");
    expect(source).not.toContain("InviteToChannel");
    expect(source).not.toContain("ImportContacts");
    expect(source).not.toContain("SignUp");
    expect(source).toContain("increment: false");
    expect(source).toContain('peer !== "botfather"');
    expect(source).toContain("floodSleepThreshold: 0");
    expect(ADMIN_RIGHTS_ON.addAdmins).toBe(false);
    expect(source).toContain("ADMIN_RIGHTS_ON");
  });
});

function fakeApi(): MtprotoApi {
  return {
    signIn: (input) => ({ kind: "signIn", input }),
    getPassword: () => ({ kind: "password" }),
    createChannel: (input) => ({ kind: "create", input }),
    editTitle: () => ({ kind: "title" }),
    editAbout: () => ({ kind: "about" }),
    editUsername: () => ({ kind: "username" }),
    editPhoto: () => ({ kind: "photo" }),
    editAdmin: (_channel, _user, admin) => ({ kind: "admin", admin }),
    getFullChannel: () => ({ kind: "full" }),
    getMessagesViews: () => ({ kind: "views" }),
    getBroadcastStats: () => ({ kind: "stats" }),
    inputChannel: (telegramId, accessHash) => ({ telegramId, accessHash }),
  };
}

function fakeSocket(invoke: (request: unknown) => Promise<unknown>): MtprotoSocket {
  return {
    invoke,
    sendCode: async () => ({ phoneCodeHash: "hash", isCodeViaApp: true }),
    checkPassword: async () => "1",
    getDialogEntities: async () => [],
    getEntity: async (username) => ({ className: "User", username }),
    upload: async () => ({ className: "InputFile" }),
    exchangeBotFather: async () => [],
    exportSession: () => "session-value",
  };
}
