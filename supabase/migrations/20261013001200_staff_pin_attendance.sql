create extension if not exists pgcrypto with schema extensions;

alter table public.staff_members
  add column if not exists attendance_pin_hash text;

create table public.attendance_shifts (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null,
  staff_email text not null,
  clock_in_at timestamptz not null default clock_timestamp(),
  clock_out_at timestamptz,
  clock_in_by_email text not null,
  clock_out_by_email text,
  check (clock_out_at is null or clock_out_at >= clock_in_at)
);

create unique index attendance_shifts_one_open_per_staff_idx
  on public.attendance_shifts (staff_user_id)
  where clock_out_at is null;

create index attendance_shifts_clock_in_at_idx
  on public.attendance_shifts (clock_in_at desc);

alter table public.attendance_shifts enable row level security;
revoke all on public.attendance_shifts from public, anon, authenticated;

create table public.attendance_pin_attempts (
  pos_user_id uuid primary key references auth.users(id) on delete cascade,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  check (failed_attempts >= 0)
);

alter table public.attendance_pin_attempts enable row level security;
revoke all on public.attendance_pin_attempts from public, anon, authenticated;

drop function public.list_staff_members();

create function public.list_staff_members()
returns table (
  user_id uuid,
  email text,
  role text,
  created_at timestamptz,
  has_attendance_pin boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_role text;
begin
  select staff.role into v_actor_role
  from public.staff_members as staff
  where staff.user_id = auth.uid();

  if coalesce(v_actor_role, '') not in ('manager', 'admin') then
    raise exception 'Manager or admin access is required to view employees.';
  end if;

  return query
  select
    staff.user_id,
    auth_user.email::text,
    staff.role,
    staff.created_at,
    staff.attendance_pin_hash is not null
  from public.staff_members as staff
  join auth.users as auth_user on auth_user.id = staff.user_id
  order by auth_user.email;
end;
$$;

revoke all on function public.list_staff_members() from public, anon;
grant execute on function public.list_staff_members() to authenticated;

create or replace function public.set_staff_attendance_pin(
  p_user_id uuid,
  p_pin text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role text;
  v_target_role text;
begin
  if not public.can_manage_menu() then
    raise exception 'Manager or admin access is required to manage attendance PINs.';
  end if;

  select staff.role into v_actor_role
  from public.staff_members as staff
  where staff.user_id = auth.uid();

  select staff.role into v_target_role
  from public.staff_members as staff
  where staff.user_id = p_user_id
  for update;

  if not found then
    raise exception 'This user is not on the staff list.';
  end if;

  if v_actor_role = 'manager' and v_target_role <> 'staff' then
    raise exception 'Managers can only manage attendance PINs for regular staff.';
  end if;

  if p_pin is not null and p_pin !~ '^[0-9]{6}$' then
    raise exception 'Attendance PINs must contain exactly six digits.';
  end if;

  if p_pin is not null then
    perform pg_advisory_xact_lock(637410219);
    if exists (
      select 1
      from public.staff_members as staff
      where staff.user_id <> p_user_id
        and staff.attendance_pin_hash is not null
        and extensions.crypt(p_pin, staff.attendance_pin_hash) =
          staff.attendance_pin_hash
    ) then
      raise exception 'That PIN is already assigned. Choose a different six-digit PIN.';
    end if;
  end if;

  update public.staff_members
  set attendance_pin_hash = case
    when p_pin is null then null
    else extensions.crypt(p_pin, extensions.gen_salt('bf', 10))
  end
  where user_id = p_user_id;
end;
$$;

revoke all on function public.set_staff_attendance_pin(uuid, text)
  from public, anon;
grant execute on function public.set_staff_attendance_pin(uuid, text)
  to authenticated;

create or replace function public.punch_attendance(
  p_pin text,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pos_user_id uuid := auth.uid();
  v_pos_email text;
  v_staff_user_id uuid;
  v_staff_email text;
  v_attempts integer;
  v_locked_until timestamptz;
  v_shift public.attendance_shifts%rowtype;
  v_now timestamptz;
begin
  if v_pos_user_id is null or not public.is_staff() then
    raise exception 'Sign in to the POS with an authorized staff account before recording attendance.';
  end if;
  if p_action is null or p_action not in ('clock_in', 'clock_out') then
    raise exception 'Choose clock in or clock out.';
  end if;

  select auth_user.email::text into v_pos_email
  from auth.users as auth_user
  where auth_user.id = v_pos_user_id;

  insert into public.attendance_pin_attempts (pos_user_id)
  values (v_pos_user_id)
  on conflict (pos_user_id) do nothing;

  select attempts.failed_attempts, attempts.locked_until
  into v_attempts, v_locked_until
  from public.attendance_pin_attempts as attempts
  where attempts.pos_user_id = v_pos_user_id
  for update;

  if v_locked_until > clock_timestamp() then
    return jsonb_build_object(
      'status', 'locked',
      'retry_after', v_locked_until
    );
  end if;

  select staff.user_id into v_staff_user_id
  from public.staff_members as staff
  where staff.attendance_pin_hash is not null
    and extensions.crypt(coalesce(p_pin, ''), staff.attendance_pin_hash) =
      staff.attendance_pin_hash
  limit 1;

  if v_staff_user_id is null or p_pin !~ '^[0-9]{6}$' then
    update public.attendance_pin_attempts as attempts
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

  update public.attendance_pin_attempts as attempts
  set failed_attempts = 0,
      locked_until = null
  where attempts.pos_user_id = v_pos_user_id;

  select auth_user.email::text
  into v_staff_email
  from public.staff_members as staff
  join auth.users as auth_user on auth_user.id = staff.user_id
  where staff.user_id = v_staff_user_id
  for update of staff;

  v_now := clock_timestamp();
  if p_action = 'clock_in' then
    if exists (
      select 1
      from public.attendance_shifts as shift
      where shift.staff_user_id = v_staff_user_id
        and shift.clock_out_at is null
    ) then
      return jsonb_build_object(
        'status', 'already_clocked_in',
        'staff_email', v_staff_email
      );
    end if;

    insert into public.attendance_shifts (
      staff_user_id,
      staff_email,
      clock_in_at,
      clock_in_by_email
    )
    values (
      v_staff_user_id,
      v_staff_email,
      v_now,
      coalesce(v_pos_email, 'POS staff')
    )
    returning * into v_shift;

    return jsonb_build_object(
      'status', 'clocked_in',
      'staff_email', v_staff_email,
      'punched_at', v_shift.clock_in_at
    );
  end if;

  select shift.* into v_shift
  from public.attendance_shifts as shift
  where shift.staff_user_id = v_staff_user_id
    and shift.clock_out_at is null
  order by shift.clock_in_at desc
  limit 1
  for update;

  if not found then
    return jsonb_build_object(
      'status', 'not_clocked_in',
      'staff_email', v_staff_email
    );
  end if;

  update public.attendance_shifts as shift
  set clock_out_at = v_now,
      clock_out_by_email = coalesce(v_pos_email, 'POS staff')
  where shift.id = v_shift.id
  returning * into v_shift;

  return jsonb_build_object(
    'status', 'clocked_out',
    'staff_email', v_staff_email,
    'punched_at', v_shift.clock_out_at
  );
end;
$$;

revoke all on function public.punch_attendance(text, text)
  from public, anon;
grant execute on function public.punch_attendance(text, text)
  to authenticated;

create or replace function public.manager_attendance_report(
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from timestamptz;
  v_to timestamptz;
  v_report jsonb;
begin
  if not public.can_manage_menu() then
    raise exception 'Manager or admin access is required to view attendance.';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Choose a valid attendance date range.';
  end if;
  if p_to - p_from > 365 then
    raise exception 'Attendance reports are limited to one year at a time.';
  end if;

  v_from := p_from::timestamp at time zone 'Asia/Manila';
  v_to := (p_to + 1)::timestamp at time zone 'Asia/Manila';

  select jsonb_build_object(
    'from_date', p_from,
    'to_date', p_to,
    'shifts', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', shift.id,
          'staff_email', shift.staff_email,
          'clock_in_at', shift.clock_in_at,
          'clock_out_at', shift.clock_out_at,
          'seconds_worked', floor(extract(epoch from (
            coalesce(shift.clock_out_at, clock_timestamp()) - shift.clock_in_at
          )))::bigint,
          'clock_in_by_email', shift.clock_in_by_email,
          'clock_out_by_email', shift.clock_out_by_email
        )
        order by shift.clock_in_at desc
      ),
      '[]'::jsonb
    )
  )
  into v_report
  from public.attendance_shifts as shift
  where shift.clock_in_at >= v_from
    and shift.clock_in_at < v_to;

  return v_report;
end;
$$;

revoke all on function public.manager_attendance_report(date, date)
  from public, anon;
grant execute on function public.manager_attendance_report(date, date)
  to authenticated;

drop function public.remove_staff_member(uuid);

create function public.remove_staff_member(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role text;
  v_target_role text;
begin
  select staff.role into v_actor_role
  from public.staff_members as staff
  where staff.user_id = auth.uid();

  if coalesce(v_actor_role, '') not in ('manager', 'admin') then
    raise exception 'Manager or admin access is required to manage employees.';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot remove your own staff access.';
  end if;

  select staff.role into v_target_role
  from public.staff_members as staff
  where staff.user_id = p_user_id
  for update;

  if not found then
    raise exception 'This user is not on the staff list.';
  end if;
  if v_actor_role = 'manager' and v_target_role <> 'staff' then
    raise exception 'Managers can only remove regular staff accounts.';
  end if;
  if v_target_role = 'admin' and (
    select count(*) from public.staff_members as staff where staff.role = 'admin'
  ) <= 1 then
    raise exception 'Promote another admin before removing the last admin role.';
  end if;
  if exists (
    select 1
    from public.attendance_shifts as shift
    where shift.staff_user_id = p_user_id
      and shift.clock_out_at is null
  ) then
    raise exception 'This employee has an open shift. Clock them out before removing POS access.';
  end if;

  delete from public.staff_members where user_id = p_user_id;
end;
$$;

revoke all on function public.remove_staff_member(uuid) from public, anon;
grant execute on function public.remove_staff_member(uuid) to authenticated;
