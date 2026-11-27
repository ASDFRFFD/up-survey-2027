(function () {
const { CONFIG, I18N } = window.UP_SURVEY;

const STORAGE_VOTE_KEY = 'up_survey_v3_user_vote';
const STORAGE_DEMO_DB_KEY = 'up_survey_v3_demo_aggregates';
const STORAGE_FB_AUTH_KEY = 'up_survey_v3_fb_auth';
const STORAGE_LANG_KEY = 'up_survey_v1_lang';

const CHART_PALETTE = [
  '#EA580C', // Deep Orange
  '#F59E0B', // Amber Gold
  '#FACC15', // Bright Yellow
  '#FB923C', // Tangerine
  '#D97706', // Warm Gold
  '#9A3412', // Burnt Copper
  '#64748B', // Neutral Slate (Undecided)
  '#CBD5E1', // Soft Slate (NOTA)
];

const state = {
  lang: localStorage.getItem(STORAGE_LANG_KEY) === 'en' ? 'en' : 'hi',
  step: 0, // 0=Cover Splash, 1=District, 2=Seat, 3=Issue, 4=Poll, 5=Age, 6=Results
  data: null, // { districts, seats, districtMap, seatMap }
  districtQuery: '',
  seatQuery: '',
  districtOpen: false,
  seatOpen: false,
  invitedSeatAc: null,
  answers: {
    districtId: null,
    acNo: null,
    issueId: null,
    optionId: null,
    ageGroup: null,
  },
  shuffledPollOptions: [],
  resultsScope: 'seat', // 'seat' | 'state'
  viewedSeatAc: null,
  aggregates: null, // { seat: {...}, state: {...} }
  surveyConfig: { paused: false, announcement: '' },
  usingFallbackDemo: false,
  submitting: false,
};

const el = {
  stage: document.getElementById('stageContainer'),
  sideLeadersBg: document.getElementById('sideLeadersBg'),
  progressFill: document.getElementById('progressFill'),
  progressTrack: document.querySelector('.progress-track'),
  brandTitle: document.getElementById('brandTitle'),
  stepIndicator: document.getElementById('stepIndicator'),
  headerAdminText: document.getElementById('headerAdminText'),
  langToggle: document.getElementById('langToggle'),
  footerDisclaimer: document.getElementById('footerDisclaimer'),
  footerAdminText: document.getElementById('footerAdminText'),
  toast: document.getElementById('toast'),
};

function renderSideLeadersBackdrop() {
  if (!el.sideLeadersBg) return;
  const allAvatars = [];
  CONFIG.pollOptions.forEach((o) => {
    const list = o.avatars || (o.avatar ? [o.avatar] : []);
    list.forEach((src) => {
      if (!allAvatars.includes(src)) allAvatars.push(src);
    });
  });

  const leftList = allAvatars.filter((_, idx) => idx % 2 === 0);
  const rightList = allAvatars.filter((_, idx) => idx % 2 === 1);

  const renderTile = (src) => `
    <div class="side-cutout">
      <img src="${escapeHtml(src)}" alt="" loading="lazy" decoding="async" onerror="this.parentElement.style.display='none'" />
    </div>
  `;

  el.sideLeadersBg.innerHTML = `
    <div class="side-col side-col--left">${leftList.map(renderTile).join('')}</div>
    <div class="side-col side-col--right">${rightList.map(renderTile).join('')}</div>
  `;
}

function t() {
  return I18N[state.lang];
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(msg) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    el.toast.hidden = true;
  }, 2200);
}

