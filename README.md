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

## Not built yet

- Push notifications (Web Push + scheduled Edge Function)
- Lab values from exam uploads, charted per parameter
