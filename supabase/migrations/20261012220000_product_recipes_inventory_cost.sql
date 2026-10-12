alter table public.inventory_items
  add column if not exists unit_cost numeric(12, 4)
  check (unit_cost is null or unit_cost >= 0);

grant insert (
  name, item_type, product_id, unit, low_stock_threshold, unit_cost
) on public.inventory_items to authenticated;

create table if not exists public.product_recipes (
  product_id text not null references public.products(id) on delete cascade,
  variant text not null check (variant in ('regular', 'large')),
  inventory_item_id uuid not null references public.inventory_items(id),
  quantity_per_product numeric(12, 3) not null check (quantity_per_product > 0),
  primary key (product_id, variant, inventory_item_id)
);

create index if not exists product_recipes_inventory_item_idx
  on public.product_recipes (inventory_item_id);

alter table public.product_recipes enable row level security;
revoke all on public.product_recipes from public, anon, authenticated;

create or replace function public.list_product_recipes()
returns table (
  product_id text,
  variant text,
  inventory_item_id uuid,
  quantity_per_product numeric,
  unit_cost numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_menu() then
    raise exception 'Manager or admin access is required to view product recipes.';
  end if;

  return query
  select
    recipe.product_id,
    recipe.variant,
    recipe.inventory_item_id,
    recipe.quantity_per_product,
    item.unit_cost
  from public.product_recipes as recipe
  join public.inventory_items as item
    on item.id = recipe.inventory_item_id
  order by recipe.product_id, recipe.variant, item.name;
end;
$$;

revoke all on function public.list_product_recipes() from public, anon;
grant execute on function public.list_product_recipes() to authenticated;

create or replace function public.save_product_recipe(
  p_product_id text,
  p_variant text,
  p_ingredients jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_menu() then
    raise exception 'Manager or admin access is required to edit product recipes.';
  end if;

  if p_variant not in ('regular', 'large')
    or jsonb_typeof(p_ingredients) is distinct from 'array' then
    raise exception 'Choose a valid product size and provide its ingredients as a list.';
  end if;

  if not exists (
    select 1 from public.products as product
    where product.id = p_product_id and product.active
      and (p_variant = 'regular' or product.large_price is not null)
  ) then
    raise exception 'The selected menu product or size is unavailable.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_ingredients) as input(ingredient)
    where jsonb_typeof(input.ingredient) is distinct from 'object'
      or coalesce(input.ingredient->>'inventory_item_id', '') = ''
      or coalesce(input.ingredient->>'quantity', '') !~ '^[0-9]+(\.[0-9]{1,3})?$'
      or (input.ingredient->>'quantity')::numeric <= 0
  ) then
    raise exception 'Each recipe ingredient must have a valid inventory item and positive quantity.';
  end if;

  if exists (
    select input.inventory_item_id
    from (
      select input.ingredient->>'inventory_item_id' as inventory_item_id
      from jsonb_array_elements(p_ingredients) as input(ingredient)
      group by input.ingredient->>'inventory_item_id'
      having count(*) > 1
    ) as input
  ) then
    raise exception 'A recipe cannot list the same inventory item more than once.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_ingredients) as input(ingredient)
    left join public.inventory_items as item
      on item.id = (input.ingredient->>'inventory_item_id')::uuid
      and item.item_type = 'supply'
      and item.active
    where item.id is null
  ) then
    raise exception 'Recipe ingredients must be active supply inventory items.';
  end if;

  delete from public.product_recipes
  where product_id = p_product_id and variant = p_variant;

  insert into public.product_recipes (
    product_id, variant, inventory_item_id, quantity_per_product
  )
  select
    p_product_id,
    p_variant,
    (input.ingredient->>'inventory_item_id')::uuid,
    (input.ingredient->>'quantity')::numeric
  from jsonb_array_elements(p_ingredients) as input(ingredient);
end;
$$;

revoke all on function public.save_product_recipe(text, text, jsonb)
  from public, anon;
grant execute on function public.save_product_recipe(text, text, jsonb)
  to authenticated;

drop function if exists public.restock_inventory(uuid, numeric, text);

