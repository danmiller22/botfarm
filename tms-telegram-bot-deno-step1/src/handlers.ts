import { sendMessage, getText, getFileURL, type Update, type Message } from "./telegram.ts";
import { TELEGRAM_TOKEN } from "./env.ts";
import { getState, setState, reset, type ReportData } from "./state.ts";
import { driveUpload, sheetsAppend } from "./google.ts";

const DASHBOARD_URL = "https://danmiller22.github.io/us-team-fleet-dashboard/";

type Step =
  | "idle" | "await_unit_type" | "await_truck_number" | "await_trailer_number"
  | "await_trailer_truck_number" | "await_description" | "await_paidby"
  | "await_total" | "await_notes" | "await_invoice";

const KB_MAIN = { keyboard: [[{ text: "New report" }, { text: "Dashboard" }]], resize_keyboard: true, one_time_keyboard: false };
const KB_UNIT = { keyboard: [[{ text: "Truck" }, { text: "Trailer" }]], resize_keyboard: true, one_time_keyboard: true };
const KB_PAID = { keyboard: [[{ text: "company" }, { text: "driver" }]], resize_keyboard: true, one_time_keyboard: true };
const RM = { remove_keyboard: true } as const;

export async function onUpdate(update: Update) {
  const msg = update.message;
  if (!msg) return;

  const chatId = msg.chat.id;
  const raw = (getText(msg) ?? "").trim();
  const t = raw.toLowerCase();

  // меню
  if (t === "/start" || t === "/cancel") return ready(chatId);
  if (t === "dashboard") { await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: DASHBOARD_URL, reply_markup: KB_MAIN }); return; }
  if (t === "new report") return startFlow(chatId);

  const state = getState(chatId) as any as { step: Step; data?: any };

  switch (state.step) {
    case "await_unit_type": {
      if (t === "truck") {
        setState(chatId, { step: "await_truck_number", data: { unitType: "Truck" } });
        return ask(chatId, "Truck #:", RM);
      }
      if (t === "trailer") {
        setState(chatId, { step: "await_trailer_number", data: { unitType: "Trailer" } });
        return ask(chatId, "Trailer #:", RM);
      }
      return ask(chatId, "Unit:", KB_UNIT);
    }

    case "await_truck_number": {
      if (raw) {
        setState(chatId, { step: "await_description", data: { ...(state.data ?? {}), truck: raw, unitType: "Truck" } });
        return ask(chatId, "Describe the issue:", RM);
      }
      return ask(chatId, "Truck #:", RM);
    }

    case "await_trailer_number": {
      if (raw) {
        setState(chatId, { step: "await_trailer_truck_number", data: { ...(state.data ?? {}), trailer: raw, unitType: "Trailer" } });
        return ask(chatId, "Truck # with this trailer:", RM);
      }
      return ask(chatId, "Trailer #:", RM);
    }

    case "await_trailer_truck_number": {
      if (raw) {
        setState(chatId, { step: "await_description", data: { ...(state.data ?? {}), truck: raw } });
        return ask(chatId, "Describe the issue:", RM);
      }
      return ask(chatId, "Truck # with this trailer:", RM);
    }

    case "await_description": {
      if (raw) {
        setState(chatId, { step: "await_paidby", data: { ...(state.data ?? {}), description: raw } });
        return ask(chatId, "Paid By:", KB_PAID);
      }
      return ask(chatId, "Describe the issue:", RM);
    }

    case "await_paidby": {
      if (t === "company" || t === "driver") {
        setState(chatId, { step: "await_total", data: { ...(state.data ?? {}), paidBy: t } });
        return ask(chatId, "Total amount (e.g. 525.94):", RM);
      }
      return ask(chatId, "Paid By:", KB_PAID);
    }

    case "await_total": {
      const amount = parseAmount(raw);
      if (amount !== null) {
        setState(chatId, { step: "await_notes", data: { ...(state.data ?? {}), total: amount } });
        return ask(chatId, "Notes (optional). Send text or '-' to skip:", RM);
      }
      return ask(chatId, "Total amount (e.g. 525.94):", RM);
    }

    case "await_notes": {
      setState(chatId, { step: "await_invoice", data: { ...(state.data ?? {}), notes: (raw && raw !== "-") ? raw : undefined } });
      return ask(chatId, "Send invoice (photo or PDF):", RM);
    }

    case "await_invoice": {
      const file = extractFileId(msg);
      if (!file) return ask(chatId, "Send invoice (photo or PDF):", RM);

      const f = await getFileURL(TELEGRAM_TOKEN, file.file_id);
      if (!f) return ask(chatId, "Cannot fetch file.", RM);

      const fr = await fetch(f.url);
      const buf = new Uint8Array(await fr.arrayBuffer());
      const filename = suggestName(msg, file.kind);
      const up = await driveUpload(filename, fr.headers.get("content-type") ?? undefined, buf);
      const link = `https://drive.google.com/uc?id=${up.id}`;

      const d = { ...(state.data ?? {}) } as ReportData & { total?: string };
      const dateStr = new Date().toLocaleDateString("en-US");
      const asset = d.unitType === "Truck"
        ? `truck ${d.truck ?? ""}`.trim()
        : `TRL ${d.trailer ?? ""} ( unit ${d.truck ?? ""} )`.replace("  ", " ");
      const row = [dateStr, asset, d.description ?? "", d.total ?? "", d.paidBy ?? "", who(msg), link, d.notes ?? ""];
      await sheetsAppend(row);

      await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Saved. " + link, reply_markup: RM });
      return ready(chatId);
    }

    default:
      return startFlow(chatId);
  }
}

/* helpers */
async function ready(chatId: number) {
  reset(chatId);
  await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Ready.", reply_markup: KB_MAIN });
}
async function startFlow(chatId: number) {
  reset(chatId);
  setState(chatId, { step: "await_unit_type" } as any);
  await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Unit:", reply_markup: KB_UNIT });
}
async function ask(chatId: number, text: string, reply_markup?: any) {
  await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text, ...(reply_markup ? { reply_markup } : {}) });
}
function who(m: Message) { return m.from?.username ? "@"+m.from.username : [m.from?.first_name, m.from?.last_name].filter(Boolean).join(" "); }
function extractFileId(m: Message): { file_id: string; kind: "photo" | "document" } | null {
  if (m.photo && m.photo.length > 0) return { file_id: m.photo[m.photo.length - 1].file_id, kind: "photo" };
  if (m.document) return { file_id: m.document.file_id, kind: "document" };
  return null;
}
function suggestName(m: Message, kind: "photo" | "document") {
  const base = Date.now();
  const whoPart = m.from?.username ? m.from.username : (m.from?.first_name ?? "user");
  return `${whoPart}_${base}.${kind === "photo" ? "jpg" : "pdf"}`;
}
function parseAmount(s: string): string | null {
  if (!s) return null;
  let x = s.trim().replace(/[^\d,.\-]/g, "").replace(/,/g, ".");
  if (!/^[-]?\d*\.?\d*$/.test(x)) return null;
  const n = Number(x);
  if (!isFinite(n)) return null;
  return n.toFixed(2).replace(/\.00$/, (/\./.test(x) ? ".00" : ""));
}