function shuffleArray(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function preparePollOptions() {
  const primary = CONFIG.pollOptions.filter((o) => !o.pinBottom);
  const pinned = CONFIG.pollOptions.filter((o) => o.pinBottom);
  state.shuffledPollOptions = CONFIG.randomizePollOptions
    ? [...shuffleArray(primary), ...pinned]
    : [...primary, ...pinned];
}

function getEmptyBucket() {
  const bucket = { totalVotes: 0, options: {}, issues: {}, ages: {} };
  CONFIG.pollOptions.forEach((o) => { bucket.options[o.id] = 0; });
  CONFIG.issues.forEach((i) => { bucket.issues[i.id] = 0; });
  CONFIG.ageGroups.forEach((a) => { bucket.ages[a.id] = 0; });
  bucket.ages.skipped = 0;
  return bucket;
}

function loadDemoStore() {
  try {
    const raw = localStorage.getItem(STORAGE_DEMO_DB_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore storage errors
  }
  return { state: getEmptyBucket(), seats: {} };
}

function saveDemoStore(store) {
  try {
    localStorage.setItem(STORAGE_DEMO_DB_KEY, JSON.stringify(store));
  } catch {
    // ignore storage errors
  }
}

function incrementBucket(bucket, vote) {
  bucket.totalVotes = (bucket.totalVotes || 0) + 1;
  bucket.options[vote.optionId] = (bucket.options[vote.optionId] || 0) + 1;
  bucket.issues[vote.issueId] = (bucket.issues[vote.issueId] || 0) + 1;
  const ageKey = vote.ageGroup || 'skipped';
  bucket.ages[ageKey] = (bucket.ages[ageKey] || 0) + 1;
}

function getSavedUserVote() {
  try {
    const raw = localStorage.getItem(STORAGE_VOTE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveUserVote(vote) {
  try {
    localStorage.setItem(STORAGE_VOTE_KEY, JSON.stringify(vote));
  } catch {
    // ignore
  }
}

function updateChrome() {
  const dict = t();
  document.documentElement.lang = state.lang;
  el.brandTitle.textContent = dict.brandTitle;
  el.footerDisclaimer.textContent = dict.footerDisclaimer;
  if (el.headerAdminText) el.headerAdminText.textContent = dict.adminBtnShort;
  if (el.footerAdminText) el.footerAdminText.textContent = dict.footerAdminCta;

  const pct = state.step === 0 ? 0 : state.step <= 5 ? state.step * 20 : 100;
  el.progressFill.style.width = `${pct}%`;
  el.progressTrack.setAttribute('aria-valuenow', String(pct));
  el.stepIndicator.textContent =
    state.step === 0
      ? dict.splashStepLabel
      : state.step <= 5
        ? dict.stepLabel(state.step)
        : dict.resultsStepLabel;

  el.langToggle.querySelectorAll('[data-lang-label]').forEach((span) => {
    span.classList.toggle('active', span.dataset.langLabel === state.lang);
  });
}

function labelFor(item) {
  return state.lang === 'hi' ? item.hi : item.en;
}

function altLabelFor(item) {
  return state.lang === 'hi' ? item.en : item.hi;
}

function formatSeatName(seat) {
  const main = labelFor(seat);
  const resTag = seat.res ? ` (${seat.res})` : '';
  return `${seat.ac}. ${main}${resTag}`;
}

function chevronSvg() {
  return `
    <svg class="dropdown-chevron" width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
}

function getFilteredDistricts() {
  const dq = state.districtQuery.trim().toLowerCase();
  const { districts } = state.data;
  return dq
    ? districts.filter((d) => d.en.toLowerCase().includes(dq) || d.hi.toLowerCase().includes(dq))
    : districts;
}

function getDistrictSeats() {
  const { seats } = state.data;
  return state.answers.districtId
    ? seats.filter((s) => s.d === state.answers.districtId)
    : seats;
}

function getFilteredSeats() {
  const districtSeats = getDistrictSeats();
  const sq = state.seatQuery.trim().toLowerCase();
  return sq
    ? districtSeats.filter(
        (s) =>
          s.en.toLowerCase().includes(sq) ||
          s.hi.toLowerCase().includes(sq) ||
          String(s.ac) === sq ||
          String(s.ac).startsWith(sq)
      )
    : districtSeats;
}

function renderDistrictOptionsHtml() {
  const dict = t();
  const selectedDistrict = state.answers.districtId ? state.data.districtMap.get(state.answers.districtId) : null;
  const filteredDistricts = getFilteredDistricts();
  if (!filteredDistricts.length) {
    return `<div class="dropdown-empty">${escapeHtml(dict.noMatch)}</div>`;
  }
  return filteredDistricts
    .map(
      (d) => `
      <button type="button" class="dropdown-option ${selectedDistrict?.id === d.id ? 'selected' : ''}" data-district-id="${escapeHtml(d.id)}">
        <span>${escapeHtml(labelFor(d))} <span class="seat-badge">${escapeHtml(dict.districtSeatCountShort(d.count || getSeatsForDistrict(d.id).length))}</span></span>
        <span class="dropdown-sub">${escapeHtml(altLabelFor(d))}</span>
      </button>`
    )
    .join('');
}

function getSeatsForDistrict(distId) {
  return state.data.seats.filter((s) => s.d === distId);
}

function renderSeatOptionsHtml() {
  const dict = t();
  const { districtMap, seatMap } = state.data;
  const selectedSeat = state.answers.acNo ? seatMap.get(state.answers.acNo) : null;
  const filteredSeats = getFilteredSeats();
  if (!filteredSeats.length) {
    return `<div class="dropdown-empty">${escapeHtml(dict.noMatch)}</div>`;
  }
  return filteredSeats
    .map((s) => {
      const dist = districtMap.get(s.d);
      return `
        <button type="button" class="dropdown-option ${selectedSeat?.ac === s.ac ? 'selected' : ''}" data-ac="${s.ac}">
          <span>
            <strong>${s.ac}.</strong> ${escapeHtml(labelFor(s))}
            ${s.res ? `<span class="seat-badge">${escapeHtml(s.res)}</span>` : ''}
          </span>
          <span class="dropdown-sub">${escapeHtml(dist ? labelFor(dist) : '')}</span>
        </button>`;
    })
    .join('');
}

function splashStatIconSvg(kind) {
  if (kind === 'districts') {
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6-5.33-6-10a6 6 0 1 1 12 0c0 4.67-6 10-6 10Z"/><circle cx="12" cy="11" r="2.2"/></svg>`;
  }
  if (kind === 'seats') {
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 15v-3"/><path d="M12 15V9"/><path d="M17 15v-5"/></svg>`;
  }
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>`;
}

const POPULAR_DISTRICT_IDS = [
  'lucknow',
  'varanasi',
  'prayagraj',
  'kanpur-nagar',
  'agra',
  'gorakhpur',
  'meerut',
  'ayodhya',
];

function issueIconSvg(id) {
  switch (id) {
    case 'rozgar':
      return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><path d="M2 13h20"/></svg>`;
    case 'mehangai':
      return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4h11"/><path d="M6 9h11"/><path d="M6 14l7 7"/><path d="M6 14h4a5 5 0 0 0 0-10"/></svg>`;
    case 'sadak_bijli':
      return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;
    case 'shiksha':
      return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"/></svg>`;
    case 'swasthya':
      return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/><path d="M12 7v6M9 10h6"/></svg>`;
    case 'kanoon':
      return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></svg>`;
    case 'kisan':
    default:
      return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 22 12 12"/><path d="M9 15c-4-1-6-4-6-8 4 0 7 2 8 6"/><path d="M15 9c-1-4-4-6-8-6 0 4 2 7 6 8"/><path d="M16 14c4-1 6-4 6-8-4 0-7 2-8 6"/></svg>`;
  }
}

function ageIconSvg(id) {
  if (id === '18-25') {
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.5 5.5L20 11l-5.5 2.5L12 19l-2.5-5.5L4 11l5.5-2.5Z"/></svg>`;
  }
  if (id === '26-40') {
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>`;
  }
  if (id === '41-60') {
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
  }
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>`;
}

/* Cover Splash Page: "2027 me kiski sarkar?" */
function renderSplash() {
  const dict = t();
  const seatMap = state.data?.seatMap;
  const invitedSeat = state.invitedSeatAc && seatMap ? seatMap.get(state.invitedSeatAc) : null;

  const leaderCutouts = [];
  CONFIG.pollOptions.forEach((o) => {
    const list = o.avatars || (o.avatar ? [o.avatar] : []);
    list.forEach((src) => {
      if (!leaderCutouts.includes(src)) leaderCutouts.push(src);
    });
  });

  const inviteHtml = invitedSeat
    ? `
      <div class="invite-banner" style="text-align:left;">
        <span>${escapeHtml(dict.invitedSeatPrefix)} <strong>${escapeHtml(formatSeatName(invitedSeat))}</strong></span>
        <button type="button" id="splashInvitedBtn" class="invite-use-btn">${escapeHtml(dict.invitedSeatAction)}</button>
      </div>`
    : '';

  const noticeHtml = state.surveyConfig?.announcement
    ? `<div class="live-notice-banner">${escapeHtml(state.surveyConfig.announcement)}</div>`
    : '';

  const pausedHtml = state.surveyConfig?.paused
    ? `
      <div class="invite-banner" style="text-align:left;">
        <div>
          <strong>${escapeHtml(dict.surveyPausedTitle)}</strong>
          <div class="option-sub">${escapeHtml(dict.surveyPausedDesc)}</div>
        </div>
      </div>
      <button type="button" id="viewPausedResultsBtn" class="btn-primary splash-cta">${escapeHtml(dict.viewLiveResultsCta)}</button>`
    : `
      ${inviteHtml}
      <button type="button" id="startSurveyBtn" class="btn-primary splash-cta">
        ${escapeHtml(dict.splashStartCta)}
      </button>`;

  el.stage.innerHTML = `
    <section class="card splash-card">
      ${noticeHtml}
      <div class="splash-badge">
        <span class="splash-pulse" aria-hidden="true"></span>
        <span>${escapeHtml(dict.splashEyebrow)}</span>
      </div>

      <h1 class="splash-title">
        <span>${escapeHtml(dict.splashTitleLead)}</span>
        <span class="splash-title-accent">${escapeHtml(dict.splashTitleHighlight)}</span>
      </h1>

      <p class="splash-subtitle">${escapeHtml(dict.splashSubtitle)}</p>

      <div class="splash-cutouts-strip" aria-hidden="true">
        ${leaderCutouts
          .map(
            (src) => `
              <div class="splash-cutout-item">
                <img src="${escapeHtml(src)}" alt="" loading="eager" decoding="async" onerror="this.parentElement.style.display='none'" />
              </div>`
          )
          .join('')}
      </div>

      <div class="splash-stats">
        <div class="splash-stat-pill">
          <span class="splash-stat-icon">${splashStatIconSvg('districts')}</span>
          <span>${escapeHtml(dict.splashStatDistricts)}</span>
        </div>
        <div class="splash-stat-pill">
          <span class="splash-stat-icon">${splashStatIconSvg('seats')}</span>
          <span>${escapeHtml(dict.splashStatSeats)}</span>
        </div>
        <div class="splash-stat-pill">
          <span class="splash-stat-icon">${splashStatIconSvg('time')}</span>
          <span>${escapeHtml(dict.splashStatTime)}</span>
        </div>
      </div>

      ${pausedHtml}

      <div class="splash-trust-row">
        <span>${escapeHtml(dict.splashTrust1)}</span>
        <span>${escapeHtml(dict.splashTrust2)}</span>
        <span>${escapeHtml(dict.splashTrust3)}</span>
      </div>
    </section>
  `;

  document.getElementById('startSurveyBtn')?.addEventListener('click', () => {
    state.step = 1;
    render();
  });

  document.getElementById('viewPausedResultsBtn')?.addEventListener('click', async () => {
    const defaultAc = state.invitedSeatAc || 174;
    state.answers.acNo = defaultAc;
    state.viewedSeatAc = defaultAc;
    await loadSeatBucket(defaultAc);
    state.resultsScope = 'state';
    state.step = 6;
    render();
  });

  document.getElementById('splashInvitedBtn')?.addEventListener('click', () => {
    if (!invitedSeat) return;
    state.answers.districtId = invitedSeat.d;
    state.answers.acNo = invitedSeat.ac;
    state.step = 3;
    render();
  });
}

/* Question 1 of 5: District Dropdown Only */
function renderStep1District() {
  const dict = t();
  const { districts, districtMap, seatMap } = state.data;
  const selectedDistrict = state.answers.districtId ? districtMap.get(state.answers.districtId) : null;
  const invitedSeat = state.invitedSeatAc && !state.answers.acNo ? seatMap.get(state.invitedSeatAc) : null;

  const inviteHtml = invitedSeat
    ? `
      <div class="invite-banner">
        <span>${escapeHtml(dict.invitedSeatPrefix)} <strong>${escapeHtml(formatSeatName(invitedSeat))}</strong></span>
        <button type="button" id="useInvitedSeatBtn" class="invite-use-btn">${escapeHtml(dict.invitedSeatAction)}</button>
      </div>`
    : '';

  el.stage.innerHTML = `
    <section class="card">
      <div class="card-eyebrow-row">
        <p class="card-eyebrow">${escapeHtml(dict.step1Eyebrow)}</p>
        <span class="trust-pill">${escapeHtml(dict.trustPill)}</span>
      </div>
      <h1 class="card-title">${escapeHtml(dict.step1Title)}</h1>
      <p class="card-subtitle">${escapeHtml(dict.step1Subtitle)}</p>

      ${inviteHtml}

      <div class="dropdown-label">
        <span>${escapeHtml(dict.districtFieldLabel)}</span>
        <span class="dropdown-count-badge">${escapeHtml(dict.districtBadge(districts.length))}</span>
      </div>

      <div class="dropdown-field">
        <button
          type="button"
          id="districtTrigger"
          class="dropdown-trigger"
          aria-expanded="${state.districtOpen ? 'true' : 'false'}"
          aria-controls="districtMenu"
        >
          <span class="dropdown-trigger-text ${selectedDistrict ? '' : 'is-placeholder'}">
            ${escapeHtml(selectedDistrict ? `${labelFor(selectedDistrict)} (${altLabelFor(selectedDistrict)})` : dict.districtSelectPlaceholder)}
          </span>
          ${chevronSvg()}
        </button>

        <div id="districtMenu" class="dropdown-menu" ${state.districtOpen ? '' : 'hidden'}>
          <div class="dropdown-search-wrap">
            <input
              id="districtSearch"
              class="dropdown-search-input"
              type="text"
              autocomplete="off"
              placeholder="${escapeHtml(dict.districtPlaceholder)}"
              value="${escapeHtml(state.districtQuery)}"
            />
            <button type="button" id="clearDistrictBtn" class="clear-input-btn" aria-label="Clear search" ${state.districtQuery ? '' : 'hidden'}>✕</button>
          </div>
          <div id="districtOptionsList" class="dropdown-options" role="listbox">
            ${renderDistrictOptionsHtml()}
          </div>
        </div>
      </div>

      <div class="quick-chips-block">
        <p class="quick-chips-label">${escapeHtml(dict.quickDistrictsLabel)}</p>
        <div class="quick-chips-grid">
          ${POPULAR_DISTRICT_IDS.map((id) => districtMap.get(id))
            .filter(Boolean)
            .map(
              (d) => `
              <button type="button" class="quick-chip ${selectedDistrict?.id === d.id ? 'selected' : ''}" data-district-id="${escapeHtml(d.id)}">
                <span>${escapeHtml(labelFor(d))}</span>
                <span class="quick-chip-count">${d.count || ''}</span>
              </button>`
            )
            .join('')}
        </div>
      </div>

      <div class="card-actions">
        <button type="button" id="step1BackBtn" class="btn-back">${escapeHtml(dict.back)}</button>
        <button type="button" id="step1NextBtn" class="btn-primary" ${selectedDistrict ? '' : 'disabled'}>
          ${escapeHtml(dict.next)}
        </button>
      </div>
    </section>
  `;

  bindStep1Events();
}

function bindDistrictOptionClicks() {
  document.querySelectorAll('[data-district-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const distId = btn.dataset.districtId;
      if (state.answers.districtId !== distId) {
        state.answers.districtId = distId;
        state.answers.acNo = null;
        state.seatQuery = '';
      }
      state.districtOpen = false;
      state.seatOpen = false;
      state.step = 2;
      render();
    });
  });
}

function bindStep1Events() {
  const trigger = document.getElementById('districtTrigger');
  const menu = document.getElementById('districtMenu');
  const searchInput = document.getElementById('districtSearch');
  const clearBtn = document.getElementById('clearDistrictBtn');
  const optionsList = document.getElementById('districtOptionsList');

  document.getElementById('useInvitedSeatBtn')?.addEventListener('click', () => {
    const seat = state.data.seatMap.get(state.invitedSeatAc);
    if (!seat) return;
    state.answers.districtId = seat.d;
    state.answers.acNo = seat.ac;
    state.districtOpen = false;
    state.seatOpen = false;
    state.step = 2;
    render();
  });

  trigger.addEventListener('click', () => {
    state.districtOpen = !state.districtOpen;
    trigger.setAttribute('aria-expanded', state.districtOpen ? 'true' : 'false');
    menu.hidden = !state.districtOpen;
    if (state.districtOpen) searchInput.focus();
  });

  searchInput.addEventListener('input', (e) => {
    state.districtQuery = e.target.value;
    clearBtn.hidden = !state.districtQuery;
    optionsList.innerHTML = renderDistrictOptionsHtml();
    bindDistrictOptionClicks();
  });

  clearBtn.addEventListener('click', () => {
    state.districtQuery = '';
    searchInput.value = '';
    clearBtn.hidden = true;
    optionsList.innerHTML = renderDistrictOptionsHtml();
    bindDistrictOptionClicks();
    searchInput.focus();
  });

  bindDistrictOptionClicks();

  document.getElementById('step1BackBtn')?.addEventListener('click', () => {
    state.districtOpen = false;
    state.step = 0;
    render();
  });

  document.getElementById('step1NextBtn')?.addEventListener('click', () => {
    if (state.answers.districtId) {
      state.seatOpen = false;
      state.step = 2;
      render();
    }
  });
}

/* Question 2 of 5: Direct-Tap Compact Seat Grid + Live Filter */
function renderSeatTilesHtml() {
  const dict = t();
  const selectedAc = state.answers.acNo;
  const filteredSeats = getFilteredSeats();
  if (!filteredSeats.length) {
    return `<div class="dropdown-empty span-full">${escapeHtml(dict.noMatch)}</div>`;
  }
  return filteredSeats
    .map(
      (s) => `
      <button type="button" class="seat-tile ${selectedAc === s.ac ? 'selected' : ''}" data-ac="${s.ac}">
        <span class="seat-tile-top">
          <span class="seat-ac-pill">#${s.ac}</span>
          ${s.res ? `<span class="seat-badge">${escapeHtml(s.res)}</span>` : '<span class="option-check option-check--sm" aria-hidden="true">✓</span>'}
        </span>
        <span class="seat-tile-name">${escapeHtml(labelFor(s))}</span>
        <span class="seat-tile-sub">${escapeHtml(altLabelFor(s))}</span>
      </button>`
    )
    .join('');
}

function renderStep2Seat() {
  const dict = t();
  const { districtMap, seatMap } = state.data;
  const selectedDistrict = districtMap.get(state.answers.districtId);
  const selectedSeat = state.answers.acNo ? seatMap.get(state.answers.acNo) : null;
  const districtSeats = getDistrictSeats();

  el.stage.innerHTML = `
    <section class="card">
      <p class="card-eyebrow">${escapeHtml(dict.step2Eyebrow)}</p>
      <h1 class="card-title">${escapeHtml(dict.step2Title(selectedDistrict ? labelFor(selectedDistrict) : ''))}</h1>
      <p class="card-subtitle">${escapeHtml(dict.quickSeatsTapHint(districtSeats.length))}</p>

      <div class="dropdown-search-wrap seat-filter-inline">
        <input
          id="seatSearch"
          class="dropdown-search-input"
          type="text"
          autocomplete="off"
          placeholder="${escapeHtml(dict.quickSeatsFilterPlaceholder)}"
          value="${escapeHtml(state.seatQuery)}"
        />
        <button type="button" id="clearSeatBtn" class="clear-input-btn" aria-label="Clear search" ${state.seatQuery ? '' : 'hidden'}>✕</button>
      </div>

      <div id="seatGridList" class="seat-grid-2" role="listbox">
        ${renderSeatTilesHtml()}
      </div>

      <div class="card-actions">
        <button type="button" id="backBtn" class="btn-back">${escapeHtml(dict.back)}</button>
        <button type="button" id="step2NextBtn" class="btn-primary" ${selectedSeat ? '' : 'disabled'}>
          ${escapeHtml(dict.next)}
        </button>
      </div>
    </section>
  `;

  bindStep2Events();
}

function bindSeatOptionClicks() {
  document.querySelectorAll('[data-ac]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.answers.acNo = Number(btn.dataset.ac);
      state.seatOpen = false;
      state.step = 3;
      render();
    });
  });
}

