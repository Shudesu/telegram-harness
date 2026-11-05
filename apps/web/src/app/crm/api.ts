import "server-only";
export async function crmApi<T>(path: string, body?: unknown): Promise<T> {
  const base = process.env.TELEGRAM_HARNESS_API_URL;
  const key = process.env.API_KEY;
  if (!base || !key)
    throw new Error(
      "管理APIの接続設定がありません。READMEのローカル起動手順を確認してください。",
    );
  let response: Response;
  try {
    response = await fetch(`${base}/api/crm/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new Error(
      "管理APIに接続できません。ローカルworkerを起動してください。",
    );
  }
  const result = await response.json();
  if (!response.ok)
    throw new Error(`操作できませんでした: ${result.error ?? response.status}`);
  return result as T;
}
export interface List<T> {
  data: T[];
  nextCursor: string | null;
}
