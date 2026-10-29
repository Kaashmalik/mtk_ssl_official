import { adsensePublisherId } from "@/lib/adsense"

/**
 * /ads.txt (IAB Authorized Digital Sellers): declares Google as the only
 * authorized seller of this site's ad inventory. Generated from the same
 * env var as the ad script so the two can never disagree. Without a
 * configured publisher id it is a plain 404, never a redirect.
 * f08c47fec0942fa0 is Google's published certification authority id.
 */
export function GET(): Response {
  const publisherId = adsensePublisherId()
  if (!publisherId) {
    return new Response("Not found\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } })
  }
  return new Response(`google.com, ${publisherId}, DIRECT, f08c47fec0942fa0\n`, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  })
}
