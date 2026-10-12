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
    'order_count',
    (
      select count(*)::integer
      from public.orders as order_row
      where order_row.created_at >= p_from
        and order_row.created_at < p_to
    ),
    'gross_sales',
    (
      select coalesce(round(sum(order_row.total), 2), 0)
      from public.orders as order_row
      where order_row.created_at >= p_from
        and order_row.created_at < p_to
    ),
    'average_order',
    (
      select coalesce(round(avg(order_row.total), 2), 0)
      from public.orders as order_row
      where order_row.created_at >= p_from
        and order_row.created_at < p_to
    ),
    'items_sold',
    (
      select coalesce(sum((line.item->>'quantity')::integer), 0)::integer
      from public.orders as order_row
      cross join lateral jsonb_array_elements(order_row.items) as line(item)
      where order_row.created_at >= p_from
        and order_row.created_at < p_to
    ),
    'top_products',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', product_sales.product_id,
            'name', product_sales.product_name,
            'quantity', product_sales.quantity,
            'sales', product_sales.sales
          )
          order by product_sales.quantity desc, product_sales.product_name
        )
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
          where order_row.created_at >= p_from
            and order_row.created_at < p_to
          group by line.item->>'product_id', line.item->>'name'
          order by quantity desc, product_name
          limit 5
        ) as product_sales
      ),
      '[]'::jsonb
    ),
    'recent_orders',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', recent.id,
            'total', recent.total,
            'created_at', recent.created_at,
            'items', recent.items
          )
          order by recent.created_at desc
        )
        from (
          select
            order_row.id,
            order_row.total,
            order_row.created_at,
            (
              select jsonb_agg(
                jsonb_build_object(
                  'name', line.item->>'name',
                  'quantity', (line.item->>'quantity')::integer
                )
                order by line.item->>'name'
              )
              from jsonb_array_elements(order_row.items) as line(item)
            ) as items
          from public.orders as order_row
          where order_row.created_at >= p_from
            and order_row.created_at < p_to
          order by order_row.created_at desc
          limit 10
        ) as recent
      ),
      '[]'::jsonb
    )
  )
  into v_metrics;

  return v_metrics;
end;
$$;

revoke all on function public.manager_dashboard(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.manager_dashboard(timestamptz, timestamptz)
  to authenticated;
