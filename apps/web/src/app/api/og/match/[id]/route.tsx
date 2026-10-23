/**
 * Batch 126: the legacy /api/og/match/[id] generator is retired. It
 * duplicated the canonical per-match OG image (the file-convention route at
 * /matches/[matchId]/opengraph-image, Batches 119/121) as a second divergent
 * generator that hardcoded the platform brand. Direct links to this legacy
 * URL — possibly already shared externally — get a permanent 308 redirect
 * to the canonical image, so no old share breaks and exactly ONE OG
 * implementation remains. Only strict uuids are redirected; anything else
 * is a plain 404, never echoed into a Location header.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!UUID_RE.test(id)) {
    return new Response("Not found", { status: 404 })
  }
  const canonical = new URL(`/matches/${id}/opengraph-image`, request.url)
  return Response.redirect(canonical, 308)
}
