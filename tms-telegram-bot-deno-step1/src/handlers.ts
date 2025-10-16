import { sendMessage, getText, getFileURL, type Update, type Message } from "./telegram.ts";
import { TELEGRAM_TOKEN } from "./env.ts";
import { getState, setState, reset, type ReportData } from "./state.ts";
import { driveUpload, sheetsAppend } from "./google.ts";

const kb_main = { keyboard: [[{ text: "New report" }]], resize_keyboard: true, one_time_keyboard: false };
const kb_unit = { keyboard: [[{ text: "Truck" }, { text: "Trailer" }]], resize_keyboard: true, one_time_keyboard: true };
const kb_paid = { keyboard: [[{ text: "company" }, { text: "driver" }]], resize_keyboard: true, one_time_keyboard: true };

export async function onUpdate(update: Update) {
  const msg = update.message ?? update.edited_message;
  if (!msg) return;
  const chatId = msg.chat.id;
  const text = getText(msg);

  if (text === "/start") { await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Ready.", reply_markup: kb_main }); reset(chatId); return; }
  if (text === "New report") { setState(chatId, { step: "await_unit_type" }); await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Unit:", reply_markup: kb_unit }); return; }

  const state = getState(chatId);
  switch (state.step) {
    case "await_unit_type":
      if (text === "Truck") { setState(chatId, { step: "await_truck_number", data: { unitType: "Truck" } }); await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Truck #:" }); return; }
      if (text === "Trailer") { setState(chatId, { step: "await_trailer_number", data: { unitType: "Trailer" } }); await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Trailer #:" }); return; }
      await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Choose Truck or Trailer", reply_markup: kb_unit }); return;

    case "await_truck_number":
      if (!text) break;
      setState(chatId, { step: "await_description", data: { ...(state.data ?? {}), truck: text, unitType: "Truck" } });
      await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Describe the issue:" }); return;

    case "await_trailer_number":
      if (!text) break;
      setState(chatId, { step: "await_trailer_truck_number", data: { ...(state.data ?? {}), trailer: text, unitType: "Trailer" } });
      await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Truck # with this trailer:" }); return;

    case "await_trailer_truck_number":
      if (!text) break;
      setState(chatId, { step: "await_description", data: { ...(state.data ?? {}), truck: text } });
      await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Describe the issue:" }); return;

    case "await_description":
      if (!text) break;
      setState(chatId, { step: "await_paidby", data: { ...(state.data ?? {}), description: text } });
      await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Paid By:", reply_markup: kb_paid }); return;

    case "await_paidby":
      if (text !== "company" && text !== "driver") { await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Choose: company or driver", reply_markup: kb_paid }); return; }
      setState(chatId, { step: "await_notes", data: { ...(state.data ?? {}), paidBy: text as "company" | "driver" } });
      await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Notes (optional). Send text or '-' to skip:" }); return;

    case "await_notes":
      setState(chatId, { step: "await_invoice", data: { ...(state.data ?? {}), notes: (text && text !== "-") ? text : undefined } });
      await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Send invoice (photo or PDF):" }); return;

    case "await_invoice": {
      const file = extractFileId(msg);
      if (!file) { await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Need a photo or a document (PDF/JPG). Try again:" }); return; }
      const fUrl = await getFileURL(TELEGRAM_TOKEN, file.file_id);
      if (!fUrl) { await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Cannot fetch file." }); return; }
      const fr = await fetch(fUrl.url);
      const buf = new Uint8Array(await fr.arrayBuffer());
      const filename = suggestName(msg, file.kind);
      const up = await driveUpload(filename, fr.headers.get("content-type") ?? undefined, buf);
      const link = `https://drive.google.com/uc?id=${up.id}`;

      const data = { ...(state.data ?? {}) } as ReportData;
      const dateStr = new Date().toLocaleDateString("en-US");
      const asset = data.unitType === "Truck" ? `truck ${data.truck ?? ""}`.trim() : `TRL ${data.trailer ?? ""} ( unit ${data.truck ?? ""} )`.replace("  "," ");
      const repair = data.description ?? "";
      const paidBy = data.paidBy ?? "";
      const comments = data.notes ?? "";
      const reportedBy = who(msg);
      const row = [dateStr, asset, repair, "", link, paidBy, comments, reportedBy];

      await sheetsAppend(row);
      await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Saved. " + link, reply_markup: { remove_keyboard: true } });
      reset(chatId);
      return;
    }
  }

  await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Press New report to start.", reply_markup: kb_main });
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
