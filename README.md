# Kape Na Naman POS

A Next.js point-of-sale prototype with a Supabase menu, staff email/password
sign-in, and order saving. Checkout records orders only; it does not process
payments.

## Local setup

1. Install dependencies with `npm.cmd install`.
2. Copy `.env.example` to `.env.local`.
3. Set `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `.env.local`. Use the project's
   publishable key, never a secret or service-role key.
4. In the Supabase SQL Editor, run the migrations in order:
   - `supabase/migrations/20261012110000_create_pos_tables.sql`
   - `supabase/migrations/20261012120000_require_staff_auth.sql`
   - `supabase/migrations/20261012130000_staff_manage_menu.sql`
   - `supabase/migrations/20261012140000_menu_management_roles.sql`
   - `supabase/migrations/20261012150000_display_staff_role.sql`
   - `supabase/migrations/20261012160000_manager_dashboard.sql`
   - `supabase/migrations/20261012170000_inventory_customers_employees.sql`
   - `supabase/migrations/20261012180000_kape_menu_sizes.sql`
   - `supabase/migrations/20261012190000_non_coffee_menu.sql`
   - `supabase/migrations/20261012200000_auto_track_menu_inventory.sql`
   - `supabase/migrations/20261012210000_dashboard_financials.sql`
   - `supabase/migrations/20261012220000_product_recipes_inventory_cost.sql`
   - `supabase/migrations/20261012230000_inventory_supply_cost_update.sql`
5. In the Supabase dashboard, create a staff user under **Authentication →
   Users**. Copy that user's UUID.
6. Add the user to the staff allowlist in the SQL Editor, replacing the value
   with the UUID:

   ```sql
   insert into public.staff_members (user_id)
   values ('00000000-0000-0000-0000-000000000000');
   ```

   Repeat these steps for each staff account. Only allowlisted accounts can
   access the POS or place orders. Existing staff are assigned the `staff`
   role by default. Promote menu managers using the next step.
7. In the Supabase SQL Editor, promote approved managers (replace the email
   with the account's email):

   ```sql
   update public.staff_members
   set role = 'manager'
   where user_id = (
     select id from auth.users where email = 'manager@example.com'
   );
   ```

   To give a higher-level administrator access, set the role to `admin`.
   Regular `staff` accounts can use the register but cannot open or change the
   menu. Disable public sign-ups in Supabase Auth settings so visitors cannot
   create accounts.
8. Start the app with `npm.cmd run dev` and open
   [http://localhost:3000](http://localhost:3000).

Managers and admins can use the management sidebar for the dashboard,
inventory, products, customers, and employees. Every active menu product is
automatically linked to inventory. Products without a recipe deduct finished
product stock at checkout; products with a recipe deduct each recipe supply
atomically instead. Insufficient ingredient or product stock prevents checkout.
For each supply, set its cost per inventory unit and record its current unit
cost when restocking. Managers can also update a supply's unit cost without
changing its on-hand quantity; updated costs apply to future ingredient cost
calculations. Recipes specify the amount of each supply used for one
drink; Regular and Large can have separate recipes, and Large falls back to the
Regular recipe when no Large-specific recipe is saved. Ingredient cost is
snapshotted on every order so daily cost reports use the cost known at the time
of sale. To add an employee, first create their Auth
account in Supabase, then use the Employees page with that account's user ID.
Managers can manage regular staff; only admins can assign elevated roles.
The KAPE NA NAMAN menu migration archives the previous sample products,
installs the requested PHP menu and prices, and supports Regular/Large drink
variants in POS orders. The Non-Coffee menu migration adds the Non-Coffee
category and its products without archiving or changing existing menu items.
The dashboard financials migration adds product cost snapshots, refund and
expense tracking, and weekly dashboard reporting. Set Regular and Large item
costs in Products for meaningful gross-profit figures; costs are snapshotted
when an order is placed, so older orders without saved costs are identified as
uncosted. For the displayed period, gross profit is revenue minus refunds and
recorded item costs; net profit is gross profit minus recorded expenses.
Revenue uses order totals (including the app's current tax amount), and refund
and expense entries affect the period in which they are recorded. Record
operating expenses separately from ingredient costs used for cost of goods sold
to avoid counting the same costs twice.

The POS route and database access both require staff authorization. The
publishable key is intended for browser use; the database policies and
server-side checks enforce access. Never expose a Supabase secret or
service-role key in this app.
