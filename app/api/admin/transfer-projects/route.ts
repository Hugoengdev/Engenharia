import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import type { ProjectRow } from "@/lib/supabase/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/admin/transfer-projects
 *
 * One-time migration: assigns every project (and Supabase Storage IFC paths) to
 * the user identified by TRANSFER_TARGET_EMAIL.
 *
 * Headers:
 *   x-transfer-secret: must equal PROJECT_TRANSFER_SECRET
 *
 * Env:
 *   SUPABASE_SERVICE_ROLE_KEY (required)
 *   PROJECT_TRANSFER_SECRET (required)
 *   TRANSFER_TARGET_EMAIL (optional; defaults to hugogabrielsalles97@gmail.com)
 */
export async function POST(req: Request) {
  const secret = req.headers.get("x-transfer-secret");
  const expected = process.env.PROJECT_TRANSFER_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const targetEmail =
    process.env.TRANSFER_TARGET_EMAIL?.trim() ||
    "hugogabrielsalles97@gmail.com";

  const admin = createServiceRoleClient();

  const { data: list, error: listErr } =
    await admin.auth.admin.listUsers({ perPage: 1000, page: 1 });
  if (listErr) {
    return NextResponse.json(
      { error: listErr.message },
      { status: 500 }
    );
  }

  const targetUser = list.users.find(
    (u) => u.email?.toLowerCase() === targetEmail.toLowerCase()
  );
  if (!targetUser) {
    return NextResponse.json(
      {
        error: `Usuário não encontrado: ${targetEmail}. Cadastre-se antes de rodar a transferência.`,
      },
      { status: 404 }
    );
  }

  const newOwnerId = targetUser.id;

  const { data: projects, error: projErr } = await admin
    .from("projects")
    .select("*");

  if (projErr) {
    return NextResponse.json({ error: projErr.message }, { status: 500 });
  }

  const rows = (projects ?? []) as ProjectRow[];
  let updated = 0;
  let storageMoved = 0;
  const errors: string[] = [];

  for (const p of rows) {
    if (p.owner_id === newOwnerId) continue;

    const oldOwnerId = p.owner_id;
    let nextPath = p.ifc_path;

    if (
      p.ifc_storage !== "github" &&
      p.ifc_path &&
      oldOwnerId
    ) {
      const filename =
        p.ifc_path.split("/").pop() || p.ifc_filename || "model.ifc";
      const dest = `${newOwnerId}/${p.id}/${filename}`;

      try {
        const { data: blob, error: dlErr } = await admin.storage
          .from("ifc-files")
          .download(p.ifc_path);
        if (dlErr || !blob) {
          errors.push(
            `${p.id}: download falhou (${dlErr?.message ?? "sem blob"})`
          );
          continue;
        }

        const buf = await blob.arrayBuffer();
        const { error: upErr } = await admin.storage
          .from("ifc-files")
          .upload(dest, buf, {
            contentType: "application/octet-stream",
            upsert: true,
          });
        if (upErr) {
          errors.push(`${p.id}: upload falhou (${upErr.message})`);
          continue;
        }

        await admin.storage.from("ifc-files").remove([p.ifc_path]);
        nextPath = dest;
        storageMoved++;
      } catch (e) {
        errors.push(
          `${p.id}: ${e instanceof Error ? e.message : "erro no storage"}`
        );
        continue;
      }
    }

    const { error: upRow } = await admin
      .from("projects")
      .update({
        owner_id: newOwnerId,
        ifc_path: nextPath,
      })
      .eq("id", p.id);

    if (upRow) {
      errors.push(`${p.id}: ${upRow.message}`);
      continue;
    }
    updated++;
  }

  return NextResponse.json({
    ok: true,
    targetEmail,
    projectsTotal: rows.length,
    projectsReassigned: updated,
    supabaseStorageFilesMoved: storageMoved,
    errors,
  });
}
