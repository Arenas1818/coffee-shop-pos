revoke insert, update, delete on public.products from anon, authenticated;
grant select, insert, update on public.products to authenticated;

drop policy if exists "Authenticated staff can read active menu products"
  on public.products;
drop policy if exists "Staff can read menu products"
  on public.products;
drop policy if exists "Staff can add menu products"
  on public.products;
drop policy if exists "Staff can update menu products"
  on public.products;

create policy "Staff can read menu products"
  on public.products for select
  to authenticated
  using (public.is_staff());

create policy "Staff can add menu products"
  on public.products for insert
  to authenticated
  with check (public.is_staff());

create policy "Staff can update menu products"
  on public.products for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());