function bindStep2Events() {
  const searchInput = document.getElementById('seatSearch');
  const clearBtn = document.getElementById('clearSeatBtn');
  const gridList = document.getElementById('seatGridList');

  searchInput.addEventListener('input', (e) => {
    state.seatQuery = e.target.value;
    clearBtn.hidden = !state.seatQuery;
    gridList.innerHTML = renderSeatTilesHtml();
    bindSeatOptionClicks();
  });

  clearBtn.addEventListener('click', () => {
    state.seatQuery = '';
    searchInput.value = '';
    clearBtn.hidden = true;
    gridList.innerHTML = renderSeatTilesHtml();
    bindSeatOptionClicks();
    searchInput.focus();
  });

  bindSeatOptionClicks();

  document.getElementById('backBtn').addEventListener('click', () => {
    state.districtOpen = false;
    state.step = 1;
    render();
  });

  document.getElementById('step2NextBtn')?.addEventListener('click', () => {
    if (state.answers.acNo) {
      state.step = 3;
      render();
    }
  });
}

/* Question 3 of 5: Key Issue (Compact 2-Column Graphic Grid) */
function renderStep3Issue() {
  const dict = t();
  const totalIssues = CONFIG.issues.length;
  el.stage.innerHTML = `
    <section class="card">
      <p class="card-eyebrow">${escapeHtml(dict.step3Eyebrow)}</p>
      <h1 class="card-title">${escapeHtml(dict.step3Title)}</h1>
      <p class="card-subtitle">${escapeHtml(dict.step3Subtitle)}</p>

      <div class="options-grid-2">
        ${CONFIG.issues
          .map((item, idx) => {
            const selected = state.answers.issueId === item.id;
            const isOddLast = idx === totalIssues - 1 && totalIssues % 2 === 1;
            return `
              <button type="button" class="option-tile ${isOddLast ? 'span-full option-tile--wide' : ''} ${selected ? 'selected' : ''}" data-issue-id="${escapeHtml(item.id)}">
                <span class="issue-icon-badge" aria-hidden="true">${issueIconSvg(item.id)}</span>
                <span class="option-tile-text">
                  <span class="option-tile-title">${escapeHtml(labelFor(item))}</span>
                  <span class="option-sub">${escapeHtml(altLabelFor(item))}</span>
                </span>
                <span class="option-check option-check--sm" aria-hidden="true">✓</span>
              </button>`;
          })
          .join('')}
      </div>

      <div class="card-actions">
        <button type="button" id="backBtn" class="btn-back">${escapeHtml(dict.back)}</button>
      </div>
    </section>
  `;

  document.getElementById('backBtn').addEventListener('click', () => {
    state.seatOpen = false;
    state.step = 2;
    render();
  });

  document.querySelectorAll('[data-issue-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.answers.issueId = btn.dataset.issueId;
      btn.classList.add('selected');
      setTimeout(() => {
        state.step = 4;
        render();
      }, 150);
    });
  });
}

