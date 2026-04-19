-- GitHub Releases as an alternative storage for IFC files.
-- The Supabase Free plan caps uploads at 50 MB per file, which is routinely
-- exceeded by real BIM models. We keep the legacy `ifc_path` column for the
-- Supabase-hosted files (so existing projects keep working) and add parallel
-- columns for GitHub-hosted ones.
--
-- `ifc_storage` is the source of truth:
--   * 'supabase' (default for legacy rows) → use ifc_path with Storage.createSignedUrl
--   * 'github'                             → use the release asset metadata below

alter table public.projects
    add column if not exists ifc_storage text
        check (ifc_storage is null or ifc_storage in ('supabase','github')),
    add column if not exists ifc_release_id bigint,
    add column if not exists ifc_asset_id bigint,
    add column if not exists ifc_asset_name text;

-- Backfill: anything that already has an ifc_path is Supabase-hosted.
update public.projects
set ifc_storage = 'supabase'
where ifc_storage is null and ifc_path is not null;

comment on column public.projects.ifc_storage is
    'Where the IFC file lives: ''supabase'' (Storage bucket ifc-files) or ''github'' (private repo release asset).';
comment on column public.projects.ifc_release_id is
    'GitHub release id that holds this project''s IFC asset (only set when ifc_storage = ''github'').';
comment on column public.projects.ifc_asset_id is
    'GitHub asset id inside the release (only set when ifc_storage = ''github''). Used for authenticated downloads and deletes.';
comment on column public.projects.ifc_asset_name is
    'Original asset filename on GitHub — useful for debugging which file was uploaded.';
