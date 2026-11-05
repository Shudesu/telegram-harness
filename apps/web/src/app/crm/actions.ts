"use server";
import { redirect } from "next/navigation";
import { crmApi } from "./api";
async function mutate(path: string, body: unknown, back: string) {
  let notice = "保存しました";
  try {
    await crmApi(path, body);
  } catch (error) {
    notice = error instanceof Error ? error.message : "保存できませんでした";
  }
  redirect(`${back}?notice=${encodeURIComponent(notice)}`);
}
const value = (f: FormData, key: string) => String(f.get(key) ?? "");
export async function addCustomer(f: FormData): Promise<void> {
  await mutate(
    "customers",
    {
      displayName: value(f, "displayName"),
      source: value(f, "source"),
      tags: value(f, "tags")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    },
    "/crm/customers",
  );
}
export async function addSlot(f: FormData): Promise<void> {
  await mutate(
    "slots",
    {
      title: value(f, "title"),
      startsAt: value(f, "startsAt"),
      endsAt: value(f, "endsAt"),
      capacity: Number(value(f, "capacity")),
    },
    "/crm/bookings",
  );
}
export async function bookSlot(f: FormData): Promise<void> {
  await mutate(
    "bookings",
    {
      customerId: value(f, "customerId"),
      slotId: value(f, "slotId"),
      requestKey: value(f, "requestKey"),
    },
    "/crm/bookings",
  );
}
export async function cancelBooking(f: FormData): Promise<void> {
  await mutate(
    `bookings/${encodeURIComponent(value(f, "id"))}/cancel`,
    {},
    "/crm/bookings",
  );
}
