(function () {
  const { CONFIG } = window.UP_SURVEY;
  const RAW_DATA = window.UP_CONSTITUENCIES;
  const STORAGE_ADMIN_KEY = 'up_survey_v3_admin_session';

  const root = document.getElementById('adminRoot');
  const statusPill = document.getElementById('adminStatusPill');
  const signOutBtn = document.getElementById('adminSignOutBtn');
  const toastEl = document.getElementById('toast');

  const distMap = new Map(RAW_DATA.districts.map((d) => [d.id, d]));
  const seatMap = new Map(RAW_DATA.seats.map((s) => [s.ac, s]));
  const optMap = new Map(CONFIG.pollOptions.map((o) => [o.id, o]));
  const issueMap = new Map(CONFIG.issues.map((i) => [i.id, i]));

  const ADMIN_PALETTE = [
    '#EA580C',
    '#F59E0B',
    '#FACC15',
    '#FB923C',
    '#D97706',
    '#64748B',
    '#CBD5E1',
  ];

  const state = {
    session: null, // { uid, email, idToken, refreshToken, expiresAt }
    isAdmin: false,
    loading: false,
    tab: 'overview', // 'overview' | 'seats' | 'districts' | 'votes' | 'controls'
    search: '',
    sortBy: 'votes_desc',
    inspectAc: null,
    inspectDistId: null,
    summary: null,
    seatsAgg: {},
    votes: {},
    surveyConfig: { paused: false, announcement: '' },
  };

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { toastEl.hidden = true; }, 2600);
  }

  function rtdbBase() {
    return `${CONFIG.firebase.databaseURL.replace(/\/$/, '')}/${CONFIG.firebase.rootPath}`;
  }

  function loadStoredSession() {
    try {
      const raw = localStorage.getItem(STORAGE_ADMIN_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveSession(s) {
    state.session = s;
    try {
      if (s) localStorage.setItem(STORAGE_ADMIN_KEY, JSON.stringify(s));
      else localStorage.removeItem(STORAGE_ADMIN_KEY);
    } catch {
      // ignore
    }
  }

  async function ensureValidToken() {
    const s = state.session;
    if (!s) throw new Error('Not signed in');
    if (s.expiresAt > Date.now() + 60000) return s.idToken;
    if (!s.refreshToken) throw new Error('Session expired');

    const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(CONFIG.firebase.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: s.refreshToken }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || 'Refresh failed');
    saveSession({
      ...s,
      idToken: data.id_token,
      refreshToken: data.refresh_token || s.refreshToken,
      expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
    });
    return state.session.idToken;
  }

  async function signInWithEmailPassword(email, password) {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(CONFIG.firebase.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      }
    );
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error?.message || 'Invalid credentials');
    }
    const session = {
      uid: data.localId,
      email: data.email,
      idToken: data.idToken,
      refreshToken: data.refreshToken,
      expiresAt: Date.now() + Number(data.expiresIn || 3600) * 1000,
    };
    saveSession(session);
    return session;
  }

  async function checkIsAdmin() {
    const tok = await ensureValidToken();
    const res = await fetch(`${rtdbBase()}/admins/${encodeURIComponent(state.session.uid)}.json?auth=${encodeURIComponent(tok)}`);
    if (!res.ok) return false;
    const val = await res.json();
    return val === true;
  }

  async function loadAllDashboardData() {
    state.loading = true;
    render();
    try {
      const tok = await ensureValidToken();
      state.isAdmin = await checkIsAdmin();
      if (!state.isAdmin) {
        state.loading = false;
        render();
        return;
      }

      const [sumRes, seatsRes, votesRes, cfgRes] = await Promise.all([
        fetch(`${rtdbBase()}/aggregates/up_summary.json?auth=${encodeURIComponent(tok)}`),
        fetch(`${rtdbBase()}/aggregates/seats.json?auth=${encodeURIComponent(tok)}`),
        fetch(`${rtdbBase()}/votes.json?auth=${encodeURIComponent(tok)}`),
        fetch(`${rtdbBase()}/config.json`),
      ]);

      state.summary = (sumRes.ok ? await sumRes.json() : null) || {};
      state.seatsAgg = (seatsRes.ok ? await seatsRes.json() : null) || {};
      state.votes = (votesRes.ok ? await votesRes.json() : null) || {};
      state.surveyConfig = (cfgRes.ok ? await cfgRes.json() : null) || { paused: false, announcement: '' };
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Load error');
    } finally {
      state.loading = false;
      render();
    }
  }

  function topKey(mapObj) {
    if (!mapObj) return null;
    let bestK = null;
    let bestV = 0;
    Object.entries(mapObj).forEach(([k, v]) => {
      const n = Number(v) || 0;
      if (n > bestV) {
        bestV = n;
        bestK = k;
      }
    });
    return bestK ? { key: bestK, count: bestV } : null;
  }

  function csvEscape(v) {
    const str = String(v ?? '');
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  }

  function downloadCsv(filename, rows) {
    const csv = '\uFEFF' + rows.map((r) => r.map(csvEscape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportSeatsCsv() {
    const header = ['AC_No', 'Seat_EN', 'Seat_HI', 'Reservation', 'District_EN', 'District_HI', 'Total_Votes', 'Leading_Option', 'Leading_Pct', 'Top_Issue'];
    const rows = [header];
    RAW_DATA.seats.forEach((s) => {
      const dist = distMap.get(s.d);
      const agg = state.seatsAgg[String(s.ac)] || {};
      const total = Number(agg.totalVotes) || 0;
      const topOpt = topKey(agg.options);
      const topIss = topKey(agg.issues);
      const pct = total && topOpt ? Math.round((topOpt.count / total) * 100) : 0;
      rows.push([
        s.ac,
        s.en,
        s.hi,
        s.res || 'GEN',
        dist?.en || '',
        dist?.hi || '',
        total,
        topOpt ? (optMap.get(topOpt.key)?.hi || topOpt.key) : '',
        `${pct}%`,
        topIss ? (issueMap.get(topIss.key)?.hi || topIss.key) : '',
      ]);
    });
    downloadCsv('up-403-seats-summary.csv', rows);
    showToast('403 Seats CSV downloaded');
  }

  function exportDistrictsCsv() {
    const distAgg = computeDistrictAggregates();
    const header = ['District_EN', 'District_HI', 'Total_Seats', 'Active_Seats', 'Total_Votes', 'Leading_Option', 'Leading_Pct'];
    const rows = [header];
    RAW_DATA.districts.forEach((d) => {
      const agg = distAgg.get(d.id);
      const total = agg.totalVotes;
      const topOpt = topKey(agg.options);
      const pct = total && topOpt ? Math.round((topOpt.count / total) * 100) : 0;
      rows.push([
        d.en,
        d.hi,
        d.count,
        agg.activeSeats,
        total,
        topOpt ? (optMap.get(topOpt.key)?.hi || topOpt.key) : '',
        `${pct}%`,
      ]);
    });
    downloadCsv('up-75-districts-summary.csv', rows);
    showToast('75 Districts CSV downloaded');
  }

  function exportVotesCsv() {
    const header = ['Vote_UID', 'AC_No', 'Seat_HI', 'District_HI', 'Option_HI', 'Issue_HI', 'Age_Group', 'Timestamp_ISO'];
    const rows = [header];
    Object.entries(state.votes || {}).forEach(([uid, v]) => {
      const s = seatMap.get(Number(v.acNo));
      const d = distMap.get(v.districtId);
      rows.push([
        uid,
        v.acNo,
        s?.hi || '',
        d?.hi || '',
        optMap.get(v.optionId)?.hi || v.optionId,
        issueMap.get(v.issueId)?.hi || v.issueId,
        v.ageGroup || '',
        v.ts ? new Date(v.ts).toISOString() : '',
      ]);
    });
    downloadCsv('up-votes-audit.csv', rows);
    showToast('Raw Vote Logs CSV downloaded');
  }

  function computeDistrictAggregates() {
    const map = new Map();
    RAW_DATA.districts.forEach((d) => {
      map.set(d.id, { totalVotes: 0, activeSeats: 0, options: {}, issues: {} });
    });
    RAW_DATA.seats.forEach((s) => {
      const agg = state.seatsAgg[String(s.ac)];
      if (!agg || !agg.totalVotes) return;
      const bucket = map.get(s.d);
      if (!bucket) return;
      const tv = Number(agg.totalVotes) || 0;
      if (tv > 0) bucket.activeSeats += 1;
      bucket.totalVotes += tv;
      Object.entries(agg.options || {}).forEach(([k, v]) => {
        bucket.options[k] = (bucket.options[k] || 0) + (Number(v) || 0);
      });
      Object.entries(agg.issues || {}).forEach(([k, v]) => {
        bucket.issues[k] = (bucket.issues[k] || 0) + (Number(v) || 0);
      });
    });
    return map;
  }

  async function saveSurveyConfig(paused, announcement) {
    const tok = await ensureValidToken();
    const payload = { paused: Boolean(paused), announcement: String(announcement || '').trim() };
    const res = await fetch(`${rtdbBase()}/config.json?auth=${encodeURIComponent(tok)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('Failed to save config');
    state.surveyConfig = payload;
    showToast('Live survey controls updated!');
    render();
  }

  async function recalculateAggregatesFromVotes() {
    const tok = await ensureValidToken();
    const votesRes = await fetch(`${rtdbBase()}/votes.json?auth=${encodeURIComponent(tok)}`);
    if (!votesRes.ok) throw new Error('Failed to read votes');
    const votesObj = (await votesRes.json()) || {};

    const upSummary = { totalVotes: 0, options: {}, issues: {}, ages: {} };
    const seats = {};

    Object.values(votesObj).forEach((v) => {
      const acKey = String(v.acNo);
      if (!seats[acKey]) seats[acKey] = { totalVotes: 0, options: {}, issues: {}, ages: {} };
      [upSummary, seats[acKey]].forEach((b) => {
        b.totalVotes += 1;
        b.options[v.optionId] = (b.options[v.optionId] || 0) + 1;
        b.issues[v.issueId] = (b.issues[v.issueId] || 0) + 1;
        const age = v.ageGroup || 'skipped';
        b.ages[age] = (b.ages[age] || 0) + 1;
      });
    });

    const putRes = await fetch(`${rtdbBase()}/aggregates.json?auth=${encodeURIComponent(tok)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ up_summary: upSummary, seats }),
    });
    if (!putRes.ok) throw new Error('Failed to write recalculated aggregates');
    showToast('Aggregates recalculated cleanly!');
    await loadAllDashboardData();
  }

  async function deleteVoteAndRecompute(uid) {
    const tok = await ensureValidToken();
    const res = await fetch(`${rtdbBase()}/votes/${encodeURIComponent(uid)}.json?auth=${encodeURIComponent(tok)}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Delete failed');
    await recalculateAggregatesFromVotes();
  }

  async function resetAllSurveyData() {
    const tok = await ensureValidToken();
    const [r1, r2] = await Promise.all([
      fetch(`${rtdbBase()}/votes.json?auth=${encodeURIComponent(tok)}`, { method: 'DELETE' }),
      fetch(`${rtdbBase()}/aggregates.json?auth=${encodeURIComponent(tok)}`, { method: 'DELETE' }),
    ]);
    if (!r1.ok || !r2.ok) throw new Error('Reset failed');
    showToast('All survey votes & aggregates cleared!');
    await loadAllDashboardData();
  }

  function formatAuthError(code) {
    const msg = String(code || '').toUpperCase();
    if (msg.includes('INVALID_LOGIN_CREDENTIALS') || msg.includes('INVALID_PASSWORD') || msg.includes('EMAIL_NOT_FOUND')) {
      return 'गलत ईमेल या पासवर्ड — कृपया जांच कर दोबारा प्रयास करें। (Invalid email or password)';
    }
    if (msg.includes('INVALID_EMAIL')) {
      return 'कृपया सही ईमेल पता दर्ज करें। (Invalid email address)';
    }
    if (msg.includes('TOO_MANY_ATTEMPTS')) {
      return 'बहुत अधिक प्रयास हुए — कृपया कुछ देर बाद प्रयास करें।';
    }
    if (msg.includes('USER_DISABLED')) {
      return 'यह Admin अकाउंट Firebase Console से अक्षम (Disabled) है।';
    }
    return code || 'लॉगिन विफल रहा। कृपया दोबारा कोशिश करें।';
  }

  function renderLoginCard() {
    statusPill.textContent = 'Admin Login';
    signOutBtn.hidden = true;
    root.innerHTML = `
      <section class="card admin-login-card">
        <div class="admin-login-brand">
          <div>
            <div class="splash-badge" style="margin:0;">
              <span class="splash-pulse" aria-hidden="true"></span>
              <span>UP 2027 Command Center</span>
            </div>
            <h1 class="admin-brand-title">उत्तर प्रदेश जनमत सर्वे — Admin</h1>
            <p class="admin-brand-sub">सभी 75 ज़िलों और 403 विधानसभा सीटों के लाइव आंकड़े, CSV रिपोर्ट्स और सर्वे नियंत्रण एक जगह।</p>

            <ul class="admin-features-list">
              <li>
                <span class="admin-feat-icon" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></svg>
                </span>
                <span>All-UP 403 सीट व ज़िलेवार लाइव एनालिटिक्स</span>
              </li>
              <li>
                <span class="admin-feat-icon" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </span>
                <span>1-क्लिक Excel CSV रिपोर्ट डाउनलोड</span>
              </li>
              <li>
                <span class="admin-feat-icon" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                </span>
                <span>स्पैम वोट ऑडिट, Pause व Notice नियंत्रण</span>
              </li>
            </ul>
          </div>

          <div class="admin-sec-badge">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            <span>Firebase Auth + UID Whitelist Protected</span>
          </div>
        </div>

        <div class="admin-login-pane">
          <h2 class="admin-login-heading">Admin साइन-इन</h2>
          <p class="admin-login-desc">अपने Firebase Admin ईमेल और पासवर्ड से लॉगिन करें।</p>

          <form id="adminLoginForm" class="admin-form">
            <div id="loginErrorBox" class="admin-error-box" hidden></div>

            <div class="admin-field">
              <label for="adminEmail">Admin ईमेल (Email)</label>
              <div class="admin-input-wrap">
                <span class="admin-input-icon" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                </span>
                <input id="adminEmail" type="email" autocomplete="email" class="admin-input" required placeholder="admin@example.com" />
              </div>
            </div>

            <div class="admin-field">
              <label for="adminPassword">पासवर्ड (Password)</label>
              <div class="admin-input-wrap">
                <span class="admin-input-icon" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                </span>
                <input id="adminPassword" type="password" autocomplete="current-password" class="admin-input" required placeholder="अपना पासवर्ड लिखें" />
                <button type="button" id="togglePwBtn" class="admin-pw-toggle" aria-label="Show or hide password">
                  <svg id="pwEyeIcon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                </button>
              </div>
            </div>

            <button type="submit" id="loginSubmitBtn" class="btn-primary" style="margin-top:4px;">सुरक्षित लॉगिन करें →</button>
          </form>

          <p class="admin-login-foot">पासवर्ड भूलने या नया Admin जोड़ने के लिए Firebase Console → Authentication → Users का उपयोग करें।</p>
        </div>
      </section>
    `;

    const pwInput = document.getElementById('adminPassword');
    document.getElementById('togglePwBtn').addEventListener('click', () => {
      const showing = pwInput.type === 'text';
      pwInput.type = showing ? 'password' : 'text';
    });

    document.getElementById('adminLoginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('loginSubmitBtn');
      const errBox = document.getElementById('loginErrorBox');
      const email = document.getElementById('adminEmail').value.trim();
      const pass = pwInput.value;
      errBox.hidden = true;
      btn.disabled = true;
      btn.textContent = 'साइन-इन हो रहा है...';
      try {
        await signInWithEmailPassword(email, pass);
        await loadAllDashboardData();
      } catch (err) {
        errBox.textContent = formatAuthError(err.message);
        errBox.hidden = false;
        btn.disabled = false;
        btn.textContent = 'सुरक्षित लॉगिन करें →';
      }
    });
  }

  function renderNotAuthorizedCard() {
    statusPill.textContent = 'UID Setup Needed';
    signOutBtn.hidden = false;
    const uid = state.session.uid;
    root.innerHTML = `
      <section class="card">
        <p class="card-eyebrow">One-Time Admin UID Whitelist</p>
        <h1 class="card-title">लॉगिन सफल, अब अपना UID Admin लिस्ट में जोड़ें</h1>
        <p class="card-subtitle">सुरक्षा के लिए सिर्फ Firebase Console से whitelisted UID ही Admin डेटा देख सकता है।</p>

        <div class="admin-uid-box">
          <span>Logged in: <strong>${escapeHtml(state.session.email)}</strong></span>
          <code>${escapeHtml(uid)}</code>
          <button type="button" id="copyUidBtn" class="invite-use-btn">Copy UID</button>
        </div>

        <ol class="admin-setup-steps">
          <li>Firebase Console → <strong>Realtime Database → Data</strong> खोलें।</li>
          <li><code>up_survey_2027</code> के अंदर <code>admins</code> नोड जोड़ें (या एडिट करें)।</li>
          <li>उसमें key = <code>${escapeHtml(uid)}</code> और value = <code>true</code> (boolean) सेव करें।</li>
          <li>नीचे <strong>Verify Admin Access</strong> पर क्लिक करें।</li>
        </ol>

        <div class="card-actions">
          <button type="button" id="recheckAdminBtn" class="btn-primary">Verify Admin Access →</button>
        </div>
      </section>
    `;

    document.getElementById('copyUidBtn').addEventListener('click', async () => {
      await navigator.clipboard.writeText(uid);
      showToast('Admin UID copied!');
    });
    document.getElementById('recheckAdminBtn').addEventListener('click', () => loadAllDashboardData());
  }

  function sortedMetricRows(items, countsMap, total) {
    return items
      .map((item) => {
        const count = Number(countsMap?.[item.id]) || 0;
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        return { item, count, pct };
      })
      .sort((a, b) => b.count - a.count);
  }

  function renderMiniRingSvg(count, total) {
    const pct = total > 0 ? Math.min(100, Math.round((count / total) * 100)) : 0;
    const r = 15;
    const c = 2 * Math.PI * r;
    const dash = (pct / 100) * c;
    return `
      <span class="kpi-ring-wrap" title="${pct}% coverage">
        <svg class="kpi-ring-svg" width="40" height="40" viewBox="0 0 38 38" aria-hidden="true">
          <circle cx="19" cy="19" r="${r}" fill="none" stroke="#fde68a" stroke-width="4" />
          <circle cx="19" cy="19" r="${r}" fill="none" stroke="#ea580c" stroke-width="4" stroke-linecap="round"
            stroke-dasharray="${dash.toFixed(2)} ${(c - dash).toFixed(2)}" transform="rotate(-90 19 19)" />
        </svg>
        <span class="kpi-ring-pct">${pct}%</span>
      </span>`;
  }

  function renderStackedStrip(items, countsMap, total, compact = false) {
    if (!total) {
      return `<div class="stacked-strip ${compact ? 'is-compact' : ''} is-empty"></div>`;
    }
    const rows = sortedMetricRows(items, countsMap, total).filter((r) => r.count > 0);
    return `
      <div class="stacked-strip ${compact ? 'is-compact' : ''}">
        ${rows
          .map((row, idx) => {
            const width = ((row.count / total) * 100).toFixed(2);
            const color = ADMIN_PALETTE[idx % ADMIN_PALETTE.length];
            return `<span class="stacked-seg" style="width:${width}%;background:${color};" title="${escapeHtml(row.item.hi)}: ${row.pct}% (${row.count})"></span>`;
          })
          .join('')}
      </div>`;
  }

  function renderAdminDonut(items, countsMap, total, centerLabel) {
    if (!total) {
      return `<p class="card-subtitle" style="margin:0;">अभी कोई वोट दर्ज नहीं है।</p>`;
    }
    const rows = sortedMetricRows(items, countsMap, total);
    const r = 64;
    const circumference = 2 * Math.PI * r;
    let offset = 0;

    const segments = rows
      .filter((row) => row.count > 0)
      .map((row, idx) => {
        const segLen = (row.count / total) * circumference;
        const color = ADMIN_PALETTE[idx % ADMIN_PALETTE.length];
        const circleSvg = `<circle cx="90" cy="90" r="${r}" fill="none" stroke="${color}" stroke-width="26"
          stroke-dasharray="${segLen.toFixed(2)} ${(circumference - segLen).toFixed(2)}"
          stroke-dashoffset="${(-offset).toFixed(2)}" />`;
        offset += segLen;
        return circleSvg;
      });

    return `
      ${renderStackedStrip(items, countsMap, total, false)}
      <div class="donut-layout" style="margin-bottom:0;margin-top:10px;">
        <div class="donut-wrap">
          <svg class="donut-svg" viewBox="0 0 180 180" role="img" aria-label="Opinion breakdown">
            <circle cx="90" cy="90" r="${r}" fill="none" stroke="#f3f0ea" stroke-width="26" />
            ${segments.join('')}
          </svg>
          <div class="donut-center">
            <span class="donut-center-num">${total}</span>
            <span class="donut-center-label">${escapeHtml(centerLabel)}</span>
          </div>
        </div>
        <div class="donut-legend">
          ${rows
            .map((row, idx) => {
              const color = row.count > 0 ? ADMIN_PALETTE[idx % ADMIN_PALETTE.length] : '#e5e7eb';
              return `
                <div class="legend-item ${idx === 0 && row.count > 0 ? 'is-pick' : ''}">
                  <span class="legend-left">
                    <span class="legend-swatch" style="background:${color};"></span>
                    ${row.item.avatar ? `<img class="mini-avatar" src="${escapeHtml(row.item.avatar)}" alt="" />` : ''}
                    <span class="legend-name">${escapeHtml(row.item.hi)}</span>
                  </span>
                  <span class="legend-pct">${row.pct}% (${row.count})</span>
                </div>`;
            })
            .join('')}
        </div>
      </div>`;
  }

  function renderAdminRankedBars(items, countsMap, total) {
    if (!total) {
      return `<p class="card-subtitle" style="margin:0;">अभी कोई डेटा दर्ज नहीं है।</p>`;
    }
    const rows = sortedMetricRows(items, countsMap, total);
    return `
      <div class="bar-list">
        ${rows
          .map(
            ({ item, count, pct }, idx) => `
          <div class="bar-row">
            <div class="bar-header">
              <span class="bar-label ${idx === 0 && count > 0 ? 'user-pick' : ''}">
                <span class="bar-rank">#${idx + 1}</span>
                <span>${escapeHtml(item.hi)}</span>
              </span>
              <span class="bar-pct ${idx === 0 && count > 0 ? 'is-top' : ''}">${pct}% (${count})</span>
            </div>
            <div class="bar-track"><div class="bar-fill ${idx === 0 ? 'primary' : ''}" style="width:${pct}%;"></div></div>
          </div>`
          )
          .join('')}
      </div>`;
  }

  function renderAdminAgeColumns(agesMap, total) {
    if (!total) {
      return `<p class="card-subtitle" style="margin:0;">अभी कोई डेटा दर्ज नहीं है।</p>`;
    }
    const skipped = Number(agesMap?.skipped) || 0;
    return `
      <div class="col-chart" role="img" aria-label="Age group breakdown">
        ${CONFIG.ageGroups
          .map((item) => {
            const count = Number(agesMap?.[item.id]) || 0;
            const pct = total > 0 ? Math.round((count / total) * 100) : 0;
            return `
              <div class="col-item ${count > 0 ? 'is-pick' : ''}">
                <span class="col-pct">${pct}%</span>
                <div class="col-track">
                  <div class="col-pillar ${count > 0 ? 'is-pick' : ''}" style="height:${Math.max(pct, 4)}%;"></div>
                </div>
                <span class="col-label">${escapeHtml(item.id)} (${count})</span>
              </div>`;
          })
          .join('')}
      </div>
      ${skipped ? `<p class="admin-dist-sub" style="margin-top:8px;">आयु स्किप करने वाले वोट: ${skipped}</p>` : ''}`;
  }

  function renderTopDistrictsBars() {
    const distAgg = computeDistrictAggregates();
    const active = RAW_DATA.districts
      .map((d) => ({ d, agg: distAgg.get(d.id) }))
      .filter((x) => x.agg.totalVotes > 0)
      .sort((a, b) => b.agg.totalVotes - a.agg.totalVotes)
      .slice(0, 8);

    if (!active.length) {
      return `<p class="card-subtitle" style="margin:0;">वोट आते ही शीर्ष सक्रिय ज़िले यहाँ ग्राफ़ में दिखेंगे।</p>`;
    }
    const maxV = active[0].agg.totalVotes || 1;
    return `
      <div class="bar-list">
        ${active
          .map(({ d, agg }, idx) => {
            const relW = Math.max(6, Math.round((agg.totalVotes / maxV) * 100));
            const top = topKey(agg.options);
            const leadName = top ? (optMap.get(top.key)?.hi || top.key) : '—';
            const leadPct = top && agg.totalVotes ? Math.round((top.count / agg.totalVotes) * 100) : 0;
            return `
              <div class="bar-row">
                <div class="bar-header">
                  <span class="bar-label">
                    <span class="bar-rank">#${idx + 1}</span>
                    <span>${escapeHtml(d.hi)} <small class="admin-dist-sub">(${agg.activeSeats}/${d.count} सीट • ${escapeHtml(leadName)} ${leadPct}%)</small></span>
                  </span>
                  <span class="bar-pct ${idx === 0 ? 'is-top' : ''}">${agg.totalVotes} वोट</span>
                </div>
                <div class="bar-track"><div class="bar-fill ${idx === 0 ? 'primary' : ''}" style="width:${relW}%;"></div></div>
              </div>`;
          })
          .join('')}
      </div>`;
  }

  function renderDashboard() {
    statusPill.textContent = state.surveyConfig?.paused ? 'Survey Paused' : 'Live Admin';
    signOutBtn.hidden = false;

    const totalVotes = Number(state.summary?.totalVotes) || 0;
    const seatKeys = Object.keys(state.seatsAgg || {}).filter((k) => Number(state.seatsAgg[k]?.totalVotes) > 0);
    const activeDists = new Set(seatKeys.map((ac) => seatMap.get(Number(ac))?.d).filter(Boolean));
    const topOpt = topKey(state.summary?.options);
    const topIss = topKey(state.summary?.issues);
    const topPct = totalVotes && topOpt ? Math.round((topOpt.count / totalVotes) * 100) : 0;

    let tabBody = '';
    if (state.tab === 'overview') {
      tabBody = renderOverviewTab(totalVotes);
    } else if (state.tab === 'seats') {
      tabBody = renderSeatsTab();
    } else if (state.tab === 'districts') {
      tabBody = renderDistrictsTab();
    } else if (state.tab === 'votes') {
      tabBody = renderVotesAuditTab();
    } else {
      tabBody = renderControlsTab();
    }

    root.innerHTML = `
      <section class="card admin-panel-card">
        <div class="admin-header-row">
          <div>
            <p class="card-eyebrow">All-UP Visual Analytics & Control</p>
            <h1 class="card-title">उत्तर प्रदेश 403 सीटें — Smart Admin Dashboard</h1>
          </div>
          <div class="admin-export-row">
            <button type="button" id="refreshBtn" class="btn-back">↻ Refresh</button>
            <button type="button" id="exportSeatsBtn" class="invite-use-btn">⬇ 403 Seats CSV</button>
            <button type="button" id="exportDistBtn" class="invite-use-btn">⬇ 75 Districts CSV</button>
          </div>
        </div>

        <div class="kpi-grid admin-kpi-grid">
          <div class="kpi-card">
            <span class="kpi-label">कुल लाइव वोट</span>
            <span class="kpi-value">${totalVotes}</span>
            <span class="admin-dist-sub">${topIss ? `मुद्दा: ${escapeHtml(issueMap.get(topIss.key)?.hi || '')}` : 'रियल-टाइम डेटा'}</span>
          </div>
          <div class="kpi-card kpi-card--ring">
            ${renderMiniRingSvg(seatKeys.length, 403)}
            <div>
              <span class="kpi-label">सक्रिय सीटें</span>
              <span class="kpi-value">${seatKeys.length} / 403</span>
            </div>
          </div>
          <div class="kpi-card kpi-card--ring">
            ${renderMiniRingSvg(activeDists.size, 75)}
            <div>
              <span class="kpi-label">सक्रिय ज़िले</span>
              <span class="kpi-value">${activeDists.size} / 75</span>
            </div>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">शीर्ष प्राथमिकता</span>
            <span class="kpi-value">${topOpt ? `${escapeHtml(optMap.get(topOpt.key)?.hi || topOpt.key)} (${topPct}%)` : '—'}</span>
          </div>
        </div>

        <div class="admin-tabs" role="tablist">
          <button type="button" class="admin-tab ${state.tab === 'overview' ? 'active' : ''}" data-admin-tab="overview">Visual Graphs</button>
          <button type="button" class="admin-tab ${state.tab === 'seats' ? 'active' : ''}" data-admin-tab="seats">403 Seats</button>
          <button type="button" class="admin-tab ${state.tab === 'districts' ? 'active' : ''}" data-admin-tab="districts">75 Districts</button>
          <button type="button" class="admin-tab ${state.tab === 'votes' ? 'active' : ''}" data-admin-tab="votes">Vote Audit (${Object.keys(state.votes || {}).length})</button>
          <button type="button" class="admin-tab ${state.tab === 'controls' ? 'active' : ''}" data-admin-tab="controls">Controls & Reset</button>
        </div>

        ${tabBody}
      </section>
    `;

    bindDashboardEvents();
  }

  function renderOverviewTab(totalVotes) {
    return `
      <div class="admin-charts-grid">
        <div class="metric-section">
          <h2 class="metric-heading"><span>All-UP जनमत शेयर</span><span class="metric-tag">सर्किल ग्राफ़</span></h2>
          ${renderAdminDonut(CONFIG.pollOptions, state.summary?.options, totalVotes, 'कुल वोट')}
        </div>

        <div class="metric-section">
          <h2 class="metric-heading"><span>All-UP मुख्य मुद्दे (रैंकिंग)</span><span class="metric-tag">बार ग्राफ़</span></h2>
          ${renderAdminRankedBars(CONFIG.issues, state.summary?.issues, totalVotes)}
        </div>

        <div class="metric-section">
          <h2 class="metric-heading"><span>आयु वर्ग वितरण</span><span class="metric-tag">कॉलम ग्राफ़</span></h2>
          ${renderAdminAgeColumns(state.summary?.ages, totalVotes)}
        </div>

        <div class="metric-section">
          <h2 class="metric-heading"><span>शीर्ष सक्रिय ज़िले (वोट संख्या)</span><span class="metric-tag">ज़िला तुलना</span></h2>
          ${renderTopDistrictsBars()}
        </div>
      </div>
    `;
  }

  function renderSeatsTab() {
    const q = state.search.trim().toLowerCase();
    let rows = RAW_DATA.seats.map((s) => {
      const dist = distMap.get(s.d);
      const agg = state.seatsAgg[String(s.ac)] || {};
      const total = Number(agg.totalVotes) || 0;
      const topOpt = topKey(agg.options);
      const topIss = topKey(agg.issues);
      const pct = total && topOpt ? Math.round((topOpt.count / total) * 100) : 0;
      return { s, dist, agg, total, topOpt, topIss, pct };
    });

    if (q) {
      rows = rows.filter(
        ({ s, dist }) =>
          s.en.toLowerCase().includes(q) ||
          s.hi.toLowerCase().includes(q) ||
          String(s.ac) === q ||
          (dist && (dist.en.toLowerCase().includes(q) || dist.hi.toLowerCase().includes(q)))
      );
    }

    if (state.sortBy === 'votes_desc') {
      rows.sort((a, b) => b.total - a.total || a.s.ac - b.s.ac);
    } else {
      rows.sort((a, b) => a.s.ac - b.s.ac);
    }

    let inspectorHtml = '';
    if (state.inspectAc && seatMap.has(state.inspectAc)) {
      const s = seatMap.get(state.inspectAc);
      const d = distMap.get(s.d);
      const agg = state.seatsAgg[String(s.ac)] || {};
      const total = Number(agg.totalVotes) || 0;
      inspectorHtml = `
        <div class="admin-inspector-card">
          <div class="admin-inspector-head">
            <div>
              <p class="card-eyebrow" style="margin-bottom:2px;">विधानसभा ग्राफ़ विश्लेषण</p>
              <h3 class="metric-heading" style="margin:0;">#${s.ac} ${escapeHtml(s.hi)} (${escapeHtml(d?.hi || '')}) — ${total} वोट</h3>
            </div>
            <button type="button" id="closeInspectorBtn" class="admin-close-btn">✕ बंद करें</button>
          </div>
          <div class="admin-charts-grid">
            <div>${renderAdminDonut(CONFIG.pollOptions, agg.options, total, 'सीट वोट')}</div>
            <div>${renderAdminRankedBars(CONFIG.issues, agg.issues, total)}</div>
          </div>
        </div>`;
    }

    return `
      ${inspectorHtml}
      <div class="admin-toolbar">
        <input id="adminSearchInput" class="dropdown-search-input" type="text" placeholder="सीट, नंबर (174) या ज़िला खोजें..." value="${escapeHtml(state.search)}" />
        <select id="adminSortSelect" class="native-select" style="max-width:210px;">
          <option value="votes_desc" ${state.sortBy === 'votes_desc' ? 'selected' : ''}>Sort: Most Votes</option>
          <option value="ac_asc" ${state.sortBy === 'ac_asc' ? 'selected' : ''}>Sort: AC #1 → #403</option>
        </select>
      </div>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>#</th>
              <th>विधानसभा सीट</th>
              <th>ज़िला</th>
              <th>वोट</th>
              <th>ग्राफ़ ट्रेंड (लीडिंग)</th>
              <th>प्रमुख मुद्दा</th>
              <th>ग्राफ़</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map(({ s, dist, agg, total, topOpt, topIss, pct }) => `
                <tr>
                  <td><strong>${s.ac}</strong></td>
                  <td>${escapeHtml(s.hi)} ${s.res ? `<span class="seat-badge">${escapeHtml(s.res)}</span>` : ''}</td>
                  <td>${escapeHtml(dist?.hi || '')}</td>
                  <td><strong>${total}</strong></td>
                  <td style="min-width:170px;">
                    ${renderStackedStrip(CONFIG.pollOptions, agg.options, total, true)}
                    <div class="admin-dist-sub">${topOpt ? `${escapeHtml(optMap.get(topOpt.key)?.hi || topOpt.key)} (${pct}%)` : 'कोई डेटा नहीं'}</div>
                  </td>
                  <td>${topIss ? escapeHtml(issueMap.get(topIss.key)?.hi || topIss.key) : '—'}</td>
                  <td><button type="button" class="admin-graph-btn" data-inspect-ac="${s.ac}">ग्राफ़</button></td>
                </tr>`)
              .join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderDistrictsTab() {
    const distAgg = computeDistrictAggregates();
    const q = state.search.trim().toLowerCase();
    let rows = RAW_DATA.districts.map((d) => ({ d, agg: distAgg.get(d.id) }));
    if (q) {
      rows = rows.filter(({ d }) => d.en.toLowerCase().includes(q) || d.hi.toLowerCase().includes(q));
    }
    rows.sort((a, b) => b.agg.totalVotes - a.agg.totalVotes || a.d.en.localeCompare(b.d.en));

    let inspectorHtml = '';
    if (state.inspectDistId && distMap.has(state.inspectDistId)) {
      const d = distMap.get(state.inspectDistId);
      const agg = distAgg.get(d.id);
      inspectorHtml = `
        <div class="admin-inspector-card">
          <div class="admin-inspector-head">
            <div>
              <p class="card-eyebrow" style="margin-bottom:2px;">ज़िला ग्राफ़ विश्लेषण</p>
              <h3 class="metric-heading" style="margin:0;">${escapeHtml(d.hi)} (${escapeHtml(d.en)}) — ${agg.totalVotes} वोट (${agg.activeSeats}/${d.count} सीटें)</h3>
            </div>
            <button type="button" id="closeInspectorBtn" class="admin-close-btn">✕ बंद करें</button>
          </div>
          <div class="admin-charts-grid">
            <div>${renderAdminDonut(CONFIG.pollOptions, agg.options, agg.totalVotes, 'ज़िला वोट')}</div>
            <div>${renderAdminRankedBars(CONFIG.issues, agg.issues, agg.totalVotes)}</div>
          </div>
        </div>`;
    }

    return `
      ${inspectorHtml}
      <div class="admin-toolbar">
        <input id="adminSearchInput" class="dropdown-search-input" type="text" placeholder="75 ज़िलों में खोजें..." value="${escapeHtml(state.search)}" />
      </div>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>ज़िला</th>
              <th>सीटें (सक्रिय / कुल)</th>
              <th>कुल वोट</th>
              <th>ग्राफ़ ट्रेंड (लीडिंग)</th>
              <th>ग्राफ़</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map(({ d, agg }) => {
                const topOpt = topKey(agg.options);
                const pct = agg.totalVotes && topOpt ? Math.round((topOpt.count / agg.totalVotes) * 100) : 0;
                return `
                  <tr>
                    <td><strong>${escapeHtml(d.hi)}</strong> <span class="dropdown-sub">${escapeHtml(d.en)}</span></td>
                    <td>${agg.activeSeats} / ${d.count}</td>
                    <td><strong>${agg.totalVotes}</strong></td>
                    <td style="min-width:170px;">
                      ${renderStackedStrip(CONFIG.pollOptions, agg.options, agg.totalVotes, true)}
                      <div class="admin-dist-sub">${topOpt ? `${escapeHtml(optMap.get(topOpt.key)?.hi || topOpt.key)} (${pct}%)` : 'कोई डेटा नहीं'}</div>
                    </td>
                    <td><button type="button" class="admin-graph-btn" data-inspect-dist="${escapeHtml(d.id)}">ग्राफ़</button></td>
                  </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderVotesAuditTab() {
    const entries = Object.entries(state.votes || {})
      .map(([uid, v]) => ({ uid, ...v }))
      .sort((a, b) => (b.ts || 0) - (a.ts || 0));

    return `
      <div class="admin-toolbar">
        <span class="card-subtitle" style="margin:0;">Recent individual anonymous votes (latest 100 shown). Deleting a vote automatically recalculates totals.</span>
        <button type="button" id="exportVotesBtn" class="invite-use-btn">⬇ Export Votes CSV</button>
      </div>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>सीट</th>
              <th>पसंद</th>
              <th>मुद्दा</th>
              <th>आयु</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${
              entries.length
                ? entries
                    .slice(0, 100)
                    .map((v) => {
                      const s = seatMap.get(Number(v.acNo));
                      const timeStr = v.ts ? new Date(v.ts).toLocaleString('en-IN') : '—';
                      return `
                        <tr>
                          <td>${escapeHtml(timeStr)}</td>
                          <td>${v.acNo}. ${escapeHtml(s?.hi || '')}</td>
                          <td>${escapeHtml(optMap.get(v.optionId)?.hi || v.optionId)}</td>
                          <td>${escapeHtml(issueMap.get(v.issueId)?.hi || v.issueId)}</td>
                          <td>${escapeHtml(v.ageGroup || 'skipped')}</td>
                          <td><button type="button" class="admin-del-btn" data-del-uid="${escapeHtml(v.uid)}">Delete</button></td>
                        </tr>`;
                    })
                    .join('')
                : '<tr><td colspan="6" style="text-align:center;color:var(--muted);">No votes recorded yet.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    `;
  }

  function renderControlsTab() {
    return `
      <div class="metric-section">
        <h2 class="metric-heading"><span>Live Survey Status & Notice Banner</span></h2>
        <form id="controlsForm" class="admin-form">
          <label class="admin-checkbox-row">
            <input type="checkbox" id="pauseToggle" ${state.surveyConfig?.paused ? 'checked' : ''} />
            <span><strong>Pause Survey Voting</strong> (Users can still view live results, new votes temporarily paused)</span>
          </label>
          <div class="admin-field">
            <label for="noticeInput">Top Announcement Banner (optional)</label>
            <input id="noticeInput" type="text" class="dropdown-search-input" placeholder="उदाहरण: यूपी 2027 जनमत सर्वे लाइव है — अपनी विधानसभा चुनें" value="${escapeHtml(state.surveyConfig?.announcement || '')}" />
          </div>
          <button type="submit" class="btn-primary">Save Live Controls</button>
        </form>
      </div>

      <div class="metric-section">
        <h2 class="metric-heading"><span>Data Maintenance</span></h2>
        <p class="card-subtitle" style="margin-bottom:12px;">Recompute all 403 seat totals & UP summary from raw <code>/votes</code>, or wipe test votes before public launch.</p>
        <div class="admin-export-row">
          <button type="button" id="recomputeBtn" class="btn-back">↻ Recalculate Aggregates</button>
          <button type="button" id="resetAllBtn" class="admin-danger-btn">⚠ Clear All Survey Data</button>
        </div>
      </div>
    `;
  }

  function bindDashboardEvents() {
    document.getElementById('refreshBtn')?.addEventListener('click', () => loadAllDashboardData());
    document.getElementById('exportSeatsBtn')?.addEventListener('click', exportSeatsCsv);
    document.getElementById('exportDistBtn')?.addEventListener('click', exportDistrictsCsv);
    document.getElementById('exportVotesBtn')?.addEventListener('click', exportVotesCsv);

    document.querySelectorAll('[data-admin-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.tab = btn.dataset.adminTab;
        state.search = '';
        state.inspectAc = null;
        state.inspectDistId = null;
        render();
      });
    });

    document.querySelectorAll('[data-inspect-ac]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.inspectAc = Number(btn.dataset.inspectAc);
        render();
        root.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    document.querySelectorAll('[data-inspect-dist]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.inspectDistId = btn.dataset.inspectDist;
        render();
        root.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    document.getElementById('closeInspectorBtn')?.addEventListener('click', () => {
      state.inspectAc = null;
      state.inspectDistId = null;
      render();
    });

    const searchInput = document.getElementById('adminSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        state.search = e.target.value;
        render();
        const elNew = document.getElementById('adminSearchInput');
        elNew.focus();
        elNew.setSelectionRange(elNew.value.length, elNew.value.length);
      });
    }

    document.getElementById('adminSortSelect')?.addEventListener('change', (e) => {
      state.sortBy = e.target.value;
      render();
    });

    document.querySelectorAll('[data-del-uid]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this vote and recalculate totals?')) return;
        btn.disabled = true;
        try {
          await deleteVoteAndRecompute(btn.dataset.delUid);
        } catch (err) {
          showToast(err.message);
          btn.disabled = false;
        }
      });
    });

    document.getElementById('controlsForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const paused = document.getElementById('pauseToggle').checked;
      const announcement = document.getElementById('noticeInput').value;
      try {
        await saveSurveyConfig(paused, announcement);
      } catch (err) {
        showToast(err.message);
      }
    });

    document.getElementById('recomputeBtn')?.addEventListener('click', async () => {
      if (!confirm('Recalculate all UP & 403 seat aggregates from /votes?')) return;
      try {
        await recalculateAggregatesFromVotes();
      } catch (err) {
        showToast(err.message);
      }
    });

    document.getElementById('resetAllBtn')?.addEventListener('click', async () => {
      const typed = prompt('Type RESET ALL to permanently delete all votes & aggregates:');
      if (typed !== 'RESET ALL') return;
      try {
        await resetAllSurveyData();
      } catch (err) {
        showToast(err.message);
      }
    });
  }

  function render() {
    if (!state.session) {
      renderLoginCard();
      return;
    }
    if (state.loading) {
      root.innerHTML = `<div class="loading-card"><div class="spinner"></div><p>Loading Admin Data...</p></div>`;
      return;
    }
    if (!state.isAdmin) {
      renderNotAuthorizedCard();
      return;
    }
    renderDashboard();
  }

  signOutBtn.addEventListener('click', () => {
    saveSession(null);
    state.isAdmin = false;
    render();
  });

  state.session = loadStoredSession();
  if (state.session) {
    loadAllDashboardData();
  } else {
    render();
  }
})();
