-- Food tracked by units (cans, pouches, trays) instead of weight.
-- units_left = unopened units at the moment the current one was opened (unit_opened_at).
-- The app assumes a new unit is opened every unit_days days; "Opened a new can" corrects it.
alter table public.stock_items add column track_by text not null default 'weight' check (track_by in ('weight', 'units'));
alter table public.stock_items add column unit_label text not null default 'can' check (unit_label in ('can', 'pouch', 'tray', 'sachet'));
alter table public.stock_items add column pack_units integer check (pack_units is null or pack_units > 0);
alter table public.stock_items add column unit_days numeric(6,2) check (unit_days is null or unit_days > 0);
alter table public.stock_items add column units_left integer check (units_left is null or units_left >= 0);
alter table public.stock_items add column unit_opened_at timestamptz;
-- Last logged openings, newest last: [{"at": "<iso>", "n": 1}], n = units the tap accounted for.
alter table public.stock_items add column unit_opens jsonb not null default '[]'::jsonb;
