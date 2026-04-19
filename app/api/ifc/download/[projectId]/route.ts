import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { downloadAsset } from "@/lib/storage/github";
import type { ProjectRow } from "@/lib/supabase/types";

export const runtime = "nodejs";
// 60s = Vercel Hobby plan ceiling. Raise up to 300 on Pro if needed.
export const maxDuration = 60;

/**
 * GET /api/ifc/download/:projectId
 *
 * Authenticated proxy for GitHub-hosted IFCs. The client never sees the PAT:
 *   - We fetch the private release asset using the server-side token.
 *   - GitHub responds with a 302 to a short-lived signed S3 URL.
 *   - Node's fetch follows the redirect (`redirect: "follow"`).
 *   - We stream the resulting body back to the caller unchanged.
 *
 * Falls back to 404 if the project has no GitHub asset attached (e.g. legacy
 * projects still on Supabase Storage — those are served via a signed URL
 * generated in the server component instead).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("projects")
      .select("ifc_storage, ifc_asset_id, ifc_filename, ifc_size_bytes")
      .eq("id", projectId)
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const project = data as Pick<
      ProjectRow,
      "ifc_storage" | "ifc_asset_id" | "ifc_filename" | "ifc_size_bytes"
    >;

    if (project.ifc_storage !== "github" || !project.ifc_asset_id) {
      return NextResponse.json(
        { error: "No GitHub asset attached to this project" },
        { status: 404 }
      );
    }

    const upstream = await downloadAsset(project.ifc_asset_id);
    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "");
      return NextResponse.json(
        { error: `GitHub download failed: ${upstream.status} ${text}` },
        { status: 502 }
      );
    }

    const filename = project.ifc_filename ?? "model.ifc";
    const headers = new Headers();
    headers.set("Content-Type", "application/octet-stream");
    headers.set(
      "Content-Disposition",
      `inline; filename="${filename.replace(/"/g, "")}"`
    );
    // Let the browser show a progress bar when the upstream advertises size.
    const upstreamLen = upstream.headers.get("content-length");
    if (upstreamLen) headers.set("Content-Length", upstreamLen);

    return new NextResponse(upstream.body, { status: 200, headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
