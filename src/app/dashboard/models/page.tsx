"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, BarChart3, FilePlus2, Lock } from "lucide-react";
import { DashboardSidebar } from "../_nav";

export default function ModelsPage() {
  const router = useRouter();
  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <DashboardSidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-6 py-4 flex items-center gap-3">
          <button onClick={() => router.back()} className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-lg font-bold text-slate-900">Financial Models</h1>
            <p className="text-xs text-slate-500">Scenario analysis, sensitivity tables &amp; P&amp;L</p>
          </div>
        </div>

        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-73px)] px-6 text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5 shadow-lg"
            style={{ background: "linear-gradient(135deg,#0e7490,#0891b2)" }}>
            <BarChart3 size={28} className="text-white" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Financial Models</h2>
          <p className="text-slate-500 max-w-sm mb-8 leading-relaxed">
            Full P&amp;L, cash flow, and sensitivity models will be generated automatically
            once your funding application is complete.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <Link href="/dashboard/apply"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
              style={{ background: "linear-gradient(135deg,#0e7490,#0891b2)" }}>
              <FilePlus2 size={16} /> Start a Funding Application
            </Link>
            <Link href="/dashboard"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors">
              Back to Dashboard
            </Link>
          </div>
          <div className="mt-10 flex items-center gap-2 px-4 py-2 rounded-full bg-amber-50 border border-amber-200">
            <Lock size={13} className="text-amber-500" />
            <span className="text-xs font-medium text-amber-700">Coming soon — advanced modelling is in development</span>
          </div>
        </div>
      </main>
    </div>
  );
}
