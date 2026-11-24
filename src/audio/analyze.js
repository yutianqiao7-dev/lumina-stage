// 読み込んだ曲の解析: テンポ・拍・小節・曲の構成(セクション)・盛り上がり
// 記事の「Dance Composer」に相当する部分

function fftReal(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

export async function analyzeAudio(buffer, onProgress = () => {}) {
  // 1. モノラル化 + 22kHz程度へ間引き
  const srcSR = buffer.sampleRate;
  const step = srcSR > 30000 ? 2 : 1;
  const sr = srcSR / step;
  const len = Math.floor(buffer.length / step);
  const mono = new Float32Array(len);
  const chs = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) chs.push(buffer.getChannelData(c));
  for (let i = 0; i < len; i++) {
    let s = 0;
    for (const ch of chs) s += ch[i * step];
    mono[i] = s / chs.length;
  }

  // 2. STFT
  const N = 1024, hop = 512;
  const frames = Math.max(1, Math.floor((len - N) / hop));
  const fps = sr / hop;
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const NB = 24;
  const bandEdges = [];
  for (let b = 0; b <= NB; b++) bandEdges.push(Math.round(2 + (N / 2 - 2) * Math.pow(b / NB, 2.2)));
  const bands = new Float32Array(frames * NB);
  const onset = new Float32Array(frames);
  const lowOnset = new Float32Array(frames);
  const midOnset = new Float32Array(frames);
  const rms = new Float32Array(frames);
  const re = new Float32Array(N), im = new Float32Array(N);
  let prevMag = new Float32Array(N / 2), mag = new Float32Array(N / 2);

  for (let f = 0; f < frames; f++) {
    const off = f * hop;
    let e = 0;
    for (let i = 0; i < N; i++) { const s = mono[off + i]; re[i] = s * win[i]; im[i] = 0; e += s * s; }
    rms[f] = Math.sqrt(e / N);
    fftReal(re, im);
    let flux = 0, lowFlux = 0, midFlux = 0;
    for (let k = 0; k < N / 2; k++) {
      const m = Math.log1p(100 * Math.hypot(re[k], im[k]));
      mag[k] = m;
      const d = m - prevMag[k];
      if (d > 0) { flux += d; if (k >= 1 && k <= 6) lowFlux += d; else if (k >= 35 && k <= 150) midFlux += d; }
    }
    onset[f] = flux; lowOnset[f] = lowFlux; midOnset[f] = midFlux;
    for (let b = 0; b < NB; b++) {
      let s = 0;
      for (let k = bandEdges[b]; k < bandEdges[b + 1]; k++) s += mag[k];
      bands[f * NB + b] = s / Math.max(1, bandEdges[b + 1] - bandEdges[b]);
    }
    [prevMag, mag] = [mag, prevMag];
    if (f % 2000 === 0) { onProgress(0.1 + 0.5 * (f / frames)); await tick(); }
  }

  // キック(低音)のアタックを重く見る: 裏拍のハイハットやベースに引っぱられないように
  let mxO = 0, mxL = 0, mxM = 0;
  for (let f = 0; f < frames; f++) { mxO = Math.max(mxO, onset[f]); mxL = Math.max(mxL, lowOnset[f]); mxM = Math.max(mxM, midOnset[f]); }
  const rawOnset = onset.slice();
  for (let f = 0; f < frames; f++) { lowOnset[f] /= mxL || 1; midOnset[f] /= mxM || 1; onset[f] = rawOnset[f] / (mxO || 1) + 1.2 * lowOnset[f] + 0.8 * midOnset[f]; }
  // オンセットを正規化(移動平均を引く)
  const onsetN = new Float32Array(frames);
  const W = Math.round(fps * 0.5);
  let acc = 0;
  for (let f = 0; f < frames; f++) {
    acc += onset[f]; if (f >= W) acc -= onset[f - W];
    const mean = acc / Math.min(f + 1, W);
    onsetN[f] = Math.max(0, onset[f] - mean);
  }
  let mx = 0; for (const v of onsetN) mx = Math.max(mx, v);
  for (let f = 0; f < frames; f++) onsetN[f] /= mx || 1;
  onProgress(0.65); await tick();

  // 3. テンポ推定(自己相関 + 120BPM付近を好む重み)
  const minLag = Math.round((fps * 60) / 190), maxLag = Math.round((fps * 60) / 60);
  let bestLag = minLag, bestScore = -1;
  const scores = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let f = lag; f < frames; f++) s += onsetN[f] * onsetN[f - lag];
    // 倍・半分のテンポも足して安定させる
    const bpm = (60 * fps) / lag;
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    scores.push([lag, s * prior]);
    if (s * prior > bestScore) { bestScore = s * prior; bestLag = lag; }
  }
  // 放物線補間で小数ラグ
  const idx = bestLag - minLag;
  let lagF = bestLag;
  if (idx > 0 && idx < scores.length - 1) {
    const a = scores[idx - 1][1], b = scores[idx][1], c = scores[idx + 1][1];
    const den = a - 2 * b + c;
    if (Math.abs(den) > 1e-9) lagF = bestLag + 0.5 * (a - c) / den;
  }
  let bpm = (60 * fps) / lagF;
  // 遅すぎ/速すぎを補正
  while (bpm < 75) bpm *= 2;
  while (bpm > 165) bpm /= 2;
  const period = (60 / bpm) * fps; // フレーム単位
  onProgress(0.72); await tick();

  // 4. 拍トラッキング(動的計画法)
  const score = new Float32Array(frames);
  const back = new Int32Array(frames).fill(-1);
  const tight = 6;
  for (let f = 0; f < frames; f++) {
    let best = 0, bi = -1;
    const lo = Math.max(0, Math.round(f - 2 * period)), hi = Math.round(f - period / 2);
    for (let p = lo; p <= hi; p++) {
      const x = Math.log((f - p) / period);
      const v = score[p] - tight * x * x;
      if (v > best || bi < 0) { best = v; bi = p; }
    }
    score[f] = onsetN[f] + (bi >= 0 ? best : 0);
    back[f] = bi;
  }
  // 最後の拍から逆にたどる
  let end = frames - 1, bestEnd = -1e9;
  for (let f = Math.max(0, frames - Math.round(period * 2)); f < frames; f++) if (score[f] > bestEnd) { bestEnd = score[f]; end = f; }
  const beatFrames = [];
  for (let f = end; f >= 0; f = back[f]) { beatFrames.push(f); if (back[f] < 0) break; }
  beatFrames.reverse();
  let beats = beatFrames.map((f) => (f * hop + N / 2) / sr);
  // 最初の拍より前・最後の拍より後も一定間隔で補う
  const spb = 60 / bpm;
  while (beats.length && beats[0] - spb > 0) beats.unshift(beats[0] - spb);
  const total = buffer.duration;
  while (beats.length && beats[beats.length - 1] + spb < total + spb * 8) beats.push(beats[beats.length - 1] + spb);
  if (beats.length < 8) { beats = []; for (let t = 0; t < total + 4; t += spb) beats.push(t); }
  // 半拍ずれの確認: 拍の上と拍の間で、キックのアタックが強いほうを拍にする
  {
    // キック(低音)とスネア・手拍子(中音)は拍の上、ハイハットは裏に来ることが多い
    const kickAt = (t) => { const f = Math.round((t * sr - N / 2) / hop); let v = 0; for (let k = -1; k <= 1; k++) { const ff = f + k; if (ff >= 0 && ff < frames) v = Math.max(v, lowOnset[ff] + 1.3 * midOnset[ff]); } return v; };
    let on = 0, off = 0;
    for (let i = 0; i + 1 < beats.length; i++) { on += kickAt(beats[i]); off += kickAt((beats[i] + beats[i + 1]) / 2); }
    if (off > on * 1.15) {
      const shifted = [];
      for (let i = 0; i + 1 < beats.length; i++) shifted.push((beats[i] + beats[i + 1]) / 2);
      shifted.unshift(shifted[0] - spb);
      beats = shifted.filter((t) => t > -spb);
    }
  }
  onProgress(0.8); await tick();

  // 5. 小節の頭(ダウンビート)の位相: 低音のアタックが強い拍を1拍目に
  // 小節の頭: 和音が変わる拍(低〜中音の響きの変化)+ 2・4拍目の手拍子/スネア
  const frameOf = (t) => Math.max(0, Math.min(frames - 1, Math.round((t * sr - N / 2) / hop)));
  const beatChroma = beats.map((t, i) => {
    const t1 = beats[i + 1] ?? t + spb;
    const f0 = frameOf(t), f1 = Math.max(f0 + 1, frameOf(t1));
    const v = new Float32Array(12);
    for (let f = f0; f < f1; f++) for (let b = 2; b < 14; b++) v[b - 2] += bands[f * NB + b];
    let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
    return v.map((x) => x / n);
  });
  const harmChange = beats.map((_, i) => {
    if (i === 0) return 0;
    let d = 0; for (let k = 0; k < 12; k++) d += Math.abs(beatChroma[i][k] - beatChroma[i - 1][k]);
    return d;
  });
  const midAt = (t) => { const f = frameOf(t); let v = 0; for (let k = -1; k <= 1; k++) { const ff = f + k; if (ff >= 0 && ff < frames) v = Math.max(v, midOnset[ff]); } return v; };
  const backbeat = beats.map((t) => midAt(t));
  let hcMean = 0; for (const x of harmChange) hcMean += x; hcMean /= harmChange.length || 1;
  let bbMean = 0; for (const x of backbeat) bbMean += x; bbMean /= backbeat.length || 1;
  let bestPhase = 0, bestPh = -1e9;
  for (let ph = 0; ph < 4; ph++) {
    let s = 0;
    for (let i = ph; i + 3 < beats.length; i += 4) {
      s += harmChange[i] / (hcMean || 1);
      s += 0.35 * ((backbeat[i + 1] + backbeat[i + 3]) - (backbeat[i] + backbeat[i + 2])) / (bbMean || 1);
    }
    if (s > bestPh) { bestPh = s; bestPhase = ph; }
  }
  // 小節ごとの特徴量
  const bars = [];
  for (let i = bestPhase; i + 4 < beats.length; i += 4) {
    const t0 = beats[i], t1 = beats[i + 4];
    if (t0 > total) break;
    const f0 = Math.max(0, Math.floor(t0 * fps)), f1 = Math.min(frames, Math.ceil(t1 * fps));
    const feat = new Float32Array(NB);
    let en = 0, on = 0, c = 0;
    for (let f = f0; f < f1; f++) {
      for (let b = 0; b < NB; b++) feat[b] += bands[f * NB + b];
      en += rms[f]; on += onsetN[f]; c++;
    }
    if (c) { for (let b = 0; b < NB; b++) feat[b] /= c; en /= c; on /= c; }
    bars.push({ beatIndex: i, start: t0, end: t1, feat, energy: en, density: on });
  }
  onProgress(0.86); await tick();

  // 6. セクション分け: 小節どうしの似ている度合いから変化点を探す
  const nb = bars.length;
  // 小節ごとの特徴(音色のかたち・音量・にぎやかさ)を標準化して比べる
  const D = NB + 2;
  const F = bars.map((b) => {
    const v = new Float32Array(D);
    for (let k = 0; k < NB; k++) v[k] = Math.log(1e-4 + b.feat[k]);
    v[NB] = Math.log(1e-5 + b.energy) * 2;
    v[NB + 1] = b.density * 4;
    return v;
  });
  for (let k = 0; k < D; k++) {
    let m = 0; for (const v of F) m += v[k]; m /= nb || 1;
    let sd = 0; for (const v of F) sd += (v[k] - m) ** 2; sd = Math.sqrt(sd / (nb || 1)) || 1;
    sd = Math.max(sd, 1e-3);
    for (const v of F) v[k] = (v[k] - m) / sd;
  }
  const dist = (a, b) => { let s = 0; for (let k = 0; k < D; k++) { const d = F[a][k] - F[b][k]; s += d * d; } return Math.sqrt(s / D); };
  const K = 4;
  const novelty = new Float32Array(nb);
  for (let i = K; i < nb - K + 1; i++) {
    let cross = 0, within = 0, nc = 0, nw = 0;
    for (let a = -K; a < K; a++) for (let b = a + 1; b < K; b++) {
      const d = dist(i + a, i + b);
      if ((a < 0) !== (b < 0)) { cross += d; nc++; } else { within += d; nw++; }
    }
    novelty[i] = Math.max(0, cross / nc - within / nw);
  }
  // 盛り上がりの指標(音量・にぎやかさ・高音・低音)
  const loud = bars.map((_, i) => F[i][NB] + F[i][NB + 1] * 0.8 + (F[i][NB - 2] + F[i][NB - 4]) * 0.3 + (F[i][1] + F[i][2]) * 0.3);
  // ピーク選択(最低4小節空ける、4の倍数の位置を好む)
  // 山(局所最大)を探し、4小節単位の位置へ寄せる
  let nMean = 0, nVar = 0, nc = 0;
  for (let i = K; i < nb - K + 1; i++) { nMean += novelty[i]; nc++; }
  nMean /= nc || 1;
  for (let i = K; i < nb - K + 1; i++) nVar += (novelty[i] - nMean) ** 2;
  const nStd = Math.sqrt(nVar / (nc || 1));
  const cand = [];
  for (let i = K; i < nb - K + 1; i++) {
    const v = novelty[i];
    if (v < nMean + 0.25 * nStd) continue;
    if (v < (novelty[i - 1] ?? 0) || v < (novelty[i + 1] ?? 0)) continue;
    let pos = i;
    for (const d of [-1, 1, -2, 2]) { const j = i + d; if (j % 4 === 0 && novelty[j] >= v * 0.75) { pos = j; break; } }
    const bonus = pos % 4 === 0 ? 1.25 : pos % 2 === 0 ? 1.05 : 0.85;
    cand.push({ i: pos, v: v * bonus });
  }
  cand.sort((a, b) => b.v - a.v);
  const chosen = [];
  for (const c of cand) {
    if (chosen.some((x) => Math.abs(x - c.i) < 4)) continue;
    chosen.push(c.i);
    if (chosen.length > Math.max(3, nb / 4)) break;
  }
  chosen.sort((a, b) => a - b);
  let bounds = [0, ...chosen, nb];
  // 16小節より長い区間は、中でいちばん変化の大きい所(4小節単位)でさらに分ける
  for (let pass = 0; pass < 4; pass++) {
    const nbnd = [bounds[0]];
    for (let k = 1; k < bounds.length; k++) {
      const s0 = bounds[k - 1], s1 = bounds[k];
      if (s1 - s0 > 16) {
        let best = -1, bv = 0;
        for (let i = s0 + 4; i <= s1 - 4; i++) {
          const v = novelty[i] * (i % 4 === 0 ? 1.3 : 0.7);
          if (v > bv) { bv = v; best = i; }
        }
        if (best > 0 && novelty[best] > nMean * 0.7) nbnd.push(best);
      }
      nbnd.push(s1);
    }
    bounds = nbnd;
  }
  // それでも長すぎるセクションは16小節ごとに区切る
  const finalBounds = [0];
  for (let k = 1; k < bounds.length; k++) {
    let s = finalBounds[finalBounds.length - 1];
    while (bounds[k] - s > 24) { s += 16; finalBounds.push(s); }
    if (bounds[k] - s >= 2 || k === bounds.length - 1) finalBounds.push(bounds[k]);
  }
  const uniq = [...new Set(finalBounds)].sort((a, b) => a - b);

  // 7. 盛り上がり度合い(0〜3)とラベル
  const sections = [];
  for (let k = 0; k < uniq.length - 1; k++) {
    const a = uniq[k], b = uniq[k + 1];
    if (b <= a) continue;
    let e = 0; for (let i = a; i < b; i++) e += loud[i]; e /= b - a;
    sections.push({ startBar: a, endBar: b, energy: 0, raw: e });
  }
  // 曲の中での順位と、いちばん静か〜いちばん盛り上がりの間の位置の両方で決める
  const totalBars = sections.reduce((acc, x) => acc + (x.endBar - x.startBar), 0) || 1;
  const rmin = Math.min(...sections.map((x) => x.raw)), rmax = Math.max(...sections.map((x) => x.raw));
  for (const x of sections) {
    let below = 0;
    for (const y of sections) if (y.raw < x.raw - 1e-9) below += y.endBar - y.startBar;
    const p = below / totalBars;
    const rel = (x.raw - rmin) / (rmax - rmin || 1);
    const sc = 0.5 * p + 0.5 * rel;
    x.energy = sc >= 0.72 ? 3 : sc >= 0.45 ? 2 : sc >= 0.18 ? 1 : 0;
  }
  // ラベル
  sections.forEach((s, i) => {
    if (i === 0 && s.energy <= 1) s.label = 'イントロ';
    else if (i === sections.length - 1 && s.energy <= 1) s.label = 'アウトロ';
    else if (s.energy === 3) s.label = 'サビ';
    else if (s.energy === 2) s.label = (sections[i + 1]?.energy === 3) ? 'Bメロ' : '展開';
    else if (s.energy === 1) s.label = 'Aメロ';
    else s.label = '間奏';
  });

  const beatsArr = beats;
  const sectionsOut = sections.map((s) => {
    const sb = bars[s.startBar].beatIndex;
    const eb = s.endBar < bars.length ? bars[s.endBar].beatIndex : bars[bars.length - 1].beatIndex + 4;
    return {
      label: s.label, energy: s.energy,
      startBeat: sb, endBeat: eb,
      start: beatsArr[sb], end: beatsArr[Math.min(eb, beatsArr.length - 1)],
      startBar: s.startBar, endBar: s.endBar,
    };
  });
  // 最初のセクション前(弱起)は イントロ 扱い
  if (sectionsOut.length && sectionsOut[0].startBeat > 0 && sectionsOut[0].startBeat < 4) {
    sectionsOut[0].startBeat = 0; sectionsOut[0].start = 0;
  } else if (sectionsOut.length && sectionsOut[0].startBeat > 0) {
    sectionsOut.unshift({ label: 'イントロ', energy: 0, startBeat: 0, endBeat: sectionsOut[0].startBeat, start: 0, end: sectionsOut[0].start, startBar: -1, endBar: 0 });
  }
  onProgress(1);

  return {
    bpm: Math.round(bpm * 10) / 10,
    beats: beatsArr,
    beatsPerBar: 4,
    firstDownbeat: bestPhase,
    sections: sectionsOut,
    duration: total,
  };
}

