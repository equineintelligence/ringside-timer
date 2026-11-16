// Ringside Timer — Supabase Edge Function "parse-schedule"
// ---------------------------------------------------------------------------
// Receives a show schedule (PDF as base64, or Excel text) from the website,
// asks Claude to turn it into structured JSON, checks the JSON, and returns it.
//
// Only signed-in users of the website can use it (their login token is checked).
//
// PRIVACY (POPIA): schedule contents are NEVER stored. The only thing saved is
// one row in "parse_requests": a hashed (scrambled) account ID that changes
// every day, a timestamp and a success flag.
//
// Secrets this function uses (set in Supabase → Edge Functions → Secrets):
//   ANTHROPIC_API_KEY  (required)  your Claude API key — never put it anywhere else
//   IP_HASH_SALT       (optional)  any long random text; makes the hashed IDs impossible to reverse
//   USER_DAILY_LIMIT   (optional)  AI reads per account per day  (default 10)
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

const SYSTEM_PROMPT = `You read South African horse show schedules, programmes and running orders (mostly showjumping, sometimes with
dressage, equitation and showing classes too) and convert them to JSON.
Return ONLY minified JSON on one line (no spaces or line breaks between items), no other text, no markdown fences.
Shape (shown spaced out here only for readability):
{
  "show_name": string,
  "show_date": "YYYY-MM-DD" or "",  // the FIRST day of the show
  "classes": [
    {
      "arena": string,              // e.g. "Main Arena", "Arena 2". Use "Arena 1" if there is only one and it has no name.
      "day": "YYYY-MM-DD",          // include ONLY when the show runs over more than one day: the day this class runs
      "class_no": string,           // e.g. "7" or "12a"
      "class_name": string,
      "height": string,             // e.g. "1.10m" ("" if not given)
      "format": one of ${JSON.stringify(FORMATS)},
      "start_time": "HH:MM" (24-hour) or "follow" or "",
      "end_time": "HH:MM",          // include ONLY if the timetable gives a time window (e.g. "8h00 - 8h10" -> end "08:10")
      "expected_entries": number,   // include ONLY when the timetable gives the number of entries but there is no running order
      "runs_with_previous": true,   // include ONLY if this class shares one time slot with the class before it (see rules)
      "same_course": true,          // include ONLY if the schedule says the same course is used with the height raised
      "entries": [ [draw, rider, horse] ],   // one compact array per entry, all strings, e.g. ["4","Anna Botha","Silver Moon"]
                                             // add a 4th item "S" if scratched/withdrawn, "D" if already jumped, else ""
                                             // add a 5th item "HH:MM" ONLY if the running order prints a time for that rider,
                                             // e.g. ["2","Paula Haltmann","Western Wonder","","08:22"]
      "uncertain": [string]         // include ONLY if you had to guess something: short notes for this class
    }
  ]
}
Rules:
- The input may be several documents (or one merged PDF): a timetable, show information pages, and starting lists /
  running orders for individual classes. Build ONE schedule: take class order, arena and times from the timetable,
  and put each starting list's riders into the matching timetable class (match by class number, else height + type).
  A starting list for a class that is not in the timetable becomes its own class, with a note in "uncertain".
- Ignore show information that isn't the schedule: banking details, terms, prizes, catering, weather, contacts, legends.
- Timetables often list the NUMBER of entries per class instead of names: put it in "expected_entries" and leave entries empty.
- Merged timetable cells: when one time window covers several class rows, give the time to the FIRST class of the group
  and set "runs_with_previous": true on the others in that group.
- Class numbers can be decimals or have letters (e.g. "1.2", "10.2", "12a"): copy them exactly.
- Heights can be combined, e.g. "1.25m/1.20m" or "60cm/50cm": copy as written (without grade letters like J/AD).
- A starting list may split one class into height sections (e.g. "1.10M J/AD" then "1.00M J/AD"): keep all riders in that
  one class, in draw order.
- Ignore breeding/owner lines under horse names (e.g. "gelding / 7Yr / Sire x Dam / Owner") and badges like "Stallion".
- "A2", "Table A2", "238.2.1" = "Speed / Table A against the clock"; "A1" / not against the clock / "Clear Round" = "Other".
- If a starting list names a different show or venue than the timetable, add a note in "uncertain".
- If the same class number appears twice in an arena, keep both and add a note in "uncertain".
- Keep classes in the order they run within each arena.
- start_time: "follow" when the schedule says "to follow", "thereafter", "after class X" etc.
- Format mapping: Table A against the clock / Art 238.2.1 / Table C / speed -> "Speed / Table A against the clock";
  two-phase / Art 274.5 -> "Two-phase"; jump-off / Art 238.2.2 / immediate jump-off -> "Jump-off (Table A with jump-off)";
  two rounds / Art 273 -> "Two rounds"; accumulator / Art 269 -> "Accumulator"; anything else -> "Other".
- Entries: keep the running order (draw) order. Rider is the person, horse is the animal. If a running order is not given for a class, use an empty list.
- Mark entries shown as withdrawn/scratched/SCR/W/D/VET (vet failed) with "S" as the 4th item.
- Multi-day shows: put every class on its own day ("day"), taken from the nearest day heading above it
  (e.g. "SUNDAY 16 AUGUST 2026"). The same arena name may be used on both days: keep the arena name as printed.
- Include every competitive class in the programme (showjumping, equitation, dressage, working hunter/riding, showing):
  they all use arena time. For dressage/equitation use height "" if none is given, and format "Other".
- Arena start lines like "START 8:00AM", "08:00AM START", "Start APP. 11:30AM" give the start_time of the FIRST class
  in that arena on that day; the classes after it are "follow" unless they have their own time.
  "APP." means approximate (still use the time). "12:00 AM" on a show day means 12:00 (midday).
- Times may be written "8:00", "8h00", "08:00am", "1:30 PM": always output 24-hour "HH:MM" with two digits ("08:00", "13:30").
- Running order tables can have the columns in any order (often HORSE before RIDER) and the first column may be labelled
  "RIDER", "NR" or "No" when it is really the draw number. Read the column headings and put each value in the right place.
- A rider's or horse's name can wrap onto the next line of the table (e.g. "JANIKE VAN" / "HOUWELINGEN"): join the parts.
- Ignore empty numbered rows in a running order (a draw number, level and height but no rider or horse): they are
  blank lines for late entries, not entries.
- Ignore columns for level, score, place, time & score, test name; and judges, scribes, secretaries and announcers.
- If the starting list's class name or format for a class number differs from the timetable, keep the timetable's,
  and add a note to "uncertain".
- Never invent riders, horses or times. If something is unclear, make your best reading and add a note to "uncertain".`;

