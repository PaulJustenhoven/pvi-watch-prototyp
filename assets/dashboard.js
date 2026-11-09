/* PVI-Watch Prototyp – Klinik-Dashboard (v2, nach Usability-Tests) */
(function () {
  'use strict';
  const { Store, FINDINGS, FINDING_GROUPS, RECURRENCE, ACTION_FINDINGS, ALGO_VERSION, BLANKING_DAYS, DAY, daysSince, dayPostPvi } = PVI;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const FKEYS = Object.keys(FINDINGS);
  const USERS = { pi: 'Dr. Prüfarzt (Demo)', nurse: 'S. Nurse (Study Nurse, Demo)', monitor: 'M. Monitor (CRA, Demo)' };
  const pref = { get: (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }, set: (k, v) => localStorage.setItem(k, JSON.stringify(v)) };

  const state = {
    cohort: [], sel: null, selEcg: null, filter: 'open', q: '', showPeaks: true, gain: 10, measure: false, compare: false,
    tab: 'hr', drafts: {}, editing: null, showAllEcgs: false,
    autoNext: pref.get('pviw.autonext', true), blind: pref.get('pviw.blind', false), role: pref.get('pviw.role', 'pi'),
  };
  const user = () => USERS[state.role];
  const sigCache = new Map();

  // ---------- Formatierung ----------
  const fmtDT = iso => { const d = new Date(iso); return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); };
  const fmtD = iso => new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const fmtWD = d => d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const rel = iso => {
    const h = (Date.now() - new Date(iso)) / 3600000;
    if (h < 1) return `vor ${Math.max(1, Math.round(h * 60))} min`;
    if (h < 24) return `vor ${Math.floor(h)} h`;
    const d = Math.floor(h / 24); return d === 1 ? 'gestern' : `vor ${d} Tagen`;
  };
  const num = (v, d = 0) => v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
  const endOfToday = () => { const d = new Date(); d.setHours(23, 59, 59, 999); return d; };
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  const LEVEL = {
    critical: { label: 'Prüfen', icon: '!', ord: 6, help: 'Hinweis auf VHF oder schnelle regelmäßige Tachykardie in einem unbefundeten EKG – ärztlich prüfen' },
    action: { label: 'Maßnahme offen', icon: '!', ord: 5, help: 'Rhythmusstörung ärztlich bestätigt – Kontakt bzw. Maßnahme noch nicht dokumentiert' },
    warning: { label: 'Beobachten', icon: '!', ord: 4, help: 'Unklarer Befund, ausstehendes EKG, Wiedervorlage oder Zweitbefundung' },
    todo: { label: 'Zu befunden', icon: '', ord: 3, help: 'EKG(s) ohne ärztliche Befundung – automatisch ohne Hinweis' },
    none: { label: 'Keine Daten', icon: '', ord: 2, help: 'Keine Datenübertragung bzw. keine EKGs – Patient erinnern' },
    good: { label: 'Alles befundet', icon: '✓', ord: 0, help: 'Alle EKGs ärztlich befundet, keine offenen Punkte' },
  };
  const badge = (lvl, text, title) => `<span class="badge ${lvl}" title="${esc(title || (LEVEL[lvl] && LEVEL[lvl].help) || '')}"><span class="dot"><span>${LEVEL[lvl] ? LEVEL[lvl].icon : 'i'}</span></span>${esc(text == null ? LEVEL[lvl].label : text)}</span>`;
  const ALGO_TXT = { af: 'unregelmäßig – VHF-Verdacht', tachy: 'regelmäßig, tachykard', unclear: 'nicht auswertbar', ectopy: 'Extraschläge', sr: 'regelmäßig' };

  // ---------- Daten ----------
  function signal(e) {
    if (!sigCache.has(e.id)) sigCache.set(e.id, ECG.synth({ rhythm: e.rhythm, hr: e.hr, seed: e.seed }));
    return sigCache.get(e.id);
  }
  const findPatient = id => state.cohort.find(x => x.id === id);
  const contacts = p => [...p.seedContacts, ...Store.get(Store.K.contact, []).filter(c => c.patientId === p.id)].sort((a, b) => new Date(b.t) - new Date(a.t));
  function dueOf(e) {
    const d = new Date(e.t); d.setDate(d.getDate() + 1);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    return d;
  }
  const hidden = e => state.blind && !e.review; // Einstufungen verblindet?

  function ecgPriority(e) {
    if (e.review) return null;
    const a = e.analysis;
    if (e.vendorCode === 'af' || a.cls === 'af') return { lvl: 'critical', why: 'Hinweis auf Vorhofflimmern' };
    if (a.cls === 'tachy' && a.hr >= 130) return { lvl: 'critical', why: `Regelmäßige Tachykardie ${Math.round(a.hr)}/min – Vorhofflattern/AT ausschließen` };
    if (a.cls === 'unclear') return { lvl: 'warning', why: 'Signal schwer beurteilbar' };
    if (a.cls === 'tachy') return { lvl: 'warning', why: `Regelmäßige Tachykardie ${Math.round(a.hr)}/min` };
    if (a.cls === 'ectopy') return { lvl: 'warning', why: 'Extraschläge' };
    if (e.vendorCode === 'unclear') return { lvl: 'warning', why: 'Uhr: nicht eindeutig' };
    return { lvl: 'todo', why: 'ohne automatischen Hinweis' };
  }
  function reasonText(e) {
    if (hidden(e)) return `EKG ${fmtDT(e.t)} – automatisch priorisiert (Einstufung verblindet)`;
    return `EKG ${fmtDT(e.t)}: ${e.prio.why} (Uhr: „${e.vendorClass}“ · Algorithmus: ${ALGO_TXT[e.analysis.cls]})`;
  }

  function load() {
    state.cohort = PVI.loadCohort();
    state.cohort.forEach(p => {
      p.ecgs.forEach(e => { e.analysis = ECG.analyze(signal(e)); });
      assess(p);
    });
  }

  function assess(p) {
    const reasons = [];
    let level = 'good';
    const bump = l => { if (LEVEL[l].ord > LEVEL[level].ord) level = l; };
    p.ecgs.forEach(e => { e.prio = ecgPriority(e); e.overdue = !e.review && Date.now() > dueOf(e); });
    const open = p.ecgs.filter(e => !e.review);
    open.filter(e => e.prio.lvl !== 'todo').forEach(e => { bump(e.prio.lvl); reasons.push({ lvl: e.prio.lvl, text: reasonText(e), ecg: e.id, overdue: e.overdue }); });
    const todo = open.filter(e => e.prio.lvl === 'todo');
    if (todo.length) { bump('todo'); reasons.push({ lvl: 'todo', text: `${todo.length} EKG${todo.length > 1 ? 's' : ''} ohne ärztliche Befundung${state.blind ? '' : ' (automatisch ohne Hinweis)'}`, ecg: todo[0].id, overdue: todo.some(x => x.overdue) }); }

    const cs = contacts(p);
    p.ecgs.filter(e => e.review && ACTION_FINDINGS.has(e.review.finding) && daysSince(e.t) <= 60).forEach(e => {
      const done = cs.some(c => new Date(c.t) > new Date(e.review.t) && c.outcome !== 'Nicht erreicht');
      if (!done) { bump('action'); reasons.push({ lvl: 'action', text: `${FINDINGS[e.review.finding]} ärztlich bestätigt (EKG ${fmtDT(e.t)}) – Kontakt/Maßnahme dokumentieren`, ecg: e.id, act: 'contact' }); }
    });
    p.ecgs.filter(e => e.review && e.review.finding === 'NB').forEach(e => {
      if (!p.ecgs.some(x => new Date(x.t) > new Date(e.t))) { bump('warning'); reasons.push({ lvl: 'warning', text: `EKG ${fmtDT(e.t)} nicht beurteilbar – Wiederholung anfordern`, ecg: e.id, act: 'request' }); }
    });
    p.ecgs.filter(e => e.review && e.review.second).forEach(e => { bump('warning'); reasons.push({ lvl: 'warning', text: `Zweitbefundung angefordert (EKG ${fmtDT(e.t)}, von ${e.review.by})`, ecg: e.id }); });

    const pend = p.events.filter(ev => ev.pending).sort((a, b) => new Date(b.t) - new Date(a.t));
    p.pendingReq = pend.find(ev => ev.type === 'REQ') || null;
    if (pend.length) {
      bump('warning'); const ev = pend[0];
      reasons.push({ lvl: 'warning', text: ev.type === 'REQ' ? `EKG angefordert ${rel(ev.t)} – noch nicht eingegangen` : `${ev.text} (${rel(ev.t)}) – EKG angefordert, noch nicht eingegangen` });
    }
    const lastC = cs[0] || null;
    p.lastContact = lastC;
    p.fuDue = !!(lastC && lastC.followUp && new Date(lastC.followUp) <= endOfToday());
    if (p.fuDue) { bump('warning'); reasons.push({ lvl: 'warning', text: `Wiedervorlage fällig (${fmtD(lastC.followUp)}): ${lastC.method}${lastC.outcome ? ' – ' + lastC.outcome : ''}${lastC.assignee ? ' · zuständig ' + lastC.assignee : ''}`, act: 'contact' }); }

    const sync = Math.floor(daysSince(p.lastSync));
    if (sync > 14) { bump('warning'); reasons.push({ lvl: 'warning', text: `Seit ${sync} Tagen keine Daten – telefonisch kontaktieren`, act: 'contact' }); }
    else if (sync > 5) { bump('none'); reasons.push({ lvl: 'none', text: `Seit ${sync} Tagen keine Datenübertragung – Erinnerung senden`, act: 'remind' }); }
    else if (!p.ecgs.length || daysSince(p.ecgs[0].t) > 7) { bump('none'); reasons.push({ lvl: 'none', text: 'Seit über 7 Tagen kein EKG – Erinnerung senden', act: 'remind' }); }

    reasons.sort((a, b) => LEVEL[b.lvl].ord - LEVEL[a.lvl].ord);
    p.level = level; p.reasons = reasons;
    p.openCount = open.length; p.overdueCount = open.filter(e => e.overdue).length;
    p.dayPost = dayPostPvi(p); p.inBlanking = p.dayPost <= BLANKING_DAYS;
    const conf = p.ecgs.filter(e => e.review && RECURRENCE.has(e.review.finding) && e.review.ge30s).sort((a, b) => new Date(a.t) - new Date(b.t));
    p.recurrence = conf.find(e => dayPostPvi(p, e.t) > BLANKING_DAYS) || null;   // erstes Rezidiv = Endpunkt
    p.early = conf.find(e => dayPostPvi(p, e.t) <= BLANKING_DAYS) || null;
    p.aad = p.clin.aad !== 'keine';
    p.lastActivity = Math.max(new Date(p.lastSync), ...p.ecgs.slice(0, 1).map(e => +new Date(e.t)));
    p.prioSort = LEVEL[level].ord * 10 + (p.overdueCount ? 5 : 0);
  }

  // ---------- KPIs & Filter ----------
  const FILTERS = [
    ['open', 'Offen', p => p.level !== 'good'],
    ['critical', 'Prüfen', p => p.level === 'critical'],
    ['action', 'Maßnahme offen', p => p.level === 'action'],
    ['warning', 'Beobachten', p => p.level === 'warning'],
    ['unrev', 'Unbefundete EKGs', p => p.openCount > 0],
    ['overdue', 'Überfällig', p => p.overdueCount > 0],
    ['fu', 'Wiedervorlage', p => p.fuDue],
    ['none', 'Keine Daten', p => p.level === 'none'],
    ['good', 'Alles befundet', p => p.level === 'good'],
    ['all', 'Alle', () => true],
  ];
  const fmatch = k => (FILTERS.find(f => f[0] === k) || FILTERS[0])[2];

  function renderKpis() {
    const c = state.cohort;
    const cnt = l => c.filter(p => p.level === l).length;
    const openE = c.reduce((s, p) => s + p.openCount, 0), overE = c.reduce((s, p) => s + p.overdueCount, 0);
    const adh = c.filter(p => p.ecgs.filter(e => daysSince(e.t) <= 7).length >= 2).length;
    const rec = c.filter(p => p.recurrence).length, early = c.filter(p => p.early).length, post = c.filter(p => !p.inBlanking).length;
    const tile = (f, l, v) => `<button class="card kpi ${state.filter === f ? 'active' : ''}" data-f="${f}" title="Als Filter anwenden"><span class="l">${l}</span><span class="v">${v}</span></button>`;
    const stat = (l, v, t) => `<div class="kpi stat" title="${esc(t)}"><span class="l">${l}</span><span class="v">${v}</span></div>`;
    $('#kpis').innerHTML = [
      tile('critical', badge('critical'), cnt('critical')),
      tile('action', badge('action'), cnt('action')),
      tile('warning', badge('warning'), cnt('warning')),
      tile('unrev', badge('todo', 'Unbefundete EKGs'), openE),
      tile('overdue', '<span class="over">Frist überschritten</span>', overE),
      tile('none', badge('none'), cnt('none')),
      '<div class="kpi-sep"></div>',
      stat('Eingeschlossen', c.length, `${c.length - post} in Blanking-Periode (≤ ${BLANKING_DAYS} Tage)`),
      stat('Adhärenz', Math.round(adh / c.length * 100) + ' %', '≥ 2 EKGs in den letzten 7 Tagen'),
      stat('Endpunkt: Rezidive', `${rec}/${post}`, 'Erstes ärztlich bestätigtes VHF/AFL/AT ≥ 30 s nach Tag 90 (Patienten nach Blanking)'),
      stat('Frührezidive (Blanking)', early, 'Bestätigte Rhythmusstörung ≥ 30 s bis Tag 90 – kein Endpunkt'),
    ].join('');
  }

  function renderList() {
    const c = state.cohort;
    $('#chips').innerHTML = FILTERS.map(([k, l, m]) => `<button class="chip ${state.filter === k && !state.q ? 'active' : ''}" data-f="${k}" role="tab" aria-selected="${state.filter === k}">${l} · ${c.filter(m).length}</button>`).join('');
    const q = state.q.trim().toLowerCase();
    const rows = c.filter(p => q ? (p.id + ' ' + p.device.model + ' ' + p.device.vendor).toLowerCase().includes(q) : fmatch(state.filter)(p))
      .sort((a, b) => b.prioSort - a.prioSort || b.lastActivity - a.lastActivity);
    const notes = [];
    if (q) notes.push('Suche über alle Patienten – Filter wird ignoriert.');
    else if (!['open', 'all', 'critical'].includes(state.filter)) {
      const hid = c.filter(p => p.level === 'critical' && !fmatch(state.filter)(p)).length;
      if (hid) notes.push(`${hid} Patient${hid > 1 ? 'en' : ''} mit Status „Prüfen“ in diesem Filter nicht sichtbar.`);
    }
    if (state.sel && !rows.find(p => p.id === state.sel)) notes.push(`Ausgewählt: ${state.sel} (nicht in dieser Ansicht).`);
    const fn = $('#filterNote'); fn.hidden = !notes.length; fn.innerHTML = notes.map(esc).join('<br>');
    $('#plist').innerHTML = rows.length ? rows.map(p => {
      const top = p.reasons[0];
      return `<button class="prow ${state.sel === p.id ? 'sel' : ''}" data-p="${p.id}" role="option" aria-selected="${state.sel === p.id}">
        <span><span class="id">${p.id}</span> <span class="small muted">· ${esc(p.device.model)}</span></span>
        <span>${badge(p.level)}</span>
        <span class="meta">Tag ${p.dayPost}${p.inBlanking ? ' <span class="pill blanking">Blanking</span>' : ''}${p.recurrence ? ' <span class="pill endpoint">Endpunkt</span>' : ''}${p.aad ? ' <span class="pill" title="' + esc(p.clin.aad) + '">AAD</span>' : ''}${p.fuDue ? ' <span class="pill" title="Wiedervorlage fällig">WV</span>' : ''}</span>
        <span class="meta">${p.openCount ? `<span class="cnt ${p.overdueCount ? 'over' : ''}">${p.openCount} offen${p.overdueCount ? ' · ' + p.overdueCount + ' überf.' : ''}</span>` : ''}</span>
        <span class="why">${top ? esc(top.text) : 'Keine offenen Punkte'}</span>
      </button>`;
    }).join('') : `<div class="empty">${q ? `Kein Treffer für „${esc(state.q)}“. <button class="linkbtn" id="clearQ">Suche zurücksetzen</button>` : state.filter === 'open' ? `Keine offenen Fälle ✓<br><span class="small">Stand ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span>` : 'Keine Patienten in diesem Filter.'}</div>`;
    const cq = $('#clearQ'); if (cq) cq.onclick = () => { state.q = ''; $('#search').value = ''; renderList(); };
  }

  // ---------- Detail ----------
  function selectedEcgFor(p) {
    if (state.selEcg && p.ecgs.find(e => e.id === state.selEcg)) return state.selEcg;
    const r = p.reasons.find(x => x.ecg);
    return r ? r.ecg : (p.ecgs[0] && p.ecgs[0].id);
  }
  function orderedEcgs(p) {
    const open = p.ecgs.filter(e => !e.review).sort((a, b) => LEVEL[b.prio.lvl].ord - LEVEL[a.prio.lvl].ord || new Date(b.t) - new Date(a.t));
    return [...open, ...p.ecgs.filter(e => e.review)];
  }

  function renderMain(keepReview) {
    const p = findPatient(state.sel);
    if (!p) { $('#main').innerHTML = '<div class="card empty">Patient in der Liste auswählen</div>'; $('#reviewCol').innerHTML = ''; return; }
    state.selEcg = selectedEcgFor(p);
    const e = p.ecgs.find(x => x.id === state.selEcg);
    const lc = p.lastContact;
    const reqBtn = p.pendingReq ? `EKG angefordert · ${rel(p.pendingReq.t)}` : 'EKG anfordern';
    const canAct = state.role !== 'monitor';
    $('#main').innerHTML = `
      <div class="card sec" id="phead">
        <div class="phead">
          <span class="pid">${p.id}</span>${badge(p.level)}
          ${p.recurrence ? `<span class="pill endpoint" title="Erstes ärztlich bestätigtes Rezidiv ≥ 30 s nach Tag ${BLANKING_DAYS}">Endpunkt: erstes Rezidiv Tag ${dayPostPvi(p, p.recurrence.t)}${p.aad ? ' · unter AAD' : ''}</span>` : ''}
          ${p.early ? `<span class="pill" title="Kein Endpunkt">Frührezidiv in Blanking (Tag ${dayPostPvi(p, p.early.t)})</span>` : ''}
          <div class="spacer"></div>
          <button id="btnReq" ${canAct ? '' : 'disabled'} title="Push-Nachricht „Bitte EKG aufzeichnen“ an die Patienten-App">${reqBtn}</button>
          <button class="primary" id="btnContact" ${canAct ? '' : 'disabled'}>Kontakt dokumentieren</button>
        </div>
        <div class="facts">
          <span><b>${p.age} J., ${p.sex === 'w' ? 'weiblich' : 'männlich'}</b></span>
          <span>Uhr: <b>${esc(p.device.model)}</b> <span class="muted">(${esc(p.device.path)})</span></span>
          <span>PVI: <b>${fmtD(p.pviDate)}</b> · heute Tag <b>${p.dayPost}</b></span>
          <span>Sync: <b class="${daysSince(p.lastSync) > 5 ? 'over' : ''}">${rel(p.lastSync)}</b></span>
          <span>Letzter Kontakt: <b>${lc ? fmtD(lc.t) + ' · ' + esc(lc.method) : '–'}</b>${lc && lc.followUp ? ` · WV ${fmtD(lc.followUp)}` : ''}</span>
        </div>
        <div class="clin">
          <div><span>VHF-Typ vor Ablation</span>${esc(p.clin.afType)}</div>
          <div><span>Ablation</span>${esc(p.clin.energy)} · ${esc(p.clin.lesions)}</div>
          <div><span>Antiarrhythmika (AAD)</span><b class="${p.aad ? 'warnv' : ''}">${esc(p.clin.aad)}</b></div>
          <div><span>Antikoagulation</span>${esc(p.clin.oak)}</div>
          <div><span>Frequenzkontrolle</span>${esc(p.clin.bb)}</div>
          <div><span>CHA₂DS₂-VASc</span>${p.clin.cha} <span class="muted small">· Stand ${fmtD(p.clin.asOf)}</span></div>
        </div>
        ${timelineHtml(p)}
        ${p.reasons.length ? `<ul class="reasons">${p.reasons.map(r => `<li>${badge(r.lvl)}${r.overdue ? '<span class="over small">Frist überschritten</span>' : ''}
            ${r.ecg ? `<button class="linkbtn" data-ecg="${r.ecg}">${esc(r.text)}</button>` : `<span>${esc(r.text)}</span>`}
            ${r.act === 'contact' && canAct ? '<button class="mini" data-act="contact">Kontakt dokumentieren</button>' : ''}
            ${(r.act === 'request' || r.act === 'remind') && canAct ? `<button class="mini" data-act="request">${r.act === 'remind' ? 'Erinnerung senden' : 'EKG erneut anfordern'}</button>` : ''}</li>`).join('')}</ul>` : '<div class="small muted" style="margin-top:8px">Keine offenen Punkte.</div>'}
      </div>

      <div class="card sec">
        <div class="sec-h"><h2>EKGs (${p.ecgs.length})</h2><span class="small ink2">${p.openCount} offen · offene zuerst · Pfeiltasten ← → wechseln</span></div>
        ${ecgTable(p)}
      </div>

      ${e ? viewerHtml(p, e) : '<div class="card sec empty">Noch keine EKGs.</div>'}

      <div class="card sec">
        <div class="tabs" role="tablist">
          ${[['hr', 'HF-Verlauf'], ['log', 'Kontakte & Audit-Trail'], ['hist', 'Befundhistorie']].map(([k, l]) => `<button role="tab" class="${state.tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}
        </div>
        <div id="tabBody"></div>
      </div>`;
    if (e) drawViewer(p, e);
    renderTab(p);
    bindMain(p, e);
    if (!keepReview) renderReview();
  }

  function timelineHtml(p) {
    const max = Math.max(380, p.dayPost + 15);
    const pc = d => (Math.max(0, Math.min(max, d)) / max * 100).toFixed(2) + '%';
    const wins = [['M3 · Blanking-Ende', 90, 14], ['M6', 180, 14], ['M12', 365, 30]];
    const recs = p.ecgs.filter(e => e.review && RECURRENCE.has(e.review.finding));
    return `<div class="timeline" aria-label="Studienzeitleiste">
      <div class="tl-bar"></div>
      <div class="tl-blank" style="left:0;width:${pc(BLANKING_DAYS)}" title="Blanking-Periode Tag 0–${BLANKING_DAYS}"></div>
      <span class="tl-lab" style="left:0;transform:none">PVI</span>
      ${wins.map(([l, d, w]) => {
        const st = p.dayPost > d + w ? 'done' : p.dayPost >= d - w ? 'due' : '';
        return `<div class="tl-win ${st}" style="left:${pc(d - w)};width:calc(${pc(d + w)} - ${pc(d - w)})" title="${l}: Tag ${d - w}–${d + w} · ${st === 'done' ? 'Zeitfenster vorbei' : st === 'due' ? 'Visite jetzt fällig' : 'geplant'}"></div><span class="tl-lab" style="left:${pc(d)}">${l}${st === 'due' ? ' · fällig' : ''}</span>`;
      }).join('')}
      ${recs.map(e => `<div class="tl-ev" style="left:${pc(dayPostPvi(p, e.t))}" title="${esc(FINDINGS[e.review.finding])} · Tag ${dayPostPvi(p, e.t)}"></div>`).join('')}
      <div class="tl-today" style="left:${pc(p.dayPost)}"></div><span class="tl-lab b" style="left:${pc(p.dayPost)}"><b>heute · Tag ${p.dayPost}</b></span>
    </div>`;
  }

  function ecgTable(p) {
    const list = orderedEcgs(p);
    const shown = state.showAllEcgs ? list : list.slice(0, 7);
    const rows = shown.map(e => {
      const st = e.review ? 'done' : e.prio.lvl;
      const h = hidden(e);
      const due = !e.review ? (e.overdue ? '<span class="over">überfällig</span>' : `bis ${fmtWD(dueOf(e))}`) : '';
      return `<tr class="erow st-${st} ${state.selEcg === e.id ? 'sel' : ''}" data-e="${e.id}" tabindex="0">
        <td>${e.review ? '<span class="small">✍ befundet</span>' : badge(e.prio.lvl, e.prio.lvl === 'todo' ? 'offen' : LEVEL[e.prio.lvl].label)}${state.drafts[e.id] ? ' <span class="draft">Entwurf</span>' : ''}</td>
        <td class="tnum">${fmtDT(e.t)}</td><td class="tnum">${dayPostPvi(p, e.t)}</td>
        <td>${esc(e.trigger)}${e.symptoms.length ? ` <span title="${esc(e.symptoms.join(', '))}">· Symptome</span>` : ''}</td>
        <td>${h ? '<span class="muted">verblindet</span>' : esc(e.vendorClass)}</td>
        <td>${h ? '<span class="muted">verblindet</span>' : esc(ALGO_TXT[e.analysis.cls])}</td>
        <td>${e.review ? `<b>${esc(FINDINGS[e.review.finding])}</b>${e.review.ge30s ? ' · ≥30 s' : ''}${e.review.history && e.review.history.length ? ' · geändert' : ''}` : '–'}</td>
        <td class="small">${due}</td></tr>`;
    }).join('');
    return `<div style="overflow-x:auto"><table class="ecgs"><thead><tr><th>Status</th><th>Datum</th><th>Tag</th><th>Auslöser</th><th>⌚ Uhr (CE)</th><th>⚙ Algorithmus</th><th>✍ Arzt</th><th>Frist</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${list.length > 7 ? `<button class="linkbtn small" id="toggleAll" style="margin-top:6px">${state.showAllEcgs ? 'Weniger anzeigen' : `Alle ${list.length} EKGs anzeigen`}</button>` : ''}`;
  }

  const refEcg = (p, e) => p.ecgs.filter(x => x.id !== e.id && x.review && x.review.finding === 'SR').sort((a, b) => new Date(b.t) - new Date(a.t))[0] || null;

  function viewerHtml(p, e) {
    const a = e.analysis, h = hidden(e), r = e.review;
    const ref = refEcg(p, e);
    const day = dayPostPvi(p, e.t);
    return `
      <div class="card sec" id="viewer">
        <div class="viewer-head">
          <h2 style="margin:0;font-size:15px">EKG vom ${fmtDT(e.t)}</h2>
          <span class="pill">${esc(e.trigger)}${e.symptoms.length ? ': ' + esc(e.symptoms.join(', ')) : ''}</span>
          <span class="pill ${day <= BLANKING_DAYS ? 'blanking' : ''}">Tag ${day} nach PVI${day <= BLANKING_DAYS ? ' · Blanking' : ''}</span>
          <div class="spacer"></div>
          <div class="ctrls">
            <span class="seg" role="group" aria-label="Verstärkung">${[5, 10, 20].map(g => `<button class="${state.gain === g ? 'on' : ''}" data-gain="${g}">${g} mm/mV</button>`).join('')}</span>
            <button class="mini ${state.showPeaks ? 'on' : ''}" id="tPeaks" title="R-Zacken und RR-Intervalle (R)">R-Zacken</button>
            <button class="mini ${state.measure ? 'on' : ''}" id="tMeasure" title="Messzirkel: klicken und ziehen (M)">Messen</button>
            <button class="mini ${state.compare ? 'on' : ''}" id="tCompare" title="Vergleich mit letztem Sinusrhythmus-EKG (V)" ${ref ? '' : 'disabled'}>Vergleich</button>
          </div>
        </div>
        <div class="srcs">
          ${h ? '<span class="src blind">⌚ Uhr: verblindet</span><span class="src blind">⚙ Algorithmus: verblindet</span>'
            : `<span class="src watch"><span class="k">⌚ Uhr (CE, ${esc(p.device.vendor)})</span>${esc(e.vendorClass)}</span><span class="src algo"><span class="k">⚙ Algorithmus (Demo)</span>${esc(ALGO_TXT[a.cls])}</span>`}
          ${r ? `<span class="src doc ${RECURRENCE.has(r.finding) ? 'recurrence' : ''}"><span class="k">✍ Arzt</span>${esc(FINDINGS[r.finding])}${r.ge30s ? ' · ≥ 30 s' : ''} · ${esc(r.by)}</span>` : '<span class="src algo"><span class="k">✍ Arzt</span>Befund offen</span>'}
        </div>
        <div class="ecgwrap ${state.measure ? 'measure' : ''}" id="ecgWrap"><canvas id="ecgCanvas"></canvas><div class="hline" id="hline"></div><div class="caliper" id="caliper"><span></span></div></div>
        <div class="small muted" style="margin-top:5px">Kleines Raster 0,04 s / 0,1 mV (nominell 25 mm/s, ${state.gain} mm/mV) · Eichzacke 1 mV · Einkanal ≈ Ableitung I · ${esc(e.source)} · Abtastrate Demo 250 Hz · ${e.id}</div>
        ${state.compare && ref ? `<div class="cmp-label">Vergleich: letztes als <b>Sinusrhythmus</b> befundetes EKG desselben Patienten – ${fmtDT(ref.t)} (erste 10 s)</div><div class="ecgwrap"><canvas id="cmpCanvas"></canvas></div>` : ''}
        <div class="grid2">
          <div class="meas">
            <div>Mittlere Herzfrequenz</div><div>${num(a.hr)} /min</div>
            <div>Erkannte Schläge</div><div>${a.peaks.length}</div>
            <div>RR-Variationskoeffizient<span class="info" title="Standardabweichung / Mittelwert der RR-Intervalle. Sinusrhythmus meist < 8 %, VHF meist > 15 %.">i</span></div><div>${num(a.cv * 100, 1)} %</div>
            <div>nRMSSD<span class="info" title="Wurzel der mittleren quadrierten Differenz aufeinanderfolgender RR-Intervalle, geteilt durch mittleres RR. VHF typischerweise > 0,10.">i</span></div><div>${num(a.nrmssd, 2)}</div>
            <div>RR-Sprünge > 10 %<span class="info" title="Anteil aufeinanderfolgender RR-Intervalle, die sich um mehr als 10 % unterscheiden.">i</span></div><div>${num(a.jumpFrac * 100)} %</div>
            <div>Signalqualität<span class="info" title="Hochfrequente Störanteile außerhalb der QRS-Komplexe relativ zur R-Amplitude.">i</span></div><div>${a.quality}</div>
          </div>
          <div>
            <div class="chart-title">Poincaré-Plot</div>
            <div class="chart-sub">RRₙ gegen RRₙ₊₁ (ms) · Punktwolke = unregelmäßig</div>
            <canvas id="poincare"></canvas>
          </div>
        </div>
      </div>`;
  }

  function renderTab(p) {
    const tb = $('#tabBody');
    if (state.tab === 'hr') {
      tb.innerHTML = `<div class="chart-title">Herzfrequenz pro Tag, letzte 30 Tage (Schläge/min)</div>
        <div class="legend"><span><i style="border-color:${css('--accent')}"></i>max. Ruhe-HF</span><span><i style="border-color:${css('--muted')};border-top-width:1px"></i>Ruhe-HF (Median)</span><span><i style="border-color:${css('--ink-2')};border-top-style:dashed"></i>Alarmschwelle 110/min</span><span>◆ EKG-Aufzeichnung</span></div>
        <div id="hrWrap"><canvas id="hrChart"></canvas></div>`;
      drawHrChart(p);
    } else if (state.tab === 'log') {
      const cs = contacts(p).map(c => ({ t: c.t, who: c.by, text: `Kontakt: ${c.method}${c.outcome ? ' → ' + c.outcome : ''}${c.ref ? ' · Bezug ' + c.ref : ''}${c.note ? ' – „' + c.note + '“' : ''}${c.followUp ? ' · Wiedervorlage ' + fmtD(c.followUp) : ''}${c.assignee ? ' · zuständig ' + c.assignee : ''}` }));
      const audit = Store.get(Store.K.audit, []).filter(a => a.detail.includes(p.id) && a.action !== 'Kontakt dokumentiert').map(a => ({ t: a.t, who: a.user, text: `${a.action}: ${a.detail}` }));
      const init = p.ecgs.filter(e => e.initialReview).map(e => ({ t: e.initialReview.t, who: e.initialReview.by, text: `Befund signiert: ${e.id} → ${FINDINGS[e.initialReview.finding]}` }));
      const all = [...cs, ...audit, ...init].sort((a, b) => new Date(b.t) - new Date(a.t));
      tb.innerHTML = all.length ? `<ul class="log">${all.map(x => `<li><span class="muted tnum">${fmtDT(x.t)}</span><span>${esc(x.text)}<br><span class="who">${esc(x.who)}</span></span></li>`).join('')}</ul>` : '<div class="muted small">Noch keine Einträge.</div>';
    } else {
      const items = p.ecgs.filter(e => e.review).sort((a, b) => new Date(b.review.t) - new Date(a.review.t));
      tb.innerHTML = items.length ? `<ul class="log">${items.map(e => `<li><span class="muted tnum">${fmtDT(e.t)}</span><span>${histHtml(e.review)}<span class="who">${e.id}</span></span></li>`).join('')}</ul>` : '<div class="muted small">Noch keine Befunde.</div>';
    }
  }
  function histHtml(r) {
    const versions = [...(r.history || []), r];
    return `<div class="hist">${versions.map((v, i) => `<div class="${i < versions.length - 1 ? 'old' : ''}">v${i + 1}: <b>${esc(FINDINGS[v.finding])}</b>${v.ge30s ? ' · ≥ 30 s' : ''}${v.second ? ' · Zweitbefund angefordert' : ''} – ${esc(v.by)}, ${fmtDT(v.t)}${v.reason ? ` · Grund: ${esc(v.reason)}` : ''}${v.batch ? ' · Stapelbefundung' : ''}${v.blind ? ' · verblindet' : ''}${v.sdv ? ` · SDV ✓ ${esc(v.sdv.by)}` : ''}${v.note ? ` – „${esc(v.note)}“` : ''}</div>`).join('')}</div>`;
  }

  // ---------- Befundspalte ----------
  function renderReview() {
    const col = $('#reviewCol');
    const p = findPatient(state.sel);
    const e = p && p.ecgs.find(x => x.id === state.selEcg);
    if (!p || !e) { col.innerHTML = ''; return; }
    const r = e.review;
    const editing = state.editing === e.id;
    const d = state.drafts[e.id] || (editing && r ? { finding: r.finding, ge30s: r.ge30s } : {});
    const openAll = state.cohort.reduce((s, x) => s + x.openCount, 0), overAll = state.cohort.reduce((s, x) => s + x.overdueCount, 0);
    const due = !r ? (e.overdue ? `<span class="over">Frist überschritten (fällig ${fmtWD(dueOf(e))})</span>` : `Frist: bis ${fmtWD(dueOf(e))}`) : 'befundet';
    let body;
    if (r && !editing) {
      body = `${histHtml(r)}
        <div class="row" style="flex-wrap:wrap">
          ${state.role === 'pi' ? '<button id="btnEdit">Befund ändern …</button>' : ''}
          ${state.role === 'monitor' ? `<button id="btnSdv" ${r.sdv ? 'disabled' : ''}>${r.sdv ? 'SDV erledigt ✓' : 'Source Data Verification bestätigen'}</button>` : ''}
        </div>`;
    } else if (state.role !== 'pi') {
      body = `<div class="ro">Befundung nur durch Prüfärztinnen und -ärzte (laut Delegation Log). Aktuelle Rolle: ${esc(user())}.</div>`;
    } else {
      const k = f => FKEYS.indexOf(f) + 1;
      const rec = RECURRENCE.has(d.finding);
      const pv = previewOf(p, e, d);
      body = `
        ${FINDING_GROUPS.map(([g, fs]) => `<fieldset><legend>${g}</legend>${fs.map(f => `<label class="opt"><input type="radio" name="finding" value="${f}" ${d.finding === f ? 'checked' : ''}> ${FINDINGS[f]} <kbd>${k(f)}</kbd></label>`).join('')}
          ${g.startsWith('Rezidiv') ? `<label class="opt sub-opt ${rec ? '' : 'disabled'}"><input type="checkbox" id="ge30" ${rec && d.ge30s ? 'checked' : ''} ${rec ? '' : 'disabled'}> über die gesamte Aufzeichnung (≥ 30 s) <kbd>L</kbd></label>` : ''}</fieldset>`).join('')}
        <label class="opt"><input type="checkbox" id="second" ${d.second ? 'checked' : ''}> Unsicher – Zweitbefundung anfordern <kbd>Z</kbd></label>
        <textarea id="rNote" placeholder="Kommentar (optional)">${esc(d.note || '')}</textarea>
        ${editing ? `<label class="small" style="display:flex;flex-direction:column;gap:4px">Änderungsgrund (Pflicht)
          <select id="rReason"><option value="">– bitte wählen –</option>${['Korrektur Fehleingabe', 'Zweitbefundung', 'Adjudikation', 'Neue klinische Information'].map(x => `<option ${d.reason === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>` : ''}
        <div class="preview ${pv.yes ? 'yes' : ''}" id="preview">${pv.html}</div>
        <button class="primary sign" id="btnSign">${p.id} · EKG ${fmtDT(e.t)} ${editing ? 'neu ' : ''}signieren</button>
        <div class="row small ink2" style="justify-content:space-between;flex-wrap:wrap;gap:6px"><span><kbd>Strg</kbd>+<kbd>Enter</kbd> signiert</span>
          <label class="row"><input type="checkbox" id="autoNext" ${state.autoNext ? 'checked' : ''}> danach nächstes offenes EKG</label></div>
        ${editing ? '<button id="btnCancelEdit">Änderung abbrechen</button>' : ''}`;
    }
    col.innerHTML = `<div class="card rv">
      <h2 style="font-size:15px">Ärztlicher Befund</h2>
      <div class="rv-target"><b>${p.id}</b> · ${p.age} J., ${p.sex} · ${esc(p.device.model)}<br>EKG ${fmtDT(e.t)} · Tag ${dayPostPvi(p, e.t)} · <span class="muted">${e.id}</span><br>${due}</div>
      ${state.blind && !r ? '<div class="small ink2">Verblindete Befundung: Die Einstufung von Uhr und Algorithmus wird erst nach dem Signieren eingeblendet.</div>' : ''}
      ${body}
      <div class="queue">Offen gesamt: <b>${openAll}</b> EKGs${overAll ? ` · <span class="over">${overAll} überfällig</span>` : ''}<button class="mini" id="btnNextOpen" ${openAll ? '' : 'disabled'}>Nächstes offenes ▸ <kbd>N</kbd></button></div>
    </div>`;
    bindReview(p, e);
  }

  function previewOf(p, e, d) {
    const day = dayPostPvi(p, e.t);
    const wasEnd = p.recurrence && p.recurrence.id === e.id;
    if (!d.finding) return { html: 'Noch kein Befund gewählt.' };
    if (RECURRENCE.has(d.finding)) {
      if (!d.ge30s) return { html: `<b>Kein Endpunkt:</b> Dauer ≥ 30 s nicht bestätigt.${wasEnd ? ' <span class="over">Entfernt den bisherigen Endpunkt.</span>' : ''}` };
      if (day <= BLANKING_DAYS) return { html: `<b>Kein Endpunkt:</b> Tag ${day} liegt in der Blanking-Periode. Zählt als Frührezidiv.` };
      if (p.recurrence && !wasEnd && new Date(p.recurrence.t) < new Date(e.t)) return { html: `Endpunkt bereits am ${fmtD(p.recurrence.t)} (Tag ${dayPostPvi(p, p.recurrence.t)}) erreicht. Wird als weiteres Rezidiv dokumentiert.` };
      return { yes: true, html: `<b>Erfüllt den primären Endpunkt:</b> erstes Rezidiv an Tag ${day} (> ${BLANKING_DAYS}), ≥ 30 s${p.aad ? ', <b>unter AAD</b>' : ''}.` };
    }
    return { html: wasEnd ? '<b class="over">Achtung: Diese Änderung entfernt den Endpunkt dieses Patienten.</b>' : 'Kein Endpunkt.' };
  }

  function currentBase(e) { return state.drafts[e.id] || (e.review ? { finding: e.review.finding, ge30s: e.review.ge30s } : {}); }
  function setDraft(patch) {
    const p = findPatient(state.sel); const e = p && p.ecgs.find(x => x.id === state.selEcg);
    if (!e || state.role !== 'pi' || (e.review && state.editing !== e.id)) return;
    const d = Object.assign({}, currentBase(e), patch);
    if (!RECURRENCE.has(d.finding)) d.ge30s = false;
    state.drafts[e.id] = d;
    renderReview();
    const td = document.querySelector(`tr.erow[data-e="${e.id}"] td`);
    if (td && !td.querySelector('.draft')) td.insertAdjacentHTML('beforeend', ' <span class="draft">Entwurf</span>');
  }

  function bindReview(p, e) {
    $$('input[name=finding]').forEach(i => i.onchange = () => setDraft({ finding: i.value }));
    const g = $('#ge30'); if (g) g.onchange = () => setDraft({ ge30s: g.checked });
    const s = $('#second'); if (s) s.onchange = () => setDraft({ second: s.checked });
    const n = $('#rNote'); if (n) n.oninput = () => { state.drafts[e.id] = Object.assign({}, currentBase(e), { note: n.value }); };
    const rr = $('#rReason'); if (rr) rr.onchange = () => setDraft({ reason: rr.value });
    const an = $('#autoNext'); if (an) an.onchange = () => { state.autoNext = an.checked; pref.set('pviw.autonext', an.checked); };
    const bs = $('#btnSign'); if (bs) bs.onclick = trySign;
    const be = $('#btnEdit'); if (be) be.onclick = () => { state.editing = e.id; renderReview(); };
    const bc = $('#btnCancelEdit'); if (bc) bc.onclick = () => { state.editing = null; delete state.drafts[e.id]; renderReview(); };
    const bn = $('#btnNextOpen'); if (bn) bn.onclick = () => goNextOpen();
    const sd = $('#btnSdv'); if (sd) sd.onclick = () => {
      const reviews = Store.get(Store.K.rev, {});
      const cur = reviews[e.id] || Object.assign({}, e.initialReview);
      cur.sdv = { by: user(), t: new Date().toISOString() }; reviews[e.id] = cur; Store.set(Store.K.rev, reviews);
      Store.audit('SDV bestätigt', `${p.id} · ${e.id}`, user()); toast('Source Data Verification dokumentiert'); refresh();
    };
  }

  // ---------- Signieren ----------
  let undoStash = null;
  function trySign() {
    const p = findPatient(state.sel); const e = p && p.ecgs.find(x => x.id === state.selEcg);
    if (!e || state.role !== 'pi') return;
    const editing = state.editing === e.id;
    if (e.review && !editing) return;
    const d = currentBase(e);
    if (!d.finding) { toast('Bitte zuerst einen Befund wählen (Tasten 1–8).'); return; }
    if (editing && !d.reason) { toast('Bitte einen Änderungsgrund angeben.'); const rr = $('#rReason'); if (rr) rr.focus(); return; }
    const warn = [];
    if (!state.blind) {
      const autoAF = e.vendorCode === 'af' || e.analysis.cls === 'af';
      if (autoAF && !RECURRENCE.has(d.finding)) warn.push(`Uhr bzw. Algorithmus melden einen <b>VHF-Hinweis</b> – Ihr Befund: <b>${FINDINGS[d.finding]}</b>.`);
      if (!autoAF && RECURRENCE.has(d.finding) && e.vendorCode === 'sr' && e.analysis.cls === 'sr') warn.push(`Uhr und Algorithmus ohne Hinweis – Ihr Befund: <b>${FINDINGS[d.finding]}</b>.`);
    }
    if (p.recurrence && p.recurrence.id === e.id && !(RECURRENCE.has(d.finding) && d.ge30s)) warn.push('Diese Änderung <b>entfernt den Endpunkt</b> dieses Patienten.');
    if (RECURRENCE.has(d.finding) && !d.ge30s) warn.push('„≥ 30 s“ ist nicht angehakt – der Befund zählt <b>nicht als Endpunkt</b>.');
    if (warn.length) confirmDlg('Befund bestätigen', warn.map(w => `<p style="margin:0">${w}</p>`).join('') + '<p style="margin:0" class="small ink2">Bestätigte Abweichungen werden im Audit-Trail und im Export markiert.</p>', 'Trotzdem signieren', () => doSign(p, e, d, editing, true));
    else doSign(p, e, d, editing, false);
  }

  function doSign(p, e, d, editing, deviation) {
    const reviews = Store.get(Store.K.rev, {});
    const stored = reviews[e.id];
    const prev = stored || e.initialReview || null;
    const history = prev ? [...(prev.history || []), Object.assign({}, prev, { history: undefined })] : [];
    const rec = { finding: d.finding, ge30s: RECURRENCE.has(d.finding) && !!d.ge30s, second: !!d.second, note: (d.note || '').trim(), by: user(), t: new Date().toISOString(), reason: editing ? d.reason : null, history, blind: state.blind, deviation };
    reviews[e.id] = rec; Store.set(Store.K.rev, reviews);
    Store.audit(prev ? 'Befund geändert' : 'Befund signiert', `${p.id} · ${e.id}: ${prev ? FINDINGS[prev.finding] + ' → ' : ''}${FINDINGS[d.finding]}${rec.ge30s ? ' (≥ 30 s)' : ''}${prev ? ' · Grund: ' + d.reason : ''}${rec.second ? ' · Zweitbefund angefordert' : ''}${state.blind ? ' · verblindet' : ''}${deviation ? ' · Warnhinweis bestätigt' : ''}`, user());
    undoStash = { items: [{ id: e.id, before: stored }], pid: p.id };
    delete state.drafts[e.id]; state.editing = null;
    toast(`Befund „${FINDINGS[d.finding]}“ für ${p.id} signiert`, undo);
    refresh();
    if (state.autoNext && !editing) goNextOpen(true);
  }

  function undo() {
    if (!undoStash) return;
    const reviews = Store.get(Store.K.rev, {});
    undoStash.items.forEach(({ id, before }) => { if (before) reviews[id] = before; else delete reviews[id]; });
    Store.set(Store.K.rev, reviews);
    Store.audit('Befund zurückgenommen (Rückgängig)', `${undoStash.pid} · ${undoStash.items.map(i => i.id).join(', ')}`, user());
    state.sel = undoStash.pid; state.selEcg = undoStash.items[0].id; undoStash = null;
    toast('Rückgängig gemacht'); refresh();
  }

  function goNextOpen(afterSign) {
    const cur = findPatient(state.sel);
    const sortE = (a, b) => LEVEL[b.prio.lvl].ord - LEVEL[a.prio.lvl].ord || (b.overdue - a.overdue) || new Date(a.t) - new Date(b.t);
    let next = cur && cur.ecgs.filter(e => !e.review && e.id !== state.selEcg).sort(sortE)[0];
    if (!next) next = state.cohort.flatMap(p => p.ecgs.filter(e => !e.review && e.id !== state.selEcg)).sort(sortE)[0];
    if (!next) { if (!afterSign) toast('Keine offenen EKGs mehr ✓'); return; }
    state.sel = next.patientId; state.selEcg = next.id; state.compare = false; state.measure = false;
    renderList(); renderMain(); window.scrollTo({ top: 0 });
  }

  // ---------- Zeichnen ----------
  const tip = $('#tip');
  const showTip = (html, x, y) => { tip.innerHTML = html; tip.style.display = 'block'; const w = tip.offsetWidth; tip.style.left = Math.min(x + 14, innerWidth - w - 8) + 'px'; tip.style.top = (y + 14) + 'px'; };
  const hideTip = () => { tip.style.display = 'none'; };

  function drawViewer(p, e) {
    const wrap = $('#ecgWrap'), cv = $('#ecgCanvas'), hl = $('#hline'), cal = $('#caliper');
    if (!wrap) return;
    const sig = signal(e), a = e.analysis;
    const geo = ECG.drawECG(cv, sig, { secondsPerRow: 10, gain: state.gain, peaks: a.peaks, showPeaks: state.showPeaks, width: wrap.clientWidth - 2 });
    const toT = (x, row) => row * geo.spr + (x - geo.calW) / geo.pxPerSec;
    let drag = null;
    wrap.onmousedown = ev => {
      if (!state.measure) return;
      const r = cv.getBoundingClientRect(); const x = ev.clientX - r.left, y = ev.clientY - r.top;
      drag = { x0: x, y0: y, row: Math.min(geo.rows - 1, Math.floor(y / geo.rowH)) };
      cal.style.display = 'none';
    };
    wrap.onmouseup = () => { drag = null; };
    wrap.onmousemove = ev => {
      const r = cv.getBoundingClientRect();
      const x = ev.clientX - r.left, y = ev.clientY - r.top;
      const row = Math.min(geo.rows - 1, Math.max(0, Math.floor(y / geo.rowH)));
      if (drag) {
        const x1 = Math.min(drag.x0, x), x2 = Math.max(drag.x0, x);
        const dt = (x2 - x1) / geo.pxPerSec * 1000;
        const dmv = Math.abs(y - drag.y0) / (geo.gain * geo.mm);
        cal.style.display = 'block'; cal.style.left = x1 + 'px'; cal.style.width = (x2 - x1) + 'px'; cal.style.top = drag.row * geo.rowH + 'px'; cal.style.height = geo.rowH + 'px';
        cal.firstChild.textContent = `${Math.round(dt)} ms${dt > 150 ? ' · ' + Math.round(60000 / dt) + '/min' : ''} · ${num(dmv, 2)} mV`;
        hideTip();
        return;
      }
      const t = toT(x, row);
      if (x < geo.calW) { hl.style.display = 'none'; hideTip(); return; }
      const idx = Math.round(t * sig.fs);
      let k = a.peaks.findIndex(pk => pk > idx); if (k < 0) k = a.peaks.length;
      const rr = k > 0 && k < a.peaks.length ? (a.peaks[k] - a.peaks[k - 1]) / sig.fs : null;
      const amp = sig.x[Math.max(0, Math.min(sig.x.length - 1, idx))];
      hl.style.display = 'block'; hl.style.left = x + 'px'; hl.style.top = row * geo.rowH + 'px'; hl.style.height = geo.rowH + 'px';
      showTip(`<b>${num(t, 2)} s</b> · ${num(amp, 2)} mV${rr ? `<br>RR ${Math.round(rr * 1000)} ms · ${Math.round(60 / rr)}/min` : ''}${state.measure ? '<br><span class="muted">Klicken und ziehen zum Messen</span>' : ''}`, ev.clientX, ev.clientY);
    };
    wrap.onmouseleave = () => { hl.style.display = 'none'; hideTip(); drag = null; };
    const cc = $('#cmpCanvas');
    if (cc) { const ref = refEcg(p, e); ECG.drawECG(cc, signal(ref), { secondsPerRow: 10, seconds: 10, gain: state.gain, width: wrap.clientWidth - 2 }); }
    drawPoincare(a);
  }

  function drawPoincare(a) {
    const cv = $('#poincare'); if (!cv) return;
    const S = Math.max(240, Math.min(320, cv.parentElement.clientWidth || 280)), pad = 48;
    const ctx = ECG.setupCanvas(cv, S, S);
    const pts = a.rr.slice(1).map((v, i) => [a.rr[i], v]);
    const lo = 0.3, hi = Math.max(1.4, ...a.rr.map(v => v + 0.05));
    const sx = v => pad + (v - lo) / (hi - lo) * (S - pad - 10);
    const sy = v => S - pad - (v - lo) / (hi - lo) * (S - pad - 10);
    ctx.fillStyle = css('--surface'); ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = css('--grid'); ctx.lineWidth = 1; ctx.fillStyle = css('--muted'); ctx.font = '11px system-ui'; ctx.textAlign = 'center';
    for (let v = 0.4; v <= hi; v += 0.4) {
      ctx.beginPath(); ctx.moveTo(sx(v), 10); ctx.lineTo(sx(v), S - pad); ctx.moveTo(pad, sy(v)); ctx.lineTo(S - 10, sy(v)); ctx.stroke();
      ctx.fillText(Math.round(v * 1000), sx(v), S - pad + 14);
      ctx.save(); ctx.textAlign = 'right'; ctx.fillText(Math.round(v * 1000), pad - 6, sy(v) + 4); ctx.restore();
    }
    ctx.fillStyle = css('--ink-2');
    ctx.fillText('RRₙ (ms)', (S + pad) / 2, S - 8);
    ctx.save(); ctx.translate(12, (S - pad) / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('RRₙ₊₁ (ms)', 0, 0); ctx.restore();
    ctx.strokeStyle = css('--axis'); ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(sx(lo), sy(lo)); ctx.lineTo(sx(hi), sy(hi)); ctx.stroke(); ctx.setLineDash([]);
    ctx.globalAlpha = 0.65; ctx.fillStyle = css('--accent');
    pts.forEach(([u, v]) => { ctx.beginPath(); ctx.arc(sx(u), sy(v), 3, 0, Math.PI * 2); ctx.fill(); });
    ctx.globalAlpha = 1;
    cv.onmousemove = ev => {
      const r = cv.getBoundingClientRect(); const x = ev.clientX - r.left, y = ev.clientY - r.top;
      let best = null, bd = 144;
      pts.forEach((pt, i) => { const d = (sx(pt[0]) - x) ** 2 + (sy(pt[1]) - y) ** 2; if (d < bd) { bd = d; best = i; } });
      if (best == null) return hideTip();
      showTip(`Schlag ${best + 2} → ${best + 3}<br><b>${Math.round(pts[best][0] * 1000)} ms → ${Math.round(pts[best][1] * 1000)} ms</b>`, ev.clientX, ev.clientY);
    };
    cv.onmouseleave = hideTip;
  }

  function drawHrChart(p) {
    const wrap = $('#hrWrap'), cv = $('#hrChart');
    const W = wrap.clientWidth, H = 210, pl = 40, pr = 60, pt = 10, pb = 34;
    const ctx = ECG.setupCanvas(cv, W, H);
    const data = p.hrDaily;
    const start = Date.now() - 29.5 * DAY, end = Date.now() + 0.5 * DAY;
    const ymin = 40, ymax = Math.max(160, ...data.map(d => d.maxRest + 10));
    const sx = t => pl + (t - start) / (end - start) * (W - pl - pr);
    const sy = v => pt + (1 - (v - ymin) / (ymax - ymin)) * (H - pt - pb);
    ctx.fillStyle = css('--surface'); ctx.fillRect(0, 0, W, H);
    const pvi = new Date(p.pviDate).getTime(), be = pvi + BLANKING_DAYS * DAY;
    if (be > start) {
      const x1 = sx(Math.max(start, pvi)), x2 = sx(Math.min(end, be));
      ctx.fillStyle = css('--surface-2'); ctx.fillRect(x1, pt, x2 - x1, H - pt - pb);
      ctx.fillStyle = css('--ink-2'); ctx.font = '11px system-ui'; ctx.textAlign = 'left'; ctx.fillText('Blanking', x1 + 4, pt + 12);
    }
    ctx.font = '11px system-ui'; ctx.fillStyle = css('--muted'); ctx.strokeStyle = css('--grid'); ctx.lineWidth = 1;
    for (let v = 40; v <= ymax; v += 20) {
      ctx.beginPath(); ctx.moveTo(pl, Math.round(sy(v)) + .5); ctx.lineTo(W - pr, Math.round(sy(v)) + .5); ctx.stroke();
      ctx.textAlign = 'right'; ctx.fillText(v, pl - 6, sy(v) + 4);
    }
    ctx.textAlign = 'center';
    for (let d = 28; d >= 0; d -= 7) {
      const t = new Date(Date.now() - d * DAY); t.setHours(12, 0, 0, 0);
      ctx.fillText(d === 0 ? 'heute' : t.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }), sx(+t), H - 6);
    }
    ctx.strokeStyle = css('--ink-2'); ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(pl, sy(110)); ctx.lineTo(W - pr, sy(110)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = css('--ink-2'); ctx.textAlign = 'left'; ctx.fillText('110', W - pr + 6, sy(110) + 4);
    p.ecgs.forEach(e => {
      const t = new Date(e.t).getTime(); if (t < start) return;
      const x = sx(t), y = H - pb + 8;
      const col = e.review ? (RECURRENCE.has(e.review.finding) ? css('--critical') : css('--muted')) : e.prio.lvl === 'critical' ? css('--critical') : e.prio.lvl === 'warning' ? css('--warning') : css('--accent');
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4); ctx.fillStyle = col; ctx.fillRect(-3.5, -3.5, 7, 7); ctx.restore();
    });
    if (!data.length) { ctx.textAlign = 'center'; ctx.fillStyle = css('--ink-2'); ctx.fillText('Keine Daten', W / 2, H / 2); return; }
    const pts = data.map(d => [sx(new Date(d.date).getTime() + DAY / 2), d]);
    ctx.strokeStyle = css('--muted'); ctx.lineWidth = 1; ctx.beginPath();
    pts.forEach(([x, d], i) => i ? ctx.lineTo(x, sy(d.rest)) : ctx.moveTo(x, sy(d.rest))); ctx.stroke();
    ctx.strokeStyle = css('--accent'); ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.beginPath();
    pts.forEach(([x, d], i) => i ? ctx.lineTo(x, sy(d.maxRest)) : ctx.moveTo(x, sy(d.maxRest))); ctx.stroke();
    pts.filter(q => q[1].maxRest >= 110).forEach(([x, d]) => {
      ctx.beginPath(); ctx.arc(x, sy(d.maxRest), 5, 0, Math.PI * 2); ctx.fillStyle = css('--critical'); ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = css('--surface'); ctx.stroke();
    });
    const last = pts[pts.length - 1];
    ctx.fillStyle = css('--ink'); ctx.textAlign = 'left'; ctx.font = '600 11px system-ui';
    ctx.fillText(`${last[1].maxRest}/min`, W - pr + 6, sy(last[1].maxRest) + (Math.abs(sy(last[1].maxRest) - sy(110)) < 12 ? 14 : 4));
    cv.onmousemove = ev => {
      const r = cv.getBoundingClientRect(); const x = ev.clientX - r.left;
      let best = pts[0]; pts.forEach(q => { if (Math.abs(q[0] - x) < Math.abs(best[0] - x)) best = q; });
      const d = best[1];
      const n = p.ecgs.filter(e => new Date(e.t).toDateString() === new Date(d.date).toDateString()).length;
      showTip(`<b>${fmtD(d.date)}</b><br>max. Ruhe-HF ${d.maxRest}/min${d.maxRest >= 110 ? ' · über Schwelle' : ''}<br>Ruhe-HF (Median) ${d.rest}/min${n ? `<br>${n} EKG` : ''}`, ev.clientX, ev.clientY);
    };
    cv.onmouseleave = hideTip;
  }

  // ---------- Aktionen ----------
  function bindMain(p, e) {
    $$('#main [data-ecg]').forEach(el => el.onclick = () => selectEcg(el.dataset.ecg));
    $$('tr.erow').forEach(tr => { tr.onclick = () => selectEcg(tr.dataset.e); tr.onkeydown = ev => { if (ev.key === 'Enter') selectEcg(tr.dataset.e); }; });
    const ta = $('#toggleAll'); if (ta) ta.onclick = () => { state.showAllEcgs = !state.showAllEcgs; renderMain(); };
    $$('[data-gain]').forEach(b => b.onclick = () => { state.gain = +b.dataset.gain; $$('[data-gain]').forEach(x => x.classList.toggle('on', +x.dataset.gain === state.gain)); drawViewer(p, e); });
    const tp = $('#tPeaks'); if (tp) tp.onclick = () => { state.showPeaks = !state.showPeaks; tp.classList.toggle('on', state.showPeaks); drawViewer(p, e); };
    const tm = $('#tMeasure'); if (tm) tm.onclick = () => { state.measure = !state.measure; tm.classList.toggle('on', state.measure); $('#ecgWrap').classList.toggle('measure', state.measure); $('#caliper').style.display = 'none'; };
    const tc = $('#tCompare'); if (tc) tc.onclick = () => { state.compare = !state.compare; renderMain(); };
    $$('[data-tab]').forEach(b => b.onclick = () => { state.tab = b.dataset.tab; $$('[data-tab]').forEach(x => x.classList.toggle('on', x === b)); renderTab(p); });
    $('#btnContact').onclick = () => openContact(p);
    $('#btnReq').onclick = () => requestEcg(p);
    $$('#main [data-act=contact]').forEach(b => b.onclick = () => openContact(p));
    $$('#main [data-act=request]').forEach(b => b.onclick = () => requestEcg(p));
  }
  function selectEcg(id) {
    state.selEcg = id; state.measure = false; renderMain();
    const v = $('#viewer'); if (v && v.getBoundingClientRect().top > innerHeight * 0.6) v.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function requestEcg(p) {
    const send = () => {
      Store.push(Store.K.req, { id: 'REQ-' + Date.now(), patientId: p.id, t: new Date().toISOString() });
      Store.audit('EKG angefordert', `${p.id}: Push-Nachricht „Bitte EKG aufzeichnen“`, user());
      toast(`Push-Nachricht an ${p.id} gesendet${p.demo ? ' – siehe Patienten-App' : ''}`); refresh();
    };
    if (p.pendingReq) confirmDlg('Erneut anfordern?', `<p style="margin:0">Bereits ${rel(p.pendingReq.t)} angefordert, noch kein EKG eingegangen. Nochmals eine Push-Nachricht senden?</p>`, 'Erneut senden', send);
    else send();
  }

  function openContact(p) {
    const dlg = $('#dlgContact');
    const refs = [...p.reasons.filter(r => r.ecg).map(r => r.ecg), ...p.ecgs.slice(0, 4).map(e => e.id)].filter((v, i, a) => a.indexOf(v) === i);
    const tomorrow = new Date(Date.now() + DAY).toISOString().slice(0, 10);
    dlg.innerHTML = `<form method="dialog" class="dlg">
      <h2>Patientenkontakt dokumentieren</h2>
      <div class="small ink2">${p.id} · ${esc(p.device.model)} · ${esc(user())}</div>
      <label>Bezug<select id="cRef"><option value="">Allgemein</option>${refs.map(id => { const e = p.ecgs.find(x => x.id === id); return `<option value="${id}">EKG ${fmtDT(e.t)}${e.review ? ' · ' + FINDINGS[e.review.finding] : ''} (${id})</option>`; }).join('')}</select></label>
      <div class="row2">
        <label>Art<select id="cMethod">${['Telefonat', 'Nachricht über Studien-App', 'Videosprechstunde', 'Vorstellung Ambulanz', 'Nicht erreicht'].map(x => `<option>${x}</option>`).join('')}</select></label>
        <label>Ergebnis / Maßnahme<select id="cOutcome">${['Keine Maßnahme erforderlich', 'Langzeit-EKG veranlasst', 'Einbestellung Rhythmusambulanz', 'Therapieanpassung', 'Kardioversion geplant', 'Re-Ablation geplant', 'Nicht erreicht'].map(x => `<option>${x}</option>`).join('')}</select></label>
      </div>
      <label>Notiz<textarea id="cNote" placeholder="z. B. Pat. symptomatisch, Termin Langzeit-EKG am …"></textarea></label>
      <div class="row2">
        <label>Wiedervorlage<input type="date" id="cFu"></label>
        <label>Zuständig<select id="cAss"><option value="">–</option>${Object.values(USERS).slice(0, 2).map(u => `<option>${u}</option>`).join('')}</select></label>
      </div>
      <div class="row"><div class="spacer"></div><button value="cancel" formnovalidate>Abbrechen</button><button class="primary" id="cSave" value="ok">Speichern</button></div>
    </form>`;
    const m = $('#cMethod'), o = $('#cOutcome'), fu = $('#cFu');
    m.onchange = () => { if (m.value === 'Nicht erreicht') { o.value = 'Nicht erreicht'; if (!fu.value) fu.value = tomorrow; } };
    $('#cSave').onclick = ev => {
      ev.preventDefault();
      Store.push(Store.K.contact, { patientId: p.id, t: new Date().toISOString(), method: m.value, outcome: o.value, note: $('#cNote').value.trim(), by: user(), ref: $('#cRef').value || null, followUp: fu.value ? new Date(fu.value + 'T08:00').toISOString() : null, assignee: $('#cAss').value || null });
      Store.audit('Kontakt dokumentiert', `${p.id}: ${m.value} → ${o.value}`, user());
      dlg.close(); toast('Kontakt dokumentiert'); refresh();
    };
    dlg.showModal();
  }

  function confirmDlg(title, html, okLabel, onOk) {
    const dlg = $('#dlgConfirm');
    dlg.innerHTML = `<form method="dialog" class="dlg" style="max-width:520px"><h2>${esc(title)}</h2>${html}<div class="row"><div class="spacer"></div><button value="cancel">Abbrechen</button><button class="primary" value="ok" id="cfOk">${esc(okLabel)}</button></div></form>`;
    $('#cfOk').onclick = ev => { ev.preventDefault(); dlg.close(); onOk(); };
    dlg.showModal(); setTimeout(() => { const b = $('#cfOk'); if (b) b.focus(); }, 0);
  }

  // ---------- Stapelbefundung ----------
  function openBatch() {
    const dlg = $('#dlgBatch');
    if (state.role !== 'pi') { toast('Stapelbefundung nur für Prüfärztinnen und -ärzte.'); return; }
    if (state.blind) { toast('Im verblindeten Modus nicht verfügbar (die Auswahl beruht auf automatischer Einstufung).'); return; }
    const items = state.cohort.flatMap(p => p.ecgs.filter(e => !e.review && e.prio.lvl === 'todo' && e.analysis.quality === 'gut' && !e.symptoms.length).map(e => ({ p, e })));
    dlg.innerHTML = `<form method="dialog" class="dlg" style="min-width:min(860px,94vw)">
      <h2>Stapelbefundung unauffälliger Routine-EKGs (${items.length})</h2>
      <div class="small ink2">Auswahl: unbefundet, Uhr „Sinusrhythmus“ und Algorithmus „regelmäßig“, Signalqualität gut, keine Symptome. Bitte jede Kurve ansehen – jedes EKG erhält einen eigenen Audit-Eintrag.</div>
      <div class="batch-list">${items.map(({ p, e }, i) => `<label class="batch-item"><input type="checkbox" data-i="${i}" checked><span class="small"><b>${p.id}</b><br>${fmtDT(e.t)} · Tag ${dayPostPvi(p, e.t)}<br>${Math.round(e.analysis.hr)}/min</span><canvas data-c="${i}"></canvas></label>`).join('') || '<div class="empty">Keine passenden EKGs.</div>'}</div>
      <div class="row"><span class="small ink2" id="bCount"></span><div class="spacer"></div><button value="cancel">Abbrechen</button><button class="primary" id="bSign" ${items.length ? '' : 'disabled'}>Ausgewählte als Sinusrhythmus signieren</button></div>
    </form>`;
    dlg.showModal();
    const cw = Math.max(320, Math.min(640, dlg.clientWidth - 260));
    $$('#dlgBatch canvas').forEach(c => { const { e } = items[+c.dataset.c]; ECG.drawECG(c, signal(e), { secondsPerRow: 10, seconds: 10, width: cw, gain: 10 }); });
    const upd = () => { $('#bCount').textContent = `${$$('#dlgBatch input[data-i]:checked').length} ausgewählt`; };
    $$('#dlgBatch input[data-i]').forEach(i => i.onchange = upd); upd();
    $('#bSign').onclick = ev => {
      ev.preventDefault();
      const sel = $$('#dlgBatch input[data-i]:checked').map(i => items[+i.dataset.i]);
      if (!sel.length) return;
      const reviews = Store.get(Store.K.rev, {});
      const now = new Date().toISOString();
      undoStash = { items: sel.map(({ e }) => ({ id: e.id, before: reviews[e.id] })), pid: sel[0].p.id };
      sel.forEach(({ p, e }) => {
        reviews[e.id] = { finding: 'SR', ge30s: false, second: false, note: '', by: user(), t: now, reason: null, history: [], batch: true };
        Store.audit('Befund signiert (Stapel)', `${p.id} · ${e.id}: Sinusrhythmus`, user());
      });
      Store.set(Store.K.rev, reviews);
      dlg.close(); toast(`${sel.length} EKGs als Sinusrhythmus signiert`, undo); refresh();
    };
  }

  // ---------- Export ----------
  function download(name, rows) {
    const csv = '﻿' + rows.map(r => r.map(v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`).join(';')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `pvi-watch-${name}-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    Store.audit('Studienexport', `${name}.csv (${rows.length - 1} Zeilen) · alle Patienten`, user());
  }
  const EXPORTS = {
    ekgs: ['EKG-Datensatz', 'eine Zeile pro EKG: Uhr, Algorithmus, Arzt, Fristen', () => {
      const stand = new Date().toISOString();
      const rows = [['Datenstand_UTC', 'Studien_ID', 'Geraet', 'Schnittstelle', 'EKG_ID', 'Zeitpunkt_UTC', 'Tag_nach_PVI', 'Blanking', 'Ausloeser', 'Symptome', 'Uhr_Klassifikation', 'Algorithmus_Code', 'Algorithmus_Version', 'HF_mittel', 'RR_CV', 'nRMSSD', 'Signalqualitaet', 'Befund_Code', 'Befund', 'Episode_ge30s', 'Befundversion', 'Geaendert', 'Warnhinweis_bestaetigt', 'Verblindet', 'Zweitbefund_angefordert', 'Befundet_von', 'Befundet_UTC', 'Befundungsdauer_h', 'Frist_ueberschritten']];
      state.cohort.forEach(p => p.ecgs.forEach(e => {
        const a = e.analysis, r = e.review, d = dayPostPvi(p, e.t);
        const dur = r ? ((new Date(r.t) - new Date(e.t)) / 3600000).toFixed(1) : '';
        const late = r ? new Date(r.t) > dueOf(e) : e.overdue;
        rows.push([stand, p.id, p.device.model, p.device.path, e.id, e.t, d, d <= BLANKING_DAYS ? 1 : 0, e.trigger, e.symptoms.join('|'), e.vendorClass, a.cls, ALGO_VERSION, Math.round(a.hr), a.cv.toFixed(3), a.nrmssd.toFixed(3), a.quality,
          r ? r.finding : '', r ? FINDINGS[r.finding] : '', r ? (r.ge30s ? 1 : 0) : '', r ? (r.history || []).length + 1 : '', r ? ((r.history || []).length ? 1 : 0) : '', r && r.deviation ? 1 : 0, r && r.blind ? 1 : 0, r && r.second ? 1 : 0, r ? r.by : '', r ? r.t : '', dur, late ? 1 : 0]);
      }));
      return rows;
    }],
    patients: ['Patienten & Endpunkte', 'eine Zeile pro Patient: erstes Rezidiv, Zensierung, Klinik', () => {
      const stand = new Date().toISOString();
      const rows = [['Datenstand_UTC', 'Studien_ID', 'Geraet', 'PVI_Datum', 'Follow_up_Tage', 'VHF_Typ', 'Energie', 'Laesionen', 'AAD_aktuell', 'OAK', 'CHA2DS2_VASc', 'EKGs_gesamt', 'EKGs_befundet', 'EKGs_letzte_7_Tage', 'Endpunkt_Rezidiv', 'Erstes_Rezidiv_UTC', 'Erstes_Rezidiv_Tag', 'Erstes_Rezidiv_EKG', 'Erstes_Rezidiv_Befund', 'Zensiert', 'Fruehrezidiv_Blanking', 'Fruehrezidiv_Tag', 'Status_Dashboard']];
      state.cohort.forEach(p => {
        const r = p.recurrence;
        rows.push([stand, p.id, p.device.model, p.pviDate, p.dayPost, p.clin.afType, p.clin.energy, p.clin.lesions, p.clin.aad, p.clin.oak, p.clin.cha, p.ecgs.length, p.ecgs.filter(e => e.review).length, p.ecgs.filter(e => daysSince(e.t) <= 7).length,
          r ? 1 : 0, r ? r.t : '', r ? dayPostPvi(p, r.t) : '', r ? r.id : '', r ? r.review.finding : '', r ? 0 : 1, p.early ? 1 : 0, p.early ? dayPostPvi(p, p.early.t) : '', LEVEL[p.level].label]);
      });
      return rows;
    }],
    contacts: ['Kontakte & Ereignisse', 'Kontakte, EKG-Anforderungen, Alarme der Uhr', () => {
      const rows = [['Studien_ID', 'Typ', 'Zeitpunkt_UTC', 'Details', 'Ergebnis', 'Bezug', 'Wiedervorlage', 'Zustaendig', 'Von']];
      state.cohort.forEach(p => {
        contacts(p).forEach(c => rows.push([p.id, 'Kontakt: ' + c.method, c.t, c.note, c.outcome, c.ref, c.followUp, c.assignee, c.by]));
        p.events.forEach(ev => rows.push([p.id, ev.type === 'REQ' ? 'EKG-Anforderung' : ev.type === 'HR' ? 'HF-Alarm' : 'Rhythmus-Hinweis Uhr', ev.t, ev.text, ev.pending ? 'offen' : 'EKG eingegangen', ev.resolvedBy, '', '', 'System']));
      });
      return rows;
    }],
    audit: ['Audit-Trail', 'alle Aktionen mit Nutzer und Zeitstempel', () => [['Zeitpunkt_UTC', 'Nutzer', 'Aktion', 'Details'], ...Store.get(Store.K.audit, []).map(a => [a.t, a.user, a.action, a.detail])]],
  };
  $('#exportMenu').innerHTML = Object.entries(EXPORTS).map(([k, [l, s]]) => `<button data-x="${k}" role="menuitem">${l}<small>${s}</small></button>`).join('') + `<div class="small muted" style="padding:6px 10px">CSV (;), UTF-8, Zeitstempel UTC · ${esc(ALGO_VERSION)}</div>`;
  $('#btnExport').onclick = ev => { ev.stopPropagation(); $('#exportMenu').classList.toggle('open'); };
  $('#exportMenu').onclick = ev => { const b = ev.target.closest('[data-x]'); if (b) { download(b.dataset.x, EXPORTS[b.dataset.x][2]()); $('#exportMenu').classList.remove('open'); } };
  document.addEventListener('click', () => $('#exportMenu').classList.remove('open'));

  // ---------- Tastatur ----------
  const KEYS = [['1 – 8', 'Befund wählen'], ['L', '„≥ 30 s“ umschalten'], ['Z', 'Zweitbefundung anfordern'], ['Strg + Enter', 'Signieren'], ['N', 'Nächstes offenes EKG'], ['← / →', 'Vorheriges / nächstes EKG des Patienten'], ['J / K', 'Nächster / vorheriger Patient in der Liste'], ['G', 'Verstärkung 5 → 10 → 20 mm/mV'], ['R', 'R-Zacken ein/aus'], ['M', 'Messzirkel ein/aus'], ['V', 'Vergleich mit Sinusrhythmus-EKG'], ['?', 'Diese Übersicht'], ['Esc', 'Dialog schließen']];
  function openKeys() {
    const dlg = $('#dlgKeys');
    dlg.innerHTML = `<form method="dialog" class="dlg"><h2>Tastenkürzel</h2><div class="keys">${KEYS.map(([k, l]) => `<kbd>${k}</kbd><span>${l}</span>`).join('')}</div><div class="row"><div class="spacer"></div><button value="ok" class="primary">Schließen</button></div></form>`;
    dlg.showModal();
  }
  document.addEventListener('keydown', ev => {
    if (document.querySelector('dialog[open]')) return;
    const t = ev.target, tag = t.tagName;
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { ev.preventDefault(); trySign(); return; }
    const typing = tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && ['text', 'search', 'date'].includes(t.type));
    if (typing || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (t.type === 'radio' && ev.key.startsWith('Arrow')) return;
    const p = findPatient(state.sel);
    const k = ev.key, lower = k.toLowerCase();
    if (k >= '1' && k <= '8') { setDraft({ finding: FKEYS[+k - 1] }); return; }
    if (lower === 'l') { const e = p && p.ecgs.find(x => x.id === state.selEcg); if (e) setDraft({ ge30s: !currentBase(e).ge30s }); }
    else if (lower === 'z') { const e = p && p.ecgs.find(x => x.id === state.selEcg); if (e) setDraft({ second: !currentBase(e).second }); }
    else if (lower === 'n') goNextOpen();
    else if (lower === 'j' || lower === 'k') {
      const ids = $$('#plist [data-p]').map(b => b.dataset.p); if (!ids.length) return;
      const i = ids.indexOf(state.sel); const ni = lower === 'j' ? Math.min(ids.length - 1, i + 1) : Math.max(0, i - 1);
      state.sel = ids[ni < 0 ? 0 : ni]; state.selEcg = null; state.editing = null; renderList(); renderMain(); window.scrollTo({ top: 0 });
    } else if ((k === 'ArrowRight' || k === 'ArrowLeft') && p) {
      const list = orderedEcgs(p).map(e => e.id); const i = list.indexOf(state.selEcg);
      const ni = k === 'ArrowRight' ? Math.min(list.length - 1, i + 1) : Math.max(0, i - 1);
      if (list[ni] && list[ni] !== state.selEcg) { ev.preventDefault(); selectEcg(list[ni]); }
    } else if (lower === 'g') { state.gain = state.gain === 5 ? 10 : state.gain === 10 ? 20 : 5; renderMain(); }
    else if (lower === 'r') { const b = $('#tPeaks'); if (b) b.click(); }
    else if (lower === 'm') { const b = $('#tMeasure'); if (b) b.click(); }
    else if (lower === 'v') { const b = $('#tCompare'); if (b && !b.disabled) b.click(); }
    else if (k === '?') openKeys();
  });

  // ---------- Toast ----------
  let toastT;
  function toast(msg, undoFn) {
    const t = $('#toast');
    t.innerHTML = `${esc(msg)}${undoFn ? ' <button class="mini" id="toastUndo" style="margin-left:8px">Rückgängig</button>' : ''}`;
    t.classList.add('show'); clearTimeout(toastT);
    if (undoFn) $('#toastUndo').onclick = () => { t.classList.remove('show'); undoFn(); };
    toastT = setTimeout(() => t.classList.remove('show'), undoFn ? 10000 : 4000);
  }

  // ---------- Global ----------
  function refresh() {
    load(); renderKpis(); renderList();
    const ae = document.activeElement;
    const typingInReview = ae && $('#reviewCol').contains(ae) && ae.tagName === 'TEXTAREA';
    renderMain(typingInReview); // Entwürfe liegen im State und gehen nicht verloren
  }

  $('#kpis').onclick = ev => { const b = ev.target.closest('[data-f]'); if (b) { state.filter = b.dataset.f; state.q = ''; $('#search').value = ''; renderKpis(); renderList(); } };
  $('#chips').onclick = ev => { const b = ev.target.closest('[data-f]'); if (b) { state.filter = b.dataset.f; state.q = ''; $('#search').value = ''; renderKpis(); renderList(); } };
  $('#search').oninput = ev => { state.q = ev.target.value; renderList(); };
  $('#plist').onclick = ev => { const r = ev.target.closest('[data-p]'); if (r) { state.sel = r.dataset.p; state.selEcg = null; state.measure = false; state.compare = false; state.editing = null; renderList(); renderMain(); window.scrollTo({ top: 0 }); } };
  $('#tBlind').checked = state.blind;
  $('#tBlind').onchange = ev => { state.blind = ev.target.checked; pref.set('pviw.blind', state.blind); Store.audit('Studienmodus', `Verblindete Befundung ${state.blind ? 'ein' : 'aus'} (alle Patienten)`, user()); refresh(); };
  $('#tRole').value = state.role;
  $('#tRole').onchange = ev => { state.role = ev.target.value; pref.set('pviw.role', state.role); $('#userName').textContent = user(); refresh(); };
  $('#userName').textContent = user();
  $('#algoVer').textContent = ALGO_VERSION;
  $('#btnBatch').onclick = openBatch;
  $('#btnKeys').onclick = openKeys;

  // Live-Update aus der Patienten-App
  let lastDemo = Store.get(Store.K.ecg, []);
  window.addEventListener('storage', ev => {
    if (ev.key !== 'pviw.version') return;
    const now = Store.get(Store.K.ecg, []);
    if (now.length > lastDemo.length) toast(`Neues EKG eingegangen: ${now[now.length - 1].patientId}`);
    lastDemo = now;
    refresh();
  });
  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => renderMain(), 150); });

  load();
  const first = [...state.cohort].sort((a, b) => b.prioSort - a.prioSort || b.lastActivity - a.lastActivity)[0];
  state.sel = new URLSearchParams(location.search).get('p') || first.id;
  renderKpis(); renderList(); renderMain();
})();