function neutralOptionIconSvg(kind) {
  if (kind === 'undecided') {
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 0 1 5 .8c0 1.6-2.5 2.2-2.5 3.7"/><circle cx="12" cy="17.2" r=".7" fill="currentColor"/></svg>`;
  }
  if (kind === 'nota') {
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M7.5 16.5L16.5 7.5"/></svg>`;
  }
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
}

/* Question 4 of 5: Compact Smart 2-Column Graphic Opinion Poll */
function renderStep4Poll() {
  const dict = t();
  const primary = state.shuffledPollOptions.filter((o) => !o.pinBottom);
  const pinned = state.shuffledPollOptions.filter((o) => o.pinBottom);

  const renderAvatar = (item, isTile) => {
    const imgs = item.avatars || (item.avatar ? [item.avatar] : []);
    if (imgs.length) {
      const leaderName = state.lang === 'hi' ? (item.leaderHi || item.hi) : (item.leaderEn || item.en);
      const isPair = imgs.length > 1;
      const cls = isTile
        ? `poll-tile-avatar ${isPair ? 'poll-tile-avatar--pair' : ''}`
        : `option-avatar ${isPair ? 'option-avatar--pair' : ''}`;
      return `
        <span class="${cls}">
          ${imgs
            .map(
              (src) =>
                `<img src="${escapeHtml(src)}" alt="${escapeHtml(leaderName)}" loading="eager" decoding="async" onerror="this.style.display='none'" />`
            )
            .join('')}
        </span>`;
    }
    return `<span class="option-avatar option-avatar--neutral">${neutralOptionIconSvg(item.icon)}</span>`;
  };

  const renderPrimary = (item) => {
    const selected = state.answers.optionId === item.id;
    const subText = item.leaderHi
      ? (state.lang === 'hi' ? item.leaderHi : item.leaderEn)
      : altLabelFor(item);
    if (item.avatar) {
      return `
        <button type="button" class="poll-tile ${selected ? 'selected' : ''}" data-option-id="${escapeHtml(item.id)}">
          <span class="option-check option-check--sm poll-tile-check" aria-hidden="true">✓</span>
          ${renderAvatar(item, true)}
          <span class="poll-tile-title">${escapeHtml(labelFor(item))}</span>
          <span class="poll-tile-sub">${escapeHtml(subText)}</span>
        </button>`;
    }
    return `
      <button type="button" class="option-card option-card--compact span-full ${selected ? 'selected' : ''}" data-option-id="${escapeHtml(item.id)}">
        <span class="option-left">
          ${renderAvatar(item, false)}
          <span>
            ${escapeHtml(labelFor(item))}
            <span class="option-sub">${escapeHtml(subText)}</span>
          </span>
        </span>
        <span class="option-check option-check--sm" aria-hidden="true">✓</span>
      </button>`;
  };

  const renderPinned = (item) => {
    const selected = state.answers.optionId === item.id;
    return `
      <button type="button" class="option-tile neutral-pinned ${selected ? 'selected' : ''}" data-option-id="${escapeHtml(item.id)}">
        <span class="issue-icon-badge issue-icon-badge--neutral" aria-hidden="true">${neutralOptionIconSvg(item.icon)}</span>
        <span class="option-tile-text">
          <span class="option-tile-title">${escapeHtml(labelFor(item))}</span>
        </span>
        <span class="option-check option-check--sm" aria-hidden="true">✓</span>
      </button>`;
  };

  el.stage.innerHTML = `
    <section class="card">
      <p class="card-eyebrow">${escapeHtml(dict.step4Eyebrow)}</p>
      <h1 class="card-title">${escapeHtml(dict.step4Title)}</h1>
      <p class="card-subtitle">${escapeHtml(dict.step4Subtitle)}</p>

      <div class="poll-grid-smart">
        ${primary.map(renderPrimary).join('')}
      </div>

      <div class="options-divider">${escapeHtml(dict.neutralDivider)}</div>

      <div class="options-grid-2">
        ${pinned.map(renderPinned).join('')}
      </div>

      <div class="card-actions">
        <button type="button" id="backBtn" class="btn-back">${escapeHtml(dict.back)}</button>
      </div>
    </section>
  `;

  document.getElementById('backBtn').addEventListener('click', () => {
    state.step = 3;
    render();
  });

  document.querySelectorAll('[data-option-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.answers.optionId = btn.dataset.optionId;
      btn.classList.add('selected');
      setTimeout(() => {
        state.step = 5;
        render();
      }, 150);
    });
  });
}

