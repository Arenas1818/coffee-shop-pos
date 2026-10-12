create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 100),
  item_type text not null check (item_type in ('supply', 'product')),
  product_id text unique references public.products(id) on delete set null,
  unit text not null check (length(trim(unit)) between 1 and 24),
  quantity numeric(12, 3) not null default 0 check (quantity >= 0),
  low_stock_threshold numeric(12, 3) not null default 0
    check (low_stock_threshold >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_item_product_link_check check (
    (item_type = 'supply' and product_id is null)
    or (item_type = 'product' and product_id is not null)
  )
);

create index inventory_items_active_low_stock_idx
  on public.inventory_items (active, quantity, low_stock_threshold);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items(id),
  staff_user_id uuid not null references auth.users(id),
  movement_type text not null check (movement_type in ('restock', 'sale')),
  quantity_change numeric(12, 3) not null check (quantity_change <> 0),
  note text,
  created_at timestamptz not null default now()
);

create index inventory_movements_item_created_idx
  on public.inventory_movements (inventory_item_id, created_at desc);

alter table public.inventory_items enable row level security;
alter table public.inventory_movements enable row level security;

revoke all on public.inventory_items, public.inventory_movements
  from anon, authenticated;
grant select on public.inventory_items to authenticated;
grant insert (name, item_type, product_id, unit, low_stock_threshold)
  on public.inventory_items to authenticated;
grant update (name, unit, low_stock_threshold, active)
  on public.inventory_items to authenticated;

drop policy if exists "Managers can read inventory"
  on public.inventory_items;
drop policy if exists "Managers can add inventory"
  on public.inventory_items;
drop policy if exists "Managers can update inventory"
  on public.inventory_items;

create policy "Managers can read inventory"
  on public.inventory_items for select
  to authenticated
  using (public.can_manage_menu());

create policy "Managers can add inventory"
  on public.inventory_items for insert
  to authenticated
  with check (public.can_manage_menu());

create policy "Managers can update inventory"
  on public.inventory_items for update
  to authenticated
  using (public.can_manage_menu())
  with check (public.can_manage_menu());

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  email text,
  phone text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index customers_name_idx on public.customers (lower(name));

alter table public.customers enable row level security;
revoke all on public.customers from anon, authenticated;
grant select, insert, update on public.customers to authenticated;

drop policy if exists "Managers can manage customers"
  on public.customers;

create policy "Managers can manage customers"
  on public.customers for all
  to authenticated
  using (public.can_manage_menu())
  with check (public.can_manage_menu());

