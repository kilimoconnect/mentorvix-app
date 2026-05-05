"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, FilePlus2, FolderOpen, BarChart3, Landmark,
  Settings, CreditCard, HelpCircle, SlidersHorizontal, Menu, X,
} from "lucide-react";

const NAV_ITEMS = [
  { icon: LayoutDashboard,    label: "Dashboard",            href: "/dashboard"           },
  { icon: FilePlus2,          label: "Funding Applications", href: "/dashboard/apply"     },
  { icon: SlidersHorizontal,  label: "Revenue Drivers",      href: "/dashboard/drivers"   },
  { icon: FolderOpen,         label: "Documents",            href: "/dashboard/documents" },
  { icon: BarChart3,          label: "Financial Models",     href: "/dashboard/models"    },
  { icon: Landmark,           label: "Loan Matches",         href: "/dashboard/loans"     },
];
const NAV_BOTTOM = [
  { icon: CreditCard, label: "Billing",  href: "/dashboard/billing"  },
  { icon: HelpCircle, label: "Support",  href: "/dashboard/support"  },
  { icon: Settings,   label: "Settings", href: "/dashboard/settings" },
];

/* Bottom tab bar shows the 4 most-used destinations + a "More" drawer trigger */
const BOTTOM_TABS = [
  { icon: LayoutDashboard,   label: "Home",    href: "/dashboard"         },
  { icon: FilePlus2,         label: "Apply",   href: "/dashboard/apply"   },
  { icon: SlidersHorizontal, label: "Drivers", href: "/dashboard/drivers" },
  { icon: Landmark,          label: "Loans",   href: "/dashboard/loans"   },
];

export function DashboardSidebar() {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      {/* ── Desktop sidebar (md+) ──────────────────────────────────── */}
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

      {/* ── Mobile: fixed bottom tab bar (< md) ─────────────────────── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-slate-200">
        <div className="flex items-stretch">
          {BOTTOM_TABS.map(({ icon: Icon, label, href }) => {
            const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 px-1 transition-colors ${
                  active ? "text-cyan-600" : "text-slate-400 hover:text-slate-600"
                }`}
              >
                <Icon size={22} strokeWidth={active ? 2.5 : 1.8} />
                <span className="text-[10px] font-semibold leading-tight">{label}</span>
                {active && (
                  <span className="absolute bottom-0 w-6 h-0.5 rounded-full bg-cyan-600" />
                )}
              </Link>
            );
          })}
          {/* More — opens full drawer */}
          <button
            onClick={() => setDrawerOpen(true)}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 px-1 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <Menu size={22} strokeWidth={1.8} />
            <span className="text-[10px] font-semibold leading-tight">More</span>
          </button>
        </div>
      </nav>

      {/* ── Mobile: slide-out drawer ─────────────────────────────────── */}
      {drawerOpen && (
        <div className="md:hidden fixed inset-0 z-[60]">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
          />
          {/* Drawer panel */}
          <div className="absolute left-0 top-0 bottom-0 w-72 bg-white flex flex-col shadow-2xl">
            {/* Drawer header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm"
                  style={{ background: "linear-gradient(135deg,#0e7490,#0891b2)" }}
                >
                  M
                </div>
                <span className="font-bold text-slate-800 text-lg">Mentorvix</span>
              </div>
              <button
                onClick={() => setDrawerOpen(false)}
                className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* All nav items */}
            <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
              {NAV_ITEMS.map(({ icon: Icon, label, href }) => {
                const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setDrawerOpen(false)}
                    className={`flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-all ${
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

            {/* Bottom items in drawer */}
            <div className="px-3 py-4 border-t border-slate-100 space-y-0.5 pb-8">
              {NAV_BOTTOM.map(({ icon: Icon, label, href }) => {
                const active = pathname === href;
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setDrawerOpen(false)}
                    className={`flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-all ${
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
          </div>
        </div>
      )}
    </>
  );
}
