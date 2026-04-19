export default function DashboardLoading() {
  return (
    <div className="container max-w-6xl py-10">
      <div className="flex items-end justify-between">
        <div>
          <div className="h-9 w-56 animate-pulse rounded-md bg-muted/50" />
          <div className="mt-2 h-4 w-80 animate-pulse rounded-md bg-muted/40" />
        </div>
        <div className="h-9 w-32 animate-pulse rounded-md bg-muted/50" />
      </div>

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-48 animate-pulse rounded-xl border border-border/60 bg-card/30"
          />
        ))}
      </div>
    </div>
  );
}