/* Question 5 of 5: Age Group (2x2 Graphic Grid, Optional) */
function renderStep5Age() {
  const dict = t();
  el.stage.innerHTML = `
    <section class="card">
      <p class="card-eyebrow">${escapeHtml(dict.step5Eyebrow)}</p>
      <h1 class="card-title">${escapeHtml(dict.step5Title)}</h1>
      <p class="card-subtitle">${escapeHtml(dict.step5Subtitle)}</p>

      <div class="options-grid-2">
        ${CONFIG.ageGroups
          .map((item) => {
            const selected = state.answers.ageGroup === item.id;
            return `
              <button type="button" class="option-tile ${selected ? 'selected' : ''}" data-age-id="${escapeHtml(item.id)}" ${state.submitting ? 'disabled' : ''}>
                <span class="issue-icon-badge" aria-hidden="true">${ageIconSvg(item.id)}</span>
                <span class="option-tile-text">
                  <span class="option-tile-title">${escapeHtml(labelFor(item))}</span>
                </span>
                <span class="option-check option-check--sm" aria-hidden="true">✓</span>
              </button>`;
          })
          .join('')}
      </div>

      <button type="button" id="skipAgeBtn" class="btn-skip" ${state.submitting ? 'disabled' : ''}>
        ${escapeHtml(dict.skipAge)}
      </button>

      <div class="card-actions">
        <button type="button" id="backBtn" class="btn-back" ${state.submitting ? 'disabled' : ''}>${escapeHtml(dict.back)}</button>
      </div>
    </section>
  `;

  document.getElementById('backBtn').addEventListener('click', () => {
    state.step = 4;
    render();
  });

  document.querySelectorAll('[data-age-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.answers.ageGroup = btn.dataset.ageId;
      btn.classList.add('selected');
      setTimeout(() => submitVote(), 150);
    });
  });

  document.getElementById('skipAgeBtn').addEventListener('click', () => {
    state.answers.ageGroup = null;
    submitVote();
  });
}

function normalizeBucket(raw) {
  const bucket = getEmptyBucket();
  if (!raw || typeof raw !== 'object') return bucket;
  bucket.totalVotes = Number(raw.totalVotes) || 0;
  Object.keys(bucket.options).forEach((k) => {
    bucket.options[k] = Number(raw.options?.[k]) || 0;
  });
  Object.keys(bucket.issues).forEach((k) => {
    bucket.issues[k] = Number(raw.issues?.[k]) || 0;
  });
  Object.keys(bucket.ages).forEach((k) => {
    bucket.ages[k] = Number(raw.ages?.[k]) || 0;
  });
  return bucket;
}

async function getFirebaseAuthSession() {
  const fb = CONFIG.firebase;
  if (!fb?.apiKey) throw new Error('Firebase config missing');

  try {
    const cachedRaw = localStorage.getItem(STORAGE_FB_AUTH_KEY);
    if (cachedRaw) {
      const cached = JSON.parse(cachedRaw);
      if (cached.idToken && cached.uid && cached.expiresAt > Date.now() + 60000) {
        return cached;
      }
      if (cached.refreshToken) {
        const refRes = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(fb.apiKey)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: cached.refreshToken }),
        });
        if (refRes.ok) {
          const refData = await refRes.json();
          const next = {
            uid: refData.user_id,
            idToken: refData.id_token,
            refreshToken: refData.refresh_token || cached.refreshToken,
            expiresAt: Date.now() + Number(refData.expires_in || 3600) * 1000,
          };
          localStorage.setItem(STORAGE_FB_AUTH_KEY, JSON.stringify(next));
          return next;
        }
      }
    }
  } catch {
    // ignore cache/refresh error and sign up fresh
  }

  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(fb.apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  const data = await res.json();
  if (!res.ok || !data.idToken) {
    throw new Error(data?.error?.message || 'Anonymous auth failed');
  }
  const session = {
    uid: data.localId,
    idToken: data.idToken,
    refreshToken: data.refreshToken,
    expiresAt: Date.now() + Number(data.expiresIn || 3600) * 1000,
  };
  try {
    localStorage.setItem(STORAGE_FB_AUTH_KEY, JSON.stringify(session));
  } catch {
    // ignore storage errors
  }
  return session;
}

async function fetchFirebaseAggregates(acNo) {
  const fb = CONFIG.firebase;
  const base = `${fb.databaseURL.replace(/\/$/, '')}/${fb.rootPath}/aggregates`;
  const [stateRes, seatRes] = await Promise.all([
    fetch(`${base}/up_summary.json`),
    fetch(`${base}/seats/${encodeURIComponent(acNo)}.json`),
  ]);
  if (!stateRes.ok || !seatRes.ok) {
    throw new Error(`RTDB read failed (${stateRes.status}/${seatRes.status})`);
  }
  const [stateRaw, seatRaw] = await Promise.all([stateRes.json(), seatRes.json()]);
  return {
    state: normalizeBucket(stateRaw),
    seat: normalizeBucket(seatRaw),
  };
}

