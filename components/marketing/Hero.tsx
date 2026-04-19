import Link from "next/link";
import Spline from "@splinetool/react-spline/next";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Full-screen, centered hero. The Spline scene fills the canvas behind
 * the copy; a subtle gradient veil keeps the headline readable regardless
 * of the 3D object's colors.
 *
 * IMPORTANT: this file must stay a Server Component (no "use client").
 * `@splinetool/react-spline/next` exports an async Server Component that
 * fetches the scene preview on the server for a faster LCP. If the Hero
 * is marked as a Client Component, React receives a Promise instead of
 * JSX and the 3D silently fails to render. All pieces used here (Link,
 * Button, anchor tags) are server-safe.
 *
 * Note on the Spline watermark: the free plan renders a small "Built
 * with Spline" badge in the bottom-right corner of the canvas. We cover
 * it with a div sized to match the watermark, using the same background
 * as the page so it blends in seamlessly (no visible patch).
 */
export function Hero() {
  return (
    <section className="relative flex min-h-[calc(100vh-4rem)] w-full items-center justify-center overflow-hidden bg-black">
      {/* Ambient background — subtle grid + a big radial glow behind the
          centerpiece so the 3D object always feels lit from within. */}
      <div className="absolute inset-0 grid-bg opacity-20" aria-hidden />
      <div
        className="absolute left-1/2 top-1/2 h-[720px] w-[720px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/20 blur-[180px]"
        aria-hidden
      />

      {/* 3D scene — absolute, fills the section, sits BEHIND the copy. */}
      <div
        id="hero-spline"
        data-spline-slot
        className="absolute inset-0 [&_canvas]:!h-full [&_canvas]:!w-full"
      >
        <Spline scene="https://prod.spline.design/NlRKkID-H98-zXKO/scene.splinecode" />

        {/* Watermark cover — a seamless patch over the bottom-right logo.
            Matches the hero's pure-black background so it reads as empty
            space, not a sticker. Size + fade are tuned so the logo is
            fully masked even on 4K monitors and high-DPR displays. */}
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-0 right-0 h-28 w-64 bg-black"
          style={{
            // Fully opaque over the logo zone and fading out diagonally
            // into the scene so the patch is invisible to the eye.
            maskImage:
              "linear-gradient(to top left, black 0%, black 65%, transparent 100%)",
            WebkitMaskImage:
              "linear-gradient(to top left, black 0%, black 65%, transparent 100%)",
          }}
        />
      </div>

      {/* Readability veil so the headline always reads against the 3D. */}
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/80"
        aria-hidden
      />

      {/* Seamless handoff to the next section. The hero is painted on
          pure `bg-black` and the rest of the page runs on the app's
          dark-navy `bg-background`; without a blend those two colors
          collide at the hero's bottom edge and look like a hard seam.
          This tall gradient strip starts transparent mid-hero and fades
          into the exact `bg-background` color by the time it reaches the
          edge, so the handoff reads as one continuous surface. */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-64 bg-gradient-to-b from-transparent to-background"
        aria-hidden
      />

      {/* Centered copy — we turn pointer events OFF on the wrapper so the
          mouse "falls through" to the Spline canvas behind it (the 3D
          model tracks the cursor normally). Interactive children — the
          CTA buttons / links — get `pointer-events-auto` re-enabled so
          they stay clickable. */}
      <div className="pointer-events-none relative z-10 mx-auto flex max-w-3xl flex-col items-center px-6 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          Engenharia · 4D
        </div>

        <h1 className="mt-6 text-4xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
          O cronograma{" "}
          <span className="gradient-text">vivo na sua modelagem 3D</span>.
        </h1>

        <p className="mt-5 max-w-md text-base text-muted-foreground md:text-lg">
          Veja a obra sendo construída em 4D, direto do seu modelo BIM.
        </p>

        <div className="pointer-events-auto mt-10 flex flex-wrap items-center justify-center gap-3">
          <Button size="lg" asChild>
            <Link href="/login">
              Abrir app
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <a href="#how">Como funciona</a>
          </Button>
        </div>
      </div>
    </section>
  );
}
