"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, useMotionValue, useSpring, useInView } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import {
  LayoutDashboard, FilePlus2, FolderOpen, BarChart3, Landmark,
  Settings, CreditCard, HelpCircle, Bell, ChevronRight, TrendingUp,
  AlertCircle, CheckCircle2, ArrowUpRight, FileText, Upload, Zap,
  Menu, X, LogOut, Sparkles, Lock, ArrowRight, Shield, Users,
  Target, Clock, ChevronUp,
} from "lucide-react";

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];

/* ─── nav ─── */
const NAV_ITEMS = [
  { icon: LayoutDashboard, label: "Dashboard",            href: "/dashboard",           active: true  },
  { icon: FilePlus2,       label: "Funding Applications", href: "/dashboard/apply",     active: false },
  { icon: FolderOpen,      label: "Documents",            href: "/dashboard/documents", active: false },
  { icon: BarChart3,       label: "Financial Models",     href: "/dashboard/models",    active: false },
  { icon: Landmark,        label: "Loan Matches",         href: "/dashboard/loans",     active: false },
];
const NAV_BOTTOM = [
  { icon: CreditCard, label: "Billing",  href: "/dashboard/billing"  },
  { icon: HelpCircle, label: "Support",  href: "/dashboard/support"  },
  { icon: Settings,   label: "Settings", href: "/dashboard/settings" },
];

/* ─── score breakdown ─── */
const SCORE_BREAKDOWN = [
  { label: "Financial Strength",   score: 72, color: "#0e7490" },
  { label: "Documentation",        score: 54, color: "#f59e0b" },
  { label: "Repayment Capacity",   score: 70, color: "#0e7490" },
  { label: "Business Stability",   score: 76, color: "#059669" },
];

/* ─── pipeline steps ─── */
const PIPELINE = [
  { label: "Profile Complete",      status: "done"    },
  { label: "Documents Uploaded",    status: "pending" },
  { label: "Financials Generated",  status: "pending" },
  { label: "Lender Match Ready",    status: "locked"  },
  { label: "Application Submitted", status: "locked"  },
];

/* ─── quick actions ─── */
const QUICK_ACTIONS = [
  { icon: FilePlus2, label: "Start Loan Application",    desc: "Apply with AI-guided professional package",              color: "#0e7490", bg: "#f0f9ff", href: "/dashboard/apply",     badge: "Most popular" },
  { icon: BarChart3, label: "Build Financial Forecast",   desc: "Generate lender-ready 3-year projections",               color: "#7c3aed", bg: "#faf5ff", href: "/dashboard/models",    badge: null           },
  { icon: Upload,    label: "Upload Documents",           desc: "Securely upload files to strengthen approval chances",    color: "#0f766e", bg: "#f0fdf9", href: "/dashboard/documents", badge: null           },
  { icon: Landmark,  label: "Compare Loan Options",       desc: "View lenders, rates, terms and your fit score",           color: "#b45309", bg: "#fffbeb", href: "/dashboard/loans",     badge: null           },
];

/* ─── insights ─── */
const INSIGHTS = [
  { icon: Upload,       color: "#f59e0b", bg: "#fffbeb", text: "Upload 6 months of bank statements to improve your confidence score", action: "+12 pts" },
  { icon: BarChart3,    color: "#0e7490", bg: "#f0f9ff", text: "Based on your revenue, equipment finance may fit better than working capital", action: "View options" },
  { icon: TrendingUp,   color: "#7c3aed", bg: "#faf5ff", text: "Reducing monthly debt by $500 could unlock 30% higher loan eligibility", action: "See how" },
  { icon: CheckCircle2, color: "#059669", bg: "#f0fdf4", text: "3 lenders are likely to consider your current profile for financing", action: "View matches" },
];

/* ─── recent projects ─── */
const RECENT = [
  { name: "Working Capital Loan Pack", date: "Apr 22, 2026", progress: 72, status: "In progress", sc: "#f59e0b", sb: "#fffbeb", missing: "Bank statement · ID copy" },
  { name: "Cash Flow Projection Q2",  date: "Apr 18, 2026", progress: 100, status: "Completed",   sc: "#059669", sb: "#f0fdf4", missing: "" },
];

