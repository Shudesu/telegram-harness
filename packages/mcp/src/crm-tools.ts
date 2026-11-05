import type { TelegramHarnessClient } from "@telegram-harness/sdk";
import type { ToolDef } from "./tools.js";
const string = { type: "string" };
const paging = {
  after: string,
  limit: { type: "integer", minimum: 1, maximum: 100 },
};
const customer = {
  displayName: string,
  source: string,
  tags: { type: "array", items: string, maxItems: 30 },
};
function def(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = [],
): ToolDef {
  return {
    name,
    description,
    inputSchema: { type: "object", properties, required },
  };
}
export const crmToolDefs: ToolDef[] = [
  def(
    "crm_list_customers",
    "顧客一覧。nextCursor を after に渡して続行。",
    paging,
  ),
  def(
    "crm_create_customer",
    "Botから独立した顧客台帳を登録。送信しない。",
    customer,
    ["displayName", "source"],
  ),
  def(
    "crm_get_customer",
    "連絡先・同意履歴・予約・購入を取得。",
    { customerId: string },
    ["customerId"],
  ),
  def(
    "crm_update_customer",
    "表示名・流入元・タグを置換。",
    { customerId: string, ...customer },
    ["customerId", "displayName", "source", "tags"],
  ),
  def(
    "crm_add_contact",
    "未確認の連絡先を登録。同意は別途記録。Telegram scope はBot識別子。",
    {
      customerId: string,
      kind: { type: "string", enum: ["email", "phone", "telegram"] },
      value: string,
      scope: string,
    },
    ["customerId", "kind", "value"],
  ),
  def(
    "crm_verify_contact",
    "管理者が確認済み証跡を記録。確認メール等の送信機能ではない。",
    { contactId: string, evidence: string },
    ["contactId", "evidence"],
  ),
  def(
    "crm_record_consent",
    "本人の目的別同意/撤回の証跡を追加。過去履歴は保持。",
    {
      contactId: string,
      purpose: { type: "string", enum: ["recontact", "booking", "marketing"] },
      status: { type: "string", enum: ["granted", "revoked"] },
      evidence: string,
      policyVersion: string,
      occurredAt: string,
    },
    [
      "contactId",
      "purpose",
      "status",
      "evidence",
      "policyVersion",
      "occurredAt",
    ],
  ),
  def("crm_list_slots", "予約枠と使用数。", paging),
  def(
    "crm_create_slot",
    "予約枠作成。日時はオフセット付きISO8601。",
    {
      title: string,
      startsAt: string,
      endsAt: string,
      capacity: { type: "integer", minimum: 1, maximum: 1000 },
    },
    ["title", "startsAt", "endsAt", "capacity"],
  ),
  def("crm_list_bookings", "予約・キャンセル一覧。", paging),
  def(
    "crm_book",
    "予約する。同じ試行の再送は同じrequestKeyを使用。",
    { customerId: string, slotId: string, requestKey: string },
    ["customerId", "slotId", "requestKey"],
  ),
  def(
    "crm_cancel_booking",
    "予約をキャンセル。繰返し実行しても結果は同じ。",
    { bookingId: string },
    ["bookingId"],
  ),
  def(
    "crm_export_customers",
    "顧客台帳をJSONエクスポート。全ページの保存が必要。秘密トークンは含まない。",
    paging,
  ),
  def(
    "crm_list_recontact",
    "確認済みemail/phoneかつ最新の再連絡同意ありの候補。送信はしない。",
    paging,
  ),
];
function pathId(args: Record<string, unknown>, key: string) {
  const id = args[key];
  if (typeof id !== "string" || !id.trim() || id.length > 100)
    throw new Error(`invalid_${key}`);
  return encodeURIComponent(id);
}
export async function executeCrmTool(
  client: TelegramHarnessClient,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const listPaths: Record<string, string> = {
    crm_list_customers: "customers",
    crm_list_slots: "slots",
    crm_list_bookings: "bookings",
    crm_export_customers: "export",
    crm_list_recontact: "recontact",
  };
  if (listPaths[name]) {
    const query = new URLSearchParams();
    if (args.after !== undefined) query.set("after", String(args.after));
    if (args.limit !== undefined) query.set("limit", String(args.limit));
    return client.get(`/api/crm/${listPaths[name]}?${query}`);
  }
  switch (name) {
    case "crm_create_customer":
      return client.post("/api/crm/customers", args);
    case "crm_get_customer":
      return client.get(`/api/crm/customers/${pathId(args, "customerId")}`);
    case "crm_update_customer":
      return client.post(
        `/api/crm/customers/${pathId(args, "customerId")}/update`,
        args,
      );
    case "crm_add_contact":
      return client.post(
        `/api/crm/customers/${pathId(args, "customerId")}/contacts`,
        args,
      );
    case "crm_verify_contact":
      return client.post(
        `/api/crm/contacts/${pathId(args, "contactId")}/verify`,
        args,
      );
    case "crm_record_consent":
      return client.post(
        `/api/crm/contacts/${pathId(args, "contactId")}/consents`,
        args,
      );
    case "crm_create_slot":
      return client.post("/api/crm/slots", args);
    case "crm_book":
      return client.post("/api/crm/bookings", args);
    case "crm_cancel_booking":
      return client.post(
        `/api/crm/bookings/${pathId(args, "bookingId")}/cancel`,
        {},
      );
    default:
      throw new Error(`unknown_crm_tool:${name}`);
  }
}
