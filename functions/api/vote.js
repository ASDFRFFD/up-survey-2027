/**
 * Cloudflare Pages Function: POST /api/vote
 * Handles Turnstile verification, rate limiting, and atomic Firestore aggregate updates.
 *
 * Required Environment Variables (Cloudflare Pages Settings):
 * - TURNSTILE_SECRET_KEY
 * - RATE_LIMIT_SALT
 * - FIREBASE_PROJECT_ID
 * - FIREBASE_CLIENT_EMAIL
 * - FIREBASE_PRIVATE_KEY
 */

const VALID_ISSUES = new Set([
  'rozgar', 'mehangai', 'sadak_bijli', 'shiksha', 'swasthya', 'kanoon', 'kisan',
]);
const VALID_OPTIONS = new Set([
  'nda', 'sp_inc', 'spm', 'bsp', 'other_ind', 'undecided', 'nota',
]);
const VALID_AGES = new Set(['18-25', '26-40', '41-60', '60+']);

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function verifyTurnstile(token, ip, secretKey) {
  if (!secretKey) return true; // Skip only in local unconfigured dev
  if (!token) return false;
  const form = new URLSearchParams();
  form.set('secret', secretKey);
  form.set('response', token);
  if (ip) form.set('remoteip', ip);

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form,
  });
  const data = await res.json();
  return Boolean(data?.success);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON payload' }, 400);
  }

  const acNo = Number(body?.acNo);
  const districtId = String(body?.districtId || '');
  const issueId = String(body?.issueId || '');
  const optionId = String(body?.optionId || '');
  const ageGroup = body?.ageGroup ? String(body.ageGroup) : null;

  if (!Number.isInteger(acNo) || acNo < 1 || acNo > 403) {
    return jsonResponse({ error: 'Invalid constituency number' }, 400);
  }
  if (!districtId || !VALID_ISSUES.has(issueId) || !VALID_OPTIONS.has(optionId)) {
    return jsonResponse({ error: 'Invalid survey selection' }, 400);
  }
  if (ageGroup !== null && !VALID_AGES.has(ageGroup)) {
    return jsonResponse({ error: 'Invalid age group' }, 400);
  }

  const clientIp = request.headers.get('CF-Connecting-IP') || '';
  const turnstileOk = await verifyTurnstile(body?.turnstileToken, clientIp, env.TURNSTILE_SECRET_KEY);
  if (!turnstileOk) {
    return jsonResponse({ error: 'Bot verification failed' }, 403);
  }

  // TODO (Production wiring):
  // 1. Check KV rate limit: key = sha256(clientIp + UA + dayBucket + env.RATE_LIMIT_SALT)
  // 2. Mint short-lived Google OAuth2 JWT using FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY
  // 3. Call Firestore REST `:commit` with fieldTransforms (increment: 1) on:
  //    - projects/{id}/databases/(default)/documents/aggregates/up_summary
  //    - projects/{id}/databases/(default)/documents/aggregates/seats/by_id/{acNo}
  //    - create votes/{voteId} anonymized log
  // 4. Return fresh { seat, state } aggregates

  return jsonResponse({
    error: 'Backend not yet wired. Keep CONFIG.mode = "demo" or configure Firebase + Turnstile env vars.',
  }, 501);
}
