// Deno KV lock with TTL
const kv = await Deno.openKv();

const KEY = (chatId: number) => ["lock", chatId];

export async function withLock<T>(chatId: number, fn: () => Promise<T>): Promise<T | undefined> {
  const key = KEY(chatId);
  const now = Date.now();
  const ttlMs = 3000; // 3s
  while (true) {
    const cur = await kv.get<number>(key);
    if (!cur.value || now - cur.value > ttlMs) {
      const tx = kv.atomic().check({ key, versionstamp: cur.versionstamp }).set(key, now);
      const res = await tx.commit();
      if (res.ok) {
        try {
          return await fn();
        } finally {
          // release
          await kv.delete(key);
        }
      }
    }
    // короткая задержка и повтор
    await new Promise(r => setTimeout(r, 40));
  }
}
