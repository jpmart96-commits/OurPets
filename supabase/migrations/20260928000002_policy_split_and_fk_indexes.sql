create index on public.dose_logs(given_by);
create index on public.household_invites(created_by);
create index on public.household_invites(used_by);
create index on public.households(created_by);

-- one SELECT policy per table: split the owner "for all" policies into insert/update/delete
drop policy "owner writes weights" on public.weights;
create policy "owner adds weights" on public.weights for insert to authenticated with check (private.owns_pet(pet_id));
create policy "owner edits weights" on public.weights for update to authenticated using (private.owns_pet(pet_id)) with check (private.owns_pet(pet_id));
create policy "owner deletes weights" on public.weights for delete to authenticated using (private.owns_pet(pet_id));

drop policy "owner writes appointments" on public.appointments;
create policy "owner adds appointments" on public.appointments for insert to authenticated with check (private.owns_pet(pet_id));
create policy "owner edits appointments" on public.appointments for update to authenticated using (private.owns_pet(pet_id)) with check (private.owns_pet(pet_id));
create policy "owner deletes appointments" on public.appointments for delete to authenticated using (private.owns_pet(pet_id));

drop policy "owner writes documents" on public.documents;
create policy "owner adds documents" on public.documents for insert to authenticated with check (private.owns_pet(pet_id));
create policy "owner edits documents" on public.documents for update to authenticated using (private.owns_pet(pet_id)) with check (private.owns_pet(pet_id));
create policy "owner deletes documents" on public.documents for delete to authenticated using (private.owns_pet(pet_id));

drop policy "owner logs doses" on public.dose_logs;
create policy "owner adds doses" on public.dose_logs for insert to authenticated with check (private.owns_pet(pet_id) and private.owns_item(item_id));
create policy "owner deletes doses" on public.dose_logs for delete to authenticated using (private.owns_pet(pet_id));

drop policy "owner links stock pets" on public.stock_item_pets;
create policy "owner adds stock pets" on public.stock_item_pets for insert to authenticated with check (private.owns_item(item_id) and private.owns_pet(pet_id));
create policy "owner edits stock pets" on public.stock_item_pets for update to authenticated using (private.owns_item(item_id)) with check (private.owns_item(item_id) and private.owns_pet(pet_id));
create policy "owner removes stock pets" on public.stock_item_pets for delete to authenticated using (private.owns_item(item_id));
