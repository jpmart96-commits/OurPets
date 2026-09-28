-- Accounts created before the signup trigger existed get their profile + household now.
do $$
declare
  u record; h uuid;
begin
  for u in select id, email, raw_user_meta_data from auth.users au
           where not exists (select 1 from public.profiles p where p.id = au.id) order by created_at loop
    insert into public.profiles (id, display_name)
      values (u.id, coalesce(nullif(u.raw_user_meta_data->>'display_name', ''), split_part(u.email, '@', 1)));
    insert into public.households (name, created_by) values ('Home', u.id) returning id into h;
    insert into public.household_members (household_id, user_id, role) values (h, u.id, 'owner');
    insert into public.stores (household_id, name, cart_url, free_shipping_threshold) values
      (h, 'Zooplus', 'https://www.zooplus.pt/checkout/cart', null),
      (h, 'Newpet', 'https://www.newpet.pt/cart', 49);
  end loop;
end $$;
