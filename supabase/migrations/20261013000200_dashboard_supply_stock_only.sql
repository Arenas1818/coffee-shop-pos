alter function public.manager_dashboard(timestamptz, timestamptz)
  rename to manager_dashboard_with_product_stock;

revoke all on function public.manager_dashboard_with_product_stock(
  timestamptz, timestamptz
) from public, anon, authenticated;

create function public.manager_dashboard(
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
  v_low_stock jsonb;
begin
  v_metrics := public.manager_dashboard_with_product_stock(p_from, p_to);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', stock.id,
    'name', stock.name,
    'quantity', stock.quantity,
    'threshold', stock.low_stock_threshold,
    'unit', stock.unit
  ) order by stock.quantity, stock.name), '[]'::jsonb)
  into v_low_stock
  from (
    select
      item.id,
      item.name,
      item.quantity,
      item.low_stock_threshold,
      item.unit
    from public.inventory_items as item
    where item.active
      and item.item_type = 'supply'
      and item.quantity <= item.low_stock_threshold
    order by item.quantity, item.name
    limit 20
  ) as stock;

  return jsonb_set(v_metrics, '{low_stock}', v_low_stock);
end;
$$;

revoke all on function public.manager_dashboard(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.manager_dashboard(timestamptz, timestamptz)
  to authenticated;
