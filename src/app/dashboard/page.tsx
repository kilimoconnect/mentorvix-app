"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  LayoutDashboard,
  FilePlus2,
  FolderOpen,
  BarChart3,
  Landmark,
  Settings,
  CreditCard,
  HelpCircle,
  Bell,
  ChevronRight,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  ArrowUpRight,
  FileText,
  Upload,
  Zap,
  Menu,
  X,
  LogOut,
} from "lucide-react";

const NAV_ITEMS = [
  { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard", active: true },
  { icon: FilePlus2, label: "New Application", href: "/dashboard/apply", active: false },
  { icon: FolderOpen, label: "My Documents", href: "/dashboard/documents", active: false },
  { icon: BarChart3, label: "Financial Models", href: "/dashboard/models", active: false },
  { icon: Landmark, label: "Loan Matches", href: "/dashboard/loans", active: false },
];

const NAV_BOTTOM = [
  { icon: Settings, label: "Settings", href: "/dashboard/settings" },
  { icon: CreditCard, label: "Billing", href: "/dashboard/billing" },
  { icon: HelpCircle, label: "Support", href: "/dashboard/support" },
];

const QUICK_ACTIONS = [
  {
    icon: FilePlus2,
    label: "Start Loan Application",
    description: "Answer a few questions and get your package",
    color: "#0e7490",
    bg: "#f0f9ff",
    href: "/dashboard/apply",
    badge: "Most popular",
  },
  {
    icon: BarChart3,
    label: "Build Financial Forecast",
    description: "Generate projections lenders trust",
    color: "#7c3aed",
    bg: "#faf5ff",
    href: "/dashboard/models",
    badge: null,
  },
  {
    icon: Upload,
    label: "Upload Documents",
    description: "Bank statements, registration, ID",
    color: "#0f766e",
    bg: "#f0fdf9",
    href: "/dashboard/documents",
    badge: null,
  },
  {
    icon: Landmark,
    label: "Compare Loan Options",
    description: "Find the best rates and terms",
    color: "#b45309",
    bg: "#fffbeb",
    href: "/dashboard/loans",
    badge: null,
  },
];

const INSIGHTS = [
  {
    type: "warning",
    icon: AlertCircle,
    color: "#f59e0b",
    bg: "#fffbeb",
    text: "Upload your bank statements to improve your score by +12 points",
  },
  {
    type: "info",
    icon: TrendingUp,
    color: "#0e7490",
    bg: "#f0f9ff",
    text: "Improving monthly cash flow could qualify you for larger loans",
  },
  {
    type: "success",
    icon: CheckCircle2,
    color: "#059669",
    bg: "#f0fdf4",
    text: "3 lenders match your profile — view recommended lenders",
  },
];

const RECENT = [
  { name: "Loan Application — Working Capital", date: "Apr 22, 2026", status: "In progress", statusColor: "#f59e0b", statusBg: "#fffbeb" },
  { name: "Cash Flow Projection — Q2 2026", date: "Apr 18, 2026", status: "Completed", statusColor: "#059669", statusBg: "#f0fdf4" },
];

export default function DashboardPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const score = 68;

  const Sidebar = ({ mobile = false }: { mobile?: boolean }) => (
    <aside
      className={`flex flex-col h-full bg-white border-r border-slate-100 ${mobile ? "w-full" : "w-64"}`}
    >
      {/* Logo */}
      <div className="px-5 py-5 border-b border-slate-100 flex items-center justify-between">
        <Image src="/logo.png" alt="Mentorvix" width={130} height={44} style={{ height: "auto" }} />
        {mobile && (
          <button onClick={() => setSidebarOpen(false)}>
            <X className="w-5 h-5 text-slate-400" />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map(({ icon: Icon, label, href, active }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors"
            style={{
              background: active ? "#f0f9ff" : "transparent",
              color: active ? "#0e7490" : "#64748b",
            }}
            onClick={() => setSidebarOpen(false)}
          >
            <Icon className="w-4.5 h-4.5 flex-shrink-0" style={{ width: 18, height: 18 }} />
            {label}
            {active && <div className="ml-auto w-1.5 h-1.5 rounded-full" style={{ background: "#0e7490" }} />}
          </Link>
        ))}
      </nav>

      {/* Bottom nav */}
      <div className="px-3 py-4 border-t border-slate-100 space-y-0.5">
        {NAV_BOTTOM.map(({ icon: Icon, label, href }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors"
            onClick={() => setSidebarOpen(false)}
          >
            <Icon style={{ width: 18, height: 18 }} className="flex-shrink-0" />
            {label}
          </Link>
        ))}
        <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-red-400 hover:bg-red-50 hover:text-red-500 transition-colors">
          <LogOut style={{ width: 18, height: 18 }} className="flex-shrink-0" />
          Sign out
        </button>
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Desktop sidebar */}
      <div className="hidden lg:flex lg:flex-shrink-0">
        <div className="w-64">
          <Sidebar />
        </div>
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSidebarOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-72 z-10">
            <Sidebar mobile />
          </div>
        </div>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Topbar */}
        <header className="bg-white border-b border-slate-100 px-4 lg:px-6 py-3.5 flex items-center gap-4 flex-shrink-0">
          <button
            className="lg:hidden p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="flex-1">
            <h1 className="text-base font-semibold text-slate-900 hidden sm:block">Dashboard</h1>
          </div>

          <button className="relative p-2 rounded-xl text-slate-500 hover:bg-slate-100 transition-colors">
            <Bell className="w-5 h-5" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full" style={{ background: "#0e7490" }} />
          </button>

          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold" style={{ background: "#0e7490" }}>
              J
            </div>
            <span className="hidden sm:block text-sm font-medium text-slate-700">John Banda</span>
          </div>
        </header>

        {/* Scrollable content */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto px-4 lg:px-6 py-6 space-y-6">

            {/* Welcome + score */}
            <div className="flex flex-col lg:flex-row gap-4">
              {/* Welcome card */}
              <div
                className="flex-1 rounded-2xl p-6 text-white relative overflow-hidden"
                style={{ background: "linear-gradient(135deg, #0c4a6e 0%, #0e7490 100%)" }}
              >
                <div className="absolute top-0 right-0 w-48 h-48 rounded-full opacity-10" style={{ background: "white", transform: "translate(30%, -30%)" }} />
                <div className="relative">
                  <p className="text-cyan-200 text-sm font-medium">Welcome back,</p>
                  <h2 className="text-2xl font-bold mt-0.5">John Banda</h2>
                  <p className="text-cyan-100 text-sm mt-1">Banda General Supplies · Zambia</p>
                  <div className="mt-4">
                    <Link
                      href="/dashboard/apply"
                      className="inline-flex items-center gap-2 bg-white/15 hover:bg-white/25 transition-colors text-white text-sm font-medium px-4 py-2 rounded-xl"
                    >
                      <Zap className="w-4 h-4" />
                      Start New Application
                    </Link>
                  </div>
                </div>
              </div>

              {/* Score card */}
              <div className="lg:w-64 bg-white rounded-2xl p-6 border border-slate-100 flex flex-col items-center justify-center">
                <p className="text-sm font-medium text-slate-500 mb-3">Funding Readiness Score</p>
                <div className="relative w-28 h-28">
                  <svg className="w-28 h-28 -rotate-90" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="42" fill="none" stroke="#f1f5f9" strokeWidth="10" />
                    <circle
                      cx="50" cy="50" r="42" fill="none"
                      stroke="#0e7490" strokeWidth="10"
                      strokeLinecap="round"
                      strokeDasharray={`${2 * Math.PI * 42}`}
                      strokeDashoffset={`${2 * Math.PI * 42 * (1 - score / 100)}`}
                      className="transition-all duration-1000"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-3xl font-bold text-slate-900">{score}</span>
                    <span className="text-xs text-slate-400">/100</span>
                  </div>
                </div>
                <div className="mt-3 text-center">
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold" style={{ background: "#fef3c7", color: "#92400e" }}>
                    <TrendingUp className="w-3 h-3" /> Good — Room to grow
                  </span>
                </div>
              </div>
            </div>

            {/* Quick actions */}
            <section>
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-widest mb-3">Quick Actions</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                {QUICK_ACTIONS.map(({ icon: Icon, label, description, color, bg, href, badge }) => (
                  <Link
                    key={href}
                    href={href}
                    className="group bg-white rounded-2xl p-5 border border-slate-100 hover:border-slate-200 hover:shadow-sm transition-all flex flex-col gap-3"
                  >
                    <div className="flex items-start justify-between">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: bg }}>
                        <Icon className="w-5 h-5" style={{ color }} />
                      </div>
                      {badge && (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: "#f0f9ff", color: "#0e7490" }}>
                          {badge}
                        </span>
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-800 group-hover:text-slate-900">{label}</p>
                      <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{description}</p>
                    </div>
                    <div className="flex items-center gap-1 text-xs font-medium" style={{ color }}>
                      Get started <ArrowUpRight className="w-3.5 h-3.5" />
                    </div>
                  </Link>
                ))}
              </div>
            </section>

            {/* 2-col: insights + recent */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Insights */}
              <section className="bg-white rounded-2xl border border-slate-100 p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-slate-800">AI Insights</h3>
                  <span className="text-xs text-slate-400">Personalised for you</span>
                </div>
                <div className="space-y-3">
                  {INSIGHTS.map(({ icon: Icon, color, bg, text }, i) => (
                    <div key={i} className="flex gap-3 p-3 rounded-xl" style={{ background: bg }}>
                      <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color }} />
                      <p className="text-sm text-slate-700 leading-relaxed">{text}</p>
                    </div>
                  ))}
                </div>
              </section>

              {/* Recent projects */}
              <section className="bg-white rounded-2xl border border-slate-100 p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-slate-800">Recent Projects</h3>
                  <Link href="/dashboard/documents" className="text-xs font-medium" style={{ color: "#0e7490" }}>
                    View all
                  </Link>
                </div>
                <div className="space-y-3">
                  {RECENT.map(({ name, date, status, statusColor, statusBg }) => (
                    <div key={name} className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 hover:border-slate-200 transition-colors cursor-pointer group">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "#f0f9ff" }}>
                        <FileText className="w-4 h-4" style={{ color: "#0e7490" }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{name}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{date}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ color: statusColor, background: statusBg }}>
                          {status}
                        </span>
                        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-400 transition-colors" />
                      </div>
                    </div>
                  ))}

                  <Link
                    href="/dashboard/apply"
                    className="flex items-center justify-center gap-2 w-full py-3 rounded-xl border border-dashed border-slate-200 text-sm font-medium text-slate-400 hover:border-cyan-300 hover:text-cyan-600 transition-colors"
                  >
                    <FilePlus2 className="w-4 h-4" />
                    Start a new project
                  </Link>
                </div>
              </section>
            </div>

            {/* Upgrade banner */}
            <div
              className="rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
              style={{ background: "linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)" }}
            >
              <div className="text-white">
                <p className="font-semibold">Unlock Your Full Funding Package</p>
                <p className="text-indigo-200 text-sm mt-0.5">Export PDF · Editable Excel · AI lender matching · Expert review</p>
              </div>
              <Link
                href="/dashboard/billing"
                className="flex-shrink-0 flex items-center gap-2 bg-white text-indigo-900 text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-indigo-50 transition-colors"
              >
                Upgrade to Pro <ArrowUpRight className="w-4 h-4" />
              </Link>
            </div>

          </div>
        </main>
      </div>
    </div>
  );
}
