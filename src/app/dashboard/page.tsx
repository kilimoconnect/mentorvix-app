"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, useMotionValue, useSpring, useInView } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import {
  LayoutDashboard, FilePlus2, FolderOpen, BarChart3, Landmark,
  Settings, CreditCard, HelpCircle, Bell, ChevronRight,
  TrendingUp, TrendingDown, ArrowUpRight, FileText, Zap,
  Menu, X, LogOut, BrainCircuit, Lock, ArrowRight, Shield, Users,
  Target, CheckCircle2, Clock, Info,
  ShoppingBag, Repeat, ScrollText, Briefcase, Trash2, AlertTriangle,
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

/* ─── types matching localStorage ─── */
interface StoredItem    { volume: number; price: number; category: string; name: string; unit: string; }
interface StoredStream  {
  id: string; name: string; type: string; items: StoredItem[];
  monthlyGrowthPct: number; rentalOccupancyPct?: number;
}
interface RevenueModel  { streams: StoredStream[]; projection: { total: number }[] }
interface Assessment    {
  revenueAvg: number; revenueBest: number; revenueWorst: number;
  expenses: number; score: number; fundingMin: number; fundingMax: number;
  completedAt: string; confidence: string;
}

/* ─── helpers ─── */
function fmtCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

function computeMRR(streams: StoredStream[]): number {
  return streams.reduce((total, s) => {
    const rev = (s.items ?? []).reduce((sum, it) => {
      if (s.type === "marketplace") return sum + it.volume * (it.price / 100);
      if (s.type === "rental")      return sum + it.volume * it.price * ((s.rentalOccupancyPct ?? 100) / 100);
      return sum + it.volume * it.price;
    }, 0);
    return total + rev;
  }, 0);
}

function computeYear1(projection: { total: number }[]): number {
  return projection.slice(0, 12).reduce((a, m) => a + m.total, 0);
}

const STREAM_TYPE_ICONS: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  product:      ShoppingBag,
  service:      Briefcase,
  subscription: Repeat,
  rental:       Landmark,
  marketplace:  TrendingUp,
  contract:     ScrollText,
  custom:       Zap,
};

