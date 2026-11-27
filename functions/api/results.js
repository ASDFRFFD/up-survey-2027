/**
 * Cloudflare Pages Function: GET /api/results?ac=175
 * Reads only 2 pre-aggregated Firestore documents (up_summary + seats/by_id/{ac})
 * and caches at Cloudflare Edge for 15 seconds.
 */

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const acNo = Number(url.searchParams.get('ac'));

  if (!Number.isInteger(acNo) || acNo < 1 || acNo > 403) {
    return new Response(JSON.stringify({ error: 'Invalid ac parameter (1-403)' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // TODO (Production wiring):
  // Fetch Firestore REST docs:
  // - aggregates/up_summary
  // - aggregates/seats/by_id/${acNo}
  // Return with Cache-Control: public, s-maxage=15, stale-while-revalidate=30

  return new Response(
    JSON.stringify({
      acNo,
      configured: Boolean(env.FIREBASE_PROJECT_ID),
      message: 'Results endpoint skeleton ready for Firebase wiring.',
    }),
    {
      status: 501,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30',
      },
    }
  );
}
