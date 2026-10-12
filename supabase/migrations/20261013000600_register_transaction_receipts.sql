create or replace function public.register_activity()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_activity jsonb;
begin
  if not public.is_staff() then
    raise exception 'An authorized staff account is required to view register transactions.';
  end if;

  select jsonb_build_object(
    'recent_orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', recent.id,
        'subtotal', recent.subtotal,
        'discount_type', recent.discount_type,
        'discount_amount', recent.discount_amount,
        'tax', recent.tax,
        'total', recent.total,
        'payment_method', recent.payment_method,
        'amount_received', recent.amount_received,
        'created_at', recent.created_at,
        'items', recent.items
      ) order by recent.created_at desc)
      from (
        select
          order_row.id,
          order_row.subtotal,
          order_row.discount_type,
          order_row.discount_amount,
          order_row.tax,
          order_row.total,
          order_row.payment_method,
          order_row.amount_received,
          order_row.created_at,
          (
            select coalesce(jsonb_agg(jsonb_build_object(
              'name', line.item->>'name',
              'variant', line.item->>'variant',
              'quantity', (line.item->>'quantity')::integer,
              'unit_price', nullif(line.item->>'unit_price', '')::numeric
            ) order by line.item->>'name'), '[]'::jsonb)
            from jsonb_array_elements(order_row.items) as line(item)
          ) as items
        from public.orders as order_row
        order by order_row.created_at desc
        limit 30
      ) as recent
    ), '[]'::jsonb),
    'refundable_orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', recent.id,
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
    ), '[]'::jsonb)
  )
  into v_activity;

  return v_activity;
end;
$$;

revoke all on function public.register_activity()
  from public, anon;
grant execute on function public.register_activity()
  to authenticated;
