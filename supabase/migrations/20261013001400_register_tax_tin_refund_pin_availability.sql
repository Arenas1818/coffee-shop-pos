alter table public.store_settings
  add column if not exists vat_tin text not null default ''
    check (length(vat_tin) <= 80);

create table public.refund_pin_attempts (
  pos_user_id uuid primary key references auth.users(id) on delete cascade,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  check (failed_attempts >= 0)
);

alter table public.refund_pin_attempts enable row level security;
revoke all on public.refund_pin_attempts from public, anon, authenticated;

alter table public.orders
  add column tax_before_tax_removal numeric(10, 2),
  add column total_before_tax_removal numeric(10, 2),
  add column amount_received_before_tax_removal numeric(10, 2);

update public.orders
set tax_before_tax_removal = tax,
    total_before_tax_removal = total,
    amount_received_before_tax_removal = amount_received,
    amount_received = case
      when amount_received is null then null
      else greatest(
        amount_received - tax,
        subtotal - discount_amount
      )
    end,
    tax = 0,
    total = greatest(subtotal - discount_amount, 0);

update public.store_settings
set tax_rate = 0,
    updated_at = now()
where singleton;

create or replace function public.get_store_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_settings jsonb;
begin
  if not public.is_staff() then
    raise exception 'An authorized staff account is required to view store settings.';
  end if;

  select jsonb_build_object(
    'store_name', settings.store_name,
    'address', settings.address,
    'phone', settings.phone,
    'vat_tin', settings.vat_tin,
    'receipt_footer', settings.receipt_footer,
    'currency_symbol', settings.currency_symbol,
    'global_low_stock_threshold', settings.global_low_stock_threshold,
    'background_video_path', settings.background_video_path,
    'background_video_enabled', settings.background_video_enabled
  )
  into strict v_settings
  from public.store_settings as settings
  where settings.singleton;

  return v_settings;
end;
$$;

drop function public.update_store_settings(
  text, text, text, text, numeric, text, numeric, text, boolean
);

create function public.update_store_settings(
  p_store_name text,
  p_address text,
  p_phone text,
  p_vat_tin text,
  p_receipt_footer text,
  p_currency_symbol text,
  p_global_low_stock_threshold numeric,
  p_background_video_path text,
  p_background_video_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_menu() then
    raise exception 'Manager or admin access is required to change store settings.';
  end if;

  if p_store_name is null
    or length(trim(p_store_name)) not between 1 and 100
    or p_address is null or length(p_address) > 250
    or p_phone is null or length(p_phone) > 32
    or p_vat_tin is null or length(trim(p_vat_tin)) > 80
    or p_receipt_footer is null or length(p_receipt_footer) > 200
    or p_currency_symbol is null
    or length(trim(p_currency_symbol)) not between 1 and 6
    or p_global_low_stock_threshold is null
    or p_global_low_stock_threshold < 0
    or p_global_low_stock_threshold > 999999999.999
    or p_global_low_stock_threshold::text in ('NaN', 'Infinity', '-Infinity')
    or p_background_video_enabled is null
    or (
      p_background_video_path is not null
      and p_background_video_path !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp4|webm)$'
    )
    or (p_background_video_enabled and p_background_video_path is null) then
    raise exception 'Enter valid store, VAT registration, currency, and stock threshold settings.';
  end if;

  update public.store_settings
  set store_name = trim(p_store_name),
      address = trim(p_address),
      phone = trim(p_phone),
      vat_tin = trim(p_vat_tin),
      receipt_footer = trim(p_receipt_footer),
      tax_rate = 0,
      currency_symbol = trim(p_currency_symbol),
      global_low_stock_threshold =
        round(p_global_low_stock_threshold, 3),
      background_video_path = p_background_video_path,
      background_video_enabled = p_background_video_enabled,
      updated_at = now()
  where singleton;

  return public.get_store_settings();
end;
$$;

revoke all on function public.update_store_settings(
  text, text, text, text, text, text, numeric, text, boolean
) from public, anon;
grant execute on function public.update_store_settings(
  text, text, text, text, text, text, numeric, text, boolean
) to authenticated;

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

  v_order_id := public.place_order(p_items);

  select orders.subtotal into strict v_subtotal
  from public.orders as orders
  where orders.id = v_order_id;

  v_discount_amount := case
    when p_discount_type is null then 0
    else round(v_subtotal * 0.10, 2)
  end;
  v_total := v_subtotal - v_discount_amount;

  if p_payment_method = 'cash' and p_amount_received < v_total then
    raise exception 'Cash received must be at least the order total.';
  end if;
  if p_payment_method <> 'cash' and p_amount_received <> v_total then
    raise exception 'Card and E-wallet payments must match the order total.';
  end if;

  update public.orders
  set discount_type = p_discount_type,
      discount_amount = v_discount_amount,
      tax = 0,
      total = v_total,
      payment_method = p_payment_method,
      amount_received = p_amount_received
  where id = v_order_id;

  return v_order_id;
end;
$$;

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
begin
  raise exception 'Refunds must be approved using a manager or admin PIN.';
end;
$$;

revoke all on function public.record_order_refund(uuid, numeric, text)
  from public, anon, authenticated;

