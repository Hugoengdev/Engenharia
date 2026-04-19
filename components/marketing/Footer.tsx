import { Building2 } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-t border-border/40 py-12">
      <div className="container flex flex-col items-center justify-between gap-6 md:flex-row">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Building2 className="h-4 w-4" />
          </div>
          <span className="text-sm">
            <strong className="font-semibold">ELOS 4D</strong>
            <span className="ml-2 text-muted-foreground">
              Egtc Lean Operational System 4D
            </span>
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          © {new Date().getFullYear()} ELOS 4D · Todos os direitos reservados
        </div>
      </div>
    </footer>
  );
}
