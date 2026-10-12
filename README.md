# Kape Na Naman POS

A Next.js point-of-sale app with a Supabase menu, staff email/password sign-in,
and order saving. Checkout records Cash, Card, or E-wallet as the payment
method; it does not process electronic payments. Completed orders show a
printable receipt.

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
   - `supabase/migrations/20261013000100_checkout_payment_receipt.sql`
   - `supabase/migrations/20261013000200_dashboard_supply_stock_only.sql`
   - `supabase/migrations/20261013000300_staff_register_activity.sql`
   - `supabase/migrations/20261013000400_edit_supply_details.sql`
   - `supabase/migrations/20261013000500_pwd_senior_order_discount.sql`
   - `supabase/migrations/20261013000600_register_transaction_receipts.sql`
   - `supabase/migrations/20261013000700_sales_reports.sql`
   - `supabase/migrations/20261013000800_fix_sales_report_date_series.sql`
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
sales reports, inventory, products, customers, and employees. Sales Reports
can filter date ranges, show revenue, order count, average orders per day,
items sold, and amount received by payment method, and export the report to
CSV or print/save it as PDF. Report dates use Philippines time. Every active
menu product is automatically linked to inventory. Products without a recipe deduct finished
product stock at checkout; products with a recipe deduct each recipe supply
atomically instead. Insufficient ingredient or product stock prevents checkout.
Checkout requires a payment method. Cash requires an amount received at least
equal to the order total and calculates change; Card and E-wallet are recorded
as exact-total payments but are not processed by a payment provider. A
successful order opens a printable receipt.
The register can apply one 10% PWD or Senior Citizen discount to an order.
The discount is applied to the subtotal before the app's existing 8% tax, and
the saved order, payment validation, and printed receipt use the discounted
amount. This is a flat POS discount setting and does not implement statutory
eligibility verification or tax treatment.
All staff can open a printable receipt from each recent transaction; PWD or
Senior Citizen discounts are tagged in the list and detailed on the receipt.
Refunds initiated from
the register require a Manager or Admin to approve with their Supabase email
and password; the approver is separately authenticated and the active cashier
session is preserved. Managers and admins can also record operating expenses
from the register.
The dashboard's low-stock alert lists supply inventory only, not finished
products. Managers can edit supply names, units, on-hand quantities, and
low-stock thresholds; manual quantity changes are recorded in stock history.
Changing a supply unit changes how recipe quantities are interpreted, so
review affected recipes after changing it. For each supply, set its cost per
inventory unit and record its current unit cost when restocking. Managers can
also update a supply's unit cost without changing its on-hand quantity;
updated costs apply to future ingredient cost calculations. Recipes specify
the amount of each supply used for one
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
