-- Health journal, medication change history, costs, expiry dates and the calendar feed.

-- ───────────────────────── Health journal ─────────────────────────
-- Quick notes per pet: one-tap tags (vomited, ate less…), optional text and photo.
-- Photos go in the pet-docs bucket at <pet_id>/notes/<file>, so the existing storage rules apply.
create table public.health_notes (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  noted_at timestamptz not null default now(),
  tags text[] not null default '{}' check (cardinality(tags) <= 12),
  note text check (length(note) <= 2000),
  photo_path text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.health_notes(pet_id, noted_at desc);
create index on public.health_notes(created_by);
alter table public.health_notes enable row level security;
create policy "read health notes" on public.health_notes for select to authenticated using (private.can_see_pet(pet_id));
create policy "owner adds health notes" on public.health_notes for insert to authenticated with check (private.owns_pet(pet_id));
create policy "owner edits health notes" on public.health_notes for update to authenticated using (private.owns_pet(pet_id)) with check (private.owns_pet(pet_id));
create policy "owner deletes health notes" on public.health_notes for delete to authenticated using (private.owns_pet(pet_id));

-- ───────────────────────── Stock item additions ─────────────────────────
alter table public.stock_items
  -- best-before / expiry of the box or pack in use
  add column expires_on date,
  -- food by units: how long an opened can/pouch keeps (in the fridge)
  add column open_life_hours integer check (open_life_hours between 1 and 720),
  -- the order that last put this item in "ordered" (so Undo can remove its costs)
  add column last_order_id uuid,
  -- write-only: the reason for a dose/schedule change; moved into med_changes by a trigger
  add column change_reason text check (length(change_reason) <= 300);

-- ───────────────────────── Medication change history ─────────────────────────
create table public.med_changes (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.stock_items(id) on delete cascade,
  changed_at timestamptz not null default now(),
  kind text not null check (kind in ('start', 'change')),
  dose numeric(6,2),
  frequency text,
  dose_times text[],
  status text,
  prev_dose numeric(6,2),
  prev_frequency text,
  prev_dose_times text[],
  prev_status text,
  reason text check (length(reason) <= 300),
  changed_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.med_changes(item_id, changed_at);
create index on public.med_changes(changed_by);
alter table public.med_changes enable row level security;
create policy "read med changes" on public.med_changes for select to authenticated using (private.can_see_item(item_id));
create policy "owner edits med change reason" on public.med_changes for update to authenticated using (private.owns_item(item_id)) with check (private.owns_item(item_id));
-- rows are written by the trigger only; the owner may edit the reason afterwards
revoke insert, delete, update on public.med_changes from authenticated, anon;
grant update (reason) on public.med_changes to authenticated;

create or replace function private.med_change_before()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.type = 'med' and (
       new.dose is distinct from old.dose
    or new.frequency is distinct from old.frequency
    or new.dose_times is distinct from old.dose_times
    or new.status is distinct from old.status) then
    insert into public.med_changes (item_id, kind, dose, frequency, dose_times, status, prev_dose, prev_frequency, prev_dose_times, prev_status, reason, changed_by)
    values (new.id, 'change', new.dose, new.frequency, new.dose_times, new.status, old.dose, old.frequency, old.dose_times, old.status,
            nullif(btrim(new.change_reason), ''), auth.uid());
  end if;
  new.change_reason := null;
  return new;
end;
$$;

create or replace function private.med_change_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.type = 'med' then
    insert into public.med_changes (item_id, changed_at, kind, dose, frequency, dose_times, status, changed_by)
    values (new.id, least(now(), coalesce(new.start_date::timestamptz, now())), 'start', new.dose, new.frequency, new.dose_times, new.status, auth.uid());
  end if;
  return null;
end;
$$;

create trigger stock_items_med_change_before
  before insert or update on public.stock_items
  for each row execute function private.med_change_before();
create trigger stock_items_med_change_after_insert
  after insert on public.stock_items
  for each row execute function private.med_change_after_insert();

-- existing meds get a "started" entry
insert into public.med_changes (item_id, changed_at, kind, dose, frequency, dose_times, status, changed_by)
select id, least(now(), coalesce(start_date::timestamptz, created_at)), 'start', dose, frequency, dose_times, status, owner_id
from public.stock_items where type = 'med';

-- ───────────────────────── Costs ─────────────────────────
create or replace function private.owns_pets(p uuid[])
returns boolean language sql stable security definer set search_path = '' as $$
  select (select count(*) from public.pets where id = any(p) and owner_id = auth.uid())
       = (select count(distinct x) from unnest(p) x)
$$;
grant execute on function private.owns_pets(uuid[]) to authenticated;

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  spent_on date not null default current_date,
  amount numeric(10,2) not null check (amount between -100000 and 100000),
  category text not null check (category in ('food', 'med', 'supply', 'vet', 'insurance', 'grooming', 'shipping', 'other')),
  title text not null check (length(title) between 1 and 120),
  -- the pets this is for; the amount is split evenly between them
  pet_ids uuid[] not null default '{}',
  item_id uuid references public.stock_items(id) on delete set null,
  store_id uuid references public.stores(id) on delete set null,
  -- lines logged together from one shopping-run order share an order_id
  order_id uuid,
  quantity numeric(8,2),
  note text check (length(note) <= 500),
  created_at timestamptz not null default now()
);
create index on public.expenses(household_id, spent_on);
create index on public.expenses(owner_id);
create index on public.expenses(item_id);
create index on public.expenses(store_id);
create index on public.expenses(order_id);
alter table public.expenses enable row level security;
create policy "members read expenses" on public.expenses for select to authenticated using (private.is_member(household_id));
create policy "owner adds expenses" on public.expenses for insert to authenticated
  with check (owner_id = (select auth.uid()) and household_id = private.my_household_id() and private.owns_pets(pet_ids));
create policy "owner edits expenses" on public.expenses for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and household_id = private.my_household_id() and private.owns_pets(pet_ids));
create policy "owner deletes expenses" on public.expenses for delete to authenticated using (owner_id = (select auth.uid()));

