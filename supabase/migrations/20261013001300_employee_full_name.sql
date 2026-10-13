drop function public.list_staff_members();

create function public.list_staff_members()
returns table (
  user_id uuid,
  full_name text,
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
    nullif(auth_user.raw_user_meta_data->>'full_name', ''),
    auth_user.email::text,
    staff.role,
    staff.created_at,
    staff.attendance_pin_hash is not null
  from public.staff_members as staff
  join auth.users as auth_user on auth_user.id = staff.user_id
  order by coalesce(
    nullif(auth_user.raw_user_meta_data->>'full_name', ''),
    auth_user.email
  );
end;
$$;

revoke all on function public.list_staff_members() from public, anon;
grant execute on function public.list_staff_members() to authenticated;
