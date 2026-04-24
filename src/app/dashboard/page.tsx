"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, useMotionValue, useSpring, useInView } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import {
  LayoutDashboard, FilePlus2, FolderOpen, BarChart3, Landmark,
  Settings, CreditCard, HelpCircle, Bell, ChevronRight,
  TrendingUp, TrendingDown, ArrowUpRight, FileText, Zap,
  Menu, X, LogOut, Sparkles, Lock, ArrowRight, Shield, Users,
  Target, CheckCircle2, Clock, Info, ChevronUp, ClipboardList,
} from "lucide-react";

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];
const SCORE = 68;

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
  { label: "Financial Strength",  score: 72, color: "#059669" },
  { label: "Documentation",       score: 54, color: "#f59e0b" },
  { label: "Repayment Capacity",  score: 70, color: "#0e7490" },
  { label: "Business Stability",  score: 76, color: "#0e7490" },
];

/* ─── pipeline ─── */
const PIPELINE = [
  { label: "Profile",      sub: "Complete",           status: "done"    },
  { label: "Interview",    sub: "Awaiting answers",   status: "pending" },
  { label: "Financials",   sub: "Not started",        status: "pending" },
  { label: "Lender Match", sub: "Locked",             status: "locked"  },
  { label: "Submitted",    sub: "Locked",             status: "locked"  },
];

/* ─── quick actions ─── */
const QUICK_ACTIONS = [
  { icon: FilePlus2,      label: "Apply Now",            desc: "AI-guided professional loan package",       color: "#0e7490", bg: "#f0f9ff", href: "/dashboard/apply",         badge: "Popular" },
  { icon: ClipboardList,  label: "Answer Questions",      desc: "Complete your financial interview in 3 min", color: "#7c3aed", bg: "#faf5ff", href: "/dashboard/interview",     badge: null      },
  { icon: BarChart3,      label: "Generate Forecast",     desc: "Lender-ready 3-year financial projections",  color: "#0f766e", bg: "#f0fdf9", href: "/dashboard/models",        badge: null      },
  { icon: Landmark,       label: "Compare Offers",        desc: "Rates, terms and your personal fit score",   color: "#b45309", bg: "#fffbeb", href: "/dashboard/loans",         badge: null      },
];

/* ─── snapshot metrics ─── */
const SNAPSHOT = [
  { label: "Avg Monthly Revenue",    value: "$5,400", trend: +8,  icon: TrendingUp   },
  { label: "Avg Monthly Expenses",   value: "$3,800", trend: -3,  icon: TrendingDown },
  { label: "Est. Free Cash Flow",    value: "$1,600", trend: +11, icon: TrendingUp   },
  { label: "Safe Monthly Repayment", value: "$620",   trend: 0,   icon: null         },
];

/* ─── ranked insights ─── */
const INSIGHTS = [
  { rank: "Highest Impact", icon: ClipboardList, color: "#f59e0b", bg: "#fffbeb", text: "Complete your financial interview to confirm your funding range and unlock lender matching",  action: "+12 pts" },
  { rank: "Medium Impact",  icon: TrendingUp,    color: "#0e7490", bg: "#f0f9ff", text: "Reducing monthly debt by $500 may unlock 30% higher eligibility",                              action: "+6 pts"  },
  { rank: "Opportunity",    icon: Landmark,      color: "#7c3aed", bg: "#faf5ff", text: "Equipment finance may fit your profile better than working capital",                             action: "Explore" },
];

/* ─── projects ─── */
const RECENT = [
  { name: "Working Capital Loan Pack", date: "Apr 22, 2026", progress: 72, status: "Awaiting Documents", sc: "#f59e0b", sb: "#fffbeb", missing: "Financial interview · Business ID" },
  { name: "Cash Flow Projection Q2",   date: "Apr 18, 2026", progress: 100, status: "Completed",         sc: "#059669", sb: "#f0fdf4", missing: "" },
];

