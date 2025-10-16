import { sendMessage, getText, getFileURL, type Update, type Message } from "./telegram.ts";
import { TELEGRAM_TOKEN } from "./env.ts";
import { getState, setState, reset, type ReportData } from "./state.ts";
import { driveUpload, sheetsAppend } from "./google.ts";
import { withLock } from "./kv_lock.ts";

/* ================== UI ================== */

const DASHBOARD_URL = "https://danmiller22.github.io/us-team-fleet-dashboard/";

type Step =
  | "idle" | "await_unit_type" | "await_truck_number" | "await_trailer_number"
  | "await_trailer_truck_number" | "await_description" | "await_paidby"
  | "await_total" | "await_notes" | "await_invoice";

const KB_MAIN  = { keyboard: [[{ text: "New report" }, { text: "Dashboard" }]], resize_keyboard: true, one_time_keyboard: false };
const KB_UNIT  = { keyboard: [[{ text: "Truck" }, { text: "Trailer" }]], resize_keyboard: true, one_time_keyboard: true };
const KB_PAID  = { keyboard: [[{ text: "company" }, { text: "driver" }]], resize_keyboard: true, one_time_keyboard: true };
const RM       = { remove_keyboard: true } as const;

/* ============= идемпотентность/дебаунс ============ */

// дроп дубликатов Telegram
const seenUpdates = new Set<string>();   // `${chatId}:${update_id}`
const seenMessages = new Set<string>();  // `${chatId}:${message_id}`

// дебаунс одинаковых подсказок
const lastPrompt = new Map<number, { key: string; ts: number }>();
const PROMPT_DEBOUNCE_MS = 2000;

/* =============== ENTRYPOINT =============== */

export async function onUpdate(update: Update) {
  const msg = update.message;
  if (!msg) return;

  const chatId = msg.chat.id;
  const kU = `${chatId}:${update.update_id}`;
  const kM = msg.message_id ? `${chatId}:${msg.message_id}` : "";

  // отбрасываем повторные доставки
  if (seenUpdates.has(kU) || (kM && seenMessages.has(kM))) return;
  seenUpdates.add(kU);
  if (kM) seenMessages.add(kM);
  if (seenUpdates.size > 2000) seenUpdates.clear();
  if (seenMessages.size > 4000) seenMessages.clear();

  // атомарная обработка по chat_id (Deno KV lock)
  await withLock(chatId, async () => {
    await handle(msg);
  });
}

/* ================== FLOW ================= */

async function handle(msg: Message) {
  const chatId = msg.chat.id;
  const raw = (getText(msg) ?? "").trim();
  const t = raw.toLowerCase();

  // глобальные команды
  if (t === "/start" || t === "/cancel") return ready(chatId);
  if (t === "dashboard") { send(chatId, DASHBOARD_URL, KB_MAIN); return; }
  if (t === "new report") return startFlow(chatId);

  const state = getState(chatId) as any as { step: Step; data?: any };

  switch (state.step) {
    case "await_unit_type": {
      if (t === "truck")   { setState(chatId, { step: "await_truck_number",   data: { unitType: "Truck" } });   return askOnce(chatId, "truck_num", "Truck #:", RM); }
      if (t === "trailer") { setState(chatId, { step: "await_trailer_number", data: { unitType: "Trailer" } }); return askOnce(chatId, "trailer_num", "Trailer #:", RM); }
      return askOnce(chatId, "unit", "Unit:", KB_UNIT);
    }

    case "await_truck_number": {
      if (raw) { setState(chatId, { step: "await_description", data: { ...(state.data ?? {}), truck: raw, unitType: "Truck" } }); return askOnce(chatId, "desc", "Describe the issue:", RM); }
      return askOnce(chatId, "truck_num", "Truck #:", RM);
    }

    case "await_trailer_number": {
      if (raw) { setState(chatId, { step: "await_trailer_truck_number", data: { ...(state.data ?? {}), trailer: raw, unitType: "Trailer" } }); return askOnce(chatId, "tr_truck", "Truck # with this trailer:", RM); }
      return askOnce(chatId, "trailer_num", "Trailer #:", RM);
    }

    case "await_trailer_truck_number": {
      if (raw) { setState(chatId, { step: "await_description", data: { ...(state.data ?? {}), truck: raw } }); return askOnce(chatId, "desc", "Describe the issue:", RM); }
      return askOnce(chatId, "tr_truck", "Truck # with this trailer:", RM);
    }

    case "await_description": {
      if (raw) { setState(chatId, { step: "await_paidby", data: { ...(state.data ?? {}), description: raw } }); return askOnce(chatId, "paidby", "Paid By:", KB_PAID); }
      return askOnce(chatId, "desc", "Describe the issue:", RM);
    }

    case "await_paidby": {
      if (t === "company" || t === "driver") {
        setState(chatId, { step: "await_total", data: { ...(state.data ?? {}), paidBy: t } });
        return askOnce(chatId, "total", "Total amount (e.g. 525.94):", RM);
      }
      return askOnce(chatId, "paidby", "Paid By:", KB_PAID);
    }

    case "await_total": {
      const amount = parseAmount(raw);
      if (amount !== null) {
        setState(chatId, { step: "await_notes", data: { ...(state.data ?? {}), total: amount } });
        return askOnce(chatId, "notes", "Notes (optional). Send text or '-' to skip:", RM);
      }
      return askOnce(chatId, "total", "Total amount (e.g. 525.94):", RM);
    }

    case "await_notes": {
      setState(chatId, { step: "await_invoice", data: { ...(state.data ?? {}), notes: (raw && raw !== "-") ? raw : undefined } });
      return askOnce(chatId, "invoice", "Send invoice (photo or PDF):", RM);
    }

    case "await_invoice": {
      const file = extractFileId(msg);
      if (!file) return askOnce(chatId, "invoice", "Send invoice (photo or PDF):", RM);

      // мгновенный ответ пользователю и перевод в idle
      const cur = getState(chatId) as any;
      setState(chatId, { step: "idle", data: cur.data });
      send(chatId, "Saving…", RM);

      // фон: загрузка+запись+финальный ответ
      finalizeAsync(msg, file).catch(() => {
        send(chatId, "Error while saving. Try again.", KB_MAIN);
        reset(chatId);
      });
      return;
    }

    default:
      return; // не перезапускаем поток автоматически
  }
}

