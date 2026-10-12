alter table public.orders
  drop constraint orders_discount_type_check;

alter table public.orders
  add constraint orders_discount_type_check
    check (
      discount_type is null
      or discount_type in ('pwd', 'senior', 'pwd_senior')
    );

create or replace function public.complete_order(
  p_items jsonb,
  p_discount_type text,
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
  v_subtotal numeric(10, 2);
  v_discount_amount numeric(10, 2);
  v_tax_rate numeric(5, 2);
  v_tax numeric(10, 2);
  v_total numeric(10, 2);
begin
  if p_discount_type is not null
    and p_discount_type not in ('pwd', 'senior', 'pwd_senior') then
    raise exception 'Choose a valid discount type.';
  end if;
  if p_payment_method is null
    or p_payment_method not in ('cash', 'card', 'e_wallet') then
    raise exception 'Choose a valid payment method.';
  end if;
  if p_amount_received is null
    or p_amount_received < 0
    or p_amount_received::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'Enter a valid amount received.';
  end if;

  select settings.tax_rate into strict v_tax_rate
  from public.store_settings as settings
  where settings.singleton;

  v_order_id := public.place_order(p_items);

  select orders.subtotal into strict v_subtotal
  from public.orders as orders
  where orders.id = v_order_id;

  v_discount_amount := case
    when p_discount_type is null then 0
    else round(v_subtotal * 0.10, 2)
  end;
  v_tax := round(
    (v_subtotal - v_discount_amount) * v_tax_rate / 100,
    2
  );
  v_total := v_subtotal - v_discount_amount + v_tax;

  if p_payment_method = 'cash' and p_amount_received < v_total then
    raise exception 'Cash received must be at least the order total.';
  end if;
  if p_payment_method <> 'cash' and p_amount_received <> v_total then
    raise exception 'Card and E-wallet payments must match the order total.';
  end if;

  update public.orders
  set discount_type = p_discount_type,
      discount_amount = v_discount_amount,
      tax = v_tax,
      total = v_total,
      payment_method = p_payment_method,
      amount_received = p_amount_received
  where id = v_order_id;

  return v_order_id;
end;
$$;
