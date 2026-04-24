"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, useMotionValue, useSpring, useInView } from "framer-motion";

const EASE = EASE as [number, number, number, number];
import { createClient } from "@/lib/supabase/client";
import {
  LayoutDashboard, FilePlus2, FolderOpen, BarChart3, Landmark,
  Settings, CreditCard, HelpCircle, Bell, ChevronRight, TrendingUp,
  AlertCircle, CheckCircle2, ArrowUpRight, FileText, Upload, Zap,
  Menu, X, LogOut, Sparkles,
} from "lucide-react";

/* ─── data ─────────────────────────────────────────────── */
const NAV_ITEMS = [
  { icon: LayoutDashboard, label: "Dashboard",        href: "/dashboard",           active: true  },
  { icon: FilePlus2,       label: "New Application",  href: "/dashboard/apply",     active: false },
  { icon: FolderOpen,      label: "My Documents",     href: "/dashboard/documents", active: false },
  { icon: BarChart3,       label: "Financial Models", href: "/dashboard/models",    active: false },
  { icon: Landmark,        label: "Loan Matches",     href: "/dashboard/loans",     active: false },
];
const NAV_BOTTOM = [
  { icon: Settings,   label: "Settings", href: "/dashboard/settings" },
  { icon: CreditCard, label: "Billing",  href: "/dashboard/billing"  },
  { icon: HelpCircle, label: "Support",  href: "/dashboard/support"  },
];
const QUICK_ACTIONS = [
  { icon: FilePlus2, label: "Start Loan Application",  desc: "Answer a few questions and get your package", color: "#0e7490", bg: "#f0f9ff", href: "/dashboard/apply",     badge: "Most popular" },
  { icon: BarChart3, label: "Build Financial Forecast", desc: "Generate projections lenders trust",          color: "#7c3aed", bg: "#faf5ff", href: "/dashboard/models",    badge: null           },
  { icon: Upload,    label: "Upload Documents",          desc: "Bank statements, registration, ID",           color: "#0f766e", bg: "#f0fdf9", href: "/dashboard/documents", badge: null           },
  { icon: Landmark,  label: "Compare Loan Options",      desc: "Find the best rates and terms",               color: "#b45309", bg: "#fffbeb", href: "/dashboard/loans",     badge: null           },
];
const INSIGHTS = [
  { icon: AlertCircle,  color: "#f59e0b", bg: "#fffbeb", text: "Upload your bank statements to improve your score by +12 points" },
  { icon: TrendingUp,   color: "#0e7490", bg: "#f0f9ff", text: "Improving monthly cash flow could qualify you for larger loans"   },
  { icon: CheckCircle2, color: "#059669", bg: "#f0fdf4", text: "3 lenders match your profile — view recommended lenders"           },
];
const RECENT = [
  { name: "Loan Application — Working Capital", date: "Apr 22, 2026", status: "In progress", sc: "#f59e0b", sb: "#fffbeb" },
  { name: "Cash Flow Projection — Q2 2026",    date: "Apr 18, 2026", status: "Completed",   sc: "#059669", sb: "#f0fdf4" },
];

/* ─── animated counter ──────────────────────────────────── */
function AnimatedNumber({ target }: { target: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true });
  const raw = useMotionValue(0);
  const smooth = useSpring(raw, { stiffness: 60, damping: 18 });
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (isInView) raw.set(target);
  }, [isInView, target, raw]);

  useEffect(() => smooth.on("change", (v) => setDisplay(Math.round(v))), [smooth]);

  return <span ref={ref}>{display}</span>;
}