-- joining a household brings your expenses along
create or replace function public.accept_invite(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  inv public.household_invites%rowtype;
  old_h uuid := private.my_household_id();
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into inv from public.household_invites where code = lower(trim(p_code)) for update;
  if not found then raise exception 'invite not found'; end if;
  if inv.used_at is not null then raise exception 'invite already used'; end if;
  if inv.expires_at < now() then raise exception 'invite expired'; end if;
  if inv.household_id = old_h then raise exception 'already in this household'; end if;

  update public.pets set household_id = inv.household_id where owner_id = me and household_id = old_h;
  update public.stock_items s set store_id = ns.id
    from public.stores os, public.stores ns
    where s.owner_id = me and s.household_id = old_h and s.store_id = os.id
      and ns.household_id = inv.household_id and lower(ns.name) = lower(os.name);
  update public.expenses e set store_id = ns.id
    from public.stores os, public.stores ns
    where e.owner_id = me and e.household_id = old_h and e.store_id = os.id
      and ns.household_id = inv.household_id and lower(ns.name) = lower(os.name);
  update public.stores st set household_id = inv.household_id
    where st.household_id = old_h
      and (exists (select 1 from public.stock_items s where s.store_id = st.id and s.owner_id = me)
        or exists (select 1 from public.expenses e where e.store_id = st.id and e.owner_id = me))
      and not exists (select 1 from public.stores ns where ns.household_id = inv.household_id and lower(ns.name) = lower(st.name));
  update public.stock_items set household_id = inv.household_id where owner_id = me and household_id = old_h;
  update public.expenses set household_id = inv.household_id where owner_id = me and household_id = old_h;

  delete from public.household_members where user_id = me;
  insert into public.household_members (household_id, user_id, role) values (inv.household_id, me, 'member');
  update public.household_invites set used_by = me, used_at = now() where code = inv.code;
  update public.profiles set shares_home = true where id = me;

  delete from public.households h where h.id = old_h
    and not exists (select 1 from public.household_members m where m.household_id = old_h);
  return inv.household_id;
end;
$$;
revoke execute on function public.accept_invite(text) from public, anon;
grant execute on function public.accept_invite(text) to authenticated;

-- ───────────────────────── Calendar feed ─────────────────────────
-- A private subscribe link per person. The token is the only key, so it can be reset.
create table public.calendar_feeds (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now()
);
alter table public.calendar_feeds enable row level security;
create policy "own calendar feed" on public.calendar_feeds for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.calendar_token(p_reset boolean default false)
returns text language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  t text;
begin
  if me is null then raise exception 'not signed in'; end if;
  if p_reset then delete from public.calendar_feeds where user_id = me; end if;
  insert into public.calendar_feeds (user_id, token)
  values (me, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
  on conflict (user_id) do nothing;
  select token into t from public.calendar_feeds where user_id = me;
  return t;
end;
$$;
revoke execute on function public.calendar_token(boolean) from public, anon;
grant execute on function public.calendar_token(boolean) to authenticated;