create or replace function public.restock_inventory(
  p_inventory_item_id uuid,
  p_quantity numeric,
  p_note text default null,
  p_unit_cost numeric default null
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_quantity numeric(12, 3);
begin
  if not public.can_manage_menu() then
    raise exception 'Manager or admin access is required to restock inventory.';
  end if;

  if p_quantity is null or p_quantity <= 0 or p_quantity > 1000000
    or (p_unit_cost is not null and (p_unit_cost < 0 or p_unit_cost > 99999999.9999)) then
    raise exception 'Enter a valid restock quantity and optional unit cost.';
  end if;

  select item.quantity + p_quantity
  into v_new_quantity
  from public.inventory_items as item
  where item.id = p_inventory_item_id and item.active
  for update;

  if not found then
    raise exception 'The inventory item does not exist or is inactive.';
  end if;

  if v_new_quantity > 999999999.999 then
    raise exception 'The resulting inventory quantity is too large.';
  end if;

  update public.inventory_items
  set quantity = v_new_quantity,
      unit_cost = coalesce(p_unit_cost, unit_cost),
      updated_at = now()
  where id = p_inventory_item_id;

  insert into public.inventory_movements (
    inventory_item_id, staff_user_id, movement_type, quantity_change, note
  )
  values (
    p_inventory_item_id, auth.uid(), 'restock', p_quantity,
    nullif(left(trim(coalesce(p_note, '')), 200), '')
  );

  return v_new_quantity;
end;
$$;

revoke all on function public.restock_inventory(uuid, numeric, text, numeric)
  from public, anon;
grant execute on function public.restock_inventory(uuid, numeric, text, numeric)
  to authenticated;

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
  v_available numeric(12, 3);
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
    select 1 from jsonb_array_elements(p_items) as input(item)
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
    select 1
    from (
      select
        input.item->>'product_id' as product_id,
        coalesce(input.item->>'variant', 'regular') as variant,
        sum((input.item->>'quantity')::integer) as quantity
      from jsonb_array_elements(p_items) as input(item)
      group by input.item->>'product_id',
        coalesce(input.item->>'variant', 'regular')
    ) as requested
    where requested.quantity > 100
  ) then
    raise exception 'Each product size is limited to 100 per order.';
  end if;

  if exists (
    with requested as (
      select
        input.item->>'product_id' as product_id,
        coalesce(input.item->>'variant', 'regular') as variant
      from jsonb_array_elements(p_items) as input(item)
      group by input.item->>'product_id',
        coalesce(input.item->>'variant', 'regular')
    ),
    effective as (
      select requested.product_id, requested.variant,
        case
          when requested.variant = 'large'
            and exists (
              select 1 from public.product_recipes as recipe
              where recipe.product_id = requested.product_id
                and recipe.variant = 'large'
            ) then 'large'
          else 'regular'
        end as recipe_variant
      from requested
    )
    select 1
    from effective
    join public.products as product
      on product.id = effective.product_id and product.active
    where (
      exists (
        select 1 from public.product_recipes as recipe
        where recipe.product_id = effective.product_id
          and recipe.variant = effective.recipe_variant
      )
      and exists (
        select 1
        from public.product_recipes as recipe
        join public.inventory_items as item
          on item.id = recipe.inventory_item_id
        where recipe.product_id = effective.product_id
          and recipe.variant = effective.recipe_variant
          and (not item.active or item.item_type <> 'supply')
      )
    ) or (
      not exists (
        select 1 from public.product_recipes as recipe
        where recipe.product_id = effective.product_id
          and recipe.variant = effective.recipe_variant
      )
      and not exists (
        select 1 from public.inventory_items as item
        where item.product_id = effective.product_id
          and item.item_type = 'product'
          and item.active
      )
    )
  ) then
    raise exception 'An order has missing or inactive recipe inventory. Review the product recipe and stock settings.';
  end if;

  select
    round(sum(
      case when input.variant = 'large' then product.large_price
        else product.price end * input.quantity
    ), 2),
    jsonb_agg(
      jsonb_build_object(
        'product_id', product.id,
        'name', product.name,
        'variant', initcap(input.variant),
        'quantity', input.quantity,
        'unit_price', case when input.variant = 'large'
          then product.large_price else product.price end,
        'unit_cost', case
          when recipe_cost.recipe_count > 0 then recipe_cost.cost
          when input.variant = 'large' then product.large_unit_cost
          else product.unit_cost
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
    group by input.item->>'product_id',
      coalesce(input.item->>'variant', 'regular')
  ) as input
  join public.products as product
    on product.id = input.product_id and product.active
  cross join lateral (
    select
      count(*)::integer as recipe_count,
      case when bool_and(item.unit_cost is not null)
        then sum(recipe.quantity_per_product * item.unit_cost)
        else null end as cost
    from public.product_recipes as recipe
    join public.inventory_items as item
      on item.id = recipe.inventory_item_id
    where recipe.product_id = product.id
      and recipe.variant = case
        when input.variant = 'large' and exists (
          select 1 from public.product_recipes as large_recipe
          where large_recipe.product_id = product.id
            and large_recipe.variant = 'large'
        ) then 'large'
        else 'regular'
      end
  ) as recipe_cost;

  for v_stock in
    with requested as (
      select
        input.item->>'product_id' as product_id,
        coalesce(input.item->>'variant', 'regular') as variant,
        sum((input.item->>'quantity')::integer)::numeric as quantity
      from jsonb_array_elements(p_items) as input(item)
      group by input.item->>'product_id',
        coalesce(input.item->>'variant', 'regular')
    ),
    effective as (
      select requested.*,
        case
          when requested.variant = 'large' and exists (
            select 1 from public.product_recipes as recipe
            where recipe.product_id = requested.product_id
              and recipe.variant = 'large'
          ) then 'large'
          else 'regular'
        end as recipe_variant
      from requested
    ),
    consumption as (
      select recipe.inventory_item_id,
        sum(recipe.quantity_per_product * effective.quantity) as quantity
      from effective
      join public.product_recipes as recipe
        on recipe.product_id = effective.product_id
        and recipe.variant = effective.recipe_variant
      group by recipe.inventory_item_id
      union all
      select item.id as inventory_item_id, effective.quantity
      from effective
      join public.inventory_items as item
        on item.product_id = effective.product_id
        and item.item_type = 'product'
        and item.active
      where not exists (
        select 1 from public.product_recipes as recipe
        where recipe.product_id = effective.product_id
          and recipe.variant = effective.recipe_variant
      )
    )
    select item.id, item.name, sum(consumption.quantity) as requested
    from consumption
    join public.inventory_items as item
      on item.id = consumption.inventory_item_id and item.active
    group by item.id
    order by item.id
  loop
    select item.quantity
    into v_available
    from public.inventory_items as item
    where item.id = v_stock.id and item.active
    for update;

    if not found then
      raise exception 'Inventory item % is inactive or unavailable.', v_stock.name;
    end if;

    if v_available < v_stock.requested then
      raise exception 'Insufficient stock for % (available: %, requested: %).',
        v_stock.name, v_available, v_stock.requested;
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
    v_items, v_subtotal, round(v_subtotal * 0.08, 2),
    v_subtotal + round(v_subtotal * 0.08, 2), v_staff_user_id
  )
  returning id into v_order_id;

  return v_order_id;
