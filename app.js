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
    if (/\ba1\b|table a1|not against the clock|clear round/.test(s)) return FORMATS[5];
    if (/speed|against the clock|238\.2\.1|table c|\b263\b|a2\.1|\ba2\b|table a2/.test(s)) return FORMATS[0];
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

  function saveShow() { if (!show) return; if (show.cloud) store(ukey("cloud"), show); else libPut(show); }
  function saveSettings() { store("rt.settings", S); }
  // Each show has its own rider list: own shows keep it inside the show (saved with it);
  // live shows you follow keep it in your account under that live show's id.
  let liveStars = {};
  function bindStars() {
    if (!show) { stars = { riders: [], horses: [] }; return; }
    if (show.cloud) { const id = show.cloud.id; liveStars[id] = liveStars[id] || { riders: [], horses: [] }; stars = liveStars[id]; }
    else { show.riders = show.riders && Array.isArray(show.riders.riders) ? show.riders : { riders: [], horses: [] }; if (!Array.isArray(show.riders.horses)) show.riders.horses = []; stars = show.riders; }
  }
  // Older versions had one rider list for everything: copy it into every saved show that has no list yet.
  function migrateGlobalStars(g) {
    const list = { riders: (g.riders || []).slice(), horses: (g.horses || []).slice() };
    libIndex().filter((x) => !x.deleted).forEach((x) => {
      const data = load(ukey("lib." + x.id)); if (!data) return;
      if (data.riders && ((data.riders.riders || []).length || (data.riders.horses || []).length)) return;
      data.riders = clone(list); data.updatedAt = Date.now(); store(ukey("lib." + x.id), data);
      saveIndex(libIndex().map((y) => y.id === x.id ? Object.assign({}, y, { dirty: true, updatedAt: data.updatedAt, riders: list.riders.length + list.horses.length }) : y));
      if (show && !show.cloud && show.libId === x.id) show.riders = clone(list);
    });
    forget(ukey("stars")); store(ukey("starsDirty"), true); libSyncSoon();
  }
  function saveStars() {
    if (!show) return;
    if (show.cloud) { store(ukey("liveStars"), liveStars); store(ukey("starsAt"), Date.now()); store(ukey("starsDirty"), true); libSyncSoon(); }
    else saveShow();
  }

  function blankLive() { return { startedAt: null, finishedAt: null, nowId: null, nowAt: null, marks: [] }; }
  function makeClass(o) {
    return Object.assign({ id: uid(), arena: "Arena 1", no: "", name: "", height: "", format: FORMATS[5], start: "", end: "", day: "", sameCourse: false, combined: false, expected: 0, entries: [], flags: [], live: blankLive() }, o || {});
  }
  function makeEntry(o) { return Object.assign({ id: uid(), draw: "", rider: "", horse: "", time: "", status: "starting", flags: [] }, o || {}); }

  function normalizeShow(sh) {
    sh = sh || {};
    sh.name = sh.name || "My show";
    sh.date = sh.date || (sh.classes || []).map((c) => c.day).filter(Boolean).sort()[0] || saNow().date;
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
  // Shows over more than one day: each class can carry its own day (YYYY-MM-DD).
  function dayOf(c) { return (c && c.day) || (show && show.date) || ""; }
  function dayOffset(c) {
    const d = dayOf(c), b = show && show.date;
    if (!d || !b || d === b) return 0;
    return Math.round((Date.parse(d + "T12:00:00Z") - Date.parse(b + "T12:00:00Z")) / 86400000) || 0;
  }
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function dayLabel(d) { const t = Date.parse(d + "T12:00:00Z"); if (!t) return d; const x = new Date(t); return DAYS[x.getUTCDay()] + " " + x.getUTCDate() + " " + MON[x.getUTCMonth()]; }
  // When classes run on several days, keep each day's arena separate ("Main Arena · Sat 15 Aug") so the timing
  // never runs Saturday's classes into Sunday's.
  function splitDays(classes) {
    const days = [...new Set(classes.map((c) => c.day).filter(Boolean))].sort();
    if (days.length < 2) return days[0] || "";
    classes.forEach((c) => { if (!c.day) c.day = days[0]; if (!c.arena.includes(" · ")) c.arena = c.arena + " · " + dayLabel(c.day); });
    return days[0];
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
      const cb = norm(get(r, "combined")); if (cb && /^(y|yes|true|1)$/.test(cb)) cur.combined = true;
      const ex = parseInt(get(r, "expected_entries"), 10); if (ex > 0 && !cur.expected) cur.expected = ex;
      const et = normTime(get(r, "end_time")); if (et && et !== "follow" && !cur.end) cur.end = et;
      const dy = get(r, "day"); if (/^\d{4}-\d{2}-\d{2}$/.test(dy) && !cur.day) cur.day = dy;
      const rider = get(r, "rider"), horse = get(r, "horse"), draw = get(r, "draw");
      if (rider || horse || draw) {
        const stt = norm(get(r, "status"));
        const e = makeEntry({ draw, rider, horse, status: /scratch|withdraw|^w\/?d$/.test(stt) ? "scratched" : /done|jumped/.test(stt) ? "done" : "starting" });
        const tt = normTime(get(r, "entry_time")); if (tt && tt !== "follow") e.time = tt;
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
    splitDays(classes);
    const seen = {}, nos = {};
    classes.forEach((c) => { const k = c.arena + "|" + norm(c.no); if (c.no) nos[k] = (nos[k] || 0) + 1; });
    classes.forEach((c) => { if (c.no && nos[c.arena + "|" + norm(c.no)] > 1) c.flags.push("Class number " + c.no + " appears more than once in " + c.arena + " — check the timetable"); });
    classes.forEach((c) => {
      const first = !seen[c.arena]; seen[c.arena] = true;
      const t0 = c.entries.map((e) => e.time).filter(Boolean).sort()[0];
      if (first && t0 && (!c.start || c.start === "follow")) c.start = t0;
      if (!c.start) {
        if (first) { c.flags.push("First class in this arena has no start time (using " + S.dayStart + ")"); c.combined = false; }
        else { c.start = "follow"; }
      }
      if (c.start === "follow" && first) c.flags.push('First class in the arena is "to follow" — please add a start time');
      if (!c.entries.length && c.expected) c.flags.push("Running order not loaded yet — times use the " + c.expected + " entries in the timetable. Add the starting list when it's published.");
      else if (!c.entries.length) c.flags.push("No running order found for this class");
      if (!c.height && !RE_OTHERTYPE.test(c.name) && !/dressage|equitation|showing/i.test(c.arena)) c.flags.push("No height found");
    });
  }

  function showToCSV(withExtras) {
    const cols = CSV_COLS.concat(withExtras ? ["status", "same_course", "expected_entries", "combined", "end_time", "day", "entry_time"] : []);
    const lines = [cols.join(",")];
    show.classes.forEach((c) => {
      const base = [c.arena, c.no, c.name, c.height, c.format];
      const list = c.entries.length ? c.entries : [null];
      list.forEach((e, i) => {
        const row = base.concat([i === 0 ? c.start : "", e ? e.draw : "", e ? e.rider : "", e ? e.horse : ""]);
        if (withExtras) row.push(e ? e.status : "", i === 0 && c.sameCourse ? "yes" : "", i === 0 && c.expected ? c.expected : "", i === 0 && c.combined ? "yes" : "", i === 0 ? c.end || "" : "", i === 0 ? c.day || "" : "", e ? e.time || "" : "");
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

  const RE_CLASS = /\bclass\s*(?:no\.?|number|nr\.?|#)?\s*[:.\-]?\s*(\d{1,3}(?:\.\d{1,2})?[a-z]?)\b/i;
  const RE_HEIGHT = /\b(\d[.,]\d{1,2})\s*m\b|\b(\d{2,3})\s*c[mn]\b/i;
  const RE_HEIGHTS = /(\d[.,]\d{1,2}\s*m|\d{2,3}\s*c[mn]\b|\b[12]\s*m\b|\bPOG\b)(\s*\/\s*(\d[.,]\d{1,2}\s*m?|\d{2,3}\s*(cm)?|\d\s*m))*/i;
  const RE_TIME = /\b([01]?\d|2[0-3])\s*[:hH]\s*([0-5]\d)(?!\d)|\b([01]?\d|2[0-3])\.([0-5]\d)(?!\s*m\b)(?!\d)/;
  const RE_TIME_RANGE = /\b([01]?\d|2[0-3])\s*[:hH.]\s*([0-5]\d)\s*(?:-|–|to)\s*([01]?\d|2[0-3])\s*[:hH.]\s*([0-5]\d)\b/;
  const RE_FOLLOW = /to follow|follows|followed|thereafter|\bafter class\b|\bfollow\b/i;
  const RE_ARENA = /\b(arena|ring)\s*[:\-]?\s*([a-z0-9][\w ]{0,20})/i;
  const RE_CLASSTYPE = /\b(a[12]\b|table [abc]|competition|phases?|speed|jump[\s-]?off|clear round|accumulator|two rounds|puissance|power|derby|equitation|eq\b|optimum|grand prix|handicap|h\/cap)/i;
  // dressage, showing and equitation classes (no height needed)
  const RE_OTHERTYPE = /\b(test|working hunter|working\b|utility|in hand|equitation|showing|hack|prelim|novice|elementary|walk\s*\/?\s*trot)/i;
  const RE_DAYLINE = /\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*,?\s+(20\d{2})\b/i;
  // headings that are never riders or horses
  const RE_HEADWORDS = /\b(continues?|arena ends|arena change|timetable|program(me)?|show ?jumping|dressage|showing|equitation|judge|scribe|secretary|recorders?|announcer|time ?keeper|please note|sponsored)\b|^pg\s*\d+$|^page\s*\d+/i;
  // lines on show information pages that are never riders or classes
  const RE_NOISE = /\b(bank|account|branch|swift|refund|entry fee|entries close|closing date|terms|conditions|catering|weather forecast|forecast from|enquir|e-?mail|www\.|https?:|@|levy|levies|rosette|prize money|dogs|liable|responsib|disclaimer|organisers reserve|office hours|powered by|classic view|tap to open|click on|deposit|vat\b|sasj|saef|fei rules|show holding body|course designer|speed \/ spread|loading)/i;
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  function findTime(s) {
    const m = s.match(RE_TIME);
    if (!m) return null;
    const h = +(m[1] != null ? m[1] : m[3]); const mi = +(m[2] != null ? m[2] : m[4]);
    if (m[3] != null && h < 6) return null; // "1.10" is a height, not a time
    const after = s.slice(s.indexOf(m[0]) + m[0].length);
    let hh = h; if (/^\s*p\.?m\b/i.test(after) && hh < 12) hh += 12; // "12:00 AM" on a show day is midday: leave it
    return pad(hh) + ":" + pad(mi);
  }
  function findTimeRange(s) {
    const m = s.match(RE_TIME_RANGE);
    return m ? { start: pad(+m[1]) + ":" + m[2], end: pad(+m[3]) + ":" + m[4] } : null;
  }
  function findHeight(s) {
    const m = s.match(RE_HEIGHTS);
    if (!m) return "";
    return m[0].replace(/,/g, ".").replace(/\s+/g, "").replace(/(\d)c[mn]/gi, "$1cm").replace(/(\d)M\b/g, "$1m").replace(/^pog$/i, "POG");
  }
  function findDate(s) {
    let m = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (m) return m[1] + "-" + m[2] + "-" + m[3];
    m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?[\s\-\/]+(?:of\s+)?([a-z]{3})[a-z]*[\s\-\/,]+(20\d{2})\b/i);
    if (m && MONTHS[m[2].toLowerCase()]) return m[3] + "-" + pad(MONTHS[m[2].toLowerCase()]) + "-" + pad(+m[1]);
    return null;
  }
  const BADGE = /^(stallion|scr|vet|w\/?d|hc|h\/c|nc|rsa|zaf)$/i;
  // Names are mostly Capitalised words; sentences from terms and conditions are not.
  const PARTICLES = /^(du|de|der|den|van|von|le|la|da|di|del|dos|in|of|the|and|on|o'|van't|ter|ten|y|a|my|i'm)$/i;
  function lev(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 9;
    const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) { let prev = dp[0]; dp[0] = i; for (let j = 1; j <= b.length; j++) { const t = dp[j]; dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; } }
    return dp[b.length];
  }
  function looksLikeName(s) {
    if (!s || s.length < 2 || s.length > 45 || /\d/.test(s) || /[:@=;]/.test(s) || !/[a-z]/i.test(s)) return false;
    const words = s.trim().split(/\s+/);
    if (words.length > 6) return false;
    const lower = words.filter((w) => /^[a-z]/.test(w) && !PARTICLES.test(w));
    return lower.length === 0 || (words.length >= 3 && lower.length === 1 && lower[0].length <= 3);
  }

  function linesToShow(lines, filename) {
    const classes = []; let arena = "Arena 1"; let cur = null; let cols = null;
    let showName = "", showDate = "", docComp = "";
    let pendPair = null, pendDraw = null, pendStatus = "starting";
    let curDay = "", arenaStart = null, pend = null;
    const setArena = (raw) => {
      arena = raw.replace(/\s+/g, " ").trim().replace(/^[:\-–\s]+|[:\-–\s]+$/g, "");
      if (arena === arena.toUpperCase()) arena = arena.toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase()); // "MAIN ARENA" → "Main Arena"
      arena = arena.charAt(0).toUpperCase() + arena.slice(1);
      // typos between pages ("Flying Tyger Arena" / "Flying Tiger Arena") are the same arena
      const same = [...new Set(classes.map((c) => c.arena))].find((n) => n !== arena && n.length > 8 && lev(norm(n), norm(arena)) <= 2);
      if (same) arena = same;
      arenaStart = null;
    };
    const addEntry = (draw, rider, horse, status, flagged) => {
      const e = makeEntry({ draw: String(draw), rider: rider || "", horse: horse || "", status: status || "starting" });
      if (flagged || !rider || !horse) e.flags.push("Could not split rider and horse — please check");
      cur.entries.push(e);
    };
    const newClass = (o) => { cur = makeClass(Object.assign({ arena, day: curDay }, o)); cur._comp = docComp; cur._arenaStart = arenaStart; arenaStart = null; classes.push(cur); cols = null; pendPair = null; pendDraw = null; pend = null; return cur; };
    // a running-order line split into its parts: draw, printed time, and the name cells
    const TESTWORDS = /^(?:(?:elim|elem)[ei]ntary|novice|prelim(?:inary)?|welcome|intro(?:ductory)?|walk\s*\/?\s*trot(?:\s*\/?\s*canter)?\s*\/?|canter)?\s*(?:test\s*\d+(?:\s+20\d\d)?)?\s*/i;
    const splitRow = (cs) => {
      let d = null, tm = null, i0 = 0;
      if (/^\d{1,3}[.)]?$/.test(cs[0] || "")) { d = cs[0].replace(/[.)]/, ""); i0 = 1; }
      const names = [];
      cs.slice(i0).forEach((x) => {
        const z = x.replace(/\s+/g, "");
        if (!tm && /^\d{1,2}[:h]\d{2}(am|pm)?$/i.test(z)) { tm = findTime(z); return; }
        if (cols && cols.test) x = x.replace(TESTWORDS, "").trim();
        x = x.replace(/^(\d{2,3}\s*c[mn]|\d[.,]\d{1,2}\s*m|[12]\s*m|pog)(?![a-z])\s*/i, "").replace(/\s*(\d{2,3}\s*c[mn]|\d[.,]\d{1,2}\s*m)$/i, "").trim();
        if (!x || !/[a-z]/i.test(x.replace(/\b(cm|cn|m|pog)\b/gi, "")) || /^(training|intro(ductory)?|level\s*\d*|adult|junior|pony|score|place)$/i.test(x)) return;
        names.push(x);
      });
      return { d, tm, names };
    };
    const addPair = (d, tm, a, b, status, flagged) => {
      const rider = cols && cols.horseFirst ? b : a, horse = cols && cols.horseFirst ? a : b;
      addEntry(d, rider, horse, status, flagged);
      if (tm) cur.entries[cur.entries.length - 1].time = tm;
    };
    for (const raw of lines) {
      const line = String(raw || "").trim();
      if (!line) continue;
      if (line === "=== NEXT DOCUMENT ===") { cur = null; cols = null; pendPair = pendDraw = null; docComp = ""; continue; }
      const flat = line.replace(/\t/g, " ");
      let cells = line.split("\t").map((c) => c.trim()).filter(Boolean);
      // day headings ("SUNDAY 16 AUGUST 2026"): classes below run on that day
      const dl = flat.length < 80 && flat.match(RE_DAYLINE);
      if (dl) { const d = findDate(dl[0].replace(/^[a-z]+\.?,?\s+/i, "")); if (d) { curDay = d; if (!showDate) showDate = d; cur = null; cols = null; pend = null; continue; } }
      if (/^p(?:g|age)\.?\s*\d+$/i.test(flat)) { pend = null; continue; }
      // show name and date (before the first class of a document)
      if (!showDate) { const d = findDate(flat); if (d && flat.length < 60) showDate = d; }
      const kv = flat.match(/^(competition|show|event|arena|date|class|grade|height|type|rule)\s*:\s*(.+)$/i);
      if (kv && /competition|show|event/i.test(kv[1])) { docComp = kv[2].trim(); if (!showName) showName = docComp; if (cur && !cur.entries.length) cur._comp = docComp; continue; }
      if (!cur && !showName && /\b(show|series|league|championships?|classic|festival)\b/i.test(flat) && !/show\s*jump|showjumping|\bshowing\b/i.test(flat) && flat.length <= 70 && !RE_NOISE.test(flat) && !RE_CLASS.test(flat)) { showName = flat.trim(); continue; }
      if (RE_NOISE.test(flat) || /=/.test(flat)) continue;
      if (/\b\d+\s*yr\b/i.test(flat) || /^(gelding|mare|stallion|colt|filly)\b/i.test(flat)) continue; // breeding line under the horse
      if (kv && /^arena$/i.test(kv[1])) { setArena(kv[2]); if (cur && !cur.entries.length) cur.arena = arena; continue; }
      if (kv && /^date$/i.test(kv[1])) { const d = findDate(kv[2]); if (d) showDate = showDate || d; continue; }
      if (kv && /^(grade|height|type|rule)$/i.test(kv[1])) {
        if (cur && !cur.entries.length) {
          if (/height|grade/i.test(kv[1]) && !cur.height) cur.height = findHeight(kv[2]);
          if (!cur._fmt) { const f = normalizeFormat(kv[2]); if (f) { cur.format = f; cur._fmt = true; } }
        }
        continue;
      }
      // Arena heading
      const cm = flat.match(RE_CLASS);
      if (!cm && /\barena\s+(change|ends)|\d+\s*x\s*\d+|arena\s+ends/i.test(flat)) continue; // "ARENA CHANGES TO 20 X 40", "ARENA ENDS"
      // arena start lines: "START 8:00AM", "08:00AM START", "Start APP. 11:30AM", "TO START AFTER WORKING HUNTER"
      if (!cm && flat.length < 80 && /\bstart(ing)?\b/i.test(flat) && !/\bclass\b.*\b(level|entries|height)\b|\bentries\b/i.test(flat)) {
        const t = findTime(flat);
        if (t) { arenaStart = t; continue; }
        if (RE_FOLLOW.test(flat) || /start\s+after/i.test(flat)) { arenaStart = "follow"; continue; }
      }
      if (!cm && /\bclass\b/i.test(flat) && /\b(entries|level)\b/i.test(flat)) { cols = null; continue; } // timetable heading row
      if (!cm && flat.length <= 40 && /\b(arena|ring)\b/i.test(flat) && !/^\d/.test(cells[0] || "") && !findTime(flat)) {
        setArena(/^arena\s*:/i.test(flat) ? flat.replace(/^arena\s*:\s*/i, "") : flat);
        continue;
      }
      // a timetable row that starts with its time: "08:00am | 6 | 2 | 60CM – COMPETITION | 11"
      let rowTime = null;
      if (!cm && !cols && cells.length >= 3 && /^\d{1,2}\s*[:h.]\s*\d{2}\s*(am|pm)?$/i.test(cells[0]) && /^\d{1,3}(\.\d{1,2})?[a-z]?$/i.test(cells[1])) { rowTime = findTime(cells[0]); cells = cells.slice(1); }
      // Timetable row without the word "Class": "1.2 | A2 Competition | 1.30m J/AD | 3 | 8h00 - 8h10"
      // (the class number is often printed right up against the class type: "1.2 A2 Competition")
      const lead = (cells[0] || "").match(/^(\d{1,3}(?:\.\d{1,2})?[a-z]?)\s+(\D.*)$/i);
      if (!cm && lead && RE_CLASSTYPE.test(lead[2]) && RE_HEIGHTS.test(flat)) cells = [lead[1], lead[2]].concat(cells.slice(1));
      if (!cm && /^\d{1,3}(\.\d{1,2})?[a-z]?$/i.test(cells[0] || "") && cells.length >= 3 && RE_HEIGHTS.test(flat) && RE_CLASSTYPE.test(flat)) {
        const c = newClass({ no: cells[0] });
        const typeCell = cells.slice(1).find((x) => RE_CLASSTYPE.test(x) && !RE_HEIGHTS.test(x)) || "";
        const hCell = cells.slice(1).find((x) => RE_HEIGHTS.test(x)) || "";
        c.height = findHeight(hCell);
        const extra = hCell.replace(RE_HEIGHTS, "").replace(/\s+/g, " ").trim();
        c.name = (typeCell + (extra ? " " + extra : "")).replace(/^[\s:\-–|.,]+|[\s:\-–|.,]+$/g, "").replace(/\s+[-–]\s*$/, "").trim().slice(0, 80);
        const f = normalizeFormat(typeCell || hCell); if (f) { c.format = f; c._fmt = true; } else if (RE_OTHERTYPE.test(flat) || /\beq\b|\bclear round\b|^\W*competition\W*$/i.test(c.name)) c._fmt = true;
        const hIdx = cells.indexOf(hCell);
        const cnt = cells.slice(hIdx + 1).find((x) => /^\d{1,3}$/.test(x));
        if (cnt) c.expected = +cnt;
        const tr = findTimeRange(flat);
        if (tr) { c.start = tr.start; c.end = tr.end; }
        else { const t = rowTime || findTime(cells.slice(hIdx + 1).join(" ")); if (t) c.start = t; else { c.combined = true; c._noTime = true; } }
        continue;
      }
      // Dressage / showing / equitation timetable row: "21 | 1 | Novice test 2 | 6", "43 | 3 | Working Hunter | 2"
      if (!cm && !cols && /^\d{1,3}[a-z]?$/i.test(cells[0] || "") && cells.length >= 3 && RE_OTHERTYPE.test(flat) && !RE_NOISE.test(flat)) {
        const c = newClass({ no: cells[0] });
        const last = cells[cells.length - 1];
        if (/^\d{1,3}$/.test(last)) c.expected = +last;
        c.name = cells.slice(1, /^\d{1,3}$/.test(last) ? -1 : undefined).filter((x) => !/^(\d|training|intro(ductory)?)$/i.test(x)).join(" ").replace(/\s+/g, " ").slice(0, 80);
        c.height = findHeight(flat); c._fmt = true;
        if (rowTime) c.start = rowTime; else { c.combined = true; c._noTime = true; }
        continue;
      }
      // Class heading: "Class 3 - 1.10m A2 Competition  09:00"
      if (cm && !/^\d{1,3}$/.test(cells[0] || "")) {
        const am = flat.match(RE_ARENA);
        if (am && flat.indexOf(am[0]) > -1 && !/arena familiar/i.test(flat)) setArena(am[1] + " " + am[2].split(/\s{1,}/)[0]);
        const c = newClass({ no: cm[1] }); c._heading = true;
        c._also = (flat.slice(flat.indexOf(cm[0]) + cm[0].length).match(/^\s*((?:&|and|\/)\s*\d{1,3}[a-z]?\s*)+/i) || [""])[0].match(/\d{1,3}[a-z]?/gi) || [];
        const body = flat.replace(/^class\s*:\s*/i, "");
        let name = body.replace(cm[0], "").replace(RE_TIME_RANGE, "").replace(RE_TIME, "").replace(RE_HEIGHTS, "").replace(RE_FOLLOW, "")
          .replace(/^[\s:\-–|.,]+|[\s:\-–|.,]+$/g, "").replace(/\s{2,}/g, " ");
        c.name = name.replace(/^(?:(?:&|and|\/)\s*\d{1,3}[a-z]?\s*)+[-–:\s]*/i, "").slice(0, 80);
        c.height = findHeight(body);
        const tr = findTimeRange(body);
        if (tr) { c.start = tr.start; c.end = tr.end; } else { const t = findTime(body); if (t) c.start = t; else if (RE_FOLLOW.test(body)) c.start = "follow"; }
        const f = normalizeFormat(body); if (f) { c.format = f; c._fmt = true; } else if (RE_OTHERTYPE.test(body)) c._fmt = true;
        continue;
      }
      if (!cur) continue;
      if (RE_HEADWORDS.test(flat) && !/^\d/.test(cells[0] || "")) { pend = null; continue; }
      // Column heading row
      const lc = cells.map(norm);
      if (lc.some((c) => /rider|competitor|athlete/.test(c)) && lc.some((c) => /horse/.test(c))) {
        const rIdx = lc.map((c, i) => (/rider|competitor|athlete/.test(c) ? i : -1)).filter((i) => i >= 0);
        const twoRider = rIdx.length > 1 && rIdx[0] === 0; // "RIDER | LEVEL | HEIGHT | HORSE | RIDER": the first is really the draw number
        cols = { rider: twoRider ? rIdx[1] : rIdx[0], horse: lc.findIndex((c) => /horse/.test(c)), draw: twoRider ? 0 : lc.findIndex((c) => /^(draw|no\.?|nr|#|order|start|ro)$/.test(c)), test: lc.some((c) => /^test$/.test(c)), time: lc.some((c) => /^time$/.test(c)), twoRider };
        cols.horseFirst = cols.horse >= 0 && cols.horse < cols.rider;
        cols.smart = cols.twoRider || cols.horseFirst || cols.test || cols.time;
        continue;
      }
      if (/^(no|rider|horse|draw|score|place|time\s*&?\s*score)$/i.test(flat)) continue;
      // status badges (SCR = scratched, VET = vet failed) and other tags
      let status = "starting";
      if (cells.some((c) => /^(scr|vet|w\/?d)$/i.test(c)) || /\b(scratched|withdrawn)\b/i.test(flat)) status = "scratched";
      cells = cells.filter((c) => !BADGE.test(c));
      // Running orders whose columns need reading carefully (horse before rider, printed times, names that wrap
      // onto the next line, blank numbered rows for late entries)
      if (cols && cols.smart) {
        const { d, tm, names } = splitRow(cells);
        if (d != null) {
          pend = null;
          if (names.length >= 2) addPair(d, tm, names[0], names[names.length - 1], status);
          else pend = { d, tm, frag: names[0] || null, status };
          continue;
        }
        if (pend && names.length >= 1 && names.length <= 2) {
          const P = pend; pend = null;
          if (!P.frag) {
            if (names.length === 2) addPair(P.d, P.tm, names[0], names[1], P.status);
            else { addEntry(P.d, names[0], "", P.status, true); if (P.tm) cur.entries[cur.entries.length - 1].time = P.tm; }
          } else if (names.length === 1) addPair(P.d, P.tm, P.frag, names[0], P.status);
          else {
            // the first line held part of one name: join it to the value it belongs to
            const one = (x) => x.trim().split(/\s+/).length === 1;
            const riderSecond = cols.horseFirst; // the rider is the second name column
            let joinSecond;
            if (one(names[1]) && !one(names[0])) joinSecond = true;
            else if (one(names[0]) && !one(names[1])) joinSecond = false;
            else if (one(names[0])) joinSecond = riderSecond; // both one word: usually a rider's surname ("CECILIA" / "BEZUIDENHOUT")
            else joinSecond = !riderSecond;                   // both longer: usually a horse's prefix ("CHAMPION" / "MASTER VISION")
            if (joinSecond) addPair(P.d, P.tm, names[0], P.frag + " " + names[1], P.status);
            else addPair(P.d, P.tm, P.frag + " " + names[0], names[1], P.status);
          }
          continue;
        }
        if (cur.entries.length) continue;
      }
      // Entry row
      let draw = null, rider = "", horse = "", flagged = false;
      if (cols && cells.length >= 2) {
        const all = line.split("\t").map((c) => c.trim());
        const d = cols.draw >= 0 ? all[cols.draw] : all[0];
        if (/^\d{1,3}[.)]?$/.test(d || "")) { draw = d.replace(/[.)]/, ""); rider = all[cols.rider] || ""; horse = all[cols.horse] || ""; }
      }
      // SA Showjumping style: the draw number sits on its own line next to a "rider | horse" line
      if (draw == null && cells.length === 1 && /^\d{1,3}$/.test(cells[0])) {
        if (pendPair) { addEntry(cells[0], pendPair[0], pendPair[1], pendStatus); pendPair = null; pendStatus = "starting"; }
        else pendDraw = cells[0];
        continue;
      }
      if (draw == null && cells.length >= 2 && !/^\d/.test(cells[0]) && looksLikeName(cells[0]) && looksLikeName(cells[cells.length - 1]) && cells.length <= 3) {
        if (pendDraw) { addEntry(pendDraw, cells[0], cells[cells.length - 1], status); pendDraw = null; }
        else { pendPair = [cells[0], cells[cells.length - 1]]; pendStatus = status; }
        continue;
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
          if (parts.length >= 2 && looksLikeName(parts[0].trim())) { rider = parts[0].trim(); horse = parts.slice(1).join(" ").trim(); }
          else if (looksLikeName(m.trim())) { rider = m.trim(); flagged = true; }
          else draw = null;
        }
      }
      if (draw != null && (rider || horse) && (looksLikeName(rider) || looksLikeName(horse))) {
        addEntry(draw, rider, horse, status, flagged);
        continue;
      }
      // Extra class details before the running order starts
      if (!cur.entries.length) {
        if (!cur.start) { const tr = findTimeRange(flat); if (tr) { cur.start = tr.start; cur.end = tr.end; cur.combined = false; } else { const t = findTime(flat); if (t) cur.start = t; else if (RE_FOLLOW.test(flat)) cur.start = "follow"; } }
        if (!cur.height) cur.height = findHeight(flat);
        if (!cur._fmt) { const f = normalizeFormat(flat); if (f) { cur.format = f; cur._fmt = true; } }
        if (!cur.name && flat.length < 60 && !/^\d/.test(flat)) cur.name = flat;
      }
    }
    // Merged timetable cells: the time is printed on the middle row of the group (e.g. 9 / 10.2 12h45–13h15 / 23).
    // Give it to the first row of the group and mark the others as running straight on.
    const byArena = {};
    classes.forEach((c, i) => { (byArena[c.arena + "|" + c.day] = byArena[c.arena + "|" + c.day] || []).push(i); });
    Object.values(byArena).forEach((idx) => {
      const rows = idx.map((i) => classes[i]);
      // "START 8:00AM" above the arena's classes
      rows.forEach((c) => { if ((!c.start || c._noTime) && c._arenaStart && !c.end && !c._heading) { c.start = c._arenaStart; c.combined = false; delete c._noTime; } });
      // No time windows anywhere in this arena: classes without a time simply follow on (with changeovers)
      if (!rows.some((c) => c.end)) { rows.forEach((c) => { if (c._noTime) { delete c._noTime; c.combined = false; c.start = c.start || "follow"; } }); return; }
      const timed = rows.map((c, k) => (c.start && c.start !== "follow" && !c._noTime ? k : -1)).filter((k) => k >= 0);
      const taken = new Set();
      timed.forEach((k) => {
        let before = 0, after = 0;
        for (let j = k - 1; j >= 0 && rows[j]._noTime && !taken.has(j); j--) before++;
        for (let j = k + 1; j < rows.length && rows[j]._noTime && !taken.has(j); j++) after++;
        const span = Math.min(before, after);
        if (!span) return;
        const first = rows[k - span];
        first.start = rows[k].start; first.end = rows[k].end; first.combined = false; delete first._noTime; taken.add(k - span);
        rows[k].start = ""; rows[k].end = ""; rows[k].combined = true; rows[k]._grouped = true;
        for (let j = k - span + 1; j <= k + span; j++) { taken.add(j); if (rows[j] !== first) { rows[j].combined = true; rows[j]._grouped = true; delete rows[j]._noTime; } }
      });
    });
    // A starting list for a class that's already in the timetable: put its riders into that class
    const merged = [];
    classes.forEach((c) => {
      const sameDay = (m) => !m.day || !c.day || m.day === c.day;
      const twin = merged.find((m) => norm(m.no) === norm(c.no) && sameDay(m) && !m.entries.length && c.entries.length && !m._merged);
      if (twin) {
        twin.entries = c.entries; twin._merged = true; twin._also = c._also;
        if (!twin.height && c.height) twin.height = c.height;
        if (c._comp && showName && norm(c._comp) !== norm(showName)) twin.flags.push("Running order says it's from “" + c._comp + "” — check it belongs to this show");
        return;
      }
      // a repeated class heading with no riders under it (page layout), when that class is already there
      if (c._heading && !c.entries.length && merged.some((m) => norm(m.no) === norm(c.no) && sameDay(m))) return;
      merged.push(c);
    });
    // "Class 22 & 23" or "Class 18a & 19a" starting lists cover those timetable classes: drop their empty placeholders
    const absorbed = new Set();
    merged.forEach((c) => { if (c.entries.length) [c.no].concat(c._also || []).forEach((n) => { absorbed.add(c.arena + "|" + norm(n)); absorbed.add(c.arena + "|" + norm(n).replace(/[a-z]$/, "")); }); });
    for (let i = merged.length - 1; i >= 0; i--) { const c = merged[i]; if (!c.entries.length && !c._heading && absorbed.has(c.arena + "|" + norm(c.no)) && merged.some((m) => m !== c && m.entries.length && m.arena === c.arena && (m.no === c.no || (m._also || []).concat(m.no).some((n) => norm(n).replace(/[a-z]$/, "") === norm(c.no))))) merged.splice(i, 1); }
    // arenas where the running order prints each rider's time (dressage): keep the classes in time order
    [...new Set(merged.map((c) => c.arena))].forEach((a) => {
      const list = merged.filter((c) => c.arena === a);
      if (!list.some((c) => c.entries.some((e) => e.time))) return;
      let key = 0; const keyOf = new Map();
      list.forEach((c) => { const t = c.entries.map((e) => parseTime(e.time)).filter((x) => x != null); if (t.length) key = Math.min(...t); keyOf.set(c, key); });
      const sorted = list.slice().sort((x, y) => keyOf.get(x) - keyOf.get(y));
      const idx = merged.map((c, i) => (c.arena === a ? i : -1)).filter((i) => i >= 0);
      idx.forEach((i, k) => (merged[i] = sorted[k]));
    });
    merged.forEach((c) => {
      if (!c._fmt) c.flags.push("Class format not found — set to Other");
      if (c._noTime) c.flags.push("No time of its own — assumed to run straight on after the previous class (shared time slot?)");
      if (c._grouped) c.flags.push("Shares a time slot with the class before it in the timetable — runs straight on");
      if (c._comp && showName && norm(c._comp) !== norm(showName) && classes.length > 1) c.flags.push("This running order says it's from “" + c._comp + "”, not “" + showName + "” — check it belongs to this show");
      c.flags.push("Read automatically — check rider/horse order and times");
      delete c._fmt; delete c._noTime; delete c._comp; delete c._merged; delete c._grouped; delete c._heading; delete c._arenaStart; delete c._also;
    });
    if (!merged.length) throw new Error("We couldn't find any classes in that file. Try the AI reader, or fill in the CSV template.");
    finishImportFlags(merged);
    return normalizeShow({ name: showName || (filename || "Show").replace(/\.[^.]+$/, ""), date: showDate || undefined, classes: merged });
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
  async function readWithAI(fileOrFiles) {
    const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
    const file = files[0];
    if (!aiConfigured) throw Object.assign(new Error("AI reading is not set up yet."), { code: "not_configured" });
    const total = files.reduce((n, f) => n + f.size, 0);
    if (total > 5 * 1024 * 1024) throw Object.assign(new Error("Those files add up to more than 5 MB, which is too big for AI reading."), { code: "too_large" });
    const parts = [];
    let chars = 0;
    for (const f of files) {
      if (/\.pdf$/i.test(f.name) || f.type === "application/pdf") parts.push({ kind: "pdf", filename: f.name, data: await fileToBase64(f) });
      else { const text = (await extractExcelLines(await f.arrayBuffer())).join("\n"); chars += text.length; parts.push({ kind: "text", filename: f.name, text }); }
    }
    if (chars > 100000) throw Object.assign(new Error("Those spreadsheets have too much text for AI reading (over 100,000 characters)."), { code: "too_large" });
    const body = parts.length === 1 ? parts[0] : { kind: "multi", files: parts };
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
    return aiToShow(data.show, file.name.replace(/\.[^.]+$/, ""));
  }
  function aiToShow(d, filename) {
    if (!d || !Array.isArray(d.classes)) throw new Error("The AI reader returned something unexpected.");
    const classes = d.classes.map((c) => {
      const k = makeClass({
        arena: String(c.arena || "Arena 1").trim(), no: String(c.class_no || "").trim(), name: String(c.class_name || "").trim(),
        height: String(c.height || "").trim(), start: normTime(c.start_time) || "",
        format: normalizeFormat(c.format) || FORMATS[5], sameCourse: !!c.same_course,
        end: normTime(c.end_time) || "", expected: Math.max(0, parseInt(c.expected_entries, 10) || 0), combined: !!c.runs_with_previous,
        day: /^\d{4}-\d{2}-\d{2}$/.test(c.day || "") ? c.day : ""
      });
      k.flags = (c.uncertain || []).map(String);
      if (c.start_time && normTime(c.start_time) === null) k.flags.push('Start time "' + c.start_time + '" not understood');
      k.entries = (c.entries || []).map((e) => {
        const x = makeEntry({ draw: String(e.draw == null ? "" : e.draw), rider: String(e.rider || ""), horse: String(e.horse || ""), status: ["starting", "scratched", "done"].includes(e.status) ? e.status : "starting" });
        const tt = normTime(e.time); if (tt && tt !== "follow") x.time = tt;
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
    const TS = T();
    if (format === FORMATS[0]) return +TS.sprSpeed;
    if (format === FORMATS[1]) return +TS.sprTwoPhase;
    return +TS.sprNormal;
  }
  function actualAvg(c, starters) {
    const TS = T();
    const lv = c.live; const minN = Math.max(2, +TS.avgAfter || 3);
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
    const TS = T();
    const now = saNow();
    const out = { cls: {}, ent: {}, arenas: {} };
    const prize = TS.prizeMin * 60, walkS = TS.walkMin * 60, reb = TS.changeRebuiltMin * 60, same = TS.changeSameMin * 60;
    show.arenas.forEach((a) => {
      const list = show.classes.filter((c) => c.arena === a.name);
      const aDay = dayOf(list[0]); const today = !aDay || aDay === now.date;
      // printed rider times across the arena (dressage): the usual gap between riders, for classes with only one rider
      const aGaps = []; list.forEach((c) => { const ts = c.entries.filter((e) => e.status !== "scratched").map((e) => parseTime(e.time)); ts.forEach((t, i) => { if (i && t != null && ts[i - 1] != null && t > ts[i - 1]) aGaps.push(t - ts[i - 1]); }); });
      aGaps.sort((x, y) => x - y); const arenaFixedSpr = aGaps.length ? aGaps[Math.floor(aGaps.length / 2)] : null;
      const L = parseTime(a.lunchStart); const D = (+a.lunchMin || 0) * 60;
      let lunchTaken = false; let prevEnd = null;
      // The organiser's plan: a class with a time window (e.g. 8h00–8h10), plus any classes that run on in the
      // same slot, gives the planned time per horse. The gap to the next class's start is the planned changeover.
      const plan = {}; let group = null;
      list.forEach((c) => {
        const st = parseTime(c.start), en = parseTime(c.end);
        if (!c.combined || !group) { group = { start: st, end: en != null && st != null && en > st ? en : null, count: 0, members: [] }; }
        group.members.push(c.id); group.count += c.entries.filter((e) => e.status !== "scratched").length || (+c.expected || 0);
        plan[c.id] = group;
      });
      let prevGroup = null;
      // classes before the last class with live data are treated as finished
      let lastLive = -1;
      if (useLive) list.forEach((c, i) => { if (hasLive(c)) lastLive = i; });
      list.forEach((c, ci) => {
        const lv = useLive ? c.live : blankLive();
        const starters = c.entries.filter((e) => e.status !== "scratched");
        // no running order yet: use the number of entries from the timetable
        const placeholder = !c.entries.length && (+c.expected || 0) > 0;
        const N = placeholder ? +c.expected : starters.length;
        const avg = useLive ? actualAvg(c, starters) : null;
        const g = plan[c.id];
        const planSpr = g.end != null && g.count > 0 ? Math.min(400, Math.max(40, (g.end - g.start) / g.count)) : null;
        const fixedT = starters.map((e) => parseTime(e.time));
        const gaps = fixedT.map((t, i) => (i && t != null && fixedT[i - 1] != null ? t - fixedT[i - 1] : null)).filter((g) => g != null && g > 0).sort((x, y) => x - y);
        const fixedSpr = gaps.length ? Math.min(900, Math.max(40, gaps[Math.floor(gaps.length / 2)])) : fixedT.some((t) => t != null) && arenaFixedSpr ? Math.min(900, Math.max(40, arenaFixedSpr)) : null; // e.g. dressage: one rider every 7 min
        const spr = avg ? avg.spr : planSpr || fixedSpr || defaultSpr(c.format);
        const sched = parseTime(c.start);
        let cand, lunch = null;
        const fixedFirst = fixedT.find((t) => t != null);
        if (fixedFirst != null && sched == null) cand = prevEnd == null ? fixedFirst : Math.max(fixedFirst, prevEnd); // printed rider times (dressage): no changeover allowance
        else if (prevEnd == null) cand = sched != null ? sched : parseTime(TS.dayStart) || 8 * 3600;
        else if (c.combined) cand = prevEnd; // shares a time slot: runs straight on, no prize-giving or course change in between
        else if (sched != null && prevGroup && prevGroup.end != null && sched >= prevGroup.end) cand = prevEnd + (sched - prevGroup.end); // the organiser's own changeover time
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
        let lastT = null, cursor = null;
        const markAt = {}; (lv.marks || []).forEach((m) => (markAt[m.id] = m.t));
        c.entries.forEach((e) => {
          if (e.status === "scratched") out.ent[e.id] = { t: null, state: "scratched", cls: c.id };
        });
        starters.forEach((e, i) => {
          let t, state;
          if (nowIdx >= 0) {
            if (i < nowIdx) {
              t = markAt[e.id] != null ? markAt[e.id] : lv.startedAt != null && nowIdx > 0 ? lv.startedAt + i * (lv.nowAt - lv.startedAt) / nowIdx : start + i * spr;
              state = "done";
            } else if (i === nowIdx) { t = lv.nowAt; state = "now"; }
            else {
              let next = cursor != null ? cursor : lv.nowAt + spr;
              if (inProgress && today) next = Math.max(next, now.sec);
              t = fixedT[i] != null ? Math.max(next, fixedT[i]) : next; cursor = t + spr; state = "upcoming";
            }
          } else {
            // a time printed next to the rider (e.g. dressage) is the earliest they'll go
            const next = cursor != null ? cursor : start;
            t = fixedT[i] != null ? Math.max(next, fixedT[i]) : next; cursor = t + spr;
            state = e.status === "done" ? "done" : "upcoming";
          }
          if (finished) state = "done";
          out.ent[e.id] = { t, state, cls: c.id, actual: markAt[e.id] != null && (state === "done" || state === "now") };
          lastT = t;
        });
        const firstEnd = starters.length ? lastT + spr : start + N * spr;
        let end = firstEnd, extra = null;
        // (when the time comes from the organiser's window, jump-offs and second rounds are already included in it)
        if (c.format === FORMATS[2] && !(planSpr && !avg)) { const n = Math.round(N * TS.joPct / 100); extra = { label: "Jump-off", n, start: firstEnd }; end = firstEnd + n * TS.joSec; }
        else if (c.format === FORMATS[3] && !(planSpr && !avg)) { const n = Math.ceil(N * TS.r2Pct / 100); extra = { label: "Round 2", n, start: firstEnd }; end = firstEnd + n * spr; }
        if (lv.finishedAt != null) end = lv.finishedAt;
        else if (finished) end = Math.max(end, start);
        out.cls[c.id] = { start, planned, end, sched, late: sched != null ? start - sched : null, spr, avg, sprDefault: defaultSpr(c.format), startSrc, finished, inProgress, extra, lunch, N, nowIdx, placeholder, schedEnd: parseTime(c.end), planSpr, fixedSpr: !avg && !planSpr ? fixedSpr : null };
        prevEnd = end; prevGroup = g;
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
    const TS = T();
    const by = {};
    show.classes.forEach((c) => c.entries.forEach((e) => {
      const r = R.ent[e.id];
      if (!r || r.state === "scratched" || r.state === "done" || !e.rider) return;
      (by[norm(e.rider)] = by[norm(e.rider)] || []).push({ e, c, t: r.t, k: r.t + dayOffset(c) * 86400 });
    }));
    const pairs = []; const ids = new Set();
    Object.values(by).forEach((arr) => {
      arr.sort((x, y) => x.k - y.k);
      for (let i = 1; i < arr.length; i++) {
        if (arr[i].k - arr[i - 1].k < TS.clashMin * 60) { pairs.push([arr[i - 1], arr[i]]); ids.add(arr[i - 1].e.id); ids.add(arr[i].e.id); }
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
    ui.undo = null; saveShow(); if (c) cloudTouch(c); hideBanner(); render();
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
    saveShow(); cloudTouch(c); render();
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
    saveShow(); cloudTouch(c); render();
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
    show = null;
    // older versions kept a single show: move it into the saved-shows library
    const legacy = load(ukey("show")) || load("rt.show");
    if (legacy) { try { const sh = normalizeShow(legacy); libPut(sh); } catch (e) { /* ignore */ } forget(ukey("show")); forget("rt.show"); }
    liveStars = load(ukey("liveStars")) || {};
    const oldGlobal = load(ukey("stars")) || load("rt.stars");
    forget("rt.stars");
    const cur = load(ukey("current"));
    if (cur) libOpen(cur);
    if (oldGlobal) migrateGlobalStars(oldGlobal);
    // re-open the live show this person was following, if any
    const cached = load(ukey("cloud"));
    if (load(ukey("active")) === "cloud" && cached && cached.cloud) {
      try { show = normalizeShow(cached); pending = load(ukey("pending." + show.cloud.id)) || { classes: {}, status: {} }; } catch (e) { /* keep local show */ }
    }
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
    libSync();
    if (ui.deepShow) { openCloudShow(ui.deepShow); ui.deepShow = null; }
    else if (isCloud()) { startPolling(); pollCloud(true); flushPending(); }
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
      clearInterval(cloudUI.pollTimer); clearTimeout(lib.timer); pending = { classes: {}, status: {} }; cloudUI.list = null; cloudUI.isOrganiser = null; cloudUI.request = null;
      clearSession(); show = null; stars = { riders: [], horses: [] };
      if (t) authFetch("logout", null, "POST", t).catch(() => {});
      authMode("signin"); setView("auth");
    };
    $("#btnChangePw").onclick = () => { authMode("newpw"); setView("auth"); };
    if (CFG.CONTACT_EMAIL) { const a = $("#contactLink"); a.textContent = CFG.CONTACT_EMAIL; a.href = "mailto:" + CFG.CONTACT_EMAIL; $("#contactLine").hidden = false; }
  }

  // ===================================================================
  // My saved shows — kept in the user's account (and on this phone for offline use)
  // until the user deletes them. Starred riders/horses are saved the same way.
  // ===================================================================
  const lib = { timer: null, syncing: false, again: false, lastError: null, lastSync: null };
  function libIndex() { return load(ukey("lib")) || []; }
  function saveIndex(ix) { store(ukey("lib"), ix); }
  function libCounts(sh) { const r = sh.riders || {}; return { classes: (sh.classes || []).length, entries: (sh.classes || []).reduce((n, c) => n + (c.entries || []).length, 0), riders: (r.riders || []).length + (r.horses || []).length }; }
  // Save the open (own) show into the library and queue a sync.
  function libPut(sh) {
    if (!sh.libId) sh.libId = "s" + Date.now().toString(36) + uid();
    sh.updatedAt = Date.now();
    store(ukey("lib." + sh.libId), sh);
    const ix = libIndex().filter((x) => x.id !== sh.libId);
    const old = (load(ukey("lib")) || []).find((x) => x.id === sh.libId) || {};
    ix.unshift(Object.assign({}, libCounts(sh), { id: sh.libId, name: sh.name || "Show", date: sh.date || "", updatedAt: sh.updatedAt, dirty: true, synced: !!old.synced }));
    saveIndex(ix);
    store(ukey("current"), sh.libId);
    libSyncSoon();
  }
  function libOpen(id) {
    const sh = load(ukey("lib." + id));
    if (!sh) return false;
    try { show = normalizeShow(sh); show.libId = id; } catch (e) { return false; }
    store(ukey("current"), id); ui.open = {}; ui.arena = null;
    return true;
  }
  function libDelete(id) {
    forget(ukey("lib." + id));
    const ix = libIndex().map((x) => x.id === id ? { id, deleted: true, dirty: true, synced: x.synced } : x);
    saveIndex(ix.filter((x) => !(x.id === id && !x.synced)));   // never reached the server: just drop it
    if (load(ukey("current")) === id) forget(ukey("current"));
    if (show && !isCloud() && show.libId === id) show = null;
    libSyncSoon();
  }
  function libSyncSoon(ms) { clearTimeout(lib.timer); lib.timer = setTimeout(libSync, ms == null ? 3000 : ms); }
  async function libSync() {
    if (!session) return;
    if (lib.syncing) { lib.again = true; return; }
    lib.syncing = true; lib.again = false;
    try {
      // 0. "Delete all my data" that happened while offline
      if (load(ukey("wipe"))) {
        await api("user_shows?user_id=eq." + session.user.id, { method: "DELETE", headers: { Prefer: "return=minimal" } });
        await api("user_stars?user_id=eq." + session.user.id, { method: "DELETE", headers: { Prefer: "return=minimal" } });
        forget(ukey("wipe"));
      }
      let ix = libIndex();
      // 1. deletions
      for (const x of ix.filter((y) => y.deleted)) {
        await api("user_shows?id=eq." + encodeURIComponent(x.id), { method: "DELETE", headers: { Prefer: "return=minimal" } });
        ix = libIndex().filter((y) => y.id !== x.id); saveIndex(ix);
      }
      // 2. new or changed shows
      for (const x of libIndex().filter((y) => y.dirty && !y.deleted)) {
        const data = load(ukey("lib." + x.id)); if (!data) continue;
        await api("user_shows?on_conflict=id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: { id: x.id, name: (data.name || "Show").slice(0, 160), show_date: /^\d{4}-\d{2}-\d{2}$/.test(data.date || "") ? data.date : null, data, updated_at: new Date(data.updatedAt || Date.now()).toISOString() } });
        saveIndex(libIndex().map((y) => y.id === x.id && y.updatedAt === x.updatedAt ? Object.assign({}, y, { dirty: false, synced: true }) : y));
      }
      // 3. bring down shows saved from other devices (or newer versions of them)
      const rows = await api("user_shows?select=id,name,show_date,updated_at&order=updated_at.desc") || [];
      const serverIds = new Set(rows.map((r) => r.id));
      for (const r of rows) {
        const local = libIndex().find((y) => y.id === r.id);
        const serverAt = Date.parse(r.updated_at);
        if (local && (local.deleted || local.dirty || (local.updatedAt || 0) >= serverAt)) continue;
        const full = await api("user_shows?id=eq." + encodeURIComponent(r.id) + "&select=data");
        if (!full || !full[0]) continue;
        const data = full[0].data; data.libId = r.id; data.updatedAt = serverAt;
        store(ukey("lib." + r.id), data);
        const ix2 = libIndex().filter((y) => y.id !== r.id);
        ix2.push(Object.assign({}, libCounts(data), { id: r.id, name: r.name, date: r.show_date || "", updatedAt: serverAt, dirty: false, synced: true }));
        saveIndex(ix2);
        if (show && !isCloud() && show.libId === r.id && ui.view !== "review") { libOpen(r.id); }
      }
      // 4. shows deleted on another device
      const gone = libIndex().filter((y) => y.synced && !y.dirty && !y.deleted && !serverIds.has(y.id));
      gone.forEach((y) => { forget(ukey("lib." + y.id)); if (show && !isCloud() && show.libId === y.id) show = null; });
      if (gone.length) saveIndex(libIndex().filter((y) => !gone.some((g) => g.id === y.id)));
      // 5. starred riders and horses
      if (load(ukey("starsDirty"))) {
        await api("user_stars?on_conflict=user_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: { stars: { live: liveStars }, updated_at: new Date(load(ukey("starsAt")) || Date.now()).toISOString() } });
        forget(ukey("starsDirty"));
      } else {
        const st = await api("user_stars?select=stars,updated_at");
        if (st && st[0] && Date.parse(st[0].updated_at) > (load(ukey("starsAt")) || 0)) {
          const srv = st[0].stars || {};
          if (srv.live) { liveStars = srv.live; store(ukey("liveStars"), liveStars); bindStars(); }
          else if ((srv.riders || []).length || (srv.horses || []).length) migrateGlobalStars(srv); // list from the older one-list-for-everything version
          store(ukey("starsAt"), Date.parse(st[0].updated_at));
        }
      }
      lib.lastError = null; lib.lastSync = Date.now();
    } catch (e) {
      lib.lastError = e.code === "network" ? "offline" : e.message;
      if (/too_many_saved_shows/.test(e.message)) banner("You have 100 saved shows, the maximum. Delete some old ones to save more.", "err", [], 8000);
      libSyncSoon(60000);
    } finally {
      lib.syncing = false;
      if (lib.again) libSyncSoon(500);
      const typing = document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
      if (!typing && !$("#dlg").open && (ui.view === "load" || ui.view === "mine" || ui.view === "settings" || (ui.view === "arenas" && show))) render();
      else if (ui.view === "load") renderLoad();
    }
  }
  function libStatusText() {
    const waiting = libIndex().some((x) => x.dirty) || !!load(ukey("starsDirty"));
    if (lib.lastError === "offline" || (waiting && navigator.onLine === false)) return "Saved on this phone · will sync to your account when you're online";
    if (lib.lastError) return "Saved on this phone · couldn't sync just now (" + lib.lastError + ")";
    if (waiting) return "Saving to your account…";
    return "Saved in your account · available on any device you sign in to";
  }

  // ===================================================================
  // Deleting data from this phone
  // ===================================================================
  function forget(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } }
  async function deleteThisShow() {
    if (!show) return;
    if (isCloud()) {
      const owner = role() === "owner";
      const r = await dialog("Stop following and delete?", "<p>This deletes the copy of <strong>" + esc(show.name) + "</strong> on this phone.</p>" +
        (owner ? "<p>The <strong>published live show stays online</strong> for everyone. To take it down, use <em>Remove live show</em> on the Live tab.</p>" : "<p>The live show itself isn't affected. You can follow it again from the Live tab.</p>"),
        [{ label: "Cancel", value: "no" }, { label: "Delete from this phone", value: "yes", cls: "danger" }]);
      if (r.value !== "yes") return;
      leaveCloud(); setView(show ? "arenas" : "load");
      banner("Deleted from this phone.", "ok", [], 5000); return;
    }
    const r = await dialog("Delete this show?", "<p>This permanently deletes <strong>" + esc(show.name) + "</strong>, including your live updates, from your account and every device. It can't be undone.</p><p class=\"small muted\">Tip: download a backup first (Settings → Export) if you might need it again.</p>",
      [{ label: "Cancel", value: "no" }, { label: "Delete show", value: "yes", cls: "danger" }]);
    if (r.value !== "yes") return;
    libDelete(show.libId); show = null; ui.open = {}; ui.arena = null;
    setView("load"); banner("Show deleted from your account and this phone.", "ok", [], 5000);
  }
  async function deleteAllMyData() {
    const r = await dialog("Delete all your data on this phone?", "<p>This permanently deletes <strong>all your saved shows</strong> and your <strong>starred riders and horses</strong> from your account and every device, plus any live-show copies on this phone. You'll stay signed in, and your timing settings are kept.</p>" +
      "<p class=\"small muted\">This can't be undone. Live shows you've published stay online until you remove them on the Live tab (or they expire 7 days after the show).</p>",
      [{ label: "Cancel", value: "no" }, { label: "Delete everything", value: "yes", cls: "danger" }]);
    if (r.value !== "yes") return;
    clearInterval(cloudUI.pollTimer); clearTimeout(cloudUI.schedTimer); cloudUI.schedTimer = null;
    const uid = session && session.user && session.user.id;
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
      keys.forEach((k) => { if (k === "rt.show" || k === "rt.stars" || (uid && k.startsWith("rt.") && k.endsWith("." + uid)) || (uid && /^rt\.pending\./.test(k) && k.endsWith("." + uid))) forget(k); });
    } catch (e) { /* storage unavailable */ }
    store(ukey("wipe"), true);
    show = null; stars = { riders: [], horses: [] }; liveStars = {}; pending = { classes: {}, status: {} }; ui.open = {}; ui.arena = null;
    setView("load"); banner("All your saved shows and riders have been deleted.", "ok", [], 6000);
    libSync();
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
        rows.push({ c, e, t: r.t, k: r.t == null ? null : r.t + dayOffset(c) * 86400, state: r.state, clash: clashes.ids.has(e.id) });
      }
    }));
    rows.sort((a, b) => (a.k == null) - (b.k == null) || a.k - b.k);
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
  // Live shows (shared online): publish, view, marshal
  // Shows are stored in Supabase; phones check for marshal updates every ~15 s.
  // ===================================================================
  const POLL_MS = 15000;
  const TIMING_KEYS = ["sprNormal", "sprSpeed", "sprTwoPhase", "walkMin", "changeRebuiltMin", "changeSameMin", "prizeMin", "joPct", "joSec", "r2Pct", "dayStart", "avgAfter"];
  const cloudUI = { list: null, myMarshal: [], pollTimer: null, flushing: false, schedTimer: null, lastPoll: null, code: null };
  let pending = { classes: {}, status: {} };

  function isCloud() { return !!(show && show.cloud); }
  function role() { return isCloud() ? show.cloud.role : "local"; }
  function canEdit() { return !isCloud() || role() === "owner" || role() === "marshal"; }
  function pendingCount() { return Object.keys(pending.classes).length + Object.keys(pending.status).length; }
  function savePending() { if (isCloud()) store(ukey("pending." + show.cloud.id), pending); }
  // Effective timing settings: viewers and marshals use the publisher's settings so everyone sees the same estimates.
  function T() { return isCloud() && role() !== "owner" && show.cloudSettings ? Object.assign({}, S, show.cloudSettings) : S; }

  async function api(path, opts) {
    opts = opts || {};
    const t = await freshToken();
    if (!t) throw Object.assign(new Error("Please sign in again."), { code: "login_required" });
    const headers = Object.assign({ apikey: CFG.SUPABASE_ANON_KEY, Authorization: "Bearer " + t, "Content-Type": "application/json" }, opts.headers || {});
    let res;
    try { res = await fetch(CFG.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/" + path, { method: opts.method || "GET", headers, body: opts.body != null ? JSON.stringify(opts.body) : undefined }); }
    catch (e) { throw Object.assign(new Error("No connection right now."), { code: "network" }); }
    if (res.status === 204) return null;
    let data = null; try { data = await res.json(); } catch (e) { /* empty */ }
    if (!res.ok) {
      const m = (data && (data.message || data.hint)) || "";
      const msgs = {
        not_marshal: "You're not a marshal for this show. Enter the marshal code first.",
        not_owner: "Only the person who published this show can do that.",
        too_many_attempts: "Too many wrong codes. Please wait an hour and try again.",
        too_many_shows: "You've published a lot of shows today. Please try again tomorrow.",
        not_organiser: "Only approved show organisers can publish live shows. Use “Request organiser access” on the Live tab.",
        login_required: "Please sign in again."
      };
      throw Object.assign(new Error(msgs[m] || (m ? m : "Server error (" + res.status + ")")), { code: m || res.status, status: res.status });
    }
    return data;
  }
  const rpc = (fn, args) => api("rpc/" + fn, { method: "POST", body: args });

  function scheduleOf(sh) {
    const st = {}; TIMING_KEYS.forEach((k) => (st[k] = S[k]));
    return {
      name: sh.name, date: sh.date, settings: st,
      arenas: sh.arenas.map((a) => ({ name: a.name, lunchStart: a.lunchStart || "", lunchMin: +a.lunchMin || 0 })),
      classes: sh.classes.map((c) => ({
        id: c.id, arena: c.arena, no: c.no, name: c.name, height: c.height, format: c.format, start: c.start, sameCourse: !!c.sameCourse,
        entries: c.entries.map((e) => ({ id: e.id, draw: e.draw, rider: e.rider, horse: e.horse, status: e.status === "scratched" ? "scratched" : "starting" }))
      }))
    };
  }
  // Build the show we display from the server copy (schedule + live), then re-apply this phone's unsent changes.
  function buildCloudShow(row, roleName) {
    const sc = row.schedule || {};
    const sh = normalizeShow({ name: row.name || sc.name, date: row.show_date || sc.date || "", arenas: sc.arenas, classes: clone(sc.classes || []) });
    sh.cloudSettings = sc.settings || null;
    sh.cloud = { id: row.id, role: roleName, owner: row.owner, liveVersion: row.live_version || 0, scheduleVersion: row.schedule_version || 1, liveUpdatedAt: row.live_updated_at || null };
    applyLive(sh, row.live || {});
    return sh;
  }
  function applyLive(sh, live) {
    const lc = Object.assign({}, live.classes || {}, pending.classes);
    const ls = Object.assign({}, live.status || {}, pending.status);
    sh.classes.forEach((c) => {
      c.live = Object.assign(blankLive(), lc[c.id] || {});
      c.entries.forEach((e) => { if (ls[e.id]) e.status = ls[e.id]; });
    });
  }
  // Called after every live change on this phone (marshal or publisher).
  function cloudTouch(c) {
    if (!isCloud() || !canEdit() || !c) return;
    pending.classes[c.id] = clone(c.live);
    c.entries.forEach((e) => (pending.status[e.id] = e.status === "done" ? "starting" : e.status));
    savePending(); flushPending();
  }
  async function flushPending() {
    if (!isCloud() || cloudUI.flushing || !pendingCount()) { renderLiveStrip(); return; }
    cloudUI.flushing = true;
    const id = show.cloud.id;
    const batch = pending; pending = { classes: {}, status: {} };
    try {
      const ver = await rpc("rt_live_update", { p_show: id, p_patch: batch });
      if (isCloud() && show.cloud.id === id) { show.cloud.liveVersion = ver; show.cloud.liveUpdatedAt = new Date().toISOString(); }
    } catch (e) {
      // keep the changes and try again later (newer changes win)
      pending = { classes: Object.assign({}, batch.classes, pending.classes), status: Object.assign({}, batch.status, pending.status) };
      if (e.code === "not_marshal" || e.code === "not_owner") { pending = { classes: {}, status: {} }; if (isCloud()) { show.cloud.role = "viewer"; saveShow(); } banner(esc(e.message), "err", [], 8000); }
    } finally {
      cloudUI.flushing = false; savePending(); renderLiveStrip();
      if (pendingCount() && navigator.onLine !== false) setTimeout(flushPending, 5000);
    }
  }
  async function pollCloud(force) {
    if (!isCloud() || (document.visibilityState === "hidden" && !force)) return;
    const id = show.cloud.id;
    try {
      const rows = await api("shows?id=eq." + id + "&select=live_version,schedule_version,live_updated_at,published");
      if (!isCloud() || show.cloud.id !== id) return;
      if (!rows || !rows.length || (!rows[0].published && role() !== "owner")) {
        banner("This live show has been removed by its publisher.", "err", [], 8000); leaveCloud(); return;
      }
      const r = rows[0];
      cloudUI.lastPoll = Date.now();
      if (force || r.schedule_version !== show.cloud.scheduleVersion || r.live_version !== show.cloud.liveVersion) {
        const full = await api("shows?id=eq." + id + "&select=id,owner,name,show_date,schedule,schedule_version,live,live_version,live_updated_at");
        if (!full || !full.length || !isCloud() || show.cloud.id !== id) return;
        if (role() === "owner" && cloudUI.schedTimer) return; // publisher has unsaved schedule edits: don't overwrite them
        const keepOpen = ui.open, keepArena = ui.arena;
        show = buildCloudShow(full[0], role());
        ui.open = keepOpen; ui.arena = keepArena;
        saveShow();
        const typing = document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
        if (!typing && !$("#dlg").open && ui.view !== "review") render();
      }
    } catch (e) { /* offline or server busy: try again next time */ }
    renderLiveStrip();
  }
  function startPolling() {
    clearInterval(cloudUI.pollTimer);
    if (!isCloud()) return;
    cloudUI.pollTimer = setInterval(() => { pollCloud(false); flushPending(); }, POLL_MS);
  }
  // Publisher edits the schedule: send it a couple of seconds after they stop typing.
  function cloudScheduleChanged() {
    if (!isCloud() || role() !== "owner") return;
    clearTimeout(cloudUI.schedTimer);
    cloudUI.schedTimer = setTimeout(pushSchedule, 2500);
    renderLiveStrip();
  }
  async function pushSchedule() {
    if (!isCloud() || role() !== "owner") return;
    const id = show.cloud.id, v = show.cloud.scheduleVersion + 1;
    try {
      await api("shows?id=eq." + id, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: { name: show.name || "Show", show_date: /^\d{4}-\d{2}-\d{2}$/.test(show.date || "") ? show.date : null, schedule: scheduleOf(show), schedule_version: v, updated_at: new Date().toISOString() } });
      show.cloud.scheduleVersion = v; cloudUI.schedTimer = null; saveShow();
    } catch (e) { cloudUI.schedTimer = setTimeout(pushSchedule, 10000); }
    renderLiveStrip();
  }

  async function publishShow() {
    if (!show || isCloud()) return;
    const r = await dialog("Publish as a live show?",
      "<p>Everyone signed in to Ringside Timer will be able to see <strong>" + esc(show.name) + "</strong> and follow it live. You'll get a marshal code to give your arena marshals.</p>" +
      '<p class="small muted">Riders\' and horses\' names will be stored online and deleted automatically 7 days after the show date (' + esc(show.date || "today") + ").</p>" +
      '<label class="inline"><input type="checkbox" name="ok" value="yes">I confirm I\'m allowed to share this running order publicly (for example, it was published by the show organiser).</label>',
      [{ label: "Cancel", value: "no" }, { label: "Publish", value: "yes", cls: "primary" }]);
    if (r.value !== "yes") return;
    if (!$('#dlgBody input[name="ok"]') || r.vals.ok !== "yes") { banner("Please tick the box to confirm you may share this running order.", "err", [], 6000); return; }
    busy(true, "Publishing…");
    try {
      const res = await rpc("rt_publish_show", { p_name: show.name || "Show", p_date: /^\d{4}-\d{2}-\d{2}$/.test(show.date || "") ? show.date : null, p_schedule: scheduleOf(show) });
      const full = await api("shows?id=eq." + res.id + "&select=id,owner,name,show_date,schedule,schedule_version,live,live_version,live_updated_at");
      pending = { classes: {}, status: {} };
      show = buildCloudShow(full[0], "owner"); cloudUI.code = res.code;
      store(ukey("active"), "cloud"); saveShow(); startPolling();
      cloudUI.list = null; setView("live");
      showCodeDialog(res.code);
    } catch (e) { banner("Couldn't publish: " + esc(e.message), "err", [], 8000); }
    finally { busy(false); }
  }
  function shareLink() { return SITE_URL + "?show=" + encodeURIComponent(show.cloud.id); }
  async function showCodeDialog(code) {
    const msg = "You're an arena marshal for *" + show.name + "* on Ringside Timer.\n1. Open " + shareLink() + " and sign in (free account)\n2. Tap \"I'm a marshal\" and enter code: *" + code + "*\n3. Use the Marshal screen to record who's in the ring and scratchings.";
    const r = await dialog("Marshal code", '<p class="code-big">' + esc(code) + "</p><p>Give this code only to your arena marshals. Anyone with it can update the live times. You can change it later.</p>",
      [{ label: "Close", value: "x" }, { label: "Send to marshals on WhatsApp", value: "wa", cls: "primary" }]);
    if (r.value === "wa") window.open("https://wa.me/?text=" + encodeURIComponent(msg), "_blank", "noopener");
  }
  async function openCloudShow(id, quiet) {
    busy(true, "Opening live show…");
    try {
      const rows = await api("shows?id=eq." + encodeURIComponent(id) + "&select=id,owner,name,show_date,schedule,schedule_version,live,live_version,live_updated_at,published");
      if (!rows || !rows.length) throw new Error("This live show wasn't found. It may have been removed.");
      const row = rows[0];
      let rl = "viewer";
      if (row.owner === (session && session.user && session.user.id)) rl = "owner";
      else { const m = await api("show_marshals?show_id=eq." + row.id + "&select=show_id"); if (m && m.length) rl = "marshal"; }
      if (!isCloud() || show.cloud.id !== row.id) pending = load(ukey("pending." + row.id)) || { classes: {}, status: {} };
      show = buildCloudShow(row, rl); ui.open = {}; ui.arena = null; cloudUI.code = null;
      store(ukey("active"), "cloud"); saveShow(); startPolling(); flushPending();
      setView(rl === "viewer" ? "arenas" : "live");
      if (!quiet) banner("Following <strong>" + esc(show.name) + "</strong> live" + (rl === "marshal" ? " as a marshal." : rl === "owner" ? " as the publisher." : ". Times update automatically."), "ok", [], 6000);
    } catch (e) { banner(esc(e.message), "err", [], 8000); }
    finally { busy(false); }
  }
  // Stop following a live show and delete this phone's copy of it (and any unsent updates).
  function leaveCloud() {
    clearInterval(cloudUI.pollTimer); clearTimeout(cloudUI.schedTimer); cloudUI.schedTimer = null;
    if (isCloud()) { forget(ukey("pending." + show.cloud.id)); }
    forget(ukey("cloud")); pending = { classes: {}, status: {} };
    store(ukey("active"), "local");
    show = null; const cur = load(ukey("current")); if (cur) libOpen(cur);
    ui.open = {}; ui.arena = null;
    setView(show ? "live" : "load");
  }
  function leaveCloudQuiet() {
    clearInterval(cloudUI.pollTimer); clearTimeout(cloudUI.schedTimer); cloudUI.schedTimer = null;
    if (isCloud()) forget(ukey("pending." + show.cloud.id));
    forget(ukey("cloud")); pending = { classes: {}, status: {} }; store(ukey("active"), "local"); show = null;
  }
  async function joinMarshal() {
    const r = await dialog("I'm a marshal", '<p>Enter the marshal code the show publisher gave you.</p><label>Marshal code<input name="code" autocomplete="off" autocapitalize="characters" maxlength="12" style="font-size:1.4rem;letter-spacing:.15em;text-transform:uppercase"></label>',
      [{ label: "Cancel", value: "no" }, { label: "Join as marshal", value: "yes", cls: "primary" }]);
    if (r.value !== "yes" || !r.vals.code) return;
    busy(true, "Checking code…");
    try {
      const ok = await rpc("rt_join_marshal", { p_show: show.cloud.id, p_code: r.vals.code.trim().toUpperCase() });
      if (!ok) { banner("That code isn't right. Check it with the show publisher.", "err", [], 6000); return; }
      show.cloud.role = "marshal"; saveShow();
      setView("marshal");
      banner("You're now a marshal for this show. Tap NEXT each time a new horse enters the ring.", "ok", [], 8000);
    } catch (e) { banner(esc(e.message), "err", [], 8000); }
    finally { busy(false); }
  }
  async function newCode() {
    const r = await dialog("Change the marshal code?", "<p>Current marshals will need the new code to keep updating.</p>", [{ label: "Cancel", value: "no" }, { label: "Change code", value: "yes", cls: "danger" }]);
    if (r.value !== "yes") return;
    try { cloudUI.code = await rpc("rt_get_code", { p_show: show.cloud.id, p_new: true }); renderLive(); showCodeDialog(cloudUI.code); }
    catch (e) { banner(esc(e.message), "err", [], 6000); }
  }
  async function removeShow() {
    const r = await dialog("Remove this live show?", "<p>It disappears for everyone straight away and is deleted from the server. Your own copy stays on this phone.</p>", [{ label: "Cancel", value: "no" }, { label: "Remove", value: "yes", cls: "danger" }]);
    if (r.value !== "yes") return;
    try { await api("shows?id=eq." + show.cloud.id, { method: "DELETE", headers: { Prefer: "return=minimal" } }); banner("Live show removed.", "ok", [], 5000); leaveCloud(); }
    catch (e) { banner(esc(e.message), "err", [], 6000); }
  }
  async function loadOrganiserStatus() {
    try {
      const o = await api("organisers?select=user_id");
      cloudUI.isOrganiser = !!(o && o.length);
      const r = cloudUI.isOrganiser ? [] : await api("organiser_requests?select=organisation,created_at");
      cloudUI.request = r && r.length ? r[0] : null;
    } catch (e) { /* leave as unknown */ }
  }
  async function requestOrganiser() {
    const r = await dialog("Request organiser access", "<p>Tell us which show, club or venue you organise. The site owner checks requests before approving them.</p>" +
      '<label>Show / club / venue<input name="org" maxlength="120" autocomplete="organization"></label>',
      [{ label: "Cancel", value: "no" }, { label: "Send request", value: "yes", cls: "primary" }]);
    if (r.value !== "yes") return;
    const org = (r.vals.org || "").trim();
    if (org.length < 2) { banner("Please enter the show, club or venue name.", "err", [], 6000); return; }
    try { await api("organiser_requests", { method: "POST", headers: { Prefer: "return=minimal" }, body: { organisation: org } }); await loadOrganiserStatus(); renderLive(); banner("Request sent. You'll be able to publish once it's approved.", "ok", [], 7000); }
    catch (e) { banner("Couldn't send the request: " + esc(e.message), "err", [], 7000); }
  }
  async function loadShowList() {
    loadOrganiserStatus().then(() => { if (ui.view === "live") renderLive(); });
    try {
      const since = new Date(Date.now() - 8 * 864e5).toISOString().slice(0, 10);
      cloudUI.list = await api("shows?select=id,owner,name,show_date,live_updated_at,created_at&published=is.true&or=(show_date.gte." + since + ",show_date.is.null)&order=show_date.desc.nullslast,created_at.desc&limit=60");
      const m = await api("show_marshals?select=show_id");
      cloudUI.myMarshal = (m || []).map((x) => x.show_id);
      cloudUI.listError = null;
    } catch (e) { cloudUI.listError = e.message; }
    if (ui.view === "live") renderLive();
  }
  function ago(iso) {
    if (!iso) return "no live updates yet";
    const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
    if (s < 60) return "updated " + s + " s ago";
    if (s < 3600) return "updated " + Math.round(s / 60) + " min ago";
    return "updated " + Math.round(s / 3600) + " h ago";
  }
  function renderLiveStrip() {
    const el = $("#liveStrip"); if (!el) return;
    if (!isCloud() || ui.view === "auth") { el.hidden = true; return; }
    const rl = role(), n = pendingCount() + (cloudUI.schedTimer ? 1 : 0);
    const who = rl === "owner" ? "Publisher" : rl === "marshal" ? "Marshal" : "Viewing";
    const sync = canEdit() ? (n ? " · ⏳ " + n + " update" + (n > 1 ? "s" : "") + " waiting to send" : " · ✓ all sent") : "";
    el.hidden = false;
    el.className = "live-strip" + (n ? " waiting" : "");
    el.innerHTML = '<span class="dot"></span><strong>LIVE</strong> · ' + who + " · " + esc(ago(show.cloud.liveUpdatedAt)) + esc(sync);
  }

  // ---------- Live tab ----------
  function renderLive() {
    const box = $("#liveBody"); if (!box) return;
    let h = "";
    if (isCloud()) {
      const rl = role();
      h += '<div class="card live-current"><h3>' + esc(show.name) + '</h3><p class="muted">' + esc(show.date || "") + " · " + (rl === "owner" ? "You published this show" : rl === "marshal" ? "You're a marshal for this show" : "You're following this show live") + "</p>";
      h += '<div class="row-btns">';
      if (rl === "owner" || rl === "marshal") h += '<button class="btn primary" type="button" data-lv="marshal">Open marshal timing screen</button>';
      h += '<button class="btn" type="button" data-lv="arenas">See times by arena</button>';
      if (rl === "viewer") h += '<button class="btn" type="button" data-lv="join">I\'m a marshal</button>';
      h += '<button class="btn" type="button" data-lv="sharelink">Share link to this show</button>';
      h += '<button class="btn" type="button" data-lv="leave">Stop following</button></div>';
      if (rl === "owner") {
        h += '<div class="owner-box"><h3>Marshal code</h3><p class="code-big" id="codeBox">' + esc(cloudUI.code || "••••••") + '</p><div class="row-btns">' +
          (cloudUI.code ? "" : '<button class="btn small" type="button" data-lv="showcode">Show code</button>') +
          '<button class="btn small" type="button" data-lv="sendcode">Send to marshals</button><button class="btn small" type="button" data-lv="newcode">Change code</button>' +
          '<button class="btn small danger" type="button" data-lv="remove">Remove live show</button></div>' +
          '<p class="muted small">Edits you make in the Edit tab are sent to everyone automatically.</p></div>';
      }
      h += "</div>";
    } else if (cloudUI.isOrganiser && show) {
      h += '<div class="card"><h3>Share your show live</h3><p class="muted">Publish <strong>' + esc(show.name) + "</strong> so riders, grooms and parents can follow it, and your marshals can update it from the ring.</p>" +
        '<button class="btn primary" type="button" data-lv="publish">Publish as a live show</button></div>';
    } else if (cloudUI.isOrganiser) {
      h += '<div class="card"><h3>You\'re an approved organiser</h3><p class="muted">Load your show (Load a show → CSV, PDF or Excel), check it, then come back here to publish it live.</p></div>';
    } else if (cloudUI.isOrganiser === false) {
      if (cloudUI.request) {
        h += '<div class="card"><h3>Organiser request sent</h3><p class="muted">You asked to publish shows for <strong>' + esc(cloudUI.request.organisation) + "</strong> on " + esc(String(cloudUI.request.created_at).slice(0, 10)) + ". You'll be able to publish once it's approved.</p>" +
          '<button class="btn small" type="button" data-lv="withdraw">Withdraw request</button></div>';
      } else {
        h += '<div class="card"><h3>Are you a show organiser?</h3><p class="muted">Publishing live shows is limited to approved organisers, so everyone can trust what they see. Riders, grooms and parents don\'t need this — just tap a show below.</p>' +
          '<button class="btn" type="button" data-lv="request">Request organiser access</button></div>';
      }
    }
    h += '<div class="view-head"><h3>Live shows</h3><button class="btn small" type="button" data-lv="refresh">Refresh</button></div>';
    if (cloudUI.listError) h += '<p class="muted">' + esc(cloudUI.listError) + "</p>";
    else if (!cloudUI.list) h += '<p class="muted">Loading…</p>';
    else if (!cloudUI.list.length) h += '<p class="empty">No live shows right now.</p>';
    else {
      const today = saNow().date;
      h += cloudUI.list.map((s) => {
        const mine = session && s.owner === session.user.id, mar = cloudUI.myMarshal.includes(s.id), cur = isCloud() && show.cloud.id === s.id;
        const tag = s.show_date === today ? '<span class="badge live">Today</span>' : s.show_date && s.show_date < today ? '<span class="badge">Finished</span>' : s.show_date ? '<span class="badge">' + esc(s.show_date) + "</span>" : "";
        return '<button type="button" class="show-item' + (cur ? " current" : "") + '" data-open="' + esc(s.id) + '"><span><strong>' + esc(s.name) + "</strong><br><span class=\"muted small\">" + esc(ago(s.live_updated_at)) + (mine ? " · published by you" : mar ? " · you're a marshal" : "") + "</span></span>" + tag + "</button>";
      }).join("");
    }
    box.innerHTML = h;
  }

  // ---------- Marshal timing screen ----------
  function marshalClass(list, R) {
    if (ui.mClass) { const c = list.find((x) => x.id === ui.mClass); if (c) return c; }
    return list.find((c) => R.cls[c.id].inProgress) || list.find((c) => !R.cls[c.id].finished) || list[list.length - 1];
  }
  function renderMarshal() {
    const box = $("#marshalBody"); if (!box) return;
    if (!isCloud() || !canEdit()) { box.innerHTML = '<p class="empty">The marshal screen is for arena marshals of a live show. Go to the Live tab to open a show and enter the marshal code.</p>'; return; }
    if (!ui.arena || !show.arenas.some((a) => a.name === ui.arena)) ui.arena = show.arenas[0] && show.arenas[0].name;
    const list = show.classes.filter((c) => c.arena === ui.arena);
    if (!list.length) { box.innerHTML = '<p class="empty">No classes.</p>'; return; }
    const R = compute(true);
    const c = marshalClass(list, R); const r = R.cls[c.id];
    const starters = c.entries.filter((e) => e.status !== "scratched");
    const nowIdx = c.live.nowId ? starters.findIndex((e) => e.id === c.live.nowId) : -1;
    const cur = nowIdx >= 0 ? starters[nowIdx] : null, next = starters[nowIdx + 1] || null;
    const marks = {}; (c.live.marks || []).forEach((m) => (marks[m.id] = m.t));
    let h = '<div class="arena-tabs">' + show.arenas.map((a) => '<button type="button" data-marena="' + esc(a.name) + '" aria-selected="' + (a.name === ui.arena) + '">' + esc(a.name) + "</button>").join("") + "</div>";
    h += '<label>Class<select id="mClass">' + list.map((x) => '<option value="' + x.id + '"' + (x.id === c.id ? " selected" : "") + ">Class " + esc(x.no) + (x.height ? " · " + esc(x.height) : "") + " · " + esc(SHORT[x.format]) + (R.cls[x.id].finished ? " (finished)" : R.cls[x.id].inProgress ? " (live)" : "") + "</option>").join("") + "</select></label>";
    h += '<div class="m-status">' + (c.live.startedAt != null ? "Started " + fmt(c.live.startedAt) : "Not started · est. " + fmt(r.start)) + (c.live.finishedAt != null ? " · Finished " + fmt(c.live.finishedAt) : "") + " · " + starters.length + " starting" +
      (r.avg ? " · avg " + fmtDur(r.avg.spr) + "/round" : "") + "</div>";
    h += '<div class="m-now"><div class="m-label">IN THE RING</div>' + (cur ? '<div class="m-who">#' + esc(cur.draw) + " " + esc(cur.rider) + '</div><div class="m-horse">' + esc(cur.horse) + '</div><div class="m-time">went in ' + fmt(c.live.nowAt) + "</div>" : '<div class="m-who muted">Nobody yet</div>') + "</div>";
    if (c.live.finishedAt == null) {
      h += next ? '<button type="button" class="m-next" data-m="next"><span>' + (cur ? "▶ NEXT" : "▶ START CLASS") + "</span><small>#" + esc(next.draw) + " " + esc(next.rider) + " – " + esc(next.horse) + "</small></button>"
        : '<button type="button" class="m-next done" data-m="finish"><span>■ FINISH CLASS</span><small>Last horse is in the ring</small></button>';
    } else h += '<div class="m-finished">Class finished at ' + fmt(c.live.finishedAt) + ".</div>";
    h += '<div class="row-btns m-tools">' + (next ? '<button type="button" class="btn" data-m="scratchnext">✕ Scratch #' + esc(next.draw) + "</button>" : "") +
      '<button type="button" class="btn" data-m="undo"' + (ui.undo && ui.undo.id === c.id ? "" : " disabled") + '>↶ Undo</button>' +
      (c.live.startedAt == null ? '<button type="button" class="btn" data-m="started">Set start time</button>' : "") +
      (c.live.finishedAt == null ? '<button type="button" class="btn" data-m="finish">Finish class</button>' : '<button type="button" class="btn" data-m="reopen">Reopen class</button>') + "</div>";
    h += '<ul class="m-list">' + c.entries.map((e) => {
      const er = R.ent[e.id] || {}; const scr = e.status === "scratched";
      const tt = scr ? "scratched" : marks[e.id] != null ? "went " + fmt(marks[e.id]) : er.state === "now" ? "in ring" : "est. " + fmt(er.t);
      return '<li class="' + (scr ? "scr" : er.state || "") + '"><button type="button" class="m-row" data-m="set" data-ent="' + e.id + '"><b>#' + esc(e.draw) + "</b> " + esc(e.rider) + " <span class=\"muted\">" + esc(e.horse) + "</span><em>" + tt + "</em></button>" +
        '<button type="button" class="icon-btn" data-m="scratch" data-ent="' + e.id + '" aria-label="' + (scr ? "Un-scratch" : "Scratch") + '">' + (scr ? "↺" : "✕") + "</button></li>";
    }).join("") + "</ul>";
    box.innerHTML = h;
  }
  async function onMarshalClick(ev) {
    const ar = ev.target.closest("[data-marena]");
    if (ar) { ui.arena = ar.dataset.marena; ui.mClass = null; renderMarshal(); return; }
    const b = ev.target.closest("[data-m]"); if (!b || b.disabled) return;
    const c = classById(($("#mClass") || {}).value); if (!c) return;
    const starters = c.entries.filter((e) => e.status !== "scratched");
    const nowIdx = c.live.nowId ? starters.findIndex((e) => e.id === c.live.nowId) : -1;
    const ent = b.dataset.ent && c.entries.find((x) => x.id === b.dataset.ent);
    ui.mClass = c.id;
    switch (b.dataset.m) {
      case "next": if (starters[nowIdx + 1]) setNow(c, starters[nowIdx + 1]); break;
      case "scratchnext": if (starters[nowIdx + 1]) toggleScratch(c, starters[nowIdx + 1]); break;
      case "scratch": if (ent) toggleScratch(c, ent); break;
      case "set": if (ent && ent.status !== "scratched") { const r = await dialog("#" + ent.draw + " " + ent.rider, "<p>Mark this rider as in the ring now?</p>", [{ label: "Cancel", value: "no" }, { label: "In the ring now", value: "yes", cls: "primary" }]); if (r.value === "yes") setNow(c, ent); } break;
      case "undo": doUndo(); break;
      case "started": { const t = await askTime("Class " + c.no + " started at", saNow().sec); if (t != null) { pushUndo(c, "Class " + c.no + " started " + fmt(t)); c.live.startedAt = t; saveShow(); cloudTouch(c); render(); } break; }
      case "finish": { const t = await askTime("Class " + c.no + " finished at", saNow().sec); if (t != null) { pushUndo(c, "Class " + c.no + " finished " + fmt(t)); c.live.finishedAt = t; saveShow(); cloudTouch(c); ui.mClass = null; render(); } break; }
      case "reopen": pushUndo(c, "Class " + c.no + " reopened"); c.live.finishedAt = null; saveShow(); cloudTouch(c); render(); break;
    }
  }
  function bindCloud() {
    $("#liveBody").addEventListener("click", async (ev) => {
      const o = ev.target.closest("[data-open]");
      if (o) { if (isCloud() && show.cloud.id === o.dataset.open) setView("arenas"); else openCloudShow(o.dataset.open); return; }
      const b = ev.target.closest("[data-lv]"); if (!b) return;
      switch (b.dataset.lv) {
        case "publish": publishShow(); break;
        case "request": requestOrganiser(); break;
        case "withdraw": try { await api("organiser_requests?user_id=eq." + session.user.id, { method: "DELETE", headers: { Prefer: "return=minimal" } }); cloudUI.request = null; renderLive(); } catch (e) { banner(esc(e.message), "err", [], 6000); } break;
        case "refresh": cloudUI.list = null; renderLive(); loadShowList(); if (isCloud()) pollCloud(true); break;
        case "marshal": setView("marshal"); break;
        case "arenas": setView("arenas"); break;
        case "join": joinMarshal(); break;
        case "leave": {
          const n = pendingCount() + (cloudUI.schedTimer ? 1 : 0);
          if (n) {
            const r = await dialog("Updates not sent yet", "<p>" + n + " update" + (n > 1 ? "s haven't" : " hasn't") + " reached the server yet (no signal?). If you stop following now, " + (n > 1 ? "they" : "it") + " will be lost.</p>",
              [{ label: "Keep following", value: "no" }, { label: "Stop anyway", value: "yes", cls: "danger" }]);
            if (r.value !== "yes") break;
          }
          leaveCloud(); banner("Stopped following. The copy on this phone has been deleted.", "ok", [], 5000); break;
        }
        case "remove": removeShow(); break;
        case "newcode": newCode(); break;
        case "showcode": try { cloudUI.code = await rpc("rt_get_code", { p_show: show.cloud.id }); renderLive(); } catch (e) { banner(esc(e.message), "err", [], 6000); } break;
        case "sendcode": try { cloudUI.code = cloudUI.code || await rpc("rt_get_code", { p_show: show.cloud.id }); renderLive(); showCodeDialog(cloudUI.code); } catch (e) { banner(esc(e.message), "err", [], 6000); } break;
        case "sharelink": {
          const t = "Follow *" + show.name + "* live on Ringside Timer – estimated jump times for every rider: " + shareLink();
          window.open("https://wa.me/?text=" + encodeURIComponent(t), "_blank", "noopener"); break;
        }
      }
    });
    $("#marshalBody").addEventListener("click", onMarshalClick);
    $("#marshalBody").addEventListener("change", (ev) => { if (ev.target.id === "mClass") { ui.mClass = ev.target.value; renderMarshal(); } });
    window.addEventListener("online", () => { flushPending(); pollCloud(true); libSyncSoon(500); });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { pollCloud(false); flushPending(); } });
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
        const vals = {}; $$("input,select", $("#dlgBody")).forEach((i) => (vals[i.name] = i.type === "checkbox" ? (i.checked ? i.value || "on" : "") : i.value));
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
    if (canEdit()) {
      if (e.status !== "scratched") opts.push({ label: "▶ Now jumping", value: "now", cls: "primary opt" });
      opts.push({ label: e.status === "scratched" ? "Un-scratch" : "✕ Scratch (not starting)", value: "scratch", cls: "opt" + (e.status === "scratched" ? "" : " danger") });
    }
    if (e.rider) opts.push({ label: (isStarR ? "Unstar rider " : "★ Star rider ") + e.rider, value: "sr", cls: "opt" });
    if (e.horse) opts.push({ label: (isStarH ? "Unstar horse " : "★ Star horse ") + e.horse, value: "sh", cls: "opt" });
    opts.push({ label: "Cancel", value: "cancel", cls: "opt" });
    const r = await dialog("#" + (e.draw || "?") + " " + (e.rider || "") + (e.horse ? " · " + e.horse : ""), '<p class="muted small">Class ' + esc(c.no) + " " + esc(c.name) + "</p>", opts);
    if (r.value === "now") setNow(c, e);
    else if (r.value === "scratch") toggleScratch(c, e);
    else if (r.value === "sr") toggleStar("riders", e.rider);
    else if (r.value === "sh") toggleStar("horses", e.horse);
  }
  async function copyRiders() {
    if (!show) return;
    const others = libIndex().filter((x) => !x.deleted && x.id !== show.libId && (x.riders || 0) > 0);
    if (!others.length) { banner("None of your other shows have riders in their list yet.", "", [], 5000); return; }
    const r = await dialog("Copy riders from…", "<p>Adds that show's starred riders and horses to <strong>" + esc(show.name) + "</strong>. Only those entered in this show will appear in your plan.</p>",
      others.slice(0, 12).map((x) => ({ label: x.name + " (★ " + x.riders + ")", value: x.id, cls: "opt" })).concat([{ label: "Cancel", value: "cancel", cls: "opt" }]));
    if (!r.value || r.value === "cancel") return;
    const src = load(ukey("lib." + r.value));
    const list = (src && src.riders) || { riders: [], horses: [] };
    bindStars();
    let n = 0;
    (list.riders || []).forEach((x) => { if (!stars.riders.includes(x)) { stars.riders.push(x); n++; } });
    (list.horses || []).forEach((x) => { if (!stars.horses.includes(x)) { stars.horses.push(x); n++; } });
    saveStars(); render();
    banner("Copied " + n + " rider" + (n === 1 ? "" : "s") + "/horse" + (n === 1 ? "" : "s") + " into this show's list.", "ok", [], 5000);
  }
  function toggleStar(kind, name) {
    bindStars();
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
    if (session && !show && v !== "load" && v !== "auth" && v !== "live") v = "load";
    if (v === "marshal" && !(isCloud() && canEdit())) v = "live";
    ui.view = v;
    if (v === "auth" && !ui.authMode) authMode("signin");
    $$(".view").forEach((s) => (s.hidden = s.id !== "view-" + v));
    $$("#tabbar button").forEach((b) => b.setAttribute("aria-current", b.dataset.view === v ? "page" : "false"));
    $("#tabbar").hidden = v === "auth";
    $$('#tabbar [data-view="arenas"], #tabbar [data-view="mine"]').forEach((b) => (b.disabled = !show));
    if (v === "live" && !cloudUI.list) loadShowList();
    $(".foot").hidden = v === "auth";
    render();
    window.scrollTo(0, 0);
  }
  function render() {
    tickClock(); bindStars();
    if (ui.view === "auth") { $("#showName").textContent = "Sign in to continue"; return; }
    $("#showName").textContent = show ? (isCloud() ? "● " : "") + show.name + (show.date ? " · " + show.date : "") : "No show loaded";
    if (!show) { if (ui.view === "live") renderLive(); else renderLoad(); renderLiveStrip(); return; }
    if (ui.view === "arenas") renderArenas();
    else if (ui.view === "mine") renderMine();
    else if (ui.view === "review") renderReview();
    else if (ui.view === "settings") renderSettings();
    else if (ui.view === "load") renderLoad();
    else if (ui.view === "live") renderLive();
    else if (ui.view === "marshal") renderMarshal();
    renderLiveStrip();
  }
  function tickClock() { $("#clock").textContent = fmt(saNow().sec); }

  function countdown(t, state, c) {
    const now = saNow(); const dd = dayOf(c);
    if (dd && dd !== now.date) return dd > now.date ? dayLabel(dd) : "";
    if (state === "now") return "jumping now";
    if (state === "done") return "done";
    const d = t - now.sec;
    if (d > 60) return "in ~" + fmtMins(d);
    if (d > -120) return "due now";
    return "~" + fmtMins(-d) + " ago";
  }

  // ---------- Load ----------
  function renderLoad() {
    const ix = libIndex().filter((x) => !x.deleted).sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.updatedAt - a.updatedAt);
    $("#libEmpty").hidden = !!ix.length;
    $("#libStatus").textContent = ix.length ? libStatusText() : "";
    const curId = show && !isCloud() ? show.libId : null;
    $("#libList").innerHTML = ix.map((x) => '<div class="show-card' + (x.id === curId ? " current" : "") + '"><div class="sc-main"><strong>' + esc(x.name) + (x.id === curId ? ' <span class="badge">Open</span>' : "") + '</strong><span class="muted small">' + esc(x.date || "No date") + " · " + (x.classes || 0) + ((x.classes || 0) === 1 ? " class · " : " classes · ") + (x.entries || 0) + ((x.entries || 0) === 1 ? " rider entered · ★ " : " riders entered · ★ ") + (x.riders || 0) + " in my list" + (x.dirty ? " · not synced yet" : "") + "</span></div>" +
      '<div class="row-btns"><button type="button" class="btn small primary" data-libopen="' + esc(x.id) + '">Open</button><button type="button" class="btn small" data-libedit="' + esc(x.id) + '">Edit</button><button type="button" class="btn small" data-libadd="' + esc(x.id) + '">+ Add schedule / starting lists</button><button type="button" class="btn small danger" data-libdel="' + esc(x.id) + '">Delete</button></div></div>').join("");
    $("#btnReadAI").hidden = !aiConfigured;
    $("#aiPrivacy").hidden = !aiConfigured;
  }

  // ---------- Arenas ----------
  function renderArenas() {
    $("#arenaShowName").textContent = show.name + (show.date ? " · " + show.date : "");
    $("#btnEditSched").hidden = isCloud() && role() !== "owner";
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
      if (c.combined) badges.push('<span class="badge">Runs straight on</span>');
      if (r.placeholder) badges.push('<span class="badge warn">Running order not loaded · ' + r.N + " expected</span>");
      const scratched = c.entries.length - r.N;
      html += '<details class="klass' + (r.inProgress ? " live" : "") + (r.finished ? " finished" : "") + '" data-cls="' + c.id + '"' + (open ? " open" : "") + ">";
      html += '<summary><div class="k-top"><div class="k-title">Class ' + esc(c.no) + (c.height ? " · " + esc(c.height) : "") + '</div><div class="k-times">' + fmt(r.start) + "–" + fmt(r.end) + "</div></div>";
      html += '<div class="k-meta">' + esc(c.name || "") + (c.name ? " · " : "") + esc(SHORT[c.format]) + " · " + r.N + " starting" + (scratched ? " (" + scratched + " scratched)" : "") + (r.sched != null ? " · scheduled " + fmt(r.sched) + (r.schedEnd != null ? "–" + fmt(r.schedEnd) : "") : "") + "</div>";
      html += '<div class="badges">' + badges.join("") + "</div></summary>";
      // live bar
      const sprInfo = r.avg ? "Using real average " + fmtDur(r.avg.spr) + " per round (from " + r.avg.n + " rounds)" : r.planSpr ? "Using the timetable's plan: " + fmtDur(r.planSpr) + " per horse" : r.fixedSpr ? "Using the times printed in the running order (" + fmtDur(r.fixedSpr) + " apart)" : "Using default " + fmtDur(r.sprDefault) + " per round" + (r.startSrc === "actual" ? " · started " + fmt(c.live.startedAt) : "");
      if (canEdit()) html += '<div class="live-bar"><div class="now-in"><label>Now jumping #<input type="text" inputmode="numeric" enterkeyhint="go" data-now="' + c.id + '" placeholder="draw"></label><button type="button" class="btn small primary" data-act="go" data-cls="' + c.id + '">Go</button><button type="button" class="btn small" data-act="next" data-cls="' + c.id + '">Next ▸</button></div>' +
        '<button type="button" class="btn small" data-act="started" data-cls="' + c.id + '">Started</button><button type="button" class="btn small" data-act="finished" data-cls="' + c.id + '">Finished</button>' +
        '<div class="info">' + sprInfo + (hasLive(c) ? ' · <button type="button" class="btn small" data-act="resetlive" data-cls="' + c.id + '">Clear live</button>' : "") + "</div></div>";
      html += '<ul class="entries">';
      c.entries.forEach((e) => {
        const er = R.ent[e.id] || {};
        const cls = ["entry", er.state || ""];
        if (clashes.ids.has(e.id)) cls.push("clash");
        if (stars.riders.includes(norm(e.rider)) || stars.horses.includes(norm(e.horse))) cls.push("starred");
        const cd = er.state === "scratched" ? "" : er.actual && er.state === "done" ? "went in" : countdown(er.t, er.state, c);
        html += '<li class="' + cls.join(" ") + '" data-cls="' + c.id + '" data-ent="' + e.id + '"><span class="draw">' + esc(e.draw || "–") + '</span><span class="who"><div class="rider">' + esc(e.rider || "?") + '</div><div class="horse">' + esc(e.horse || "") + "</div></span>" +
          '<span class="t">' + (er.state === "scratched" ? "scratched" : fmt(er.t)) + (cd ? "<small>" + cd + "</small>" : "") + "</span></li>";
      });
      html += "</ul>";
      if (r.placeholder) html += '<div class="extra-row"><span>Running order not published yet — times assume ' + r.N + ' entries. Add the starting list on the Load screen when it\'s out.</span></div>';
      if (r.extra && r.extra.n > 0) html += '<div class="extra-row"><span>' + r.extra.label + " (est. " + r.extra.n + " riders)</span><b>~" + fmt(r.extra.start) + "</b></div>";
      html += '<div class="extra-row"><span>Estimated finish incl. ' + (r.extra ? r.extra.label.toLowerCase() : "last round") + "</span><b>~" + fmt(r.end) + "</b></div>";
      html += "</details>";
    });
    $("#arenaClasses").innerHTML = html;
  }

  // ---------- My riders ----------
  function renderMine() {
    bindStars();
    const n = stars.riders.length + stars.horses.length;
    $("#mineFor").textContent = "For " + show.name + (show.date ? " (" + show.date + ")" : "") + " · ★ " + n + " in this show's list. Each show has its own list.";
    $("#btnCopyRiders").hidden = isCloud() ? !libIndex().some((x) => !x.deleted && (x.riders || 0) > 0) : !libIndex().some((x) => !x.deleted && x.id !== show.libId && (x.riders || 0) > 0);
    $("#btnClearRiders").hidden = !n;
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
    const mk = (m) => (m.r.t == null ? null : m.r.t + dayOffset(m.c) * 86400);
    mine.sort((a, b) => (mk(a) == null) - (mk(b) == null) || mk(a) - mk(b));
    const myClash = clashes.pairs.filter(([a, b]) => mine.some((m) => m.e.id === a.e.id || m.e.id === b.e.id));
    $("#clashList").innerHTML = myClash.length ? '<div class="clash-box"><strong>⚠ Possible clashes (less than ' + S.clashMin + " min apart)</strong><ul>" + myClash.map(([a, b]) =>
      "<li>" + esc(a.e.rider) + ": " + fmt(a.t) + " " + esc(a.c.arena) + " Class " + esc(a.c.no) + " (" + esc(a.e.horse) + ") and " + fmt(b.t) + " " + esc(b.c.arena) + " Class " + esc(b.c.no) + " (" + esc(b.e.horse) + ")</li>").join("") + "</ul></div>" : "";
    if (!mine.length) {
      $("#mineList").innerHTML = '<p class="empty">No starred riders or horses yet.<br>Search above, or tap any entry in Arenas and choose “Star”.</p>';
      return;
    }
    $("#mineList").innerHTML = mine.map(({ c, e, r }) => {
      const scr = r.state === "scratched";
      const cd = scr ? "scratched" : countdown(r.t, r.state, c);
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
        '<label>Expected entries<input type="number" min="0" max="300" inputmode="numeric" data-f="expected" value="' + esc(c.expected || "") + '" placeholder="if no running order"></label>' +
        '<label>Scheduled end<input data-f="end" value="' + esc(c.end || "") + '" placeholder="optional"></label>' +
        '<label class="wide"><input type="checkbox" data-f="sameCourse"' + (c.sameCourse ? " checked" : "") + '>Same course as previous class, height raised (' + S.changeSameMin + " min change, no walk)</label>" +
        '<label class="wide"><input type="checkbox" data-f="combined"' + (c.combined ? " checked" : "") + ">Runs straight on from the previous class (shared time slot, no break)</label></div>";
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
    $("#btnDeleteShow").textContent = isCloud() ? "Stop following & delete from this phone" : "Delete this show";
    $("#libStatus2").textContent = libStatusText();
    const cn = $("#cloudNote"); cn.hidden = !(isCloud() && role() !== "owner");
    cn.textContent = "For this live show, estimated times use the publisher's timing settings so everyone sees the same times. Changes here only apply to your own shows.";
  }

  // ===================================================================
  // Loading a show
  // ===================================================================
  function useShow(sh, toReview) {
    if (isCloud()) { clearInterval(cloudUI.pollTimer); clearTimeout(cloudUI.schedTimer); cloudUI.schedTimer = null; store(ukey("active"), "local"); }
    delete sh.libId; show = sh; ui.open = {}; ui.arena = null;
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
      if (d.stars && d.show && !d.show.riders) d.show.riders = { riders: d.stars.riders || [], horses: d.stars.horses || [] }; // older backups
      if (d.settings) { S = Object.assign({}, DEFAULTS, d.settings); saveSettings(); applyTheme(); }
      useShow(normalizeShow(d.show || d), false);
      banner("Backup restored.", "ok", [], 5000);
      return;
    }
    useShow(csvToShow(text, file.name), true);
  }
  async function readLocal() {
    const files = ui.docFiles || []; if (!files.length) return;
    busy(true, "Reading " + (files.length > 1 ? files.length + " files" : files[0].name) + "…");
    try {
      let lines = [];
      for (const f of files) {
        const buf = await f.arrayBuffer();
        if (lines.length) lines.push("=== NEXT DOCUMENT ===");
        lines = lines.concat(/\.pdf$/i.test(f.name) || f.type === "application/pdf" ? await extractPdfLines(buf) : await extractExcelLines(buf));
      }
      await importResult(linesToShow(lines, files[0].name));
    } catch (e) {
      const offline = /Could not load/.test(e.message);
      banner(esc(offline ? "The reader needs a connection the first time it's used. Try again when you have signal, or use the CSV template." : e.message), "err", [{ label: "Download CSV template", fn: downloadTemplate }]);
    } finally { busy(false); }
  }
  async function readAI() {
    const files = ui.docFiles || []; if (!files.length) return;
    busy(true, "Reading with AI… this can take up to a minute");
    try { const sh = await readWithAI(files); busy(false); await importResult(sh); }
    catch (e) {
      const limited = /rate_limit/.test(e.code || "");
      const msg = limited
        ? (e.code === "rate_limit_global" ? "The AI reader has reached its daily limit for everyone. " : "You've used today's AI reads. ") + "Please use the free reader on this phone, or the CSV template — they work just as well for most schedules."
        : esc(e.message) + " You can still use the free reader on this phone or the CSV template.";
      if (e.code === "login_required") { banner("Your sign-in has expired. Please sign in again, then retry.", "err", [{ label: "Sign in", fn: () => { hideBanner(); clearSession(); setView("auth"); }, primary: true }]); return; }
      banner(msg, limited ? "" : "err", [{ label: "Read on this phone", fn: () => { hideBanner(); readLocal(); }, primary: true }, { label: "CSV template", fn: downloadTemplate }]);
    } finally { busy(false); }
  }
  // After reading a schedule: if the person already has a show open, offer to add these running orders to it.
  // After reading a file: either a brand-new show, or added to the show chosen with "Add schedule / starting lists".
  async function importResult(sh) {
    const target = ui.importTarget; setImportTarget(null);
    if (target) {
      if (isCloud()) leaveCloudQuiet();
      if (!show || show.libId !== target) libOpen(target);
      if (show && show.libId === target) { mergeInto(show, sh); return; }
    }
    useShow(sh, true);
  }
  function setImportTarget(id) {
    ui.importTarget = id || null;
    const x = id ? libIndex().find((y) => y.id === id) : null;
    $("#newShowCard").classList.toggle("adding", !!x);
    $("#uploadTitle").textContent = x ? "Add to “" + x.name + "”" : "Start a new show";
    $("#uploadHint").textContent = x ? "Add a timetable or starting lists to this show. Classes are matched by class number; new classes are added at the end of their arena." : "Upload the schedule. You can pick several files at once, for example the timetable plus starting lists. Starting lists published later can be added to the show from its card above.";
    $("#btnCancelAdd").hidden = !x; $("#newOnly").hidden = !!x;
    $("#docChoice").hidden = true; ui.docFiles = null;
  }
  // Add a timetable and/or starting lists to an existing show. Classes are matched by class number (same arena first).
  function mergeInto(base, sh) {
    let filled = 0, added = 0;
    sh.classes.forEach((c) => {
      const cands = base.classes.filter((b) => norm(b.no) === norm(c.no));
      if (!c.entries.length) {
        // timetable row: fill in what the show doesn't have yet (times, height, entry count)
        const t = cands.find((b) => norm(b.arena) === norm(c.arena)) || cands[0];
        if (t) {
          ["start", "end", "height", "name"].forEach((k) => { if (!t[k] && c[k]) t[k] = c[k]; });
          if (!t.expected && c.expected) t.expected = c.expected;
          if (c.combined && !t.start) t.combined = true;
          filled++; return;
        }
      } else {
        // starting list: replace that class's riders
        const target = cands.find((b) => norm(b.arena) === norm(c.arena)) || cands.find((b) => !b.entries.length) || cands[0];
        if (target) {
          target.entries = c.entries.map((e) => makeEntry({ draw: e.draw, rider: e.rider, horse: e.horse, status: e.status, flags: e.flags }));
          target.live = blankLive();
          if (!target.height && c.height) target.height = c.height;
          target.flags = target.flags.filter((f) => !/running order/i.test(f)).concat(["Running order added (" + c.entries.length + " entries) — please check"]);
          if (target.expected && Math.abs(target.expected - c.entries.length) > 2) target.flags.push("Timetable said " + target.expected + " entries, running order has " + c.entries.length);
          filled++; return;
        }
      }
      // not in the show yet: add it at the end of its arena
      const note = base.classes.length ? ["Not in your timetable — added at the end of " + c.arena + ". Check it belongs to this show."] : [];
      const nc = makeClass(Object.assign({}, c, { id: uid(), live: blankLive(), flags: c.flags.concat(note) }));
      const lastIdx = base.classes.map((b) => b.arena).lastIndexOf(c.arena);
      if (lastIdx >= 0) base.classes.splice(lastIdx + 1, 0, nc); else base.classes.push(nc);
      added++;
    });
    syncArenas(base); show = base; saveShow();
    setView("review");
    banner("Updated " + filled + " class" + (filled === 1 ? "" : "es") + (added ? " and added " + added + " new class" + (added === 1 ? "" : "es") + " (check the amber ones)" : "") + " in “" + esc(base.name) + "”.", added ? "" : "ok", [], 9000);
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
  function backupJSON() { return JSON.stringify({ app: "ringside-timer", version: 2, exported: new Date().toISOString(), show, settings: S }, null, 1); }
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
    $("#btnDeleteShow").onclick = deleteThisShow;
    $("#btnDeleteAll").onclick = deleteAllMyData;
    $("#libList").addEventListener("click", async (ev) => {
      const o = ev.target.closest("[data-libopen]"), d = ev.target.closest("[data-libdel]"), ed = ev.target.closest("[data-libedit]"), ad = ev.target.closest("[data-libadd]");
      if (o || ed) { const id = (o || ed).dataset[o ? "libopen" : "libedit"]; if (isCloud()) leaveCloudQuiet(); if (libOpen(id)) setView(o ? "arenas" : "review"); else banner("That show isn't on this phone yet. Try again when you have signal.", "err", [], 6000); }
      if (ad) { setImportTarget(ad.dataset.libadd); $("#newShowCard").scrollIntoView({ behavior: "smooth", block: "start" }); }
      if (d) {
        const x = libIndex().find((y) => y.id === d.dataset.libdel); if (!x) return;
        const r = await dialog("Delete “" + x.name + "”?", "<p>This permanently deletes it from your account and every device. It can't be undone.</p>", [{ label: "Cancel", value: "no" }, { label: "Delete", value: "yes", cls: "danger" }]);
        if (r.value === "yes") { libDelete(x.id); renderLoad(); banner("Deleted.", "ok", [], 4000); }
      }
    });
    $("#btnPlanWA").onclick = sendPlanWhatsApp;
    $("#btnNewShowTop").onclick = () => { setImportTarget(null); $("#newShowCard").scrollIntoView({ behavior: "smooth", block: "start" }); };
    $("#btnCancelAdd").onclick = () => setImportTarget(null);
    $("#btnEditSched").onclick = () => setView("review");
    $("#btnEmptyShow").onclick = async () => {
      const r = await dialog("Start an empty show", '<label>Show name<input name="name" maxlength="160" autocomplete="off"></label><label>Show date<input type="date" name="date" value="' + saNow().date + '"></label>',
        [{ label: "Cancel", value: "no" }, { label: "Create show", value: "yes", cls: "primary" }]);
      if (r.value !== "yes") return;
      const sh = normalizeShow({ name: (r.vals.name || "").trim() || "New show", date: r.vals.date || saNow().date, classes: [makeClass({ arena: "Main Arena", no: "1", start: S.dayStart })] });
      useShow(sh, false); setView("review"); banner("Type in your classes and riders here, or add a schedule later from the Shows tab.", "ok", [], 8000);
    };
    $("#btnCopyRiders").onclick = copyRiders;
    $("#btnClearRiders").onclick = async () => {
      bindStars(); const n = stars.riders.length + stars.horses.length; if (!n) return;
      const r = await dialog("Clear this rider list?", "<p>Removes all " + n + " starred riders and horses from <strong>" + esc(show.name) + "</strong>. Other shows' lists aren't affected.</p>", [{ label: "Cancel", value: "no" }, { label: "Clear list", value: "yes", cls: "danger" }]);
      if (r.value === "yes") { stars.riders.length = 0; stars.horses.length = 0; saveStars(); render(); }
    };
    $("#btnPlanCopy").onclick = copyPlan;
    $("#btnSample").onclick = loadSample;

    $("#fileCsv").onchange = async (ev) => {
      const f = ev.target.files[0]; ev.target.value = ""; if (!f) return;
      try { await handleCsvFile(f); } catch (e) { banner(esc(e.message), "err", [{ label: "Download CSV template", fn: downloadTemplate }]); }
    };
    $("#fileDoc").onchange = (ev) => {
      const files = Array.from(ev.target.files || []); ev.target.value = ""; if (!files.length) return;
      if (files.length === 1 && (/\.csv$/i.test(files[0].name) || /\.json$/i.test(files[0].name))) { handleCsvFile(files[0]).catch((e) => banner(esc(e.message), "err")); return; }
      const docs = files.filter((f) => !/\.(csv|json)$/i.test(f.name));
      ui.docFiles = docs;
      $("#docName").textContent = docs.map((f) => f.name).join(", ") + " (" + Math.round(docs.reduce((n, f) => n + f.size, 0) / 1024) + " KB)";
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
        else if (a === "started") { const t = await askTime("Class " + c.no + " started at", saNow().sec); if (t != null) { pushUndo(c, "Class " + c.no + " started " + fmt(t)); c.live.startedAt = t; c.live.finishedAt = null; ui.open[c.id] = true; saveShow(); cloudTouch(c); render(); } }
        else if (a === "finished") { const t = await askTime("Class " + c.no + " finished at", saNow().sec); if (t != null) { pushUndo(c, "Class " + c.no + " finished " + fmt(t)); c.live.finishedAt = t; ui.open[c.id] = false; saveShow(); cloudTouch(c); render(); } }
        else if (a === "resetlive") { pushUndo(c, "Live updates cleared for Class " + c.no); c.live = blankLive(); c.entries.forEach((e) => { if (e.status === "done") e.status = "starting"; }); saveShow(); cloudTouch(c); render(); }
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
    $("#inShowName").addEventListener("input", (ev) => { show.name = ev.target.value; saveShow(); cloudScheduleChanged(); $("#showName").textContent = show.name; });
    $("#inShowDate").addEventListener("change", (ev) => { show.date = ev.target.value; saveShow(); cloudScheduleChanged(); render(); });
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
      syncArenas(show); saveShow(); cloudScheduleChanged(); renderReview();
      if (b.dataset.rv === "eadd") { const rows = $$('[data-cls="' + c.id + '"] .rv-entry[data-ent] input[data-e="rider"]'); const last = rows[rows.length - 1]; if (last) last.focus(); }
    });
    $("#btnAddClass").onclick = () => {
      const last = show.classes[show.classes.length - 1];
      show.classes.push(makeClass({ arena: last ? last.arena : "Arena 1", no: String((parseInt(last && last.no, 10) || 0) + 1), start: last ? "follow" : S.dayStart }));
      syncArenas(show); saveShow(); cloudScheduleChanged(); renderReview();
    };

    // Settings
    $("#view-settings").addEventListener("change", (ev) => {
      const i = ev.target;
      if (i.dataset.set) {
        const k = i.dataset.set;
        if (typeof DEFAULTS[k] === "number") { const v = parseFloat(i.value); S[k] = isFinite(v) && v >= 0 ? v : DEFAULTS[k]; }
        else S[k] = i.value || DEFAULTS[k];
        saveSettings(); if (k === "theme") applyTheme(); else cloudScheduleChanged();
      } else if (i.dataset.lunch != null) {
        const a = show.arenas[+i.dataset.lunch];
        if (i.dataset.k === "lunchMin") a.lunchMin = Math.max(0, parseInt(i.value, 10) || 0); else a.lunchStart = i.value;
        saveShow(); cloudScheduleChanged();
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
      show.classes.forEach((c) => { c.live = blankLive(); cloudTouch(c); }); saveShow(); banner("Live updates cleared.", "ok", [], 4000);
    };
    $("#btnNewShow").onclick = () => setView("load");
  }
  function confirmDel(c) { return window.confirm ? window.confirm("Delete Class " + (c.no || "") + " and its " + c.entries.length + " entries?") : true; }
  function onReviewEdit(ev) {
    const i = ev.target; const box = i.closest("[data-cls]"); if (!box) return;
    const c = classById(box.dataset.cls); if (!c) return;
    if (i.dataset.f) {
      const f = i.dataset.f;
      if (f === "sameCourse") c.sameCourse = i.checked;
      else if (f === "combined") c.combined = i.checked;
      else if (f === "expected") c.expected = Math.max(0, parseInt(i.value, 10) || 0);
      else if (f === "end") { if (ev.type !== "change") return; const t = normTime(i.value); c.end = t && t !== "follow" ? t : ""; i.value = c.end; }
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
    saveShow(); cloudScheduleChanged();
  }

  // ===================================================================
  // Start-up
  // ===================================================================
  function init() {
    applyTheme();
    bind();
    bindAuth();
    bindCloud();
    $("#liveStrip").addEventListener("click", () => setView("live"));
    $("#btnFollowLive").onclick = () => setView("live");
    const qs = new URLSearchParams(location.search);
    if (qs.get("show")) { ui.deepShow = qs.get("show"); history.replaceState(null, "", location.pathname + location.hash); }
    tickClock();
    const redirect = readAuthRedirect();
    if (session) loadUserData();
    if (redirect && redirect.error) { setView("auth"); authMode("signin"); authMsg("That link didn't work: " + redirect.error + ". Links expire after a while — please try again.", "err"); }
    else if (redirect && redirect.type === "recovery") { authMode("newpw"); setView("auth"); authMsg("Please choose a new password.", "ok"); }
    else if (session) {
      setView(show ? "arenas" : "load"); if (redirect) banner("Your email is confirmed — welcome!", "ok", [], 6000);
      if (ui.deepShow) { openCloudShow(ui.deepShow); ui.deepShow = null; }
      else if (isCloud()) { startPolling(); pollCloud(true); flushPending(); }
      libSync();
    }
    else { setView("auth"); authMode("signin"); }
    if (session && navigator.onLine !== false) {
      freshToken().then(() => (session ? loadUser() : null)).then(() => { if (!session && ui.view !== "auth") { setView("auth"); authMode("signin"); authMsg("Please sign in again.", "err"); } });
    }
    setInterval(() => {
      tickClock();
      const typing = document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
      const dlgOpen = $("#dlg").open;
      if (!typing && !dlgOpen && (ui.view === "arenas" || ui.view === "mine" || ui.view === "marshal")) render(); else renderLiveStrip();
      if (session && session.expires_at - 300 < Date.now() / 1000) freshToken();
    }, 20000);
    if ("serviceWorker" in navigator && /^https?:/.test(location.protocol)) {
      const hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.register("sw.js").then((reg) => { if (reg && reg.update) setInterval(() => reg.update().catch(() => {}), 30 * 60000); }).catch(() => { /* offline support unavailable */ });
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!hadController || ui.reloadOffered) return;
        ui.reloadOffered = true;
        banner("A new version of Ringside Timer is ready.", "ok", [{ label: "Update now", primary: true, fn: () => location.reload() }]);
      });
    }
  }
  // expose a tiny hook for automated tests (no secrets here)
  window.RingsideTimer = { compute: () => compute(true), baseline: () => compute(false), get show() { return show; }, planText, cloud: () => ({ pending, role: role(), id: show && show.cloud && show.cloud.id }), poll: () => pollCloud(true), csvToShow, linesToShow, normTime, render, setNow, nowByDraw, toggleScratch };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
