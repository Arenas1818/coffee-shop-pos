alter table public.store_settings
  add column if not exists visible_store_fields text[] not null
    default array['store_name', 'address', 'vat_tin']::text[];

alter table public.store_settings
  add constraint store_settings_visible_store_fields_check
  check (
    visible_store_fields <@ array[
      'store_name',
      'address',
      'phone',
      'vat_tin'
    ]::text[]
    and cardinality(visible_store_fields) <= 4
  );

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
    'additional_details', settings.additional_details,
    'visible_store_fields', settings.visible_store_fields,
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
  text, text, text, text, text, text, numeric, text, boolean, jsonb
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
  p_background_video_enabled boolean,
  p_additional_details jsonb,
  p_visible_store_fields text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_detail jsonb;
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

  if p_additional_details is null
    or jsonb_typeof(p_additional_details) is distinct from 'array' then
    raise exception 'Additional store details must be an array of at most 10 fields.';
  end if;
  if jsonb_array_length(p_additional_details) > 10 then
    raise exception 'Additional store details must be an array of at most 10 fields.';
  end if;

  for v_detail in
    select entries.value
    from jsonb_array_elements(p_additional_details) as entries(value)
  loop
    if jsonb_typeof(v_detail) is distinct from 'object' then
      raise exception 'Each additional store detail must have a label and value.';
    end if;
    if (select count(*) from jsonb_object_keys(v_detail)) <> 2
      or jsonb_typeof(v_detail -> 'label') is distinct from 'string'
      or jsonb_typeof(v_detail -> 'value') is distinct from 'string' then
      raise exception 'Each additional store detail must have a label and value.';
    end if;
    if length(trim(v_detail ->> 'label')) not between 1 and 40
      or length(trim(v_detail ->> 'value')) not between 1 and 120 then
      raise exception 'Additional store detail labels must be 1-40 characters and values 1-120 characters.';
    end if;
  end loop;

  if p_visible_store_fields is null
    or not (p_visible_store_fields <@ array[
      'store_name',
      'address',
      'phone',
      'vat_tin'
    ]::text[])
    or cardinality(p_visible_store_fields) > 4
    or cardinality(p_visible_store_fields) <> (
      select count(distinct field)
      from unnest(p_visible_store_fields) as fields(field)
    ) then
    raise exception 'Choose valid store details to show on Sales Invoices.';
  end if;

  update public.store_settings
  set store_name = trim(p_store_name),
      address = trim(p_address),
      phone = trim(p_phone),
      vat_tin = trim(p_vat_tin),
      additional_details = p_additional_details,
      visible_store_fields = p_visible_store_fields,
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
  text, text, text, text, text, text, numeric, text, boolean, jsonb, text[]
) from public, anon;
grant execute on function public.update_store_settings(
  text, text, text, text, text, text, numeric, text, boolean, jsonb, text[]
) to authenticated;
