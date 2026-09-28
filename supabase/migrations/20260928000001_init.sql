-- OurPets: initial schema
-- Household -> members -> pets (each pet has one owner). Everything is scoped to a household.

create schema if not exists private;
grant usage on schema private to authenticated;

-- ───────────────────────── Core tables ─────────────────────────

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Home',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  shares_home boolean not null default false,
  morning_summary time not null default '08:00',
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
-- v1: a person belongs to exactly one household
create unique index household_members_one_per_user on public.household_members(user_id);

create table public.household_invites (
  code text primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '7 days',
  used_by uuid references auth.users(id) on delete set null,
  used_at timestamptz
);
create index on public.household_invites(household_id);

create table public.pets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  species text not null default 'dog' check (species in ('dog', 'cat', 'other')),
  breed text,
  sex text check (sex in ('male', 'female')),
  neutered boolean,
  birth_date date,
  microchip text,
  vet_name text,
  notes text,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.pets(household_id);
create index on public.pets(owner_id);

create table public.weights (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  measured_on date not null default current_date,
  kg numeric(6,2) not null check (kg > 0 and kg < 200),
  note text,
  created_at timestamptz not null default now()
);
create index on public.weights(pet_id, measured_on);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  title text not null,
  starts_at timestamptz not null,
  location text,
  notes text,
  created_at timestamptz not null default now()
);
create index on public.appointments(pet_id, starts_at);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  title text not null,
  taken_on date,
  storage_path text not null,
  mime_type text,
  size_bytes integer,
  created_at timestamptz not null default now()
);
create index on public.documents(pet_id);

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  cart_url text,
  free_shipping_threshold numeric(8,2),
  created_at timestamptz not null default now()
);
create index on public.stores(household_id);

create table public.stock_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('food', 'med', 'supply')),
  name text not null check (length(name) between 1 and 120),
  status text not null default 'active' check (status in ('active', 'paused', 'finished')),
  source text not null default 'store' check (source in ('store', 'vet')),
  store_id uuid references public.stores(id) on delete set null,
  product_url text,
  cart_url text,
  price numeric(8,2),
  lead_days integer not null default 4 check (lead_days between 0 and 60),
  -- food: pack size in kg, daily grams per pet live in stock_item_pets
  pack_kg numeric(8,3),
  -- food & supply: when the current pack was opened
  opened_on date,
  -- supply: how many days one pack lasts
  pack_days integer,
  -- medication
  form text check (form in ('tablet', 'chew', 'capsule', 'sachet', 'dose')),
  dose numeric(6,2),
  frequency text check (frequency in ('daily', 'weekly', 'monthly', 'as_needed')),
  dose_times text[],
  start_date date,
  box_size numeric(8,2),
  on_hand numeric(8,2),
  counted_at timestamptz,
  alert_at numeric(8,2) default 2,
  -- shopping run state
  in_cart boolean not null default false,
  ordered_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.stock_items(household_id);
create index on public.stock_items(owner_id);
create index on public.stock_items(store_id);

create table public.stock_item_pets (
  item_id uuid not null references public.stock_items(id) on delete cascade,
  pet_id uuid not null references public.pets(id) on delete cascade,
  daily_grams numeric(8,2),
  primary key (item_id, pet_id)
);
create index on public.stock_item_pets(pet_id);

create table public.dose_logs (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.stock_items(id) on delete cascade,
  pet_id uuid not null references public.pets(id) on delete cascade,
  slot_date date not null,
  slot_time text not null default '',
  given_at timestamptz not null default now(),
  given_by uuid references auth.users(id) on delete set null default auth.uid(),
  unique (item_id, slot_date, slot_time)
);
create index on public.dose_logs(pet_id, slot_date);

-- ───────────────────────── Helper functions (private) ─────────────────────────

create or replace function private.my_household_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select household_id from public.household_members where user_id = auth.uid() limit 1
$$;

create or replace function private.is_member(h uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.household_members where household_id = h and user_id = auth.uid())
$$;

create or replace function private.can_see_pet(p uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.pets pt
    join public.household_members m on m.household_id = pt.household_id
    where pt.id = p and m.user_id = auth.uid()
  )
$$;

create or replace function private.owns_pet(p uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.pets where id = p and owner_id = auth.uid())
$$;

create or replace function private.can_see_item(i uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.stock_items s
    join public.household_members m on m.household_id = s.household_id
    where s.id = i and m.user_id = auth.uid()
  )
$$;

create or replace function private.owns_item(i uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.stock_items where id = i and owner_id = auth.uid())
$$;

grant execute on all functions in schema private to authenticated;

-- ───────────────────────── Row level security ─────────────────────────

alter table public.households enable row level security;
alter table public.profiles enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;
alter table public.pets enable row level security;
alter table public.weights enable row level security;
alter table public.appointments enable row level security;
alter table public.documents enable row level security;
alter table public.stores enable row level security;
alter table public.stock_items enable row level security;
alter table public.stock_item_pets enable row level security;
alter table public.dose_logs enable row level security;

-- households
create policy "members read household" on public.households for select to authenticated
  using (private.is_member(id));
create policy "members rename household" on public.households for update to authenticated
  using (private.is_member(id)) with check (private.is_member(id));

-- profiles: yourself, plus people in your household
create policy "read own and housemates" on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists (select 1 from public.household_members m where m.user_id = profiles.id and private.is_member(m.household_id))
  );
create policy "update own profile" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- members (writes only through functions)
create policy "members read members" on public.household_members for select to authenticated
  using (private.is_member(household_id));

-- invites (created through create_invite)
create policy "members read invites" on public.household_invites for select to authenticated
  using (private.is_member(household_id));

-- pets
create policy "members read pets" on public.pets for select to authenticated
  using (private.is_member(household_id));
