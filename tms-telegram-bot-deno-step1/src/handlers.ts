import { sendMessage, getText, type Update, type Message } from "./telegram.ts";
import { TELEGRAM_TOKEN, ALLOWED_CHAT_IDS } from "./env.ts";
import { getState, setState, reset, type ReportData } from "./state.ts";

const kb_main = {
  keyboard: [[{ text: "New report" }]],
  resize_keyboard: true,
  one_time_keyboard: false,
};
const kb_unit = {
  keyboard: [[{ text: "Truck" }, { text: "Trailer" }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};
const kb_paid = {
  keyboard: [[{ text: "company" }, { text: "driver" }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};

function allowed(chatId: number) {
  return ALLOWED_CHAT_IDS.length === 0 || ALLOWED_CHAT_IDS.includes(String(chatId));
}

export async function onUpdate(update: Update) {
  const msg = update.message ?? update.edited_message;
  if (!msg) return;

  const chatId = msg.chat.id;
  if (!allowed(chatId)) return;

  const text = getText(msg);

  if (text === "/start") {
    await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Ready.", reply_markup: kb_main });
    reset(chatId);
    return;
  }

  // FSM
  let state = getState(chatId);

  // Entry
  if (text === "New report") {
    setState(chatId, { step: "await_unit_type" });
    await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Unit:", reply_markup: kb_unit });
    return;
  }

  switch (state.step) {
    case "await_unit_type": {
      if (text === "Truck") {
        setState(chatId, { step: "await_truck_number", data: { unitType: "Truck" } });
        await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Truck #:" });
        return;
      }
      if (text === "Trailer") {
        setState(chatId, { step: "await_trailer_number", data: { unitType: "Trailer" } });
        await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Trailer #:" });
        return;
      }
      await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Choose Truck or Trailer", reply_markup: kb_unit });
      return;
    }
    case "await_truck_number": {
      if (!text) break;
      const data = { ...(state.data ?? {}), truck: text };
      setState(chatId, { step: "await_description", data });
      await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Describe the issue:" });
      return;
    }
    case "await_trailer_number": {
      if (!text) break;
      const data = { ...(state.data ?? {}), trailer: text };
      setState(chatId, { step: "await_trailer_truck_number", data });
      await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Truck # with this trailer:" });
      return;
    }
    case "await_trailer_truck_number": {
      if (!text) break;
      const data = { ...(state.data ?? {}), truck: text };
      setState(chatId, { step: "await_description", data });
      await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Describe the issue:" });
      return;
    }
    case "await_description": {
      if (!text) break;
      const data = { ...(state.data ?? {}), description: text };
      setState(chatId, { step: "await_paidby", data });
      await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Paid By:", reply_markup: kb_paid });
      return;
    }
    case "await_paidby": {
      if (text !== "company" && text !== "driver") {
        await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Choose: company or driver", reply_markup: kb_paid });
        return;
      }
      const data = { ...(state.data ?? {}), paidBy: text as "company" | "driver" };
      setState(chatId, { step: "await_notes", data });
      await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Notes (optional). Send text or '-' to skip:" });
      return;
    }
    case "await_notes": {
      const notes = text && text !== "-" ? text : undefined;
      const data = { ...(state.data ?? {}), notes };
      setState(chatId, { step: "await_invoice", data });
      await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Send invoice (photo or PDF):" });
      return;
    }
    case "await_invoice": {
      const file = extractFileId(msg);
      if (!file) {
        await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Need a photo or a document (PDF/JPG). Try again:" });
        return;
      }
      const data = { ...(state.data ?? {}), file_id: file.file_id, file_kind: file.kind };
      // Summary only in step 1
      const summary = buildSummary(msg, data as ReportData);
      await sendMessage(TELEGRAM_TOKEN, {
        chat_id: chatId,
        text: summary,
        reply_markup: { remove_keyboard: true },
      });
      reset(chatId);
      return;
    }
  }

  // Fallback
  await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Press New report to start.", reply_markup: kb_main });
}

function extractFileId(m: Message): { file_id: string; kind: "photo" | "document" } | null {
  if (m.photo && m.photo.length > 0) {
    const largest = m.photo[m.photo.length - 1];
    return { file_id: largest.file_id, kind: "photo" };
  }
  if (m.document) {
    return { file_id: m.document.file_id, kind: "document" };
  }
  return null;
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildSummary(m: Message, data: ReportData) {
  const who = m.from?.username ? "@" + m.from.username : [m.from?.first_name, m.from?.last_name].filter(Boolean).join(" ");
  const lines = [
    `<b>Saved</b>`,
    `Unit: <b>${data.unitType}</b>`,
    data.truck ? `Truck #: <b>${esc(data.truck)}</b>` : "",
    data.trailer ? `Trailer #: <b>${esc(data.trailer)}</b>` : "",
    `Issue: ${esc(data.description)}`,
    `Paid By: <b>${data.paidBy}</b>`,
    data.notes ? `Notes: ${esc(data.notes)}` : "Notes: —",
    `Invoice: <i>${data.file_kind}</i>`,
    `ReportedBy: ${esc(who || "unknown")}`,
  ].filter(Boolean);
  return lines.join("\n");
}
