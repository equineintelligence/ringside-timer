// Ringside Timer — Supabase Edge Function "parse-schedule"
// ---------------------------------------------------------------------------
// Receives a show schedule (PDF as base64, or Excel text) from the website,
// asks Claude to turn it into structured JSON, checks the JSON, and returns it.
//
// PRIVACY (POPIA): schedule contents are NEVER stored. The only thing saved is
// one row in "parse_requests": a hashed IP, a timestamp and a success flag.
//
// Secrets this function uses (set in Supabase → Edge Functions → Secrets):
//   ANTHROPIC_API_KEY  (required)  your Claude API key — never put it anywhere else
//   IP_HASH_SALT       (optional)  any long random text; makes hashed IPs harder to guess
//   USER_DAILY_LIMIT   (optional)  AI reads per person per day   (default 10)
//   GLOBAL_DAILY_LIMIT (optional)  AI reads for everyone per day (default 200)
//   CLAUDE_MODEL       (optional)  overrides the model below without editing code
// SUPABASE_URL and the server key (SUPABASE_SECRET_KEYS or legacy SUPABASE_SERVICE_ROLE_KEY) are provided automatically.

import { createClient } from "npm:@supabase/supabase-js@2";

// ======================= SETTINGS YOU MAY WANT TO CHANGE =======================
// The Claude model. Haiku is fast and low-cost and reads tables well.
// Check https://docs.claude.com/en/docs/about-claude/models for current names.
const DEFAULT_MODEL = "claude-haiku-5-5";

const ALLOWED_ORIGINS = [
  "https://equineintelligence.github.io",
];
// Local testing: any http://localhost:<port> or http://127.0.0.1:<port> is also allowed.
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_TEXT_CHARS = 100_000;
const MAX_OUTPUT_TOKENS = 16000;
// ===============================================================================

const MODEL = Deno.env.get("CLAUDE_MODEL") || DEFAULT_MODEL;
const USER_DAILY_LIMIT = Number(Deno.env.get("USER_DAILY_LIMIT") ?? 10);
const GLOBAL_DAILY_LIMIT = Number(Deno.env.get("GLOBAL_DAILY_LIMIT") ?? 200);

