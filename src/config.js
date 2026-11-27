/**
 * Central configuration for the UP Vidhan Sabha Opinion Survey.
 * Switch `mode` to 'api' once Cloudflare Pages Functions + Firebase + Turnstile are configured.
 */
(function (global) {
const CONFIG = {
  mode: 'demo', // 'demo' | 'api'
  apiBase: '/api',
  turnstileSiteKey: '', // Add Cloudflare Turnstile Site Key for production
  randomizePollOptions: false,

  issues: [
    { id: 'rozgar', hi: 'रोज़गार और युवा अवसर', en: 'Employment & Youth Opportunities' },
    { id: 'mehangai', hi: 'महंगाई और रोज़मर्रा खर्च', en: 'Inflation & Cost of Living' },
    { id: 'sadak_bijli', hi: 'सड़क, बिजली और पानी', en: 'Roads, Electricity & Water' },
    { id: 'shiksha', hi: 'शिक्षा और स्कूल-कॉलेज', en: 'Education & Schools' },
    { id: 'swasthya', hi: 'स्वास्थ्य और अस्पताल सुविधाएँ', en: 'Healthcare & Hospitals' },
    { id: 'kanoon', hi: 'क़ानून-व्यवस्था और सुरक्षा', en: 'Law & Order / Public Safety' },
    { id: 'kisan', hi: 'किसान और कृषि मुद्दे', en: 'Farmers & Agriculture Issues' },
  ],

  /**
   * Poll options in user-specified order:
   * 1. NDA -> 2. SP-Congress -> 3. Samajik Parivartan Morcha -> 4. BSP -> 5. Anya
   * Followed by fixed neutral choices (Undecided, NOTA).
   */
  pollOptions: [
    {
      id: 'nda',
      hi: 'एनडीए गठबंधन (NDA)',
      en: 'NDA Alliance',
      leaderHi: 'योगी आदित्यनाथ • जयंत चौधरी व सहयोगी',
      leaderEn: 'Yogi Adityanath • Jayant Chaudhary & Allies',
      avatar: './assets/leaders/bjp.png',
      avatars: ['./assets/leaders/bjp.png', './assets/leaders/rld.png'],
    },
    {
      id: 'sp_inc',
      hi: 'सपा – कांग्रेस गठबंधन',
      en: 'SP – Congress Alliance',
      leaderHi: 'अखिलेश यादव • राहुल गांधी',
      leaderEn: 'Akhilesh Yadav • Rahul Gandhi',
      avatar: './assets/leaders/sp.png',
      avatars: ['./assets/leaders/sp.png', './assets/leaders/inc.png'],
    },
    {
      id: 'spm',
      hi: 'सामाजिक परिवर्तन मोर्चा',
      en: 'Samajik Parivartan Morcha',
      leaderHi: 'चंद्रशेखर आज़ाद • असदुद्दीन ओवैसी',
      leaderEn: 'Chandrashekhar Azad • Asaduddin Owaisi',
      avatar: './assets/leaders/asp.png',
      avatars: ['./assets/leaders/asp.png', './assets/leaders/aimim.png'],
    },
    {
      id: 'bsp',
      hi: 'बहुजन समाज पार्टी (BSP)',
      en: 'Bahujan Samaj Party (BSP)',
      leaderHi: 'मायावती',
      leaderEn: 'Mayawati',
      avatar: './assets/leaders/bsp.png',
      avatars: ['./assets/leaders/bsp.png'],
    },
    {
      id: 'other_ind',
      hi: 'अन्य / निर्दलीय',
      en: 'Other / Independent',
      leaderHi: 'अन्य क्षेत्रीय दल या स्थानीय उम्मीदवार',
      leaderEn: 'Other regional party or independent',
      icon: 'other',
    },
    {
      id: 'undecided',
      hi: 'अभी तय नहीं किया (Undecided)',
      en: 'Undecided / Still Thinking',
      leaderHi: 'निर्णय लेना बाकी',
      leaderEn: 'Not yet decided',
      icon: 'undecided',
      pinBottom: true,
    },
    {
      id: 'nota',
      hi: 'NOTA / कोई नहीं',
      en: 'NOTA / None of the Above',
      leaderHi: 'उपरोक्त में से कोई नहीं',
      leaderEn: 'None of the above',
      icon: 'nota',
      pinBottom: true,
    },
  ],

  ageGroups: [
    { id: '18-25', hi: '18 – 25 वर्ष', en: '18 – 25 years' },
    { id: '26-40', hi: '26 – 40 वर्ष', en: '26 – 40 years' },
    { id: '41-60', hi: '41 – 60 वर्ष', en: '41 – 60 years' },
    { id: '60+', hi: '60+ वर्ष', en: '60+ years' },
  ],
};

const I18N = {
  hi: {
    brandTitle: 'UP जनमत सर्वे',
    loading: 'सर्वे लोड हो रहा है...',
    loadError: 'डेटा लोड करने में समस्या आई। कृपया पेज रीफ़्रेश करें।',
    splashStepLabel: 'UP 2027',
    stepLabel: (n) => `सवाल ${n} / 5`,
    resultsStepLabel: 'लाइव नतीजे',
    back: '← पिछला',
    next: 'आगे बढ़ें →',
    submit: 'राय सबमिट करें →',
    skipAge: 'यह सवाल छोड़ें और नतीजे देखें →',

    splashEyebrow: 'उत्तर प्रदेश विधानसभा जनमत सर्वे 2027',
    splashTitleLead: '2027 में यूपी में',
    splashTitleHighlight: 'किसकी सरकार?',
    splashSubtitle: 'सभी 75 ज़िलों और 403 विधानसभा सीटों की असली आवाज़। सिर्फ 20 सेकंड में अपनी राय दें और तुरंत लाइव ग्राफ़ देखें।',
    splashStatDistricts: '75 ज़िले',
    splashStatSeats: '403 सीटें',
    splashStatTime: '20 सेकंड',
    splashStartCta: 'अपनी राय दें — सर्वे शुरू करें →',
    splashInvitedCta: (seatName) => `${seatName} के लिए राय दें →`,
    splashTrust1: '✓ बिना लॉगिन / OTP',
    splashTrust2: '✓ 100% गुप्त',
    splashTrust3: '✓ लाइव सर्किल व बार ग्राफ़',

    step1Eyebrow: 'सवाल 1 • आपका ज़िला',
    step1Title: 'आप उत्तर प्रदेश के किस ज़िले से हैं?',
    step1Subtitle: 'सभी 75 ज़िलों में से अपना ज़िला चुनें — सिर्फ 20 सेकंड, बिना लॉगिन।',
    trustPill: '⚡ 20 सेकंड • 100% गोपनीय राय',
    districtFieldLabel: 'अपना ज़िला चुनें',
    districtBadge: (n) => `${n} ज़िले`,
    districtSelectPlaceholder: 'यहाँ से ज़िला चुनें (75 ज़िले)',
    districtPlaceholder: 'ज़िला खोजें (जैसे लखनऊ, आगरा, वाराणसी)...',
    noMatch: 'कोई मिलान नहीं मिला',
    invitedSeatPrefix: 'शेयर की गई सीट:',
    invitedSeatAction: 'यही चुनें',

    step2Eyebrow: 'सवाल 2 • विधानसभा सीट',
    step2Title: (districtName) => `${districtName} में आपकी विधानसभा सीट कौन-सी है?`,
    step2Subtitle: (n) => `इस ज़िले की ${n} विधानसभा सीटों में से अपनी सीट चुनें।`,
    seatFieldLabel: 'अपनी विधानसभा सीट चुनें',
    seatBadge: (n) => `${n} सीटें`,
    seatSelectPlaceholder: 'यहाँ से विधानसभा सीट चुनें',
    seatPlaceholder: 'सीट का नाम या नंबर खोजें (जैसे 175)...',

    step3Eyebrow: 'सवाल 3 • मुख्य मुद्दा',
    step3Title: 'इस बार आपके लिए सबसे बड़ा मुद्दा क्या है?',
    step3Subtitle: 'अपने क्षेत्र की सबसे ज़रूरी प्राथमिकता चुनें।',

    step4Eyebrow: 'सवाल 4 • जनमत राय',
    step4Title: 'आज की स्थिति में आपकी प्राथमिकता क्या है?',
    step4Subtitle: 'अपनी पसंद चुनें — आपकी पहचान पूरी तरह गोपनीय रहती है।',
    neutralDivider: 'तटस्थ विकल्प',

    step5Eyebrow: 'सवाल 5 • आयु वर्ग (वैकल्पिक)',
    step5Title: 'आपका आयु वर्ग क्या है?',
    step5Subtitle: 'यह वैकल्पिक है — इससे बेहतर जनसांख्यिकीय विश्लेषण मिलता है।',

    resultsEyebrow: 'धन्यवाद • आपकी राय दर्ज हो गई',
    resultsTitle: (seatName) => `${seatName} और पूरे UP का लाइव ट्रेंड`,
    resultsSubtitle: 'नीचे आपकी विधानसभा और पूरे उत्तर प्रदेश का प्रतिशत विश्लेषण है।',
    demoBanner: 'प्रोटोटाइप डेमो मोड: अभी आंकड़े सिर्फ आपके ब्राउज़र में सेव हो रहे हैं।',
    demoReset: 'टेस्ट रीसेट',
    tabSeat: (seatName) => `आपकी सीट (${seatName})`,
    tabState: 'पूरा उत्तर प्रदेश (403)',
    seatSwitcherLabel: 'किसी अन्य विधानसभा सीट के इन्फोग्राफिक्स देखें',
    kpiVotes: 'कुल दर्ज राय',
    kpiTopIssue: 'प्रमुख मुद्दा',
    kpiTopTrend: 'शीर्ष प्राथमिकता',
    donutVotesLabel: 'कुल मत',
    circleTag: 'सर्किल ग्राफ़',
    barTag: 'बार ग्राफ़',
    columnTag: 'कॉलम ग्राफ़',
    totalResponses: (n) => `कुल दर्ज राय: ${n}`,
    pollTrendHeading: 'जनमत प्राथमिकता ट्रेंड',
    topIssuesHeading: 'प्रमुख मुद्दे',
    ageHeading: 'आयु वर्ग वितरण',
    yourChoiceTag: 'आपकी पसंद',
    noDataYet: 'इस सीट पर अभी कोई डेटा दर्ज नहीं है।',

    shareTitle: 'अपने ज़िले के दोस्तों से पूछें',
    shareDesc: 'अपने क्षेत्र के ज़्यादा लोगों की राय जोड़ने के लिए नीचे लिंक शेयर करें।',
    shareWhatsapp: 'WhatsApp पर शेयर करें',
    copyLink: 'लिंक कॉपी करें',
    copiedToast: 'लिंक कॉपी हो गया!',
    shareMessage: (seatName, url) =>
      `मैंने ${seatName} विधानसभा के लिए अपनी राय दे दी है। देखें अभी क्या ट्रेंड है और अपनी राय दें: ${url}`,

    footerDisclaimer:
      'अस्वीकरण: यह एक स्वतंत्र जनमत सर्वेक्षण (Independent Public Opinion Survey) है। यह किसी राजनीतिक दल, निर्वाचन आयोग (ECI) या सरकारी पोर्टल से संबद्ध नहीं है और न ही यह आधिकारिक चुनावी परिणाम है।',
  },
  en: {
    brandTitle: 'UP Opinion Survey',
    loading: 'Loading survey...',
    loadError: 'Unable to load survey data. Please refresh the page.',
    splashStepLabel: 'UP 2027',
    stepLabel: (n) => `Question ${n} of 5`,
    resultsStepLabel: 'Live Trends',
    back: '← Back',
    next: 'Continue →',
    submit: 'Submit Opinion →',
    skipAge: 'Skip & View Live Results →',

    splashEyebrow: 'UP Vidhan Sabha Public Opinion 2027',
    splashTitleLead: 'Who Will Form the',
    splashTitleHighlight: '2027 UP Government?',
    splashSubtitle: 'Voices from all 75 districts & 403 constituencies. Share your opinion in 20 seconds and explore live visual trends.',
    splashStatDistricts: '75 Districts',
    splashStatSeats: '403 Seats',
    splashStatTime: '20 Seconds',
    splashStartCta: 'Start 20-Second Survey →',
    splashInvitedCta: (seatName) => `Vote for ${seatName} →`,
    splashTrust1: '✓ No Login / OTP',
    splashTrust2: '✓ 100% Anonymous',
    splashTrust3: '✓ Live Infographic Trends',

    step1Eyebrow: 'Question 1 • District',
    step1Title: 'Which district of Uttar Pradesh are you from?',
    step1Subtitle: 'Choose from all 75 districts — takes 20 seconds, zero login.',
    trustPill: '⚡ 20 sec • 100% Anonymous',
    districtFieldLabel: 'Select District',
    districtBadge: (n) => `${n} districts`,
    districtSelectPlaceholder: 'Choose district (75 districts)',
    districtPlaceholder: 'Search district (e.g. Lucknow, Agra, Varanasi)...',
    noMatch: 'No matching results found',
    invitedSeatPrefix: 'Shared seat:',
    invitedSeatAction: 'Select this',

    step2Eyebrow: 'Question 2 • Vidhan Sabha Seat',
    step2Title: (districtName) => `Which Vidhan Sabha seat in ${districtName}?`,
    step2Subtitle: (n) => `Select your constituency from ${n} seats in this district.`,
    seatFieldLabel: 'Select Vidhan Sabha Seat',
    seatBadge: (n) => `${n} seats`,
    seatSelectPlaceholder: 'Choose Vidhan Sabha seat',
    seatPlaceholder: 'Search seat name or number (e.g. 175)...',

    step3Eyebrow: 'Question 3 • Key Issue',
    step3Title: 'What is the biggest issue for you this time?',
    step3Subtitle: 'Choose the single top priority for your constituency.',

    step4Eyebrow: 'Question 4 • Opinion Poll',
    step4Title: 'What is your current preference?',
    step4Subtitle: 'Choose your preference — your response stays completely anonymous.',
    neutralDivider: 'Neutral choices',

    step5Eyebrow: 'Question 5 • Age Group (Optional)',
    step5Title: 'Which age group do you belong to?',
    step5Subtitle: 'Optional — helps understand trends across age groups.',

    resultsEyebrow: 'Thank you • Opinion Recorded',
    resultsTitle: (seatName) => `Live Trend: ${seatName} & All UP`,
    resultsSubtitle: 'Instant percentage breakdown for your constituency and statewide UP.',
    demoBanner: 'Prototype Demo Mode: Counts are stored locally in your browser.',
    demoReset: 'Reset Test',
    tabSeat: (seatName) => `Your Seat (${seatName})`,
    tabState: 'All UP (403 Seats)',
    seatSwitcherLabel: 'Switch constituency to inspect infographics',
    kpiVotes: 'Responses',
    kpiTopIssue: 'Top Issue',
    kpiTopTrend: 'Top Choice',
    donutVotesLabel: 'Total Votes',
    circleTag: 'Circle Graph',
    barTag: 'Bar Graph',
    columnTag: 'Column Graph',
    totalResponses: (n) => `Total responses: ${n}`,
    pollTrendHeading: 'Opinion Preference Trend',
    topIssuesHeading: 'Top Issues',
    ageHeading: 'Age Group Breakdown',
    yourChoiceTag: 'Your pick',
    noDataYet: 'No responses recorded for this seat yet.',

    shareTitle: 'Ask friends in your district',
    shareDesc: 'Share with people in your constituency to build a stronger local sample.',
    shareWhatsapp: 'Share on WhatsApp',
    copyLink: 'Copy Survey Link',
    copiedToast: 'Link copied!',
    shareMessage: (seatName, url) =>
      `I just shared my opinion for ${seatName} Vidhan Sabha. Check the current trend and add your vote: ${url}`,

    footerDisclaimer:
      'Disclaimer: This is an independent public opinion survey. It is not affiliated with any political party, the Election Commission of India, or any government website, and is not official election data.',
  },
};

global.UP_SURVEY = { CONFIG, I18N };
})(typeof window !== 'undefined' ? window : globalThis);
