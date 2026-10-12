alter table public.staff_members
  add column if not exists role text not null default 'staff';

alter table public.staff_members
  drop constraint if exists staff_members_role_check;

alter table public.staff_members
  add constraint staff_members_role_check
  check (role in ('staff', 'manager', 'admin'));

create or replace function public.can_manage_menu()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_members as staff
    where staff.user_id = (select auth.uid())
      and staff.role in ('manager', 'admin')
  );
$$;

revoke all on function public.can_manage_menu() from public, anon;
grant execute on function public.can_manage_menu() to authenticated;

drop policy if exists "Staff can add menu products"
  on public.products;
drop policy if exists "Staff can update menu products"
  on public.products;
drop policy if exists "Managers can add menu products"
  on public.products;
drop policy if exists "Managers can update menu products"
  on public.products;

create policy "Managers can add menu products"
  on public.products for insert
  to authenticated
  with check (public.can_manage_menu());

create policy "Managers can update menu products"
  on public.products for update
  to authenticated
  using (public.can_manage_menu())
  with check (public.can_manage_menu());
