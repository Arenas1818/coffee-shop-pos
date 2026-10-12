"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const managementLinks = [
  { href: "/dashboard", label: "Dashboard", icon: "▦" },
  { href: "/sales-reports", label: "Sales Reports", icon: "↗" },
  { href: "/inventory", label: "Inventory", icon: "▤" },
  { href: "/menu", label: "Products", icon: "☕" },
  { href: "/customers", label: "Customers", icon: "♙" },
  { href: "/employees", label: "Employees", icon: "♧" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

export default function ManagementSidebar({
  role,
}: {
  role: "manager" | "admin";
}) {
  const pathname = usePathname();

  return (
    <aside className="w-full shrink-0 lg:sticky lg:top-0 lg:h-[calc(100vh-1px)] lg:w-64 lg:border-r lg:border-cafe-border lg:bg-cafe-card lg:px-4 lg:py-7">
      <div className="hidden px-3 pb-6 lg:block">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cafe-muted">
          Management
        </p>
        <p className="mt-2 text-sm font-medium capitalize text-cafe-espresso">
          {role} workspace
        </p>
      </div>
      <nav aria-label="Management navigation" className="flex gap-2 overflow-x-auto lg:flex-col">
        {managementLinks.map((link) => {
          const isActive = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive ? "page" : undefined}
              className={`flex shrink-0 items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition lg:w-full ${
                isActive
                  ? "bg-[#e9eddf] text-cafe-sage-dark"
                  : "text-[#6e6256] hover:bg-[#f3eee5] hover:text-cafe-espresso"
              }`}
            >
              <span aria-hidden="true" className="w-5 text-center text-base">
                {link.icon}
              </span>
              {link.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-7 hidden border-t border-cafe-border pt-5 lg:block">
        <Link
          href="/"
          className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-[#6e6256] transition hover:bg-[#f3eee5] hover:text-cafe-espresso"
        >
          <span aria-hidden="true" className="w-5 text-center text-base">
            ←
          </span>
          Back to register
        </Link>
      </div>
    </aside>
  );
}
