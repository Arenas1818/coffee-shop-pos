alter table public.orders
  add column payment_method text,
  add column amount_received numeric(10, 2);

alter table public.orders
  add constraint orders_payment_method_check
    check (
      payment_method is null
      or payment_method in ('cash', 'card', 'e_wallet')
    ),
  add constraint orders_amount_received_check
    check (amount_received is null or amount_received >= 0),
  add constraint orders_payment_fields_check
    check (
      (payment_method is null and amount_received is null)
      or (payment_method is not null and amount_received is not null)
    );

create or replace function public.complete_order(
  p_items jsonb,
  p_payment_method text,
  p_amount_received numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_total numeric(10, 2);
begin
  if p_payment_method is null
    or p_payment_method not in ('cash', 'card', 'e_wallet') then
    raise exception 'Choose a valid payment method.';
  end if;

  if p_amount_received is null
    or p_amount_received < 0
    or p_amount_received::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'Enter a valid amount received.';
  end if;

  v_order_id := public.place_order(p_items);

  select orders.total
  into strict v_total
  from public.orders as orders
  where orders.id = v_order_id;

  if p_payment_method = 'cash' and p_amount_received < v_total then
    raise exception 'Cash received must be at least the order total.';
  end if;

  if p_payment_method <> 'cash' and p_amount_received <> v_total then
    raise exception 'Card and E-wallet payments must match the order total.';
  end if;

  update public.orders
  set payment_method = p_payment_method,
      amount_received = p_amount_received
  where id = v_order_id;

  return v_order_id;
end;
$$;

revoke all on function public.complete_order(jsonb, text, numeric)
  from public, anon;
grant execute on function public.complete_order(jsonb, text, numeric)
  to authenticated;

revoke all on function public.place_order(jsonb)
  from public, anon, authenticated;
