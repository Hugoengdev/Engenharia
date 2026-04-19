import "server-only";

/**
 * Thin wrapper around the GitHub Releases API for IFC file storage.
 *
 * Why GitHub Releases?
 *  - Supabase Free caps uploads at 50 MB/file; real BIM models often exceed it.
 *  - GitHub Releases allow assets up to 2 GB each and are truly free on private
 *    repos, with no credit card required.
 *  - Each project owns one release (tag = `project-<projectId>`), which can
 *    hold any number of assets. For simplicity we keep one IFC per release and
 *    replace it on re-upload.
 *
 * This module must only run on the server — the PAT lives in `GITHUB_TOKEN`
 * and is never shipped to the browser. The `import "server-only"` directive
 * enforces that at build time.
 *
 * API docs:
 *   https://docs.github.com/rest/releases/releases
 *   https://docs.github.com/rest/releases/assets
 */

const API = "https://api.github.com";

// Use a short cache so repeated reads in the same request don't hammer the API.
const DEFAULT_HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
} as const;

export interface GithubStorageConfig {
  owner: string;
  repo: string;
  token: string;
}

export interface ReleaseAsset {
  id: number;
  name: string;
  size: number;
  content_type: string;
  url: string; // API URL (authenticated download)
}

export interface Release {
  id: number;
  tag_name: string;
  name: string | null;
  assets: ReleaseAsset[];
}

function getConfig(): GithubStorageConfig {
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;
  if (!owner || !repo || !token) {
    throw new Error(
      "GitHub storage not configured. Set GITHUB_OWNER, GITHUB_REPO and GITHUB_TOKEN in .env.local."
    );
  }
  return { owner, repo, token };
}

function authHeaders(token: string): Record<string, string> {
  return {
    ...DEFAULT_HEADERS,
    Authorization: `Bearer ${token}`,
  };
}

/**
 * One release per project. The tag name is fully derived from the projectId
 * so we can always find (or create) the right release without storing extra
 * indirection in the DB.
 */
function releaseTag(projectId: string): string {
  return `project-${projectId}`;
}

async function ghFetch(
  path: string,
  init: RequestInit & { token: string }
): Promise<Response> {
  const { token, headers, ...rest } = init;
  const res = await fetch(`${API}${path}`, {
    ...rest,
    headers: {
      ...authHeaders(token),
      ...(headers as Record<string, string> | undefined),
    },
    // Next.js defaults to caching GET fetches — we always want fresh data.
    cache: "no-store",
  });
  return res;
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string };
    return body.message ?? `${res.status} ${res.statusText}`;
  } catch {
    return `${res.status} ${res.statusText}`;
  }
}

/**
 * Find a release by its tag. Returns null if not found (404).
 */
async function getReleaseByTag(
  cfg: GithubStorageConfig,
  tag: string
): Promise<Release | null> {
  const res = await ghFetch(
    `/repos/${cfg.owner}/${cfg.repo}/releases/tags/${encodeURIComponent(tag)}`,
    { method: "GET", token: cfg.token }
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(
      `Failed to fetch release ${tag}: ${await readError(res)}`
    );
  }
  return (await res.json()) as Release;
}

async function createRelease(
  cfg: GithubStorageConfig,
  tag: string,
  projectId: string
): Promise<Release> {
  const res = await ghFetch(`/repos/${cfg.owner}/${cfg.repo}/releases`, {
    method: "POST",
    token: cfg.token,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tag_name: tag,
      name: `Project ${projectId}`,
      body: `IFC storage for project ${projectId}. Managed automatically — do not edit.`,
      draft: false,
      prerelease: true, // hide from the repo's main "Releases" sidebar
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to create release ${tag}: ${await readError(res)}`);
  }
  return (await res.json()) as Release;
}

/**
 * Get or create the release that holds the given project's IFC.
 */
export async function ensureProjectRelease(
  projectId: string
): Promise<Release> {
  const cfg = getConfig();
  const tag = releaseTag(projectId);
  const existing = await getReleaseByTag(cfg, tag);
  if (existing) return existing;
  return createRelease(cfg, tag, projectId);
}

async function deleteAsset(
  cfg: GithubStorageConfig,
  assetId: number
): Promise<void> {
  const res = await ghFetch(
    `/repos/${cfg.owner}/${cfg.repo}/releases/assets/${assetId}`,
    { method: "DELETE", token: cfg.token }
  );
  // 404 = already gone; treat as success.
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to delete asset ${assetId}: ${await readError(res)}`);
  }
}

