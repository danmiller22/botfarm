import { sendMessage, getText, getFileURL, type Update, type Message } from "./telegram.ts";
import { TELEGRAM_TOKEN } from "./env.ts";
import { getState, setState, reset, type ReportData } from "./state.ts";
import { driveUpload, sheetsAppend } from "./google.ts";

const DASHBOARD_URL = "https://danmiller22.github.io/us-team-fleet-dashboard/";

const kb_main = { keyboard: [[{ text: "New report" }, { text: "Dashboard" }]], resize_keyboard: true, one_time_keyboard: false };
const kb_unit = { keyboard: [[{ text: "Truck" }, { text: "Trailer" }]], resize_keyboard: true, one_time_keyboard: true };
const kb_paid = { keyboard: [[{ text: "company" }, { text: "driver" }]], resize_keyboard: true, one_time_keyboard: true };
const rm = { remove_keyboard: true } as const;

type Step =
  | "idle" | "await_unit_type" | "await_truck_number" | "await_trailer_number"
  | "await_trailer_truck_number" | "await_description" | "await_paidby"
  | "await_total" | "await_notes" | "await_invoice";

export async function onUpdate(update: Update) {
  const msg = update.message;
  if (!msg) return;

  const chatId = msg.chat.id;
  const raw = (getText(msg) ?? "").trim();
  const t = raw.toLowerCase();

  if (t === "/start" || t === "/cancel") return ready(chatId);
  if (t === "dashboard") { await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: `Dashboard: ${DASHBOARD_URL}`, reply_markup: kb_main }); return; }
  if (t === "new report") return startFlow(chatId);

  const state = getState(chatId) as any as { step: Step; data?: any };

  switch (state.step) {
    case "await_unit_type": {
      if (t === "truck") { setState(chatId, { step: "await_truck_number", data: { unitType: "Truck" } }); return send(chatId, "Truck #:", rm); }
      if (t === "trailer") { setState(chatId, { step: "await_trailer_number", data: { unitType: "Trailer" } }); return send(chatId, "Trailer #:", rm); }
      return send(chatId, "Choose Truck or Trailer", kb_unit);
    }

    case "await_truck_number": {
      if (raw) { setState(chatId, { step: "await_description", data: { ...(state.data ?? {}), truck: raw, unitType: "Truck" } }); return send(chatId, "Describe the issue:", rm); }
      return send(chatId, "Truck #: enter a number", rm);
    }

    case "await_trailer_number": {
      if (raw) { setState(chatId, { step: "await_trailer_truck_number", data: { ...(state.data ?? {}), trailer: raw, unitType: "Trailer" } }); return send(chatId, "Truck # with this trailer:", rm); }
      return send(chatId, "Trailer #: enter a number", rm);
    }

    case "await_trailer_truck_number": {
      if (raw) { setState(chatId, { step: "await_description", data: { ...(state.data ?? {}), truck: raw } }); return send(chatId, "Describe the issue:", rm); }
      return send(chatId, "Truck # with this trailer: enter a number", rm);
    }

    case "await_description": {
      if (raw) { setState(chatId, { step: "await_paidby", data: { ...(state.data ?? {}), description: raw } }); return send(chatId, "Paid By:", kb_paid); }
      return send(chatId, "Describe the issue:", rm);
    }

    case "await_paidby": {
      const isCompany = ["company", "c", "comp"].includes(t);
      const isDriver = ["driver", "d"].includes(t);
      if (isCompany || isDriver) {
        setState(chatId, { step: "await_total", data: { ...(state.data ?? {}), paidBy: isCompany ? "company" : "driver" } });
        return send(chatId, "Total amount (e.g. 525.94):", rm);
      }
      return send(chatId, "Choose: company or driver", kb_paid);
    }

    case "await_total": {
      const amount = parseAmount(raw);
      if (amount !== null) { setState(chatId, { step: "await_notes", data: { ...(state.data ?? {}), total: amount } }); return send(chatId, "Notes (optional). Send text or '-' to skip:", rm); }
      return send(chatId, "Enter a number like 120, 120.50 or $120.50", rm);
    }

    case "await_notes": {
      setState(chatId, { step: "await_invoice", data: { ...(state.data ?? {}), notes: (raw && raw !== "-") ? raw : undefined } });
      return send(chatId, "Send invoice (photo or PDF):", rm);
    }

    case "await_invoice": {
      const file = extractFileId(msg);
      if (!file) return; // ждём файл без спама
      const fUrl = await getFileURL(TELEGRAM_TOKEN, file.file_id);
      if (!fUrl) return send(chatId, "Cannot fetch file.", rm);

      const fr = await fetch(fUrl.url);
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

      await send(chatId, "Saved. " + link, rm);
      return ready(chatId);
    }

    default:
      return startFlow(chatId);
  }
}

/* helpers */
async function ready(chatId: number) {
  reset(chatId);
  await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Ready.", reply_markup: kb_main });
}
async function startFlow(chatId: number) {
  reset(chatId);
  setState(chatId, { step: "await_unit_type" } as any);
  await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Unit:", reply_markup: kb_unit });
}
async function send(chatId: number, text: string, reply_markup?: any) {
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
