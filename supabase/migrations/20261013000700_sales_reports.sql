create or replace function public.manager_sales_report(
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_report jsonb;
  v_from timestamptz;
  v_to timestamptz;
  v_days integer;
begin
  if not public.can_manage_menu() then
    raise exception 'Manager or admin access is required to view sales reports.';
  end if;

  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Choose a valid sales report date range.';
  end if;

  v_from := p_from::timestamp at time zone 'Asia/Manila';
  v_to := (p_to + 1)::timestamp at time zone 'Asia/Manila';
  v_days := p_to - p_from + 1;

  select jsonb_build_object(
    'from_date', p_from,
    'to_date', p_to,
    'days_in_period', v_days,
    'revenue', coalesce((
      select round(sum(order_row.total), 2)
      from public.orders as order_row
      where order_row.created_at >= v_from
        and order_row.created_at < v_to
    ), 0),
    'order_count', (
      select count(*)::integer
      from public.orders as order_row
      where order_row.created_at >= v_from
        and order_row.created_at < v_to
    ),
    'average_orders_per_day', coalesce(round((
      select count(*)::numeric
      from public.orders as order_row
      where order_row.created_at >= v_from
        and order_row.created_at < v_to
    ) / v_days, 2), 0),
    'items_sold', coalesce((
      select sum((line.item->>'quantity')::integer)::integer
      from public.orders as order_row
      cross join lateral jsonb_array_elements(order_row.items) as line(item)
      where order_row.created_at >= v_from
        and order_row.created_at < v_to
    ), 0),
    'payment_methods', coalesce((
      select jsonb_agg(jsonb_build_object(
        'method', payment.method,
        'amount_received', payment.amount_received,
        'transaction_count', payment.transaction_count
      ) order by payment.sort_order)
      from (
        select
          case
            when order_row.payment_method in ('cash', 'card', 'e_wallet')
              then order_row.payment_method
            else 'unrecorded'
          end as method,
          case
            when order_row.payment_method = 'cash' then 1
            when order_row.payment_method = 'card' then 2
            when order_row.payment_method = 'e_wallet' then 3
            else 4
          end as sort_order,
          coalesce(round(sum(order_row.amount_received), 2), 0)
            as amount_received,
          count(*)::integer as transaction_count
        from public.orders as order_row
        where order_row.created_at >= v_from
          and order_row.created_at < v_to
        group by 1, 2
      ) as payment
    ), '[]'::jsonb),
    'daily_orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', to_char(days.day, 'YYYY-MM-DD'),
        'orders', coalesce(daily.orders, 0)
      ) order by days.day)
      from generate_series(
        p_from::timestamp,
        p_to::timestamp,
        interval '1 day'
      ) as days(day)
      left join lateral (
        select count(*)::integer as orders
        from public.orders as order_row
        where order_row.created_at >= (
            days.day::timestamp at time zone 'Asia/Manila'
          )
          and order_row.created_at < (
            (days.day + 1)::timestamp at time zone 'Asia/Manila'
          )
      ) as daily on true
    ), '[]'::jsonb)
  )
  into v_report;

  return v_report;
end;
$$;

revoke all on function public.manager_sales_report(date, date)
  from public, anon;
grant execute on function public.manager_sales_report(date, date)
  to authenticated;
