import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CTA() {
  return (
    <section className="relative border-b border-border/40 py-24">
      <div className="container">
        <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-card/40 p-10 md:p-16">
          <div
            className="absolute -inset-px rounded-3xl bg-gradient-to-br from-primary/30 via-transparent to-primary/10 opacity-60 blur-xl"
            aria-hidden
          />
          <div className="relative grid items-center gap-10 lg:grid-cols-2">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
                Pronto para ver sua obra acontecer?
              </h2>
              <p className="mt-4 text-muted-foreground">
                Crie sua conta gratuita, suba seu primeiro IFC e gere uma
                simulação 4D em menos de 5 minutos.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 lg:justify-end">
              <Button size="lg" asChild>
                <Link href="/dashboard">
                  Abrir app
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <a href="mailto:contato@bim4d.app">Falar com o time</a>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
