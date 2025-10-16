import type { Update, Message } from "grammy/types";

type ApiSendMessage = {
  chat_id: number;
  text: string;
  reply_markup?: any;
  parse_mode?: "MarkdownV2" | "HTML";
  reply_to_message_id?: number;
  disable_web_page_preview?: boolean;
};
type ApiSendChatAction = {
  chat_id: number;
  action: string; // 'typing' etc.
};
type ApiGetFile = { file_id: string };

const base = (token: string) => `https://api.telegram.org/bot${token}`;

export async function sendMessage(token: string, payload: ApiSendMessage) {
  const r = await fetch(base(token) + "/sendMessage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    console.error("sendMessage failed", await r.text());
  }
}

export async function sendAction(token: string, payload: ApiSendChatAction) {
  await fetch(base(token) + "/sendChatAction", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function getText(m?: Message): string | undefined {
  return m?.text ?? m?.caption ?? undefined;
}

export type { Update, Message };
