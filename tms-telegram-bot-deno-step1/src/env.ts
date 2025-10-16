export const TELEGRAM_TOKEN = Deno.env.get("TELEGRAM_TOKEN") ?? "";
export const ALLOWED_CHAT_IDS = (Deno.env.get("ALLOWED_CHAT_IDS") ?? "").split(",").map(s=>s.trim()).filter(Boolean);
if (!TELEGRAM_TOKEN) {
  console.error("Missing TELEGRAM_TOKEN env var");
}