async function submitVoteToFirebase(payload) {
  const fb = CONFIG.firebase;
  const session = await getFirebaseAuthSession();
  const base = `${fb.databaseURL.replace(/\/$/, '')}/${fb.rootPath}`;
  const acKey = String(payload.acNo);
  const ageKey = payload.ageGroup || 'skipped';
  const inc = { '.sv': { increment: 1 } };

  const patchBody = {
    [`votes/${session.uid}`]: {
      acNo: payload.acNo,
      acKey,
      districtId: payload.districtId,
      issueId: payload.issueId,
      optionId: payload.optionId,
      ageGroup: ageKey,
      ts: { '.sv': 'timestamp' },
    },
    'aggregates/up_summary/totalVotes': inc,
    [`aggregates/up_summary/options/${payload.optionId}`]: inc,
    [`aggregates/up_summary/issues/${payload.issueId}`]: inc,
    [`aggregates/up_summary/ages/${ageKey}`]: inc,
    [`aggregates/seats/${acKey}/totalVotes`]: inc,
    [`aggregates/seats/${acKey}/options/${payload.optionId}`]: inc,
    [`aggregates/seats/${acKey}/issues/${payload.issueId}`]: inc,
    [`aggregates/seats/${acKey}/ages/${ageKey}`]: inc,
  };

  const res = await fetch(`${base}.json?auth=${encodeURIComponent(session.idToken)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patchBody),
  });
  if (!res.ok) {
    const errTxt = await res.text();
    const err = new Error(`RTDB write failed (${res.status}): ${errTxt}`);
    err.status = res.status;
    throw err;
  }

  return fetchFirebaseAggregates(payload.acNo);
}

async function submitVote() {
  if (state.submitting) return;
  state.submitting = true;

  const payload = {
    districtId: state.answers.districtId,
    acNo: state.answers.acNo,
    issueId: state.answers.issueId,
    optionId: state.answers.optionId,
    ageGroup: state.answers.ageGroup,
    submittedAt: new Date().toISOString(),
  };

  try {
    state.usingFallbackDemo = false;

    if (CONFIG.mode === 'firebase') {
      try {
        state.aggregates = await submitVoteToFirebase(payload);
      } catch (fbErr) {
        console.warn('Firebase fallback to demo mode:', fbErr);
        // Check if this uid already voted in Firebase; otherwise fall back smoothly to local preview
        state.usingFallbackDemo = true;
        const store = loadDemoStore();
        const seatKey = String(payload.acNo);
        if (!store.seats[seatKey]) store.seats[seatKey] = getEmptyBucket();
        incrementBucket(store.seats[seatKey], payload);
        incrementBucket(store.state, payload);
        saveDemoStore(store);
        state.aggregates = { seat: store.seats[seatKey], state: store.state };
      }
    } else if (CONFIG.mode === 'api') {
      const res = await fetch(`${CONFIG.apiBase}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Vote submission failed');
      state.aggregates = await res.json();
    } else {
      const store = loadDemoStore();
      const seatKey = String(payload.acNo);
      if (!store.seats[seatKey]) store.seats[seatKey] = getEmptyBucket();
      incrementBucket(store.seats[seatKey], payload);
      incrementBucket(store.state, payload);
      saveDemoStore(store);
      state.aggregates = { seat: store.seats[seatKey], state: store.state };
    }

    saveUserVote(payload);
    state.viewedSeatAc = payload.acNo;
    state.step = 6;
    state.resultsScope = 'seat';
  } catch (err) {
    console.error(err);
    showToast(t().loadError);
  } finally {
    state.submitting = false;
    render();
  }
}

async function loadSeatBucket(acNo) {
  if (CONFIG.mode === 'firebase') {
    try {
      state.aggregates = await fetchFirebaseAggregates(acNo);
      state.usingFallbackDemo = false;
      return;
    } catch (err) {
      console.warn('Firebase read fallback to local preview:', err);
      state.usingFallbackDemo = true;
    }
  } else if (CONFIG.mode === 'api') {
    const res = await fetch(`${CONFIG.apiBase}/results?ac=${encodeURIComponent(acNo)}`);
    if (!res.ok) throw new Error('Failed to load results');
    state.aggregates = await res.json();
    return;
  }
  const store = loadDemoStore();
  state.aggregates = {
    seat: store.seats[String(acNo)] || getEmptyBucket(),
    state: store.state || getEmptyBucket(),
  };
}

function getSortedRows(items, countsMap, total) {
  return items
    .map((item) => {
      const count = countsMap?.[item.id] || 0;
      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
      return { item, count, pct };
    })
    .sort((a, b) => b.count - a.count);
}

/* SVG Circle Donut Graph Infographic */
function renderDonutInfographic(items, countsMap, total, userPickId) {
  if (!total) {
    return `<p class="card-subtitle" style="margin-bottom:0;">${escapeHtml(t().noDataYet)}</p>`;
  }

  const rows = getSortedRows(items, countsMap, total);
  const r = 64;
  const circumference = 2 * Math.PI * r;
  let offset = 0;

  const segments = rows
    .filter((row) => row.count > 0)
    .map((row, idx) => {
      const frac = row.count / total;
      const segLen = frac * circumference;
      const color = CHART_PALETTE[idx % CHART_PALETTE.length];
      const circleSvg = `
        <circle
          cx="90"
          cy="90"
          r="${r}"
          fill="none"
          stroke="${color}"
          stroke-width="26"
          stroke-dasharray="${segLen.toFixed(2)} ${(circumference - segLen).toFixed(2)}"
          stroke-dashoffset="${(-offset).toFixed(2)}"
        />`;
      offset += segLen;
      return { circleSvg, color, ...row };
    });

  return `
    <div class="donut-layout">
      <div class="donut-wrap">
        <svg class="donut-svg" viewBox="0 0 180 180" role="img" aria-label="${escapeHtml(t().pollTrendHeading)}">
          <circle cx="90" cy="90" r="${r}" fill="none" stroke="#f3f0ea" stroke-width="26" />
          ${segments.map((s) => s.circleSvg).join('')}
        </svg>
        <div class="donut-center">
          <span class="donut-center-num">${total}</span>
          <span class="donut-center-label">${escapeHtml(t().donutVotesLabel)}</span>
        </div>
      </div>

      <div class="donut-legend">
        ${rows
          .map((row, idx) => {
            const color = row.count > 0 ? CHART_PALETTE[idx % CHART_PALETTE.length] : '#e5e7eb';
            const isPick = userPickId && row.item.id === userPickId;
            return `
              <div class="legend-item ${isPick ? 'is-pick' : ''}">
                <span class="legend-left">
                  <span class="legend-swatch" style="background:${color};"></span>
                  ${row.item.avatar ? `<img class="mini-avatar" src="${escapeHtml(row.item.avatar)}" alt="" />` : ''}
                  <span class="legend-name">${escapeHtml(labelFor(row.item))}</span>
                </span>
                <span class="legend-pct">${row.pct}%</span>
              </div>`;
          })
          .join('')}
      </div>
    </div>
  `;
}