create policy "owner adds pet" on public.pets for insert to authenticated
  with check (owner_id = (select auth.uid()) and household_id = private.my_household_id());
create policy "owner edits pet" on public.pets for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and household_id = private.my_household_id());
create policy "owner deletes pet" on public.pets for delete to authenticated
  using (owner_id = (select auth.uid()));

-- pet child tables: household reads, owner writes
create policy "read weights" on public.weights for select to authenticated using (private.can_see_pet(pet_id));
create policy "owner writes weights" on public.weights for all to authenticated
  using (private.owns_pet(pet_id)) with check (private.owns_pet(pet_id));

create policy "read appointments" on public.appointments for select to authenticated using (private.can_see_pet(pet_id));
create policy "owner writes appointments" on public.appointments for all to authenticated
  using (private.owns_pet(pet_id)) with check (private.owns_pet(pet_id));

create policy "read documents" on public.documents for select to authenticated using (private.can_see_pet(pet_id));
create policy "owner writes documents" on public.documents for all to authenticated
  using (private.owns_pet(pet_id)) with check (private.owns_pet(pet_id));

create policy "read dose logs" on public.dose_logs for select to authenticated using (private.can_see_pet(pet_id));
create policy "owner logs doses" on public.dose_logs for all to authenticated
  using (private.owns_pet(pet_id)) with check (private.owns_pet(pet_id) and private.owns_item(item_id));

-- stores: shared by the household
create policy "members manage stores" on public.stores for all to authenticated
  using (private.is_member(household_id)) with check (private.is_member(household_id));

-- stock
create policy "members read stock" on public.stock_items for select to authenticated
  using (private.is_member(household_id));
create policy "owner adds stock" on public.stock_items for insert to authenticated
  with check (owner_id = (select auth.uid()) and household_id = private.my_household_id());
create policy "owner edits stock" on public.stock_items for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and household_id = private.my_household_id());
create policy "owner deletes stock" on public.stock_items for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy "read stock pets" on public.stock_item_pets for select to authenticated
  using (private.can_see_item(item_id));
create policy "owner links stock pets" on public.stock_item_pets for all to authenticated
  using (private.owns_item(item_id)) with check (private.owns_item(item_id) and private.owns_pet(pet_id));

-- ───────────────────────── New user setup ─────────────────────────

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  h uuid;
  nm text := coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), split_part(new.email, '@', 1));
begin
  insert into public.profiles (id, display_name) values (new.id, nm);
  insert into public.households (name, created_by) values (nm || '''s home', new.id) returning id into h;
  insert into public.household_members (household_id, user_id, role) values (h, new.id, 'owner');
  insert into public.stores (household_id, name, cart_url, free_shipping_threshold) values
    (h, 'Zooplus', 'https://www.zooplus.pt/checkout/cart', null),
    (h, 'Newpet', 'https://www.newpet.pt/cart', 49);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ───────────────────────── Invites ─────────────────────────

create or replace function public.create_invite()
returns text language plpgsql security definer set search_path = '' as $$
declare
  h uuid := private.my_household_id();
  c text;
begin
  if auth.uid() is null or h is null then raise exception 'not signed in'; end if;
  c := lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.household_invites (code, household_id, created_by) values (c, h, auth.uid());
  update public.profiles set shares_home = true where id = auth.uid();
  return c;
end;
$$;

-- Joining moves the joiner's pets, stock and doc-free data into the inviting household.
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

  -- carry over the joiner's pets and stock
  update public.pets set household_id = inv.household_id where owner_id = me and household_id = old_h;
  -- remap store links to a same-named store in the new household when there is one
  update public.stock_items s set store_id = ns.id
    from public.stores os, public.stores ns
    where s.owner_id = me and s.household_id = old_h and s.store_id = os.id
      and ns.household_id = inv.household_id and lower(ns.name) = lower(os.name);
  -- stores with no match move over too
  update public.stores st set household_id = inv.household_id
    where st.household_id = old_h
      and exists (select 1 from public.stock_items s where s.store_id = st.id and s.owner_id = me)
      and not exists (select 1 from public.stores ns where ns.household_id = inv.household_id and lower(ns.name) = lower(st.name));
  update public.stock_items set household_id = inv.household_id where owner_id = me and household_id = old_h;

  delete from public.household_members where user_id = me;
  insert into public.household_members (household_id, user_id, role) values (inv.household_id, me, 'member');
  update public.household_invites set used_by = me, used_at = now() where code = inv.code;
  update public.profiles set shares_home = true where id = me;

  -- drop the old household if nobody is left in it
  delete from public.households h where h.id = old_h
    and not exists (select 1 from public.household_members m where m.household_id = old_h);
  return inv.household_id;
end;
$$;

revoke execute on function public.create_invite() from public, anon;
revoke execute on function public.accept_invite(text) from public, anon;
grant execute on function public.create_invite() to authenticated;
grant execute on function public.accept_invite(text) to authenticated;

-- ───────────────────────── Storage: exam and document files ─────────────────────────
-- Path layout: <pet_id>/<random>-<filename>

insert into storage.buckets (id, name, public, file_size_limit)
values ('pet-docs', 'pet-docs', false, 20971520)
on conflict (id) do nothing;

create policy "household reads pet docs" on storage.objects for select to authenticated
  using (bucket_id = 'pet-docs' and private.can_see_pet(((storage.foldername(name))[1])::uuid));
create policy "owner uploads pet docs" on storage.objects for insert to authenticated
  with check (bucket_id = 'pet-docs' and private.owns_pet(((storage.foldername(name))[1])::uuid));
create policy "owner deletes pet docs" on storage.objects for delete to authenticated
  using (bucket_id = 'pet-docs' and private.owns_pet(((storage.foldername(name))[1])::uuid));
