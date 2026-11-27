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

  const state = {
    session: null, // { uid, email, idToken, refreshToken, expiresAt }
    isAdmin: false,
    loading: false,
    tab: 'overview', // 'overview' | 'seats' | 'districts' | 'votes' | 'controls'
    search: '',
    sortBy: 'votes_desc',
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

  function renderLoginCard() {
    statusPill.textContent = 'Admin Login';
    signOutBtn.hidden = true;
    root.innerHTML = `
      <section class="card admin-login-card">
        <p class="card-eyebrow">Admin Control • Firebase Auth</p>
        <h1 class="card-title">UP सर्वे Admin Login</h1>
        <p class="card-subtitle">All-UP 403 सीट एनालिटिक्स, CSV एक्सपोर्ट और स्पैम कंट्रोल के लिए अपने Firebase Admin Email/Password से लॉगिन करें।</p>

        <form id="adminLoginForm" class="admin-form">
          <div class="admin-field">
            <label for="adminEmail">Admin Email</label>
            <input id="adminEmail" type="email" class="dropdown-search-input" required placeholder="admin@example.com" />
          </div>
          <div class="admin-field">
            <label for="adminPassword">Password</label>
            <input id="adminPassword" type="password" class="dropdown-search-input" required placeholder="••••••••" />
          </div>
          <button type="submit" id="loginSubmitBtn" class="btn-primary">Sign In →</button>
        </form>
      </section>
    `;

    document.getElementById('adminLoginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('loginSubmitBtn');
      const email = document.getElementById('adminEmail').value.trim();
      const pass = document.getElementById('adminPassword').value;
      btn.disabled = true;
      btn.textContent = 'Signing in...';
      try {
        await signInWithEmailPassword(email, pass);
        await loadAllDashboardData();
      } catch (err) {
        showToast(err.message || 'Login failed');
        btn.disabled = false;
        btn.textContent = 'Sign In →';
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
            <p class="card-eyebrow">All-UP Control Center</p>
            <h1 class="card-title">उत्तर प्रदेश 403 सीटें — Admin Dashboard</h1>
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
          </div>
          <div class="kpi-card">
            <span class="kpi-label">सक्रिय सीटें</span>
            <span class="kpi-value">${seatKeys.length} / 403</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">सक्रिय ज़िले</span>
            <span class="kpi-value">${activeDists.size} / 75</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">शीर्ष प्राथमिकता</span>
            <span class="kpi-value">${topOpt ? `${escapeHtml(optMap.get(topOpt.key)?.hi || topOpt.key)} (${topPct}%)` : '—'}</span>
          </div>
        </div>

        <div class="admin-tabs" role="tablist">
          <button type="button" class="admin-tab ${state.tab === 'overview' ? 'active' : ''}" data-admin-tab="overview">State Overview</button>
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
    const renderMiniBars = (items, mapObj) =>
      items
        .map((it) => {
          const c = Number(mapObj?.[it.id]) || 0;
          const pct = totalVotes ? Math.round((c / totalVotes) * 100) : 0;
          return `
            <div class="bar-row">
              <div class="bar-header">
                <span class="bar-label">${escapeHtml(it.hi)}</span>
                <span class="bar-pct">${pct}% (${c})</span>
              </div>
              <div class="bar-track"><div class="bar-fill primary" style="width:${pct}%;"></div></div>
            </div>`;
        })
        .join('');

    return `
      <div class="admin-two-col">
        <div class="metric-section">
          <h2 class="metric-heading"><span>All-UP जनमत ट्रेंड</span><span class="metric-tag">${totalVotes} वोट</span></h2>
          <div class="bar-list">${renderMiniBars(CONFIG.pollOptions, state.summary?.options)}</div>
        </div>
        <div class="metric-section">
          <h2 class="metric-heading"><span>All-UP मुख्य मुद्दे</span><span class="metric-tag">7 मुद्दे</span></h2>
          <div class="bar-list">${renderMiniBars(CONFIG.issues, state.summary?.issues)}</div>
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
      return { s, dist, total, topOpt, topIss, pct };
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

    return `
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
              <th>लीडिंग विकल्प</th>
              <th>प्रमुख मुद्दा</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map(({ s, dist, total, topOpt, topIss, pct }) => `
                <tr>
                  <td><strong>${s.ac}</strong></td>
                  <td>${escapeHtml(s.hi)} ${s.res ? `<span class="seat-badge">${escapeHtml(s.res)}</span>` : ''}</td>
                  <td>${escapeHtml(dist?.hi || '')}</td>
                  <td><strong>${total}</strong></td>
                  <td>${topOpt ? `${escapeHtml(optMap.get(topOpt.key)?.hi || topOpt.key)} (${pct}%)` : '—'}</td>
                  <td>${topIss ? escapeHtml(issueMap.get(topIss.key)?.hi || topIss.key) : '—'}</td>
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

    return `
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
              <th>लीडिंग विकल्प</th>
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
                    <td>${topOpt ? `${escapeHtml(optMap.get(topOpt.key)?.hi || topOpt.key)} (${pct}%)` : '—'}</td>
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
        render();
      });
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
