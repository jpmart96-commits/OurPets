-- Things that aren't bought on a cycle:
--  • food/supplies used now and then (treats, shampoo, a spare leash): track_by = 'count'. on_hand is how many are left,
--    alert_at the low mark. rebuy = false means "not bought again": at 0 it moves to Finished ("Used up").
--  • order_next: put an item in the next Shopping run once, even if it isn't running low. Cleared when it arrives.
--  • ends_on: a medication course with a last day (e.g. a 10-day antibiotic). No reorder once the course is covered,
--    and it moves to Finished by itself the day after (hourly job below; the med-change trigger records it).
--  • expenses.one_off: a purchase that isn't part of normal monthly spending (a carrier, a bed). Counted in totals,
--    left out of the monthly average.

alter table public.stock_items drop constraint stock_items_track_by_check;
alter table public.stock_items add constraint stock_items_track_by_check check (track_by in ('weight', 'units', 'count'));
alter table public.stock_items add column rebuy boolean not null default true;
alter table public.stock_items add column order_next boolean not null default false;
alter table public.stock_items add column ends_on date;
alter table public.stock_items add constraint stock_items_ends_on_check check (ends_on is null or start_date is null or ends_on >= start_date);

alter table public.expenses add column one_off boolean not null default false;

create or replace function private.finish_ended_courses()
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.stock_items s
     set status = 'finished', change_reason = 'Course ended'
    from public.profiles p
   where p.id = s.owner_id
     and s.type = 'med' and s.status = 'active' and s.ends_on is not null
     and s.ends_on < (now() at time zone coalesce(
           (select z.name from pg_catalog.pg_timezone_names z where z.name = p.timezone), 'Europe/Lisbon'))::date;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function private.finish_ended_courses() from public, anon, authenticated;

select cron.schedule('ourpets-finish-courses', '11 * * * *', 'select private.finish_ended_courses()');
