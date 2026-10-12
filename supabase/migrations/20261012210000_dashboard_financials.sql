alter table public.products
  add column if not exists unit_cost numeric(10, 2),
  add column if not exists large_unit_cost numeric(10, 2);

alter table public.products
  drop constraint if exists products_unit_cost_check;
alter table public.products
  add constraint products_unit_cost_check
  check (
    (unit_cost is null or unit_cost >= 0)
    and (large_unit_cost is null or large_unit_cost >= 0)
    and (large_unit_cost is null or large_price is not null)
  );

create table if not exists public.order_refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  amount numeric(10, 2) not null check (amount > 0),
  reason text not null check (length(trim(reason)) between 1 and 200),
  staff_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists order_refunds_created_at_idx
  on public.order_refunds (created_at desc);
create index if not exists order_refunds_order_id_idx
  on public.order_refunds (order_id);

alter table public.order_refunds enable row level security;
revoke all on public.order_refunds from public, anon, authenticated;

create table if not exists public.business_expenses (
  id uuid primary key default gen_random_uuid(),
  description text not null check (length(trim(description)) between 1 and 120),
  amount numeric(10, 2) not null check (amount > 0),
  staff_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists business_expenses_created_at_idx
  on public.business_expenses (created_at desc);

alter table public.business_expenses enable row level security;
revoke all on public.business_expenses from public, anon, authenticated;

create or replace function public.record_business_expense(
  p_description text,
  p_amount numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expense_id uuid;
begin
  if not public.can_manage_menu() then
    raise exception 'Manager or admin access is required to record expenses.';
  end if;

  if p_description is null
    or length(trim(p_description)) not between 1 and 120
    or p_amount is null
    or p_amount <= 0
    or p_amount > 99999999.99 then
    raise exception 'Enter an expense description and an amount greater than zero.';
  end if;

  insert into public.business_expenses (
    description, amount, staff_user_id
  )
  values (trim(p_description), round(p_amount, 2), auth.uid())
  returning id into v_expense_id;

  return v_expense_id;
end;
$$;

revoke all on function public.track_menu_product_inventory()
  from public, anon, authenticated;

revoke all on function public.record_business_expense(text, numeric)
  from public, anon;
grant execute on function public.record_business_expense(text, numeric)
  to authenticated;

create or replace function public.record_order_refund(
  p_order_id uuid,
  p_amount numeric,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_total numeric(10, 2);
  v_refunded numeric(10, 2);
  v_refund_id uuid;
begin
  if not public.can_manage_menu() then
    raise exception 'Manager or admin access is required to record refunds.';
  end if;

  if p_order_id is null
    or p_amount is null
    or p_amount <= 0
    or p_amount > 99999999.99
    or p_reason is null
    or length(trim(p_reason)) not between 1 and 200 then
    raise exception 'Choose an order, enter a refund reason, and enter an amount greater than zero.';
  end if;

  select order_row.total
  into v_order_total
  from public.orders as order_row
  where order_row.id = p_order_id
  for update;

  if not found then
    raise exception 'The selected order could not be found.';
  end if;

  select coalesce(sum(refund.amount), 0)
  into v_refunded
  from public.order_refunds as refund
  where refund.order_id = p_order_id;

  if round(p_amount, 2) > v_order_total - v_refunded then
    raise exception 'The refund exceeds the remaining refundable order amount.';
  end if;

  insert into public.order_refunds (
    order_id, amount, reason, staff_user_id
  )
  values (
    p_order_id, round(p_amount, 2), trim(p_reason), auth.uid()
  )
  returning id into v_refund_id;

  return v_refund_id;
end;
$$;

revoke all on function public.record_order_refund(uuid, numeric, text)
  from public, anon;
grant execute on function public.record_order_refund(uuid, numeric, text)
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

  if exists (
    select 1
    from (
      select distinct input.item->>'product_id' as product_id
      from jsonb_array_elements(p_items) as input(item)
    ) as requested
    join public.products as product
      on product.id = requested.product_id and product.active
    left join public.inventory_items as item
      on item.product_id = product.id
      and item.item_type = 'product'
      and item.active
    where item.id is null
  ) then
    raise exception 'Inventory tracking is missing or archived for an ordered menu product.';
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
        end,
        'unit_cost', case
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
    where item.item_type = 'product' and item.active
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
      select count(*)::integer
      from public.orders as order_row
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
      select jsonb_agg(
        jsonb_build_object(
          'date', to_char(day_range.day at time zone 'UTC', 'YYYY-MM-DD'),
          'sales', coalesce(day_sales.sales, 0),
          'orders', coalesce(day_sales.orders, 0)
        )
        order by day_range.day
      )
      from generate_series(
        date_trunc('day', p_from),
        date_trunc('day', p_to - interval '1 microsecond'),
        interval '1 day'
      ) as day_range(day)
      left join lateral (
        select
          round(sum(order_row.total), 2) as sales,
          count(*)::integer as orders
        from public.orders as order_row
        where order_row.created_at >= day_range.day
          and order_row.created_at < day_range.day + interval '1 day'
          and order_row.created_at >= p_from
          and order_row.created_at < p_to
      ) as day_sales on true
    ), '[]'::jsonb),
    'top_products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', product_sales.product_id,
        'name', product_sales.product_name,
        'quantity', product_sales.quantity,
        'sales', product_sales.sales
      ) order by product_sales.quantity desc, product_sales.product_name)
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
      ) as product_sales
    ), '[]'::jsonb),
    'recent_orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', recent.id,
        'total', recent.total,
        'created_at', recent.created_at,
        'items', recent.items
      ) order by recent.created_at desc)
      from (
        select
          order_row.id,
          order_row.total,
          order_row.created_at,
          (
            select jsonb_agg(jsonb_build_object(
              'name', line.item->>'name',
              'variant', line.item->>'variant',
              'quantity', (line.item->>'quantity')::integer
            ) order by line.item->>'name')
            from jsonb_array_elements(order_row.items) as line(item)
          ) as items
        from public.orders as order_row
        order by order_row.created_at desc
        limit 10
      ) as recent
    ), '[]'::jsonb),
    'refundable_orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', recent.id,
        'total', recent.total,
        'refunded', recent.refunded,
        'remaining', greatest(recent.total - recent.refunded, 0)
      ) order by recent.created_at desc)
      from (
        select
          order_row.id,
          order_row.total,
          order_row.created_at,
          coalesce((
            select sum(refund.amount)
            from public.order_refunds as refund
            where refund.order_id = order_row.id
          ), 0) as refunded
        from public.orders as order_row
        order by order_row.created_at desc
        limit 50
      ) as recent
      where recent.refunded < recent.total
    ), '[]'::jsonb),
    'low_stock', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', stock.id,
        'name', stock.name,
        'quantity', stock.quantity,
        'threshold', stock.low_stock_threshold,
        'unit', stock.unit
      ) order by stock.quantity, stock.name)
      from (
        select
          item.id,
          item.name,
          item.quantity,
          item.low_stock_threshold,
          item.unit
        from public.inventory_items as item
        where item.active and item.quantity <= item.low_stock_threshold
        order by item.quantity, item.name
        limit 20
      ) as stock
    ), '[]'::jsonb)
  )
  into v_metrics;

  v_metrics := v_metrics || jsonb_build_object(
    'gross_profit',
    (v_metrics->>'revenue')::numeric
      - (v_metrics->>'refunds')::numeric
      - (v_metrics->>'cost_of_goods_sold')::numeric,
    'net_profit',
    (v_metrics->>'revenue')::numeric
      - (v_metrics->>'refunds')::numeric
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
