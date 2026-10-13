# Kape Na Naman POS

A Next.js point-of-sale app with a Supabase menu, staff email/password sign-in,
and order saving. Checkout records Cash, Card, or E-wallet as the payment
method; it does not process electronic payments. Completed orders show a
printable receipt.

## Local setup

1. Install dependencies with `npm.cmd install`.
2. Copy `.env.example` to `.env.local`.
3. Set `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `.env.local`. To create employee
   Auth accounts from the Employees page, also set `SUPABASE_SERVICE_ROLE_KEY`
   using the project's server-side service role key. Never prefix this secret
   with `NEXT_PUBLIC_`, expose it to browser code, or commit its value.
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
   - `supabase/migrations/20261013000900_store_settings.sql`
   - `supabase/migrations/20261013001000_landing_background_video.sql`
   - `supabase/migrations/20261013001100_combined_pwd_senior_discount.sql`
   - `supabase/migrations/20261013001200_staff_pin_attendance.sql`
   - `supabase/migrations/20261013001300_employee_full_name.sql`
   - `supabase/migrations/20261013001400_register_tax_tin_refund_pin_availability.sql`
5. In the Supabase dashboard, create the initial staff user under
   **Authentication → Users**, then add their UUID to `public.staff_members`
   in the SQL Editor. Subsequent employees can be created from the Employees
   workspace. Promote approved managers (replace the email
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
6. Start the app with `npm.cmd run dev` and open
   [http://localhost:3000](http://localhost:3000).

Managers and admins can use the management sidebar for the dashboard,
sales reports, inventory, products, customers, employees, and Settings. In Employees, managers can create Auth users by entering a username. The app creates a unique `<username>@kpnnmn.com` account with a random,
unshared password, and grants it the selected POS role. These generated
accounts are for employee identity and attendance PIN ownership; staff clock
in/out with their separate six-digit attendance PIN while the shared cashier
remains signed in. The server-side `SUPABASE_SERVICE_ROLE_KEY` is required for
this account-creation flow and must also be configured as a secret in the
deployment environment. Generated addresses do not receive email, so do not
use these accounts for normal email/password login or password recovery.
Settings controls store name, address, phone, VAT REG TIN, receipt footer,
currency symbol, global low-stock threshold fallback, and the optional landing
video upload. VAT REG TIN is printed on Sales Invoices when provided. The
uploaded MP4 or WebM video is stored in Supabase Storage, limited to 50 MB, and
plays muted behind the sign-in page. The register does not add tax. Migration
`20261013001400` recalculates all existing orders without tax while preserving
the prior tax, total, and received amount in backup columns for audit purposes.
Sales Reports
can filter date ranges, show revenue, order count, average orders per day,
items sold, and amount received by payment method, and export the report to
CSV or print/save it as PDF. Report dates use Philippines time. Every active
menu product is automatically linked to inventory. Products without a recipe
deduct finished product stock at checkout; products with a recipe deduct each recipe supply
atomically instead. Insufficient ingredient or product stock prevents checkout.
Checkout requires a payment method. Cash requires an amount received at least
equal to the order total and calculates change; Card and E-wallet are recorded
as exact-total payments but are not processed by a payment provider. A
successful order opens a printable receipt.
The register can apply one combined 10% PWD / Senior Citizen discount to an order.
The discount is applied to the subtotal, and the saved order, payment
validation, and printed Sales Invoice use the discounted amount without tax.
New combined discounts are recorded as PWD / Senior Citizen without
distinguishing which eligibility type was selected; previously recorded PWD
and Senior Citizen orders retain their original labels. This is a flat POS
discount setting and does not implement statutory eligibility verification or
tax treatment.
All staff can open a printable receipt from each recent transaction; discounts
are tagged in the list and detailed on the receipt.
Refunds initiated from the register or dashboard require a Manager or Admin
attendance PIN. The PIN is checked without changing the active cashier session,
and the approving manager is recorded with the refund. Managers and admins can
also record operating expenses from the register.
The dashboard's low-stock alert lists supply inventory only, not finished
products. Managers can edit supply names, units, on-hand quantities, and
low-stock thresholds; manual quantity changes are recorded in stock history.
Changing a supply unit changes how recipe quantities are interpreted, so
review affected recipes after changing it. For each supply, set its cost per
inventory unit and record its current unit cost when restocking. Managers can
also update a supply's unit cost without changing its on-hand quantity;
updated costs apply to future ingredient cost calculations. Manage product
recipes from Products; recipes specify the amount of each supply used for one
drink; Regular and Large can have separate recipes, and Large falls back to the
Regular recipe when no Large-specific recipe is saved. Ingredient cost is
snapshotted on every order so daily cost reports use the cost known at the time
of sale.
Managers can manage regular staff; only admins can assign elevated roles. Managers
and admins can set or reset each employee's six-digit attendance-only PIN on the
Employees page. An admin must set PINs for managers/admins so they can approve
refunds. Staff enter that PIN at the shared register to clock in or out;
it never switches or signs in the POS cashier account. PINs are stored as salted
hashes, and five incorrect attempts from one signed-in POS account trigger a
10-minute lockout; refund approval has its own independent PIN lockout. Managers can view Manila-time shifts and export attendance
CSV from the Attendance workspace. Employees with an open shift cannot have
their POS access removed until they are clocked out. Attendance records are not
payroll calculations; review and correct them using your established payroll
process.
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
Revenue uses saved order totals without tax, and refund
and expense entries affect the period in which they are recorded. Record
operating expenses separately from ingredient costs used for cost of goods sold
to avoid counting the same costs twice.

The POS route and database access both require staff authorization. The
publishable key is intended for browser use; the database policies and
server-side checks enforce access. Never expose a Supabase secret or
service-role key in this app.
