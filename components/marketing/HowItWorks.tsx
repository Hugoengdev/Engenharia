import { Upload, ListTree, Play } from "lucide-react";

const steps = [
  {
    num: "01",
    icon: Upload,
    title: "Suba o IFC",
    description:
      "Arraste seu modelo IFC. Em segundos ele é otimizado para Fragments e renderizado no viewer 3D do navegador.",
  },
  {
    num: "02",
    icon: ListTree,
    title: "Importe ou crie o cronograma",
    description:
      "Conecte seu plano de MS Project, Primavera P6, CSV/Excel — ou monte tarefas, dependências e prazos no editor Gantt nativo.",
  },
  {
    num: "03",
    icon: Play,
    title: "Linke e simule em 4D",
    description:
      "Associe tarefas a elementos do IFC e dê play. A obra ganha vida no modelo, com transparência para quem ainda não foi executado.",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="relative border-b border-border/40 py-24">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-xs uppercase tracking-[0.2em] text-primary">
            Como funciona
          </span>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
            Do IFC ao 4D em 3 passos
          </h2>
          <p className="mt-4 text-muted-foreground">
            Sem instalação, sem servidor próprio. Você só precisa do seu modelo
            e do seu cronograma.
          </p>
        </div>

        <div className="mt-16 grid gap-6 md:grid-cols-3">
          {steps.map(({ num, icon: Icon, title, description }) => (
            <div
              key={num}
              className="relative rounded-xl border border-border/60 bg-card/40 p-8 backdrop-blur"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-muted-foreground">
                  {num}
                </span>
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="mt-8 text-xl font-semibold tracking-tight">
                {title}
              </h3>
              <p className="mt-3 text-sm text-muted-foreground">{description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
