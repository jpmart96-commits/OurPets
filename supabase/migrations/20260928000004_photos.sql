-- Photos for pets, people and stock items.
-- Files live in a private bucket at <household_id>/<kind>/<random>.jpg and are read with signed URLs.

alter table public.pets add column photo_path text;
alter table public.profiles add column avatar_path text;
alter table public.stock_items add column photo_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif'])
on conflict (id) do nothing;

create or replace function private.path_household(p text)
returns uuid language plpgsql immutable set search_path = '' as $$
begin
  return (split_part(p, '/', 1))::uuid;
exception when others then
  return null;
end;
$$;
grant execute on function private.path_household(text) to authenticated;

create policy "household reads photos" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and private.is_member(private.path_household(name)));
create policy "members upload photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and private.is_member(private.path_household(name)));
create policy "uploader deletes photos" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and owner_id = (select auth.uid())::text);
