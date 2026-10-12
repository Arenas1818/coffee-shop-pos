alter table public.inventory_movements
  drop constraint if exists inventory_movements_movement_type_check;

alter table public.inventory_movements
  add constraint inventory_movements_movement_type_check
  check (movement_type in ('restock', 'sale', 'adjustment'));

alter table public.inventory_movements
  add column unit text;

drop function public.inventory_activity(uuid);

create function public.inventory_activity(p_inventory_item_id uuid)
returns table (
  id uuid,
  movement_type text,
  quantity_change numeric,
  note text,
  created_at timestamptz,
  staff_email text,
  unit text
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
    auth_user.email::text,
    movement.unit
  from public.inventory_movements as movement
  join auth.users as auth_user on auth_user.id = movement.staff_user_id
  where movement.inventory_item_id = p_inventory_item_id
  order by movement.created_at desc
  limit 50;
end;
$$;

revoke all on function public.inventory_activity(uuid)
  from public, anon;
grant execute on function public.inventory_activity(uuid)
  to authenticated;

create or replace function public.update_supply_details(
  p_inventory_item_id uuid,
  p_name text,
  p_unit text,
  p_quantity numeric,
  p_low_stock_threshold numeric,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_quantity numeric(12, 3);
  v_current_unit text;
  v_quantity numeric(12, 3);
  v_threshold numeric(12, 3);
begin
  if not public.can_manage_menu() then
    raise exception 'Manager or admin access is required to edit supplies.';
  end if;

  if p_inventory_item_id is null
    or p_name is null
    or length(trim(p_name)) not between 1 and 100
    or p_unit is null
    or length(trim(p_unit)) not between 1 and 24
    or p_quantity is null
    or p_quantity < 0
    or p_quantity > 999999999.999
    or p_quantity::text in ('NaN', 'Infinity', '-Infinity')
    or p_low_stock_threshold is null
    or p_low_stock_threshold < 0
    or p_low_stock_threshold > 999999999.999
    or p_low_stock_threshold::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'Enter a valid supply name, unit, quantity, and low-stock threshold.';
  end if;

  v_quantity := round(p_quantity, 3);
  v_threshold := round(p_low_stock_threshold, 3);

  select item.quantity, item.unit
  into v_current_quantity, v_current_unit
  from public.inventory_items as item
  where item.id = p_inventory_item_id
    and item.item_type = 'supply'
  for update;

  if not found then
    raise exception 'The supply does not exist.';
  end if;

  update public.inventory_items
  set name = trim(p_name),
      unit = trim(p_unit),
      quantity = v_quantity,
      low_stock_threshold = v_threshold,
      updated_at = now()
  where id = p_inventory_item_id;

  if trim(p_unit) <> v_current_unit then
    if v_current_quantity > 0 then
      insert into public.inventory_movements (
        inventory_item_id,
        staff_user_id,
        movement_type,
        quantity_change,
        note,
        unit
      )
      values (
        p_inventory_item_id,
        auth.uid(),
        'adjustment',
        -v_current_quantity,
        left(
          format(
            'Previous balance cleared after unit changed to %s',
            trim(p_unit)
          ),
          200
        ),
        v_current_unit
      );
    end if;

    if v_quantity > 0 then
      insert into public.inventory_movements (
        inventory_item_id,
        staff_user_id,
        movement_type,
        quantity_change,
        note,
        unit
      )
      values (
        p_inventory_item_id,
        auth.uid(),
        'adjustment',
        v_quantity,
        left(
          coalesce(
            nullif(trim(p_note), ''),
            format('Opening balance after unit changed from %s', v_current_unit)
          ),
          200
        ),
        trim(p_unit)
      );
    end if;
  elsif v_quantity <> v_current_quantity then
    insert into public.inventory_movements (
      inventory_item_id,
      staff_user_id,
      movement_type,
      quantity_change,
      note,
      unit
    )
    values (
      p_inventory_item_id,
      auth.uid(),
      'adjustment',
      v_quantity - v_current_quantity,
      left(coalesce(nullif(trim(p_note), ''), 'Supply quantity adjusted'), 200),
      v_current_unit
    );
  end if;
end;
$$;

revoke all on function public.update_supply_details(
  uuid, text, text, numeric, numeric, text
) from public, anon;
grant execute on function public.update_supply_details(
  uuid, text, text, numeric, numeric, text
) to authenticated;
