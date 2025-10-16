// Deno KV lock with TTL
const kv = await Deno.openKv();
const KEY = (chatId: number) => ["lock", chatId];

export async function withLock<T>(chatId: number, fn: () => Promise<T>): Promise<T | undefined> {
  const key = KEY(chatId);
  const ttlMs = 1500; // быстрее, чем раньше
  while (true) {
    const cur = await kv.get<number>(key);
    const now = Date.now();
    if (!cur.value || now - cur.value > ttlMs) {
      const res = await kv.atomic().check({ key, versionstamp: cur.versionstamp }).set(key, now).commit();
      if (res.ok) {
        try { return await fn(); } finally { await kv.delete(key); }
      }
    }
    await new Promise(r => setTimeout(r, 10));
  }
}