end;
$$;

revoke all on function public.place_order(jsonb) from public, anon;
grant execute on function public.place_order(jsonb) to authenticated;

create or replace function public.manager_dashboard(
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_metrics jsonb;
begin
  if not public.can_manage_menu() then
    raise exception 'Manager or admin access is required to view business metrics.';
  end if;
  if p_from is null or p_to is null or p_from >= p_to then
    raise exception 'A valid dashboard time range is required.';
  end if;

  select jsonb_build_object(
    'order_count', (
      select count(*)::integer from public.orders as order_row
      where order_row.created_at >= p_from and order_row.created_at < p_to
    ),
    'revenue', (
      select coalesce(round(sum(order_row.total), 2), 0)
      from public.orders as order_row
      where order_row.created_at >= p_from and order_row.created_at < p_to
    ),
    'refunds', (
      select coalesce(round(sum(refund.amount), 2), 0)
      from public.order_refunds as refund
      where refund.created_at >= p_from and refund.created_at < p_to
    ),
    'cost_of_goods_sold', (
      select coalesce(round(sum(
        (line.item->>'quantity')::numeric
        * nullif(line.item->>'unit_cost', '')::numeric
      ), 2), 0)
      from public.orders as order_row
      cross join lateral jsonb_array_elements(order_row.items) as line(item)
      where order_row.created_at >= p_from and order_row.created_at < p_to
    ),
    'uncosted_items', (
      select coalesce(sum((line.item->>'quantity')::integer), 0)::integer
      from public.orders as order_row
      cross join lateral jsonb_array_elements(order_row.items) as line(item)
      where order_row.created_at >= p_from and order_row.created_at < p_to
        and nullif(line.item->>'unit_cost', '') is null
    ),
    'expenses', (
      select coalesce(round(sum(expense.amount), 2), 0)
      from public.business_expenses as expense
      where expense.created_at >= p_from and expense.created_at < p_to
    ),
    'items_sold', (
      select coalesce(sum((line.item->>'quantity')::integer), 0)::integer
      from public.orders as order_row
      cross join lateral jsonb_array_elements(order_row.items) as line(item)
      where order_row.created_at >= p_from and order_row.created_at < p_to
    ),
    'sales_by_day', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', to_char(days.day at time zone 'UTC', 'YYYY-MM-DD'),
        'sales', coalesce(daily.sales, 0),
        'cost', coalesce(daily.cost, 0),
        'orders', coalesce(daily.orders, 0)
      ) order by days.day)
      from generate_series(
        date_trunc('day', p_from),
        date_trunc('day', p_to - interval '1 microsecond'),
        interval '1 day'
      ) as days(day)
      left join lateral (
        select
          (
            select round(sum(order_row.total), 2)
            from public.orders as order_row
            where order_row.created_at >= days.day
              and order_row.created_at < days.day + interval '1 day'
              and order_row.created_at >= p_from
              and order_row.created_at < p_to
          ) as sales,
          (
            select coalesce(round(sum(
              (line.item->>'quantity')::numeric
              * nullif(line.item->>'unit_cost', '')::numeric
            ), 2), 0)
            from public.orders as order_row
            cross join lateral jsonb_array_elements(order_row.items) as line(item)
            where order_row.created_at >= days.day
              and order_row.created_at < days.day + interval '1 day'
              and order_row.created_at >= p_from
              and order_row.created_at < p_to
          ) as cost,
          (
            select count(*)::integer
            from public.orders as order_row
            where order_row.created_at >= days.day
              and order_row.created_at < days.day + interval '1 day'
              and order_row.created_at >= p_from
              and order_row.created_at < p_to
          ) as orders
      ) as daily on true
    ), '[]'::jsonb),
    'top_products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ranked.product_id, 'name', ranked.product_name,
        'quantity', ranked.quantity, 'sales', ranked.sales
      ) order by ranked.quantity desc, ranked.product_name)
      from (
        select
          line.item->>'product_id' as product_id,
          line.item->>'name' as product_name,
          sum((line.item->>'quantity')::integer)::integer as quantity,
          round(sum(
            (line.item->>'quantity')::integer
            * (line.item->>'unit_price')::numeric
          ), 2) as sales
        from public.orders as order_row
        cross join lateral jsonb_array_elements(order_row.items) as line(item)
        where order_row.created_at >= p_from and order_row.created_at < p_to
        group by line.item->>'product_id', line.item->>'name'
        order by quantity desc, product_name
        limit 5
      ) as ranked
    ), '[]'::jsonb),
    'recent_orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', recent.id, 'total', recent.total,
        'created_at', recent.created_at, 'items', recent.items
      ) order by recent.created_at desc)
      from (
        select order_row.id, order_row.total, order_row.created_at,
          (select jsonb_agg(jsonb_build_object(
            'name', line.item->>'name',
            'variant', line.item->>'variant',
            'quantity', (line.item->>'quantity')::integer
          ) order by line.item->>'name')
           from jsonb_array_elements(order_row.items) as line(item)) as items
        from public.orders as order_row
        order by order_row.created_at desc limit 10
      ) as recent
    ), '[]'::jsonb),
    'refundable_orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', recent.id, 'total', recent.total,
        'refunded', recent.refunded,
        'remaining', greatest(recent.total - recent.refunded, 0)
      ) order by recent.created_at desc)
      from (
        select order_row.id, order_row.total, order_row.created_at,
          coalesce((select sum(refund.amount)
            from public.order_refunds as refund
            where refund.order_id = order_row.id), 0) as refunded
        from public.orders as order_row
        order by order_row.created_at desc limit 50
      ) as recent
      where recent.refunded < recent.total
    ), '[]'::jsonb),
    'low_stock', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', stock.id, 'name', stock.name,
        'quantity', stock.quantity, 'threshold', stock.low_stock_threshold,
        'unit', stock.unit
      ) order by stock.quantity, stock.name)
      from (
        select item.id, item.name, item.quantity,
          item.low_stock_threshold, item.unit
        from public.inventory_items as item
        where item.active and item.quantity <= item.low_stock_threshold
          and not (
            item.item_type = 'product'
            and exists (
              select 1 from public.product_recipes as recipe
              where recipe.product_id = item.product_id
            )
          )
        order by item.quantity, item.name limit 20
      ) as stock
    ), '[]'::jsonb)
  ) into v_metrics;

  v_metrics := v_metrics || jsonb_build_object(
    'gross_profit',
    (v_metrics->>'revenue')::numeric - (v_metrics->>'refunds')::numeric
      - (v_metrics->>'cost_of_goods_sold')::numeric,
    'net_profit',
    (v_metrics->>'revenue')::numeric - (v_metrics->>'refunds')::numeric
      - (v_metrics->>'cost_of_goods_sold')::numeric
      - (v_metrics->>'expenses')::numeric
  );
  return v_metrics;
end;
$$;

revoke all on function public.manager_dashboard(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.manager_dashboard(timestamptz, timestamptz)
  to authenticated;