/* ─── animated counter ─── */
function AnimatedNumber({ target, prefix = "", suffix = "" }: { target: number; prefix?: string; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const raw    = useMotionValue(0);
  const smooth = useSpring(raw, { stiffness: 55, damping: 18 });
  const [val, setVal] = useState(0);
  useEffect(() => { if (inView) raw.set(target); }, [inView, target, raw]);
  useEffect(() => smooth.on("change", (v) => setVal(Math.round(v))), [smooth]);
  return <span ref={ref}>{prefix}{val.toLocaleString()}{suffix}</span>;
}

/* ─── score bar ─── */
function ScoreBar({ score, color, delay }: { score: number; color: string; delay: number }) {
  const ref    = useRef<HTMLDivElement>(null);
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

/* ─── empty metric card ─── */
function EmptyMetric({ label, cta, href }: { label: string; cta: string; href: string }) {
  return (
    <div className="rounded-xl p-3 border border-dashed border-slate-200 flex flex-col gap-1.5">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="text-lg font-bold text-slate-300">—</p>
      <Link href={href} className="text-xs font-semibold text-cyan-600 hover:underline">{cta}</Link>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════ */
export default function DashboardPage() {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userName,     setUserName]    = useState("...");
  const [businessName, setBusinessName] = useState("...");
  const [userInitial,  setUserInitial]  = useState("?");

  /* ── real data from localStorage ── */
  const [revenueModel, setRevenueModel] = useState<RevenueModel | null>(null);
  const [assessment,   setAssessment]   = useState<Assessment | null>(null);

  /* ── delete confirmation ── */
  const [clearModelConfirm, setClearModelConfirm] = useState(false);

  /* ── what-if simulator ── */
  const [simRevenuePct,  setSimRevenuePct]  = useState(0);
  const [simCollateral, setSimCollateral] = useState(false);

  /* ── load user + data ── */
  useEffect(() => {
    // Auth
    createClient().auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      const m = user.user_metadata;
      const name = m?.full_name || user.email?.split("@")[0] || "User";
      setUserName(name);
      setBusinessName(m?.business_name || "Your Business");
      setUserInitial(name.charAt(0).toUpperCase());
    });
    // Revenue model
    try {
      const raw = localStorage.getItem("mvx_revenue_model");
      if (raw) setRevenueModel(JSON.parse(raw) as RevenueModel);
    } catch { /* ignore */ }
    // Assessment
    try {
      const raw = localStorage.getItem("mvx_assessment");
      if (raw) setAssessment(JSON.parse(raw) as Assessment);
    } catch { /* ignore */ }
  }, []);

  const handleSignOut = async () => {
    await createClient().auth.signOut();
    router.push("/login");
  };

  const deleteRevenueModel = async () => {
    // Delete from Supabase if we have an application ID saved
    try {
      const raw = localStorage.getItem("mvx_revenue_model");
      if (raw) {
        const parsed = JSON.parse(raw) as { applicationId?: string };
        if (parsed.applicationId) {
          await createClient()
            .from("applications")
            .delete()
            .eq("id", parsed.applicationId);
        }
      }
    } catch { /* non-blocking — always clear local data */ }
    localStorage.removeItem("mvx_revenue_model");
    setRevenueModel(null);
    setClearModelConfirm(false);
  };

  /* ── derived metrics ── */
  const hasRevenue    = !!revenueModel && revenueModel.streams.length > 0;
  const hasAssessment = !!assessment;

  const mrr          = hasRevenue ? computeMRR(revenueModel!.streams) : null;
  const year1Rev     = hasRevenue ? computeYear1(revenueModel!.projection ?? []) : null;
  const streamCount  = hasRevenue ? revenueModel!.streams.length : 0;
  const itemCount    = hasRevenue
    ? revenueModel!.streams.reduce((a, s) => a + (s.items ?? []).length, 0)
    : 0;

  // Prefer revenue model MRR; fall back to assessment monthly avg
  const displayRevenue = mrr ?? assessment?.revenueAvg ?? null;
  const displayExpenses = assessment?.expenses ?? null;
  const displayCashFlow = displayRevenue !== null && displayExpenses !== null
    ? displayRevenue - displayExpenses : null;

  const score      = assessment?.score      ?? null;
  const fundingMin = assessment?.fundingMin ?? null;
  const fundingMax = assessment?.fundingMax ?? null;

  // Score label + color
  const scoreLabel = score !== null
    ? score >= 70 ? "Strong" : score >= 55 ? "Good" : "Developing"
    : null;
  const scoreLabelBg = score !== null
    ? score >= 70 ? { bg: "#d1fae5", color: "#065f46" }
    : score >= 55 ? { bg: "#fef3c7", color: "#92400e" }
    : { bg: "#fee2e2", color: "#991b1b" }
    : { bg: "#f1f5f9", color: "#64748b" };

  // Derived score breakdown from assessment
  const scoreBreakdown = assessment ? [
    {
      label: "Financial Strength",
      score: Math.min(95, Math.round(score! * 0.95)),
      color: "#059669",
    },
    {
      label: "Repayment Capacity",
      score: Math.min(95, Math.round(
        Math.max(10, (1 - (assessment.expenses / Math.max(1, assessment.revenueAvg))) * 100)
      )),
      color: "#0e7490",
    },
    {
      label: "Business Stability",
      score: Math.min(95, Math.round(
        assessment.revenueWorst > 0
          ? (assessment.revenueWorst / assessment.revenueBest) * 100
          : 50
      )),
      color: "#0e7490",
    },
    { label: "Documentation",  score: 18, color: "#f59e0b" },
  ] : [
    { label: "Financial Strength",  score: 0,  color: "#cbd5e1" },
    { label: "Repayment Capacity",  score: 0,  color: "#cbd5e1" },
    { label: "Business Stability",  score: 0,  color: "#cbd5e1" },
    { label: "Documentation",       score: 0,  color: "#cbd5e1" },
  ];

  // Steps complete
  const milestonesComplete = 1 + (hasRevenue ? 1 : 0);
  const milestonePct = Math.round((milestonesComplete / 4) * 100);

  // Emotional trigger message
  const triggerMsg = !hasRevenue
    ? "1 step away from being lender-ready — build your revenue model."
    : "lender-ready! Review your matching loan offers.";

  // Pipeline
  const pipeline = [
    { label: "Profile",       sub: "Complete",                                                                            status: "done"    },
    { label: "Revenue Model", sub: hasRevenue ? `${streamCount} stream${streamCount !== 1 ? "s" : ""}` : "Not started",  status: hasRevenue ? "done" : "pending" },
    { label: "Lender Match",  sub: "Locked",                                                                              status: "locked"  },
    { label: "Submitted",     sub: "Locked",                                                                              status: "locked"  },
  ];

  // AI Advisor insights — dynamic based on available data
  const insights = useCallback(() => {
    const list = [];
    if (!hasRevenue) list.push({
      rank: "Highest Impact", icon: BarChart3, color: "#0e7490", bg: "#f0f9ff",
      text: "Build your revenue model — tell the AI how your business makes money to get stream-by-stream projections and unlock lender matching.",
      action: "Start", href: "/dashboard/apply",
    });
    if (hasRevenue) list.push({
      rank: "Opportunity", icon: CheckCircle2, color: "#059669", bg: "#f0fdf4",
      text: "Your profile is complete. Review your matched lenders to find the best rates and terms for your business.",
      action: "Explore", href: "/dashboard/loans",
    });
    list.push({
      rank: list.length < 2 ? "Medium Impact" : "Opportunity",
      icon: Landmark, color: "#7c3aed", bg: "#faf5ff",
      text: "Equipment finance often fits SMEs better than working capital — explore whether it applies to your business.",
      action: "Explore", href: "/dashboard/loans",
    });
    return list.slice(0, 3);
  }, [hasRevenue, hasAssessment, assessment])();

  // Recent projects — from actual data
  const recentProjects = (() => {
    const list: {
      name: string; date: string; progress: number; status: string;
      sc: string; sb: string; missing: string; href: string; sub: string;
      canDelete?: boolean;
    }[] = [];
    if (hasRevenue) list.push({
      name: `Revenue Model — ${streamCount} stream${streamCount !== 1 ? "s" : ""}`,
      date: "Saved",
      progress: 100,
      status: "Complete",
      sc: "#059669", sb: "#f0fdf4",
      missing: "",
      href: "/dashboard/apply",
      sub: itemCount > 0 ? `${itemCount} items · ${fmtCurrency(mrr!)}/mo MRR` : "No items yet",
      canDelete: true,
    });
    if (list.length === 0) list.push({
      name: "Working Capital Loan Pack",
      date: "Not started",
      progress: 0,
      status: "Draft",
      sc: "#94a3b8", sb: "#f1f5f9",
      missing: "Revenue model",
      href: "/dashboard/apply",
      sub: "Complete your profile to get started",
    });
    return list;
  })();

  // What-if simulator baseline
  const simBase = fundingMin && fundingMax
    ? { low: fundingMin, high: fundingMax }
    : { low: 12000, high: 25000 };
  const simLow  = Math.round(simBase.low  * (1 + simRevenuePct / 100) + (simCollateral ? simBase.low  * 0.4 : 0));
  const simHigh = Math.round(simBase.high * (1 + simRevenuePct / 100) + (simCollateral ? simBase.high * 0.4 : 0));

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

            {/* ══ Emotional trigger ══ */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: EASE }}
              className="flex items-center gap-2">
              <div className="w-1.5 h-5 rounded-full" style={{ background: "#0e7490" }} />
              <p className="text-sm font-semibold text-slate-700">
                {userName.split(" ")[0]}, you&apos;re{" "}
                <span style={{ color: "#0e7490" }}>{triggerMsg}</span>
              </p>
            </motion.div>

            {/* ══ Hero row: funding range + score ══ */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

              {/* Funding range card */}
              <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: EASE }}
                className="lg:col-span-3 rounded-2xl p-5 sm:p-6 text-white relative overflow-hidden"
                style={{ background: "linear-gradient(135deg,#042f3d 0%,#0e7490 55%,#0891b2 100%)" }}>
                <motion.div animate={{ scale: [1, 1.15, 1], opacity: [0.1, 0.2, 0.1] }}
                  transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
                  className="absolute -top-12 -right-12 w-56 h-56 rounded-full"
                  style={{ background: "radial-gradient(circle,#38bdf8 0%,transparent 70%)" }} />

                <div className="relative z-10">
                  <p className="text-cyan-300 text-xs font-semibold uppercase tracking-widest">Welcome back</p>
                  <h2 className="text-xl font-bold text-white mt-0.5">{userName} · {businessName}</h2>

                  <div className="mt-5 mb-4">
                    <p className="text-cyan-200 text-xs font-medium mb-1">Estimated eligible funding range</p>
                    {fundingMin !== null && fundingMax !== null ? (
                      <p className="text-3xl sm:text-4xl font-bold tracking-tight">
                        <AnimatedNumber target={fundingMin / 1000} prefix="$" suffix="K" />
                        {" – "}
                        <AnimatedNumber target={fundingMax / 1000} prefix="$" suffix="K" />
                      </p>
                    ) : (
                      <div className="flex items-center gap-3 mt-2">
                        <div className="flex items-center gap-2 bg-white/10 rounded-xl px-4 py-2.5">
                          <Lock className="w-4 h-4 text-cyan-300" />
                          <span className="text-sm font-semibold text-white">Build revenue model to unlock</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Trust context */}
                  <div className="grid grid-cols-2 gap-2 mb-5">
                    {["Revenue trend", "Current obligations", "Documentation level", "Industry benchmarks"].map((b) => (
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
                        <ArrowRight className="w-3.5 h-3.5" />
                        {hasRevenue ? "Review Revenue Model" : "Build Revenue Model"}
                      </Link>
                    </motion.div>
                  </div>
                </div>
              </motion.div>

              {/* Score card */}
              <motion.div id="score" initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, delay: 0.1, ease: EASE }}
                className="lg:col-span-2 bg-white rounded-2xl p-5 border border-slate-100 shadow-sm flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Readiness Score</p>
                  {scoreLabel ? (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                      style={{ background: scoreLabelBg.bg, color: scoreLabelBg.color }}>
                      {scoreLabel}
                    </span>
                  ) : (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-400">
                      Pending
                    </span>
                  )}
                </div>

                {/* Score ring */}
                <div className="flex justify-center mb-3">
                  <div className="relative w-24 h-24">
                    <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
                      <circle cx="50" cy="50" r="42" fill="none" stroke="#f1f5f9" strokeWidth="9" />
                      <motion.circle cx="50" cy="50" r="42" fill="none"
                        stroke={hasAssessment ? "url(#sg2)" : "#e2e8f0"} strokeWidth="9" strokeLinecap="round"
                        strokeDasharray={`${2 * Math.PI * 42}`}
                        initial={{ strokeDashoffset: `${2 * Math.PI * 42}` }}
                        animate={{ strokeDashoffset: `${2 * Math.PI * 42 * (1 - (score ?? 0) / 100)}` }}
                        transition={{ duration: 1.4, delay: 0.5, ease: EASE }} />
                      <defs>
                        <linearGradient id="sg2" x1="0%" y1="0%" x2="100%" y2="0%">
                          <stop offset="0%"   stopColor="#0e7490" />
                          <stop offset="100%" stopColor="#38bdf8" />
                        </linearGradient>
                      </defs>
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      {hasAssessment ? (
                        <>
                          <span className="text-2xl font-bold text-slate-900">
                            <AnimatedNumber target={score!} />
                          </span>
                          <span className="text-xs text-slate-400">/100</span>
                        </>
                      ) : (
                        <>
                          <Lock className="w-6 h-6 text-slate-300" />
                          <span className="text-xs text-slate-400 mt-1">—/100</span>
                        </>
                      )}
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
                    <p className="text-sm font-bold" style={{ color: hasAssessment ? "#0e7490" : "#cbd5e1" }}>
                      {score ?? "—"}
                    </p>
                  </div>
                  <div className="w-px bg-slate-100" />
                  <div>
                    <p className="text-xs text-slate-400">Bank-ready</p>
                    <p className="text-sm font-bold text-slate-500">80+</p>
                  </div>
                </div>

                {/* Breakdown bars */}
                <div className="space-y-2 flex-1">
                  {scoreBreakdown.map(({ label, score: s, color }, i) => (
                    <motion.div key={label}
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                      transition={{ delay: 0.7 + i * 0.07 }}>
                      <div className="flex justify-between mb-1">
                        <span className="text-xs text-slate-500">{label}</span>
                        <span className="text-xs font-semibold text-slate-600">
                          {hasAssessment ? s : "—"}
                        </span>
                      </div>
                      <ScoreBar score={hasAssessment ? s : 0} color={color} delay={0.8 + i * 0.1} />
                    </motion.div>
                  ))}
                </div>


                {/* Confidence note */}
                {hasAssessment && (
                  <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-2">
                    <Info className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                    <p className="text-xs text-slate-500">
                      <span className="font-semibold text-amber-500">Data confidence: Manual</span> — add records to verify figures
                    </p>
                  </div>
                )}
              </motion.div>
            </div>

            {/* ══ Next best action ══ */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.45, ease: EASE }}
              className="rounded-2xl border border-slate-200 bg-white shadow-sm flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 px-5 py-4"
              style={{ borderLeftWidth: 4, borderLeftColor: "#0e7490" }}>
              <div className="flex items-start sm:items-center gap-3 flex-1 min-w-0">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "#f0f9ff" }}>
                  <Target style={{ color: "#0e7490", width: 18, height: 18 }} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-widest mb-0.5" style={{ color: "#0e7490" }}>Next Best Action</p>
                  <p className="text-sm font-medium text-slate-700">
                    {!hasRevenue
                      ? "Tell the AI how your business makes money — it will build your full revenue model, item by item, stream by stream."
                      : "Your revenue model is complete — explore lenders matched to your exact profile."}
                  </p>
                </div>
              </div>
              <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} className="flex-shrink-0 self-start sm:self-auto">
                <Link
                  href={!hasRevenue ? "/dashboard/apply" : "/dashboard/loans"}
                  className="inline-flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-xl text-white"
                  style={{ background: "#0e7490" }}>
                  {!hasRevenue ? "Start Revenue Model" : "View Matches"}
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </motion.div>
            </motion.div>

            {/* ══ Funding Journey ══ */}
            <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.5, ease: EASE }}
              className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">Funding Journey</h3>
                  <p className="text-xs text-slate-400 mt-0.5">{milestonesComplete} of 5 milestones complete</p>
                </div>
                <div className="hidden sm:flex items-center gap-2 w-36">
                  <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <motion.div className="h-full rounded-full" style={{ background: "#0e7490" }}
                      initial={{ width: 0 }} animate={{ width: `${milestonePct}%` }}
                      transition={{ duration: 1, delay: 0.5, ease: EASE }} />
                  </div>
                  <span className="text-xs font-semibold" style={{ color: "#0e7490" }}>{milestonePct}%</span>
                </div>
              </div>

              <div className="overflow-x-auto -mx-2 px-2">
                <div className="grid grid-cols-5 gap-2 min-w-[400px]">
                  {pipeline.map(({ label, sub, status }, i) => (
                    <div key={label} className="flex flex-col items-center text-center">
                      <div className="flex items-center w-full mb-3">
                        {i > 0 && (
                          <motion.div className="flex-1 h-0.5"
                            style={{ background: status === "done" ? "#0e7490" : "#e2e8f0" }}
                            initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
                            transition={{ delay: 0.5 + i * 0.1, duration: 0.4 }} />
                        )}
                        <motion.div
                          initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                          transition={{ delay: 0.4 + i * 0.1, duration: 0.4, ease: EASE }}
                          className="w-10 h-10 rounded-full flex items-center justify-center border-2 flex-shrink-0 mx-auto relative"
                          style={
                            status === "done"
                              ? { background: "#0e7490", borderColor: "#0e7490" }
                              : status === "pending"
                              ? { background: "white", borderColor: "#cbd5e1" }
                              : { background: "#f8fafc", borderColor: "#e2e8f0" }
                          }>
                          {status === "done"    ? <CheckCircle2 className="w-5 h-5 text-white" />
                          : status === "pending" ? <Clock className="w-4 h-4 text-slate-300" />
                          :                       <Lock className="w-4 h-4 text-slate-200" />}
                          {status === "pending" && (
                            <motion.div className="absolute inset-0 rounded-full border-2 border-cyan-400"
                              animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 2, repeat: Infinity }} />
                          )}
                        </motion.div>
                        {i < pipeline.length - 1 && (
                          <motion.div className="flex-1 h-0.5" style={{ background: "#e2e8f0" }}
                            initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
                            transition={{ delay: 0.5 + i * 0.1, duration: 0.4 }} />
                        )}
                      </div>
                      <p className="text-xs font-semibold leading-tight"
                        style={{ color: status === "done" ? "#0e7490" : status === "pending" ? "#475569" : "#94a3b8" }}>
                        {label}
                      </p>
                      <p className="text-xs mt-0.5 leading-tight text-slate-400">{sub}</p>
                    </div>
                  ))}
                </div>
              </div>
            </motion.section>

            {/* ══ Quick Actions ══ */}
            <section>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Quick Actions</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                {[
                  { icon: FilePlus2, label: "Build Revenue Model", desc: "AI-guided item-by-item revenue analysis",    color: "#0e7490", bg: "#f0f9ff", href: "/dashboard/apply",   badge: hasRevenue ? null : "Start here" },
                  { icon: BarChart3, label: "Financial Models",   desc: "Lender-ready financial projections",         color: "#0f766e", bg: "#f0fdf9", href: "/dashboard/models",  badge: null },
                  { icon: Landmark,  label: "Compare Loan Offers",desc: "Rates, terms and your personal fit score",   color: "#b45309", bg: "#fffbeb", href: "/dashboard/loans",   badge: null },
                ].map(({ icon: Icon, label, desc, color, bg, href, badge }, i) => (
                  <motion.div key={href}
                    initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.35 + i * 0.07, duration: 0.45, ease: EASE }}
                    whileHover={{ y: -3, boxShadow: "0 8px 28px rgba(0,0,0,0.07)" }}>
                    <Link href={href} className="block bg-white rounded-2xl p-4 sm:p-5 border border-slate-100 h-full group">
                      <div className="flex items-start justify-between mb-3">
                        <motion.div whileHover={{ scale: 1.1, rotate: 4 }}
                          transition={{ type: "spring" as const, stiffness: 400 }}
                          className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: bg }}>
                          <Icon className="w-5 h-5" style={{ color }} />
                        </motion.div>
                        {badge && (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                            style={{ background: "#f0f9ff", color: "#0e7490" }}>{badge}</span>
                        )}
                      </div>
                      <p className="text-sm font-bold text-slate-800 mb-1">{label}</p>
                      <p className="text-xs text-slate-400 leading-relaxed mb-3">{desc}</p>
                      <div className="flex items-center gap-1 text-xs font-bold" style={{ color }}>
                        Go
                        <motion.span animate={{ x: [0, 3, 0] }} transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}>
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </motion.span>
                      </div>
                    </Link>
                  </motion.div>
                ))}
              </div>
            </section>

            {/* ══ Business Snapshot + AI Advisor ══ */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

              {/* Business Snapshot — real data */}
              <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4, duration: 0.5, ease: EASE }}
                className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                <div className="flex items-center gap-2 mb-4">
                  <BarChart3 className="w-4 h-4" style={{ color: "#0e7490" }} />
                  <h3 className="text-sm font-semibold text-slate-800">Business Snapshot</h3>
                  {(hasRevenue || hasAssessment) && (
                    <span className="ml-auto text-xs text-slate-400 flex items-center gap-1">
                      <Info className="w-3 h-3" />
                      {hasRevenue && hasAssessment ? "Revenue model + interview" : hasRevenue ? "From revenue model" : "From interview"}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {/* Monthly Revenue */}
                  {displayRevenue !== null ? (
                    <motion.div whileHover={{ scale: 1.02 }} className="rounded-xl p-3 border border-slate-100">
                      <p className="text-xs text-slate-400 mb-2 leading-tight">
                        {hasRevenue ? "Monthly Revenue (MRR)" : "Avg Monthly Revenue"}
                      </p>
                      <p className="text-lg sm:text-xl font-bold text-slate-900">{fmtCurrency(displayRevenue)}</p>
                      {hasRevenue && (
                        <div className="flex items-center gap-1 mt-1">
                          <TrendingUp className="w-3.5 h-3.5" style={{ color: "#059669" }} />
                          <span className="text-xs font-semibold" style={{ color: "#059669" }}>
                            {streamCount} stream{streamCount !== 1 ? "s" : ""} · {itemCount} items
                          </span>
                        </div>
                      )}
                    </motion.div>
                  ) : (
                    <EmptyMetric label="Monthly Revenue" cta="Add revenue model →" href="/dashboard/apply" />
                  )}

                  {/* Monthly Expenses */}
                  {displayExpenses !== null ? (
                    <motion.div whileHover={{ scale: 1.02 }} className="rounded-xl p-3 border border-slate-100">
                      <p className="text-xs text-slate-400 mb-2 leading-tight">Avg Monthly Expenses</p>
                      <p className="text-lg sm:text-xl font-bold text-slate-900">{fmtCurrency(displayExpenses)}</p>
                    </motion.div>
                  ) : (
                    <EmptyMetric label="Monthly Expenses" cta="Build revenue model →" href="/dashboard/apply" />
                  )}

                  {/* Free Cash Flow */}
                  {displayCashFlow !== null ? (
                    <motion.div whileHover={{ scale: 1.02 }} className="rounded-xl p-3 border border-slate-100">
                      <p className="text-xs text-slate-400 mb-2 leading-tight">Est. Free Cash Flow</p>
                      <p className="text-lg sm:text-xl font-bold text-slate-900">
                        {displayCashFlow >= 0 ? "" : "-"}{fmtCurrency(Math.abs(displayCashFlow))}
                      </p>
                      <div className="flex items-center gap-1 mt-1">
                        {displayCashFlow >= 0
                          ? <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                          : <TrendingDown className="w-3.5 h-3.5 text-red-400" />}
                        <span className="text-xs font-semibold" style={{ color: displayCashFlow >= 0 ? "#059669" : "#ef4444" }}>
                          {displayCashFlow >= 0 ? "Positive flow" : "Review expenses"}
                        </span>
                      </div>
                    </motion.div>
                  ) : (
                    <EmptyMetric label="Free Cash Flow" cta="Build revenue model →" href="/dashboard/apply" />
                  )}

                  {/* Year 1 Projection / Repayment Capacity */}
                  {year1Rev !== null ? (
                    <motion.div whileHover={{ scale: 1.02 }} className="rounded-xl p-3 border border-slate-100">
                      <p className="text-xs text-slate-400 mb-2 leading-tight">Year 1 Projection</p>
                      <p className="text-lg sm:text-xl font-bold text-slate-900">{fmtCurrency(year1Rev)}</p>
                      <div className="flex items-center gap-1 mt-1">
                        <TrendingUp className="w-3.5 h-3.5" style={{ color: "#0e7490" }} />
                        <span className="text-xs font-semibold" style={{ color: "#0e7490" }}>3yr forecast ready</span>
                      </div>
                    </motion.div>
                  ) : (
                    <EmptyMetric label="Year 1 Projection" cta="Build revenue model →" href="/dashboard/apply" />
                  )}
                </div>

                {/* Revenue streams breakdown */}
                {hasRevenue && revenueModel && (
                  <div className="mt-4 pt-4 border-t border-slate-50 space-y-2">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Revenue Streams</p>
                    {revenueModel.streams.map((s) => {
                      const streamMRR = (s.items ?? []).reduce((sum, it) => {
                        if (s.type === "marketplace") return sum + it.volume * (it.price / 100);
                        if (s.type === "rental")      return sum + it.volume * it.price * ((s.rentalOccupancyPct ?? 100) / 100);
                        return sum + it.volume * it.price;
                      }, 0);
                      const StreamIcon = STREAM_TYPE_ICONS[s.type] ?? Zap;
                      const pct = mrr && mrr > 0 ? Math.round((streamMRR / mrr) * 100) : 0;
                      return (
                        <div key={s.id} className="flex items-center gap-2">
                          <StreamIcon className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                          <span className="text-xs text-slate-600 flex-1 truncate">{s.name}</span>
                          <span className="text-xs font-semibold text-slate-700">{fmtCurrency(streamMRR)}/mo</span>
                          <span className="text-xs text-slate-400 w-8 text-right">{pct}%</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {!hasRevenue && (
                  <p className="text-xs text-slate-400 mt-3 text-center">
                    Build your revenue model to see real numbers here
                  </p>
                )}
              </motion.section>

              {/* AI Funding Advisor — dynamic */}
              <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.45, duration: 0.5, ease: EASE }}
                className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                <div className="flex items-center gap-2 mb-4">
                  <BrainCircuit className="w-4 h-4" style={{ color: "#0e7490" }} />
                  <h3 className="text-sm font-semibold text-slate-800">AI Funding Advisor</h3>
                </div>
                <div className="space-y-3">
                  {insights.map(({ rank, icon: Icon, color, bg, text, action, href }, i) => (
                    <motion.div key={i}
                      initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.5 + i * 0.08 }}
                      whileHover={{ x: 2 }}
                      className="flex items-start gap-3 p-3 rounded-xl cursor-pointer group" style={{ background: bg }}>
                      <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold mb-0.5" style={{ color }}>{rank}</p>
                        <p className="text-sm text-slate-700 leading-relaxed">{text}</p>
                      </div>
                      <Link href={href}
                        className="text-xs font-bold flex-shrink-0 px-2 py-0.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ color, background: "rgba(255,255,255,0.8)" }}>
                        {action}
                      </Link>
                    </motion.div>
                  ))}
                </div>
              </motion.section>
            </div>

            {/* ══ Recent Projects ══ */}
            <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.5, ease: EASE }}
              className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-slate-800">Recent Activity</h3>
                <Link href="/dashboard/documents" className="text-xs font-semibold hover:underline" style={{ color: "#0e7490" }}>View all</Link>
              </div>
              <div className="space-y-3">
                {recentProjects.map(({ name, date, progress, status, sc, sb, missing, href, sub, canDelete }, i) => (
                  <motion.div key={name}
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.55 + i * 0.08 }}
                    whileHover={{ x: 2 }}
                    className="flex items-center gap-3 p-3 sm:p-4 rounded-xl border border-slate-100 hover:border-slate-200 cursor-pointer group transition-all">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "#f0f9ff" }}>
                      <FileText className="w-4 h-4" style={{ color: "#0e7490" }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-start justify-between gap-1 mb-1.5">
                        <p className="text-sm font-semibold text-slate-800 truncate max-w-[60%]">{name}</p>
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                          style={{ color: sc, background: sb }}>{status}</span>
                      </div>
                      {sub && <p className="text-xs text-slate-500 mb-1">{sub}</p>}
                      <div className="flex items-center gap-2 mb-1">
                        <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <motion.div className="h-full rounded-full"
                            style={{ background: progress === 100 ? "#059669" : "#0e7490" }}
                            initial={{ width: 0 }} animate={{ width: `${progress}%` }}
                            transition={{ duration: 0.9, delay: 0.65 + i * 0.1, ease: EASE }} />
                        </div>
                        <span className="text-xs font-semibold text-slate-500">{progress}%</span>
                      </div>
                      {missing && <p className="text-xs text-amber-600">Needs: {missing}</p>}
                      <p className="text-xs text-slate-400">{date}</p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {canDelete && (
                        <motion.button
                          whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setClearModelConfirm(true); }}
                          className="p-1.5 rounded-lg text-slate-300 hover:text-red-400 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                          title="Delete revenue model">
                          <Trash2 className="w-3.5 h-3.5" />
                        </motion.button>
                      )}
                      <Link href={href} onClick={(e) => e.stopPropagation()}>
                        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
                      </Link>
                    </div>
                  </motion.div>
                ))}
                <motion.div whileHover={{ borderColor: "#0e7490" }}>
                  <Link href="/dashboard/apply"
                    className="flex items-center justify-center gap-2 w-full py-3 rounded-xl border border-dashed border-slate-200 text-sm font-medium text-slate-400 hover:text-cyan-600 transition-colors">
                    <FilePlus2 className="w-4 h-4" /> Start a new project
                  </Link>
                </motion.div>
              </div>
            </motion.section>

            {/* ══ What If Simulator ══ */}
            <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55, duration: 0.5, ease: EASE }}
              className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-4">
                <Zap className="w-4 h-4 text-yellow-400" />
                <h3 className="text-sm font-semibold text-slate-800">What If I Improve?</h3>
                <span className="ml-auto text-xs text-slate-400">
                  {hasAssessment ? "Based on your profile" : "Interactive simulator"}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between mb-2">
                      <label className="text-xs font-semibold text-slate-600">Revenue increases by</label>
                      <span className="text-xs font-bold" style={{ color: "#0e7490" }}>+{simRevenuePct}%</span>
                    </div>
                    <input type="range" min={0} max={50} step={5} value={simRevenuePct}
                      onChange={(e) => setSimRevenuePct(+e.target.value)}
                      className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                      style={{ accentColor: "#0e7490" }} />
                    <div className="flex justify-between text-xs text-slate-300 mt-1"><span>0%</span><span>50%</span></div>
                  </div>
                  <div>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <div onClick={() => setSimCollateral(!simCollateral)}
                        className="w-10 h-5 rounded-full transition-colors relative flex-shrink-0"
                        style={{ background: simCollateral ? "#0e7490" : "#e2e8f0" }}>
                        <motion.div className="w-4 h-4 bg-white rounded-full absolute top-0.5"
                          animate={{ left: simCollateral ? "22px" : "2px" }}
                          transition={{ type: "spring" as const, stiffness: 400, damping: 30 }} />
                      </div>
                      <span className="text-xs font-semibold text-slate-600">
                        Add collateral (+{Math.round(simBase.low * 0.4 / 1000)}K)
                      </span>
                    </label>
                  </div>
                  {!hasRevenue && (
                    <p className="text-xs text-slate-400">
                      <Link href="/dashboard/apply" className="underline text-cyan-600">Build your revenue model</Link> to use your real numbers as the baseline.
                    </p>
                  )}
                </div>

                {/* Result */}
                <div className="rounded-xl p-4 flex flex-col justify-center" style={{ background: "#f0f9ff" }}>
                  <p className="text-xs font-semibold text-slate-400 mb-1">Updated eligible range</p>
                  <motion.p key={`${simLow}-${simHigh}`}
                    initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.3 }}
                    className="text-xl sm:text-2xl font-bold" style={{ color: "#0e7490" }}>
                    {fmtCurrency(simLow)} – {fmtCurrency(simHigh)}
                  </motion.p>
                  {(simRevenuePct > 0 || simCollateral) && (
                    <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                      className="text-xs font-semibold mt-1" style={{ color: "#059669" }}>
                      +{fmtCurrency(simLow - simBase.low)} increase from baseline
                    </motion.p>
                  )}
                  <p className="text-xs text-slate-400 mt-2">
                    {hasAssessment ? "Simulated from your real profile" : "Adjust sliders to see how improvements affect your range"}
                  </p>
                </div>
              </div>
            </motion.section>

            {/* ══ Upgrade Pro ══ */}
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6, duration: 0.5, ease: EASE }}
              className="rounded-2xl p-6 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 relative overflow-hidden"
              style={{ background: "linear-gradient(135deg,#1e1b4b 0%,#3730a3 50%,#4f46e5 100%)" }}>
              <motion.div animate={{ scale: [1, 1.3, 1], opacity: [0.08, 0.18, 0.08] }}
                transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
                className="absolute -right-16 -top-16 w-64 h-64 rounded-full"
                style={{ background: "radial-gradient(circle,#818cf8 0%,transparent 70%)" }} />
              <div className="relative z-10">
                <div className="flex items-center gap-2 mb-1">
                  <Zap className="w-4 h-4 text-yellow-300" />
                  <p className="font-bold text-lg text-white">Unlock Funding Pro</p>
                </div>
                <p className="text-indigo-200 text-sm mb-3">Everything you need to get funded faster</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5">
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
              <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.97 }} className="relative z-10 flex-shrink-0">
                <Link href="/dashboard/billing"
                  className="flex items-center gap-2 bg-white text-indigo-900 text-sm font-bold px-6 py-3 rounded-xl hover:bg-indigo-50 transition-colors shadow-xl">
                  Upgrade Now <ArrowUpRight className="w-4 h-4" />
                </Link>
              </motion.div>
            </motion.div>

          </div>
        </main>
      </div>

      {/* ── Delete revenue model confirmation modal ── */}
      <AnimatePresence>
        {clearModelConfirm && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => setClearModelConfirm(false)} />
            <motion.div
              initial={{ scale: 0.92, opacity: 0, y: 12 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.92, opacity: 0, y: 12 }}
              transition={{ duration: 0.25, ease: EASE }}
              className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 z-10">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: "#fff1f2" }}>
                  <AlertTriangle className="w-5 h-5" style={{ color: "#e11d48" }} />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-900">Delete Revenue Model?</p>
                  <p className="text-xs text-slate-400 mt-0.5">This cannot be undone</p>
                </div>
              </div>
              <p className="text-sm text-slate-600 mb-5">
                All revenue streams, items, and projections will be permanently removed from your account — both locally and in the database.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setClearModelConfirm(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
                  Cancel
                </button>
                <motion.button whileTap={{ scale: 0.97 }} onClick={deleteRevenueModel}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2"
                  style={{ background: "linear-gradient(135deg,#dc2626,#e11d48)" }}>
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
