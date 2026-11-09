/* PVI-Watch Prototyp – Klinik-Dashboard */
(function () {
  'use strict';
  const { Store, FINDINGS, RECURRENCE, BLANKING_DAYS, DAY, daysSince, dayPostPvi } = PVI;
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const state = { cohort: [], sel: null, selEcg: null, filter: 'open', q: '', showPeaks: true, gain: 10 };
  const sigCache = new Map();

  // ---------- Formatierung ----------
  const fmtDT = iso => { const d = new Date(iso); return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); };
  const fmtD = iso => new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const rel = iso => {
    const h = (Date.now() - new Date(iso)) / 3600000;
    if (h < 1) return `vor ${Math.max(1, Math.round(h * 60))} min`;
    if (h < 24) return `vor ${Math.round(h)} h`;
    const d = Math.round(h / 24); return d === 1 ? 'gestern' : `vor ${d} Tagen`;
  };
  const num = (v, d = 0) => v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });

  const LEVEL = {
    critical: { label: 'Prüfen', icon: '!', ord: 3 },
    warning: { label: 'Beobachten', icon: '•', ord: 2 },
    none: { label: 'Keine Daten', icon: '–', ord: 1 },
    done: { label: 'Befundet', icon: '✓', ord: 0 },
    good: { label: 'Unauffällig', icon: '✓', ord: 0 },
  };
  const badge = (lvl, text) => `<span class="badge ${lvl}"><span class="dot">${LEVEL[lvl] ? LEVEL[lvl].icon : 'i'}</span>${esc(text || (LEVEL[lvl] && LEVEL[lvl].label) || '')}</span>`;

  // ---------- Daten ----------
  function signal(e) {
    if (!sigCache.has(e.id)) sigCache.set(e.id, ECG.synth({ rhythm: e.rhythm, hr: e.hr, seed: e.seed }));
    return sigCache.get(e.id);
  }
  function load() {
    state.cohort = PVI.loadCohort();
    state.cohort.forEach(p => {
      p.ecgs.forEach(e => { if (!e.analysis) e.analysis = ECG.analyze(signal(e)); });
      assess(p);
    });
  }

  // Flag-Logik: das System sortiert nur – entschieden wird ärztlich
  function assess(p) {
    const reasons = [];
    let level = 'good';
    const bump = l => { if (LEVEL[l].ord > LEVEL[level].ord) level = l; };
    p.ecgs.forEach(e => {
      if (e.review) return;
      const a = e.analysis;
      const why = `EKG ${fmtDT(e.t)} – Uhr: „${e.vendorClass}“, Algorithmus: ${a.label}`;
      if (a.cls === 'af' || e.vendorCode === 'af') { bump('critical'); reasons.push({ lvl: 'critical', text: why, ecg: e.id }); }
      else if (['tachy', 'unclear', 'ectopy'].includes(a.cls) || e.vendorCode === 'unclear') { bump('warning'); reasons.push({ lvl: 'warning', text: why, ecg: e.id }); }
    });
    p.events.filter(ev => ev.pending).forEach(ev => {
      bump('warning');
      reasons.push({ lvl: 'warning', text: `${ev.text} (${rel(ev.t)}) – EKG angefordert, noch nicht eingegangen` });
    });
    const sync = daysSince(p.lastSync);
    if (sync > 5) { bump('none'); reasons.push({ lvl: 'none', text: `Keine Datenübertragung seit ${Math.floor(sync)} Tagen – Patient erinnern` }); }
    else if (p.device.ecg && (!p.ecgs.length || daysSince(p.ecgs[0].t) > 7)) { bump('none'); reasons.push({ lvl: 'none', text: 'Seit über 7 Tagen kein EKG' }); }
    if (!p.device.ecg) reasons.push({ lvl: 'info', text: `${p.device.vendor}: EKG-Kurve über Thryve nicht verfügbar – nur HF-Monitoring` });
    p.level = level;
    p.reasons = reasons;
    p.unreviewed = p.ecgs.filter(e => !e.review).length;
    p.dayPost = dayPostPvi(p);
    p.inBlanking = p.dayPost <= BLANKING_DAYS;
    p.recurrence = p.ecgs.find(e => e.review && RECURRENCE.has(e.review.finding) && dayPostPvi(p, e.t) > BLANKING_DAYS) || null;
    p.confirmed = p.ecgs.find(e => e.review && RECURRENCE.has(e.review.finding) && daysSince(e.t) <= 30) || null;
    if (p.level === 'good' && p.confirmed) p.level = 'done';
    p.lastActivity = Math.max(new Date(p.lastSync), ...p.ecgs.slice(0, 1).map(e => +new Date(e.t)));
  }

  // ---------- KPIs ----------
  function renderKpis() {
    const c = state.cohort;
    const count = l => c.filter(p => p.level === l).length;
    const wk = c.reduce((s, p) => s + p.ecgs.filter(e => daysSince(e.t) <= 7).length, 0);
    const capable = c.filter(p => p.device.ecg);
    const adh = capable.filter(p => p.ecgs.filter(e => daysSince(e.t) <= 7).length >= 2).length;
    const rec = c.filter(p => p.recurrence).length;
    const post = c.filter(p => !p.inBlanking).length;
    const tiles = [
      { l: 'Eingeschlossen', v: c.length, s: `${c.length - post} in Blanking-Periode (≤ ${BLANKING_DAYS} Tage)` },
      { l: badge('critical', 'Prüfen'), v: count('critical'), s: 'VHF-Hinweis, unbefundet' },
      { l: badge('warning', 'Beobachten'), v: count('warning'), s: 'Tachykardie / unklar / EKG ausstehend' },
      { l: 'EKGs letzte 7 Tage', v: wk, s: `${c.reduce((s, p) => s + p.unreviewed, 0)} noch unbefundet` },
      { l: 'Adhärenz', v: capable.length ? Math.round(adh / capable.length * 100) + ' %' : '–', s: '≥ 2 EKGs in den letzten 7 Tagen' },
      { l: 'Bestätigte Rezidive', v: rec, s: `nach Blanking, ärztlich befundet (n = ${post})` },
    ];
    $('#kpis').innerHTML = tiles.map(t => `<div class="card kpi"><div class="l">${t.l}</div><div class="v">${t.v}</div><div class="s">${t.s}</div></div>`).join('');
  }

  // ---------- Patientenliste ----------
  const FILTERS = [
    ['open', 'Offen'], ['critical', 'Prüfen'], ['warning', 'Beobachten'], ['none', 'Keine Daten'], ['done', 'Befundet'], ['good', 'Unauffällig'], ['all', 'Alle'],
  ];
  function renderList() {
    const c = state.cohort;
    const n = f => f === 'all' ? c.length : f === 'open' ? c.filter(p => !['good', 'done'].includes(p.level)).length : c.filter(p => p.level === f).length;
    $('#chips').innerHTML = FILTERS.map(([k, l]) => `<button class="chip ${state.filter === k ? 'active' : ''}" data-f="${k}">${l} · ${n(k)}</button>`).join('');
    const q = state.q.toLowerCase();
    const rows = c
      .filter(p => state.filter === 'all' || (state.filter === 'open' ? !['good', 'done'].includes(p.level) : p.level === state.filter))
      .filter(p => !q || (p.id + ' ' + p.device.model + ' ' + p.device.vendor).toLowerCase().includes(q))
      .sort((a, b) => LEVEL[b.level].ord - LEVEL[a.level].ord || b.lastActivity - a.lastActivity);
    $('#plist').innerHTML = rows.length ? rows.map(p => {
      const top = p.reasons.find(r => r.lvl !== 'info');
      const last = p.ecgs[0];
      return `<div class="prow ${state.sel === p.id ? 'sel' : ''}" data-p="${p.id}">
        <div><span class="id">${p.id}</span> <span class="small muted">· ${esc(p.device.model)}</span></div>
        <div>${badge(p.level)}</div>
        <div class="small ink2">Tag ${p.dayPost} nach PVI ${p.inBlanking ? '<span class="pill blanking">Blanking</span>' : ''} ${p.recurrence ? '<span class="pill endpoint">Rezidiv</span>' : ''} ${p.confirmed && !p.recurrence ? `<span class="pill">${FINDINGS[p.confirmed.review.finding]} bestätigt</span>` : ''}</div>
        <div class="small muted tnum">${last ? 'EKG ' + rel(last.t) : 'kein EKG'}</div>
        <div class="why">${top ? esc(top.text) : (p.unreviewed ? p.unreviewed + ' unauffällige EKG(s) unbefundet' : 'Alle EKGs befundet')}</div>
      </div>`;
    }).join('') : '<div class="empty">Keine Patienten in dieser Ansicht 🎉</div>';
  }

  // ---------- Detailansicht ----------
  function renderDetail() {
    const p = state.cohort.find(x => x.id === state.sel);
    if (!p) { $('#detail').innerHTML = '<div class="card empty">Patient in der Liste auswählen</div>'; return; }
    if (!state.selEcg || !p.ecgs.find(e => e.id === state.selEcg)) {
      const flagged = p.reasons.find(r => r.ecg);
      state.selEcg = flagged ? flagged.ecg : (p.ecgs[0] && p.ecgs[0].id);
    }
    const e = p.ecgs.find(x => x.id === state.selEcg);
    const blankEnd = new Date(new Date(p.pviDate).getTime() + BLANKING_DAYS * DAY);

    $('#detail').innerHTML = `
      <div class="card sec">
        <div class="phead">
          <div class="pid">${p.id}</div>${badge(p.level)}
          ${p.confirmed ? `<span class="pill">${FINDINGS[p.confirmed.review.finding]} ärztlich bestätigt · Tag ${dayPostPvi(p, p.confirmed.t)}${dayPostPvi(p, p.confirmed.t) <= BLANKING_DAYS ? ' (Blanking, kein Endpunkt)' : ''}</span>` : ''}
          ${p.recurrence ? `<span class="pill endpoint">Endpunkt: Rezidiv bestätigt (Tag ${dayPostPvi(p, p.recurrence.t)})</span>` : ''}
          <div class="spacer"></div>
          <div class="row" style="flex-wrap:nowrap"><button id="btnReq" ${p.device.ecg ? '' : 'disabled'}>📲 EKG anfordern</button>
          <button class="primary" id="btnContact">☎ Kontakt dokumentieren</button></div>
        </div>
        <div class="facts">
          <span><b>${p.age} J., ${p.sex === 'w' ? 'weiblich' : 'männlich'}</b></span>
          <span>Uhr: <b>${esc(p.device.model)}</b></span>
          <span>Schnittstelle: <b>${esc(p.device.path)}</b></span>
          <span>PVI: <b>${fmtD(p.pviDate)}</b> (Tag ${p.dayPost})</span>
          <span>Blanking: <b>${p.inBlanking ? 'bis ' + fmtD(blankEnd.toISOString()) : 'abgeschlossen ✓'}</b></span>
          <span>Letzte Synchronisation: <b>${rel(p.lastSync)}</b></span>
        </div>
        ${p.note ? `<div class="small muted" style="margin-top:6px">${esc(p.note)}</div>` : ''}
        ${p.reasons.length ? `<ul class="reasons">${p.reasons.map(r => `<li>${badge(r.lvl === 'info' ? 'info' : r.lvl, r.lvl === 'info' ? 'Info' : LEVEL[r.lvl].label)} ${r.ecg ? `<a data-ecg="${r.ecg}">${esc(r.text)}</a>` : esc(r.text)}</li>`).join('')}</ul>` : ''}
      </div>

      ${p.device.ecg ? `
      <div class="card sec">
        <h2>EKGs (${p.ecgs.length}) <span class="small muted" style="font-weight:400">· 30-s-Einkanal-EKG der Uhr</span></h2>
        <div class="ecg-strip">${p.ecgs.map(x => ecgCard(p, x)).join('')}</div>
      </div>
      ${e ? viewerHtml(p, e) : ''}` : `
      <div class="card sec"><h2>EKGs</h2><div class="muted">Für dieses Gerät ist im Prototyp keine EKG-Kurve über die Hersteller-Schnittstelle verfügbar. Bei HF-Alarm wird der Patient gebeten, sich zu melden bzw. ein EKG mit einem Zweitgerät aufzuzeichnen.</div></div>`}

      <div class="card sec">
        <div class="chart-title">Maximale Ruhe-Herzfrequenz pro Tag, letzte 30 Tage</div>
        <div class="chart-sub">Schläge/min · gestrichelte Linie = Alarmschwelle 110/min (löst „Bitte EKG aufzeichnen“ aus)</div>
        <div id="hrWrap"><canvas id="hrChart"></canvas></div>
      </div>

      <div class="card sec">
        <h2>Kontakte & Audit-Trail</h2>
        ${logHtml(p)}
      </div>`;

    // Thumbnails
    document.querySelectorAll('.ecard canvas').forEach(cv => {
      const ecg = p.ecgs.find(x => x.id === cv.dataset.e);
      ECG.drawECG(cv, signal(ecg), { secondsPerRow: 30, thumb: true, width: 192 });
    });
    if (e) drawViewer(p, e);
    drawHrChart(p);
    bindDetail(p, e);
  }

  function clsBadge(a) {
    const map = { af: 'critical', tachy: 'warning', unclear: 'warning', ectopy: 'warning', sr: 'good' };
    return badge(map[a.cls], a.label);
  }
  function ecgCard(p, e) {
    const st = e.review ? `✓ befundet: ${FINDINGS[e.review.finding]}` : '<b>unbefundet</b>';
    return `<div class="ecard ${state.selEcg === e.id ? 'sel' : ''}" data-e="${e.id}">
      <div class="t"><span class="tnum">${fmtDT(e.t)}</span><span class="muted">Tag ${dayPostPvi(p, e.t)}</span></div>
      <div class="c">${esc(e.trigger)} · Uhr: ${esc(e.vendorClass)}<br>Algorithmus: ${esc(e.analysis.label)}<br>${st}</div>
      <canvas data-e="${e.id}"></canvas>
    </div>`;
  }

  function viewerHtml(p, e) {
    const a = e.analysis;
    const r = e.review;
    const opts = Object.entries(FINDINGS).map(([k, l]) => `<label><input type="radio" name="finding" value="${k}" ${r && r.finding === k ? 'checked' : ''}> ${l}</label>`).join('');
    return `
      <div class="card sec">
        <div class="viewer-head">
          <h2 style="margin:0">EKG vom ${fmtDT(e.t)}</h2>
          <span class="pill">${esc(e.trigger)}</span>
          ${e.symptoms.length ? `<span class="pill">Symptome: ${esc(e.symptoms.join(', '))}</span>` : ''}
          <span class="pill">Tag ${dayPostPvi(p, e.t)} nach PVI${dayPostPvi(p, e.t) <= BLANKING_DAYS ? ' · Blanking' : ''}</span>
          <div class="spacer"></div>
          <label class="small row"><input type="checkbox" id="tPeaks" ${state.showPeaks ? 'checked' : ''}> R-Zacken + RR (ms)</label>
          <select id="tGain" class="small"><option value="10" ${state.gain === 10 ? 'selected' : ''}>10 mm/mV</option><option value="20" ${state.gain === 20 ? 'selected' : ''}>20 mm/mV</option></select>
        </div>
        <div class="ecgwrap" id="ecgWrap"><canvas id="ecgCanvas"></canvas><div class="hline" id="hline"></div></div>
        <div class="small muted" style="margin-top:6px">25 mm/s · ${state.gain} mm/mV · Einkanal (entspricht etwa Ableitung I) · Quelle: ${esc(e.source)} · ${e.id}</div>

        <div class="grid2">
          <div>
            <table class="meas">
              <tr><td>Mittlere Herzfrequenz</td><td>${num(a.hr)} /min</td></tr>
              <tr><td>Erkannte Schläge</td><td>${a.peaks.length}</td></tr>
              <tr><td>RR-Variationskoeffizient</td><td>${num(a.cv * 100, 1)} %</td></tr>
              <tr><td>nRMSSD</td><td>${num(a.nrmssd, 2)}</td></tr>
              <tr><td>Anteil RR-Sprünge > 10 %</td><td>${num(a.jumpFrac * 100)} %</td></tr>
              <tr><td>Signalqualität</td><td>${a.quality}</td></tr>
              <tr><td>Klassifikation der Uhr (${esc(p.device.vendor)}, CE)</td><td>${esc(e.vendorClass)}</td></tr>
            </table>
            <div class="algo-box">${clsBadge(a)}
              <div class="small ink2" style="margin-top:6px">Studien-Algorithmus (Demo, nicht validiert) – sortiert nur, ersetzt keine Befundung.</div>
            </div>
          </div>
          <div>
            <div class="chart-title">Poincaré-Plot</div>
            <div class="chart-sub">RRₙ gegen RRₙ₊₁ (ms) · Punktwolke = unregelmäßig</div>
            <canvas id="poincare"></canvas>
          </div>
        </div>

        <div class="review">
          <h3>Ärztlicher Befund</h3>
          ${r ? `<div class="signed" style="margin-top:8px">${badge(RECURRENCE.has(r.finding) ? 'critical' : 'good', FINDINGS[r.finding])}
              ${r.ge30s ? '<span class="pill">Episode ≥ 30 s</span>' : ''}
              <span class="small ink2">signiert von ${esc(r.by)} · ${fmtDT(r.t)}</span>${r.note ? `<span class="small">„${esc(r.note)}“</span>` : ''}
              <div class="spacer"></div><button id="btnEdit">Befund ändern</button></div>` : ''}
          <div id="reviewForm" style="${r ? 'display:none' : ''}">
            <div class="opts">${opts}</div>
            <label class="small row"><input type="checkbox" id="ge30" ${r && r.ge30s ? 'checked' : ''}> Rhythmusstörung über ≥ 30 s dokumentiert (Rezidiv-Definition)</label>
            <div style="margin-top:8px"><textarea id="rNote" placeholder="Kommentar (optional)">${r && r.note ? esc(r.note) : ''}</textarea></div>
            <div class="row" style="margin-top:8px"><span class="small muted">Wird mit Name und Zeitstempel im Audit-Trail gespeichert.</span><div class="spacer"></div><button class="primary" id="btnSave">Befund speichern & signieren</button></div>
          </div>
        </div>
      </div>`;
  }

  function logHtml(p) {
    const contacts = Store.get(Store.K.contact, []).filter(c => c.patientId === p.id).map(c => ({ t: c.t, text: `☎ ${c.method}${c.note ? ': ' + c.note : ''} (${c.by})` }));
    const audit = Store.get(Store.K.audit, []).filter(a => a.detail.includes(p.id)).map(a => ({ t: a.t, text: `${a.action} – ${a.detail} (${a.user})` }));
    const reviews = p.ecgs.filter(e => e.initialReview && !Store.get(Store.K.rev, {})[e.id]).map(e => ({ t: e.initialReview.t, text: `Befund ${FINDINGS[e.initialReview.finding]} – ${e.id} (${e.initialReview.by})` }));
    const all = [...contacts, ...audit, ...reviews].sort((a, b) => new Date(b.t) - new Date(a.t)).slice(0, 14);
    return all.length ? `<ul class="log">${all.map(x => `<li><span class="muted tnum">${fmtDT(x.t)}</span><span>${esc(x.text)}</span></li>`).join('')}</ul>` : '<div class="muted small">Noch keine Einträge.</div>';
  }

  // ---------- Zeichnen ----------
  const tip = $('#tip');
  const showTip = (html, x, y) => { tip.innerHTML = html; tip.style.display = 'block'; const w = tip.offsetWidth; tip.style.left = Math.min(x + 14, innerWidth - w - 8) + 'px'; tip.style.top = (y + 14) + 'px'; };
  const hideTip = () => { tip.style.display = 'none'; };

  function drawViewer(p, e) {
    const wrap = $('#ecgWrap'), cv = $('#ecgCanvas'), hl = $('#hline');
    const sig = signal(e), a = e.analysis;
    const geo = ECG.drawECG(cv, sig, { secondsPerRow: 10, gain: state.gain, peaks: a.peaks, showPeaks: state.showPeaks, width: wrap.clientWidth - 2 });
    wrap.onmousemove = ev => {
      const r = cv.getBoundingClientRect();
      const x = ev.clientX - r.left, y = ev.clientY - r.top;
      const row = Math.min(geo.rows - 1, Math.max(0, Math.floor(y / geo.rowH)));
      const t = row * geo.spr + x / geo.pxPerSec;
      const idx = Math.round(t * sig.fs);
      let k = a.peaks.findIndex(pk => pk > idx);
      if (k < 0) k = a.peaks.length;
      const rr = k > 0 && k < a.peaks.length ? (a.peaks[k] - a.peaks[k - 1]) / sig.fs : null;
      hl.style.display = 'block'; hl.style.left = x + 'px'; hl.style.top = row * geo.rowH + 'px'; hl.style.height = geo.rowH + 'px';
      showTip(`<b>${num(t, 2)} s</b>${rr ? `<br>RR ${Math.round(rr * 1000)} ms · ${Math.round(60 / rr)}/min` : ''}`, ev.clientX, ev.clientY);
    };
    wrap.onmouseleave = () => { hl.style.display = 'none'; hideTip(); };
    drawPoincare(a);
  }

  function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }

  function drawPoincare(a) {
    const cv = $('#poincare'); if (!cv) return;
    const S = 280, pad = 38;
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
      ctx.save(); ctx.textAlign = 'right'; ctx.fillText(Math.round(v * 1000), pad - 4, sy(v) + 4); ctx.restore();
    }
    ctx.fillText('RRₙ (ms)', (S + pad) / 2, S - 6);
    ctx.save(); ctx.translate(11, (S - pad) / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('RRₙ₊₁ (ms)', 0, 0); ctx.restore();
    ctx.strokeStyle = css('--axis'); ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(sx(lo), sy(lo)); ctx.lineTo(sx(hi), sy(hi)); ctx.stroke(); ctx.setLineDash([]);
    pts.forEach(([u, v]) => {
      ctx.beginPath(); ctx.arc(sx(u), sy(v), 4, 0, Math.PI * 2);
      ctx.fillStyle = css('--accent'); ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = css('--surface'); ctx.stroke();
    });
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
    const W = wrap.clientWidth, H = 200, pl = 40, pr = 16, pt = 12, pb = 26;
    const ctx = ECG.setupCanvas(cv, W, H);
    const data = p.hrDaily;
    const start = Date.now() - 29.5 * DAY, end = Date.now() + 0.5 * DAY;
    const ymin = 40, ymax = Math.max(160, ...data.map(d => d.maxRest + 10));
    const sx = t => pl + (t - start) / (end - start) * (W - pl - pr);
    const sy = v => pt + (1 - (v - ymin) / (ymax - ymin)) * (H - pt - pb);
    ctx.fillStyle = css('--surface'); ctx.fillRect(0, 0, W, H);
    ctx.font = '11px system-ui'; ctx.fillStyle = css('--muted'); ctx.strokeStyle = css('--grid'); ctx.lineWidth = 1;
    for (let v = 40; v <= ymax; v += 20) {
      ctx.beginPath(); ctx.moveTo(pl, Math.round(sy(v)) + .5); ctx.lineTo(W - pr, Math.round(sy(v)) + .5); ctx.stroke();
      ctx.textAlign = 'right'; ctx.fillText(v, pl - 6, sy(v) + 4);
    }
    ctx.textAlign = 'center';
    for (let d = 28; d >= 0; d -= 7) {
      const t = new Date(Date.now() - d * DAY); t.setHours(0, 0, 0, 0);
      ctx.fillText(d === 0 ? 'heute' : t.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }), sx(+t), H - 8);
    }
    // Ende Blanking
    const be = new Date(p.pviDate).getTime() + BLANKING_DAYS * DAY;
    if (be > start && be < end) {
      ctx.strokeStyle = css('--axis'); ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(sx(be), pt); ctx.lineTo(sx(be), H - pb); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = css('--ink-2'); ctx.textAlign = 'left'; ctx.fillText('Ende Blanking', sx(be) + 4, pt + 10);
    }
    // Schwelle
    ctx.strokeStyle = css('--critical'); ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(pl, sy(110)); ctx.lineTo(W - pr, sy(110)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = css('--ink-2'); ctx.textAlign = 'right'; ctx.fillText('Alarmschwelle 110/min', W - pr, sy(110) - 5);
    if (!data.length) { ctx.textAlign = 'center'; ctx.fillText('Keine Daten', W / 2, H / 2); return; }
    // Linie
    const pts = data.map(d => [sx(new Date(d.date).getTime() + DAY / 2), sy(d.maxRest), d]);
    ctx.strokeStyle = css('--accent'); ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.beginPath();
    pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
    pts.filter(q => q[2].maxRest >= 110).forEach(([x, y]) => {
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fillStyle = css('--critical'); ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = css('--surface'); ctx.stroke();
    });
    const last = pts[pts.length - 1];
    ctx.fillStyle = css('--ink'); ctx.textAlign = 'right'; ctx.font = '600 11px system-ui';
    ctx.fillText(`${last[2].maxRest}/min`, last[0] - 8, last[1] - 8);

    cv.onmousemove = ev => {
      const r = cv.getBoundingClientRect(); const x = ev.clientX - r.left;
      let best = pts[0]; pts.forEach(q => { if (Math.abs(q[0] - x) < Math.abs(best[0] - x)) best = q; });
      const d = best[2];
      showTip(`<b>${fmtD(d.date)}</b><br>max. Ruhe-HF ${d.maxRest}/min${d.maxRest >= 110 ? ' · über Schwelle' : ''}<br><span class="muted">Ruhe-HF Median ${d.rest}/min</span>`, ev.clientX, ev.clientY);
    };
    cv.onmouseleave = hideTip;
  }

  // ---------- Interaktion ----------
  function bindDetail(p, e) {
    document.querySelectorAll('.ecard').forEach(el => el.onclick = () => { state.selEcg = el.dataset.e; renderDetail(); });
    document.querySelectorAll('.reasons a[data-ecg]').forEach(el => el.onclick = () => { state.selEcg = el.dataset.ecg; renderDetail(); });
    const tp = $('#tPeaks'); if (tp) tp.onchange = () => { state.showPeaks = tp.checked; drawViewer(p, e); };
    const tg = $('#tGain'); if (tg) tg.onchange = () => { state.gain = +tg.value; renderDetail(); };
    const be = $('#btnEdit'); if (be) be.onclick = () => { $('#reviewForm').style.display = ''; be.style.display = 'none'; };
    const bs = $('#btnSave');
    if (bs) bs.onclick = () => {
      const f = document.querySelector('input[name=finding]:checked');
      if (!f) { toast('Bitte einen Befund auswählen'); return; }
      const reviews = Store.get(Store.K.rev, {});
      reviews[e.id] = { finding: f.value, ge30s: $('#ge30').checked, note: $('#rNote').value.trim(), by: 'Dr. Prüfarzt (Demo)', t: new Date().toISOString() };
      Store.set(Store.K.rev, reviews);
      Store.audit('Befund signiert', `${p.id} · ${e.id}: ${FINDINGS[f.value]}${reviews[e.id].ge30s ? ' (≥ 30 s)' : ''}`);
      toast(`Befund für ${e.id} gespeichert`);
      refresh();
    };
    $('#btnContact').onclick = () => { $('#modalPid').textContent = p.id + ' · ' + p.device.model; $('#cNote').value = ''; $('#modalBg').style.display = 'grid'; };
    $('#btnReq').onclick = () => {
      Store.push(Store.K.req, { id: 'REQ-' + Date.now(), patientId: p.id, t: new Date().toISOString() });
      Store.audit('EKG angefordert', `${p.id}: Push-Nachricht „Bitte EKG aufzeichnen“ gesendet`);
      toast(`Push-Nachricht an ${p.id} gesendet${p.demo ? ' – siehe Patienten-App' : ''}`);
      refresh();
    };
  }

  $('#cCancel').onclick = () => { $('#modalBg').style.display = 'none'; };
  $('#cSave').onclick = () => {
    const p = state.cohort.find(x => x.id === state.sel);
    Store.push(Store.K.contact, { patientId: p.id, t: new Date().toISOString(), method: $('#cMethod').value, note: $('#cNote').value.trim(), by: 'Dr. Prüfarzt (Demo)' });
    Store.audit('Kontakt dokumentiert', `${p.id}: ${$('#cMethod').value}`);
    $('#modalBg').style.display = 'none';
    toast('Kontakt dokumentiert');
    refresh();
  };

  $('#chips').onclick = ev => { const b = ev.target.closest('[data-f]'); if (b) { state.filter = b.dataset.f; renderList(); } };
  $('#search').oninput = ev => { state.q = ev.target.value; renderList(); };
  $('#plist').onclick = ev => { const r = ev.target.closest('[data-p]'); if (r) { state.sel = r.dataset.p; state.selEcg = null; renderList(); renderDetail(); } };

  $('#btnExport').onclick = () => {
    const head = ['Studien-ID', 'Geraet', 'Schnittstelle', 'EKG-ID', 'Zeitpunkt', 'Tag_nach_PVI', 'Blanking', 'Ausloeser', 'Symptome', 'Klassifikation_Uhr', 'Algorithmus', 'HF_mittel', 'RR_CV', 'nRMSSD', 'Signalqualitaet', 'Befund_aerztlich', 'Episode_ge30s', 'Befundet_von', 'Befundet_am'];
    const rows = [head];
    state.cohort.forEach(p => p.ecgs.forEach(e => {
      const a = e.analysis, r = e.review, d = dayPostPvi(p, e.t);
      rows.push([p.id, p.device.model, p.device.path, e.id, e.t, d, d <= BLANKING_DAYS ? 'ja' : 'nein', e.trigger, e.symptoms.join('|'), e.vendorClass, a.label,
        Math.round(a.hr), a.cv.toFixed(3), a.nrmssd.toFixed(3), a.quality, r ? FINDINGS[r.finding] : '', r ? (r.ge30s ? 'ja' : 'nein') : '', r ? r.by : '', r ? r.t : '']);
    }));
    const csv = '﻿' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `pvi-watch-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    Store.audit('Studienexport', `CSV mit ${rows.length - 1} EKGs (alle Patienten)`);
  };

  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3200); }

  function refresh() {
    load(); renderKpis(); renderList(); renderDetail();
  }

  // Live-Update, wenn die Patienten-App (anderer Tab/iframe) Daten schreibt
  let lastDemoCount = Store.get(Store.K.ecg, []).length;
  window.addEventListener('storage', ev => {
    if (ev.key !== 'pviw.version') return;
    const n = Store.get(Store.K.ecg, []).length;
    if (n > lastDemoCount) { toast('📥 Neues EKG eingegangen: VHF-001'); }
    lastDemoCount = n;
    refresh();
  });
  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(renderDetail, 150); });

  load();
  const first = [...state.cohort].sort((a, b) => LEVEL[b.level].ord - LEVEL[a.level].ord || b.lastActivity - a.lastActivity)[0];
  state.sel = new URLSearchParams(location.search).get('p') || first.id;
  renderKpis(); renderList(); renderDetail();
})();
