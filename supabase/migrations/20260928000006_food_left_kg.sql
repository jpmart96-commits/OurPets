-- Food: how much was left at the last count; the app counts down from there using daily grams.
alter table public.stock_items add column left_kg numeric(8,3);
alter table public.stock_items add column left_counted_at timestamptz;
