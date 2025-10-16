// Быстрый ACK вебхука + обработка в фоне через Deno KV queue
import { onUpdate } from "./handlers.ts";

const kv = await Deno.openKv();

// фоновой воркер очереди
kv.listenQueue(async (job: unknown) => {
  try { await onUpdate(job as any); } catch (_) {}
});

Deno.serve(async (req) => {
  const { pathname } = new URL(req.url);

  if (req.method === "POST" && pathname === "/telegram") {
    const update = await req.json();
    await kv.enqueue(update);        // кладём задачу и сразу отвечаем
    return new Response("ok");
  }

  if (pathname === "/health") return new Response("ok");
  return new Response("not found", { status: 404 });
});