/* =============== ASYNC FINALIZE =============== */

async function finalizeAsync(msg: Message, file: { file_id: string; kind: "photo" | "document" }) {
  const chatId = msg.chat.id;

  const fUrl = await getFileURL(TELEGRAM_TOKEN, file.file_id);
  if (!fUrl) { send(chatId, "Cannot fetch file.", KB_MAIN); reset(chatId); return; }

  const fr = await fetch(fUrl.url);
  const buf = new Uint8Array(await fr.arrayBuffer());
  const filename = suggestName(msg, file.kind);

  const up = await driveUpload(filename, fr.headers.get("content-type") ?? undefined, buf);
  const link = `https://drive.google.com/uc?id=${up.id}`;

  const st = getState(chatId) as any;
  const d  = (st.data ?? {}) as ReportData & { total?: string };

  const dateStr = new Date().toLocaleDateString("en-US");
  const asset = d.unitType === "Truck"
    ? `truck ${d.truck ?? ""}`.trim()
    : `TRL ${d.trailer ?? ""} ( unit ${d.truck ?? ""} )`.replace("  ", " ");
  const row = [dateStr, asset, d.description ?? "", d.total ?? "", d.paidBy ?? "", who(msg), link, d.notes ?? ""];

  await sheetsAppend(row);

  send(chatId, "Saved. " + link, RM);
  send(chatId, "Ready.", KB_MAIN);
  reset(chatId);
}

/* =============== HELPERS =============== */

function ready(chatId: number) {
  reset(chatId);
  send(chatId, "Ready.", KB_MAIN);
}

function startFlow(chatId: number) {
  reset(chatId);
  setState(chatId, { step: "await_unit_type" } as any);
  send(chatId, "Unit:", KB_UNIT);
}

// fire-and-forget; не ждём сеть
function askOnce(chatId: number, key: string, text: string, reply_markup?: any) {
  const now = Date.now();
  const last = lastPrompt.get(chatId);
  if (!last || last.key !== key || now - last.ts > PROMPT_DEBOUNCE_MS) {
    void sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text, ...(reply_markup ? { reply_markup } : {}) }).catch(() => {});
    lastPrompt.set(chatId, { key, ts: now });
    if (lastPrompt.size > 2000) lastPrompt.clear();
  }
}
// fire-and-forget helper
function send(chatId: number, text: string, reply_markup?: any) {
  void sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text, ...(reply_markup ? { reply_markup } : {}) }).catch(() => {});
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
  return /\./.test(x) ? n.toFixed(2) : String(n);
}
