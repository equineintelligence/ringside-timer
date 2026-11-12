# Ringside Timer

A free, mobile-friendly web tool that estimates **what time each horse-and-rider combination will jump** at a South African showjumping show, using the show schedule, running orders, start times and course changes.

Made for riders, grooms, parents and coaches standing at the ring on a phone. It is high-contrast for bright sun, works in light and dark mode, and keeps working offline once it has loaded. Times are 24-hour, South African time.

> Estimates only. The ring steward and show office always have the final say.

Live site (once set up): **https://equineintelligence.github.io/ringside-timer**

---

## What it does

- **Load a show** three ways:
  1. **CSV spreadsheet** in the template format (most reliable).
  2. **PDF or Excel schedule** read on the phone itself (free, always available).
  3. **"Read schedule with AI"** for messy PDFs/Excel files (optional; needs the Supabase setup in `SETUP-SUPABASE.md`). The button stays hidden until `config.js` is filled in.
- **Check & edit** everything before using it: amber highlights show what needs checking. Add, remove and reorder entries and classes, mark scratches, change times and formats.
- **Estimated times** for every entry, every class start/finish, lunch breaks and jump-offs.
- **Live mode** on show day: "Now jumping #__", **Next ▸**, "Started", "Finished", one-tap scratches, and **Undo**. After a few real rounds it switches to the class's real average time per round and says so.
- **Running X min behind/ahead** per arena.
- **My riders**: star riders or horses and see only their rounds, in time order, with a countdown ("in ~42 min").
- **Clash warning** when the same rider has two rounds less than 10 minutes apart (in any arena).
- **Export / share**: download the show as CSV, or as a JSON backup that can be loaded again.
- Everything is saved **on the phone** (localStorage), so a refresh or lost signal doesn't wipe it.

## How the times are worked out

Estimated time for an entry = class start time + (number of non-scratched horses before it × seconds per round).

| Setting (all editable in **Settings**) | Default |
|---|---|
| Seconds per round (enter, salute, jump, leave) | 120s normal, 100s speed, 150s two-phase |
| Course walk before a class | 10 min |
| Course change between classes | 15 min if rebuilt, 5 min if only the height goes up (tick "same course" on the class; no walk then) |
| Prize-giving after each class | 5 min |
| Jump-off allowance | 25% of starters at 75s each, added at the end of the class |
| Two-round classes | top 50% jump a second round |
| Lunch break | optional, per arena (time + minutes) |

- A class with a fixed start time starts at whichever is **later**: its scheduled time, or when the previous class (plus prize-giving, course change and walk) realistically ends. If it will start late, the class shows a red "later than scheduled" badge.
- A "follow" class starts as soon as the previous class plus changeover is done.
- On show day, "Now jumping" resets the clock for that class and everything after it in that arena. If nobody updates for a while, the next horse is moved to "now" rather than shown in the past.
- After 3 real rounds (changeable) the class uses its **real average** round time instead of the default.

## How to use it

1. Open the site on your phone. Tap **Load the sample show** to try it.
2. Or tap **Download blank template**, fill it in (Excel or Google Sheets → save as CSV), and load it.
3. Check the **Edit** screen, then tap **Looks good →**.
4. On show day, at the ring: type the draw number in **Now jumping #** and tap **Go** (or just tap **Next ▸** for each new horse). Tap a horse to scratch it or star it.
5. Tip: add the site to your home screen (Share → Add to Home Screen) for one-tap access.

## The CSV format

One row per horse:

```
arena,class_no,class_name,height,format,start_time,draw,rider,horse
Main Arena,1,Novice Two-Phase,0.90m,Two-phase,08:00,1,Zanele Visser,Stormy Rose
Main Arena,1,Novice Two-Phase,0.90m,Two-phase,,2,Lerato Mokoena,Lady Flame
Main Arena,2,Newcomers Speed,1.00m,Speed / Table A against the clock,follow,1,Anna Botha,Golden Dream
```

- **start_time** only needs to be on the first row of each class. Use `08:00` style times, or `follow` if the class starts after the previous class in that arena.
- **format** must be one of: `Speed / Table A against the clock`, `Two-phase`, `Jump-off (Table A with jump-off)`, `Two rounds`, `Accumulator`, `Other`. (Shorter words like "speed", "two phase", "jump-off" or article numbers such as 238.2.1 are recognised too.)
- Optional extra columns: `status` (`starting`, `scratched`, `done`) and `same_course` (`yes` if the course stays and only the height goes up). The CSV export includes these.
- Semicolon-separated files (common with Excel in South Africa) work too.

`sample-schedule.csv` is a made-up example show (2 arenas, 8 classes, 208 entries; all names are fictional). `sample-schedule.pdf` is a small made-up PDF for testing the PDF readers.

## Files

| File | What it is |
|---|---|
| `index.html` | The page |
| `style.css` | The look |
| `app.js` | All the logic (timing, live mode, reading files) |
| `config.js` | Your Supabase URL and public key only (placeholders until setup) |
| `sw.js`, `manifest.webmanifest`, `icon.svg` | Make it work offline and installable on a phone |
| `sample-schedule.csv`, `sample-schedule.pdf` | Test data |
| `supabase/functions/parse-schedule/index.ts` | The AI reading Edge Function (runs on Supabase, not on GitHub) |
| `supabase/setup.sql` | Database table + security rules + automatic 30-day clean-up |
| `SETUP-SUPABASE.md` | Step-by-step setup guide for the AI reading |

There is **no Anthropic API key anywhere in these files**, and there never should be.

---

## Putting it on GitHub Pages (beginner steps)

You only need a web browser.

1. Sign in at **github.com** as `equineintelligence`.
2. Click the **+** (top right) → **New repository**.
3. Repository name: `ringside-timer`. Choose **Public** (GitHub Pages is free for public repositories). Tick **Add a README file** is *not* needed. Click **Create repository**.
4. On the new empty repository page, click the link **uploading an existing file**.
5. Unzip the Ringside Timer folder on your computer. Open it, select **everything inside it** (including the `supabase` folder), and drag it all into the GitHub upload box.
   - Drag the *contents*, not the outer folder, so that `index.html` ends up at the top level of the repository.
6. Scroll down, type a message such as "First version", and click **Commit changes**.
7. Go to **Settings** (tab along the top of the repository) → **Pages** (left menu).
8. Under **Build and deployment** → **Source**, choose **Deploy from a branch**. Under **Branch**, choose **main** and **/ (root)**, then click **Save**.
9. Wait 1–2 minutes, refresh the page, and you'll see "Your site is live at https://equineintelligence.github.io/ringside-timer/". Open it on your phone.

**Updating later:** open the file on GitHub, click the pencil icon to edit (or "Add file → Upload files" to replace it), and commit. The site updates within a couple of minutes. Phones pick up the new version the next time the page is opened (if you change several files, also change `VERSION` at the top of `sw.js`, e.g. `rt-v2`, so phones refresh their offline copy).

## Privacy (POPIA)

- The show is saved only in the visitor's own browser.
- The free on-phone reader never sends the file anywhere.
- "Read schedule with AI" sends the file to an AI service (Anthropic, via your Supabase Edge Function) to be processed. Nothing from the schedule is stored. The only record kept is an anonymous daily-hashed IP, a timestamp and a success/fail flag, deleted automatically after 30 days.