create or replace function public.approve_order_refund_with_pin(
  p_order_id uuid,
  p_amount numeric,
  p_reason text,
  p_manager_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pos_user_id uuid := auth.uid();
  v_manager_user_id uuid;
  v_order_total numeric(10, 2);
  v_refunded numeric(10, 2);
  v_refund_id uuid;
  v_attempts integer;
  v_locked_until timestamptz;
begin
  if v_pos_user_id is null or not public.is_staff() then
    raise exception 'An authorized signed-in POS account is required to record a refund.';
  end if;
  if p_order_id is null
    or p_amount is null
    or p_amount <= 0
    or p_amount > 99999999.99
    or p_amount::text in ('NaN', 'Infinity', '-Infinity')
    or p_reason is null
    or length(trim(p_reason)) not between 1 and 200 then
    raise exception 'Choose an order, enter a refund reason, and enter an amount greater than zero.';
  end if;

  insert into public.refund_pin_attempts (pos_user_id)
  values (v_pos_user_id)
  on conflict (pos_user_id) do nothing;

  select attempts.failed_attempts, attempts.locked_until
  into v_attempts, v_locked_until
  from public.refund_pin_attempts as attempts
  where attempts.pos_user_id = v_pos_user_id
  for update;

  if v_locked_until > clock_timestamp() then
    return jsonb_build_object(
      'status', 'locked',
      'retry_after', v_locked_until
    );
  end if;

  select staff.user_id into v_manager_user_id
  from public.staff_members as staff
  where staff.role in ('manager', 'admin')
    and staff.attendance_pin_hash is not null
    and extensions.crypt(coalesce(p_manager_pin, ''), staff.attendance_pin_hash) =
      staff.attendance_pin_hash
  limit 1;

  if v_manager_user_id is null or p_manager_pin !~ '^[0-9]{6}$' then
    update public.refund_pin_attempts as attempts
    set failed_attempts = case
          when attempts.locked_until is not null
            and attempts.locked_until <= clock_timestamp() then 1
          else attempts.failed_attempts + 1
        end,
        locked_until = case
          when (
            case
              when attempts.locked_until is not null
                and attempts.locked_until <= clock_timestamp() then 1
              else attempts.failed_attempts + 1
            end
          ) >= 5
            then clock_timestamp() + interval '10 minutes'
          else null
        end
    where attempts.pos_user_id = v_pos_user_id
    returning attempts.failed_attempts, attempts.locked_until
    into v_attempts, v_locked_until;

    return jsonb_build_object(
      'status', case when v_locked_until is null then 'invalid_pin' else 'locked' end,
      'attempts_remaining', greatest(0, 5 - v_attempts),
      'retry_after', v_locked_until
    );
  end if;

  update public.refund_pin_attempts as attempts
  set failed_attempts = 0,
      locked_until = null
  where attempts.pos_user_id = v_pos_user_id;

  select order_row.total into v_order_total
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
    p_order_id, round(p_amount, 2), trim(p_reason), v_manager_user_id
  )
  returning id into v_refund_id;

  return jsonb_build_object(
    'status', 'refunded',
    'refund_id', v_refund_id
  );
end;
$$;

revoke all on function public.approve_order_refund_with_pin(
  uuid, numeric, text, text
) from public, anon;
grant execute on function public.approve_order_refund_with_pin(
  uuid, numeric, text, text
) to authenticated;

create or replace function public.register_product_availability()
returns table (
  product_id text,
  variant text,
  is_available boolean,
  unavailable_ingredients text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_staff() then
    raise exception 'An authorized staff account is required to view product availability.';
  end if;

  return query
  with variants as (
    select product.id as product_id, 'regular'::text as variant
    from public.products as product
    where product.active
    union all
    select product.id, 'large'::text
    from public.products as product
    where product.active and product.large_price is not null
  ),
  effective as (
    select variants.*,
      case
        when variants.variant = 'large' and exists (
          select 1 from public.product_recipes as recipe
          where recipe.product_id = variants.product_id
            and recipe.variant = 'large'
        ) then 'large'
        else 'regular'
      end as recipe_variant
    from variants
  ),
  consumption as (
    select effective.product_id, effective.variant,
      recipe.inventory_item_id,
      sum(recipe.quantity_per_product) as quantity
    from effective
    join public.product_recipes as recipe
      on recipe.product_id = effective.product_id
      and recipe.variant = effective.recipe_variant
    group by effective.product_id, effective.variant, recipe.inventory_item_id
    union all
    select effective.product_id, effective.variant,
      item.id, 1::numeric
    from effective
    join public.inventory_items as item
      on item.product_id = effective.product_id
      and item.item_type = 'product'
    where not exists (
      select 1 from public.product_recipes as recipe
      where recipe.product_id = effective.product_id
        and recipe.variant = effective.recipe_variant
    )
  )
  select effective.product_id,
    effective.variant,
    count(consumption.inventory_item_id) filter (
      where item.id is not null and item.active and item.quantity >= consumption.quantity
    ) = count(consumption.inventory_item_id),
    coalesce(
      array_agg(distinct coalesce(item.name, 'Inventory item'))
        filter (
          where item.id is null or not item.active or item.quantity < consumption.quantity
        ),
      array[]::text[]
    )
  from effective
  left join consumption
    on consumption.product_id = effective.product_id
    and consumption.variant = effective.variant
  left join public.inventory_items as item
    on item.id = consumption.inventory_item_id
  group by effective.product_id, effective.variant;
end;
$$;

revoke all on function public.register_product_availability()
  from public, anon;
grant execute on function public.register_product_availability()
  to authenticated;