/* ─── animated counter ─── */
function AnimatedNumber({ target, prefix = "", suffix = "" }: { target: number; prefix?: string; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const raw = useMotionValue(0);
  const smooth = useSpring(raw, { stiffness: 55, damping: 18 });
  const [val, setVal] = useState(0);
  useEffect(() => { if (inView) raw.set(target); }, [inView, target, raw]);
  useEffect(() => smooth.on("change", (v) => setVal(Math.round(v))), [smooth]);
  return <span ref={ref}>{prefix}{val}{suffix}</span>;
}

/* ─── bar ─── */
function ScoreBar({ score, color, delay }: { score: number; color: string; delay: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true });
  return (
    <div ref={ref} className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
      <motion.div className="h-full rounded-full" style={{ background: color }}
        initial={{ width: 0 }}
        animate={inView ? { width: `${score}%` } : {}}
        transition={{ duration: 0.9, delay, ease: EASE }} />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════ */
export default function DashboardPage() {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userName,     setUserName]    = useState("...");
  const [businessName, setBusinessName] = useState("...");
  const [userInitial,  setUserInitial]  = useState("?");
  const [simRevenue,   setSimRevenue]   = useState(0);   // What-if slider
  const [simCollateral, setSimCollateral] = useState(false);

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

  // What-if calculations
  const simLow  = Math.round(12000 * (1 + simRevenue / 100) + (simCollateral ? 9000 : 0));
  const simHigh = Math.round(25000 * (1 + simRevenue / 100) + (simCollateral ? 9000 : 0));

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
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all"
              style={{ background: active ? "#f0f9ff" : "transparent", color: active ? "#0e7490" : "#64748b" }}>
              <Icon style={{ width: 18, height: 18 }} className="flex-shrink-0" />
              <span>{label}</span>
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
              initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }}
              transition={{ type: "spring" as const, stiffness: 300, damping: 30 }}>
              <SidebarContent mobile />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Topbar */}
        <motion.header initial={{ y: -16, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.4, ease: EASE }}
          className="bg-white border-b border-slate-100 px-4 lg:px-6 py-3.5 flex items-center gap-4 flex-shrink-0">
          <motion.button whileTap={{ scale: 0.9 }}
            className="lg:hidden p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
            onClick={() => setSidebarOpen(true)}>
            <Menu className="w-5 h-5" />
          </motion.button>

          <div className="flex-1 hidden md:flex items-center gap-5">
            {[
              { icon: Shield, text: "Bank-grade encryption" },
              { icon: Lock,   text: "Private & confidential" },
              { icon: Users,  text: "1,200+ SMEs funded" },
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
              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold"
              style={{ background: "linear-gradient(135deg,#0e7490,#0891b2)" }}>
              {userInitial}
            </motion.div>
            <span className="hidden sm:block text-sm font-medium text-slate-700">{userName}</span>
          </div>
        </motion.header>

        {/* ── content ── */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto px-4 lg:px-6 py-6 space-y-5">

            {/* ══ ABOVE THE FOLD ══ */}

            {/* Emotional trigger */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: EASE }}
              className="flex items-center gap-2">
              <div className="w-1.5 h-5 rounded-full" style={{ background: "#0e7490" }} />
              <p className="text-sm font-semibold text-slate-700">
                {userName.split(" ")[0]}, you&apos;re <span style={{ color: "#0e7490" }}>2 steps away</span> from being lender-ready.
              </p>
            </motion.div>

            {/* Hero row: funding range + score */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

              {/* Funding range — 3 cols */}
              <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: EASE }}
                className="lg:col-span-3 rounded-2xl p-6 text-white relative overflow-hidden"
                style={{ background: "linear-gradient(135deg,#042f3d 0%,#0e7490 55%,#0891b2 100%)" }}>
                <motion.div animate={{ scale: [1,1.15,1], opacity: [0.1,0.2,0.1] }}
                  transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
                  className="absolute -top-12 -right-12 w-56 h-56 rounded-full"
                  style={{ background: "radial-gradient(circle,#38bdf8 0%,transparent 70%)" }} />

                <div className="relative z-10">
                  <p className="text-cyan-300 text-xs font-semibold uppercase tracking-widest">Welcome back</p>
                  <h2 className="text-xl font-bold text-white mt-0.5">{userName} · {businessName}</h2>

                  <div className="mt-5 mb-4">
                    <p className="text-cyan-200 text-xs font-medium mb-1">Estimated eligible funding range</p>
                    <p className="text-4xl font-bold tracking-tight">
                      $<AnimatedNumber target={12} />K – $<AnimatedNumber target={25} />K
                    </p>
                  </div>

                  {/* Trust context */}
                  <div className="grid grid-cols-2 gap-2 mb-5">
                    {[
                      "Revenue trend",
                      "Current obligations",
                      "Documentation level",
                      "Industry benchmarks",
                    ].map((b) => (
                      <div key={b} className="flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-cyan-300 flex-shrink-0" />
                        <span className="text-xs text-cyan-200">{b}</span>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
                      <Link href="/dashboard/apply"
                        className="inline-flex items-center gap-1.5 text-sm font-bold px-4 py-2.5 rounded-xl bg-white transition-all"
                        style={{ color: "#0e7490" }}>
                        <ArrowRight className="w-3.5 h-3.5" /> Continue Application
                      </Link>
                    </motion.div>
                    <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
                      <Link href="#score"
                        className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2.5 rounded-xl border border-white/20 bg-white/10 text-white">
                        <ChevronUp className="w-3.5 h-3.5" /> Improve Score
                      </Link>
                    </motion.div>
                  </div>
                </div>
              </motion.div>

              {/* Score — 2 cols */}
              <motion.div id="score" initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, delay: 0.1, ease: EASE }}
                className="lg:col-span-2 bg-white rounded-2xl p-5 border border-slate-100 shadow-sm flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Readiness Score</p>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background:"#fef3c7", color:"#92400e" }}>Good</span>
                </div>

                {/* Ring */}
                <div className="flex justify-center mb-3">
                  <div className="relative w-24 h-24">
                    <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
                      <circle cx="50" cy="50" r="42" fill="none" stroke="#f1f5f9" strokeWidth="9" />
                      <motion.circle cx="50" cy="50" r="42" fill="none"
                        stroke="url(#sg2)" strokeWidth="9" strokeLinecap="round"
                        strokeDasharray={`${2*Math.PI*42}`}
                        initial={{ strokeDashoffset: `${2*Math.PI*42}` }}
                        animate={{ strokeDashoffset: `${2*Math.PI*42*(1-SCORE/100)}` }}
                        transition={{ duration: 1.4, delay: 0.5, ease: EASE }} />
                      <defs>
                        <linearGradient id="sg2" x1="0%" y1="0%" x2="100%" y2="0%">
                          <stop offset="0%"   stopColor="#0e7490" />
                          <stop offset="100%" stopColor="#38bdf8" />
                        </linearGradient>
                      </defs>
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-2xl font-bold text-slate-900"><AnimatedNumber target={SCORE} /></span>
                      <span className="text-xs text-slate-400">/100</span>
                    </div>
                  </div>
                </div>

                {/* Benchmarks */}
                <div className="flex justify-between mb-3 text-center">
                  <div>
                    <p className="text-xs text-slate-400">Avg SME</p>
                    <p className="text-sm font-bold text-slate-500">52</p>
                  </div>
                  <div className="w-px bg-slate-100" />
                  <div>
                    <p className="text-xs text-slate-400">Your score</p>
                    <p className="text-sm font-bold" style={{ color: "#0e7490" }}>68</p>
                  </div>
                  <div className="w-px bg-slate-100" />
                  <div>
                    <p className="text-xs text-slate-400">Bank-ready</p>
                    <p className="text-sm font-bold text-slate-500">80+</p>
                  </div>
                </div>

                {/* Breakdown bars */}
                <div className="space-y-2 flex-1">
                  {SCORE_BREAKDOWN.map(({ label, score, color }, i) => (
                    <motion.div key={label}
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                      transition={{ delay: 0.7 + i*0.07 }}>
                      <div className="flex justify-between mb-1">
                        <span className="text-xs text-slate-500">{label}</span>
                        <span className="text-xs font-semibold text-slate-600">{score}</span>
                      </div>
                      <ScoreBar score={score} color={color} delay={0.8 + i*0.1} />
                    </motion.div>
                  ))}
                </div>

                {/* Confidence meter */}
                <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-2">
                  <Info className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                  <p className="text-xs text-slate-500">
                    <span className="font-semibold text-amber-500">Data confidence: Medium</span> — answer questions or add records to improve
                  </p>
                </div>
              </motion.div>
            </div>

            {/* Next best action */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.45, ease: EASE }}
              className="rounded-2xl border border-slate-200 bg-white shadow-sm flex items-center gap-4 px-5 py-4"
              style={{ borderLeftWidth: 4, borderLeftColor: "#0e7490" }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background:"#f0f9ff" }}>
                <Target style={{ color:"#0e7490", width:18, height:18 }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold uppercase tracking-widest mb-0.5" style={{ color:"#0e7490" }}>Next Best Action</p>
                <p className="text-sm font-medium text-slate-700">Answer 15 quick questions to confirm your funding range and generate your full readiness report — no documents needed.</p>
              </div>
              <motion.div whileHover={{ scale:1.03 }} whileTap={{ scale:0.97 }} className="flex-shrink-0">
                <Link href="/dashboard/interview"
                  className="inline-flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-xl text-white"
                  style={{ background:"#0e7490" }}>
                  Start Free <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </motion.div>
            </motion.div>

            {/* ══ BELOW THE FOLD ══ */}

            {/* Funding Journey — graphical */}
            <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.5, ease: EASE }}
              className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">Funding Journey</h3>
                  <p className="text-xs text-slate-400 mt-0.5">1 of 5 milestones complete</p>
                </div>
                {/* Overall progress bar */}
                <div className="hidden sm:flex items-center gap-2 w-36">
                  <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <motion.div className="h-full rounded-full" style={{ background:"#0e7490" }}
                      initial={{ width: 0 }} animate={{ width: "20%" }}
                      transition={{ duration: 1, delay: 0.5, ease: EASE }} />
                  </div>
                  <span className="text-xs font-semibold" style={{ color:"#0e7490" }}>20%</span>
                </div>
              </div>

              <div className="grid grid-cols-5 gap-2">
                {PIPELINE.map(({ label, sub, status }, i) => (
                  <div key={label} className="flex flex-col items-center text-center">
                    {/* Node + connector */}
                    <div className="flex items-center w-full mb-3">
                      {i > 0 && (
                        <motion.div className="flex-1 h-0.5"
                          style={{ background: status === "done" ? "#0e7490" : "#e2e8f0" }}
                          initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
                          transition={{ delay: 0.5 + i*0.1, duration: 0.4 }} />
                      )}
                      <motion.div
                        initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                        transition={{ delay: 0.4 + i*0.1, duration: 0.4, ease: EASE }}
                        className="w-10 h-10 rounded-full flex items-center justify-center border-2 flex-shrink-0 mx-auto relative"
                        style={
                          status === "done"
                            ? { background:"#0e7490", borderColor:"#0e7490" }
                            : status === "pending"
                            ? { background:"white", borderColor:"#cbd5e1" }
                            : { background:"#f8fafc", borderColor:"#e2e8f0" }
                        }>
                        {status === "done" ? (
                          <CheckCircle2 className="w-5 h-5 text-white" />
                        ) : status === "pending" ? (
                          <Clock className="w-4 h-4 text-slate-300" />
                        ) : (
                          <Lock className="w-4 h-4 text-slate-200" />
                        )}
                        {status === "pending" && (
                          <motion.div className="absolute inset-0 rounded-full border-2 border-cyan-400"
                            animate={{ opacity:[0.4,1,0.4] }} transition={{ duration:2, repeat:Infinity }} />
                        )}
                      </motion.div>
                      {i < PIPELINE.length-1 && (
                        <motion.div className="flex-1 h-0.5"
                          style={{ background: "#e2e8f0" }}
                          initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
                          transition={{ delay: 0.5 + i*0.1, duration: 0.4 }} />
                      )}
                    </div>
                    <p className="text-xs font-semibold leading-tight"
                      style={{ color: status==="done" ? "#0e7490" : status==="pending" ? "#475569" : "#94a3b8" }}>
                      {label}
                    </p>
                    <p className="text-xs mt-0.5 leading-tight" style={{ color: "#94a3b8" }}>{sub}</p>
                  </div>
                ))}
              </div>
            </motion.section>

            {/* Quick Actions */}
            <section>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Quick Actions</p>
              <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                {QUICK_ACTIONS.map(({ icon:Icon, label, desc, color, bg, href, badge }, i) => (
                  <motion.div key={href}
                    initial={{ opacity:0, y:16 }} animate={{ opacity:1, y:0 }}
                    transition={{ delay: 0.35 + i*0.07, duration:0.45, ease:EASE }}
                    whileHover={{ y:-3, boxShadow:"0 8px 28px rgba(0,0,0,0.07)" }}>
                    <Link href={href} className="block bg-white rounded-2xl p-5 border border-slate-100 h-full group">
                      <div className="flex items-start justify-between mb-3">
                        <motion.div whileHover={{ scale:1.1, rotate:4 }} transition={{ type:"spring" as const, stiffness:400 }}
                          className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background:bg }}>
                          <Icon className="w-5 h-5" style={{ color }} />
                        </motion.div>
                        {badge && (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background:"#f0f9ff", color:"#0e7490" }}>{badge}</span>
                        )}
                      </div>
                      <p className="text-sm font-bold text-slate-800 mb-1">{label}</p>
                      <p className="text-xs text-slate-400 leading-relaxed mb-3">{desc}</p>
                      <div className="flex items-center gap-1 text-xs font-bold" style={{ color }}>
                        {label}
                        <motion.span animate={{ x:[0,3,0] }} transition={{ duration:1.6, repeat:Infinity, ease:"easeInOut" }}>
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </motion.span>
                      </div>
                    </Link>
                  </motion.div>
                ))}
              </div>
            </section>

            {/* Snapshot + AI Advisor */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

              {/* Financial snapshot */}
              <motion.section initial={{ opacity:0, y:16 }} animate={{ opacity:1, y:0 }}
                transition={{ delay:0.4, duration:0.5, ease:EASE }}
                className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                <div className="flex items-center gap-2 mb-4">
                  <BarChart3 className="w-4 h-4" style={{ color:"#0e7490" }} />
                  <h3 className="text-sm font-semibold text-slate-800">Business Snapshot</h3>
                  <span className="ml-auto text-xs text-slate-400 flex items-center gap-1">
                    <Info className="w-3 h-3" /> Estimated
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {SNAPSHOT.map(({ label, value, trend, icon: Icon }) => (
                    <motion.div key={label} whileHover={{ scale:1.02 }}
                      className="rounded-xl p-3 border border-slate-100">
                      <p className="text-xs text-slate-400 mb-2 leading-tight">{label}</p>
                      <p className="text-xl font-bold text-slate-900">{value}</p>
                      {trend !== 0 && Icon && (
                        <div className="flex items-center gap-1 mt-1">
                          <Icon className="w-3.5 h-3.5" style={{ color: trend > 0 ? "#059669" : "#f59e0b" }} />
                          <span className="text-xs font-semibold" style={{ color: trend > 0 ? "#059669" : "#f59e0b" }}>
                            {trend > 0 ? "+" : ""}{trend}% this month
                          </span>
                        </div>
                      )}
                    </motion.div>
                  ))}
                </div>
                <p className="text-xs text-slate-400 mt-3 text-center">Complete your interview or add records later to verify these figures</p>
              </motion.section>

              {/* AI Funding Advisor — ranked */}
              <motion.section initial={{ opacity:0, y:16 }} animate={{ opacity:1, y:0 }}
                transition={{ delay:0.45, duration:0.5, ease:EASE }}
                className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Sparkles className="w-4 h-4" style={{ color:"#0e7490" }} />
                  <h3 className="text-sm font-semibold text-slate-800">AI Funding Advisor</h3>
                </div>
                <div className="space-y-3">
                  {INSIGHTS.map(({ rank, icon:Icon, color, bg, text, action }, i) => (
                    <motion.div key={i}
                      initial={{ opacity:0, x:-10 }} animate={{ opacity:1, x:0 }}
                      transition={{ delay: 0.5 + i*0.08 }}
                      whileHover={{ x:2 }}
                      className="flex items-start gap-3 p-3 rounded-xl cursor-pointer group" style={{ background:bg }}>
                      <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold mb-0.5" style={{ color }}>{rank}</p>
                        <p className="text-sm text-slate-700 leading-relaxed">{text}</p>
                      </div>
                      <span className="text-xs font-bold flex-shrink-0 px-2 py-0.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ color, background: "rgba(255,255,255,0.8)" }}>
                        {action}
                      </span>
                    </motion.div>
                  ))}
                </div>
              </motion.section>
            </div>

            {/* Recent projects */}
            <motion.section initial={{ opacity:0, y:16 }} animate={{ opacity:1, y:0 }}
              transition={{ delay:0.5, duration:0.5, ease:EASE }}
              className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-slate-800">Recent Projects</h3>
                <Link href="/dashboard/documents" className="text-xs font-semibold hover:underline" style={{ color:"#0e7490" }}>View all</Link>
              </div>
              <div className="space-y-3">
                {RECENT.map(({ name, date, progress, status, sc, sb, missing }, i) => (
                  <motion.div key={name}
                    initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }}
                    transition={{ delay: 0.55 + i*0.08 }}
                    whileHover={{ x:2 }}
                    className="flex items-center gap-4 p-4 rounded-xl border border-slate-100 hover:border-slate-200 cursor-pointer group transition-all">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background:"#f0f9ff" }}>
                      <FileText className="w-4 h-4" style={{ color:"#0e7490" }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-sm font-semibold text-slate-800 truncate">{name}</p>
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ml-2" style={{ color:sc, background:sb }}>{status}</span>
                      </div>
                      <div className="flex items-center gap-2 mb-1">
                        <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <motion.div className="h-full rounded-full"
                            style={{ background: progress===100 ? "#059669" : "#0e7490" }}
                            initial={{ width:0 }} animate={{ width:`${progress}%` }}
                            transition={{ duration:0.9, delay:0.65+i*0.1, ease:EASE }} />
                        </div>
                        <span className="text-xs font-semibold text-slate-500">{progress}%</span>
                      </div>
                      {missing && <p className="text-xs text-amber-600">Needs: {missing}</p>}
                      <p className="text-xs text-slate-400">{date}</p>
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

            {/* What If simulator */}
            <motion.section initial={{ opacity:0, y:16 }} animate={{ opacity:1, y:0 }}
              transition={{ delay:0.55, duration:0.5, ease:EASE }}
              className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-4">
                <Zap className="w-4 h-4 text-yellow-400" />
                <h3 className="text-sm font-semibold text-slate-800">What If I Improve?</h3>
                <span className="ml-auto text-xs text-slate-400">Interactive simulator</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between mb-2">
                      <label className="text-xs font-semibold text-slate-600">Revenue increases by</label>
                      <span className="text-xs font-bold" style={{ color:"#0e7490" }}>+{simRevenue}%</span>
                    </div>
                    <input type="range" min={0} max={50} step={5} value={simRevenue}
                      onChange={(e) => setSimRevenue(+e.target.value)}
                      className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                      style={{ accentColor:"#0e7490" }} />
                    <div className="flex justify-between text-xs text-slate-300 mt-1"><span>0%</span><span>50%</span></div>
                  </div>
                  <div>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <div onClick={() => setSimCollateral(!simCollateral)}
                        className="w-10 h-5 rounded-full transition-colors relative flex-shrink-0"
                        style={{ background: simCollateral ? "#0e7490" : "#e2e8f0" }}>
                        <motion.div className="w-4 h-4 bg-white rounded-full absolute top-0.5"
                          animate={{ left: simCollateral ? "22px" : "2px" }}
                          transition={{ type:"spring" as const, stiffness:400, damping:30 }} />
                      </div>
                      <span className="text-xs font-semibold text-slate-600">Add collateral (+$9,000)</span>
                    </label>
                  </div>
                </div>

                {/* Result */}
                <div className="rounded-xl p-4 flex flex-col justify-center" style={{ background:"#f0f9ff" }}>
                  <p className="text-xs font-semibold text-slate-400 mb-1">Updated eligible range</p>
                  <motion.p key={`${simLow}-${simHigh}`}
                    initial={{ scale:0.95, opacity:0 }} animate={{ scale:1, opacity:1 }}
                    transition={{ duration:0.3 }}
                    className="text-2xl font-bold" style={{ color:"#0e7490" }}>
                    ${simLow.toLocaleString()} – ${simHigh.toLocaleString()}
                  </motion.p>
                  {(simRevenue > 0 || simCollateral) && (
                    <motion.p initial={{ opacity:0 }} animate={{ opacity:1 }}
                      className="text-xs font-semibold mt-1" style={{ color:"#059669" }}>
                      +${(simLow - 12000).toLocaleString()} increase from baseline
                    </motion.p>
                  )}
                  <p className="text-xs text-slate-400 mt-2">Adjust the sliders to see how improvements affect your eligible range</p>
                </div>
              </div>
            </motion.section>

            {/* Upgrade Pro */}
            <motion.div initial={{ opacity:0, y:16 }} animate={{ opacity:1, y:0 }}
              transition={{ delay:0.6, duration:0.5, ease:EASE }}
              className="rounded-2xl p-6 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 relative overflow-hidden"
              style={{ background:"linear-gradient(135deg,#1e1b4b 0%,#3730a3 50%,#4f46e5 100%)" }}>
              <motion.div animate={{ scale:[1,1.3,1], opacity:[0.08,0.18,0.08] }}
                transition={{ duration:7, repeat:Infinity, ease:"easeInOut" }}
                className="absolute -right-16 -top-16 w-64 h-64 rounded-full"
                style={{ background:"radial-gradient(circle,#818cf8 0%,transparent 70%)" }} />
              <div className="relative z-10">
                <div className="flex items-center gap-2 mb-1">
                  <Zap className="w-4 h-4 text-yellow-300" />
                  <p className="font-bold text-lg text-white">Unlock Funding Pro</p>
                </div>
                <p className="text-indigo-200 text-sm mb-3">Everything you need to get funded faster</p>
                <div className="grid grid-cols-2 gap-x-8 gap-y-1">
                  {[
                    "Editable Excel financial model",
                    "Priority lender matching",
                    "AI application optimisation",
                    "Faster support",
                  ].map((f) => (
                    <div key={f} className="flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-indigo-300 flex-shrink-0" />
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