/* Ranked Horizontal Bar Graph */
function renderBarGroup(items, countsMap, total, userPickId, showRank = false) {
  if (!total) {
    return `<p class="card-subtitle" style="margin-bottom:0;">${escapeHtml(t().noDataYet)}</p>`;
  }

  const rows = getSortedRows(items, countsMap, total);

  return `
    <div class="bar-list">
      ${rows
        .map(({ item, pct }, idx) => {
          const isPick = userPickId && item.id === userPickId;
          return `
            <div class="bar-row">
              <div class="bar-header">
                <span class="bar-label ${isPick ? 'user-pick' : ''}">
                  ${showRank ? `<span class="bar-rank">#${idx + 1}</span>` : ''}
                  ${item.avatar ? `<img class="mini-avatar" src="${escapeHtml(item.avatar)}" alt="" />` : ''}
                  <span>${escapeHtml(labelFor(item))}${isPick ? ` • <em>${escapeHtml(t().yourChoiceTag)}</em>` : ''}</span>
                </span>
                <span class="bar-pct ${isPick || idx === 0 ? 'is-top' : ''}">${pct}%</span>
              </div>
              <div class="bar-track">
                <div class="bar-fill ${isPick || idx === 0 ? 'primary' : ''}" style="width: ${pct}%;"></div>
              </div>
            </div>`;
        })
        .join('')}
    </div>
  `;
}

/* Vertical Column Bar Graph (Age Groups) */
function renderAgeColumnGraph(items, countsMap, total, userPickId) {
  if (!total) {
    return `<p class="card-subtitle" style="margin-bottom:0;">${escapeHtml(t().noDataYet)}</p>`;
  }

  return `
    <div class="col-chart" role="img" aria-label="${escapeHtml(t().ageHeading)}">
      ${items
        .map((item) => {
          const count = countsMap?.[item.id] || 0;
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          const isPick = userPickId && item.id === userPickId;
          return `
            <div class="col-item ${isPick ? 'is-pick' : ''}">
              <span class="col-pct">${pct}%</span>
              <div class="col-track">
                <div class="col-pillar ${isPick ? 'is-pick' : ''}" style="height: ${Math.max(pct, 4)}%;"></div>
              </div>
              <span class="col-label">${escapeHtml(item.id)}</span>
            </div>`;
        })
        .join('')}
    </div>
  `;
}

function renderResults() {
  const dict = t();
  const activeAc = state.viewedSeatAc || state.answers.acNo;
  const seat = state.data.seatMap.get(activeAc);
  const votedSeat = state.data.seatMap.get(state.answers.acNo);
  const seatShort = seat ? labelFor(seat) : `#${activeAc}`;
  const votedSeatShort = votedSeat ? labelFor(votedSeat) : `#${state.answers.acNo}`;
  const bucket = state.resultsScope === 'seat' ? state.aggregates?.seat : state.aggregates?.state;
  const total = bucket?.totalVotes || 0;

  const topIssueRow = total ? getSortedRows(CONFIG.issues, bucket?.issues, total)[0] : null;
  const topPollRow = total ? getSortedRows(CONFIG.pollOptions, bucket?.options, total)[0] : null;

  const shareUrl = `${window.location.origin}${window.location.pathname}?seat=${encodeURIComponent(state.answers.acNo)}`;
  const shareText = dict.shareMessage(votedSeatShort, shareUrl);
  const waHref = `https://wa.me/?text=${encodeURIComponent(shareText)}`;

  const isViewingOwnSeat = activeAc === state.answers.acNo;
  const showPick = state.resultsScope === 'state' || isViewingOwnSeat;

  el.stage.innerHTML = `
    <section class="card">
      ${
        CONFIG.mode === 'demo' || state.usingFallbackDemo
          ? `<div class="demo-banner">
              <span>${escapeHtml(state.usingFallbackDemo ? dict.firebasePendingBanner : dict.demoBanner)}</span>
              <button type="button" id="demoResetBtn" class="demo-reset-btn">${escapeHtml(dict.demoReset)}</button>
            </div>`
          : `<div class="live-banner">
              <span class="live-dot" aria-hidden="true"></span>
              <span>${escapeHtml(dict.liveBadge)}</span>
            </div>`
      }

      <p class="card-eyebrow">${escapeHtml(dict.resultsEyebrow)}</p>
      <h1 class="card-title">${escapeHtml(dict.resultsTitle(seatShort))}</h1>
      <p class="card-subtitle">${escapeHtml(dict.resultsSubtitle)}</p>

      <div class="scope-tabs" role="tablist">
        <button type="button" role="tab" class="scope-tab ${state.resultsScope === 'seat' ? 'active' : ''}" data-scope="seat" aria-selected="${state.resultsScope === 'seat'}">
          ${escapeHtml(dict.tabSeat(seatShort))}
        </button>
        <button type="button" role="tab" class="scope-tab ${state.resultsScope === 'state' ? 'active' : ''}" data-scope="state" aria-selected="${state.resultsScope === 'state'}">
          ${escapeHtml(dict.tabState)}
        </button>
      </div>

      ${
        state.resultsScope === 'seat'
          ? `<div class="results-filter-box">
              <label class="results-filter-label" for="resultsSeatSelect">${escapeHtml(dict.seatSwitcherLabel)}</label>
              <div class="native-select-wrap">
                <select id="resultsSeatSelect" class="native-select">
                  ${state.data.districts
                    .map((dist) => {
                      const dSeats = getSeatsForDistrict(dist.id);
                      const groupLabel = `${labelFor(dist)} — ${altLabelFor(dist)} (${dSeats.length})`;
                      return `
                        <optgroup label="${escapeHtml(groupLabel)}">
                          ${dSeats
                            .map((s) => `<option value="${s.ac}" ${s.ac === activeAc ? 'selected' : ''}>${escapeHtml(formatSeatName(s))}</option>`)
                            .join('')}
                        </optgroup>`;
                    })
                    .join('')}
                </select>
                <span class="native-select-arrow" aria-hidden="true">▾</span>
              </div>
            </div>`
          : ''
      }

      <!-- Infographic KPI Strip -->
      <div class="kpi-grid">
        <div class="kpi-card">
          <span class="kpi-label">${escapeHtml(dict.kpiVotes)}</span>
          <span class="kpi-value">${total}</span>
        </div>
        <div class="kpi-card">
          <span class="kpi-label">${escapeHtml(dict.kpiTopIssue)}</span>
          <span class="kpi-value">${escapeHtml(topIssueRow && topIssueRow.count > 0 ? labelFor(topIssueRow.item).split(' ')[0] : '—')}</span>
        </div>
        <div class="kpi-card">
          <span class="kpi-label">${escapeHtml(dict.kpiTopTrend)}</span>
          <span class="kpi-value">${topPollRow && topPollRow.count > 0 ? `${topPollRow.pct}%` : '—'}</span>
        </div>
      </div>

      <!-- Circle Graph + Bar Graph for Opinion Trend -->
      <div class="metric-section">
        <h2 class="metric-heading">
          <span>${escapeHtml(dict.pollTrendHeading)}</span>
          <span class="metric-tag">${escapeHtml(dict.circleTag)}</span>
        </h2>
        ${
          total
            ? `${renderDonutInfographic(CONFIG.pollOptions, bucket?.options, total, showPick ? state.answers.optionId : null)}
               ${renderBarGroup(CONFIG.pollOptions, bucket?.options, total, showPick ? state.answers.optionId : null, false)}`
            : `<p class="card-subtitle" style="margin-bottom:0;">${escapeHtml(dict.noDataYet)}</p>`
        }
      </div>

      <!-- Ranked Bar Graph for Key Issues -->
      <div class="metric-section">
        <h2 class="metric-heading">
          <span>${escapeHtml(dict.topIssuesHeading)}</span>
          <span class="metric-tag">${escapeHtml(dict.barTag)}</span>
        </h2>
        ${renderBarGroup(CONFIG.issues, bucket?.issues, total, showPick ? state.answers.issueId : null, true)}
      </div>

      <!-- Vertical Column Graph for Age Groups -->
      <div class="metric-section">
        <h2 class="metric-heading">
          <span>${escapeHtml(dict.ageHeading)}</span>
          <span class="metric-tag">${escapeHtml(dict.columnTag)}</span>
        </h2>
        ${renderAgeColumnGraph(CONFIG.ageGroups, bucket?.ages, total, showPick ? state.answers.ageGroup : null)}
      </div>

      <div class="share-card">
        <h2 class="share-title">${escapeHtml(dict.shareTitle)}</h2>
        <p class="share-desc">${escapeHtml(dict.shareDesc)}</p>
        <div class="share-buttons">
          <a class="btn-whatsapp" href="${escapeHtml(waHref)}" target="_blank" rel="noopener noreferrer">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38c1.45.79 3.08 1.21 4.79 1.21 5.46 0 9.91-4.45 9.91-9.91C21.95 6.45 17.5 2 12.04 2zm5.8 14.1c-.25.7-1.44 1.34-2 1.42-.51.08-1.15.11-1.85-.12-.43-.14-.98-.32-1.69-.63-2.97-1.28-4.91-4.27-5.06-4.47-.15-.2-1.21-1.61-1.21-3.07 0-1.46.77-2.18 1.04-2.48.27-.3.6-.37.8-.37h.58c.19 0 .44-.07.69.52.25.6.86 2.08.93 2.23.08.15.13.33.03.53-.1.2-.15.33-.3.5-.15.18-.32.4-.45.54-.15.15-.31.31-.13.61.18.3.79 1.3 1.7 2.11 1.17 1.04 2.16 1.36 2.46 1.51.3.15.48.13.66-.08.18-.21.76-.88.96-1.18.2-.3.41-.25.69-.15.28.1 1.78.84 2.09.99.3.15.51.23.58.36.08.13.08.76-.17 1.46z"/>
            </svg>
            ${escapeHtml(dict.shareWhatsapp)}
          </a>
          <button type="button" id="copyLinkBtn" class="btn-copy">${escapeHtml(dict.copyLink)}</button>
        </div>
      </div>
    </section>
  `;

  document.querySelectorAll('[data-scope]').forEach((tab) => {
    tab.addEventListener('click', () => {
      state.resultsScope = tab.dataset.scope;
      renderResults();
    });
  });

  document.getElementById('resultsSeatSelect')?.addEventListener('change', async (e) => {
    state.viewedSeatAc = Number(e.target.value);
    await loadSeatBucket(state.viewedSeatAc);
    renderResults();
  });

  document.getElementById('copyLinkBtn')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      showToast(dict.copiedToast);
    } catch {
      showToast(shareUrl);
    }
  });

  document.getElementById('demoResetBtn')?.addEventListener('click', () => {
    localStorage.removeItem(STORAGE_VOTE_KEY);
    state.step = 0;
    state.districtOpen = false;
    state.seatOpen = false;
    state.viewedSeatAc = null;
    state.usingFallbackDemo = false;
    state.answers = { districtId: null, acNo: null, issueId: null, optionId: null, ageGroup: null };
    state.districtQuery = '';
    state.seatQuery = '';
    preparePollOptions();
    render();
  });
}

