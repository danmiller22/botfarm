import { sendMessage, getText, getFileURL, type Update, type Message } from "./telegram.ts";
import { TELEGRAM_TOKEN } from "./env.ts";
import { getState, setState, reset, type ReportData } from "./state.ts";
import { driveUpload, sheetsAppend } from "./google.ts";

const DASHBOARD_URL = "https://danmiller22.github.io/us-team-fleet-dashboard/";

// reply-keyboard: New report + Dashboard
const kb_main = {
  keyboard: [[{ text: "New report" }, { text: "Dashboard" }]],
  resize_keyboard: true,
  one_time_keyboard: false,
};
const kb_unit = { keyboard: [[{ text: "Truck" }, { text: "Trailer" }]], resize_keyboard: true, one_time_keyboard: true };
const kb_paid = { keyboard: [[{ text: "company" }, { text: "driver" }]], resize_keyboard: true, one_time_keyboard: true };

// анти-спам
const promptedPaid = new Set<number>();
const promptedTotal = new Set<number>();
const promptedInvoice = new Set<number>();

type Step =
  | "idle" | "await_unit_type" | "await_truck_number" | "await_trailer_number"
  | "await_trailer_truck_number" | "await_description" | "await_paidby"
  | "await_total" | "await_notes" | "await_invoice";