type AnyObj = Record<string, unknown>;

// "8:00", "8h00", "08:00am", "1:30 PM", "12:00 AM" (a show day, so midday) -> "HH:MM"; "follow" kept; null if not a time.
function toHHMM(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (/follow|thereafter|after/i.test(s)) return "follow";
  const m = s.match(/^(?:app(?:rox)?\.?\s*)?(\d{1,2})\s*[:hH.]\s*(\d{2})(?::\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?$/i);
  if (!m) return null;
  let h = +m[1]; const mi = +m[2];
  if (m[3] && /p/i.test(m[3]) && h < 12) h += 12;
  if (h > 23 || mi > 59) return null;
  return String(h).padStart(2, "0") + ":" + String(mi).padStart(2, "0");
}

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
    // Be forgiving: fix what can be fixed and leave a note, rather than failing the whole read.
    let start = toHHMM(c.start_time);
    if (start === null) { uncertain.push(`Start time "${String(c.start_time)}" not understood`); start = ""; }
    const end = toHHMM(c.end_time);
    if (c.entries != null && !Array.isArray(c.entries)) { uncertain.push("Running order could not be read"); c.entries = []; }
    const entries = [];
    for (const [j, er] of ((c.entries as unknown[]) ?? []).entries()) {
      // Compact form: ["4","Anna Botha","Silver Moon"] (+ "S" scratched / "D" done). Full objects are accepted too.
      let e: AnyObj;
      if (Array.isArray(er)) {
        const flag = String(er[3] ?? "").toUpperCase();
        e = { draw: er[0], rider: er[1], horse: er[2], time: er[4], status: flag.startsWith("S") ? "scratched" : flag.startsWith("D") ? "done" : "starting" };
      } else if (er && typeof er === "object") e = er as AnyObj;
      else continue;
      if (!String(e.rider ?? "").trim() && !String(e.horse ?? "").trim()) continue; // empty numbered row
      const status = ["starting", "scratched", "done"].includes(String(e.status)) ? String(e.status) : "starting";
      entries.push({
        draw: String(e.draw ?? "").slice(0, 10),
        rider: String(e.rider ?? "").slice(0, 120),
        horse: String(e.horse ?? "").slice(0, 120),
        time: (() => { const t = toHHMM(e.time); return t && t !== "follow" ? t : ""; })(),
        status,
      });
      void j;
    }
    classes.push({
      arena: String(c.arena ?? "Arena 1").slice(0, 60) || "Arena 1",
      class_no: String(c.class_no ?? "").slice(0, 20),
      class_name: String(c.class_name ?? "").slice(0, 160),
      height: String(c.height ?? "").slice(0, 20),
      format,
      start_time: start,
      end_time: end && end !== "follow" ? end : "",
      day: /^\d{4}-\d{2}-\d{2}$/.test(String(c.day ?? "")) ? String(c.day) : "",
      expected_entries: Math.max(0, Math.min(500, Math.round(Number(c.expected_entries) || 0))),
      runs_with_previous: c.runs_with_previous === true,
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

type ClaudeResult = { text: string; stop: string; inTok: number; outTok: number };

async function callClaude(apiKey: string, messages: unknown[]): Promise<ClaudeResult> {
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
      messages,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("Anthropic API error", res.status, detail.slice(0, 500));
    throw new Error(`AI service error (${res.status})`);
  }
  const data = await res.json();
  const text = (data.content ?? []).filter((b: AnyObj) => b.type === "text").map((b: AnyObj) => b.text).join("");
  const u = data.usage ?? {};
  const inTok = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  return { text, stop: String(data.stop_reason ?? ""), inTok, outTok: u.output_tokens ?? 0 };
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
  } else if (kind === "multi" && Array.isArray(body.files) && body.files.length >= 1 && body.files.length <= 10) {
    // Several documents at once (e.g. timetable + starting lists): one content block each, then the instruction.
    content = [];
    let bytes = 0, chars = 0;
    for (const f of body.files as AnyObj[]) {
      if (f.kind === "pdf") {
        const data = String(f.data ?? "");
        if (!data || !/^[A-Za-z0-9+/=\s]+$/.test(data)) return reply(origin, 400, { ok: false, code: "bad_request", error: "One of the PDFs could not be read." });
        bytes += Math.floor(data.length * 3 / 4);
        content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data } });
      } else if (f.kind === "text") {
        const text = String(f.text ?? ""); chars += text.length;
        content.push({ type: "text", text: "<spreadsheet name=\"" + String(f.filename ?? "").slice(0, 80).replace(/[<>"]/g, "") + "\">\n" + text + "\n</spreadsheet>" });
      } else return reply(origin, 400, { ok: false, code: "bad_request", error: "Unknown file type." });
    }
    if (bytes > MAX_FILE_BYTES) return reply(origin, 413, { ok: false, code: "too_large", error: "Those files add up to more than 5 MB, which is too big for AI reading." });
    if (chars > MAX_TEXT_CHARS) return reply(origin, 413, { ok: false, code: "too_large", error: "Those spreadsheets have too much text for AI reading (over 100,000 characters)." });
    content.push({ type: "text", text: "These documents belong to one show. Combine them into the JSON format described. Return only JSON." });
  } else {
    return reply(origin, 400, { ok: false, code: "bad_request", error: 'Unknown request type (expected "pdf", "text" or "multi").' });
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, serverKey(), { auth: { persistSession: false } });

  // ---- Must be signed in: check the user's login token with Supabase Auth ----
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token || token.startsWith("sb_")) {
    return reply(origin, 401, { ok: false, code: "login_required", error: "Please sign in to use AI reading." });
  }
  const { data: userData, error: userError } = await db.auth.getUser(token);
  if (userError || !userData?.user) {
    return reply(origin, 401, { ok: false, code: "login_required", error: "Your sign-in has expired. Please sign in again." });
  }

  // ---- Rate limits (per account; only a hashed, daily-changing ID is stored) ----
  const dayStart = startOfSaDayIso();
  const requesterHash = await sha256Hex(`${Deno.env.get("IP_HASH_SALT") ?? "ringside-timer"}|${dayStart.slice(0, 10)}|${userData.user.id}`);

  const [userCount, globalCount] = await Promise.all([
    db.from("parse_requests").select("id", { count: "exact", head: true }).eq("requester_hash", requesterHash).gte("created_at", dayStart),
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
  const ins = await db.from("parse_requests").insert({ requester_hash: requesterHash, success: false }).select("id").single();
  const rowId = ins.data?.id;

  // ---- Ask Claude, check the answer, retry once ----
  // Token counts (numbers only, never content) are saved so you can see real costs per read.
  let lastError = "";
  let inTok = 0, outTok = 0, attempts = 0;
  const logUsage = async (success: boolean) => {
    if (rowId) await db.from("parse_requests").update({ success, input_tokens: inTok, output_tokens: outTok, attempts }).eq("id", rowId);
  };
  const ask = async (messages: unknown[]) => {
    const r = await callClaude(apiKey, messages);
    inTok += r.inTok; outTok += r.outTok; attempts++;
    return r;
  };
  try {
    let answer = await ask([{ role: "user", content }]);
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (answer.stop === "max_tokens") { lastError = "The schedule is too long to read in one go. Try splitting it (e.g. one arena per file)."; break; }
      let parsed: unknown = null;
      try { parsed = extractJson(answer.text); } catch { lastError = "The answer was not valid JSON."; }
      if (parsed) {
        const v = validate(parsed);
        if (v.ok) {
          await logUsage(true);
          return reply(origin, 200, { ok: true, model: MODEL, show: v.value });
        }
        lastError = v.error;
      }
      if (attempt === 2) break;
      if (answer.text.includes("{") && answer.text.length > 20) {
        // Cheap retry: Claude already read the schedule, so send back only its answer and the problem
        // (not the whole PDF again) and ask for a corrected version.
        answer = await ask([{ role: "user", content: [{ type: "text", text:
          `The JSON below was produced from a showjumping schedule but could not be used: ${lastError}.\n` +
          "Fix it and return ONLY the corrected minified JSON in exactly the same shape. Keep every class and entry; do not add or drop data.\n\n<json>\n" +
          answer.text.slice(0, 60000) + "\n</json>" }] }]);
      } else {
        // No usable answer at all: read the schedule again.
        answer = await ask([{ role: "user", content }]);
      }
    }
  } catch (e) {
    lastError = (e as Error).message;
  }
  await logUsage(false).catch(() => {});
  console.error("parse failed:", lastError.slice(0, 200));
  return reply(origin, 422, { ok: false, code: "parse_failed", error: `The AI couldn't produce a usable result (${lastError}). Please try the built-in reader or the CSV template.` });
});
