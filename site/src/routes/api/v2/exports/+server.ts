import type { RequestHandler } from "./$types";
import { errorResponse } from "$lib/server/errors";
import { resolveV2Context, v2Json } from "$lib/server/v2-context";
import { listReleases } from "$lib/server/releases";

interface ExportManifest {
  files: { key: string; sha256: string; bytes: number }[];
}

/**
 * `GET /api/v2/exports` — for every release published against the resolved
 * task-set hash (`?set=`, default `current`), the file listing from its R2
 * export manifest. A release whose manifest is somehow missing from R2 is
 * skipped rather than 500ing the whole list.
 */
export const GET: RequestHandler = async ({ request, url, platform }) => {
  try {
    const db = platform!.env.DB;
    const blobs = platform!.env.BLOBS;
    const ctx = await resolveV2Context(db, url);
    const releases = await listReleases(db, ctx.task_set_hash);

    const data: {
      release_slug: string;
      files: { key: string; sha256: string; bytes: number }[];
      manifest_sha256: string;
    }[] = [];
    for (const r of releases) {
      if (!r.export_manifest_sha256) continue;
      const obj = await blobs.get(`exports/${r.slug}/manifest.json`);
      if (!obj) continue;
      const manifest = JSON.parse(await obj.text()) as ExportManifest;
      data.push({
        release_slug: r.slug,
        files: manifest.files,
        manifest_sha256: r.export_manifest_sha256,
      });
    }

    return v2Json(request, ctx, { data });
  } catch (err) {
    return errorResponse(err);
  }
};
