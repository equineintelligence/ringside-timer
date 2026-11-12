# Setting up AI schedule reading (Supabase + Claude)

This guide sets up **sign-in accounts** and the **"Read schedule with AI"** button. Because people must sign in to use Ringside Timer, Supabase is required.

You'll use only websites, no command line. Allow about 45 minutes. Website menus change from time to time; if what you see doesn't match, look for a similar name nearby (and ask Claude to help you find it).

## How it fits together (and why the keys are different)

```
Phone (GitHub Pages website)  ──►  Supabase Edge Function "parse-schedule"  ──►  Claude (Anthropic API)
   uses: project URL +               adds the secret ANTHROPIC_API_KEY,
   public anon/publishable key       checks limits, checks the answer
```

- **The Supabase anon / publishable key is safe to be public.** It's designed to sit in website code. On its own it can only do what your security rules allow. Here that means: create an account, sign in, and call the parse-schedule function (which also checks the person is signed in). The database table is locked with Row Level Security, so the key can't read or change it.
- **The Anthropic API key is NOT safe to be public.** Anyone who has it can use Claude on *your* account and run up *your* bill. So it is stored only as a secret inside Supabase, where the website (and visitors) can never see it. Never paste it into `config.js`, GitHub, an email or a chat.
- Real protection against abuse comes from: the login check and daily limits in the function (10 reads per account, 200 for everyone), the 5 MB / 100,000-character size limits, and the **monthly spend limit** you set at Anthropic in Step 1. (The "only accept requests from equineintelligence.github.io" check stops other websites using your function, but someone determined could still fake it, which is why the limits matter.)

---

## Step 1 — Create your Anthropic API key and a spend limit

1. Go to **console.anthropic.com** (it may take you to platform.claude.com, which is the same Claude Console) and sign in or create an account.
2. Add credit: **Settings → Billing** → buy a small amount of credit (e.g. USD 5–10). The API won't work with zero credit.
3. Set a spend limit: **Settings → Limits** → set a **monthly spend limit** (e.g. USD 10). If it is reached, AI reading simply stops until next month; the rest of the site keeps working.
4. Create the key: **Settings → API Keys → Create Key**. Name it `ringside-timer`.
5. Copy the key (it starts with `sk-ant-`) and keep it somewhere private for a few minutes (e.g. a password manager). **You won't be shown it again.** If you lose it, delete it and create a new one.

✅ You should have: a key starting `sk-ant-…`, and a monthly limit showing in Limits.

**Rough cost:** the function uses Claude Haiku, the fast low-cost model. A typical schedule costs a fraction of a US cent to read; even 200 reads a day would be in the region of a dollar or two. Check the current prices on Anthropic's pricing page.

## Step 2 — Create a Supabase project

