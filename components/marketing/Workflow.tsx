import { CheckCircle2 } from "lucide-react";

const benefits = [
  "Comunicação visual com diretoria e cliente, sem PowerPoint",
  "Detecção precoce de incompatibilidades de sequência",
  "Logística de canteiro mais clara: o que sobe quando",
  "Frente de serviço alinhada à liberação de áreas",
  "Acompanhamento real x previsto direto no modelo",
  "Base sólida para evoluir para 5D (custos) na fase 2",
];

export function Workflow() {
  return (
    <section id="workflow" className="relative border-b border-border/40 py-24">
      <div className="container grid items-center gap-12 lg:grid-cols-2">
        <div>
          <span className="text-xs uppercase tracking-[0.2em] text-primary">
            Workflow
          </span>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
            Pensado para times de engenharia que vivem o dia a dia da obra
          </h2>
          <p className="mt-4 text-muted-foreground">
            Engenheiros de planejamento, coordenadores BIM, gerentes de
            contrato e diretoria — todos olham para o mesmo modelo, com a mesma
            verdade visual.
          </p>

          <ul className="mt-8 grid gap-3">
            {benefits.map((b) => (
              <li key={b} className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <span className="text-sm text-muted-foreground">{b}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative">
          <div className="rounded-xl border border-border/60 bg-card/40 p-1 backdrop-blur">
            <div className="grid grid-cols-12 gap-1">
              <div className="col-span-3 rounded-lg border border-border/60 bg-background/40 p-4">
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  Tarefas
                </div>
                <div className="mt-3 space-y-2">
                  {[
                    "Fundação",
                    "Pilares P1",
                    "Lajes L1",
                    "Alvenaria",
                    "Cobertura",
                  ].map((t, i) => (
                    <div
                      key={t}
                      className="flex items-center gap-2 rounded-md border border-border/40 bg-card/40 px-2 py-1.5 text-xs"
                    >
                      <span className="font-mono text-[9px] text-muted-foreground">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="truncate">{t}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="col-span-9 rounded-lg border border-border/60 bg-background/40 p-4">
                <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  <span>Timeline</span>
                  <span className="font-mono">Mar — Set</span>
                </div>
                <div className="mt-4 space-y-3">
                  {[
                    { o: "5%", w: "20%" },
                    { o: "18%", w: "25%" },
                    { o: "30%", w: "30%" },
                    { o: "45%", w: "35%" },
                    { o: "65%", w: "30%" },
                  ].map((bar, i) => (
                    <div
                      key={i}
                      className="relative h-3 rounded-full bg-secondary/60"
                    >
                      <div
                        className="absolute h-full rounded-full bg-gradient-to-r from-primary to-primary/60"
                        style={{ left: bar.o, width: bar.w }}
                      />
                    </div>
                  ))}
                </div>

                <div className="mt-6 flex items-center justify-between">
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-primary" />
                      Em execução
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-secondary" />
                      Pendente
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    Hoje · 12 / Mai
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
