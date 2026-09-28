-- Missed doses: a dose can be logged as given or missed. Missed doses give the pill back to the count (done in the app).
alter table public.dose_logs add column status text not null default 'given' check (status in ('given', 'missed'));
create policy "owner edits doses" on public.dose_logs for update to authenticated
  using (private.owns_pet(pet_id)) with check (private.owns_pet(pet_id) and private.owns_item(item_id));

-- Emergency info per pet
alter table public.pets
  add column vet_phone text,
  add column vet_address text,
  add column er_vet_name text,
  add column er_vet_phone text,
  add column allergies text,
  add column conditions text,
  add column insurance text;

-- Vaccinations and other recurring treatments with a next-due date
create table public.vaccinations (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  given_on date,
  next_due date,
  interval_months integer check (interval_months between 1 and 120),
  notes text,
  created_at timestamptz not null default now()
);
create index on public.vaccinations(pet_id);
alter table public.vaccinations enable row level security;
create policy "read vaccinations" on public.vaccinations for select to authenticated using (private.can_see_pet(pet_id));
create policy "owner adds vaccinations" on public.vaccinations for insert to authenticated with check (private.owns_pet(pet_id));
create policy "owner edits vaccinations" on public.vaccinations for update to authenticated using (private.owns_pet(pet_id)) with check (private.owns_pet(pet_id));
create policy "owner deletes vaccinations" on public.vaccinations for delete to authenticated using (private.owns_pet(pet_id));

-- Reminder preferences
alter table public.profiles
  add column timezone text not null default 'Europe/Lisbon',
  add column notify_doses boolean not null default true,
  add column notify_stock boolean not null default true,
  add column notify_appointments boolean not null default true;

-- Web Push subscriptions, one per device
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);
create index on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
create policy "own subscriptions read" on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
create policy "own subscriptions add" on public.push_subscriptions for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own subscriptions edit" on public.push_subscriptions for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own subscriptions delete" on public.push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));

-- What has already been sent (so each reminder goes out once). Only the reminder function writes here.
create table public.notification_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.notification_log enable row level security;

-- Server-only settings (VAPID keys, cron secret). Not reachable through the API.
create table private.app_config (key text primary key, value text not null);
revoke all on private.app_config from public, anon, authenticated;

create or replace function public.get_push_config()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from private.app_config
$$;
revoke execute on function public.get_push_config() from public, anon, authenticated;
grant execute on function public.get_push_config() to service_role;

create extension if not exists pg_cron;
