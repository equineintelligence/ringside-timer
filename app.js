/* Ringside Timer — app.js
   Plain JavaScript, no build step. Everything is saved in this browser (localStorage).
   Sections: utilities · settings & state · CSV · document reading · AI reading ·
             timing engine · live mode · views · dialogs · start-up               */
(function () {
  "use strict";

  // ===================================================================
  // Utilities
  // ===================================================================
  const LIBS = {
    pdf: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
    pdfWorker: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
    xlsx: "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"
  };
  const FORMATS = [
    "Speed / Table A against the clock",
    "Two-phase",
    "Jump-off (Table A with jump-off)",
    "Two rounds",
    "Accumulator",
    "Other"
  ];
  const SHORT = { [FORMATS[0]]: "Speed", [FORMATS[1]]: "Two-phase", [FORMATS[2]]: "Jump-off", [FORMATS[3]]: "Two rounds", [FORMATS[4]]: "Accumulator", [FORMATS[5]]: "Other" };
  const CSV_COLS = ["arena", "class_no", "class_name", "height", "format", "start_time", "draw", "rider", "horse"];

  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const pad = (n) => String(n).padStart(2, "0");
  const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function fmt(sec) {
    if (sec == null || !isFinite(sec)) return "--:--";
    let m = Math.round(sec / 60);
    m = ((m % 1440) + 1440) % 1440;
    return pad(Math.floor(m / 60)) + ":" + pad(m % 60);
  }
  function fmtDur(sec) {
    const s = Math.round(sec);
    return Math.floor(s / 60) + ":" + pad(s % 60);
  }
  function fmtMins(sec) {
    const m = Math.round(Math.abs(sec) / 60);
    if (m < 60) return m + " min";
    return Math.floor(m / 60) + " h " + pad(m % 60);
  }
  // Accepts "8:00", "08h00", "0800", "8.30", Excel fractions (0.3333) → "HH:MM". "follow" stays. "" → "". Invalid → null
  function normTime(v) {
    const s = String(v == null ? "" : v).trim();
    if (!s) return "";
    if (/follow|thereafter|after/i.test(s)) return "follow";
    let m = s.match(/^(\d{1,2})\s*[:hH.]\s*(\d{2})(?::\d{2})?\s*(am|pm)?$/i) || s.match(/^(\d{2})(\d{2})$/);
    if (m) {
      let h = +m[1]; const mi = +m[2];
      if (m[3] && /pm/i.test(m[3]) && h < 12) h += 12;
      if (m[3] && /am/i.test(m[3]) && h === 12) h = 0;
      if (h < 24 && mi < 60) return pad(h) + ":" + pad(mi);
      return null;
    }
    if (/^0?\.\d+$/.test(s)) { const t = Math.round(parseFloat(s) * 1440); return pad(Math.floor(t / 60) % 24) + ":" + pad(t % 60); }
    return null;
  }
  function parseTime(v) {
    const t = normTime(v);
    if (!t || t === "follow") return null;
    const [h, m] = t.split(":").map(Number);
    return h * 3600 + m * 60;
  }
  function saNow() {
    if (window.RT_TEST_NOW) return window.RT_TEST_NOW; // used by automated tests only
    const d = new Date();
    try {
      const p = {};
      new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
        .formatToParts(d).forEach((x) => (p[x.type] = x.value));
      return { date: p.year + "-" + p.month + "-" + p.day, sec: (+p.hour % 24) * 3600 + +p.minute * 60 + +p.second };
    } catch (e) {
      return { date: d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()), sec: d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() };
    }
  }
  function store(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* storage full or blocked */ } }
  function load(key) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function download(name, text, type) {
    const blob = new Blob([text], { type: type || "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector('script[src="' + src + '"]')) return resolve();
      const s = document.createElement("script");
      s.src = src; s.crossOrigin = "anonymous";
      s.onload = () => resolve(); s.onerror = () => { s.remove(); reject(new Error("Could not load " + src)); };
      document.head.appendChild(s);
    });
  }
  function normalizeFormat(v) {
    const s = norm(v);
    if (!s) return null;
    for (const f of FORMATS) if (norm(f) === s) return f;
    if (/two[\s-]?phase|274\.?5|2[\s-]phase/.test(s)) return FORMATS[1];
    if (/accumulator|\b269\b/.test(s)) return FORMATS[4];
    if (/two rounds|2 rounds|\b273\b|second round/.test(s)) return FORMATS[3];
    if (/jump[\s-]?off|238\.2\.2|a2\.2|238\.1\.2/.test(s)) return FORMATS[2];
    if (/speed|against the clock|238\.2\.1|table c|\b263\b|a2\.1/.test(s)) return FORMATS[0];
    if (/^other$|optimum|not against the clock|238\.1\.1|power|puissance|six bar|derby|equitation|style/.test(s)) return FORMATS[5];
    return null;
  }

  // ===================================================================
  // Settings & state
  // ===================================================================
  const DEFAULTS = {
    sprNormal: 120, sprSpeed: 100, sprTwoPhase: 150,
    walkMin: 10, changeRebuiltMin: 15, changeSameMin: 5, prizeMin: 5,
    joPct: 25, joSec: 75, r2Pct: 50,
    dayStart: "08:00", clashMin: 10, avgAfter: 3, theme: "auto"
  };
  let S = Object.assign({}, DEFAULTS, load("rt.settings") || {});
  let show = null;  // loaded per account after sign-in
  let stars = { riders: [], horses: [] };
  const ui = { view: null, arena: null, open: {}, undo: null, docFile: null, search: "" };
  const CFG = window.RINGSIDE_CONFIG || {};
  const aiConfigured = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && !/YOUR-/.test(CFG.SUPABASE_URL + CFG.SUPABASE_ANON_KEY));

  function saveShow() { if (show) store(ukey("show"), show); }
  function saveSettings() { store("rt.settings", S); }
  function saveStars() { store(ukey("stars"), stars); }

  function blankLive() { return { startedAt: null, finishedAt: null, nowId: null, nowAt: null, marks: [] }; }
  function makeClass(o) {
    return Object.assign({ id: uid(), arena: "Arena 1", no: "", name: "", height: "", format: FORMATS[5], start: "", sameCourse: false, entries: [], flags: [], live: blankLive() }, o || {});
  }
  function makeEntry(o) { return Object.assign({ id: uid(), draw: "", rider: "", horse: "", status: "starting", flags: [] }, o || {}); }

  function normalizeShow(sh) {
    sh = sh || {};
    sh.name = sh.name || "My show";
    sh.date = sh.date || saNow().date;
    sh.classes = (sh.classes || []).map((c) => {
      c = makeClass(c);
      c.live = Object.assign(blankLive(), c.live || {});
      c.flags = c.flags || [];
      c.entries = (c.entries || []).map((e) => makeEntry(e));
      if (!FORMATS.includes(c.format)) c.format = normalizeFormat(c.format) || FORMATS[5];
      return c;
    });
    syncArenas(sh);
    return sh;
  }
  function syncArenas(sh) {
    const old = {};
    (sh.arenas || []).forEach((a) => (old[a.name] = a));
    const names = [];
    sh.classes.forEach((c) => { if (!names.includes(c.arena)) names.push(c.arena); });
    sh.arenas = names.map((n) => old[n] || { name: n, lunchStart: "", lunchMin: 0 });
  }

  // ===================================================================
  // CSV
  // ===================================================================
  function parseCSV(text) {
    const rows = []; let row = []; let cell = ""; let q = false;
    text = text.replace(/^\uFEFF/, "");
    const sep = (text.split("\n")[0].match(/;/g) || []).length > (text.split("\n")[0].match(/,/g) || []).length ? ";" : ",";
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === sep) { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += ch;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
  }
  function csvCell(v) { v = String(v == null ? "" : v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }

  function csvToShow(text, filename) {
    const rows = parseCSV(text);
    if (!rows.length) throw new Error("The CSV file is empty.");
    let idx = {}; let start = 0;
    const head = rows[0].map(norm);
    if (head.includes("rider") || head.includes("arena") || head.includes("class_no")) {
      head.forEach((h, i) => (idx[h.replace(/\s+/g, "_")] = i));
      start = 1;
    } else CSV_COLS.forEach((c, i) => (idx[c] = i));
    const get = (r, k) => (idx[k] != null && r[idx[k]] != null ? String(r[idx[k]]).trim() : "");
    const classes = []; let cur = null; let key = null;
    for (let i = start; i < rows.length; i++) {
      const r = rows[i];
      const arena = get(r, "arena") || "Arena 1";
      const no = get(r, "class_no"); const name = get(r, "class_name");
      const k = arena + "|" + no + "|" + (no ? "" : name);
      if (!cur || k !== key) {
        // re-use an earlier block of the same class if rows were not contiguous
        cur = classes.find((c) => c._key === k) || null;
        if (!cur) {
          cur = makeClass({ arena, no, name, height: get(r, "height"), _key: k });
          const fRaw = get(r, "format");
          const f = normalizeFormat(fRaw);
          cur.format = f || FORMATS[5];
          if (!f) cur.flags.push(fRaw ? 'Format "' + fRaw + '" not recognised — set to Other' : "No format given — set to Other");
          classes.push(cur);
        }
        key = k;
      }
      const st = get(r, "start_time");
      if (st && !cur.start) {
        const t = normTime(st);
        if (t === null) cur.flags.push('Start time "' + st + '" not understood');
        else cur.start = t;
      }
      if (!cur.height && get(r, "height")) cur.height = get(r, "height");
      const sc = norm(get(r, "same_course"));
      if (sc && /^(y|yes|true|1)$/.test(sc)) cur.sameCourse = true;
      const rider = get(r, "rider"), horse = get(r, "horse"), draw = get(r, "draw");
      if (rider || horse || draw) {
        const stt = norm(get(r, "status"));
        const e = makeEntry({ draw, rider, horse, status: /scratch|withdraw|^w\/?d$/.test(stt) ? "scratched" : /done|jumped/.test(stt) ? "done" : "starting" });
        if (!rider || !horse) e.flags.push("Missing rider or horse");
        cur.entries.push(e);
      }
    }
    classes.forEach((c) => delete c._key);
    if (!classes.length) throw new Error("No classes found. Check the column headings match the template.");
    finishImportFlags(classes);
    return normalizeShow({ name: (filename || "Show").replace(/\.[^.]+$/, ""), classes });
  }
  // shared checks after any import
  function finishImportFlags(classes) {
    const seen = {};
    classes.forEach((c) => {
      const first = !seen[c.arena]; seen[c.arena] = true;
      if (!c.start) {
        if (first) c.flags.push("First class in this arena has no start time (using " + S.dayStart + ")");
        else { c.start = "follow"; }
      }
      if (c.start === "follow" && first) c.flags.push('First class in the arena is "to follow" — please add a start time');
      if (!c.entries.length) c.flags.push("No running order found for this class");
      if (!c.height) c.flags.push("No height found");
    });
  }

  function showToCSV(withExtras) {
    const cols = CSV_COLS.concat(withExtras ? ["status", "same_course"] : []);
    const lines = [cols.join(",")];
    show.classes.forEach((c) => {
      const base = [c.arena, c.no, c.name, c.height, c.format];
      const list = c.entries.length ? c.entries : [null];
      list.forEach((e, i) => {
        const row = base.concat([i === 0 ? c.start : "", e ? e.draw : "", e ? e.rider : "", e ? e.horse : ""]);
        if (withExtras) row.push(e ? e.status : "", i === 0 && c.sameCourse ? "yes" : "");
        lines.push(row.map(csvCell).join(","));
      });
    });
    return lines.join("\r\n") + "\r\n";
  }

  // ===================================================================
  // Built-in document reader (PDF via pdf.js, Excel via SheetJS)
  // ===================================================================
  async function extractPdfLines(buf) {
    await loadScript(LIBS.pdf);
    const lib = window.pdfjsLib;
    lib.GlobalWorkerOptions.workerSrc = LIBS.pdfWorker;
    const pdf = await lib.getDocument({ data: buf }).promise;
    const lines = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      const items = tc.items.filter((it) => it.str && it.str.trim()).map((it) => ({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0, h: Math.abs(it.transform[3]) || 10 }));
      items.sort((a, b) => b.y - a.y || a.x - b.x);
      const rows = [];
      items.forEach((it) => {
        const r = rows.find((rw) => Math.abs(rw.y - it.y) <= Math.max(2.5, it.h * 0.35));
        if (r) r.items.push(it); else rows.push({ y: it.y, items: [it] });
      });
      rows.sort((a, b) => b.y - a.y);
      rows.forEach((r) => {
        r.items.sort((a, b) => a.x - b.x);
        let out = ""; let endX = null;
        r.items.forEach((it) => {
          if (endX != null) {
            const gap = it.x - endX;
            out += gap > Math.max(10, it.h * 1.2) ? "\t" : gap > 1 ? " " : "";
          }
          out += it.s; endX = it.x + it.w;
        });
        lines.push(out.replace(/ +/g, " ").trim());
      });
    }
    return lines;
  }
  async function extractExcelLines(buf) {
    await loadScript(LIBS.xlsx);
    const wb = window.XLSX.read(buf, { type: "array" });
    const lines = [];
    wb.SheetNames.forEach((n) => {
      const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: "" });
      if (/arena|ring/i.test(n)) lines.push("Arena: " + n);
      rows.forEach((r) => lines.push(r.map((c) => String(c).trim()).join("\t").replace(/\t+$/, "")));
    });
    return lines;
  }

  const RE_CLASS = /\bclass\s*(?:no\.?|number|nr\.?|#)?\s*[:.\-]?\s*(\d{1,3}[a-z]?)\b/i;
  const RE_HEIGHT = /\b(\d[.,]\d{2})\s*m\b|\b(\d{2,3})\s*cm\b/i;
  const RE_TIME = /\b([01]?\d|2[0-3])\s*[:hH]\s*([0-5]\d)\b|\b([01]?\d|2[0-3])\.([0-5]\d)(?!\s*m\b)(?!\d)/;
  const RE_FOLLOW = /to follow|follows|followed|thereafter|\bafter class\b|\bfollow\b/i;
  const RE_ARENA = /\b(arena|ring)\s*[:\-]?\s*([a-z0-9][\w ]{0,20})/i;

  function findTime(s) {
    const m = s.match(RE_TIME);
    if (!m) return null;
    const h = +(m[1] != null ? m[1] : m[3]); const mi = +(m[2] != null ? m[2] : m[4]);
    if (m[3] != null && h < 6) return null; // "1.10" is a height, not a time
    return pad(h) + ":" + pad(mi);
  }
  function findHeight(s) {
    const m = s.match(RE_HEIGHT);
    if (!m) return "";
    if (m[1]) return m[1].replace(",", ".") + "m";
    return (+m[2] / 100).toFixed(2) + "m";
  }

  function linesToShow(lines, filename) {
    const classes = []; let arena = "Arena 1"; let cur = null; let cols = null;
    const setArena = (raw) => {
      arena = raw.replace(/\s+/g, " ").trim().replace(/^[:\-–\s]+|[:\-–\s]+$/g, "");
      if (arena === arena.toUpperCase()) arena = arena.toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase()); // "MAIN ARENA" → "Main Arena"
      arena = arena.charAt(0).toUpperCase() + arena.slice(1);
    };
    for (const raw of lines) {
      const line = String(raw || "").trim();
      if (!line) continue;
      const flat = line.replace(/\t/g, " ");
      const cm = flat.match(RE_CLASS);
      const cells = line.split("\t").map((c) => c.trim()).filter(Boolean);
      // Arena heading
      if (!cm && flat.length <= 40 && /\b(arena|ring)\b/i.test(flat) && !/^\d/.test(cells[0] || "") && !findTime(flat)) {
        setArena(/^arena\s*:/i.test(flat) ? flat.replace(/^arena\s*:\s*/i, "") : flat);
        continue;
      }
      if (cm && !/^\d{1,3}$/.test(cells[0] || "")) {
        const am = flat.match(RE_ARENA);
        if (am && flat.indexOf(am[0]) > -1 && !/arena familiar/i.test(flat)) setArena(am[1] + " " + am[2].split(/\s{1,}/)[0]);
        cur = makeClass({ arena, no: cm[1] });
        let name = flat.replace(cm[0], "").replace(RE_TIME, "").replace(RE_HEIGHT, "").replace(RE_FOLLOW, "")
          .replace(/^[\s:\-–|.,]+|[\s:\-–|.,]+$/g, "").replace(/\s{2,}/g, " ");
        cur.name = name.slice(0, 80);
        cur.height = findHeight(flat);
        const t = findTime(flat); if (t) cur.start = t; else if (RE_FOLLOW.test(flat)) cur.start = "follow";
        const f = normalizeFormat(flat); if (f) { cur.format = f; cur._fmt = true; }
        classes.push(cur); cols = null;
        continue;
      }
      if (!cur) {
        const t = findTime(flat);
        if (t && !RE_CLASS.test(flat)) continue;
        continue;
      }
      // Column heading row
      const lc = cells.map(norm);
      if (lc.some((c) => /rider|competitor|athlete/.test(c)) && lc.some((c) => /horse/.test(c))) {
        cols = { rider: lc.findIndex((c) => /rider|competitor|athlete/.test(c)), horse: lc.findIndex((c) => /horse/.test(c)), draw: lc.findIndex((c) => /^(draw|no\.?|nr|#|order|start|ro)$/.test(c)) };
        continue;
      }
      // Entry row
      let draw = null, rider = "", horse = "", flagged = false;
      if (cols && cells.length >= 2) {
        const all = line.split("\t").map((c) => c.trim());
        const d = cols.draw >= 0 ? all[cols.draw] : all[0];
        if (/^\d{1,3}[.)]?$/.test(d || "")) { draw = d.replace(/[.)]/, ""); rider = all[cols.rider] || ""; horse = all[cols.horse] || ""; }
      }
      if (draw == null) {
        let m = null;
        if (/^\d{1,3}[.)]?$/.test(cells[0] || "") && cells.length >= 2) {
          draw = cells[0].replace(/[.)]/, "");
          const rest = cells.slice(1).filter((c) => !/^[\d\s\-/.]+$/.test(c));
          if (rest.length >= 2) { rider = rest[0]; horse = rest[1]; }
          else if (rest.length === 1) m = rest[0];
        } else if ((m = flat.match(/^(\d{1,3})[.)]?\s+(.{3,})$/)) && !findTime(m[0].slice(0, 6))) {
          draw = m[1]; m = m[2];
        } else m = null;
        if (draw != null && m != null) {
          const parts = m.split(/\s+[-–\/|]\s+|\s{2,}|\s+on\s+/);
          if (parts.length >= 2) { rider = parts[0].trim(); horse = parts.slice(1).join(" ").trim(); }
          else { rider = m.trim(); flagged = true; }
        }
      }
      if (draw != null && (rider || horse)) {
        const e = makeEntry({ draw, rider, horse });
        if (flagged || !rider || !horse) e.flags.push("Could not split rider and horse — please check");
        cur.entries.push(e);
        continue;
      }
      // Extra class details before the running order starts
      if (!cur.entries.length) {
        if (!cur.start) { const t = findTime(flat); if (t) cur.start = t; else if (RE_FOLLOW.test(flat)) cur.start = "follow"; }
        if (!cur.height) cur.height = findHeight(flat);
        if (!cur._fmt) { const f = normalizeFormat(flat); if (f) { cur.format = f; cur._fmt = true; } }
        if (!cur.name && flat.length < 60) cur.name = flat;
      }
    }
    classes.forEach((c) => {
      if (!c._fmt) c.flags.push("Class format not found — set to Other");
      delete c._fmt;
      c.flags.push("Read automatically — check rider/horse order and times");
    });
    if (!classes.length) throw new Error("We couldn't find any classes in that file. Try the AI reader, or fill in the CSV template.");
    finishImportFlags(classes);
    return normalizeShow({ name: (filename || "Show").replace(/\.[^.]+$/, ""), classes });
  }

  // ===================================================================
  // AI reading (via your Supabase Edge Function — the AI key lives there)
  // ===================================================================
  function fileToBase64(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(",")[1] || "");
      r.onerror = () => rej(new Error("Could not read the file"));
      r.readAsDataURL(file);
    });
  }
  async function readWithAI(file) {
    if (!aiConfigured) throw Object.assign(new Error("AI reading is not set up yet."), { code: "not_configured" });
    if (file.size > 5 * 1024 * 1024) throw Object.assign(new Error("That file is over 5 MB, which is too big for AI reading."), { code: "too_large" });
    const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
    let body;
    if (isPdf) body = { kind: "pdf", filename: file.name, data: await fileToBase64(file) };
    else {
      const text = (await extractExcelLines(await file.arrayBuffer())).join("\n");
      if (text.length > 100000) throw Object.assign(new Error("That spreadsheet has too much text for AI reading (over 100,000 characters)."), { code: "too_large" });
      body = { kind: "text", filename: file.name, text };
    }
    const token = await freshToken();
    if (!token) throw Object.assign(new Error("Please sign in again to use AI reading."), { code: "login_required" });
    const headers = { "Content-Type": "application/json", apikey: CFG.SUPABASE_ANON_KEY, Authorization: "Bearer " + token };
    let resp, data;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 150000);
    try {
      resp = await fetch(CFG.SUPABASE_URL.replace(/\/$/, "") + "/functions/v1/parse-schedule", { method: "POST", headers, body: JSON.stringify(body), signal: ctrl.signal });
    } catch (e) {
      throw Object.assign(new Error("The AI reader couldn't be reached (no signal, or the service is down)."), { code: "network" });
    } finally { clearTimeout(timer); }
    try { data = await resp.json(); } catch (e) { data = null; }
    if (!resp.ok || !data || !data.ok) {
      const code = (data && data.code) || "http_" + resp.status;
      const msg = (data && data.error) || "The AI reader returned an error (" + resp.status + ").";
      throw Object.assign(new Error(msg), { code });
    }
    return aiToShow(data.show, file.name);
  }
  function aiToShow(d, filename) {
    if (!d || !Array.isArray(d.classes)) throw new Error("The AI reader returned something unexpected.");
    const classes = d.classes.map((c) => {
      const k = makeClass({
        arena: String(c.arena || "Arena 1").trim(), no: String(c.class_no || "").trim(), name: String(c.class_name || "").trim(),
        height: String(c.height || "").trim(), start: normTime(c.start_time) || "",
        format: normalizeFormat(c.format) || FORMATS[5], sameCourse: !!c.same_course
      });
      k.flags = (c.uncertain || []).map(String);
      if (c.start_time && normTime(c.start_time) === null) k.flags.push('Start time "' + c.start_time + '" not understood');
      k.entries = (c.entries || []).map((e) => {
        const x = makeEntry({ draw: String(e.draw == null ? "" : e.draw), rider: String(e.rider || ""), horse: String(e.horse || ""), status: ["starting", "scratched", "done"].includes(e.status) ? e.status : "starting" });
        if (e.uncertain) x.flags.push(typeof e.uncertain === "string" ? e.uncertain : "AI was unsure about this entry");
        return x;
      });
      k.flags.push("Read by AI — please check");
      return k;
    });
    if (!classes.length) throw new Error("The AI reader didn't find any classes in that file.");
    finishImportFlags(classes);
    return normalizeShow({ name: d.show_name || (filename || "Show").replace(/\.[^.]+$/, ""), date: /^\d{4}-\d{2}-\d{2}$/.test(d.show_date || "") ? d.show_date : undefined, classes });
  }

  // ===================================================================
  // Timing engine
  // ===================================================================
  function defaultSpr(format) {
    if (format === FORMATS[0]) return +S.sprSpeed;
    if (format === FORMATS[1]) return +S.sprTwoPhase;
    return +S.sprNormal;
  }
  function actualAvg(c, starters) {
    const lv = c.live; const minN = Math.max(2, +S.avgAfter || 3);
    const marks = (lv.marks || []).map((m) => ({ pos: starters.findIndex((e) => e.id === m.id), t: m.t })).filter((m) => m.pos >= 0).sort((a, b) => a.t - b.t);
    let r = null;
    if (lv.startedAt != null) {
      const last = marks.filter((m) => m.pos >= minN && m.t > lv.startedAt).pop();
      if (last) r = { spr: (last.t - lv.startedAt) / last.pos, n: last.pos };
    }
    if (!r && marks.length >= 2) {
      const a = marks[0], b = marks[marks.length - 1];
      if (b.pos - a.pos >= minN && b.t > a.t) r = { spr: (b.t - a.t) / (b.pos - a.pos), n: b.pos - a.pos };
    }
    if (r && (r.spr < 30 || r.spr > 600)) r = null; // ignore silly values from mis-taps
    return r;
  }
  function hasLive(c) { const l = c.live; return l.startedAt != null || l.finishedAt != null || l.nowId != null; }

  function compute(useLive) {
    const now = saNow();
    const today = !show.date || show.date === now.date;
    const out = { cls: {}, ent: {}, arenas: {} };
    const prize = S.prizeMin * 60, walkS = S.walkMin * 60, reb = S.changeRebuiltMin * 60, same = S.changeSameMin * 60;
    show.arenas.forEach((a) => {
      const list = show.classes.filter((c) => c.arena === a.name);
      const L = parseTime(a.lunchStart); const D = (+a.lunchMin || 0) * 60;
      let lunchTaken = false; let prevEnd = null;
      // classes before the last class with live data are treated as finished
      let lastLive = -1;
      if (useLive) list.forEach((c, i) => { if (hasLive(c)) lastLive = i; });
      list.forEach((c, ci) => {
        const lv = useLive ? c.live : blankLive();
        const starters = c.entries.filter((e) => e.status !== "scratched");
        const N = starters.length;
        const avg = useLive ? actualAvg(c, starters) : null;
        const spr = avg ? avg.spr : defaultSpr(c.format);
        const sched = parseTime(c.start);
        let cand, lunch = null;
        if (prevEnd == null) cand = sched != null ? sched : parseTime(S.dayStart) || 8 * 3600;
        else {
          const afterPrize = prevEnd + prize;
          const walk = c.sameCourse ? 0 : walkS;
          cand = afterPrize + (c.sameCourse ? same : reb) + walk;
          if (L != null && D > 0 && !lunchTaken && cand >= L) {
            const ls = Math.max(afterPrize, L);
            lunch = { start: ls, end: ls + D }; lunchTaken = true;
            cand = Math.max(cand, ls + D + walk);
          }
        }
        let start = sched != null ? Math.max(sched, cand) : cand;
        if (L != null && D > 0 && !lunchTaken && start >= L) { lunchTaken = true; lunch = { start: L, end: Math.min(L + D, start) }; }
        const planned = start;
        const nowIdx = lv.nowId ? starters.findIndex((e) => e.id === lv.nowId) : -1;
        let startSrc = "estimate";
        if (lv.startedAt != null) { start = lv.startedAt; startSrc = "actual"; }
        else if (nowIdx >= 0) { start = lv.nowAt - nowIdx * spr; startSrc = "derived"; }
        const finished = lv.finishedAt != null || (useLive && ci < lastLive);
        const inProgress = !finished && (lv.startedAt != null || nowIdx >= 0);
        let lastT = null;
        c.entries.forEach((e) => {
          if (e.status === "scratched") out.ent[e.id] = { t: null, state: "scratched", cls: c.id };
        });
        starters.forEach((e, i) => {
          let t, state;
          if (nowIdx >= 0) {
            if (i < nowIdx) {
              t = lv.startedAt != null && nowIdx > 0 ? lv.startedAt + i * (lv.nowAt - lv.startedAt) / nowIdx : start + i * spr;
              state = "done";
            } else if (i === nowIdx) { t = lv.nowAt; state = "now"; }
            else {
              let next = lv.nowAt + spr;
              if (inProgress && today) next = Math.max(next, now.sec);
              t = next + (i - nowIdx - 1) * spr; state = "upcoming";
            }
          } else { t = start + i * spr; state = e.status === "done" ? "done" : "upcoming"; }
          if (finished) state = "done";
          out.ent[e.id] = { t, state, cls: c.id };
          lastT = t;
        });
        const firstEnd = N ? lastT + spr : start;
        let end = firstEnd, extra = null;
        if (c.format === FORMATS[2]) { const n = Math.round(N * S.joPct / 100); extra = { label: "Jump-off", n, start: firstEnd }; end = firstEnd + n * S.joSec; }
        else if (c.format === FORMATS[3]) { const n = Math.ceil(N * S.r2Pct / 100); extra = { label: "Round 2", n, start: firstEnd }; end = firstEnd + n * spr; }
        if (lv.finishedAt != null) end = lv.finishedAt;
        else if (finished) end = Math.max(end, start);
        out.cls[c.id] = { start, planned, end, sched, late: sched != null ? start - sched : null, spr, avg, sprDefault: defaultSpr(c.format), startSrc, finished, inProgress, extra, lunch, N, nowIdx };
        prevEnd = end;
      });
    });
    return out;
  }

  function arenaStatus(a, R, B) {
    const list = show.classes.filter((c) => c.arena === a.name);
    if (!list.some(hasLive)) return null;
    let target = list.find((c) => !R.cls[c.id].finished);
    if (!target) { const last = list[list.length - 1]; return { delta: R.cls[last.id].end - B.cls[last.id].end, done: true }; }
    const e = target.entries.find((x) => { const s = R.ent[x.id]; return s && (s.state === "upcoming" || s.state === "now"); });
    if (e) return { delta: R.ent[e.id].t - B.ent[e.id].t, cls: target };
    return { delta: R.cls[target.id].end - B.cls[target.id].end, cls: target };
  }

  function findClashes(R) {
    const by = {};
    show.classes.forEach((c) => c.entries.forEach((e) => {
      const r = R.ent[e.id];
      if (!r || r.state === "scratched" || r.state === "done" || !e.rider) return;
      (by[norm(e.rider)] = by[norm(e.rider)] || []).push({ e, c, t: r.t });
    }));
    const pairs = []; const ids = new Set();
    Object.values(by).forEach((arr) => {
      arr.sort((x, y) => x.t - y.t);
      for (let i = 1; i < arr.length; i++) {
        if (arr[i].t - arr[i - 1].t < S.clashMin * 60) { pairs.push([arr[i - 1], arr[i]]); ids.add(arr[i - 1].e.id); ids.add(arr[i].e.id); }
      }
    });
    return { pairs, ids };
  }

  // ===================================================================
  // Live mode actions
  // ===================================================================
  function classById(id) { return show.classes.find((c) => c.id === id); }
  function pushUndo(c, msg) { ui.undo = { id: c.id, live: clone(c.live), entries: clone(c.entries) }; banner(esc(msg), "ok", [{ label: "Undo", fn: doUndo }], 10000); }
  function doUndo() {
    if (!ui.undo) return;
    const c = classById(ui.undo.id);
    if (c) { c.live = ui.undo.live; c.entries = ui.undo.entries; }
    ui.undo = null; saveShow(); hideBanner(); render();
  }
  function setNow(c, e, t) {
    pushUndo(c, "Now jumping #" + (e.draw || "?") + " — " + e.rider);
    const starters = c.entries.filter((x) => x.status !== "scratched");
    const idx = starters.findIndex((x) => x.id === e.id);
    const time = t != null ? t : saNow().sec;
    c.live.nowId = e.id; c.live.nowAt = time; c.live.finishedAt = null;
    c.live.marks = (c.live.marks || []).filter((m) => m.id !== e.id).concat([{ id: e.id, t: time }]);
    if (idx === 0 && c.live.startedAt == null) c.live.startedAt = time;
    ui.open[c.id] = true;
    saveShow(); render();
  }
  function nextHorse(c) {
    const starters = c.entries.filter((x) => x.status !== "scratched");
    const idx = c.live.nowId ? starters.findIndex((x) => x.id === c.live.nowId) : -1;
    const e = starters[idx + 1];
    if (!e) { banner("That was the last horse in this class. Tap “Finished” when the class ends.", "", [], 6000); return; }
    setNow(c, e);
  }
  function nowByDraw(c, draw) {
    const d = norm(draw).replace(/^#/, "");
    if (!d) return;
    const e = c.entries.find((x) => norm(x.draw) === d);
    if (!e) { banner("No entry with draw #" + esc(draw) + " in Class " + esc(c.no) + ".", "err", [], 6000); return; }
    if (e.status === "scratched") { e.status = "starting"; }
    setNow(c, e);
  }
  function toggleScratch(c, e) {
    pushUndo(c, (e.status === "scratched" ? "Un-scratched " : "Scratched ") + "#" + (e.draw || "?") + " " + e.rider);
    e.status = e.status === "scratched" ? "starting" : "scratched";
    if (e.status === "scratched" && c.live.nowId === e.id) { c.live.nowId = null; c.live.nowAt = null; }
    saveShow(); render();
  }

  // ===================================================================
  // Accounts (Supabase Auth, called directly — no extra library needed)
  // The session is kept on this phone so the app keeps working offline.
  // ===================================================================
  const AUTH_KEY = "rt.auth";
  let session = load(AUTH_KEY);
  const SITE_URL = location.origin + location.pathname.replace(/index\.html$/, "");

  function authUrl(path) { return CFG.SUPABASE_URL.replace(/\/$/, "") + "/auth/v1/" + path; }
  async function authFetch(path, body, method, token) {
    const headers = { "Content-Type": "application/json", apikey: CFG.SUPABASE_ANON_KEY };
    if (token) headers.Authorization = "Bearer " + token;
    let res;
    try { res = await fetch(authUrl(path), { method: method || "POST", headers, body: body ? JSON.stringify(body) : undefined }); }
    catch (e) { throw Object.assign(new Error("No connection. Please check your signal and try again."), { code: "network" }); }
    let data = null; try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) {
      const raw = (data && (data.msg || data.error_description || data.message || data.error)) || "";
      const code = (data && (data.error_code || data.code)) || res.status;
      throw Object.assign(new Error(friendlyAuthError(raw, code, res.status)), { code, status: res.status });
    }
    return data || {};
  }
  function friendlyAuthError(raw, code, status) {
    const r = String(raw).toLowerCase(), c = String(code);
    if (/invalid login|invalid_credentials/.test(r + c)) return "That email and password don't match. Please try again.";
    if (/not confirmed|email_not_confirmed/.test(r + c)) return "Please confirm your email first — check your inbox (and spam) for the link we sent.";
    if (/already registered|user_already_exists|already been registered/.test(r + c)) return "There's already an account with that email. Try signing in, or reset your password.";
    if (/weak|password should|weak_password/.test(r + c)) return "Please choose a stronger password (at least 8 characters, ideally with letters and numbers).";
    if (status === 429 || /rate limit|over_email_send_rate_limit/.test(r + c)) return "Too many attempts. Please wait a few minutes and try again.";
    if (/signups not allowed|signup_disabled/.test(r + c)) return "New sign-ups are switched off at the moment.";
    if (/invalid email|email_address_invalid/.test(r + c)) return "Please check the email address.";
    if (/not authorized|email address not authorized/.test(r)) return "We couldn't send an email to that address yet. Please contact the site owner.";
    return raw ? String(raw) : "Something went wrong (" + status + "). Please try again.";
  }
  function setSession(d) {
    if (!d || !d.access_token) return false;
    session = {
      access_token: d.access_token, refresh_token: d.refresh_token,
      expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (+d.expires_in || 3600),
      user: { id: d.user ? d.user.id : (session && session.user && session.user.id), email: d.user ? d.user.email : (session && session.user && session.user.email) }
    };
    store(AUTH_KEY, session);
    return true;
  }
  function clearSession() { session = null; try { localStorage.removeItem(AUTH_KEY); } catch (e) { /* ignore */ } }
  // Returns a usable access token, refreshing it if it's about to expire. Offline: keeps the old one.
  async function freshToken() {
    if (!session) return null;
    if (session.expires_at - 60 > Date.now() / 1000) return session.access_token;
    try { setSession(await authFetch("token?grant_type=refresh_token", { refresh_token: session.refresh_token })); }
    catch (e) {
      if (e.code === "network") return session.access_token; // offline: let the app keep working
      clearSession(); return null;                          // refresh token no longer valid
    }
    return session ? session.access_token : null;
  }
  // Read tokens Supabase puts in the address after an email link (confirm sign-up / reset password)
  function readAuthRedirect() {
    const h = location.hash.replace(/^#/, "");
    if (!/access_token=|error_description=|error=/.test(h)) return null;
    const p = new URLSearchParams(h);
    history.replaceState(null, "", location.pathname + location.search);
    if (p.get("error_description") || p.get("error")) return { error: (p.get("error_description") || p.get("error")).replace(/\+/g, " ") };
    const ok = setSession({ access_token: p.get("access_token"), refresh_token: p.get("refresh_token"), expires_in: p.get("expires_in"), expires_at: +p.get("expires_at") || undefined });
    return ok ? { type: p.get("type") || "" } : null;
  }
  async function loadUser() {
    try {
      const u = await authFetch("user", null, "GET", session.access_token);
      session.user = { id: u.id, email: u.email }; store(AUTH_KEY, session);
    } catch (e) { if (e.status === 401 || e.status === 403) clearSession(); }
  }

  // Per-account storage on this phone, so two people sharing a phone don't see each other's show.
  function ukey(k) { return "rt." + k + "." + (session && session.user && session.user.id ? session.user.id : "anon"); }
  function loadUserData() {
    let sh = load(ukey("show"));
    let st = load(ukey("stars"));
    // first sign-in on a phone that used the app before accounts existed: adopt the old show
    if (!sh && load("rt.show")) { sh = load("rt.show"); st = st || load("rt.stars"); try { localStorage.removeItem("rt.show"); localStorage.removeItem("rt.stars"); } catch (e) { /* ignore */ } }
    try { show = sh ? normalizeShow(sh) : null; } catch (e) { show = null; }
    stars = Object.assign({ riders: [], horses: [] }, st || {});
    if (show) saveShow(); saveStars();
    ui.open = {}; ui.arena = null;
  }

  function authMode(mode) {
    ui.authMode = mode;
    $("#formSignIn").hidden = mode !== "signin";
    $("#formSignUp").hidden = mode !== "signup";
    $("#formForgot").hidden = mode !== "forgot";
    $("#formNewPw").hidden = mode !== "newpw";
    $("#authTabs").hidden = mode === "newpw";
    $$("#authTabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.auth === mode)));
    authMsg("");
  }
  function authMsg(text, kind) {
    const m = $("#authMsg");
    m.hidden = !text; m.textContent = text || ""; m.className = "auth-msg" + (kind ? " " + kind : "");
  }
  function afterSignIn(msg) {
    ui.authMode = null;
    loadUserData();
    setView(show ? "arenas" : "load");
    if (msg) banner(esc(msg), "ok", [], 6000);
  }
  function bindAuth() {
    $("#view-auth").addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-auth]"); if (!b) return;
      if (b.dataset.auth === "cancel") { authMode("signin"); setView(show ? "arenas" : "load"); return; }
      authMode(b.dataset.auth);
    });
    $$(".showpw").forEach((cb) => cb.addEventListener("change", () => { $$('input[type="password"],input[data-pw]', cb.closest("form")).forEach((i) => { i.type = cb.checked ? "text" : "password"; i.dataset.pw = "1"; }); }));
    const val = (form, n) => (form.elements[n] ? form.elements[n].value : "").trim();
    const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
    const lock = (form, on) => $$("button,input", form).forEach((x) => (x.disabled = on));

    $("#formSignIn").addEventListener("submit", async (ev) => {
      ev.preventDefault(); const f = ev.target; const email = val(f, "email"), pw = f.elements.password.value;
      if (!validEmail(email) || !pw) return authMsg("Please enter your email and password.", "err");
      lock(f, true); authMsg("Signing in…");
      try { setSession(await authFetch("token?grant_type=password", { email, password: pw })); f.reset(); afterSignIn("Signed in as " + email); }
      catch (e) { authMsg(e.message, "err"); }
      finally { lock(f, false); }
    });
    $("#formSignUp").addEventListener("submit", async (ev) => {
      ev.preventDefault(); const f = ev.target; const email = val(f, "email"), pw = f.elements.password.value, pw2 = f.elements.password2.value;
      if (!validEmail(email)) return authMsg("Please enter a valid email address.", "err");
      if (pw.length < 8) return authMsg("Your password needs at least 8 characters.", "err");
      if (pw !== pw2) return authMsg("The two passwords don't match.", "err");
      if (!f.elements.consent.checked) return authMsg("Please tick the box to agree to the privacy note.", "err");
      lock(f, true); authMsg("Creating your account…");
      try {
        const d = await authFetch("signup?redirect_to=" + encodeURIComponent(SITE_URL), { email, password: pw });
        f.reset();
        if (setSession(d)) afterSignIn("Welcome! Your account is ready.");
        else { authMode("signin"); authMsg("Almost done! We've emailed a confirmation link to " + email + ". Open it on this phone, then sign in. (Check spam if it doesn't arrive.)", "ok"); }
      } catch (e) { authMsg(e.message, "err"); }
      finally { lock(f, false); }
    });
    $("#formForgot").addEventListener("submit", async (ev) => {
      ev.preventDefault(); const f = ev.target; const email = val(f, "email");
      if (!validEmail(email)) return authMsg("Please enter a valid email address.", "err");
      lock(f, true);
      try { await authFetch("recover?redirect_to=" + encodeURIComponent(SITE_URL), { email }); authMode("signin"); authMsg("If there's an account for " + email + ", a reset link is on its way. Open it on this phone.", "ok"); }
      catch (e) { authMsg(e.message, "err"); }
      finally { lock(f, false); }
    });
    $("#formNewPw").addEventListener("submit", async (ev) => {
      ev.preventDefault(); const f = ev.target; const pw = f.elements.password.value, pw2 = f.elements.password2.value;
      if (pw.length < 8) return authMsg("Your password needs at least 8 characters.", "err");
      if (pw !== pw2) return authMsg("The two passwords don't match.", "err");
      lock(f, true);
      try { const t = await freshToken(); await authFetch("user", { password: pw }, "PUT", t); f.reset(); afterSignIn("Your new password is saved."); }
      catch (e) { authMsg(e.message, "err"); }
      finally { lock(f, false); }
    });
    $("#btnSignOut").onclick = async () => {
      const r = await dialog("Sign out?", "<p>Your show stays saved on this phone for when you sign in again.</p>", [{ label: "Cancel", value: "no" }, { label: "Sign out", value: "yes", cls: "danger" }]);
      if (r.value !== "yes") return;
      const t = session && session.access_token;
      clearSession(); show = null; stars = { riders: [], horses: [] };
      if (t) authFetch("logout", null, "POST", t).catch(() => {});
      authMode("signin"); setView("auth");
    };
    $("#btnChangePw").onclick = () => { authMode("newpw"); setView("auth"); };
    if (CFG.CONTACT_EMAIL) { const a = $("#contactLink"); a.textContent = CFG.CONTACT_EMAIL; a.href = "mailto:" + CFG.CONTACT_EMAIL; $("#contactLine").hidden = false; }
  }

  // ===================================================================
  // Show plan for starred riders (print / PDF and WhatsApp)
  // ===================================================================
  function planRows() {
    const R = compute(true); const clashes = findClashes(R);
    const rows = [];
    show.classes.forEach((c) => c.entries.forEach((e) => {
      if (stars.riders.includes(norm(e.rider)) || stars.horses.includes(norm(e.horse))) {
        const r = R.ent[e.id] || {};
        rows.push({ c, e, t: r.t, state: r.state, clash: clashes.ids.has(e.id) });
      }
    }));
    rows.sort((a, b) => (a.t == null) - (b.t == null) || a.t - b.t);
    return { rows, clashes };
  }
  function planIntro() {
    const now = saNow();
    return { title: show.name || "Show", date: show.date || "", asAt: fmt(now.sec) + (show.date && show.date !== now.date ? " on " + now.date : "") };
  }
  function printPlan() {
    const { rows } = planRows();
    if (!rows.length) { banner("Star some riders or horses first (search above, or tap an entry in Arenas).", "", [], 6000); return; }
    const p = planIntro();
    const riders = [...new Set(rows.map((x) => x.e.rider).filter(Boolean))];
    let h = '<div class="pp-head"><img src="icon-192.png" alt=""><div><h1>Show plan — ' + esc(p.title) + "</h1>" +
      '<p class="pp-sub">' + esc(p.date) + " · " + rows.length + " round" + (rows.length > 1 ? "s" : "") + " · estimated times as at " + esc(p.asAt) + "</p></div></div>";
    h += "<h2>Riders</h2><ul class=\"pp-riders\">" + riders.map((r) => "<li>" + esc(r) + "</li>").join("") + "</ul>";
    h += "<table><thead><tr><th>Est. time</th><th>Rider</th><th>Horse</th><th>Arena</th><th>Class</th><th>Height</th><th>Format</th><th>Draw</th></tr></thead><tbody>";
    rows.forEach((x) => {
      const scr = x.state === "scratched";
      h += '<tr class="' + (scr ? "scr" : x.clash ? "clash" : "") + '"><td class="time">' + (scr ? "–" : fmt(x.t)) + (x.clash && !scr ? " ⚠" : "") + "</td><td>" + esc(x.e.rider) + "</td><td>" + esc(x.e.horse) + "</td><td>" + esc(x.c.arena) + "</td><td>" + esc(x.c.no) + (x.c.name ? " " + esc(x.c.name) : "") + "</td><td>" + esc(x.c.height) + "</td><td>" + esc(SHORT[x.c.format]) + "</td><td>#" + esc(x.e.draw) + (scr ? " (scratched)" : "") + "</td></tr>";
    });
    h += "</tbody></table>";
    h += '<p class="pp-note">⚠ = less than ' + S.clashMin + " minutes from the same rider's other round. Times are estimates based on the schedule and live updates in Ringside Timer; the ring steward and show office have the final say. Printed " + esc(p.asAt) + ".</p>";
    $("#printPlan").innerHTML = h;
    const img = $("#printPlan img");
    const go = () => { try { window.print(); } catch (e) { banner("Printing isn't available here. Try “Send plan on WhatsApp” instead.", "err", [], 6000); } };
    if (img && !img.complete) { img.onload = go; img.onerror = go; } else go();
  }
  function planText() {
    const { rows } = planRows();
    if (!rows.length) return "";
    const p = planIntro();
    const lines = ["*Ringside Timer – Show plan*", p.title + (p.date ? " · " + p.date : ""), "Estimated times as at " + p.asAt + " (the ring steward has the final say)", ""];
    rows.forEach((x) => {
      const scr = x.state === "scratched";
      lines.push((scr ? "~" : "*") + (scr ? "SCRATCHED" : fmt(x.t)) + (scr ? "~" : "*") + " · " + x.c.arena + " · Class " + x.c.no + (x.c.height ? " (" + x.c.height + ")" : ""));
      lines.push("#" + x.e.draw + " " + x.e.rider + " – " + x.e.horse + (x.clash && !scr ? "  ⚠ close to another round" : ""));
      lines.push("");
    });
    return lines.join("\n").trim();
  }
  function sendPlanWhatsApp() {
    const t = planText();
    if (!t) { banner("Star some riders or horses first (search above, or tap an entry in Arenas).", "", [], 6000); return; }
    window.open("https://wa.me/?text=" + encodeURIComponent(t), "_blank", "noopener");
  }
  async function copyPlan() {
    const t = planText();
    if (!t) { banner("Star some riders or horses first.", "", [], 5000); return; }
    try { await navigator.clipboard.writeText(t); banner("Show plan copied — paste it into any message.", "ok", [], 4000); }
    catch (e) { await dialog("Copy this plan", '<textarea readonly style="width:100%;min-height:240px;font:inherit">' + esc(t) + "</textarea>", [{ label: "Close", value: "x" }]); }
  }

  // ===================================================================
  // Banner, busy, dialogs
  // ===================================================================
  let bannerTimer = null;
  function banner(html, kind, actions, ms) {
    const b = $("#banner");
    b.className = "banner" + (kind ? " " + kind : "");
    b.innerHTML = '<div>' + html + '</div><div class="row-btns"></div>';
    const row = $(".row-btns", b);
    (actions || []).forEach((a) => { const btn = document.createElement("button"); btn.type = "button"; btn.className = "btn small" + (a.primary ? " primary" : ""); btn.textContent = a.label; btn.onclick = a.fn; row.appendChild(btn); });
    const x = document.createElement("button"); x.type = "button"; x.className = "btn small"; x.textContent = "Close"; x.onclick = hideBanner; row.appendChild(x);
    b.hidden = false;
    clearTimeout(bannerTimer);
    if (ms) bannerTimer = setTimeout(hideBanner, ms);
  }
  function hideBanner() { $("#banner").hidden = true; }
  function busy(on, text) { $("#busy").hidden = !on; if (text) $("#busyText").textContent = text; }

  function dialog(title, bodyHtml, buttons) {
    return new Promise((resolve) => {
      const dlg = $("#dlg");
      $("#dlgTitle").textContent = title;
      $("#dlgBody").innerHTML = bodyHtml || "";
      $("#dlgBtns").innerHTML = buttons.map((b) => '<button class="btn ' + (b.cls || "") + '" value="' + esc(b.value) + '">' + esc(b.label) + "</button>").join("");
      const onClose = () => {
        dlg.removeEventListener("close", onClose);
        const vals = {}; $$("input,select", $("#dlgBody")).forEach((i) => (vals[i.name] = i.value));
        resolve({ value: dlg.returnValue, vals });
      };
      dlg.returnValue = "";
      dlg.addEventListener("close", onClose);
      if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
      const first = $("input", dlg); if (first) setTimeout(() => first.focus(), 50);
    });
  }
  async function askTime(title, def) {
    const r = await dialog(title, '<label>Time (24-hour)<input type="time" name="t" value="' + fmt(def) + '" required></label>', [{ label: "Cancel", value: "cancel" }, { label: "Save", value: "ok", cls: "primary" }]);
    if (r.value !== "ok") return null;
    return parseTime(r.vals.t);
  }
  async function entryMenu(c, e) {
    const isStarR = stars.riders.includes(norm(e.rider)), isStarH = stars.horses.includes(norm(e.horse));
    const opts = [];
    if (e.status !== "scratched") opts.push({ label: "▶ Now jumping", value: "now", cls: "primary opt" });
    opts.push({ label: e.status === "scratched" ? "Un-scratch" : "✕ Scratch (not starting)", value: "scratch", cls: "opt" + (e.status === "scratched" ? "" : " danger") });
    if (e.rider) opts.push({ label: (isStarR ? "Unstar rider " : "★ Star rider ") + e.rider, value: "sr", cls: "opt" });
    if (e.horse) opts.push({ label: (isStarH ? "Unstar horse " : "★ Star horse ") + e.horse, value: "sh", cls: "opt" });
    opts.push({ label: "Cancel", value: "cancel", cls: "opt" });
    const r = await dialog("#" + (e.draw || "?") + " " + (e.rider || "") + (e.horse ? " · " + e.horse : ""), '<p class="muted small">Class ' + esc(c.no) + " " + esc(c.name) + "</p>", opts);
    if (r.value === "now") setNow(c, e);
    else if (r.value === "scratch") toggleScratch(c, e);
    else if (r.value === "sr") toggleStar("riders", e.rider);
    else if (r.value === "sh") toggleStar("horses", e.horse);
  }
  function toggleStar(kind, name) {
    const n = norm(name); const arr = stars[kind];
    const i = arr.indexOf(n); if (i >= 0) arr.splice(i, 1); else arr.push(n);
    saveStars(); render();
  }

  // ===================================================================
  // Views
  // ===================================================================
  function setView(v) {
    if (!session) v = "auth";
    else if (v === "auth") v = ui.authMode === "newpw" ? "auth" : show ? "arenas" : "load";
    if (session && !show && v !== "load" && v !== "auth") v = "load";
    ui.view = v;
    if (v === "auth" && !ui.authMode) authMode("signin");
    $$(".view").forEach((s) => (s.hidden = s.id !== "view-" + v));
    $$("#tabbar button").forEach((b) => b.setAttribute("aria-current", b.dataset.view === v ? "page" : "false"));
    $("#tabbar").hidden = !show || v === "auth";
    $(".foot").hidden = v === "auth";
    render();
    window.scrollTo(0, 0);
  }
  function render() {
    tickClock();
    if (ui.view === "auth") { $("#showName").textContent = "Sign in to continue"; return; }
    $("#showName").textContent = show ? show.name + (show.date ? " · " + show.date : "") : "No show loaded";
    if (!show) { renderLoad(); return; }
    if (ui.view === "arenas") renderArenas();
    else if (ui.view === "mine") renderMine();
    else if (ui.view === "review") renderReview();
    else if (ui.view === "settings") renderSettings();
    else if (ui.view === "load") renderLoad();
  }
  function tickClock() { $("#clock").textContent = fmt(saNow().sec); }

  function countdown(t, state) {
    const now = saNow();
    if (show.date && show.date !== now.date) return "";
    if (state === "now") return "jumping now";
    if (state === "done") return "done";
    const d = t - now.sec;
    if (d > 60) return "in ~" + fmtMins(d);
    if (d > -120) return "due now";
    return "~" + fmtMins(-d) + " ago";
  }

  // ---------- Load ----------
  function renderLoad() {
    const saved = load(ukey("show"));
    if (saved) $("#resumeText").textContent = saved.name + " · " + (saved.classes || []).length + " classes";
    $("#resumeCard").hidden = !saved;
    $("#btnReadAI").hidden = !aiConfigured;
    $("#aiPrivacy").hidden = !aiConfigured;
  }

  // ---------- Arenas ----------
  function renderArenas() {
    if (!show.arenas.length) { $("#arenaClasses").innerHTML = '<p class="empty">No classes yet. Add some in Edit.</p>'; $("#arenaTabs").innerHTML = ""; $("#arenaSummary").innerHTML = ""; return; }
    if (!ui.arena || !show.arenas.some((a) => a.name === ui.arena)) ui.arena = show.arenas[0].name;
    const R = compute(true), B = compute(false);
    const clashes = findClashes(R);
    $("#arenaTabs").innerHTML = show.arenas.map((a) => {
      const st = arenaStatus(a, R, B);
      const tag = st && Math.abs(st.delta) >= 120 ? (st.delta > 0 ? " +" : " −") + Math.round(Math.abs(st.delta) / 60) + "m" : "";
      return '<button type="button" role="tab" data-arena="' + esc(a.name) + '" aria-selected="' + (a.name === ui.arena) + '">' + esc(a.name) + tag + "</button>";
    }).join("");
    const arena = show.arenas.find((a) => a.name === ui.arena);
    const list = show.classes.filter((c) => c.arena === arena.name);
    // summary
    const st = arenaStatus(arena, R, B);
    const sumEl = $("#arenaSummary");
    sumEl.className = "summary";
    if (st) {
      const m = Math.round(st.delta / 60);
      if (Math.abs(st.delta) < 120) sumEl.innerHTML = "On time" + (m ? " (" + (m > 0 ? "+" : "") + m + " min)" : "");
      else { sumEl.innerHTML = "Running " + fmtMins(st.delta) + (st.delta > 0 ? " behind" : " ahead of") + " estimate"; sumEl.classList.add(st.delta > 0 ? "behind" : "ahead"); }
      sumEl.innerHTML += '<span class="small">Compared with the original estimate from the schedule' + (st.done ? " · all classes finished" : "") + "</span>";
    } else {
      const late = list.map((c) => R.cls[c.id]).filter((x) => x.late != null && x.late >= 120);
      const lastC = list[list.length - 1];
      sumEl.innerHTML = "Estimated finish ~" + fmt(R.cls[lastC.id].end) + (late.length ? ' · <span>' + late.length + " class" + (late.length > 1 ? "es" : "") + " projected to start late</span>" : "") +
        '<span class="small">No live updates yet. Use “Now jumping” on show day to correct the times.</span>';
      if (late.length) sumEl.classList.add("behind");
    }
    // auto-open: first unfinished class (and live class)
    const firstOpen = list.find((c) => !R.cls[c.id].finished);
    let html = "";
    list.forEach((c) => {
      const r = R.cls[c.id];
      if (r.lunch) html += '<div class="lunch-row">🍽 Lunch break ~' + fmt(r.lunch.start) + "–" + fmt(r.lunch.end) + "</div>";
      const open = ui.open[c.id] != null ? ui.open[c.id] : (firstOpen && firstOpen.id === c.id) || r.inProgress;
      const badges = [];
      if (r.inProgress) badges.push('<span class="badge live">Live</span>');
      if (r.finished) badges.push('<span class="badge done">Finished' + (c.live.finishedAt != null ? " " + fmt(c.live.finishedAt) : "") + "</span>");
      if (c.start === "follow") badges.push('<span class="badge">To follow</span>');
      if (r.late != null && r.late >= 120 && !r.finished) badges.push('<span class="badge late">~' + fmtMins(r.late) + " later than scheduled " + fmt(r.sched) + "</span>");
      if (r.late != null && r.late <= -120 && !r.finished) badges.push('<span class="badge early">~' + fmtMins(r.late) + " earlier than " + fmt(r.sched) + "</span>");
      if (c.sameCourse) badges.push('<span class="badge">Same course, height raised</span>');
      const scratched = c.entries.length - r.N;
      html += '<details class="klass' + (r.inProgress ? " live" : "") + (r.finished ? " finished" : "") + '" data-cls="' + c.id + '"' + (open ? " open" : "") + ">";
      html += '<summary><div class="k-top"><div class="k-title">Class ' + esc(c.no) + (c.height ? " · " + esc(c.height) : "") + '</div><div class="k-times">' + fmt(r.start) + "–" + fmt(r.end) + "</div></div>";
      html += '<div class="k-meta">' + esc(c.name || "") + (c.name ? " · " : "") + esc(SHORT[c.format]) + " · " + r.N + " starting" + (scratched ? " (" + scratched + " scratched)" : "") + (r.sched != null ? " · scheduled " + fmt(r.sched) : "") + "</div>";
      html += '<div class="badges">' + badges.join("") + "</div></summary>";
      // live bar
      const sprInfo = r.avg ? "Using real average " + fmtDur(r.avg.spr) + " per round (from " + r.avg.n + " rounds)" : "Using default " + fmtDur(r.sprDefault) + " per round" + (r.startSrc === "actual" ? " · started " + fmt(c.live.startedAt) : "");
      html += '<div class="live-bar"><div class="now-in"><label>Now jumping #<input type="text" inputmode="numeric" enterkeyhint="go" data-now="' + c.id + '" placeholder="draw"></label><button type="button" class="btn small primary" data-act="go" data-cls="' + c.id + '">Go</button><button type="button" class="btn small" data-act="next" data-cls="' + c.id + '">Next ▸</button></div>' +
        '<button type="button" class="btn small" data-act="started" data-cls="' + c.id + '">Started</button><button type="button" class="btn small" data-act="finished" data-cls="' + c.id + '">Finished</button>' +
        '<div class="info">' + sprInfo + (hasLive(c) ? ' · <button type="button" class="btn small" data-act="resetlive" data-cls="' + c.id + '">Clear live</button>' : "") + "</div></div>";
      html += '<ul class="entries">';
      c.entries.forEach((e) => {
        const er = R.ent[e.id] || {};
        const cls = ["entry", er.state || ""];
        if (clashes.ids.has(e.id)) cls.push("clash");
        if (stars.riders.includes(norm(e.rider)) || stars.horses.includes(norm(e.horse))) cls.push("starred");
        const cd = er.state === "scratched" ? "" : countdown(er.t, er.state);
        html += '<li class="' + cls.join(" ") + '" data-cls="' + c.id + '" data-ent="' + e.id + '"><span class="draw">' + esc(e.draw || "–") + '</span><span class="who"><div class="rider">' + esc(e.rider || "?") + '</div><div class="horse">' + esc(e.horse || "") + "</div></span>" +
          '<span class="t">' + (er.state === "scratched" ? "scratched" : fmt(er.t)) + (cd ? "<small>" + cd + "</small>" : "") + "</span></li>";
      });
      html += "</ul>";
      if (r.extra && r.extra.n > 0) html += '<div class="extra-row"><span>' + r.extra.label + " (est. " + r.extra.n + " riders)</span><b>~" + fmt(r.extra.start) + "</b></div>";
      html += '<div class="extra-row"><span>Estimated finish incl. ' + (r.extra ? r.extra.label.toLowerCase() : "last round") + "</span><b>~" + fmt(r.end) + "</b></div>";
      html += "</details>";
    });
    $("#arenaClasses").innerHTML = html;
  }

  // ---------- My riders ----------
  function renderMine() {
    const R = compute(true);
    const clashes = findClashes(R);
    const q = norm($("#inSearch").value);
    // search results
    let sr = "";
    if (q.length >= 2) {
      const riders = new Map(), horses = new Map();
      show.classes.forEach((c) => c.entries.forEach((e) => {
        if (norm(e.rider).includes(q)) riders.set(norm(e.rider), e.rider);
        if (norm(e.horse).includes(q)) horses.set(norm(e.horse), e.horse);
      }));
      const items = [...riders.entries()].map(([k, v]) => ({ k, v, kind: "riders", label: "Rider" })).concat([...horses.entries()].map(([k, v]) => ({ k, v, kind: "horses", label: "Horse" }))).slice(0, 30);
      sr = '<div class="card">' + (items.length ? items.map((it) => {
        const on = stars[it.kind].includes(it.k);
        return '<div class="result"><div><strong>' + esc(it.v) + '</strong> <span class="muted small">' + it.label + '</span></div><div class="star-btns"><button type="button" class="btn small' + (on ? " star-on" : "") + '" data-star="' + it.kind + '" data-name="' + esc(it.v) + '">' + (on ? "★ Starred" : "☆ Star") + "</button></div></div>";
      }).join("") : '<p class="muted">No rider or horse matches “' + esc(q) + "”.</p>") + "</div>";
    }
    $("#searchResults").innerHTML = sr;
    // my rounds
    const mine = [];
    show.classes.forEach((c) => c.entries.forEach((e) => {
      if (stars.riders.includes(norm(e.rider)) || stars.horses.includes(norm(e.horse))) mine.push({ c, e, r: R.ent[e.id] || {} });
    }));
    mine.sort((a, b) => (a.r.t == null) - (b.r.t == null) || a.r.t - b.r.t);
    const myClash = clashes.pairs.filter(([a, b]) => mine.some((m) => m.e.id === a.e.id || m.e.id === b.e.id));
    $("#clashList").innerHTML = myClash.length ? '<div class="clash-box"><strong>⚠ Possible clashes (less than ' + S.clashMin + " min apart)</strong><ul>" + myClash.map(([a, b]) =>
      "<li>" + esc(a.e.rider) + ": " + fmt(a.t) + " " + esc(a.c.arena) + " Class " + esc(a.c.no) + " (" + esc(a.e.horse) + ") and " + fmt(b.t) + " " + esc(b.c.arena) + " Class " + esc(b.c.no) + " (" + esc(b.e.horse) + ")</li>").join("") + "</ul></div>" : "";
    if (!mine.length) {
      $("#mineList").innerHTML = '<p class="empty">No starred riders or horses yet.<br>Search above, or tap any entry in Arenas and choose “Star”.</p>';
      return;
    }
    $("#mineList").innerHTML = mine.map(({ c, e, r }) => {
      const scr = r.state === "scratched";
      const cd = scr ? "scratched" : countdown(r.t, r.state);
      return '<div class="mine-item' + (r.state === "done" || scr ? " past" : "") + (clashes.ids.has(e.id) ? " clash" : "") + '" data-cls="' + c.id + '" data-ent="' + e.id + '"><div><strong>' + esc(e.rider) + "</strong> · " + esc(e.horse) +
        '<div class="muted small">' + esc(c.arena) + " · Class " + esc(c.no) + (c.height ? " " + esc(c.height) : "") + " · draw #" + esc(e.draw) + "</div></div>" +
        '<div class="when"><b>' + (scr ? "–" : fmt(r.t)) + "</b><span>" + esc(cd) + "</span></div></div>";
    }).join("");
  }

  // ---------- Review / edit ----------
  function renderReview() {
    $("#inShowName").value = show.name || "";
    $("#inShowDate").value = show.date || "";
    const arenas = show.arenas.map((a) => a.name);
    let html = '<datalist id="arenaNames">' + arenas.map((a) => '<option value="' + esc(a) + '">').join("") + "</datalist>";
    show.classes.forEach((c, ci) => {
      const flagged = c.flags.length || c.entries.some((e) => e.flags.length);
      html += '<div class="rv-class' + (flagged ? " flagged" : "") + '" data-cls="' + c.id + '">';
      html += '<div class="rv-head"><label>Class no.<input data-f="no" value="' + esc(c.no) + '"></label><label>Class name<input data-f="name" value="' + esc(c.name) + '"></label></div>';
      html += '<div class="rv-grid"><label>Arena<input data-f="arena" list="arenaNames" value="' + esc(c.arena) + '"></label><label>Height<input data-f="height" value="' + esc(c.height) + '" placeholder="1.10m"></label>' +
        '<label>Start time<input data-f="start" value="' + esc(c.start) + '" placeholder="08:00 or follow"></label><label>Format<select data-f="format">' + FORMATS.map((f) => "<option" + (f === c.format ? " selected" : "") + ">" + esc(f) + "</option>").join("") + "</select></label>" +
        '<label class="wide"><input type="checkbox" data-f="sameCourse"' + (c.sameCourse ? " checked" : "") + '>Same course as previous class, height raised (' + S.changeSameMin + " min change, no walk)</label></div>";
      if (c.flags.length) html += '<div class="flags"><ul>' + c.flags.map((f) => "<li>" + esc(f) + "</li>").join("") + '</ul><button type="button" class="btn small" data-rv="clearflags">Mark as checked</button></div>';
      html += '<div class="rv-tools"><button type="button" class="btn small" data-rv="up"' + (ci === 0 ? " disabled" : "") + '>↑ Move class</button><button type="button" class="btn small" data-rv="down"' + (ci === show.classes.length - 1 ? " disabled" : "") + '>↓ Move class</button>' +
        '<button type="button" class="btn small" data-rv="swap">Swap rider ↔ horse</button><button type="button" class="btn small danger" data-rv="delclass">Delete class</button></div>';
      const openEntries = c.entries.some((e) => e.flags.length) || c.entries.length <= 12;
      html += '<details class="rv-more"' + (openEntries ? " open" : "") + "><summary>Running order (" + c.entries.length + " entries)</summary><div class=\"rv-entries\">";
      html += '<div class="rv-entry head"><span>Draw</span><span>Rider</span><span>Horse</span><span>Status</span><span></span></div>';
      c.entries.forEach((e, ei) => {
        html += '<div class="rv-entry' + (e.flags.length ? " flagged" : "") + '" data-ent="' + e.id + '"' + (e.flags.length ? ' title="' + esc(e.flags.join("; ")) + '"' : "") + ">" +
          '<input data-e="draw" value="' + esc(e.draw) + '" aria-label="Draw" inputmode="numeric">' +
          '<input data-e="rider" value="' + esc(e.rider) + '" aria-label="Rider" placeholder="Rider">' +
          '<input class="horse-in" data-e="horse" value="' + esc(e.horse) + '" aria-label="Horse" placeholder="Horse">' +
          '<select data-e="status" aria-label="Status"><option value="starting"' + (e.status === "starting" ? " selected" : "") + '>Starting</option><option value="scratched"' + (e.status === "scratched" ? " selected" : "") + '>Scratched</option><option value="done"' + (e.status === "done" ? " selected" : "") + ">Done</option></select>" +
          '<span class="ops"><button type="button" class="icon-btn" data-rv="eup" aria-label="Move up"' + (ei === 0 ? " disabled" : "") + '>↑</button><button type="button" class="icon-btn" data-rv="edown" aria-label="Move down"' + (ei === c.entries.length - 1 ? " disabled" : "") + '>↓</button><button type="button" class="icon-btn" data-rv="edel" aria-label="Remove">✕</button></span></div>';
      });
      html += '<div class="row-btns"><button type="button" class="btn small" data-rv="eadd">+ Add entry</button></div></div></details></div>';
    });
    $("#reviewList").innerHTML = html || '<p class="empty">No classes yet.</p>';
  }

  // ---------- Settings ----------
  function renderSettings() {
    $$("[data-set]").forEach((i) => { i.value = S[i.dataset.set]; });
    $("#lunchList").innerHTML = show.arenas.map((a, i) =>
      '<div class="grid2" style="margin-bottom:10px"><label>' + esc(a.name) + ' — lunch at<input type="time" data-lunch="' + i + '" data-k="lunchStart" value="' + esc(a.lunchStart || "") + '"></label><label>Minutes<input type="number" min="0" max="120" data-lunch="' + i + '" data-k="lunchMin" value="' + esc(a.lunchMin || 0) + '"></label></div>').join("") +
      '<p class="muted small">Leave blank for no lunch break. The break is taken after the class that is running when lunch time arrives.</p>';
    $("#btnShare").hidden = !(navigator.canShare && window.File);
    $("#acctEmail").textContent = (session && session.user && session.user.email) || "";
  }

  // ===================================================================
  // Loading a show
  // ===================================================================
  function useShow(sh, toReview) {
    show = sh; ui.open = {}; ui.arena = null;
    saveShow();
    const flags = show.classes.reduce((n, c) => n + c.flags.length + c.entries.filter((e) => e.flags.length).length, 0);
    setView(toReview ? "review" : "arenas");
    if (toReview) banner("Loaded " + show.classes.length + " classes, " + show.classes.reduce((n, c) => n + c.entries.length, 0) + " entries." + (flags ? " " + flags + " item(s) need checking (amber)." : " Please check them before using the times."), flags ? "" : "ok", [], 9000);
  }
  async function handleCsvFile(file) {
    const text = await file.text();
    if (/\.json$/i.test(file.name) || /^\s*\{/.test(text)) {
      const d = JSON.parse(text);
      if (!d || !(d.show || d.classes)) throw new Error("That doesn't look like a Ringside Timer backup.");
      if (d.stars) { stars = Object.assign({ riders: [], horses: [] }, d.stars); saveStars(); }
      if (d.settings) { S = Object.assign({}, DEFAULTS, d.settings); saveSettings(); applyTheme(); }
      useShow(normalizeShow(d.show || d), false);
      banner("Backup restored.", "ok", [], 5000);
      return;
    }
    useShow(csvToShow(text, file.name), true);
  }
  async function readLocal() {
    const f = ui.docFile; if (!f) return;
    busy(true, "Reading " + f.name + "…");
    try {
      const buf = await f.arrayBuffer();
      const lines = /\.pdf$/i.test(f.name) || f.type === "application/pdf" ? await extractPdfLines(buf) : await extractExcelLines(buf);
      useShow(linesToShow(lines, f.name), true);
    } catch (e) {
      const offline = /Could not load/.test(e.message);
      banner(esc(offline ? "The reader needs a connection the first time it's used. Try again when you have signal, or use the CSV template." : e.message), "err", [{ label: "Download CSV template", fn: downloadTemplate }]);
    } finally { busy(false); }
  }
  async function readAI() {
    const f = ui.docFile; if (!f) return;
    busy(true, "Reading with AI… this can take up to a minute");
    try { useShow(await readWithAI(f), true); }
    catch (e) {
      const limited = /rate_limit/.test(e.code || "");
      const msg = limited
        ? (e.code === "rate_limit_global" ? "The AI reader has reached its daily limit for everyone. " : "You've used today's AI reads. ") + "Please use the free reader on this phone, or the CSV template — they work just as well for most schedules."
        : esc(e.message) + " You can still use the free reader on this phone or the CSV template.";
      if (e.code === "login_required") { banner("Your sign-in has expired. Please sign in again, then retry.", "err", [{ label: "Sign in", fn: () => { hideBanner(); clearSession(); setView("auth"); }, primary: true }]); return; }
      banner(msg, limited ? "" : "err", [{ label: "Read on this phone", fn: () => { hideBanner(); readLocal(); }, primary: true }, { label: "CSV template", fn: downloadTemplate }]);
    } finally { busy(false); }
  }
  function downloadTemplate() { download("ringside-timer-template.csv", CSV_COLS.join(",") + "\r\n", "text/csv"); }
  async function loadSample() {
    busy(true, "Loading sample…");
    try {
      const r = await fetch("sample-schedule.csv", { cache: "no-cache" });
      if (!r.ok) throw new Error("Sample not found");
      useShow(csvToShow(await r.text(), "Sample Show"), true);
      show.name = "Sample Show (Gauteng)"; saveShow(); render();
    } catch (e) { banner("Couldn't load the sample show: " + esc(e.message), "err"); }
    finally { busy(false); }
  }
  function backupJSON() { return JSON.stringify({ app: "ringside-timer", version: 1, exported: new Date().toISOString(), show, stars, settings: S }, null, 1); }
  function fileSafe(s) { return String(s || "show").replace(/[^\w\-]+/g, "-").replace(/-+/g, "-").slice(0, 40); }

  function applyTheme() {
    if (S.theme === "light" || S.theme === "dark") document.documentElement.setAttribute("data-theme", S.theme);
    else document.documentElement.removeAttribute("data-theme");
  }

  // ===================================================================
  // Events
  // ===================================================================
  function bind() {
    $("#tabbar").addEventListener("click", (ev) => { const b = ev.target.closest("button[data-view]"); if (b) setView(b.dataset.view); });
    $("#btnTemplate").onclick = downloadTemplate;
    $("#btnPlanPrint").onclick = printPlan;
    $("#btnPlanWA").onclick = sendPlanWhatsApp;
    $("#btnPlanCopy").onclick = copyPlan;
    $("#btnSample").onclick = loadSample;
    $("#btnResume").onclick = () => { show = normalizeShow(load(ukey("show"))); setView("arenas"); };
    $("#fileCsv").onchange = async (ev) => {
      const f = ev.target.files[0]; ev.target.value = ""; if (!f) return;
      try { await handleCsvFile(f); } catch (e) { banner(esc(e.message), "err", [{ label: "Download CSV template", fn: downloadTemplate }]); }
    };
    $("#fileDoc").onchange = (ev) => {
      const f = ev.target.files[0]; ev.target.value = ""; if (!f) return;
      if (/\.csv$/i.test(f.name) || /\.json$/i.test(f.name)) { handleCsvFile(f).catch((e) => banner(esc(e.message), "err")); return; }
      ui.docFile = f; $("#docName").textContent = f.name + " (" + Math.round(f.size / 1024) + " KB)";
      $("#docChoice").hidden = false; renderLoad();
    };
    $("#btnReadLocal").onclick = readLocal;
    $("#btnReadAI").onclick = readAI;
    $("#btnReviewDone").onclick = () => setView("arenas");

    // Arena view interactions
    $("#arenaTabs").addEventListener("click", (ev) => { const b = ev.target.closest("[data-arena]"); if (b) { ui.arena = b.dataset.arena; renderArenas(); } });
    $("#arenaClasses").addEventListener("toggle", (ev) => { const d = ev.target; if (d.dataset && d.dataset.cls) ui.open[d.dataset.cls] = d.open; }, true);
    $("#arenaClasses").addEventListener("click", async (ev) => {
      const act = ev.target.closest("[data-act]");
      if (act) {
        ev.preventDefault();
        const c = classById(act.dataset.cls); if (!c) return;
        const a = act.dataset.act;
        if (a === "go") nowByDraw(c, $('input[data-now="' + c.id + '"]').value);
        else if (a === "next") nextHorse(c);
        else if (a === "started") { const t = await askTime("Class " + c.no + " started at", saNow().sec); if (t != null) { pushUndo(c, "Class " + c.no + " started " + fmt(t)); c.live.startedAt = t; c.live.finishedAt = null; ui.open[c.id] = true; saveShow(); render(); } }
        else if (a === "finished") { const t = await askTime("Class " + c.no + " finished at", saNow().sec); if (t != null) { pushUndo(c, "Class " + c.no + " finished " + fmt(t)); c.live.finishedAt = t; ui.open[c.id] = false; saveShow(); render(); } }
        else if (a === "resetlive") { pushUndo(c, "Live updates cleared for Class " + c.no); c.live = blankLive(); c.entries.forEach((e) => { if (e.status === "done") e.status = "starting"; }); saveShow(); render(); }
        return;
      }
      const li = ev.target.closest(".entry");
      if (li) { const c = classById(li.dataset.cls); const e = c && c.entries.find((x) => x.id === li.dataset.ent); if (e) entryMenu(c, e); }
    });
    $("#arenaClasses").addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && ev.target.dataset.now) { ev.preventDefault(); const c = classById(ev.target.dataset.now); if (c) nowByDraw(c, ev.target.value); }
    });

    // My riders
    $("#inSearch").addEventListener("input", renderMine);
    $("#view-mine").addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-star]");
      if (b) { toggleStar(b.dataset.star, b.dataset.name); return; }
      const m = ev.target.closest(".mine-item");
      if (m) { const c = classById(m.dataset.cls); const e = c && c.entries.find((x) => x.id === m.dataset.ent); if (e) entryMenu(c, e); }
    });

    // Review edits (saved as you type; structure changes re-render)
    $("#inShowName").addEventListener("input", (ev) => { show.name = ev.target.value; saveShow(); $("#showName").textContent = show.name; });
    $("#inShowDate").addEventListener("change", (ev) => { show.date = ev.target.value; saveShow(); render(); });
    const rv = $("#reviewList");
    rv.addEventListener("input", onReviewEdit);
    rv.addEventListener("change", onReviewEdit);
    rv.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-rv]"); if (!b) return;
      const box = b.closest("[data-cls]"); const c = classById(box.dataset.cls); if (!c) return;
      const i = show.classes.indexOf(c);
      const row = b.closest("[data-ent]"); const ei = row ? c.entries.findIndex((x) => x.id === row.dataset.ent) : -1;
      switch (b.dataset.rv) {
        case "up": if (i > 0) [show.classes[i - 1], show.classes[i]] = [show.classes[i], show.classes[i - 1]]; break;
        case "down": if (i < show.classes.length - 1) [show.classes[i + 1], show.classes[i]] = [show.classes[i], show.classes[i + 1]]; break;
        case "delclass": if (!confirmDel(c)) return; show.classes.splice(i, 1); break;
        case "swap": c.entries.forEach((e) => { const t = e.rider; e.rider = e.horse; e.horse = t; }); break;
        case "clearflags": c.flags = []; c.entries.forEach((e) => (e.flags = [])); break;
        case "eup": if (ei > 0) [c.entries[ei - 1], c.entries[ei]] = [c.entries[ei], c.entries[ei - 1]]; break;
        case "edown": if (ei < c.entries.length - 1) [c.entries[ei + 1], c.entries[ei]] = [c.entries[ei], c.entries[ei + 1]]; break;
        case "edel": c.entries.splice(ei, 1); break;
        case "eadd": {
          const maxDraw = c.entries.reduce((m, e) => Math.max(m, parseInt(e.draw, 10) || 0), 0);
          c.entries.push(makeEntry({ draw: String(maxDraw + 1) })); break;
        }
      }
      syncArenas(show); saveShow(); renderReview();
      if (b.dataset.rv === "eadd") { const rows = $$('[data-cls="' + c.id + '"] .rv-entry[data-ent] input[data-e="rider"]'); const last = rows[rows.length - 1]; if (last) last.focus(); }
    });
    $("#btnAddClass").onclick = () => {
      const last = show.classes[show.classes.length - 1];
      show.classes.push(makeClass({ arena: last ? last.arena : "Arena 1", no: String((parseInt(last && last.no, 10) || 0) + 1), start: last ? "follow" : S.dayStart }));
      syncArenas(show); saveShow(); renderReview();
    };

    // Settings
    $("#view-settings").addEventListener("change", (ev) => {
      const i = ev.target;
      if (i.dataset.set) {
        const k = i.dataset.set;
        if (typeof DEFAULTS[k] === "number") { const v = parseFloat(i.value); S[k] = isFinite(v) && v >= 0 ? v : DEFAULTS[k]; }
        else S[k] = i.value || DEFAULTS[k];
        saveSettings(); if (k === "theme") applyTheme();
      } else if (i.dataset.lunch != null) {
        const a = show.arenas[+i.dataset.lunch];
        if (i.dataset.k === "lunchMin") a.lunchMin = Math.max(0, parseInt(i.value, 10) || 0); else a.lunchStart = i.value;
        saveShow();
      }
    });
    $("#btnExportCsv").onclick = () => download(fileSafe(show.name) + ".csv", showToCSV(true), "text/csv");
    $("#btnExportJson").onclick = () => download(fileSafe(show.name) + "-backup.json", backupJSON(), "application/json");
    $("#btnShare").onclick = async () => {
      try {
        const file = new File([showToCSV(true)], fileSafe(show.name) + ".csv", { type: "text/csv" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: show.name });
        else download(file.name, showToCSV(true), "text/csv");
      } catch (e) { /* user cancelled */ }
    };
    $("#btnResetSettings").onclick = () => { S = Object.assign({}, DEFAULTS); saveSettings(); applyTheme(); renderSettings(); banner("Settings reset to defaults.", "ok", [], 4000); };
    $("#btnClearLive").onclick = async () => {
      const r = await dialog("Clear all live updates?", "<p>This removes every “now jumping”, started and finished time for this show. Scratches stay.</p>", [{ label: "Cancel", value: "no" }, { label: "Clear", value: "yes", cls: "danger" }]);
      if (r.value !== "yes") return;
      show.classes.forEach((c) => (c.live = blankLive())); saveShow(); banner("Live updates cleared.", "ok", [], 4000);
    };
    $("#btnNewShow").onclick = async () => {
      const r = await dialog("Load a different show?", "<p>Your current show stays saved until you load a new one. Tip: download a backup first.</p>", [{ label: "Cancel", value: "no" }, { label: "Continue", value: "yes", cls: "primary" }]);
      if (r.value === "yes") { $("#docChoice").hidden = true; ui.view = "load"; $$(".view").forEach((s) => (s.hidden = s.id !== "view-load")); $("#tabbar").hidden = true; renderLoad(); }
    };
  }
  function confirmDel(c) { return window.confirm ? window.confirm("Delete Class " + (c.no || "") + " and its " + c.entries.length + " entries?") : true; }
  function onReviewEdit(ev) {
    const i = ev.target; const box = i.closest("[data-cls]"); if (!box) return;
    const c = classById(box.dataset.cls); if (!c) return;
    if (i.dataset.f) {
      const f = i.dataset.f;
      if (f === "sameCourse") c.sameCourse = i.checked;
      else if (f === "start") {
        if (ev.type !== "change") return;
        const t = normTime(i.value);
        if (t === null) { i.value = c.start; banner("Use a time like 09:30, or the word “follow”.", "err", [], 5000); return; }
        c.start = t; i.value = t;
      } else c[f] = i.value;
      if (f === "arena" && ev.type === "change") { c.arena = i.value.trim() || "Arena 1"; syncArenas(show); }
    } else if (i.dataset.e) {
      const row = i.closest("[data-ent]"); const e = c.entries.find((x) => x.id === row.dataset.ent); if (!e) return;
      e[i.dataset.e] = i.value;
      if (i.dataset.e !== "status" && e.flags.length && ev.type === "change") { e.flags = []; row.classList.remove("flagged"); }
    }
    saveShow();
  }

  // ===================================================================
  // Start-up
  // ===================================================================
  function init() {
    applyTheme();
    bind();
    bindAuth();
    tickClock();
    const redirect = readAuthRedirect();
    if (session) loadUserData();
    if (redirect && redirect.error) { setView("auth"); authMode("signin"); authMsg("That link didn't work: " + redirect.error + ". Links expire after a while — please try again.", "err"); }
    else if (redirect && redirect.type === "recovery") { authMode("newpw"); setView("auth"); authMsg("Please choose a new password.", "ok"); }
    else if (session) { setView(show ? "arenas" : "load"); if (redirect) banner("Your email is confirmed — welcome!", "ok", [], 6000); }
    else { setView("auth"); authMode("signin"); }
    if (session && navigator.onLine !== false) {
      freshToken().then(() => (session ? loadUser() : null)).then(() => { if (!session && ui.view !== "auth") { setView("auth"); authMode("signin"); authMsg("Please sign in again.", "err"); } });
    }
    setInterval(() => {
      tickClock();
      const typing = document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
      const dlgOpen = $("#dlg").open;
      if (!typing && !dlgOpen && (ui.view === "arenas" || ui.view === "mine")) render();
      if (session && session.expires_at - 300 < Date.now() / 1000) freshToken();
    }, 20000);
    if ("serviceWorker" in navigator && /^https?:/.test(location.protocol)) {
      navigator.serviceWorker.register("sw.js").catch(() => { /* offline support unavailable */ });
    }
  }
  // expose a tiny hook for automated tests (no secrets here)
  window.RingsideTimer = { compute: () => compute(true), baseline: () => compute(false), get show() { return show; }, planText, csvToShow, linesToShow, normTime, render, setNow, nowByDraw, toggleScratch };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
