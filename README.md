# OurPets

A phone app (PWA) for looking after pets at home: medication with dose ticks, food/meds/supplies stock with days left, a store-by-store shopping run, weights, appointments and exam files. Works for one person or a shared household.

- **Frontend:** React + Vite + TypeScript, installable PWA (`vite-plugin-pwa`), hash routing so it runs on GitHub Pages.
- **Backend:** Supabase project `OurPets` (`gqasnxmvloofdphaminj`, eu-west-3): Auth (email + password), Postgres with row-level security, Storage bucket `pet-docs`.
- **Hosting:** GitHub Pages via `.github/workflows/deploy.yml` on every push to `main`.

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
```

The Supabase URL and publishable key are in `src/lib/supabase.ts` (safe to ship; RLS protects the data). Override with `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` if needed.

## Database

Migrations live in `supabase/migrations/` and are already applied to the project.

- A new account gets a profile, a one-person household and two stores (Zooplus, Newpet).
- Everyone in a household can read each other's pets and stock. Only a pet's owner can write its care (doses, weights, appointments, documents, stock).
- `create_invite()` / `accept_invite(code)` join someone into your household. Their pets and stock move with them.
- Exam files are stored at `pet-docs/<pet_id>/<file>`; only the household can read them.

## Product links

Pasting a store link in **Add to stock** calls the `product-lookup` Edge Function (`supabase/functions/product-lookup`). It reads the page server-side, takes name, photo, price, pack size and sizes from schema.org JSON-LD / Open Graph (Zooplus) or the page HTML (Newpet), and copies the photo into the household's `photos` bucket. Only public http(s) addresses are fetched.

Deploy changes with `supabase functions deploy product-lookup`.

## How the numbers work

- **Food:** days per pack = pack kg × 1000 ÷ total grams per day; days left counts down from the date the pack was opened.
- **Food by units** (cans, pouches, trays you don't weigh): you set how many days one unit lasts (for all pets together). The app assumes a new unit is opened every N days, so days left = (unopened + 1) × N − days since the current one was opened. “Opened a new can” takes one off and restarts the clock; if it's been 1.75× the usual time or more, the app asks whether that was one can or some weren't logged. After 3+ single taps it compares the median gap with your setting and offers to update it when they differ by 15% and 0.3 days or more. “+1 pack” adds a pack; “Count cans” fixes the number. Product links like “12 x 135 g” switch the item to units automatically.
- **(i) tips:** every non-obvious field or number has an (i) next to it. It opens on mouse-over, on tap (phones) and with the keyboard (`InfoTip` / `FieldLabel` in `src/components/ui.tsx`). New fields should get one when their meaning isn't obvious.
- **Supplies:** "one pack lasts N days", counted from the date opened.
- **Meds:** on hand at the last count, minus every scheduled dose since then. Days left = days until the next scheduled dose can't be covered. As-needed meds count down only when a dose is logged and alert at a threshold.
- **Reorder:** an item is due when days left − delivery lead time ≤ 7 days.

## Reminders

- The app subscribes each phone to Web Push (Profile → Reminders). On iPhone this only works from the home-screen app.
- `send-reminders` Edge Function runs every 5 minutes (pg_cron job `ourpets-reminders` → pg_net). It sends: each daily dose at its time, a morning summary (weekly/monthly doses, items to reorder, appointments today/tomorrow, vaccines due within 7 days), and appointments 2 hours before. Each reminder is sent once (`notification_log`).
- VAPID keys and the cron secret live in `private.app_config` (not in git). The public key is also in `src/lib/push.ts`.
- Also: an open can past its use-by time (08:00–22:00 only), and expiry dates within a week in the morning summary.
- The functions reuse the app's maths: after changing `src/lib/{calc,dates,types}.ts`, run `scripts/sync-shared.sh` and redeploy `send-reminders` and `calendar`.

## Timeline and health journal

- Each pet has a **Timeline** tab: journal notes, weights, medication changes, missed doses, past vet visits, vaccines given, files and vet/insurance/grooming costs, newest first, with filters.
- Journal notes (`health_notes`) have one-tap tags (ate less, vomited, drinking more…), optional text and a photo (stored in `pet-docs/<pet_id>/notes/`). The tab counts each tag over the last 30 days against the 30 days before.
- **Medication history** (`med_changes`) is written by a trigger on `stock_items` whenever a med's dose, schedule or status changes (plus a “started” row on insert). The edit form sends an optional reason in `stock_items.change_reason`; the trigger moves it into the history row and clears it. The pill count carries over: the form re-counts on-hand at the moment of the change.

## Costs

- `expenses` rows: amount, category, date, the pets it's for (`pet_ids`, split evenly), optional item, store and order.
- “I placed the order” in the Shopping run asks for quantities and the order total; each item becomes a line, and the difference (shipping or discount) becomes its own line. Undo removes the order's lines (`stock_items.last_order_id`).
- “Log a purchase” on a stock item covers things bought elsewhere; the + on the Costs page covers vet bills, insurance, grooming…
- The Costs page (`/costs`, `?pet=<id>` for one pet) shows the period total, 12 months by month, by pet, by type, and an estimate of what stock costs per month (price ÷ days a pack lasts × 30).

## Expiry dates

- `stock_items.expires_on`: shown on Stock and in the pet's Meds tab within 60 days, and on Today under “Check dates” when expired, within 14 days, or before the item would run out.
- `stock_items.open_life_hours` (food by units): how long an opened can keeps. The app shows a use-by time for the open can and warns (and pushes) when it's past.

## Calendar feed

- Profile → Calendar makes a private subscribe link: `…/functions/v1/calendar?t=<token>` (add `&scope=all` for the whole household). The `calendar` Edge Function (JWT off; the 64-char token from `calendar_token()` is the key) returns iCalendar with appointments, vaccines due (all-day) and “Order …” on each item's reorder-by date (all-day, moves as counts change).
- “Make a new link” rotates the token; the old link stops working.

## Doses

Pill counts are automatic: once a dose time passes it counts as given. Tap a dose (Today, or a day in the pet's Meds week) to mark it missed; that gives the pill back to the count. Tap again to mark it given.

## Not built yet

- Data export / backup
- Cover for a partner while the owner is away (log doses for their pets)
- Lab values from exam uploads, charted per parameter
