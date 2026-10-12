create table public.store_settings (
  singleton boolean primary key default true check (singleton),
  store_name text not null check (length(trim(store_name)) between 1 and 100),
  address text not null default '' check (length(address) <= 250),
  phone text not null default '' check (length(phone) <= 32),
  receipt_footer text not null default 'Thank you for your order!'
    check (length(receipt_footer) <= 200),
  tax_rate numeric(5, 2) not null default 8
    check (tax_rate between 0 and 100),
  currency_symbol text not null default '₱'
    check (length(trim(currency_symbol)) between 1 and 6),
  global_low_stock_threshold numeric(12, 3) not null default 10
    check (global_low_stock_threshold between 0 and 999999999.999),
  background_video_path text,
  background_video_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.store_settings (singleton, store_name)
values (true, 'KAPE NA NAMAN');

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
)
values (
  'store-media',
  'store-media',
  true,
  52428800,
  array['video/mp4', 'video/webm']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can view landing background videos"
  on storage.objects;
create policy "Public can view landing background videos"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'store-media');

drop policy if exists "Managers can upload store media"
  on storage.objects;
create policy "Managers can upload store media"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'store-media'
    and public.can_manage_menu()
  );

drop policy if exists "Managers can delete store media"
  on storage.objects;
create policy "Managers can delete store media"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'store-media'
    and public.can_manage_menu()
  );

alter table public.store_settings enable row level security;
revoke all on public.store_settings from public, anon, authenticated;

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
    'receipt_footer', settings.receipt_footer,
    'tax_rate', settings.tax_rate,
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

create or replace function public.update_store_settings(
  p_store_name text,
  p_address text,
  p_phone text,
  p_receipt_footer text,
  p_tax_rate numeric,
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
    or p_receipt_footer is null or length(p_receipt_footer) > 200
    or p_tax_rate is null or p_tax_rate < 0 or p_tax_rate > 100
    or p_tax_rate::text in ('NaN', 'Infinity', '-Infinity')
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
    raise exception 'Enter valid store, tax, currency, and stock threshold settings.';
  end if;

  update public.store_settings
  set store_name = trim(p_store_name),
      address = trim(p_address),
      phone = trim(p_phone),
      receipt_footer = trim(p_receipt_footer),
      tax_rate = round(p_tax_rate, 2),
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

revoke all on function public.get_store_settings()
  from public, anon;
grant execute on function public.get_store_settings()
  to authenticated;
revoke all on function public.update_store_settings(
  text, text, text, text, numeric, text, numeric, text, boolean
) from public, anon;
grant execute on function public.update_store_settings(
  text, text, text, text, numeric, text, numeric, text, boolean
) to authenticated;

create or replace function public.get_landing_video_path()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select settings.background_video_path
  from public.store_settings as settings
  where settings.singleton and settings.background_video_enabled;
$$;

revoke all on function public.get_landing_video_path()
  from public;
grant execute on function public.get_landing_video_path()
  to anon, authenticated;

create or replace function public.apply_landing_video(p_video_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_menu() then
    raise exception 'Manager or admin access is required to change the landing video.';
  end if;
  if p_video_path is null
    or p_video_path !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp4|webm)$'
    or not exists (
      select 1
      from storage.objects as media
      where media.bucket_id = 'store-media'
        and media.name = p_video_path
    ) then
    raise exception 'Upload a valid MP4 or WebM background video first.';
  end if;

  update public.store_settings
  set background_video_path = p_video_path,
      background_video_enabled = true,
      updated_at = now()
  where singleton;
end;
$$;

revoke all on function public.apply_landing_video(text)
  from public, anon;
grant execute on function public.apply_landing_video(text)
  to authenticated;

drop function public.complete_order(jsonb, text, text, numeric);

create function public.complete_order(
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
    and p_discount_type not in ('pwd', 'senior') then
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

revoke all on function public.complete_order(jsonb, text, text, numeric)
  from public, anon;
grant execute on function public.complete_order(jsonb, text, text, numeric)
  to authenticated;

alter function public.manager_dashboard(timestamptz, timestamptz)
  rename to manager_dashboard_before_store_settings;

revoke all on function public.manager_dashboard_before_store_settings(
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
  v_global_threshold numeric(12, 3);
begin
  if not public.can_manage_menu() then
    raise exception 'Manager or admin access is required to view business metrics.';
  end if;

  v_metrics := public.manager_dashboard_before_store_settings(p_from, p_to);

  select settings.global_low_stock_threshold
  into strict v_global_threshold
  from public.store_settings as settings
  where settings.singleton;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', stock.id,
    'name', stock.name,
    'quantity', stock.quantity,
    'threshold', stock.threshold,
    'unit', stock.unit
  ) order by stock.quantity, stock.name), '[]'::jsonb)
  into v_low_stock
  from (
    select
      item.id,
      item.name,
      item.quantity,
      coalesce(nullif(item.low_stock_threshold, 0), v_global_threshold)
        as threshold,
      item.unit
    from public.inventory_items as item
    where item.active
      and item.item_type = 'supply'
      and item.quantity <= coalesce(
        nullif(item.low_stock_threshold, 0),
        v_global_threshold
      )
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
