-- Run once in the Supabase SQL editor for the transport-incident project.
-- The browser anon key is public by design; these policies enforce authority.

alter table public.incidents enable row level security;

-- Remove policy names used by the previous configuration as well, so this
-- script always leaves one authoritative policy per operation.
drop policy if exists "administrators can create incidents" on public.incidents;
drop policy if exists "administrators can update incidents" on public.incidents;

drop policy if exists "authenticated users can read incidents" on public.incidents;
drop policy if exists "incident admins can insert incidents" on public.incidents;
drop policy if exists "incident admins can update incidents" on public.incidents;
drop policy if exists "incident admins can delete incidents" on public.incidents;

create policy "authenticated users can read incidents"
on public.incidents for select
to authenticated
using (auth.uid() is not null);

create policy "incident admins can insert incidents"
on public.incidents for insert
to authenticated
with check (lower(auth.jwt() ->> 'email') in (
  'admin@tayunet-traininfo.com',
  'admin.tim@tayunet-traininfo.com'
));

create policy "incident admins can update incidents"
on public.incidents for update
to authenticated
using (lower(auth.jwt() ->> 'email') in (
  'admin@tayunet-traininfo.com',
  'admin.tim@tayunet-traininfo.com'
))
with check (lower(auth.jwt() ->> 'email') in (
  'admin@tayunet-traininfo.com',
  'admin.tim@tayunet-traininfo.com'
));

create policy "incident admins can delete incidents"
on public.incidents for delete
to authenticated
using (lower(auth.jwt() ->> 'email') in (
  'admin@tayunet-traininfo.com',
  'admin.tim@tayunet-traininfo.com'
));
