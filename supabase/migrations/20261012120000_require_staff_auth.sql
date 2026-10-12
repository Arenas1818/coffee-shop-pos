drop policy if exists "Anyone can read active menu products"
  on public.products;

create table if not exists public.staff_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.staff_members enable row level security;
revoke all on public.staff_members from anon, authenticated;

create or replace function public.is_staff()
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
  );
$$;

revoke all on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated;

revoke select on public.products from anon;
grant select on public.products to authenticated;

drop policy if exists "Authenticated staff can read active menu products"
  on public.products;

create policy "Authenticated staff can read active menu products"
  on public.products for select
  to authenticated
  using (active and public.is_staff());

alter table public.orders
  add column if not exists staff_user_id uuid references auth.users(id) on delete set null;

create index if not exists orders_staff_user_id_idx
  on public.orders (staff_user_id);

create or replace function public.place_order(p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_subtotal numeric(10, 2);
  v_items jsonb;
  v_staff_user_id uuid := auth.uid();
begin
  if v_staff_user_id is null or not public.is_staff() then
    raise exception 'An authorized staff account is required to place an order.';
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Order items must be a JSON array.';
  end if;

  if jsonb_array_length(p_items) = 0 then
    raise exception 'An order must contain at least one item.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as input(item)
    where jsonb_typeof(input.item) is distinct from 'object'
      or coalesce(input.item->>'product_id', '') = ''
      or coalesce(input.item->>'quantity', '') !~ '^([1-9]|[1-9][0-9]|100)$'
  ) then
    raise exception 'Order items must have a product ID and quantity from 1 to 100.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as input(item)
    left join public.products as product
      on product.id = input.item->>'product_id'
      and product.active
    where product.id is null
  ) then
    raise exception 'An order contains a product that is unavailable.';
  end if;

  select
    round(sum(product.price * (input.item->>'quantity')::integer), 2),
    jsonb_agg(
      jsonb_build_object(
        'product_id', product.id,
        'name', product.name,
        'quantity', (input.item->>'quantity')::integer,
        'unit_price', product.price
      )
      order by product.name
    )
  into v_subtotal, v_items
  from jsonb_array_elements(p_items) as input(item)
  join public.products as product
    on product.id = input.item->>'product_id'
    and product.active;

  insert into public.orders (items, subtotal, tax, total, staff_user_id)
  values (
    v_items,
    v_subtotal,
    round(v_subtotal * 0.08, 2),
    v_subtotal + round(v_subtotal * 0.08, 2),
    v_staff_user_id
  )
  returning id into v_order_id;

  return v_order_id;
end;
$$;

revoke all on function public.place_order(jsonb) from public, anon;
grant execute on function public.place_order(jsonb) to authenticated;
