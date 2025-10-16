import { GOOGLE_SA_JSON, SHEET_ID, DRIVE_FOLDER_ID } from "./env.ts";

type SA = { client_email: string; private_key: string };
const SCOPE = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/spreadsheets",
];

function b64url(a: ArrayBuffer) {
  let s = btoa(String.fromCharCode(...new Uint8Array(a)));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function b64urlstr(s: string) { return b64url(new TextEncoder().encode(s)); }

async function signJWT(sa: SA, nowSec: number) {
  const header = { alg: "RS256", typ: "JWT" };
  const claim = { iss: sa.client_email, scope: SCOPE.join(" "), aud: "https://oauth2.googleapis.com/token", iat: nowSec, exp: nowSec + 3600 };
  const encHeader = b64urlstr(JSON.stringify(header));
  const encClaim = b64urlstr(JSON.stringify(claim));
  const data = new TextEncoder().encode(encHeader + "." + encClaim);
  const keyData = sa.private_key.replace("-----BEGIN PRIVATE KEY-----","").replace("-----END PRIVATE KEY-----","").replace(/\s+/g,"");
  const raw = Uint8Array.from(atob(keyData), c=>c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", raw, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, data);
  return encHeader + "." + encClaim + "." + b64url(sig);
}

let cached: { token: string; exp: number } | null = null;
export async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now()/1000);
  if (cached && cached.exp - 60 > now) return cached.token;
  const sa = JSON.parse(GOOGLE_SA_JSON);
  const jwt = await signJWT(sa, now);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  if (!res.ok) throw new Error("token error: "+await res.text());
  const j = await res.json();
  cached = { token: j.access_token, exp: now + (j.expires_in ?? 3600) };
  return cached.token;
}

export async function driveUpload(filename: string, mime: string | undefined, bytes: Uint8Array): Promise<{id: string}> {
  const token = await getAccessToken();
  const meta = { name: filename, parents: [DRIVE_FOLDER_ID] };
  const boundary = "sep"+crypto.randomUUID();
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify(meta),
    `\r\n--${boundary}\r\nContent-Type: ${mime ?? "application/octet-stream"}\r\n\r\n`,
    new Uint8Array(bytes),
    `\r\n--${boundary}--\r\n`
  ]);
  const r = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true", {
    method: "POST",
    headers: { "Authorization": "Bearer "+token, "Content-Type": `multipart/related; boundary=${boundary}` },
    body
  });
  if (!r.ok) throw new Error("drive upload: "+await r.text());
  const j = await r.json();
  await fetch(`https://www.googleapis.com/drive/v3/files/${j.id}/permissions?supportsAllDrives=true`, {
    method: "POST",
    headers: { "Authorization": "Bearer "+token, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });
  return { id: j.id };
}

export async function sheetsAppend(row: any[]) {
  const token = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/TMS!A1:append?valueInputOption=RAW`;
  const r = await fetch(url, { method:"POST", headers:{ "Authorization": "Bearer "+token, "Content-Type":"application/json" }, body: JSON.stringify({ values:[row] })});
  if (!r.ok) throw new Error("sheets append: "+await r.text());
}
