import { NextResponse } from "next/server";

/**
 * GET /api/ifc/staging
 *
 * Lets the browser choose an upload strategy without exposing secrets.
 */
export async function GET() {
  return NextResponse.json({
    blobConfigured: Boolean(process.env.BLOB_READ_WRITE_TOKEN?.length),
  });
}
