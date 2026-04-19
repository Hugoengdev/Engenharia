import Link from "next/link";
import { Building2, LayoutGrid } from "lucide-react";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-border/40 bg-background/70 backdrop-blur-xl">
        <div className="flex h-14 items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="flex items-center gap-2">
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
                <Building2 className="h-4 w-4" />
              </div>
              <div className="leading-tight">
                <div className="text-sm font-semibold tracking-tight">
                  ELOS 4D
                </div>
                <div className="text-[10px] text-muted-foreground">
                  Egtc Lean Operational System 4D
                </div>
              </div>
            </Link>

            <nav className="hidden items-center gap-1 md:flex">
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <LayoutGrid className="h-4 w-4" />
                Projetos
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <span className="rounded-md border border-border/60 bg-card/40 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Dev mode
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>
    </div>
  );
}
