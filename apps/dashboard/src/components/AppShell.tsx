import type { ReactNode } from "react";
import { Activity, Bell, Boxes, LayoutGrid, LogOut, Search, Settings2, TimerReset, Users } from "lucide-react";
import { NavLink } from "react-router-dom";

const navItems = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutGrid },
  { label: "Jobs", href: "/jobs", icon: TimerReset },
  { label: "Queues", href: "/queues", icon: Boxes },
  { label: "DLQ", href: "/dlq", icon: Bell },
  { label: "Operations", href: "/operations", icon: Activity },
  { label: "Workers", href: "/workers", icon: Users },
  { label: "Timeline", href: "/timeline", icon: TimerReset },
  { label: "Alerts", href: "/alerts", icon: Bell }
];

export function AppShell({ children, onLogout }: { children: ReactNode; onLogout: () => void }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center gap-4 px-4 py-3 lg:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded border border-emerald-500/30 bg-emerald-500/10 font-mono text-xs font-bold text-emerald-300">
              DJ
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400">Cluster</div>
              <div className="font-mono text-sm font-medium text-slate-200">scheduler-core</div>
            </div>
          </div>

          <nav aria-label="Main navigation" className="hidden items-center gap-1 md:flex">
            {navItems.map(({ label, href, icon: Icon }) => (
              <NavLink
                key={label}
                to={href}
                className={({ isActive }) => `inline-flex items-center gap-2 rounded border px-3 py-2 text-sm transition ${isActive ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-200" : "border-transparent text-slate-300 hover:border-slate-700 hover:bg-slate-900 hover:text-slate-100"}`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden min-w-50 items-center gap-2 rounded border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-400 md:flex">
              <Search className="h-4 w-4" />
              <input
                aria-label="Global search"
                placeholder="Search jobs, workers, queues"
                className="w-full border-0 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
              />
            </div>
            <button className="rounded border border-slate-700 bg-slate-900 p-2 text-slate-300 transition hover:border-slate-600 hover:text-slate-100" aria-label="Preferences">
              <Settings2 className="h-4 w-4" />
            </button>
            <button onClick={onLogout} className="rounded border border-slate-700 bg-slate-900 p-2 text-slate-300 transition hover:border-red-500/50 hover:text-red-200" aria-label="Sign out" title="Sign out">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 py-6 lg:px-6">{children}</main>
    </div>
  );
}
