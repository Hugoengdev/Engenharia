import {
  Box,
  CalendarRange,
  GitMerge,
  PlayCircle,
  Workflow,
  ShieldCheck,
} from "lucide-react";

const features = [
  {
    icon: Box,
    title: "Viewer IFC nativo",
    description:
      "Carregue arquivos IFC 2x3 e IFC 4. Navegue pelo modelo, selecione elementos e explore a árvore de pavimentos diretamente no navegador.",
  },
  {
    icon: CalendarRange,
    title: "Importação multi-formato",
    description:
      "Traga seu cronograma de MS Project (XML), Primavera P6 (XML / XER), CSV e Excel. Ou crie do zero no editor Gantt embutido.",
  },
  {
    icon: GitMerge,
    title: "Linkagem inteligente",
    description:
      "Associe tarefas a elementos do IFC por seleção visual ou em lote por filtros (IfcType, pavimento, propriedade).",
  },
  {
    icon: PlayCircle,
    title: "Player 4D",
    description:
      "Slider de timeline com play, pause e velocidade. Veja a obra subir dia a dia, com cores indicando status de cada elemento.",
  },
  {
    icon: Workflow,
    title: "Pronto para 5D",
    description:
      "Arquitetura preparada para custos: na fase 2, conecte preços unitários e quantidades para curva S e custo no tempo.",
  },
  {
    icon: ShieldCheck,
    title: "Seus dados, seus projetos",
    description:
      "Cada projeto fica isolado com Row Level Security. Apenas você (e quem você convidar) tem acesso ao modelo e cronograma.",
  },
];

export function Features() {
  return (
    <section id="features" className="relative border-b border-border/40 py-24">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-xs uppercase tracking-[0.2em] text-primary">
            Recursos
          </span>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
            Tudo que sua obra precisa para falar 4D
          </h2>
          <p className="mt-4 text-muted-foreground">
            Uma plataforma única, pensada para engenheiros de planejamento,
            coordenadores BIM e gerentes de obra.
          </p>
        </div>

        <div className="mt-16 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, title, description }) => (
            <div
              key={title}
              className="group relative overflow-hidden rounded-xl border border-border/60 bg-card/40 p-6 backdrop-blur transition-colors hover:border-primary/40"
            >
              <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary/5 blur-2xl transition-opacity group-hover:bg-primary/10" />
              <div className="relative">
                <div className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-background">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="mt-5 text-lg font-semibold tracking-tight">
                  {title}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">{description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
