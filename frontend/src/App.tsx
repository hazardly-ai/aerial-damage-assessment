import { Button } from "@/components/ui/button";

export default function App() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-6 py-12">
        <header className="space-y-3">
          <p className="text-sm uppercase tracking-[0.35em] text-muted-foreground">
            Aerial Damage Assessment
          </p>
          <h1 className="text-4xl font-semibold leading-tight sm:text-5xl">
            Rapid post-disaster insights from aerial imagery.
          </h1>
          <p className="max-w-2xl text-base text-muted-foreground sm:text-lg">
            Inspect, quantify, and triage damage with a unified dashboard that
            combines imagery, model outputs, and field notes.
          </p>
        </header>
        <section className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <h2 className="text-lg font-medium">Live assessment feed</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Track processing progress and surface the highest priority tiles.
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <h2 className="text-lg font-medium">Analyst-ready exports</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Export GeoJSON, CSV, and reports for partners and responders.
            </p>
          </div>
        </section>
        <div className="flex flex-wrap gap-3">
          <Button>Connect backend</Button>
          <Button variant="outline">Upload imagery</Button>
        </div>
      </div>
    </div>
  );
}
