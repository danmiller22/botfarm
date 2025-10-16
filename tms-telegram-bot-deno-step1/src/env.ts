export const TELEGRAM_TOKEN = Deno.env.get("TELEGRAM_TOKEN") ?? "";
export const GOOGLE_SA_JSON = Deno.env.get("GOOGLE_SA_JSON") ?? "";
export const SHEET_ID = Deno.env.get("SHEET_ID") ?? "";
export const DRIVE_FOLDER_ID = Deno.env.get("DRIVE_FOLDER_ID") ?? "";
export const ALLOWED_CHAT_IDS = (Deno.env.get("ALLOWED_CHAT_IDS") ?? "").split(",").map(s=>s.trim()).filter(Boolean);
if (!TELEGRAM_TOKEN) console.error("Missing TELEGRAM_TOKEN env var");
