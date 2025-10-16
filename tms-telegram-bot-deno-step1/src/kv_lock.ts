const kv = await Deno.openKv();
const KEY = (chatId: number) => ["lock", chatId];

export async function withLock<T>(chatId: number, fn: () => Promise<T>): Promise<T | undefined> {
  const key = KEY(chatId);
  const ttlMs = 3000;
  while (true) {
    const cur = await kv.get<number>(key);
    const now = Date.now();
    if (!cur.value || now - cur.value > ttlMs) {
      const ok = await kv.atomic().check({ key, versionstamp: cur.versionstamp }).set(key, now).commit();
      if (ok.ok) {
        try { return await fn(); } finally { await kv.delete(key); }
      }
    }
    await new Promise(r => setTimeout(r, 40));
  }
}