// 歌詞ファイル(LRC / テキスト)の読み込み
export function parseLyrics(text, song) {
  const lines = text.replace(/\r/g, '').split('\n');
  const out = [];
  const timeRe = /\[(\d+):(\d+(?:\.\d+)?)\]/g;
  const wordRe = /<(\d+):(\d+(?:\.\d+)?)>/g;
  let hasTime = false;
  for (const raw of lines) {
    const times = [];
    let m;
    timeRe.lastIndex = 0;
    while ((m = timeRe.exec(raw))) times.push(parseInt(m[1]) * 60 + parseFloat(m[2]));
    if (!times.length) continue;
    hasTime = true;
    let body = raw.replace(timeRe, '');
    // 単語タイミング <mm:ss.xx>
    const words = [];
    if (wordRe.test(body)) {
      wordRe.lastIndex = 0;
      const parts = body.split(/(<\d+:\d+(?:\.\d+)?>)/);
      let cur = null;
      for (const p of parts) {
        const wm = /<(\d+):(\d+(?:\.\d+)?)>/.exec(p);
        if (wm) cur = parseInt(wm[1]) * 60 + parseFloat(wm[2]);
        else if (p) for (const ch of p) words.push({ text: ch, time: cur });
      }
      body = body.replace(/<\d+:\d+(?:\.\d+)?>/g, '');
    }
    for (const t of times) out.push({ time: t, text: body.trim(), words: words.length ? words : null });
  }
  if (hasTime) {
    out.sort((a, b) => a.time - b.time);
    for (let i = 0; i < out.length; i++) {
      const next = out[i + 1]?.time ?? out[i].time + 6;
      out[i].end = Math.min(next - 0.05, out[i].time + 9);
    }
    const filtered = out.filter((l) => l.text.length);
    fillWords(filtered);
    return filtered;
  }
  // 時刻なしのテキスト: 盛り上がりのあるセクションに2小節ずつ割り振る
  const textLines = lines.map((l) => l.trim()).filter((l) => l && !/^\[.*\]$/.test(l));
  if (!song || !textLines.length) return [];
  const spbBeats = song.beats;
  const slots = [];
  for (const s of song.sections) {
    if (s.label === 'イントロ' || s.label === 'アウトロ' || s.label === '間奏') continue;
    for (let b = s.startBeat; b + 8 <= s.endBeat; b += 8) slots.push(b);
  }
  const res = [];
  for (let i = 0; i < textLines.length && i < slots.length; i++) {
    const b = slots[i];
    const t0 = spbBeats[b], t1 = spbBeats[Math.min(b + 8, spbBeats.length - 1)];
    res.push({ time: t0, end: t1 - 0.05, text: textLines[i], words: null });
  }
  fillWords(res);
  return res;
}

function fillWords(list) {
  for (const l of list) {
    if (l.words && l.words.some((w) => w.time != null)) {
      let last = l.time;
      for (const w of l.words) { if (w.time == null) w.time = last; last = w.time; }
      continue;
    }
    const chars = [...l.text];
    const dur = Math.max(0.5, (l.end - l.time) * 0.8);
    l.words = chars.map((c, i) => ({ text: c, time: l.time + (dur * i) / Math.max(1, chars.length) }));
  }
}
