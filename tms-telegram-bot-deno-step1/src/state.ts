// KV-персистентное состояние
export type Step =
  | "idle" | "await_unit_type" | "await_truck_number" | "await_trailer_number"
  | "await_trailer_truck_number" | "await_description" | "await_paidby"
  | "await_total" | "await_notes" | "await_invoice";

export type ReportData = {
  unitType?: "Truck" | "Trailer";
  truck?: string;
  trailer?: string;
  description?: string;
  paidBy?: "company" | "driver";
  total?: string;
  notes?: string;
};

export type ChatState = { step: Step; data?: ReportData };

const kv = await Deno.openKv();
const KEY = (chatId: number) => ["state", chatId];

export async function getState(chatId: number): Promise<ChatState> {
  const it = await kv.get<ChatState>(KEY(chatId));
  return it.value ?? { step: "idle" };
}

export async function setState(chatId: number, state: ChatState): Promise<void> {
  const key = KEY(chatId);
  const cur = await kv.get<ChatState>(key);
  const tx = kv.atomic().check({ key, versionstamp: cur.versionstamp }).set(key, state);
  const res = await tx.commit();
  if (!res.ok) await setState(chatId, state); // редкая гонка — повтор
}

export async function reset(chatId: number): Promise<void> {
  await kv.set(KEY(chatId), { step: "idle" } as ChatState);
}
