alter table public.products
  drop constraint if exists products_category_check;

alter table public.products
  add constraint products_category_check
  check (category in ('Coffee', 'Non-Coffee', 'Tea', 'Bakery'));

insert into public.products (
  id, name, description, category, price, large_price, icon, color, active
)
values
  ('kape-noncoffee-iced-choco', 'Iced Choco', 'Chilled chocolate drink', 'Non-Coffee', 59, 69, '🥛', 'oat', true),
  ('kape-noncoffee-dark-choco', 'Dark Choco', 'Rich dark chocolate drink', 'Non-Coffee', 69, 79, '🥛', 'chai', true),
  ('kape-noncoffee-milky-strawberry', 'Milky Strawberry', 'Creamy strawberry milk', 'Non-Coffee', 69, 79, '🥛', 'berry', true),
  ('kape-noncoffee-blackberry', 'Blackberry', 'Blackberry milk drink', 'Non-Coffee', 69, 79, '🧋', 'berry', true),
  ('kape-noncoffee-milky-caramel', 'Milky Caramel', 'Creamy caramel milk drink', 'Non-Coffee', 79, null, '🥛', 'chai', true),
  ('kape-noncoffee-matcha-latte', 'Matcha Latte', 'Creamy matcha latte', 'Non-Coffee', 89, null, '🍵', 'matcha', true)
on conflict (id) do update
set name = excluded.name,
    description = excluded.description,
    category = excluded.category,
    price = excluded.price,
    large_price = excluded.large_price,
    icon = excluded.icon,
    color = excluded.color,
    active = true;
