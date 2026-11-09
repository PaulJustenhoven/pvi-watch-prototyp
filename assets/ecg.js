/*
 * PVI-Watch Prototyp – EKG-Synthese, Analyse und Darstellung
 *
 * WICHTIG: Synthetische Signale und ein einfacher, NICHT validierter
 * Demonstrations-Algorithmus (RR-Irregularität). Kein Medizinprodukt.
 */
(function (global) {
  'use strict';

  const FS = 250; // Hz (Apple Watch liefert 512 Hz, für die Demo genügen 250 Hz)

  // ---------- Zufall (deterministisch) ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(rng) {
    let u = 0; while (!u) u = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
  }

  // ---------- Synthese ----------
  // rhythm: 'sinus' | 'af' | 'tachy' | 'flutter' | 'sves' | 'artifact'
  function beatTimes(rhythm, hr, seconds, rng) {
    const out = [];
    const rr0 = 60 / hr;
    let t = 0.25 + rng() * 0.5, i = 0;
    while (t < seconds - 0.15) {
      out.push(t);
      let rr;
      switch (rhythm) {
        case 'af':
          rr = rr0 * (1 + 0.26 * gauss(rng));
          rr = Math.min(Math.max(rr, 0.33), 1.7);
          break;
        case 'flutter':
          // Vorhof 300/min, überwiegend 2:1-Überleitung, gelegentlich 3:1
          rr = (rng() < 0.88 ? 2 : 3) * 0.2 + 0.004 * gauss(rng);
          break;
        case 'sves':
          if (i % 7 === 5) rr = rr0 * 0.62;
          else if (i % 7 === 6) rr = rr0 * 1.32;
          else rr = rr0 * (1 + 0.03 * Math.sin(2 * Math.PI * t / 4.2) + 0.01 * gauss(rng));
          break;
        case 'tachy':
          rr = rr0 * (1 + 0.012 * Math.sin(2 * Math.PI * t / 4) + 0.006 * gauss(rng));
          break;
        default:
          rr = rr0 * (1 + 0.035 * Math.sin(2 * Math.PI * t / 4.2) + 0.012 * gauss(rng));
      }
      t += rr; i++;
    }
    return out;
  }

  function synth({ rhythm = 'sinus', hr = 70, seconds = 30, seed = 1 } = {}) {
    const rng = mulberry32(seed * 7919 + 13);
    const n = Math.round(seconds * FS);
    const x = new Float32Array(n);
    const beats = beatTimes(rhythm, hr, seconds, rng);
    const amp = 0.75 + 0.35 * rng();
    const hasP = !(rhythm === 'af' || rhythm === 'flutter');

    const add = (c, a, w) => {
      const i0 = Math.max(0, Math.floor((c - 4 * w) * FS));
      const i1 = Math.min(n - 1, Math.ceil((c + 4 * w) * FS));
      for (let i = i0; i <= i1; i++) { const d = (i / FS - c) / w; x[i] += a * Math.exp(-0.5 * d * d); }
    };

    beats.forEach((tb, k) => {
      const rr = k > 0 ? tb - beats[k - 1] : 60 / hr;
      const premature = rhythm === 'sves' && rr < 0.75 * (60 / hr);
      if (hasP) add(tb - (premature ? 0.13 : 0.16), (premature ? 0.07 : 0.11) * amp, 0.022);
      add(tb - 0.028, -0.08 * amp, 0.008);
      add(tb, amp, 0.011);
      add(tb + 0.03, -0.22 * amp, 0.01);
      const tOff = Math.min(0.32, 0.15 + 0.15 * Math.min(rr, 1.2));
      add(tb + tOff, 0.24 * amp, 0.045);
    });

    let phase = 0;
    const ph0 = rng() * 6;
    for (let i = 0; i < n; i++) {
      const t = i / FS;
      let v = 0.06 * Math.sin(2 * Math.PI * 0.22 * t + ph0) + 0.03 * Math.sin(2 * Math.PI * 0.05 * t);
      if (rhythm === 'af') {
        const f = 5.8 + 0.7 * Math.sin(2 * Math.PI * 0.13 * t);
        phase += 2 * Math.PI * f / FS;
        v += (0.035 + 0.015 * Math.sin(2 * Math.PI * 0.3 * t)) * Math.sin(phase) + 0.018 * Math.sin(2 * Math.PI * 7.4 * t + 1);
      }
      if (rhythm === 'flutter') {
        const fr = (t / 0.2) % 1;
        v += 0.13 * (fr < 0.75 ? 0.5 - fr / 0.75 : -0.5 + (fr - 0.75) / 0.25);
      }
      v += 0.012 * gauss(rng);
      if (rhythm === 'artifact' && ((t > 4 && t < 10) || (t > 16 && t < 24))) {
        v += 0.28 * gauss(rng) + 0.5 * Math.sin(2 * Math.PI * 1.3 * t);
      }
      x[i] += v;
    }
    return { fs: FS, x, beats, seconds };
  }

  // ---------- Analyse ----------
  function movingAvg(a, w) {
    const n = a.length, out = new Float32Array(n);
    let s = 0; const half = Math.floor(w / 2);
    const pre = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) { s += a[i]; pre[i + 1] = s; }
    for (let i = 0; i < n; i++) {
      const lo = Math.max(0, i - half), hi = Math.min(n, i + half + 1);
      out[i] = (pre[hi] - pre[lo]) / (hi - lo);
    }
    return out;
  }

  function detectR(x, fs) {
    const n = x.length;
    const base = movingAvg(x, Math.round(0.25 * fs));
    const hp = new Float32Array(n);
    for (let i = 0; i < n; i++) hp[i] = x[i] - base[i];
    const d2 = new Float32Array(n);
    for (let i = 2; i < n - 2; i++) {
      const v = 2 * hp[i + 2] + hp[i + 1] - hp[i - 1] - 2 * hp[i - 2];
      d2[i] = v * v;
    }
    const mi = movingAvg(d2, Math.round(0.12 * fs));
    const block = 2 * fs, maxima = [];
    for (let b = 0; b < n; b += block) {
      let m = 0; for (let i = b; i < Math.min(n, b + block); i++) if (mi[i] > m) m = mi[i];
      maxima.push(m);
    }
    maxima.sort((a, b) => a - b);
    const thr = 0.3 * maxima[Math.floor(maxima.length / 2)];
    const refr = Math.round(0.25 * fs);
    const peaks = [];
    let i = 0;
    while (i < n) {
      if (mi[i] > thr) {
        let j = i; while (j < n && mi[j] > thr) j++;
        const s = Math.max(0, i - Math.round(0.1 * fs)), e = Math.min(n - 1, j);
        let best = s; for (let k = s; k <= e; k++) if (hp[k] > hp[best]) best = k;
        if (!peaks.length || best - peaks[peaks.length - 1] > refr) peaks.push(best);
        i = j + 1;
      } else i++;
    }
    return { peaks, hp };
  }

  const mean = a => a.reduce((s, v) => s + v, 0) / (a.length || 1);
  const median = a => { const b = [...a].sort((p, q) => p - q); return b.length ? b[Math.floor(b.length / 2)] : 0; };
  const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2))); };

  function analyze(sig) {
    const { x, fs } = sig;
    const { peaks, hp } = detectR(x, fs);
    const rr = [];
    for (let k = 1; k < peaks.length; k++) rr.push((peaks[k] - peaks[k - 1]) / fs);

    // Signalqualität: hochfrequente Energie außerhalb der QRS-Komplexe relativ zur R-Amplitude
    const mask = new Uint8Array(x.length);
    const win = Math.round(0.07 * fs);
    peaks.forEach(p => { for (let k = Math.max(0, p - win); k < Math.min(x.length, p + win); k++) mask[k] = 1; });
    let se = 0, cnt = 0;
    for (let k = 1; k < x.length; k++) if (!mask[k]) { const d = hp[k] - hp[k - 1]; se += d * d; cnt++; }
    const hfRms = Math.sqrt(se / (cnt || 1));
    const rAmp = median(peaks.map(p => hp[p])) || 1e-6;
    const noiseRatio = hfRms / rAmp;
    const implausible = rr.filter(v => v < 0.27 || v > 2.2).length / (rr.length || 1);
    const quality = (peaks.length < 8 || noiseRatio > 0.08 || implausible > 0.1) ? 'schlecht' : (noiseRatio > 0.04 ? 'mäßig' : 'gut');

    const mRR = mean(rr);
    const hr = mRR ? 60 / mRR : 0;
    const cv = mRR ? sd(rr) / mRR : 0;
    const dif = rr.slice(1).map((v, k) => v - rr[k]);
    const rmssd = Math.sqrt(mean(dif.map(d => d * d)));
    const nrmssd = mRR ? rmssd / mRR : 0;
    const jumpFrac = dif.filter(d => Math.abs(d) > 0.1 * mRR).length / (dif.length || 1);
    // Extrasystolen: Intervalle, die > 20 % vom lokalen Median abweichen
    const ect = rr.filter((v, k) => {
      const loc = median(rr.slice(Math.max(0, k - 3), k + 4));
      return Math.abs(v - loc) / loc > 0.2;
    }).length / (rr.length || 1);

    let cls, label;
    if (quality === 'schlecht') { cls = 'unclear'; label = 'Nicht beurteilbar (Signalqualität)'; }
    else if (jumpFrac > 0.5 && nrmssd > 0.1) { cls = 'af'; label = 'Unregelmäßig – VHF-Verdacht'; }
    else if (hr > 100) { cls = 'tachy'; label = 'Regelmäßige Tachykardie'; }
    else if (ect > 0.05) { cls = 'ectopy'; label = 'Regelmäßig mit Extraschlägen'; }
    else { cls = 'sr'; label = 'Regelmäßiger Rhythmus'; }

    return { peaks, rr, hr, cv, rmssd, nrmssd, jumpFrac, ect, noiseRatio, quality, cls, label };
  }

  // ---------- Darstellung ----------
  function setupCanvas(canvas, cssW, cssH) {
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  /**
   * Zeichnet einen EKG-Streifen auf EKG-Papier (nominell 25 mm/s).
   * opts: { secondsPerRow, gain (mm/mV), peaks, showPeaks, thumb, width, height, startSec, seconds }
   * Rückgabe: Geometrie für Hover/Messung.
   */
  function drawECG(canvas, sig, opts = {}) {
    const css = getComputedStyle(document.documentElement);
    const v = (n, d) => css.getPropertyValue(n).trim() || d;
    const spr = opts.secondsPerRow || 10;
    const gain = opts.gain || 10;
    const W = opts.width || canvas.parentElement.clientWidth || 800;
    const thumb = !!opts.thumb;
    const calW = thumb ? 0 : 22;                 // Platz für Eichzacke
    const pxPerSec = (W - calW) / spr;
    const mm = pxPerSec / 25;
    const startSec = opts.startSec || 0;
    const totalSec = opts.seconds || sig.seconds;
    const rows = Math.ceil(totalSec / spr);
    const rowMm = gain >= 20 ? 34 : gain <= 5 ? 16 : 22;
    const rowH = thumb ? (opts.height || 36) : Math.max(70, rowMm * mm);
    const H = thumb ? rowH : rows * rowH;
    const ctx = setupCanvas(canvas, W, H);
    ctx.fillStyle = v('--ecg-paper', '#fff7f6');
    ctx.fillRect(0, 0, W, H);

    if (!thumb) {
      if (mm >= 2.2) {
        ctx.strokeStyle = v('--ecg-minor', '#f6d9d6'); ctx.lineWidth = 0.5; ctx.beginPath();
        for (let xg = calW; xg <= W; xg += mm) { ctx.moveTo(Math.round(xg) + .5, 0); ctx.lineTo(Math.round(xg) + .5, H); }
        for (let yg = 0; yg <= H; yg += mm) { ctx.moveTo(calW, Math.round(yg) + .5); ctx.lineTo(W, Math.round(yg) + .5); }
        ctx.stroke();
      }
      ctx.strokeStyle = v('--ecg-major', '#eaa9a3'); ctx.lineWidth = 0.8; ctx.beginPath();
      for (let xg = calW; xg <= W + 1; xg += 5 * mm) { ctx.moveTo(Math.round(xg) + .5, 0); ctx.lineTo(Math.round(xg) + .5, H); }
      for (let yg = 0; yg <= H + 1; yg += 5 * mm) { ctx.moveTo(calW, Math.round(yg) + .5); ctx.lineTo(W, Math.round(yg) + .5); }
      ctx.stroke();
    }

    const { x, fs } = sig;
    const perRow = spr * fs;
    const trace = v('--ecg-trace', '#141414');
    const yScale = thumb ? rowH * 0.5 : gain * mm;
    for (let r = 0; r < rows; r++) {
      const base = r * rowH + rowH * (thumb ? 0.62 : 0.62);
      const i0 = Math.round(startSec * fs) + r * perRow;
      const i1 = Math.min(x.length, i0 + perRow, Math.round((startSec + totalSec) * fs));
      ctx.save(); ctx.beginPath(); ctx.rect(0, r * rowH, W, rowH); ctx.clip();
      if (!thumb) {
        // Eichzacke 1 mV × 0,2 s
        ctx.strokeStyle = trace; ctx.lineWidth = 1.2; ctx.beginPath();
        const ch = 10 * mm * (gain / 10);
        ctx.moveTo(2, base); ctx.lineTo(6, base); ctx.lineTo(6, base - ch); ctx.lineTo(16, base - ch); ctx.lineTo(16, base); ctx.lineTo(calW, base);
        ctx.stroke();
      }
      ctx.strokeStyle = trace; ctx.lineWidth = thumb ? 1 : 1.3; ctx.lineJoin = 'round'; ctx.beginPath();
      for (let i = i0; i < i1; i++) {
        const px = calW + (i - i0) / fs * pxPerSec;
        const py = base - x[i] * yScale;
        if (i === i0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.restore();

      if (!thumb) {
        ctx.fillStyle = v('--ecg-label', '#52514e'); ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'left';
        ctx.fillText(`${Math.round(startSec + r * spr)} s`, calW + 3, r * rowH + rowH - 4);
      }
      if (opts.showPeaks && opts.peaks && !thumb) {
        const mark = v('--ecg-mark', '#2a78d6');
        const rowPeaks = opts.peaks.filter(p => p >= i0 && p < i1);
        ctx.fillStyle = mark;
        rowPeaks.forEach(p => {
          const px = calW + (p - i0) / fs * pxPerSec, ty = r * rowH + 3;
          ctx.beginPath(); ctx.moveTo(px - 4, ty); ctx.lineTo(px + 4, ty); ctx.lineTo(px, ty + 6); ctx.closePath(); ctx.fill();
        });
        ctx.fillStyle = v('--ecg-label', '#52514e'); ctx.textAlign = 'center';
        for (let k = 1; k < opts.peaks.length; k++) {
          const a = opts.peaks[k - 1], b = opts.peaks[k];
          if (b < i0 || b >= i1 || a < i0) continue;
          const gap = (b - a) / fs * pxPerSec;
          if (gap < 30) continue; // RR-Wert nur bei genug Platz (sonst per Hover)
          ctx.fillText(Math.round((b - a) / fs * 1000), calW + ((a + b) / 2 - i0) / fs * pxPerSec, r * rowH + 13);
        }
      }
      if (r > 0 && !thumb) {
        ctx.strokeStyle = v('--ecg-row', 'rgba(0,0,0,.25)'); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, r * rowH + .5); ctx.lineTo(W, r * rowH + .5); ctx.stroke();
      }
    }
    return { W, H, rows, rowH, spr, pxPerSec, fs, calW, mm, gain, startSec, base: f => f * rowH + rowH * 0.62 };
  }

  global.ECG = { FS, synth, analyze, drawECG, setupCanvas, mulberry32, gauss, median, mean };
})(window);
