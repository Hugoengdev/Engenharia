import Link from "next/link";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const plans = [
  {
    name: "Starter",
    price: "Grátis",
    description: "Para experimentar com um projeto piloto.",
    features: [
      "1 projeto ativo",
      "IFC até 100 MB",
      "Importação CSV",
      "Player 4D básico",
    ],
    cta: "Começar grátis",
    highlight: false,
  },
  {
    name: "Pro",
    price: "R$ 149",
    suffix: "/mês por usuário",
    description: "Para engenheiros e times de planejamento.",
    features: [
      "Projetos ilimitados",
      "IFC até 1 GB",
      "MS Project, P6 XML/XER, CSV, Excel",
      "Player 4D completo + filtros",
      "Snapshots e versões do cronograma",
    ],
    cta: "Iniciar trial de 14 dias",
    highlight: true,
  },
  {
    name: "Empresa",
    price: "Sob consulta",
    description: "Para construtoras com múltiplas obras.",
    features: [
      "SSO e RBAC",
      "Auditoria e logs",
      "Suporte dedicado",
      "Onboarding com nosso time",
      "Roadmap 5D prioritário",
    ],
    cta: "Falar com vendas",
    highlight: false,
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="relative border-b border-border/40 py-24">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-xs uppercase tracking-[0.2em] text-primary">
            Planos
          </span>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
            Comece grátis. Escale quando fizer sentido.
          </h2>
        </div>

        <div className="mt-16 grid gap-6 lg:grid-cols-3">
          {plans.map((p) => (
            <div
              key={p.name}
              className={cn(
                "relative flex flex-col rounded-2xl border p-8 backdrop-blur",
                p.highlight
                  ? "border-primary/60 bg-primary/[0.06] glow-shadow"
                  : "border-border/60 bg-card/40"
              )}
            >
              {p.highlight && (
                <span className="absolute -top-3 left-6 rounded-full border border-primary/40 bg-background px-3 py-0.5 text-[10px] font-medium uppercase tracking-[0.2em] text-primary">
                  Mais popular
                </span>
              )}
              <div>
                <h3 className="text-lg font-semibold">{p.name}</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {p.description}
                </p>
                <div className="mt-6 flex items-baseline gap-2">
                  <span className="text-3xl font-semibold tracking-tight">
                    {p.price}
                  </span>
                  {p.suffix && (
                    <span className="text-xs text-muted-foreground">
                      {p.suffix}
                    </span>
                  )}
                </div>
              </div>

              <ul className="mt-6 flex-1 space-y-2">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span className="text-muted-foreground">{f}</span>
                  </li>
                ))}
              </ul>

              <Button
                className="mt-8"
                variant={p.highlight ? "default" : "outline"}
                asChild
              >
                <Link href="/dashboard">{p.cta}</Link>
              </Button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
