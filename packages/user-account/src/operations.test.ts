import { describe, expect, it, vi } from "vitest";
import { Api } from "telegram";
import bigInt from "big-integer";
import { userFixtures } from "../../shared/src/api-test-fixtures.js";
import { type UserOperation } from "@telegram-harness/shared";
import { executeGramOperation, type OperationClient } from "./operations.js";
import { LiveUserAccount } from "./client.js";

function mockClient() {
  const requests: unknown[] = [];
  const channel = new Api.InputPeerChannel({ channelId: bigInt(1), accessHash: bigInt(2) });
  const poll = new Api.Poll({ id: bigInt(1), question: new Api.TextWithEntities({ text: "Question", entities: [] }), answers: [new Api.PollAnswer({ text: new Api.TextWithEntities({ text: "A", entities: [] }), option: Buffer.from([0]) })] });
  const media = new Api.MessageMediaPoll({ poll, results: new Api.PollResults({ results: [], totalVoters: 0 }) });
  const client = {
    getDialogs: vi.fn(async () => [{ id: bigInt(1), title: "Chat", unreadCount: 0 }]),
    getMessages: vi.fn(async () => [{ id: 1, media, message: "hello", toJSON: () => ({ id: 1, message: "hello" }) }]),
    sendMessage: vi.fn(async (_peer, options) => {
      if (options.file?.getBytes) expect(options.file.getBytes().length).toBeGreaterThan(0);
      return { id: 2 };
    }),
    editMessage: vi.fn(async () => ({ id: 1 })),
    deleteMessages: vi.fn(async () => []),
    forwardMessages: vi.fn(async () => [{ id: 2 }]),
    sendFile: vi.fn(async () => ({ id: 2 })),
    iterDownload: vi.fn(async function* () { yield Buffer.from([1,2,3]); }),
    getInputEntity: vi.fn(async () => channel),
    getEntity: vi.fn(async () => ({})), getMe: vi.fn(async () => ({})),
    uploadFile: vi.fn(async () => new Api.InputFile({ id: bigInt(1), parts: 1, name: "test.png", md5Checksum: "" })),
    invoke: vi.fn(async (request: { getBytes(): Buffer }) => {
      // Actual GramJS TL constructors must serialize, not just be counted by mocks.
      expect(request.getBytes().length).toBeGreaterThan(0);
      requests.push(request);
      return true;
    }),
  };
  return { client, typed: client as unknown as OperationClient, requests };
}

const expected = {
  dialogs: "getDialogs", history: "getMessages", search: "getMessages", send_message: "sendMessage", edit_message: "editMessage", delete_messages: "deleteMessages", forward_messages: "forwardMessages", send_media: "sendFile", download_media: "iterDownload",
  contacts: "contacts.GetContacts", delete_contact: "contacts.DeleteContacts", folders: "messages.GetDialogFilters", upsert_folder: "messages.UpdateDialogFilter", delete_folder: "messages.UpdateDialogFilter", send_reaction: "messages.SendReaction", stories: "stories.GetPeerStories", stories_by_id: "stories.GetStoriesByID", scheduled_messages: "messages.GetScheduledHistory", send_scheduled: "messages.SendScheduledMessages", delete_scheduled: "messages.DeleteScheduledMessages", send_poll: "sendMessage", vote_poll: "messages.SendVote", stop_poll: "messages.EditMessage", mark_read: "channels.ReadHistory", profile: "users.GetFullUser", update_profile: "account.UpdateProfile", update_username: "account.UpdateUsername", update_profile_photo: "photos.UploadProfilePhoto", join_channel: "channels.JoinChannel", leave_channel: "channels.LeaveChannel", pin_message: "messages.UpdatePinnedMessage", set_chat_permissions: "messages.EditChatDefaultBannedRights",
} satisfies Record<UserOperation, string>;

describe("GramJS owner operation adapter, mocked transport", () => {
  it.each(Object.keys(userFixtures) as UserOperation[])("%s builds the correct request", async (operation) => {
    const { client, typed, requests } = mockClient();
    if (operation === "delete_contact") client.getInputEntity.mockResolvedValue(new Api.InputPeerUser({ userId: bigInt(1), accessHash: bigInt(2) }) as never);
    await executeGramOperation(typed, operation, userFixtures[operation]);
    const method = expected[operation];
    if (method.includes(".")) expect(requests).toMatchObject([{ className: method }]);
    else expect(client[method as keyof typeof client]).toHaveBeenCalledTimes(1);
  });
  it("preserves scheduling, poll option bytes, caption, and numeric peer precision", async () => {
    const { client, typed, requests } = mockClient();
    await executeGramOperation(typed, "send_message", { peer: "-1001234567890", text: "hello", scheduleDate: 2000000000 });
    expect(String(client.sendMessage.mock.calls[0][0])).toBe("-1001234567890");
    expect(client.sendMessage.mock.calls[0][1]).toMatchObject({ message: "hello", schedule: 2000000000, parseMode: false });
    await executeGramOperation(typed, "send_media", { peer: "me", caption: "caption", file: { filename: "test.png", base64: "AQID" }, scheduleDate: 2000000000 });
    expect(client.sendFile).toHaveBeenCalledWith("me", expect.objectContaining({ caption: "caption", scheduleDate: 2000000000 }));
    await executeGramOperation(typed, "vote_poll", { peer: "me", messageId: 1, options: ["eHl6"] });
    expect(requests[0]).toMatchObject({ options: [Buffer.from("xyz")] });
  });
  it("bounds downloads and prevents paths, unknown RPCs, and invalid params from reaching the client", async () => {
    const { client, typed } = mockClient();
    client.iterDownload.mockImplementation(async function* () { yield Buffer.alloc(512001); });
    await expect(executeGramOperation(typed, "download_media", { peer: "me", messageId: 1 })).rejects.toThrow("media_exceeds_harness_limit");
    client.getMessages.mockClear();
    await expect(executeGramOperation(typed, "auth.LogOut" as never, {})).rejects.toThrow("unknown_user_operation");
    await expect(executeGramOperation(typed, "send_media", { peer: "me", file: { filename: "/private/file", base64: "AQID" } })).rejects.toThrow("invalid_user_params");
    expect(client.sendFile).not.toHaveBeenCalled();
    expect(client.getMessages).not.toHaveBeenCalled();
  });
  it("does not retry writes on FLOOD_WAIT; closes the socket on failure", async () => {
    const close = vi.fn(async () => {});
    const executeOperation = vi.fn(async () => { throw new Error("FLOOD_WAIT_1"); });
    const open = vi.fn(async () => ({ socket: { executeOperation }, api: {}, exportSession: () => "mock-session", close }));
    const sleep = vi.fn(async () => {});
    const client = new LiveUserAccount(open as never, sleep);
    await expect(client.executeOperation("mock-session", "send_message", userFixtures.send_message)).rejects.toThrow("flood_wait:1");
    expect(open).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
