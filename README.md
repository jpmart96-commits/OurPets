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
- **Supplies:** "one pack lasts N days", counted from the date opened.
- **Meds:** on hand at the last count, minus every scheduled dose since then. Days left = days until the next scheduled dose can't be covered. As-needed meds count down only when a dose is logged and alert at a threshold.
- **Reorder:** an item is due when days left − delivery lead time ≤ 7 days.

## Reminders

- The app subscribes each phone to Web Push (Profile → Reminders). On iPhone this only works from the home-screen app.
- `send-reminders` Edge Function runs every 5 minutes (pg_cron job `ourpets-reminders` → pg_net). It sends: each daily dose at its time, a morning summary (weekly/monthly doses, items to reorder, appointments today/tomorrow, vaccines due within 7 days), and appointments 2 hours before. Each reminder is sent once (`notification_log`).
- VAPID keys and the cron secret live in `private.app_config` (not in git). The public key is also in `src/lib/push.ts`.
- The function reuses the app's maths: after changing `src/lib/{calc,dates,types}.ts`, run `scripts/sync-shared.sh` and redeploy.

## Doses

Pill counts are automatic: once a dose time passes it counts as given. Tap a dose (Today, or a day in the pet's Meds week) to mark it missed; that gives the pill back to the count. Tap again to mark it given.

## Not built yet

- Data export / backup
- Lab values from exam uploads, charted per parameter
