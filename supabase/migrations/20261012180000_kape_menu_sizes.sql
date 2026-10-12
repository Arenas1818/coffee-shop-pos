alter table public.products
  add column if not exists large_price numeric(10, 2);

alter table public.products
  drop constraint if exists products_large_price_check;

alter table public.products
  add constraint products_large_price_check
  check (large_price is null or large_price >= price);

update public.products
set active = false
where active;

insert into public.products (
  id, name, description, category, price, large_price, icon, color, active
)
values
  ('kape-americano', 'Americano', 'Classic espresso with hot water', 'Coffee', 59, 69, '☕', 'latte', true),
  ('kape-coffee-original', 'Coffee Original', 'Our classic house coffee', 'Coffee', 59, 69, '☕', 'oat', true),
  ('kape-vanilla', 'Vanilla', 'Smooth vanilla coffee', 'Coffee', 59, 69, '🥛', 'oat', true),
  ('kape-black-vanilla', 'Black Vanilla', 'Bold coffee with vanilla', 'Coffee', 59, 69, '☕', 'cold-brew', true),
  ('kape-caramel-macchiato', 'Caramel Macchiato', 'Espresso with caramel', 'Coffee', 69, 79, '☕', 'chai', true),
  ('kape-strawberry-latte', 'Strawberry Latte', 'Creamy strawberry latte', 'Coffee', 69, 79, '🥛', 'berry', true),
  ('kape-oriental', 'Oriental', 'House oriental coffee', 'Coffee', 69, 79, '🫖', 'chai', true),
  ('kape-choco-oriental', 'Choco Oriental', 'Chocolate house coffee', 'Coffee', 69, 79, '☕', 'chai', true),
  ('kape-vietnamese', 'Vietnamese', 'Rich Vietnamese-style coffee', 'Coffee', 69, 79, '☕', 'cold-brew', true),
  ('kape-blackberry', 'Blackberry', 'Blackberry coffee', 'Coffee', 69, 79, '🧋', 'berry', true),
  ('kape-dark-mocha', 'Dark Mocha', 'Espresso with dark chocolate', 'Coffee', 69, 79, '☕', 'chai', true),
  ('kape-salted-caramel', 'Salted Caramel', 'Coffee with salted caramel', 'Coffee', 79, null, '☕', 'chai', true),
  ('kape-toffee', 'Toffee', 'Coffee with buttery toffee', 'Coffee', 79, null, '☕', 'pastry', true),
  ('kape-dirty-white-mocha', 'Dirty White Mocha', 'Espresso with white chocolate', 'Coffee', 89, null, '☕', 'oat', true),
  ('kape-matcha-espresso', 'Matcha Espresso', 'Matcha with a shot of espresso', 'Coffee', 89, null, '🍵', 'matcha', true)
on conflict (id) do update
set name = excluded.name,
    description = excluded.description,
    category = excluded.category,
    price = excluded.price,
    large_price = excluded.large_price,
    icon = excluded.icon,
    color = excluded.color,
    active = true;

update public.inventory_items as item
set active = false, updated_at = now()
from public.products as product
where item.item_type = 'product'
  and item.product_id = product.id
  and not product.active
  and item.active;

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
  v_stock record;
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
      or coalesce(input.item->>'variant', 'regular') not in ('regular', 'large')
  ) then
    raise exception 'Order items must have a product ID, a valid size, and quantity from 1 to 100.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as input(item)
    left join public.products as product
      on product.id = input.item->>'product_id' and product.active
    where product.id is null
      or (
        coalesce(input.item->>'variant', 'regular') = 'large'
        and product.large_price is null
      )
  ) then
    raise exception 'An order contains an unavailable product or size.';
  end if;

  if exists (
    select input.product_id
    from (
      select
        input.item->>'product_id' as product_id,
        coalesce(input.item->>'variant', 'regular') as variant,
        sum((input.item->>'quantity')::integer) as quantity
      from jsonb_array_elements(p_items) as input(item)
      group by
        input.item->>'product_id',
        coalesce(input.item->>'variant', 'regular')
    ) as input
    where input.quantity > 100
  ) then
    raise exception 'Each product size is limited to 100 per order.';
  end if;

  select
    round(sum(
      case
        when input.variant = 'large' then product.large_price
        else product.price
      end * input.quantity
    ), 2),
    jsonb_agg(
      jsonb_build_object(
        'product_id', product.id,
        'name', product.name,
        'variant', initcap(input.variant),
        'quantity', input.quantity,
        'unit_price', case
          when input.variant = 'large' then product.large_price
          else product.price
        end
      )
      order by product.name, input.variant
    )
  into v_subtotal, v_items
  from (
    select
      input.item->>'product_id' as product_id,
      coalesce(input.item->>'variant', 'regular') as variant,
      sum((input.item->>'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) as input(item)
    group by
      input.item->>'product_id',
      coalesce(input.item->>'variant', 'regular')
  ) as input
  join public.products as product
    on product.id = input.product_id and product.active;

  for v_stock in
    select
      item.id,
      item.name,
      item.quantity as available,
      requested.quantity as requested
    from public.inventory_items as item
    join (
      select
        input.item->>'product_id' as product_id,
        sum((input.item->>'quantity')::integer)::integer as quantity
      from jsonb_array_elements(p_items) as input(item)
      group by input.item->>'product_id'
    ) as requested on requested.product_id = item.product_id
    where item.item_type = 'product'
    order by item.id
    for update of item
  loop
    if v_stock.available < v_stock.requested then
      raise exception 'Insufficient stock for % (available: %, requested: %).',
        v_stock.name, v_stock.available, v_stock.requested;
    end if;

    update public.inventory_items as item
    set quantity = item.quantity - v_stock.requested, updated_at = now()
    where item.id = v_stock.id;

    insert into public.inventory_movements (
      inventory_item_id, staff_user_id, movement_type, quantity_change, note
    )
    values (
      v_stock.id, v_staff_user_id, 'sale', -v_stock.requested, 'POS order'
    );
  end loop;

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