export async function onUpdate(update: Update) {
  const msg = update.message;
  if (!msg) return;

  const chatId = msg.chat.id;
  const textRaw = getText(msg) ?? "";
  const t = textRaw.trim().toLowerCase();

  // меню
  if (t === "/start") {
    await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Ready.", reply_markup: kb_main });
    resetAll(chatId);
    return;
  }
  if (t === "dashboard") {
    await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: `Dashboard: ${DASHBOARD_URL}`, reply_markup: kb_main });
    return;
  }
  if (t === "new report") {
    setState(chatId, { step: "await_unit_type" } as any);
    resetAll(chatId);
    await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Unit:", reply_markup: kb_unit });
    return;
  }

  const state = getState(chatId) as any as { step: Step; data?: Partial<ReportData & { total?: string }> };

  switch (state.step) {
    case "await_unit_type": {
      if (t === "truck") {
        setState(chatId, { step: "await_truck_number", data: { unitType: "Truck" } });
        await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Truck #:" });
        return;
      }
      if (t === "trailer") {
        setState(chatId, { step: "await_trailer_number", data: { unitType: "Trailer" } });
        await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Trailer #:" });
        return;
      }
      await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Choose Truck or Trailer", reply_markup: kb_unit });
      return;
    }

    case "await_truck_number": {
      if (t && t !== "truck" && t !== "trailer") {
        setState(chatId, { step: "await_description", data: { ...(state.data ?? {}), truck: textRaw, unitType: "Truck" } });
        await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Describe the issue:" });
        return;
      }
      await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Truck #: enter a number" });
      return;
    }

    case "await_trailer_number": {
      if (t && t !== "truck" && t !== "trailer") {
        setState(chatId, { step: "await_trailer_truck_number", data: { ...(state.data ?? {}), trailer: textRaw, unitType: "Trailer" } });
        await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Truck # with this trailer:" });
        return;
      }
      await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Trailer #: enter a number" });
      return;
    }

    case "await_trailer_truck_number": {
      if (t && t !== "truck" && t !== "trailer") {
        setState(chatId, { step: "await_description", data: { ...(state.data ?? {}), truck: textRaw } });
        await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Describe the issue:" });
        return;
      }
      await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Truck # with this trailer: enter a number" });
      return;
    }

    case "await_description": {
      if (textRaw) {
        setState(chatId, { step: "await_paidby", data: { ...(state.data ?? {}), description: textRaw } });
        promptedPaid.delete(chatId);
        await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Paid By:", reply_markup: kb_paid });
        return;
      }
      await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Describe the issue:" });
      return;
    }

    case "await_paidby": {
      const isCompany = ["company", "c", "comp"].includes(t);
      const isDriver = ["driver", "d"].includes(t);
      if (isCompany || isDriver) {
        setState(chatId, { step: "await_total", data: { ...(state.data ?? {}), paidBy: (isCompany ? "company" : "driver") as "company" | "driver" } });
        promptedPaid.delete(chatId);
        promptedTotal.delete(chatId);
        await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Total amount (e.g. 525.94):" });
        return;
      }
      if (!promptedPaid.has(chatId)) {
        promptedPaid.add(chatId);
        await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Choose: company or driver", reply_markup: kb_paid });
      }
      return;
    }

    case "await_total": {
      const amount = parseAmount(textRaw);
      if (amount !== null) {
        setState(chatId, { step: "await_notes", data: { ...(state.data ?? {}), total: amount } });
        await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Notes (optional). Send text or '-' to skip:" });
        return;
      }
      if (!promptedTotal.has(chatId)) {
        promptedTotal.add(chatId);
        await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Enter a number like 120, 120.50 or $120.50" });
      }
      return;
    }

    case "await_notes": {
      setState(chatId, { step: "await_invoice", data: { ...(state.data ?? {}), notes: (textRaw && textRaw !== "-") ? textRaw : undefined } });
      promptedInvoice.delete(chatId);
      await sendMessage(TELEGRAM_TOKEN, {
        chat_id: chatId,
        text: "Send invoice (photo or PDF):",
        reply_markup: { remove_keyboard: true }
      });
      return;
    }

    case "await_invoice": {
      const file = extractFileId(msg);
      if (!file) {
        if (!promptedInvoice.has(chatId)) {
          promptedInvoice.add(chatId);
          await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Need a photo or a document (PDF/JPG)." });
        }
        return;
      }

      const fUrl = await getFileURL(TELEGRAM_TOKEN, file.file_id);
      if (!fUrl) { await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Cannot fetch file." }); return; }

      const fr = await fetch(fUrl.url);
      const buf = new Uint8Array(await fr.arrayBuffer());
      const filename = suggestName(msg, file.kind);
      const up = await driveUpload(filename, fr.headers.get("content-type") ?? undefined, buf);
      const link = `https://drive.google.com/uc?id=${up.id}`;

      const data = { ...(state.data ?? {}) } as ReportData & { total?: string };
      const dateStr = new Date().toLocaleDateString("en-US");
      const asset = data.unitType === "Truck"
        ? `truck ${data.truck ?? ""}`.trim()
        : `TRL ${data.trailer ?? ""} ( unit ${data.truck ?? ""} )`.replace("  ", " ");
      const repair = data.description ?? "";
      const total = data.total ?? "";
      const paidBy = data.paidBy ?? "";
      const comments = data.notes ?? "";
      const reportedBy = who(msg);

      // A..H: Date | Asset | Repair | Total | PaidBy | ReportedBy | InvoiceLink | Comments
      const row = [dateStr, asset, repair, total, paidBy, reportedBy, link, comments];
      await sheetsAppend(row);

      await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Saved. " + link });
      await sendMessage(TELEGRAM_TOKEN, { chat_id: chatId, text: "Ready.", reply_markup: kb_main });

      resetAll(chatId);
      return;
    }
  }
  // idle — молчим
}

/* helpers */

function resetAll(chatId: number) {
  reset(chatId);
  promptedPaid.delete(chatId);
  promptedTotal.delete(chatId);
  promptedInvoice.delete(chatId);
}

function who(m: Message) {
  return m.from?.username ? "@"+m.from.username : [m.from?.first_name, m.from?.last_name].filter(Boolean).join(" ");
}

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

//  " $1,234.50 " -> "1234.50"; "120" -> "120"; "120,50" -> "120.50"
function parseAmount(s: string): string | null {
  if (!s) return null;
  let x = s.trim()
    .replace(/[^\d,.\-]/g, "")        // убираем всё кроме цифр и разделителей
    .replace(/,/g, ".");              // запятые как точки
  if (!x || !/^[-]?\d*\.?\d*$/.test(x)) return null;
  const n = Number(x);
  if (!isFinite(n)) return null;
  return n.toFixed(2).replace(/\.00$/, (/\./.test(x) ? ".00" : "")); // если ввели целое без точки — оставим без .00
}