function render() {
  updateChrome();
  if (state.step === 0) renderSplash();
  else if (state.step === 1) renderStep1District();
  else if (state.step === 2) renderStep2Seat();
  else if (state.step === 3) renderStep3Issue();
  else if (state.step === 4) renderStep4Poll();
  else if (state.step === 5) renderStep5Age();
  else renderResults();
}

async function init() {
  updateChrome();
  preparePollOptions();
  renderSideLeadersBackdrop();

  document.addEventListener('click', (e) => {
    if (e.target.closest('.dropdown-field')) return;
    if (state.step === 1 && state.districtOpen) {
      state.districtOpen = false;
      const trigger = document.getElementById('districtTrigger');
      const menu = document.getElementById('districtMenu');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
      if (menu) menu.hidden = true;
    } else if (state.step === 2 && state.seatOpen) {
      state.seatOpen = false;
      const trigger = document.getElementById('seatTrigger');
      const menu = document.getElementById('seatMenu');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
      if (menu) menu.hidden = true;
    }
  });

  el.langToggle.addEventListener('click', () => {
    state.lang = state.lang === 'hi' ? 'en' : 'hi';
    localStorage.setItem(STORAGE_LANG_KEY, state.lang);
    render();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (state.step === 1 && state.districtOpen) {
      state.districtOpen = false;
      document.getElementById('districtTrigger')?.setAttribute('aria-expanded', 'false');
      const m = document.getElementById('districtMenu');
      if (m) m.hidden = true;
    } else if (state.step === 2 && state.seatOpen) {
      state.seatOpen = false;
      document.getElementById('seatTrigger')?.setAttribute('aria-expanded', 'false');
      const m = document.getElementById('seatMenu');
      if (m) m.hidden = true;
    }
  });

  try {
    let raw = window.UP_CONSTITUENCIES;
    if (!raw) {
      const res = await fetch('./data/up-constituencies.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      raw = await res.json();
    }
    const districtMap = new Map(raw.districts.map((d) => [d.id, d]));
    const seatMap = new Map(raw.seats.map((s) => [s.ac, s]));
    state.data = { districts: raw.districts, seats: raw.seats, districtMap, seatMap };

    const params = new URLSearchParams(window.location.search);
    const sharedAc = Number(params.get('seat'));
    if (sharedAc && seatMap.has(sharedAc)) {
      state.invitedSeatAc = sharedAc;
    }

    if (CONFIG.mode === 'firebase') {
      try {
        const cfgUrl = `${CONFIG.firebase.databaseURL.replace(/\/$/, '')}/${CONFIG.firebase.rootPath}/config.json`;
        const cfgRes = await fetch(cfgUrl);
        if (cfgRes.ok) {
          const cfgData = await cfgRes.json();
          if (cfgData && typeof cfgData === 'object') {
            state.surveyConfig = {
              paused: Boolean(cfgData.paused),
              announcement: String(cfgData.announcement || ''),
            };
          }
        }
      } catch {
        // ignore non-fatal config read failures
      }
    }

    const existingVote = getSavedUserVote();
    const validOption = existingVote && CONFIG.pollOptions.some((o) => o.id === existingVote.optionId);
    const validIssue = existingVote && CONFIG.issues.some((i) => i.id === existingVote.issueId);
    if (existingVote && seatMap.has(existingVote.acNo) && validOption && validIssue) {
      state.answers = {
        districtId: existingVote.districtId,
        acNo: existingVote.acNo,
        issueId: existingVote.issueId,
        optionId: existingVote.optionId,
        ageGroup: existingVote.ageGroup,
      };
      state.viewedSeatAc = existingVote.acNo;
      await loadSeatBucket(existingVote.acNo);
      state.step = 6;
    }

    render();
  } catch (err) {
    console.error(err);
    el.stage.innerHTML = `<div class="loading-card"><p>${escapeHtml(t().loadError)}</p></div>`;
  }
}

init();
})();
