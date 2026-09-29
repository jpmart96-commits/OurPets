-- Vet visit log (2026-09-29)
-- A visit is an appointment row: its free-text `notes` hold what the vet said.
-- Files, a weight and a cost can be linked to the visit, and a follow-up appointment
-- points back at the visit it came from. Deleting a visit keeps all of those (links become null).

alter table public.appointments
  add column follow_up_of uuid references public.appointments(id) on delete set null,
  add constraint appointments_notes_len check (notes is null or length(notes) <= 20000);
create index on public.appointments(follow_up_of);

alter table public.documents add column appointment_id uuid references public.appointments(id) on delete set null;
create index on public.documents(appointment_id);

alter table public.weights add column appointment_id uuid references public.appointments(id) on delete set null;
create index on public.weights(appointment_id);

alter table public.expenses add column appointment_id uuid references public.appointments(id) on delete set null;
create index on public.expenses(appointment_id);

-- A link must point at a visit of the same pet (for expenses: one of the pets the cost is for).
create or replace function private.check_visit_link()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  link uuid;
  visit_pet uuid;
begin
  if tg_table_name = 'appointments' then link := new.follow_up_of; else link := new.appointment_id; end if;
  if link is null then return new; end if;
  select pet_id into visit_pet from public.appointments where id = link;
  if visit_pet is null then raise exception 'visit not found'; end if;
  if tg_table_name = 'expenses' then
    if not (visit_pet = any(new.pet_ids)) then raise exception 'the visit is for a different pet'; end if;
  elsif visit_pet <> new.pet_id then
    raise exception 'the visit is for a different pet';
  end if;
  if tg_table_name = 'appointments' and link = new.id then raise exception 'a visit cannot follow up itself'; end if;
  return new;
end;
$$;
revoke execute on function private.check_visit_link() from public, anon, authenticated;

create trigger appointments_visit_link before insert or update of follow_up_of, pet_id on public.appointments
  for each row execute function private.check_visit_link();
create trigger documents_visit_link before insert or update of appointment_id, pet_id on public.documents
  for each row execute function private.check_visit_link();
create trigger weights_visit_link before insert or update of appointment_id, pet_id on public.weights
  for each row execute function private.check_visit_link();
create trigger expenses_visit_link before insert or update of appointment_id, pet_ids on public.expenses
  for each row execute function private.check_visit_link();