create or replace function public.restock_inventory(
  p_inventory_item_id uuid,
  p_quantity numeric,
  p_note text default null
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_quantity numeric(12, 3);
  v_new_quantity numeric(12, 3);
begin
  if not public.can_manage_menu() then
    raise exception 'Manager or admin access is required to restock inventory.';
  end if;

  if p_quantity is null or p_quantity <= 0 or p_quantity > 1000000 then
    raise exception 'Restock quantity must be greater than zero and no more than 1,000,000.';
  end if;

  select item.quantity
  into v_current_quantity
  from public.inventory_items as item
  where item.id = p_inventory_item_id and item.active
  for update;

  if not found then
    raise exception 'The inventory item does not exist or is inactive.';
  end if;

  v_new_quantity := v_current_quantity + p_quantity;
  if v_new_quantity > 999999999.999 then
    raise exception 'The resulting inventory quantity is too large.';
  end if;

  update public.inventory_items
  set quantity = v_new_quantity, updated_at = now()
  where id = p_inventory_item_id;

  insert into public.inventory_movements (
    inventory_item_id, staff_user_id, movement_type, quantity_change, note
  )
  values (
    p_inventory_item_id, auth.uid(), 'restock', p_quantity,
    nullif(left(trim(coalesce(p_note, '')), 200), '')
  );

  return v_new_quantity;
end;
$$;

revoke all on function public.restock_inventory(uuid, numeric, text)
  from public, anon;
grant execute on function public.restock_inventory(uuid, numeric, text)
  to authenticated;

create or replace function public.list_staff_members()
returns table (user_id uuid, email text, role text, created_at timestamptz)
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
  select staff.user_id, auth_user.email::text, staff.role, staff.created_at
  from public.staff_members as staff
  join auth.users as auth_user on auth_user.id = staff.user_id
  order by auth_user.email;
end;
$$;

revoke all on function public.list_staff_members() from public, anon;
grant execute on function public.list_staff_members() to authenticated;

create or replace function public.save_staff_member(
  p_user_id uuid,
  p_role text
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
  select staff.role into v_actor_role
  from public.staff_members as staff
  where staff.user_id = auth.uid();

  if coalesce(v_actor_role, '') not in ('manager', 'admin') then
    raise exception 'Manager or admin access is required to manage employees.';
  end if;

  if p_role not in ('staff', 'manager', 'admin') then
    raise exception 'Choose a valid employee role.';
  end if;

  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'No Supabase Auth user exists with that user ID.';
  end if;

  select staff.role into v_target_role
  from public.staff_members as staff
  where staff.user_id = p_user_id
  for update;

  if v_actor_role = 'manager'
    and (p_role <> 'staff' or coalesce(v_target_role, 'staff') <> 'staff') then
    raise exception 'Managers can only add or update regular staff accounts.';
  end if;

  if v_actor_role = 'admin' and v_target_role = 'admin'
    and p_role <> 'admin' then
    if (
      select count(*)
      from public.staff_members as staff
      where staff.role = 'admin'
    ) <= 1 then
      raise exception 'Promote another admin before changing the last admin role.';
    end if;
  end if;

  insert into public.staff_members (user_id, role)
  values (p_user_id, p_role)
  on conflict (user_id)
  do update set role = excluded.role;
end;
$$;

revoke all on function public.save_staff_member(uuid, text) from public, anon;
grant execute on function public.save_staff_member(uuid, text) to authenticated;

create or replace function public.remove_staff_member(p_user_id uuid)
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
    raise exception 'Promote another admin before removing the last admin.';
  end if;

  delete from public.staff_members where user_id = p_user_id;
end;
$$;

revoke all on function public.remove_staff_member(uuid) from public, anon;
grant execute on function public.remove_staff_member(uuid) to authenticated;

create or replace function public.inventory_activity(p_inventory_item_id uuid)
returns table (
  id uuid,
  movement_type text,
  quantity_change numeric,
  note text,
  created_at timestamptz,
  staff_email text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_menu() then
    raise exception 'Manager or admin access is required to view stock history.';
  end if;

  return query
  select
    movement.id,
    movement.movement_type,
    movement.quantity_change,
    movement.note,
    movement.created_at,
    auth_user.email::text
  from public.inventory_movements as movement
  join auth.users as auth_user on auth_user.id = movement.staff_user_id
  where movement.inventory_item_id = p_inventory_item_id
  order by movement.created_at desc
  limit 50;
end;
$$;

revoke all on function public.inventory_activity(uuid) from public, anon;
grant execute on function public.inventory_activity(uuid) to authenticated;

create or replace function public.place_order(p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_subtotal numeric(10, 2);
  v_items jsonb;
  v_staff_user_id uuid := auth.uid();
  v_stock record;
begin
  if v_staff_user_id is null or not public.is_staff() then
    raise exception 'An authorized staff account is required to place an order.';
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Order items must be a JSON array.';
  end if;

  if jsonb_array_length(p_items) = 0 then
    raise exception 'An order must contain at least one item.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as input(item)
    where jsonb_typeof(input.item) is distinct from 'object'
      or coalesce(input.item->>'product_id', '') = ''
      or coalesce(input.item->>'quantity', '') !~ '^([1-9]|[1-9][0-9]|100)$'
  ) then
    raise exception 'Order items must have a product ID and quantity from 1 to 100.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as input(item)
    left join public.products as product
      on product.id = input.item->>'product_id' and product.active
    where product.id is null
  ) then
    raise exception 'An order contains a product that is unavailable.';
  end if;

  select
    round(sum(product.price * input.quantity), 2),
    jsonb_agg(
      jsonb_build_object(
        'product_id', product.id,
        'name', product.name,
        'quantity', input.quantity,
        'unit_price', product.price
      ) order by product.name
    )
  into v_subtotal, v_items
  from (
    select
      input.item->>'product_id' as product_id,
      sum((input.item->>'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) as input(item)
    group by input.item->>'product_id'
  ) as input
  join public.products as product on product.id = input.product_id;

  for v_stock in
    select item.id, item.name, item.quantity, input.quantity as requested
    from public.inventory_items as item
    join (
      select
        input.item->>'product_id' as product_id,
        sum((input.item->>'quantity')::integer)::integer as quantity
      from jsonb_array_elements(p_items) as input(item)
      group by input.item->>'product_id'
    ) as input on input.product_id = item.product_id
    where item.item_type = 'product'
    order by item.id
    for update of item
  loop
    if v_stock.quantity < v_stock.requested then
      raise exception 'Insufficient stock for % (available: %, requested: %).',
        v_stock.name, v_stock.quantity, v_stock.requested;
    end if;

    update public.inventory_items
    set quantity = quantity - v_stock.requested, updated_at = now()
    where id = v_stock.id;

    insert into public.inventory_movements (
      inventory_item_id, staff_user_id, movement_type, quantity_change, note
    )
    values (
      v_stock.id, v_staff_user_id, 'sale', -v_stock.requested, 'POS order'
    );
  end loop;

  insert into public.orders (items, subtotal, tax, total, staff_user_id)
  values (
    v_items,
    v_subtotal,
    round(v_subtotal * 0.08, 2),
    v_subtotal + round(v_subtotal * 0.08, 2),
    v_staff_user_id
  )
  returning id into v_order_id;

  return v_order_id;
end;
$$;

revoke all on function public.place_order(jsonb) from public, anon;
grant execute on function public.place_order(jsonb) to authenticated;