/* ─── animated counter ─── */
function AnimatedNumber({ target, suffix = "" }: { target: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const raw = useMotionValue(0);
  const smooth = useSpring(raw, { stiffness: 55, damping: 18 });
  const [val, setVal] = useState(0);
  useEffect(() => { if (inView) raw.set(target); }, [inView, target, raw]);
  useEffect(() => smooth.on("change", (v) => setVal(Math.round(v))), [smooth]);
  return <span ref={ref}>{val}{suffix}</span>;
}

/* ─── score bar ─── */
function ScoreBar({ score, color, delay }: { score: number; color: string; delay: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true });
  return (
    <div ref={ref} className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
      <motion.div className="h-full rounded-full"
        style={{ background: color }}
        initial={{ width: 0 }}
        animate={inView ? { width: `${score}%` } : {}}
        transition={{ duration: 0.9, delay, ease: EASE }} />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════ */
export default function DashboardPage() {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userName,     setUserName]     = useState("...");
  const [businessName, setBusinessName] = useState("...");
  const [userInitial,  setUserInitial]  = useState("?");
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
            initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.04 * i, duration: 0.4, ease: EASE }}>
            <Link href={href} onClick={() => setSidebarOpen(false)}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all relative"
              style={{ background: active ? "#f0f9ff" : "transparent", color: active ? "#0e7490" : "#64748b" }}>
              <Icon style={{ width: 18, height: 18 }} className="relative z-10 flex-shrink-0" />
              <span className="relative z-10">{label}</span>
              {active && <div className="ml-auto w-1.5 h-1.5 rounded-full" style={{ background: "#0e7490" }} />}
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

  /* ══ render ══ */
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
              initial={{ x: "-100%", opacity: 0 }}
              animate={{ x: 0, opacity: 1, transition: { type: "spring" as const, stiffness: 300, damping: 30 } }}
              exit={{ x: "-100%", opacity: 0 }}>
              <SidebarContent mobile />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Topbar */}
        <motion.header initial={{ y: -16, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.45, ease: EASE }}
          className="bg-white border-b border-slate-100 px-4 lg:px-6 py-3.5 flex items-center gap-4 flex-shrink-0 z-10">
          <motion.button whileTap={{ scale: 0.9 }}
            className="lg:hidden p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
            onClick={() => setSidebarOpen(true)}>
            <Menu className="w-5 h-5" />
          </motion.button>

          {/* Trust bar inline */}
          <div className="flex-1 hidden md:flex items-center gap-5">
            {[
              { icon: Shield,       text: "Bank-grade encryption" },
              { icon: Lock,         text: "Private & confidential" },
              { icon: Users,        text: "1,200+ SMEs funded" },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-1.5 text-xs text-slate-400">
                <Icon className="w-3.5 h-3.5" style={{ color: "#0e7490" }} />
                {text}
              </div>
            ))}
          </div>

          <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
            className="relative p-2 rounded-xl text-slate-500 hover:bg-slate-100 transition-colors">
            <Bell className="w-5 h-5" />
            <motion.span animate={{ scale: [1, 1.4, 1] }}
              transition={{ repeat: Infinity, duration: 2, repeatDelay: 4 }}
              className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-cyan-600" />
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

        {/* ── scrollable content ── */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto px-4 lg:px-6 py-6 space-y-5">

            {/* ① HERO — welcome + score */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

              {/* Welcome card — 2 cols */}
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.55, ease: EASE }}
                className="lg:col-span-2 rounded-2xl p-7 text-white relative overflow-hidden"
                style={{ background: "linear-gradient(135deg, #042f3d 0%, #0e7490 55%, #0891b2 100%)" }}>
                <motion.div animate={{ scale: [1,1.2,1], opacity:[0.12,0.22,0.12] }}
                  transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
                  className="absolute -top-16 -right-16 w-64 h-64 rounded-full"
                  style={{ background: "radial-gradient(circle,#38bdf8 0%,transparent 70%)" }} />
                <motion.div animate={{ scale:[1,1.3,1], opacity:[0.08,0.16,0.08] }}
                  transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 3 }}
                  className="absolute -bottom-10 left-10 w-48 h-48 rounded-full"
                  style={{ background: "radial-gradient(circle,#0891b2 0%,transparent 70%)" }} />

                <div className="relative z-10">
                  <motion.p initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ delay:0.3 }}
                    className="text-cyan-200 text-sm font-medium">Welcome back,</motion.p>
                  <motion.h2 initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} transition={{ delay:0.4, duration:0.5 }}
                    className="text-3xl font-bold mt-0.5">{userName}</motion.h2>
                  <motion.p initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ delay:0.5 }}
                    className="text-cyan-100 text-sm mt-1">{businessName}</motion.p>

                  <motion.div initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} transition={{ delay:0.6 }}
                    className="mt-4 p-3 rounded-xl bg-white/10 backdrop-blur-sm border border-white/10 inline-block">
                    <p className="text-xs text-cyan-200 font-medium">Estimated eligible funding range</p>
                    <p className="text-2xl font-bold text-white mt-0.5">$12,000 – $25,000</p>
                    <p className="text-xs text-cyan-300 mt-0.5">Based on your current readiness score</p>
                  </motion.div>

                  <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ delay:0.75 }}
                    className="mt-5 flex flex-wrap gap-2">
                    {[
                      { label: "Continue Application", icon: ArrowRight, primary: true },
                      { label: "Improve Score",         icon: ChevronUp,  primary: false },
                      { label: "View Matches",          icon: Landmark,   primary: false },
                    ].map(({ label, icon: Icon, primary }) => (
                      <motion.div key={label} whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
                        <Link href="/dashboard/apply"
                          className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl transition-all"
                          style={primary
                            ? { background: "white", color: "#0e7490" }
                            : { background: "rgba(255,255,255,0.12)", color: "white", border: "1px solid rgba(255,255,255,0.2)" }
                          }>
                          <Icon className="w-3.5 h-3.5" /> {label}
                        </Link>
                      </motion.div>
                    ))}
                  </motion.div>
                </div>
              </motion.div>

              {/* Score card — 1 col, full breakdown */}
              <motion.div initial={{ opacity:0, x:20 }} animate={{ opacity:1, x:0 }}
                transition={{ duration:0.55, delay:0.1, ease:EASE }}
                className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm flex flex-col">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Funding Readiness</p>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background:"#fef3c7", color:"#92400e" }}>
                    Good
                  </span>
                </div>

                {/* Ring */}
                <div className="flex items-center justify-center mb-4">
                  <div className="relative w-24 h-24">
                    <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
                      <circle cx="50" cy="50" r="42" fill="none" stroke="#f1f5f9" strokeWidth="9" />
                      <motion.circle cx="50" cy="50" r="42" fill="none"
                        stroke="url(#sg)" strokeWidth="9" strokeLinecap="round"
                        strokeDasharray={`${2*Math.PI*42}`}
                        initial={{ strokeDashoffset:`${2*Math.PI*42}` }}
                        animate={{ strokeDashoffset:`${2*Math.PI*42*(1-SCORE/100)}` }}
                        transition={{ duration:1.4, delay:0.5, ease:EASE }} />
                      <defs>
                        <linearGradient id="sg" x1="0%" y1="0%" x2="100%" y2="0%">
                          <stop offset="0%"   stopColor="#0e7490" />
                          <stop offset="100%" stopColor="#38bdf8" />
                        </linearGradient>
                      </defs>
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-2xl font-bold text-slate-900">
                        <AnimatedNumber target={SCORE} />
                      </span>
                      <span className="text-xs text-slate-400">/100</span>
                    </div>
                  </div>
                </div>

                {/* Breakdown */}
                <div className="space-y-2.5 flex-1">
                  {SCORE_BREAKDOWN.map(({ label, score, color }, i) => (
                    <motion.div key={label}
                      initial={{ opacity:0, x:8 }} animate={{ opacity:1, x:0 }}
                      transition={{ delay: 0.6 + i*0.08, duration:0.4 }}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-slate-500">{label}</span>
                        <span className="text-xs font-semibold text-slate-700">{score}</span>
                      </div>
                      <ScoreBar score={score} color={color} delay={0.7 + i*0.1} />
                    </motion.div>
                  ))}
                </div>

                {/* Top actions */}
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <p className="text-xs font-semibold text-slate-400 mb-2">Top actions to improve</p>
                  <div className="space-y-1.5">
                    {[
                      { text: "Upload bank statements", pts: "+12" },
                      { text: "Add collateral details",  pts: "+8"  },
                      { text: "Reduce monthly debt",     pts: "+6"  },
                    ].map(({ text, pts }) => (
                      <div key={text} className="flex items-center justify-between">
                        <p className="text-xs text-slate-600">{text}</p>
                        <span className="text-xs font-bold px-1.5 py-0.5 rounded-md" style={{ background:"#f0fdf4", color:"#059669" }}>{pts}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            </div>

            {/* ② NEXT BEST ACTION */}
            <motion.div initial={{ opacity:0, y:16 }} animate={{ opacity:1, y:0 }}
              transition={{ delay:0.2, duration:0.5, ease:EASE }}
              className="rounded-2xl border-l-4 bg-white border border-slate-100 shadow-sm flex items-center gap-4 px-5 py-4"
              style={{ borderLeftColor: "#0e7490" }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background:"#f0f9ff" }}>
                <Target className="w-4.5 h-4.5" style={{ color:"#0e7490", width:18, height:18 }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold uppercase tracking-widest mb-0.5" style={{ color:"#0e7490" }}>Next Best Action</p>
                <p className="text-sm text-slate-700 font-medium">Upload 6 months of bank statements to raise your readiness score and unlock lender matches.</p>
              </div>
              <motion.div whileHover={{ scale:1.03 }} whileTap={{ scale:0.97 }} className="flex-shrink-0">
                <Link href="/dashboard/documents"
                  className="inline-flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-xl text-white"
                  style={{ background:"#0e7490" }}>
                  Upload Now <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </motion.div>
            </motion.div>

            {/* ③ FUNDING PIPELINE */}
            <motion.section initial={{ opacity:0, y:16 }} animate={{ opacity:1, y:0 }}
              transition={{ delay:0.25, duration:0.5, ease:EASE }}
              className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">Funding Journey</h3>
                  <p className="text-xs text-slate-400 mt-0.5">Your progress toward a submitted application</p>
                </div>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background:"#f0f9ff", color:"#0e7490" }}>
                  1 of 5 complete
                </span>
              </div>
              <div className="flex items-center gap-0">
                {PIPELINE.map(({ label, status }, i) => (
                  <div key={label} className="flex items-center flex-1 min-w-0">
                    <div className="flex flex-col items-center flex-shrink-0">
                      <motion.div
                        initial={{ scale:0.5, opacity:0 }} animate={{ scale:1, opacity:1 }}
                        transition={{ delay:0.4 + i*0.1, duration:0.4, ease:EASE }}
                        className="w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all"
                        style={
                          status === "done"    ? { background:"#0e7490", borderColor:"#0e7490" } :
                          status === "pending" ? { background:"white",   borderColor:"#e2e8f0" } :
                                                 { background:"#f8fafc", borderColor:"#e2e8f0" }
                        }>
                        {status === "done" ? (
                          <CheckCircle2 className="w-4 h-4 text-white" />
                        ) : status === "locked" ? (
                          <Lock className="w-3.5 h-3.5 text-slate-300" />
                        ) : (
                          <Clock className="w-3.5 h-3.5 text-slate-300" />
                        )}
                      </motion.div>
                      <p className="text-xs text-center mt-1.5 leading-tight px-1 hidden sm:block"
                        style={{ color: status==="done" ? "#0e7490" : status==="pending" ? "#64748b" : "#94a3b8",
                                 fontWeight: status==="done" ? 600 : 400 }}>
                        {label}
                      </p>
                    </div>
                    {i < PIPELINE.length - 1 && (
                      <motion.div className="flex-1 h-0.5 mx-1 mb-5"
                        style={{ background: status==="done" ? "#0e7490" : "#e2e8f0" }}
                        initial={{ scaleX:0 }} animate={{ scaleX:1 }}
                        transition={{ delay:0.5 + i*0.1, duration:0.4 }} />
                    )}
                  </div>
                ))}
              </div>
            </motion.section>

            {/* ④ QUICK ACTIONS */}
            <section>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Quick Actions</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                {QUICK_ACTIONS.map(({ icon:Icon, label, desc, color, bg, href, badge }, i) => (
                  <motion.div key={href}
                    initial={{ opacity:0, y:18 }} animate={{ opacity:1, y:0 }}
                    transition={{ delay:0.3 + i*0.07, duration:0.45, ease:EASE }}
                    whileHover={{ y:-3, boxShadow:"0 8px 28px rgba(0,0,0,0.08)" }}>
                    <Link href={href} className="block bg-white rounded-2xl p-5 border border-slate-100 h-full group">
                      <div className="flex items-start justify-between mb-3">
                        <motion.div whileHover={{ scale:1.1, rotate:5 }} transition={{ type:"spring" as const, stiffness:400 }}
                          className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background:bg }}>
                          <Icon className="w-5 h-5" style={{ color }} />
                        </motion.div>
                        {badge && (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background:"#f0f9ff", color:"#0e7490" }}>{badge}</span>
                        )}
                      </div>
                      <p className="text-sm font-semibold text-slate-800 mb-1">{label}</p>
                      <p className="text-xs text-slate-400 leading-relaxed mb-3">{desc}</p>
                      <div className="flex items-center gap-1 text-xs font-semibold" style={{ color }}>
                        Get started
                        <motion.span animate={{ x:[0,3,0] }} transition={{ duration:1.6, repeat:Infinity, ease:"easeInOut" }}>
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </motion.span>
                      </div>
                    </Link>
                  </motion.div>
                ))}
              </div>
            </section>

            {/* ⑤ FINANCIAL SNAPSHOT + AI INSIGHTS */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

              {/* Financial Snapshot */}
              <motion.section initial={{ opacity:0, y:16 }} animate={{ opacity:1, y:0 }}
                transition={{ delay:0.35, duration:0.5, ease:EASE }}
                className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                <div className="flex items-center gap-2 mb-4">
                  <BarChart3 className="w-4 h-4" style={{ color:"#0e7490" }} />
                  <h3 className="text-sm font-semibold text-slate-800">Business Snapshot</h3>
                  <span className="ml-auto text-xs text-slate-400">Estimated</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label:"Avg Monthly Revenue",       value:"$5,400",  sub:"Last 3 months",         color:"#059669", bg:"#f0fdf4" },
                    { label:"Avg Monthly Expenses",      value:"$3,800",  sub:"Operational costs",     color:"#f59e0b", bg:"#fffbeb" },
                    { label:"Est. Free Cash Flow",       value:"$1,600",  sub:"Per month",             color:"#0e7490", bg:"#f0f9ff" },
                    { label:"Safe Monthly Loan Payment", value:"$620",    sub:"Without cash strain",   color:"#7c3aed", bg:"#faf5ff" },
                  ].map(({ label, value, sub, color, bg }) => (
                    <motion.div key={label}
                      whileHover={{ scale:1.02 }}
                      className="rounded-xl p-3" style={{ background:bg }}>
                      <p className="text-xs text-slate-500 mb-1 leading-tight">{label}</p>
                      <p className="text-lg font-bold" style={{ color }}>{value}</p>
                      <p className="text-xs mt-0.5" style={{ color, opacity:0.7 }}>{sub}</p>
                    </motion.div>
                  ))}
                </div>
                <p className="text-xs text-slate-400 mt-3 text-center">
                  Add bank statements to generate accurate figures
                </p>
              </motion.section>

              {/* AI Insights */}
              <motion.section initial={{ opacity:0, y:16 }} animate={{ opacity:1, y:0 }}
                transition={{ delay:0.4, duration:0.5, ease:EASE }}
                className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Sparkles className="w-4 h-4" style={{ color:"#0e7490" }} />
                  <h3 className="text-sm font-semibold text-slate-800">AI Funding Advisor</h3>
                  <span className="ml-auto text-xs text-slate-400">Personalised</span>
                </div>
                <div className="space-y-2.5">
                  {INSIGHTS.map(({ icon:Icon, color, bg, text, action }, i) => (
                    <motion.div key={i}
                      initial={{ opacity:0, x:-10 }} animate={{ opacity:1, x:0 }}
                      transition={{ delay:0.45 + i*0.08 }}
                      whileHover={{ x:3 }}
                      className="flex items-start gap-3 p-3 rounded-xl cursor-pointer group" style={{ background:bg }}>
                      <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color }} />
                      <p className="text-sm text-slate-700 leading-relaxed flex-1">{text}</p>
                      <span className="text-xs font-semibold flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color }}>
                        {action}
                      </span>
                    </motion.div>
                  ))}
                </div>
              </motion.section>
            </div>

            {/* ⑥ RECENT PROJECTS with progress bars */}
            <motion.section initial={{ opacity:0, y:16 }} animate={{ opacity:1, y:0 }}
              transition={{ delay:0.45, duration:0.5, ease:EASE }}
              className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-slate-800">Recent Projects</h3>
                <Link href="/dashboard/documents" className="text-xs font-semibold hover:underline" style={{ color:"#0e7490" }}>
                  View all
                </Link>
              </div>
              <div className="space-y-3">
                {RECENT.map(({ name, date, progress, status, sc, sb, missing }, i) => (
                  <motion.div key={name}
                    initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }}
                    transition={{ delay:0.5 + i*0.08 }}
                    whileHover={{ x:3 }}
                    className="flex items-center gap-4 p-4 rounded-xl border border-slate-100 hover:border-slate-200 cursor-pointer group transition-all">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background:"#f0f9ff" }}>
                      <FileText className="w-4 h-4" style={{ color:"#0e7490" }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-semibold text-slate-800 truncate">{name}</p>
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ml-2" style={{ color:sc, background:sb }}>{status}</span>
                      </div>
                      {/* Progress bar */}
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <motion.div className="h-full rounded-full"
                            style={{ background: progress===100 ? "#059669" : "#0e7490" }}
                            initial={{ width:0 }}
                            animate={{ width:`${progress}%` }}
                            transition={{ duration:0.9, delay:0.6+i*0.1, ease:EASE }} />
                        </div>
                        <span className="text-xs font-semibold text-slate-500 flex-shrink-0">{progress}%</span>
                      </div>
                      {missing && (
                        <p className="text-xs text-amber-600 mt-1">Needs: {missing}</p>
                      )}
                      <p className="text-xs text-slate-400 mt-0.5">{date}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 flex-shrink-0 transition-colors" />
                  </motion.div>
                ))}
                <motion.div whileHover={{ borderColor:"#0e7490" }}>
                  <Link href="/dashboard/apply"
                    className="flex items-center justify-center gap-2 w-full py-3 rounded-xl border border-dashed border-slate-200 text-sm font-medium text-slate-400 hover:text-cyan-600 transition-colors">
                    <FilePlus2 className="w-4 h-4" /> Start a new project
                  </Link>
                </motion.div>
              </div>
            </motion.section>

            {/* ⑦ UPGRADE PRO */}
            <motion.div initial={{ opacity:0, y:16 }} animate={{ opacity:1, y:0 }}
              transition={{ delay:0.5, duration:0.5, ease:EASE }}
              className="rounded-2xl p-6 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 relative overflow-hidden"
              style={{ background:"linear-gradient(135deg,#1e1b4b 0%,#3730a3 50%,#4f46e5 100%)" }}>
              <motion.div animate={{ scale:[1,1.3,1], opacity:[0.1,0.2,0.1] }}
                transition={{ duration:6, repeat:Infinity, ease:"easeInOut" }}
                className="absolute -right-16 -top-16 w-64 h-64 rounded-full"
                style={{ background:"radial-gradient(circle,#818cf8 0%,transparent 70%)" }} />

              <div className="relative z-10">
                <div className="flex items-center gap-2 mb-1">
                  <Zap className="w-4 h-4 text-yellow-300" />
                  <p className="font-bold text-lg text-white">Unlock Funding Pro</p>
                </div>
                <p className="text-indigo-200 text-sm mb-3">Everything you need to get funded faster</p>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                  {[
                    "Editable Excel financial model",
                    "Priority lender matching",
                    "AI application optimisation",
                    "Human expert review",
                  ].map((f) => (
                    <div key={f} className="flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-indigo-300" />
                      <span className="text-xs text-indigo-200">{f}</span>
                    </div>
                  ))}
                </div>
              </div>

              <motion.div whileHover={{ scale:1.05 }} whileTap={{ scale:0.97 }} className="relative z-10 flex-shrink-0">
                <Link href="/dashboard/billing"
                  className="flex items-center gap-2 bg-white text-indigo-900 text-sm font-bold px-6 py-3 rounded-xl hover:bg-indigo-50 transition-colors shadow-xl">
                  Upgrade Now <ArrowUpRight className="w-4 h-4" />
                </Link>
              </motion.div>
            </motion.div>

          </div>
        </main>
      </div>
    </div>
  );
}