/* ─── variants ──────────────────────────────────────────── */
const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};
const item = {
  hidden: { opacity: 0, y: 22 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
};
const sidebarV = {
  closed: { x: "-100%", opacity: 0 },
  open:   { x: 0,       opacity: 1, transition: { type: "spring", stiffness: 300, damping: 30 } },
};

/* ─── component ─────────────────────────────────────────── */
export default function DashboardPage() {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userName,    setUserName]    = useState("...");
  const [businessName,setBusinessName]= useState("...");
  const [userInitial, setUserInitial] = useState("?");
  const SCORE = 68;

  useEffect(() => {
    createClient().auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      const m = user.user_metadata;
      const name = m?.full_name || user.email?.split("@")[0] || "User";
      setUserName(name);
      setBusinessName(m?.business_name || "Your Business");
      setUserInitial(name.charAt(0).toUpperCase());
    });
  }, []);

  const handleSignOut = async () => {
    await createClient().auth.signOut();
    router.push("/login");
  };

  /* ── sidebar ── */
  const SidebarContent = ({ mobile = false }: { mobile?: boolean }) => (
    <aside className="flex flex-col h-full bg-white border-r border-slate-100">
      <div className="px-5 py-5 border-b border-slate-100 flex items-center justify-between">
        <Image src="/logo.png" alt="Mentorvix" width={130} height={44} style={{ height: "auto" }} />
        {mobile && (
          <motion.button whileTap={{ scale: 0.9 }} onClick={() => setSidebarOpen(false)}>
            <X className="w-5 h-5 text-slate-400" />
          </motion.button>
        )}
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map(({ icon: Icon, label, href, active }, i) => (
          <motion.div key={href}
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.05 * i, duration: 0.4, ease: EASE }}>
            <Link href={href} onClick={() => setSidebarOpen(false)}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all group relative"
              style={{ background: active ? "#f0f9ff" : "transparent", color: active ? "#0e7490" : "#64748b" }}>
              {active && (
                <motion.div layoutId="nav-pill"
                  className="absolute inset-0 rounded-xl"
                  style={{ background: "#f0f9ff" }}
                  transition={{ type: "spring", stiffness: 400, damping: 35 }} />
              )}
              <Icon style={{ width: 18, height: 18 }} className="relative z-10 flex-shrink-0" />
              <span className="relative z-10">{label}</span>
              {active && <div className="ml-auto w-1.5 h-1.5 rounded-full relative z-10" style={{ background: "#0e7490" }} />}
            </Link>
          </motion.div>
        ))}
      </nav>

      <div className="px-3 py-4 border-t border-slate-100 space-y-0.5">
        {NAV_BOTTOM.map(({ icon: Icon, label, href }) => (
          <Link key={href} href={href} onClick={() => setSidebarOpen(false)}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors">
            <Icon style={{ width: 18, height: 18 }} className="flex-shrink-0" />
            {label}
          </Link>
        ))}
        <motion.button whileHover={{ x: 2 }} onClick={handleSignOut}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-red-400 hover:bg-red-50 hover:text-red-500 transition-colors">
          <LogOut style={{ width: 18, height: 18 }} className="flex-shrink-0" />
          Sign out
        </motion.button>
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">

      {/* Desktop sidebar */}
      <motion.div className="hidden lg:flex lg:flex-shrink-0 w-64"
        initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: EASE }}>
        <SidebarContent />
      </motion.div>

      {/* Mobile sidebar */}
      <AnimatePresence>
        {sidebarOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.div className="absolute inset-0 bg-black/40"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setSidebarOpen(false)} />
            <motion.div className="absolute left-0 top-0 bottom-0 w-72"
              variants={sidebarV} initial="closed" animate="open" exit="closed">
              <SidebarContent mobile />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Topbar */}
        <motion.header
          initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.45, ease: EASE }}
          className="bg-white border-b border-slate-100 px-4 lg:px-6 py-3.5 flex items-center gap-4 flex-shrink-0 z-10">
          <motion.button whileTap={{ scale: 0.9 }}
            className="lg:hidden p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
            onClick={() => setSidebarOpen(true)}>
            <Menu className="w-5 h-5" />
          </motion.button>

          <div className="flex-1">
            <p className="text-base font-semibold text-slate-900 hidden sm:block">Dashboard</p>
          </div>

          <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
            className="relative p-2 rounded-xl text-slate-500 hover:bg-slate-100 transition-colors">
            <Bell className="w-5 h-5" />
            <motion.span animate={{ scale: [1, 1.3, 1] }} transition={{ repeat: Infinity, duration: 2, repeatDelay: 3 }}
              className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full" style={{ background: "#0e7490" }} />
          </motion.button>

          <div className="flex items-center gap-2.5">
            <motion.div whileHover={{ scale: 1.05 }}
              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold cursor-pointer"
              style={{ background: "linear-gradient(135deg,#0e7490,#0891b2)" }}>
              {userInitial}
            </motion.div>
            <span className="hidden sm:block text-sm font-medium text-slate-700">{userName}</span>
          </div>
        </motion.header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto">
          <motion.div
            className="max-w-6xl mx-auto px-4 lg:px-6 py-6 space-y-6"
            variants={container} initial="hidden" animate="show">

            {/* Welcome + Score row */}
            <div className="flex flex-col lg:flex-row gap-4">

              {/* Welcome hero */}
              <motion.div variants={item} className="flex-1 rounded-2xl p-6 text-white relative overflow-hidden"
                style={{ background: "linear-gradient(135deg, #042f3d 0%, #0e7490 60%, #0891b2 100%)" }}>
                {/* Animated orbs */}
                <motion.div animate={{ scale: [1,1.2,1], opacity: [0.15,0.25,0.15] }}
                  transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
                  className="absolute -top-12 -right-12 w-48 h-48 rounded-full"
                  style={{ background: "radial-gradient(circle, #38bdf8 0%, transparent 70%)" }} />
                <motion.div animate={{ scale: [1,1.3,1], opacity: [0.1,0.18,0.1] }}
                  transition={{ duration: 9, repeat: Infinity, ease: "easeInOut", delay: 2 }}
                  className="absolute -bottom-8 -left-8 w-36 h-36 rounded-full"
                  style={{ background: "radial-gradient(circle, #0891b2 0%, transparent 70%)" }} />

                <div className="relative">
                  <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}
                    className="text-cyan-200 text-sm font-medium">Welcome back,</motion.p>
                  <motion.h2 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.5 }}
                    className="text-2xl font-bold mt-0.5">{userName}</motion.h2>
                  <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
                    className="text-cyan-100 text-sm mt-1">{businessName}</motion.p>
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}
                    className="mt-5">
                    <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
                      <Link href="/dashboard/apply"
                        className="inline-flex items-center gap-2 bg-white/15 hover:bg-white/25 transition-all text-white text-sm font-semibold px-4 py-2.5 rounded-xl backdrop-blur-sm border border-white/10">
                        <Zap className="w-4 h-4" /> Start New Application
                      </Link>
                    </motion.div>
                  </motion.div>
                </div>
              </motion.div>

              {/* Score card */}
              <motion.div variants={item}
                className="lg:w-64 bg-white rounded-2xl p-6 border border-slate-100 flex flex-col items-center justify-center shadow-sm">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Funding Readiness</p>

                {/* Animated SVG ring */}
                <div className="relative w-32 h-32">
                  <svg className="w-32 h-32 -rotate-90" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="42" fill="none" stroke="#f1f5f9" strokeWidth="9" />
                    <motion.circle cx="50" cy="50" r="42" fill="none"
                      stroke="url(#scoreGrad)" strokeWidth="9" strokeLinecap="round"
                      strokeDasharray={`${2 * Math.PI * 42}`}
                      initial={{ strokeDashoffset: `${2 * Math.PI * 42}` }}
                      animate={{ strokeDashoffset: `${2 * Math.PI * 42 * (1 - SCORE / 100)}` }}
                      transition={{ duration: 1.4, delay: 0.5, ease: EASE }}
                    />
                    <defs>
                      <linearGradient id="scoreGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%"   stopColor="#0e7490" />
                        <stop offset="100%" stopColor="#38bdf8" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-3xl font-bold text-slate-900">
                      <AnimatedNumber target={SCORE} />
                    </span>
                    <span className="text-xs text-slate-400">/100</span>
                  </div>
                </div>

                <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2 }}
                  className="mt-4">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold"
                    style={{ background: "#fef3c7", color: "#92400e" }}>
                    <TrendingUp className="w-3 h-3" /> Good — Room to grow
                  </span>
                </motion.div>
              </motion.div>
            </div>

            {/* Quick actions */}
            <motion.section variants={item}>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Quick Actions</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                {QUICK_ACTIONS.map(({ icon: Icon, label, desc, color, bg, href, badge }, i) => (
                  <motion.div key={href}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 + i * 0.07, duration: 0.45, ease: EASE }}
                    whileHover={{ y: -3, boxShadow: "0 8px 30px rgba(0,0,0,0.08)" }}
                    className="bg-white rounded-2xl p-5 border border-slate-100 flex flex-col gap-3 cursor-pointer group">
                    <Link href={href} className="flex flex-col gap-3 h-full">
                      <div className="flex items-start justify-between">
                        <motion.div whileHover={{ scale: 1.1, rotate: 5 }} transition={{ type: "spring", stiffness: 400 }}
                          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                          style={{ background: bg }}>
                          <Icon className="w-5 h-5" style={{ color }} />
                        </motion.div>
                        {badge && (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                            style={{ background: "#f0f9ff", color: "#0e7490" }}>{badge}</span>
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-800">{label}</p>
                        <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{desc}</p>
                      </div>
                      <div className="flex items-center gap-1 text-xs font-semibold mt-auto" style={{ color }}>
                        Get started
                        <motion.span animate={{ x: [0, 3, 0] }} transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}>
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </motion.span>
                      </div>
                    </Link>
                  </motion.div>
                ))}
              </div>
            </motion.section>

            {/* Insights + Recent */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

              {/* AI Insights */}
              <motion.section variants={item} className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4" style={{ color: "#0e7490" }} />
                    <h3 className="text-sm font-semibold text-slate-800">AI Insights</h3>
                  </div>
                  <span className="text-xs text-slate-400">Personalised for you</span>
                </div>
                <div className="space-y-2.5">
                  {INSIGHTS.map(({ icon: Icon, color, bg, text }, i) => (
                    <motion.div key={i}
                      initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.4 + i * 0.1, duration: 0.4 }}
                      whileHover={{ x: 3 }}
                      className="flex gap-3 p-3 rounded-xl cursor-pointer transition-all"
                      style={{ background: bg }}>
                      <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color }} />
                      <p className="text-sm text-slate-700 leading-relaxed">{text}</p>
                    </motion.div>
                  ))}
                </div>
              </motion.section>

              {/* Recent projects */}
              <motion.section variants={item} className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-slate-800">Recent Projects</h3>
                  <Link href="/dashboard/documents" className="text-xs font-semibold hover:underline" style={{ color: "#0e7490" }}>
                    View all
                  </Link>
                </div>
                <div className="space-y-2.5">
                  {RECENT.map(({ name, date, status, sc, sb }, i) => (
                    <motion.div key={name}
                      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.35 + i * 0.1 }}
                      whileHover={{ x: 3, borderColor: "#cbd5e1" }}
                      className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 cursor-pointer group transition-all">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "#f0f9ff" }}>
                        <FileText className="w-4 h-4" style={{ color: "#0e7490" }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{name}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{date}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ color: sc, background: sb }}>{status}</span>
                        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
                      </div>
                    </motion.div>
                  ))}

                  <motion.div whileHover={{ borderColor: "#0e7490" }} transition={{ duration: 0.2 }}>
                    <Link href="/dashboard/apply"
                      className="flex items-center justify-center gap-2 w-full py-3 rounded-xl border border-dashed border-slate-200 text-sm font-medium text-slate-400 hover:text-cyan-600 transition-colors">
                      <FilePlus2 className="w-4 h-4" />
                      Start a new project
                    </Link>
                  </motion.div>
                </div>
              </motion.section>
            </div>

            {/* Upgrade banner */}
            <motion.div variants={item}
              className="rounded-2xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 relative overflow-hidden"
              style={{ background: "linear-gradient(135deg, #1e1b4b 0%, #3730a3 50%, #4f46e5 100%)" }}>
              <motion.div
                animate={{ scale: [1, 1.3, 1], opacity: [0.1, 0.2, 0.1] }}
                transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
                className="absolute -right-16 -top-16 w-64 h-64 rounded-full"
                style={{ background: "radial-gradient(circle, #818cf8 0%, transparent 70%)" }} />

              <div className="text-white relative z-10">
                <p className="font-bold text-lg">Unlock Your Full Funding Package</p>
                <p className="text-indigo-200 text-sm mt-1">Export PDF · Editable Excel · AI lender matching · Expert review</p>
              </div>
              <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }} className="relative z-10 flex-shrink-0">
                <Link href="/dashboard/billing"
                  className="flex items-center gap-2 bg-white text-indigo-900 text-sm font-bold px-5 py-3 rounded-xl hover:bg-indigo-50 transition-colors shadow-lg">
                  Upgrade to Pro <ArrowUpRight className="w-4 h-4" />
                </Link>
              </motion.div>
            </motion.div>

          </motion.div>
        </main>
      </div>
    </div>
  );
}