1. Go to **supabase.com** → **Start your project** and sign in (signing in with GitHub is easiest).
2. Click **New project**.
3. Fill in:
   - **Name:** `ringside-timer`
   - **Database password:** click **Generate a password** and save it in your password manager (you won't need it for this guide).
   - **Region:** Supabase has no African region. Choose **West Europe (London)** or **Central EU (Frankfurt)**; these usually have the best connection from South Africa.
   - Plan: **Free**.
4. Click **Create new project** and wait 1–2 minutes until the dashboard appears.

✅ You should see your project's home page with a left-hand menu (Table Editor, SQL Editor, Edge Functions, …).

## Step 3 — Create the table and security rules

1. In the left menu click **SQL Editor**.
2. Click **New query** (or the **+**).
3. Open `supabase/setup.sql` from the Ringside Timer folder (any text editor, e.g. Notepad, or view it on GitHub), select all, copy, and paste it into the editor.
4. Click **Run** (bottom right), or press Ctrl+Enter / Cmd+Enter.

✅ You should see **"Success. No rows returned"** (or a small result table showing a job number). If it asks you to confirm a "destructive operation", that's just the `revoke` line; click to run it anyway.

What this did:
- Created the `parse_requests` table (scrambled account ID, time, success flag only).
- Turned on **Row Level Security** with no policies, so the public can't touch it.
- Scheduled an automatic job (pg_cron) that deletes rows older than 30 days, every night.

To check: left menu **Table Editor** → `parse_requests` should be listed with a label like "RLS enabled". Left menu **Integrations → Cron** (or **Database → Cron**) should show the job `ringside-delete-old-parse-requests`.

## Step 4 — Create the Edge Function

1. In the left menu click **Edge Functions**.
2. Click **Deploy a new function** → **Via Editor** (sometimes shown as "Open Editor").
3. Delete the example code in the editor.
4. Open `supabase/functions/parse-schedule/index.ts` from the folder, copy everything, and paste it in.
5. Set the **function name** to exactly: `parse-schedule` (bottom of the editor or in a name box).
6. Click **Deploy function**. Wait for it to finish (up to a minute).

✅ You should land on the function's page showing its name `parse-schedule` and a URL.

## Step 5 — Add your Anthropic key as a secret

1. In the left menu click **Edge Functions → Secrets** (if not there, try **Project Settings → Edge Functions**).
2. Add a new secret:
   - **Key / Name:** `ANTHROPIC_API_KEY`
   - **Value:** paste your `sk-ant-…` key from Step 1.
3. Optional but recommended, add another:
   - **Key:** `IP_HASH_SALT`  **Value:** any long random text (e.g. mash the keyboard for 30 characters). This makes the scrambled account IDs impossible to reverse.
4. Click **Save**.

✅ You should see `ANTHROPIC_API_KEY` in the list, with its value hidden. Now delete the copy of the key from wherever you kept it temporarily.

## Step 6 — Allow public calls and find the function URL

Supabase's built-in "Verify JWT" check only works with the old-style keys, so it's switched off and the function checks the login itself (it rejects anyone who isn't signed in).

1. Go to **Edge Functions** → click **parse-schedule** → **Details** (or **Settings**).
2. Find the setting called **Verify JWT** / **Enforce JWT verification** and turn it **OFF**. Click **Save** if there is a button.
3. On the same page, find the **Endpoint URL**. It looks like:
   `https://abcdefghijkl.supabase.co/functions/v1/parse-schedule`

✅ The part before `/functions/v1/...` (`https://abcdefghijkl.supabase.co`) is your **project URL**. You'll need it next.

## Step 7 — Put your project URL and public key into config.js

1. Find your public key: left menu **Project Settings** (cog icon) → **API Keys**.
   - Copy the **Publishable key** (starts with `sb_publishable_…`).
   - If you only see "anon public" (a long key starting `eyJ…`, sometimes under a **Legacy API keys** tab), that works too.
   - ⚠️ Do **not** copy the **secret** / **service_role** key. That one must stay private.
2. Open `config.js` and replace the two placeholder values:

```js
window.RINGSIDE_CONFIG = {
  SUPABASE_URL: "https://abcdefghijkl.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_xxxxxxxxxxxxxxxxxxxx"
};
```

3. Save. (On GitHub: open `config.js` in your repository → pencil icon → edit → **Commit changes**.)

✅ Once the site updates, choosing a PDF or Excel file on the Load screen shows a second button: **Read schedule with AI**.

## Step 8 — Test the function

**Quick check in Supabase:** the function needs a signed-in user, so a request from the Test panel (which has no user login) should return `401` with `"code": "login_required"`. That shows the lock works. The real test is: sign in on the website and use **Read schedule with AI** on `sample-schedule.pdf`.

**Older test (from before logins were added), for reference:**

1. **Edge Functions → parse-schedule** → click **Test** (top right).
2. Method **POST**. Add a header: name `Origin`, value `http://localhost:8000`.
3. Body:
```json
{ "kind": "text", "text": "Main Arena\nClass 1 0.90m Two-phase 08:00\nDraw\tRider\tHorse\n1\tAnna Botha\tSilver Moon\n2\tBen Nkosi\tKaroo Star" }
```
4. Click **Send request**.

**Success** looks like (status 200):
```json
{ "ok": true, "model": "claude-haiku-5-5", "show": { "show_name": "", "classes": [ { "arena": "Main Arena", "class_no": "1", "format": "Two-phase", "start_time": "08:00", "entries": [ ... ] } ] } }
```

**Failures** look like `{ "ok": false, "code": "...", "error": "..." }`:

| code | Meaning | Fix |
|---|---|---|
| `not_configured` | No `ANTHROPIC_API_KEY` secret | Redo Step 5 (exact name) |
| `login_required` (401) | Not signed in, or the sign-in expired | Sign in again on the website |
| `forbidden_origin` (403) | The request didn't come from your site or localhost | Add the `Origin` header in the test |
| `parse_failed` (422) | Claude's answer couldn't be used, or the Anthropic call failed | Check **Logs** for "Anthropic API error"; 401 = wrong key, 400 with "credit" = add credit, 404 = model name changed |
| `rate_limit_user` / `rate_limit_global` (429) | Daily limit reached | Normal; see Step 10 |
| `db_error` (503) | The table is missing | Redo Step 3 |
| 401 "Invalid JWT" / "Missing authorization header" | JWT verification still on | Redo Step 6 |

**Real PDF test:** after Step 9, open your live site, choose `sample-schedule.pdf`, tap **Read schedule with AI**, and check that 3 classes appear on the Check & edit screen.

To see what happened on any request: **Edge Functions → parse-schedule → Logs**. (Logs never contain the schedule contents.)

## Step 9 — Publish on GitHub Pages

Follow **"Putting it on GitHub Pages"** in `README.md` (repository `ringside-timer`, upload the files, Settings → Pages → Deploy from a branch → `main` / root). Then check:

- https://equineintelligence.github.io/ringside-timer opens on your phone.
- **Load the sample show** works.
- With `config.js` filled in, the AI button appears for PDF/Excel files and `sample-schedule.pdf` reads correctly.
- Turn on flight mode and refresh: the app still opens with your show.

## Step 10 — Checking usage and costs later, and changing limits

- **Anthropic costs:** Claude Console → **Usage** and **Cost** pages. Adjust **Settings → Limits** if needed.
- **How many AI reads:** Supabase → **SQL Editor** → run:
  ```sql
  select date_trunc('day', created_at) as day,
         count(*) filter (where success) as ok,
         count(*) filter (where not success) as failed
  from public.parse_requests group by 1 order by 1 desc;
  ```
- **Change the daily limits (no code change needed):** **Edge Functions → Secrets** → add or edit:
  - `USER_DAILY_LIMIT` (default 10 per person per day)
  - `GLOBAL_DAILY_LIMIT` (default 200 for everyone per day)
- **Change the AI model:** add a secret `CLAUDE_MODEL` (e.g. a newer Haiku name from docs.claude.com), or edit `DEFAULT_MODEL` near the top of the function code and deploy again.
- **Turn AI reading off quickly:** delete the `ANTHROPIC_API_KEY` secret, or set `GLOBAL_DAILY_LIMIT` to `0`. The website keeps working with the free reader.
- **Check the 30-day clean-up ran:** SQL Editor → `select * from cron.job_run_details order by start_time desc limit 5;`
- **Free plan note:** Supabase may pause free projects after a week with no activity. If AI reading stops working after a quiet spell, open the Supabase dashboard and click **Restore project**.

## Step 11 — Set up sign-in (Supabase Auth)

1. **Authentication → URL Configuration**:
   - **Site URL:** `https://equineintelligence.github.io/ringside-timer/`
   - **Redirect URLs:** add `https://equineintelligence.github.io/ringside-timer/**` (and `http://localhost:8000/**` if you test on your computer).
   These make the "confirm your email" and "reset password" links come back to your site.
2. **Authentication → Sign In / Providers → Email:** make sure Email is enabled and set the **minimum password length** to 8.
3. **Emails (important):** Supabase's built-in email sender only delivers to members of your own Supabase team, and only about 2 emails an hour. For the public there are two options:
   - **Quick start:** turn **off** "Confirm email". People can sign up and use the app straight away. (Password-reset emails still won't reach the public until you do the next option.)
   - **Proper set-up (recommended before you promote the site):** connect a free email service under **Authentication → Emails → SMTP Settings** (for example Brevo or Resend), then turn "Confirm email" back on. You need an email address or domain you control to send from.
4. Test: open the site, **Create account**, sign in, load the sample show, sign out and back in, and try **Forgot your password?**.

To see who has signed up: **Authentication → Users**. You can delete a user there if they ask (POPIA).

## POPIA notes

- Accounts store an email address and a hashed password in Supabase Auth (hosted in the EU). People agree to this on the sign-up form. Put a contact email in `config.js` (`CONTACT_EMAIL`) so users know who to ask to see, correct or delete their details.

- Running orders contain riders' names (personal information). The function processes the file and returns the result; it does not store schedule contents or results anywhere.
- The file is processed by Anthropic (in the USA), and Supabase runs in Europe, so this is a cross-border transfer. The privacy note on the site tells users this happens only if they choose AI reading; the free reader keeps everything on the phone.
- `parse_requests` stores only a scrambled account ID (re-scrambled with a new daily value, so it can't be linked across days), a timestamp and success/fail, and is deleted after 30 days.
