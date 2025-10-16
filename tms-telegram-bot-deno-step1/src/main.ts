import { TELEGRAM_TOKEN } from "./env.ts";
import { onUpdate } from "./handlers.ts";

const port = Number(Deno.env.get("PORT") ?? 8000);

if (!TELEGRAM_TOKEN) {
  console.error("TELEGRAM_TOKEN is required");
}

Deno.serve({ port }, async (req) => {
  const url = new URL(req.url);

  if (req.method === "GET" && url.pathname === "/health") {
    return new Response("ok", { status: 200 });
  }

  if (req.method === "POST" && url.pathname === "/telegram") {
    const update = await req.json().catch(() => ({}));
    try {
      await onUpdate(update);
    } catch (e) {
      console.error("handler error", e);
    }
    return new Response("ok", { status: 200 });
  }

  return new Response("not found", { status: 404 });
});
