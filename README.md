# BIM 4D — Plataforma 4D para projetos de engenharia

Aplicativo web para carregar modelos IFC, importar cronogramas e simular a construção ao longo do tempo (4D), com visão para 5D na fase 2.

## Stack

- **Next.js 15** (App Router) + **TypeScript** + **Tailwind** + **shadcn/ui**
- **Three.js + ThatOpen Engine** (`@thatopen/components`, `@thatopen/fragments`, `web-ifc`) para renderização IFC
- **Supabase** (Auth + Postgres + Storage + RLS)
- **gantt-task-react** para o editor Gantt
- **fast-xml-parser**, **papaparse**, **xlsx** para importadores de cronograma

## Setup

1. Instalar dependências:

```bash
npm install
```

2. Criar `.env.local` a partir de `.env.local.example` com as credenciais do Supabase:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

3. Rodar a migration `supabase/migrations/0001_init.sql` no seu projeto Supabase (Dashboard > SQL editor) e criar o bucket privado `ifc-files` em Storage.

4. Iniciar:

```bash
npm run dev
```

## Estrutura

- `app/(marketing)/` — landing page
- `app/(app)/dashboard` — lista de projetos
- `app/(app)/project/[id]` — workspace com viewer 3D, Gantt e player 4D
- `components/viewer` — viewer IFC (ThatOpen)
- `components/gantt` — editor Gantt
- `components/timeline` — player 4D
- `components/linker` — linkagem tarefa ↔ elemento
- `lib/ifc` — carregamento e parsing IFC
- `lib/schedule/importers` — MS Project XML, P6 XML/XER, CSV
- `lib/supabase` — clientes Supabase
- `supabase/migrations` — schema SQL

## Roadmap

- [x] MVP 4D
- [ ] 5D (custos, QTO, curvas S)
- [ ] Colaboração em tempo real
- [ ] Clash detection
- [ ] Exportar vídeo da simulação
