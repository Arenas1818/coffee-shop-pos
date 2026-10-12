alter table public.store_settings
  add column if not exists background_video_path text,
  add column if not exists background_video_enabled boolean not null default false;

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
