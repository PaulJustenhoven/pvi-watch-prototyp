/*
 * PVI-Watch Prototyp – synthetische Studienkohorte + lokale Ablage (localStorage)
 * Keine echten Patientendaten. Alle Zeitpunkte relativ zu "heute".
 */
(function (global) {
  'use strict';
  const DAY = 86400000;
  const BLANKING_DAYS = 90;

  // ---------- Ablage (simuliert das Backend) ----------
  const Store = {
    K: { ecg: 'pviw.demo.ecgs', evt: 'pviw.demo.events', rev: 'pviw.reviews', audit: 'pviw.audit', contact: 'pviw.contacts', app: 'pviw.patientapp', req: 'pviw.requests' },
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { localStorage.setItem(k, JSON.stringify(v)); localStorage.setItem('pviw.version', String(Date.now())); },
    push(k, item) { const a = this.get(k, []); a.push(item); this.set(k, a); },
    audit(action, detail, user) {
      this.push(this.K.audit, { t: new Date().toISOString(), user: user || 'Dr. Prüfarzt (Demo)', action, detail });
    },
    reset() { Object.values(this.K).forEach(k => localStorage.removeItem(k)); localStorage.setItem('pviw.version', String(Date.now())); },
  };

  // ---------- Geräte / Schnittstellen ----------
  const DEVICES = {
    apple:    { vendor: 'Apple',    model: 'Apple Watch Series 10', path: 'Thryve SDK → Apple Health (iOS)', ecg: true },
    samsung:  { vendor: 'Samsung',  model: 'Galaxy Watch 7',        path: 'Samsung Health Sensor SDK (direkt, Partnerzugang)', ecg: true },
    fitbit:   { vendor: 'Fitbit',   model: 'Fitbit Sense 2',        path: 'Thryve → Google Health (Cloud)', ecg: true },
    pixel:    { vendor: 'Google',   model: 'Pixel Watch 3',         path: 'Thryve → Google Health (Cloud)', ecg: true },
    withings: { vendor: 'Withings', model: 'ScanWatch 2',           path: 'Thryve → Withings (Cloud)', ecg: true },
  };

  // Simulierte Hersteller-Klassifikation (so wie sie über die Schnittstelle käme)
  function vendorClass(devKey, rhythm, hr) {
    const map = {
      sinus: 'Sinusrhythmus', af: 'Vorhofflimmern', flutter: 'Nicht eindeutig',
      artifact: 'Schlechte Aufzeichnung', sves: 'Nicht eindeutig',
      tachy: hr > 150 ? 'Hohe Herzfrequenz' : (devKey === 'fitbit' || devKey === 'pixel') && hr > 120 ? 'Nicht eindeutig' : 'Sinusrhythmus',
    };
    if (devKey === 'apple' && rhythm === 'sves') return 'Sinusrhythmus';
    return map[rhythm] || 'Nicht eindeutig';
  }
  const vendorCode = label => label === 'Vorhofflimmern' ? 'af' : label === 'Sinusrhythmus' ? 'sr' : 'unclear';

  const DEFAULT_HR = { sinus: [58, 78], af: [92, 128], tachy: [124, 138], flutter: [145, 150], sves: [64, 76], artifact: [66, 84] };
  const TRUE_FINDING = { sinus: 'SR', af: 'VHF', tachy: 'ST', flutter: 'AFL', sves: 'SR_ES', artifact: 'NB' };

  // Reihenfolge = Tastenkürzel 1–8; Gruppen für das Befundformular
  const FINDINGS = {
    SR: 'Sinusrhythmus', SR_ES: 'SR mit Extrasystolen', ST: 'Sinustachykardie',
    VHF: 'Vorhofflimmern', AFL: 'Vorhofflattern', AT: 'Atriale Tachykardie',
    SVT: 'Andere SVT / Tachykardie', NB: 'Nicht beurteilbar',
  };
  const FINDING_GROUPS = [
    ['Ohne Rezidiv', ['SR', 'SR_ES', 'ST']],
    ['Rezidiv-relevant (VHF/AFL/AT)', ['VHF', 'AFL', 'AT']],
    ['Sonstige', ['SVT', 'NB']],
  ];
  const RECURRENCE = new Set(['VHF', 'AFL', 'AT']);
  const ACTION_FINDINGS = new Set(['VHF', 'AFL', 'AT', 'SVT']); // erfordern dokumentierte Maßnahme
  const ALGO_VERSION = 'RR-Irregularität v0.1 (Demo, nicht validiert)';

  // ---------- Kohorte ----------
  // ecg: [daysAgo, rhythm, trigger, {hr, hour, unreviewed, symptoms, reviewedAs}]
  const SPECS = [
    { id: 'VHF-001', age: 61, sex: 'm', dev: 'apple', pvi: 118, demo: true, note: 'Demo-Patient (mit Patienten-App verknüpft)' },
    { id: 'VHF-002', age: 67, sex: 'm', dev: 'fitbit', pvi: 141,
      extra: [[0.4, 'af', 'Symptome', { symptoms: ['Herzrasen', 'Herzstolpern'], unreviewed: true, hour: 21 }]],
      events: [[0.45, 'IRN', 'Hinweis „Unregelmäßiger Rhythmus“ der Uhr']] },
    { id: 'VHF-003', age: 58, sex: 'w', dev: 'withings', pvi: 46,
      extra: [[1.2, 'af', 'Geplant', { unreviewed: true, hour: 8 }]] },
    { id: 'VHF-004', age: 72, sex: 'm', dev: 'samsung', pvi: 203,
      extra: [[0.2, 'flutter', 'HF-Alarm', { unreviewed: true, hour: 14 }]],
      events: [[0.25, 'HR', 'Ruhe-HF 149/min über 14 min', 149]], spike: [0, 149] },
    { id: 'VHF-005', age: 55, sex: 'w', dev: 'apple', pvi: 97,
      events: [[0.08, 'HR', 'Ruhe-HF 124/min über 11 min', 124, true]], spike: [0, 124] },
    { id: 'VHF-006', age: 69, sex: 'm', dev: 'withings', pvi: 162 },
    { id: 'VHF-007', age: 64, sex: 'w', dev: 'pixel', pvi: 31,
      extra: [[0.6, 'artifact', 'Symptome', { symptoms: ['Schwindel'], unreviewed: true, hour: 17 }]] },
    { id: 'VHF-008', age: 70, sex: 'w', dev: 'apple', pvi: 251,
      extra: [[1.5, 'sves', 'Symptome', { symptoms: ['Herzstolpern'], unreviewed: true, hour: 22 }]] },
    { id: 'VHF-009', age: 59, sex: 'm', dev: 'withings', pvi: 184, lastData: 12 },
    { id: 'VHF-010', age: 66, sex: 'm', dev: 'samsung', pvi: 133,
      extra: [[9, 'af', 'Symptome', { symptoms: ['Herzrasen', 'Luftnot'], hour: 7, hr: 118 }]],
      contacts: [[7.8, 'Telefonat', 'Einbestellung Rhythmusambulanz', 'Pat. symptomatisch (Herzrasen), Vorstellung Do. 8:30, OAK fortgeführt']] },
    { id: 'VHF-011', age: 52, sex: 'w', dev: 'fitbit', pvi: 77 },
    { id: 'VHF-012', age: 74, sex: 'm', dev: 'apple', pvi: 305 },
    { id: 'VHF-013', age: 63, sex: 'w', dev: 'samsung', pvi: 64,
      extra: [[2.1, 'tachy', 'HF-Alarm', { hr: 128, unreviewed: true, hour: 11 }]], spike: [2, 131] },
    { id: 'VHF-014', age: 57, sex: 'm', dev: 'withings', pvi: 112 },
    { id: 'VHF-015', age: 68, sex: 'w', dev: 'pixel', pvi: 189 },
    { id: 'VHF-016', age: 60, sex: 'm', dev: 'apple', pvi: 23 },
  ];

  function at(daysAgo, hour) {
    const t = new Date(); t.setMinutes(0, 0, 0);
    if (daysAgo < 1) return new Date(t.getTime() - daysAgo * DAY);
    const d = new Date(t.getTime() - Math.floor(daysAgo) * DAY);
    d.setHours(hour == null ? 9 : hour, Math.floor((daysAgo % 1) * 60));
    return d;
  }

  let ecgCounter = 0;
  function mkEcg(p, rng, daysAgo, rhythm, trigger, o = {}) {
    const [lo, hi] = DEFAULT_HR[rhythm];
    const hr = o.hr || Math.round(lo + rng() * (hi - lo));
    const t = at(daysAgo, o.hour == null ? 7 + Math.floor(rng() * 13) : o.hour);
    const vc = vendorClass(p.dev, rhythm, hr);
    const e = {
      id: `${p.id}-E${String(++ecgCounter).padStart(3, '0')}`, patientId: p.id, t: t.toISOString(),
      rhythm, hr, seed: Math.floor(rng() * 1e6), trigger, symptoms: o.symptoms || [],
      vendorClass: vc, vendorCode: vendorCode(vc), source: DEVICES[p.dev].path,
    };
    // ältere EKGs gelten als bereits befundet (Vorbefunde der Demo)
    if (!o.unreviewed && daysAgo > (trigger === 'Geplant' && rhythm === 'sinus' ? 1.0 : 2.5)) {
      e.initialReview = { finding: o.reviewedAs || TRUE_FINDING[rhythm], by: 'Dr. Studienärztin (Demo)', t: new Date(t.getTime() + 0.6 * DAY).toISOString(), ge30s: rhythm === 'af' || rhythm === 'flutter', history: [] };
    }
    return e;
  }

  function buildCohort() {
    ecgCounter = 0;
    return SPECS.map((s, idx) => {
      const rng = ECG.mulberry32(4242 + idx * 97);
      const dev = DEVICES[s.dev];
      const pviDate = new Date(Date.now() - s.pvi * DAY); pviDate.setHours(8, 0, 0, 0);
      const ecgs = [];
      const start = s.lastData || 1 + rng() * 2;
      if (dev.ecg) {
        for (let d = start; d <= 30 && d < s.pvi; d += 3 + Math.floor(rng() * 2)) ecgs.push(mkEcg(s, rng, d, 'sinus', 'Geplant'));
        (s.extra || []).forEach(([d, r, trig, o]) => ecgs.push(mkEcg(s, rng, d, r, trig, o)));
      }
      ecgs.sort((a, b) => new Date(b.t) - new Date(a.t));

      // tägliche Herzfrequenz (letzte 30 Tage): max. Ruhe-HF
      const base = 58 + rng() * 14;
      const hrDaily = [];
      for (let d = 29; d >= 0; d--) {
        if (s.lastData && d < s.lastData) continue;
        let v = base + 14 + ECG.gauss(rng) * 5;
        (s.extra || []).forEach(([ed, r, , o]) => { if (Math.floor(ed) === d && (r === 'af' || r === 'flutter' || r === 'tachy')) v = Math.max(v, (o && o.hr) || DEFAULT_HR[r][1] + 4); });
        if (s.spike && s.spike[0] === d) v = s.spike[1];
        const date = new Date(Date.now() - d * DAY); date.setHours(0, 0, 0, 0);
        hrDaily.push({ date: date.toISOString(), maxRest: Math.round(v), rest: Math.round(base + ECG.gauss(rng) * 2) });
      }

      const events = (s.events || []).map(([d, type, text, value, pending]) => ({
        id: `${s.id}-EV${Math.floor(d * 1000)}`, patientId: s.id, t: at(d).toISOString(), type, text, value: value || null,
        ecgRequested: type === 'HR' || type === 'IRN', pending: !!pending,
      }));

      const lastSync = s.lastData ? at(s.lastData, 20) : new Date(Date.now() - (0.05 + rng() * 0.4) * DAY);
      const clin = {
        afType: rng() < 0.65 ? 'paroxysmal' : 'persistierend',
        energy: ['Pulsed Field (PFA)', 'Kryoballon', 'Radiofrequenz'][Math.floor(rng() * 3)],
        lesions: rng() < 0.75 ? 'nur PVI' : (rng() < 0.5 ? 'PVI + CTI-Linie' : 'PVI + Hinterwand'),
        aad: s.pvi <= 90 && rng() < 0.6 ? 'Flecainid 100 mg 1-0-1 (Absetzen geplant Tag 90)' : (rng() < 0.12 ? 'Amiodaron 200 mg 1-0-0' : 'keine'),
        oak: rng() < 0.85 ? ['Apixaban 5 mg 1-0-1', 'Rivaroxaban 20 mg 0-0-1', 'Edoxaban 60 mg 1-0-0'][Math.floor(rng() * 3)] : 'keine',
        bb: rng() < 0.5 ? 'Bisoprolol 2,5 mg 1-0-0' : 'keine',
        cha: Math.min(6, Math.max(0, Math.round((s.age - 55) / 7 + rng() * 2))),
        asOf: new Date(pviDate.getTime() + DAY).toISOString(),
      };
      return {
        id: s.id, age: s.age, sex: s.sex, clin, devKey: s.dev, device: dev, pviDate: pviDate.toISOString(),
        ecgs, hrDaily, events, lastSync: lastSync.toISOString(), demo: !!s.demo, note: s.note || '',
        seedContacts: (s.contacts || []).map(([d, method, outcome, note]) => ({ patientId: s.id, t: at(d, 14).toISOString(), method, outcome, note, by: 'Dr. Studienärztin (Demo)', ref: null, followUp: null })),
      };
    });
  }

  // Demo-Daten aus der Patienten-App (localStorage) einmischen
  function mergeDemo(cohort) {
    const demoEcgs = Store.get(Store.K.ecg, []);
    const demoEvts = Store.get(Store.K.evt, []);
    const appState = Store.get(Store.K.app, {});
    cohort.forEach(p => {
      if (p.demo && appState.watch && DEVICES[appState.watch]) { p.devKey = appState.watch; p.device = DEVICES[appState.watch]; }
      const mine = demoEcgs.filter(e => e.patientId === p.id);
      if (mine.length) { p.ecgs = [...mine, ...p.ecgs].sort((a, b) => new Date(b.t) - new Date(a.t)); p.lastSync = mine[mine.length - 1].t; }
      const ev = demoEvts.filter(e => e.patientId === p.id);
      if (ev.length) p.events = [...ev, ...p.events];
      // Ein angefordertes EKG gilt als erledigt, sobald danach ein EKG eingeht
      p.events.forEach(e => {
        if (e.ecgRequested) {
          const after = p.ecgs.find(x => new Date(x.t) > new Date(e.t));
          e.pending = !after;
          e.resolvedBy = after ? after.id : null;
        }
      });
      const reqs = Store.get(Store.K.req, []).filter(r => r.patientId === p.id);
      reqs.forEach(r => {
        const after = p.ecgs.find(x => new Date(x.t) > new Date(r.t));
        p.events.unshift({ id: r.id, patientId: p.id, t: r.t, type: 'REQ', text: 'EKG vom Studienteam angefordert', ecgRequested: true, pending: !after, resolvedBy: after ? after.id : null });
      });
    });
    return cohort;
  }

  function loadCohort() {
    const c = mergeDemo(buildCohort());
    const reviews = Store.get(Store.K.rev, {});
    c.forEach(p => p.ecgs.forEach(e => { e.review = reviews[e.id] || e.initialReview || null; }));
    return c;
  }

  const daysSince = iso => (Date.now() - new Date(iso).getTime()) / DAY;
  const dayPostPvi = (p, iso) => Math.floor((new Date(iso || Date.now()) - new Date(p.pviDate)) / DAY);

  global.PVI = { Store, DEVICES, FINDINGS, FINDING_GROUPS, RECURRENCE, ACTION_FINDINGS, ALGO_VERSION, BLANKING_DAYS, DAY, loadCohort, vendorClass, vendorCode, daysSince, dayPostPvi, DEFAULT_HR };
})(window);
