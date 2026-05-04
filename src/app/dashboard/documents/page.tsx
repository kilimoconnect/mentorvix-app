"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard, FilePlus2, FolderOpen, BarChart3, Landmark,
  Settings, CreditCard, HelpCircle, ArrowLeft, FileText, Lock,
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

export default function DocumentsPage() {
  const router = useRouter();

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* ── Sidebar ── */}
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
            const active = href === "/dashboard/documents";
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
          {NAV_BOTTOM.map(({ icon: Icon, label, href }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-900 transition-all"
            >
              <Icon size={18} />
              {label}
            </Link>
          ))}
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-6 py-4 flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-lg font-bold text-slate-900">Documents</h1>
            <p className="text-xs text-slate-500">Business plans, loan packs &amp; reports</p>
          </div>
        </div>

        {/* Coming soon state */}
        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-73px)] px-6 text-center">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5 shadow-lg"
            style={{ background: "linear-gradient(135deg,#0e7490,#0891b2)" }}
          >
            <FileText size={28} className="text-white" />
          </div>

          <h2 className="text-2xl font-bold text-slate-900 mb-2">Documents</h2>
          <p className="text-slate-500 max-w-sm mb-8 leading-relaxed">
            Auto-generated business plans, loan application packs, and financial reports will
            appear here once your first funding application is complete.
          </p>

          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              href="/dashboard/apply"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
              style={{ background: "linear-gradient(135deg,#0e7490,#0891b2)" }}
            >
              <FilePlus2 size={16} />
              Start a Funding Application
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
            >
              Back to Dashboard
            </Link>
          </div>

          {/* Coming soon badge */}
          <div className="mt-10 flex items-center gap-2 px-4 py-2 rounded-full bg-amber-50 border border-amber-200">
            <Lock size={13} className="text-amber-500" />
            <span className="text-xs font-medium text-amber-700">Coming soon — document generation is in development</span>
          </div>
        </div>
      </main>
    </div>
  );
}
