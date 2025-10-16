import type { Update, Message } from "grammy/types";
const base = (token: string) => `https://api.telegram.org/bot${token}`;

export async function sendMessage(token: string, payload: any) {
  const r = await fetch(base(token) + "/sendMessage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) console.error("sendMessage failed", await r.text());
}

export function getText(m?: Message): string | undefined {
  return m?.text ?? m?.caption ?? undefined;
}

export async function getFileURL(token: string, file_id: string): Promise<{ url: string } | null> {
  const gf = await fetch(base(token) + "/getFile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file_id }),
  });
  if (!gf.ok) { console.error("getFile failed", await gf.text()); return null; }
  const j = await gf.json();
  const path = j?.result?.file_path as string | undefined;
  if (!path) return null;
  return { url: `https://api.telegram.org/file/bot${token}/${path}` };
}

export type { Update, Message };
