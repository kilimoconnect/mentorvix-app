"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, FilePlus2, FolderOpen, BarChart3, Landmark,
  Settings, CreditCard, HelpCircle,
} from "lucide-react";

const NAV_ITEMS = [
  { icon: LayoutDashboard, label: "Dashboard",            href: "/dashboard"           },
  { icon: FilePlus2,       label: "Funding Applications", href: "/dashboard/apply"     },
  { icon: FolderOpen,      label: "Documents",            href: "/dashboard/documents" },
  { icon: BarChart3,       label: "Financial Models",     href: "/dashboard/models"    },
  { icon: Landmark,        label: "Loan Matches",         href: "/dashboard/loans"     },
];
const NAV_BOTTOM = [
  { icon: CreditCard, label: "Billing",  href: "/dashboard/billing"  },
  { icon: HelpCircle, label: "Support",  href: "/dashboard/support"  },
  { icon: Settings,   label: "Settings", href: "/dashboard/settings" },
];

export function DashboardSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex flex-col w-64 bg-white border-r border-slate-100 shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2 px-6 py-5 border-b border-slate-100">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm"
          style={{ background: "linear-gradient(135deg,#0e7490,#0891b2)" }}
        >
          M
        </div>
        <span className="font-bold text-slate-800 text-lg tracking-tight">Mentorvix</span>
      </div>

      {/* Main nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map(({ icon: Icon, label, href }) => {
          const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                active
                  ? "text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
              style={active ? { background: "linear-gradient(135deg,#0e7490,#0891b2)" } : {}}
            >
              <Icon size={18} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Bottom nav */}
      <div className="px-3 py-4 border-t border-slate-100 space-y-0.5">
        {NAV_BOTTOM.map(({ icon: Icon, label, href }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                active
                  ? "text-white shadow-sm"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
              }`}
              style={active ? { background: "linear-gradient(135deg,#0e7490,#0891b2)" } : {}}
            >
              <Icon size={18} />
              {label}
            </Link>
          );
        })}
      </div>
    </aside>
  );
}