const FORMATS = [
  "Speed / Table A against the clock",
  "Two-phase",
  "Jump-off (Table A with jump-off)",
  "Two rounds",
  "Accumulator",
  "Other",
];

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": isAllowedOrigin(origin) ? origin! : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function reply(origin: string | null, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// The private server key Supabase gives every function automatically.
// Prefers the new-style secret key (sb_secret_…); falls back to the legacy service_role key.
function serverKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}") as Record<string, string>;
    const k = keys.default ?? Object.values(keys)[0];
    if (k) return k;
  } catch { /* fall through */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

// Start of "today" in South African time (UTC+2, no daylight saving), as an ISO string.
function startOfSaDayIso(): string {
  const now = Date.now();
  const sa = new Date(now + 2 * 3600_000);
  const midnightSa = Date.UTC(sa.getUTCFullYear(), sa.getUTCMonth(), sa.getUTCDate()) - 2 * 3600_000;
  return new Date(midnightSa).toISOString();
}

const SYSTEM_PROMPT = `You read South African showjumping show schedules and running orders and convert them to JSON.
Return ONLY a JSON object, no other text, no markdown fences. Use exactly this shape:
{
  "show_name": string,
  "show_date": "YYYY-MM-DD" or "",
  "classes": [
    {
      "arena": string,              // e.g. "Main Arena", "Arena 2". Use "Arena 1" if there is only one and it has no name.
      "class_no": string,           // e.g. "7" or "12a"
      "class_name": string,
      "height": string,             // e.g. "1.10m" ("" if not given)
      "format": one of ${JSON.stringify(FORMATS)},
      "start_time": "HH:MM" (24-hour) or "follow" or "",
      "same_course": boolean,       // true only if the schedule says the same course is used with the height raised
      "entries": [ { "draw": string, "rider": string, "horse": string, "status": "starting" | "scratched" | "done" } ],
      "uncertain": [string]         // short notes about anything you had to guess for this class
    }
  ]
}
Rules:
- Keep classes in the order they run within each arena.
- start_time: "follow" when the schedule says "to follow", "thereafter", "after class X" etc.
- Format mapping: Table A against the clock / Art 238.2.1 / Table C / speed -> "Speed / Table A against the clock";
  two-phase / Art 274.5 -> "Two-phase"; jump-off / Art 238.2.2 / immediate jump-off -> "Jump-off (Table A with jump-off)";
  two rounds / Art 273 -> "Two rounds"; accumulator / Art 269 -> "Accumulator"; anything else -> "Other".
- Entries: keep the running order (draw) order. Rider is the person, horse is the animal. If a running order is not given for a class, use an empty list.
- Mark entries shown as withdrawn/scratched/W/D as "scratched".
- Never invent riders, horses or times. If something is unclear, make your best reading and add a note to "uncertain".`;

type AnyObj = Record<string, unknown>;

function validate(d: unknown): { ok: true; value: AnyObj } | { ok: false; error: string } {
  if (!d || typeof d !== "object" || Array.isArray(d)) return { ok: false, error: "Top level must be an object" };
  const o = d as AnyObj;
  if (!Array.isArray(o.classes)) return { ok: false, error: '"classes" must be an array' };
  if (o.classes.length === 0) return { ok: false, error: "No classes found" };
  const classes = [];
  for (const [i, raw] of (o.classes as unknown[]).entries()) {
    if (!raw || typeof raw !== "object") return { ok: false, error: `classes[${i}] must be an object` };
    const c = raw as AnyObj;
    let format = String(c.format ?? "Other");
    const uncertain = Array.isArray(c.uncertain) ? c.uncertain.map(String).slice(0, 20) : [];
    if (!FORMATS.includes(format)) { uncertain.push(`Format "${format}" not recognised — set to Other`); format = "Other"; }
    let start = String(c.start_time ?? "").trim();
    if (start && start !== "follow" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) {
      return { ok: false, error: `classes[${i}].start_time "${start}" must be HH:MM, "follow" or ""` };
    }
    if (c.entries != null && !Array.isArray(c.entries)) return { ok: false, error: `classes[${i}].entries must be an array` };
    const entries = [];
    for (const [j, er] of ((c.entries as unknown[]) ?? []).entries()) {
      if (!er || typeof er !== "object") return { ok: false, error: `classes[${i}].entries[${j}] must be an object` };
      const e = er as AnyObj;
      const status = ["starting", "scratched", "done"].includes(String(e.status)) ? String(e.status) : "starting";
      entries.push({
        draw: String(e.draw ?? "").slice(0, 10),
        rider: String(e.rider ?? "").slice(0, 120),
        horse: String(e.horse ?? "").slice(0, 120),
        status,
      });
    }
    classes.push({
      arena: String(c.arena ?? "Arena 1").slice(0, 60) || "Arena 1",
      class_no: String(c.class_no ?? "").slice(0, 20),
      class_name: String(c.class_name ?? "").slice(0, 160),
      height: String(c.height ?? "").slice(0, 20),
      format,
      start_time: start,
      same_course: c.same_course === true,
      entries,
      uncertain,
    });
  }
  return {
    ok: true,
    value: {
      show_name: String(o.show_name ?? "").slice(0, 160),
      show_date: /^\d{4}-\d{2}-\d{2}$/.test(String(o.show_date ?? "")) ? String(o.show_date) : "",
      classes,
    },
  };
}

function extractJson(text: string): unknown {
  let t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  return JSON.parse(t);
}

async function callClaude(apiKey: string, content: unknown[], messages: unknown[] = []): Promise<{ text: string; stop: string }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }, ...messages],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("Anthropic API error", res.status, detail.slice(0, 500));
    throw new Error(`AI service error (${res.status})`);
  }
  const data = await res.json();
  const text = (data.content ?? []).filter((b: AnyObj) => b.type === "text").map((b: AnyObj) => b.text).join("");
  return { text, stop: String(data.stop_reason ?? "") };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (!isAllowedOrigin(origin)) return reply(origin, 403, { ok: false, code: "forbidden_origin", error: "This service only accepts requests from the Ringside Timer website." });
  if (req.method !== "POST") return reply(origin, 405, { ok: false, code: "method", error: "Use POST." });

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return reply(origin, 500, { ok: false, code: "not_configured", error: "The AI reader is not set up yet (missing API key)." });

  // ---- Read and check the request ----
  let body: AnyObj;
  try { body = await req.json(); } catch { return reply(origin, 400, { ok: false, code: "bad_request", error: "Request must be JSON." }); }
  const kind = body.kind;
  let content: unknown[];
  if (kind === "pdf") {
    const data = String(body.data ?? "");
    const bytes = Math.floor(data.length * 3 / 4);
    if (!data || !/^[A-Za-z0-9+/=\s]+$/.test(data)) return reply(origin, 400, { ok: false, code: "bad_request", error: "The PDF could not be read." });
    if (bytes > MAX_FILE_BYTES) return reply(origin, 413, { ok: false, code: "too_large", error: "That file is over 5 MB, which is too big for AI reading." });
    content = [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data } },
      { type: "text", text: "Convert this show schedule / running order to the JSON format described. Return only JSON." },
    ];
  } else if (kind === "text") {
    const text = String(body.text ?? "");
    if (!text.trim()) return reply(origin, 400, { ok: false, code: "bad_request", error: "The spreadsheet looks empty." });
    if (text.length > MAX_TEXT_CHARS) return reply(origin, 413, { ok: false, code: "too_large", error: "That spreadsheet has too much text for AI reading (over 100,000 characters)." });
    content = [{ type: "text", text: "Convert this show schedule / running order (exported from a spreadsheet, cells separated by tabs) to the JSON format described. Return only JSON.\n\n<schedule>\n" + text + "\n</schedule>" }];
  } else {
    return reply(origin, 400, { ok: false, code: "bad_request", error: 'Unknown request type (expected "pdf" or "text").' });
  }

  // ---- Rate limits (hashed IP only, never the raw IP) ----
  const db = createClient(Deno.env.get("SUPABASE_URL")!, serverKey(), { auth: { persistSession: false } });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("cf-connecting-ip") || "unknown";
  const dayStart = startOfSaDayIso();
  // The day is part of the hash, so the same person gets a different hash each day.
  const ipHash = await sha256Hex(`${Deno.env.get("IP_HASH_SALT") ?? "ringside-timer"}|${dayStart.slice(0, 10)}|${ip}`);

  const [userCount, globalCount] = await Promise.all([
    db.from("parse_requests").select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("created_at", dayStart),
    db.from("parse_requests").select("id", { count: "exact", head: true }).gte("created_at", dayStart),
  ]);
  if (userCount.error || globalCount.error) {
    console.error("Rate-limit check failed", userCount.error ?? globalCount.error);
    return reply(origin, 503, { ok: false, code: "db_error", error: "The AI reader is temporarily unavailable." });
  }
  if ((globalCount.count ?? 0) >= GLOBAL_DAILY_LIMIT) {
    return reply(origin, 429, { ok: false, code: "rate_limit_global", error: "The AI reader has reached its daily limit. Please use the built-in reader or the CSV template." });
  }
  if ((userCount.count ?? 0) >= USER_DAILY_LIMIT) {
    return reply(origin, 429, { ok: false, code: "rate_limit_user", error: `You've used your ${USER_DAILY_LIMIT} AI reads for today. Please use the built-in reader or the CSV template.` });
  }

  // Record the attempt first (counts towards the limit even if it fails), then mark success.
  const ins = await db.from("parse_requests").insert({ ip_hash: ipHash, success: false }).select("id").single();
  const rowId = ins.data?.id;

  // ---- Ask Claude, check the answer, retry once ----
  let lastError = "";
  try {
    let first = await callClaude(apiKey, content);
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (first.stop === "max_tokens") { lastError = "The schedule is too long to read in one go. Try splitting it (e.g. one arena per file)."; break; }
      let parsed: unknown = null;
      try { parsed = extractJson(first.text); } catch { lastError = "The answer was not valid JSON."; }
      if (parsed) {
        const v = validate(parsed);
        if (v.ok) {
          if (rowId) await db.from("parse_requests").update({ success: true }).eq("id", rowId);
          return reply(origin, 200, { ok: true, model: MODEL, show: v.value });
        }
        lastError = v.error;
      }
      if (attempt === 2) break;
      // Retry once, telling Claude what was wrong.
      first = await callClaude(apiKey, content, [
        { role: "assistant", content: first.text.slice(0, 50000) || "{}" },
        { role: "user", content: `That response could not be used: ${lastError}. Reply again with ONLY the corrected JSON object in the required shape.` },
      ]);
    }
  } catch (e) {
    lastError = (e as Error).message;
  }
  return reply(origin, 422, { ok: false, code: "parse_failed", error: `The AI couldn't produce a usable result (${lastError}). Please try the built-in reader or the CSV template.` });
});
