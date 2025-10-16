export type ReportState =
  | { step: "idle" }
  | { step: "await_unit_type" }
  | { step: "await_truck_number"; data: Partial<ReportData> }
  | { step: "await_trailer_number"; data: Partial<ReportData> }
  | { step: "await_trailer_truck_number"; data: Partial<ReportData> }
  | { step: "await_description"; data: Partial<ReportData> }
  | { step: "await_paidby"; data: Partial<ReportData> }
  | { step: "await_notes"; data: Partial<ReportData> }
  | { step: "await_invoice"; data: Partial<ReportData> };

export type ReportData = {
  unitType: "Truck" | "Trailer";
  truck?: string;
  trailer?: string;
  description: string;
  paidBy: "company" | "driver";
  notes?: string;
  file_id?: string;
  file_kind?: "photo" | "document";
  invoice_url?: string;
};

const sessions = new Map<number, ReportState>();
export function getState(chatId: number): ReportState { return sessions.get(chatId) ?? { step: "idle" }; }
export function setState(chatId: number, state: ReportState) { sessions.set(chatId, state); }
export function reset(chatId: number) { sessions.set(chatId, { step: "idle" }); }
