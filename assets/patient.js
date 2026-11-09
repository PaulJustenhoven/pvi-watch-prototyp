/* PVI-Watch Prototyp – Patienten-App (Klick-Dummy, verknüpft mit VHF-001) */
(function () {
  'use strict';
  const { Store, DEVICES, DAY } = PVI;
  const PID = 'VHF-001';
  const PVI_DAYS = 118; // muss zur Kohorte passen
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  if (window.self !== window.top) document.body.classList.add('embed');
  if (new URLSearchParams(location.search).has('nodemo')) document.querySelector('.demo').style.display = 'none';

  const WATCHES = [
    ['apple', '⌚', 'Apple Watch', 'Über Apple Health (HealthKit) auf diesem iPhone'],
    ['samsung', '⌚', 'Samsung Galaxy Watch', 'Über Samsung Health'],
    ['fitbit', '⌚', 'Fitbit', 'Anmeldung beim Fitbit/Google-Konto'],
    ['pixel', '⌚', 'Google Pixel Watch', 'Anmeldung beim Fitbit/Google-Konto'],
    ['withings', '⌚', 'Withings ScanWatch', 'Anmeldung beim Withings-Konto'],
  ];
  const SYMPTOMS = ['Herzrasen', 'Herzstolpern', 'Schwindel', 'Luftnot', 'Brustdruck', 'Leistungsknick'];

  const app = Object.assign({ step: 'welcome', watch: null, consents: {} }, Store.get(Store.K.app, {}));
  let ui = { tab: 'home', screen: null, symptoms: [], trigger: null };
  const save = () => Store.set(Store.K.app, { step: app.step, watch: app.watch, consents: app.consents });

  // ---------- Daten ----------
  const myEcgs = () => Store.get(Store.K.ecg, []).filter(e => e.patientId === PID).sort((a, b) => new Date(b.t) - new Date(a.t));
  function pendingAsks() {
    const ecgs = myEcgs();
    const asks = [
      ...Store.get(Store.K.evt, []).filter(e => e.patientId === PID).map(e => ({ t: e.t, kind: e.type, text: e.text })),
      ...Store.get(Store.K.req, []).filter(r => r.patientId === PID).map(r => ({ t: r.t, kind: 'REQ', text: 'Ihr Studienteam bittet Sie um eine EKG-Aufzeichnung.' })),
    ];
    return asks.filter(a => !ecgs.some(e => new Date(e.t) > new Date(a.t))).sort((a, b) => new Date(b.t) - new Date(a.t));
  }

  // ---------- Rendering ----------
  const fmtDT = iso => { const d = new Date(iso); return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + ', ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr'; };

  function render() {
    const c = $('#content'), tabs = $('#tabs');
    const onboarding = app.step !== 'done';
    tabs.style.display = onboarding || ui.screen ? 'none' : 'flex';
    c.innerHTML = onboarding ? onboardingView() : ui.screen ? screenView() : tabView();
    tabs.innerHTML = [['home', '🏠', 'Start'], ['hist', '📈', 'Verlauf'], ['study', '📄', 'Studie']]
      .map(([k, i, l]) => `<button class="${ui.tab === k ? 'on' : ''}" data-tab="${k}"><span class="i">${i}</span>${l}</button>`).join('');
    bind();
    updatePush();
  }

  function onboardingView() {
    switch (app.step) {
      case 'welcome': return `
        <div style="margin-top:40px" class="center"><div style="font-size:64px">🫀</div>
        <div class="hello">PVI-Watch</div>
        <div class="sub" style="margin-top:6px">Studien-App zur Nachbeobachtung nach Ihrer Katheterablation (Pulmonalvenenisolation)</div></div>
        <div class="pcard sub" style="margin-top:20px">Ihre Smartwatch übermittelt Herzfrequenz und EKG-Aufzeichnungen verschlüsselt an Ihr Studienteam. Ärztinnen und Ärzte sehen sich die Daten an und melden sich bei Auffälligkeiten.</div>
        <div class="spacer"></div>
        <button class="primary big" data-go="scan">Teilnahme starten</button>`;
      case 'scan': return `
        <div class="step">Schritt 1 von 4</div><h2>Studien-Code scannen</h2>
        <div class="sub">Den QR-Code haben Sie bei der Entlassung erhalten. Er verknüpft die App mit Ihrer pseudonymisierten Studien-ID. Ihr Name wird in der App nicht gespeichert.</div>
        <div class="qr">▦</div>
        <div class="spacer"></div>
        <button class="primary big" data-go="consent">Code erkannt (Demo) → ${PID}</button>`;
      case 'consent': {
        const items = [['info', 'Ich habe die Studieninformation gelesen und hatte Gelegenheit, Fragen zu stellen.'],
          ['data', 'Ich willige in die Verarbeitung meiner Gesundheitsdaten (EKG, Herzfrequenz, Rhythmus-Hinweise) zu Studienzwecken ein (Art. 9 DSGVO).'],
          ['contact', 'Das Studienteam darf mich bei auffälligen Befunden kontaktieren.'],
          ['emerg', 'Mir ist bewusst, dass die App kein Notfallsystem ist. Bei akuten Beschwerden rufe ich 112.']];
        const all = items.every(([k]) => app.consents[k]);
        return `<div class="step">Schritt 2 von 4</div><h2>Einwilligung</h2>
          <div class="sub">Die schriftliche Einwilligung liegt im Prüfzentrum vor. Hier bestätigen Sie sie digital.</div>
          <div class="pcard">${items.map(([k, t]) => `<label class="chk"><input type="checkbox" data-consent="${k}" ${app.consents[k] ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>
          <div class="small muted">Sie können die Teilnahme jederzeit ohne Nachteile beenden.</div>
          <div class="spacer"></div>
          <button class="primary big" data-go="watch" ${all ? '' : 'disabled'}>Weiter</button>`;
      }
      case 'watch': return `<div class="step">Schritt 3 von 4</div><h2>Welche Uhr tragen Sie?</h2>
        ${WATCHES.map(([k, i, n, d]) => `<button class="choice ${app.watch === k ? 'on' : ''}" data-watch="${k}"><span style="font-size:24px">${i}</span><span><b>${n}</b><br><span class="sm">${d}</span></span></button>`).join('')}
        <button class="primary big" data-go="connect" ${app.watch ? '' : 'disabled'}>Weiter</button>`;
      case 'connect': {
        const d = DEVICES[app.watch];
        const perms = d.ecg ? ['EKG', 'Herzfrequenz', 'Unregelmäßiger Herzrhythmus', 'Ruheherzfrequenz'] : ['Herzfrequenz', 'Ruheherzfrequenz', 'Aktivität'];
        const isLocal = app.watch === 'apple' || app.watch === 'samsung';
        return `<div class="step">Schritt 4 von 4</div><h2>${esc(d.vendor)} verbinden</h2>
          <div class="sub">${isLocal ? 'Die Daten werden auf diesem Telefon gelesen und verschlüsselt übertragen.' : `Sie melden sich einmalig bei ${esc(d.vendor)} an und erlauben den Zugriff (OAuth). Ihr Passwort sehen wir nicht.`}</div>
          <div class="sheet">
            <div class="h">${isLocal ? (app.watch === 'apple' ? 'Health-Zugriff' : 'Samsung Health') : esc(d.vendor) + ' · Zugriff erlauben'}</div>
            <div class="r small ink2" style="display:block">„PVI-Watch“ möchte folgende Daten <b>lesen</b>:</div>
            ${perms.map(p => `<div class="r"><span>${p}</span><span class="switch"></span></div>`).join('')}
          </div>
          ${d.ecg ? '' : '<div class="pcard small">ℹ Für Ihr Gerät kann die Studie keine EKG-Kurven abrufen. Sie erhalten Hinweise bei auffälliger Herzfrequenz.</div>'}
          <div class="spacer"></div>
          <button class="primary big" data-go="done">Erlauben & verbinden</button>`;
      }
    }
    return '';
  }

  function tabView() {
    const d = DEVICES[app.watch];
    const ecgs = myEcgs();
    if (ui.tab === 'hist') {
      const reviews = Store.get(Store.K.rev, {});
      return `<div class="hello">Verlauf</div>
        <div class="pcard"><ul class="hist">${ecgs.length ? ecgs.map(e => `<li><span>${fmtDT(e.t)}<br><span class="small muted">${esc(e.trigger)}${e.symptoms.length ? ' · ' + esc(e.symptoms.join(', ')) : ''}</span></span>
          <span class="small ${reviews[e.id] ? 'ok' : 'ink2'}" style="text-align:right">${reviews[e.id] ? '✓ vom Studienteam<br>angesehen' : '✓ übermittelt'}</span></li>`).join('') : '<li class="muted">Noch keine Aufzeichnungen aus der Demo.</li>'}</ul></div>
        <div class="small muted">Befunde bespricht Ihr Studienteam mit Ihnen persönlich. Die App zeigt keine Diagnosen an.</div>`;
    }
    if (ui.tab === 'study') return `<div class="hello">Studie</div>
      <div class="pcard"><b>PVI-Watch</b><div class="sub">Smartwatch-Nachbeobachtung nach Pulmonalvenenisolation · Studien-ID ${PID}</div></div>
      <div class="pcard"><b>Freigegebene Daten</b><div class="sub">${d.ecg ? 'EKG, ' : ''}Herzfrequenz, Rhythmus-Hinweise · Quelle: ${esc(d.path)}</div></div>
      <div class="pcard"><b>Studienteam</b><div class="sub">Rhythmusambulanz · Tel. 0XX XXXX-XXXX<br>Mo–Fr 8–16 Uhr</div></div>
      <div class="pcard"><b>Datenschutz</b><div class="sub">Pseudonymisierte Speicherung auf Servern in Deutschland · Verschlüsselte Übertragung · Widerruf jederzeit möglich</div></div>
      <button class="danger">Teilnahme beenden / Einwilligung widerrufen</button>`;

    const week = ecgs.filter(e => Date.now() - new Date(e.t) < 7 * DAY).length;
    const asks = pendingAsks();
    return `
      <div><div class="sub">Studie PVI-Watch · ${PID}</div><div class="hello">Guten Tag 👋</div></div>
      ${asks.length ? `<div class="pcard" style="border:1.5px solid var(--warning)"><b>⏰ Bitte zeichnen Sie ein EKG auf</b><div class="sub" style="margin-top:4px">${esc(asks[0].text)}</div></div>` : ''}
      <div class="pcard conn"><div class="w">⌚</div><div><b>${esc(d.model)}</b><div class="small"><span class="ok">● verbunden</span> <span class="muted">· synchronisiert vor 2 min</span></div></div></div>
      <div class="pcard"><div class="row"><b>Tag ${PVI_DAYS} nach Ihrer Ablation</b></div>
        <div class="sub" style="margin-top:4px">Ihr Plan: 3 EKGs pro Woche und zusätzlich bei Beschwerden</div>
        <div class="progress"><div style="width:${Math.min(100, week / 3 * 100)}%"></div></div>
        <div class="small muted" style="margin-top:4px">Diese Woche: ${week} von 3 (Demo-Aufzeichnungen)</div></div>
      ${d.ecg ? `<button class="primary big" data-act="record">🫀 EKG jetzt aufzeichnen</button>` : `<div class="pcard small">Ihre Uhr überträgt keine EKGs. Bei Beschwerden melden Sie sich bitte beim Studienteam.</div>`}
      <button class="big" data-act="symptoms">Ich habe Beschwerden</button>
      <div class="emerg"><b>Bei akuten Beschwerden</b> wie Brustschmerz, Ohnmacht oder starker Luftnot rufen Sie sofort <b>112</b>. Die App ist kein Notfallsystem. Die Daten werden werktags vom Studienteam durchgesehen.</div>`;
  }

  function screenView() {
    const d = DEVICES[app.watch];
    if (ui.screen === 'symptoms') return `
      <button data-act="back" style="align-self:flex-start">‹ Zurück</button>
      <h2>Was spüren Sie gerade?</h2>
      <div class="symgrid">${SYMPTOMS.map(s => `<button class="sym ${ui.symptoms.includes(s) ? 'on' : ''}" data-sym="${s}">${s}</button>`).join('')}</div>
      <div class="emerg">Bei <b>Brustschmerz, Ohnmacht oder starker Luftnot</b> bitte sofort <b>112</b> wählen.</div>
      <div class="spacer"></div>
      <button class="primary big" data-act="record" ${ui.symptoms.length ? '' : 'disabled'}>Weiter: EKG aufzeichnen</button>`;
    if (ui.screen === 'record') {
      const how = {
        apple: 'Öffnen Sie die <b>EKG-App</b> auf Ihrer Apple Watch und legen Sie einen Finger der anderen Hand auf die <b>Digital Crown</b>.',
        samsung: 'Öffnen Sie <b>Samsung Health Monitor</b> auf der Uhr und legen Sie eine Fingerkuppe auf die <b>obere Taste</b>.',
        fitbit: 'Öffnen Sie die <b>EKG-App</b> auf Ihrer Fitbit und halten Sie Daumen und Zeigefinger an die <b>gegenüberliegenden Ecken</b>.',
        pixel: 'Öffnen Sie die <b>Fitbit-EKG-App</b> auf der Pixel Watch und legen Sie einen Finger auf die <b>Krone</b>.',
        withings: 'Drücken Sie die <b>Krone</b> der ScanWatch, wählen Sie <b>EKG</b> und berühren Sie die <b>Lünette</b> mit der anderen Hand.',
      }[app.watch];
      return `<button data-act="back" style="align-self:flex-start">‹ Abbrechen</button>
        <h2>EKG aufzeichnen</h2>
        <div class="pcard" style="font-size:15px;line-height:1.5">${how}</div>
        <div class="pcard sub">Setzen Sie sich ruhig hin und legen Sie den Arm auf einen Tisch. Die Aufnahme dauert <b>30 Sekunden</b>. Danach wird sie automatisch übertragen.</div>
        <div class="spacer"></div>
        <button class="primary big" data-act="start">Ich habe die Aufnahme auf der Uhr gestartet</button>`;
    }
    if (ui.screen === 'recording') return `
      <h2 class="center" style="margin-top:20px">Aufnahme läuft …</h2>
      <div class="sub center">Halten Sie den Finger ruhig auf der Uhr</div>
      <div class="rec-ring" id="ring">30</div>
      <div class="pcard" style="padding:8px"><canvas id="live"></canvas></div>
      <div class="small muted center">Demo: 30 Sekunden im Zeitraffer</div>`;
    if (ui.screen === 'sent') return `
      <div style="margin-top:60px" class="center"><div style="font-size:64px">✅</div>
      <div class="hello">EKG übermittelt</div>
      <div class="sub" style="margin-top:8px">Ihre Aufzeichnung wurde verschlüsselt an das Studienteam übertragen. Bei Auffälligkeiten meldet sich das Team bei Ihnen.</div></div>
      <div class="emerg" style="margin-top:12px">Wenn es Ihnen schlechter geht: <b>112</b>.</div>
      <div class="spacer"></div>
      <button class="primary big" data-act="home">Fertig</button>`;
    return '';
  }

  // ---------- Aufnahme ----------
  function startRecording() {
    ui.screen = 'recording'; render();
    const rhythm = $('#dRhythm').value;
    const [lo, hi] = PVI.DEFAULT_HR[rhythm];
    const hr = Math.round(lo + Math.random() * (hi - lo));
    const seed = Math.floor(Math.random() * 1e6);
    const sig = ECG.synth({ rhythm, hr, seed });
    const cv = $('#live'), W = 318;
    const DUR = 6000, t0 = Date.now();
    const timer = setInterval(() => {
      if (ui.screen !== 'recording') { clearInterval(timer); return; }
      const f = Math.min(1, Math.max(0, (Date.now() - t0) / DUR));
      const sec = f * 30;
      const from = Math.max(0, sec - 6);
      const part = { fs: sig.fs, seconds: 6, x: sig.x.subarray(Math.floor(from * sig.fs), Math.max(Math.floor(from * sig.fs) + 2, Math.floor(sec * sig.fs))) };
      ECG.drawECG(cv, part, { secondsPerRow: 6, width: W, gain: 10 });
      $('#ring').textContent = Math.ceil(30 - sec);
      $('#ring').style.background = `conic-gradient(var(--accent) ${f * 360}deg, var(--surface-2) 0)`;
      if (f >= 1) { clearInterval(timer); finish(rhythm, hr, seed); }
    }, 50);
  }

  function finish(rhythm, hr, seed) {
    const asks = pendingAsks();
    const trigger = ui.symptoms.length ? 'Symptome' : asks.length ? (asks[0].kind === 'REQ' ? 'Anforderung Studienteam' : asks[0].kind === 'HR' ? 'HF-Alarm' : 'Rhythmus-Hinweis der Uhr') : 'Selbst ausgelöst';
    const vc = PVI.vendorClass(app.watch, rhythm, hr);
    Store.push(Store.K.ecg, {
      id: `${PID}-D${Date.now().toString().slice(-6)}`, patientId: PID, t: new Date().toISOString(), rhythm, hr, seed, trigger,
      symptoms: ui.symptoms.slice(), vendorClass: vc, vendorCode: PVI.vendorCode(vc), source: DEVICES[app.watch].path,
    });
    ui.symptoms = []; ui.screen = 'sent'; render();
  }

  // ---------- Push-Benachrichtigung ----------
  let lastPushKey = null;
  function updatePush(force) {
    const el = $('#push');
    const asks = app.step === 'done' && DEVICES[app.watch].ecg ? pendingAsks() : [];
    if (!asks.length) { el.classList.remove('show'); return; }
    const a = asks[0];
    const key = a.t;
    if (key === lastPushKey && !force) return;
    lastPushKey = key;
    const title = a.kind === 'HR' ? 'Erhöhte Herzfrequenz in Ruhe' : a.kind === 'IRN' ? 'Unregelmäßiger Rhythmus erkannt' : 'Nachricht vom Studienteam';
    el.innerHTML = `<div class="app"><span>🫀 PVI-WATCH</span><span>jetzt</span></div><b>${title}</b><div>${a.kind === 'REQ' ? esc(a.text) : esc(a.text) + ' – bitte zeichnen Sie jetzt ein EKG auf.'}</div>`;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 6000);
  }
  $('#push').onclick = () => { $('#push').classList.remove('show'); if (app.step === 'done') { ui.screen = 'record'; render(); } };

  // ---------- Events ----------
  function bind() {
    document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { app.step = b.dataset.go; save(); render(); });
    document.querySelectorAll('[data-consent]').forEach(b => b.onchange = () => { app.consents[b.dataset.consent] = b.checked; save(); render(); });
    document.querySelectorAll('[data-watch]').forEach(b => b.onclick = () => { app.watch = b.dataset.watch; save(); render(); });
    document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { ui.tab = b.dataset.tab; render(); });
    document.querySelectorAll('[data-sym]').forEach(b => b.onclick = () => {
      const s = b.dataset.sym; ui.symptoms = ui.symptoms.includes(s) ? ui.symptoms.filter(x => x !== s) : [...ui.symptoms, s]; render();
    });
    document.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
      const a = b.dataset.act;
      if (a === 'record') ui.screen = 'record';
      if (a === 'symptoms') { ui.symptoms = []; ui.screen = 'symptoms'; }
      if (a === 'back' || a === 'home') { ui.screen = null; ui.tab = 'home'; if (a === 'back') ui.symptoms = []; }
      if (a === 'start') return startRecording();
      render();
    });
  }

  function addEvent(type, text, value) {
    if (app.step !== 'done') { alert('Bitte zuerst den Einschluss in der App abschließen.'); return; }
    Store.push(Store.K.evt, { id: `${PID}-EV${Date.now()}`, patientId: PID, t: new Date().toISOString(), type, text, value, ecgRequested: true, pending: true });
    render(); updatePush(true);
  }
  $('#dHr').onclick = () => addEvent('HR', 'Ruhe-HF 128/min über 11 min', 128);
  $('#dIrn').onclick = () => addEvent('IRN', 'Hinweis „Unregelmäßiger Rhythmus“ der Uhr');
  $('#dReset').onclick = () => {
    if (!confirm('Alle Demo-Daten (App, Befunde, Kontakte, Audit-Trail) löschen?')) return;
    Store.reset(); Object.assign(app, { step: 'welcome', watch: null, consents: {} }); ui = { tab: 'home', screen: null, symptoms: [] }; render();
  };

  window.addEventListener('storage', ev => {
    if (ev.key !== 'pviw.version') return;
    const s = Store.get(Store.K.app, null);
    if (!s) Object.assign(app, { step: 'welcome', watch: null, consents: {} });
    if (!ui.screen) render(); else updatePush();
  });

  const tick = () => { $('#clock').textContent = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); };
  tick(); setInterval(tick, 30000);
  render();
})();