/**
 * Upload a file to a release. If the release already has an asset with the
 * same name, it is deleted first (GitHub rejects duplicates).
 *
 * Asset uploads use a dedicated host (`uploads.github.com`) — not the REST
 * API host — and accept the raw binary as the request body.
 *
 * @param body Either a Buffer, Uint8Array, Blob, or a `ReadableStream`.
 */
export async function uploadAssetToRelease(args: {
  release: Release;
  filename: string;
  contentType: string;
  body: ArrayBuffer | Uint8Array | Blob;
  contentLength: number;
}): Promise<ReleaseAsset> {
  const cfg = getConfig();
  const { release, filename, contentType, body, contentLength } = args;

  // Remove any prior asset with the same name to allow re-uploads.
  const stale = release.assets.find((a) => a.name === filename);
  if (stale) await deleteAsset(cfg, stale.id);

  const url = new URL(
    `https://uploads.github.com/repos/${cfg.owner}/${cfg.repo}/releases/${release.id}/assets`
  );
  url.searchParams.set("name", filename);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...authHeaders(cfg.token),
      "Content-Type": contentType,
      "Content-Length": String(contentLength),
    },
    body: body as BodyInit,
    cache: "no-store",
    // The GitHub upload endpoint can take a while for big files — no timeout.
  });

  if (!res.ok) {
    throw new Error(
      `Failed to upload asset ${filename}: ${await readError(res)}`
    );
  }
  return (await res.json()) as ReleaseAsset;
}

/**
 * Stream a release asset back. We always go through the authenticated REST
 * endpoint with `Accept: application/octet-stream`, which GitHub answers with
 * a 302 redirect to a short-lived signed S3 URL. Setting `redirect: "follow"`
 * transparently follows it — the caller just gets the binary body.
 */
export async function downloadAsset(assetId: number): Promise<Response> {
  const cfg = getConfig();
  const res = await fetch(
    `${API}/repos/${cfg.owner}/${cfg.repo}/releases/assets/${assetId}`,
    {
      method: "GET",
      headers: {
        ...authHeaders(cfg.token),
        Accept: "application/octet-stream",
      },
      redirect: "follow",
      cache: "no-store",
    }
  );
  return res;
}

/**
 * Delete an asset by id. Used when re-uploading or when a project is deleted.
 */
export async function removeAsset(assetId: number): Promise<void> {
  await deleteAsset(getConfig(), assetId);
}

/**
 * Delete a release (and all its assets). The tag created by the release is
 * also removed, so the slot is free to be reused if the same projectId is
 * ever recreated (very unlikely since ids are UUIDs, but tidy).
 *
 * Non-existent releases return silently — the caller can invoke this during
 * project deletion without first checking whether the project ever had a
 * GitHub-hosted IFC.
 */
export async function deleteProjectRelease(projectId: string): Promise<void> {
  const cfg = getConfig();
  const tag = releaseTag(projectId);
  const release = await getReleaseByTag(cfg, tag);
  if (!release) return;

  const delRelease = await ghFetch(
    `/repos/${cfg.owner}/${cfg.repo}/releases/${release.id}`,
    { method: "DELETE", token: cfg.token }
  );
  if (!delRelease.ok && delRelease.status !== 404) {
    throw new Error(
      `Failed to delete release ${tag}: ${await readError(delRelease)}`
    );
  }

  // Deleting a release does NOT delete the git tag — do that separately so
  // the tag doesn't linger in `git tag -l` forever.
  const delTag = await ghFetch(
    `/repos/${cfg.owner}/${cfg.repo}/git/refs/tags/${encodeURIComponent(tag)}`,
    { method: "DELETE", token: cfg.token }
  );
  if (!delTag.ok && delTag.status !== 404 && delTag.status !== 422) {
    // 422 happens when the tag was already unreachable — treat as ok.
    console.warn(
      `[github] failed to delete tag ${tag}: ${await readError(delTag)}`
    );
  }
}

/**
 * Bytes helper: GitHub requires Content-Length on uploads.
 */
export function byteLengthOf(
  body: ArrayBuffer | Uint8Array | Blob
): number {
  if (body instanceof Blob) return body.size;
  if (body instanceof Uint8Array) return body.byteLength;
  return body.byteLength;
}
