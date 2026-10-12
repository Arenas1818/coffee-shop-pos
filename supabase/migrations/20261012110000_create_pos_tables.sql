create table public.products (
  id text primary key,
  name text not null,
  description text not null,
  category text not null check (category in ('Coffee', 'Tea', 'Bakery')),
  price numeric(10, 2) not null check (price >= 0),
  icon text not null,
  color text not null check (
    color in ('latte', 'oat', 'cold-brew', 'matcha', 'chai', 'pastry', 'berry', 'avocado')
  ),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  items jsonb not null,
  subtotal numeric(10, 2) not null check (subtotal >= 0),
  tax numeric(10, 2) not null check (tax >= 0),
  total numeric(10, 2) not null check (total >= 0),
  status text not null default 'placed' check (status = 'placed'),
  created_at timestamptz not null default now()
);

alter table public.products enable row level security;
alter table public.orders enable row level security;

grant select on public.products to anon, authenticated;
create policy "Anyone can read active menu products"
  on public.products for select
  to anon, authenticated
  using (active);

revoke all on public.orders from anon, authenticated;

create function public.place_order(p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_subtotal numeric(10, 2);
  v_items jsonb;
begin
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

  insert into public.orders (items, subtotal, tax, total)
  values (
    v_items,
    v_subtotal,
    round(v_subtotal * 0.08, 2),
    v_subtotal + round(v_subtotal * 0.08, 2)
  )
  returning id into v_order_id;

  return v_order_id;
end;
$$;

revoke all on function public.place_order(jsonb) from public;
grant execute on function public.place_order(jsonb) to anon, authenticated;

insert into public.products (id, name, description, category, price, icon, color)
values
  ('cappuccino', 'Cappuccino', 'Espresso, steamed milk, foam', 'Coffee', 4.50, '☕', 'latte'),
  ('vanilla-latte', 'Vanilla Latte', 'Espresso, vanilla, oat milk', 'Coffee', 5.25, '🥛', 'oat'),
  ('cold-brew', 'Cold Brew', 'Slow-steeped, smooth, refreshing', 'Coffee', 4.75, '🧋', 'cold-brew'),
  ('matcha-latte', 'Matcha Latte', 'Ceremonial matcha, creamy milk', 'Tea', 5.50, '🍵', 'matcha'),
  ('chai-latte', 'Chai Latte', 'Black tea, warming spices, milk', 'Tea', 4.75, '🫖', 'chai'),
  ('butter-croissant', 'Butter Croissant', 'Flaky, buttery, baked fresh', 'Bakery', 3.50, '🥐', 'pastry'),
  ('blueberry-muffin', 'Blueberry Muffin', 'Fresh blueberries, golden top', 'Bakery', 3.75, '🧁', 'berry'),
  ('avocado-toast', 'Avocado Toast', 'Sourdough, avocado, chili flakes', 'Bakery', 7.50, '🥑', 'avocado')
on conflict (id) do nothing;
