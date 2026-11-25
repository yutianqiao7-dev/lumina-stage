// 画面の操作部分
import { STYLES } from './dance/composer.js';
import { SHOT_NAMES } from './camera/director.js';
import { PALETTE_NAMES } from './main-consts.js';
import { CHARACTERS } from './characters.js';

const $ = (id) => document.getElementById(id);
const fmt = (s) => { s = Math.max(0, s || 0); const m = Math.floor(s / 60); return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };
const ENERGY_COLORS = ['#4a5cff', '#2fb7c9', '#c065ff', '#ff4fa3'];

export class UI {
  constructor(app) {
    this.app = app;
    this.seeking = false;
    this.subKey = null;
    this.bind();
    this.renderSongList();
    this.buildSegs();
    this.renderCharaGrids();
  }

  renderCharaGrids() {
    for (const id of ['charaGrid', 'titleCharaGrid']) {
      const el = $(id);
      el.innerHTML = '';
      for (const c of CHARACTERS) {
        const b = document.createElement('button');
        b.className = 'chara-card'; b.dataset.id = c.id; b.title = `${c.name}(${c.sub})`;
        b.innerHTML = c.thumb ? `<img loading="lazy" alt="">` : `<div class="robo">🤖</div>`;
        if (c.thumb) b.querySelector('img').src = c.thumb;
        const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = c.name; b.appendChild(nm);
        b.onclick = () => this.app.selectCharacter(c.id, this.app.started);
        el.appendChild(b);
      }
    }
    this.onCharacter(this.app.charId);
  }

  renderBackSlots() {
    const app = this.app, el = $('backSlots');
    el.innerHTML = '';
    const pos = ['左手前', '右手前', '左奥', '右奥'];
    for (let i = 0; i < 4; i++) {
      const lab = document.createElement('label');
      if (i >= app.backCount) lab.className = 'off';
      const sp = document.createElement('span'); sp.textContent = `${i + 1}人目(${pos[i]})`;
      const sel = document.createElement('select');
      for (const [v, t] of [['auto', 'メインの色違い'], ...CHARACTERS.map((c) => [c.id, c.name])]) {
        const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o);
      }
      sel.value = app.backChoices[i] || 'auto';
      sel.disabled = i >= app.backCount;
      sel.onchange = () => app.setBackChoice(i, sel.value);
      lab.append(sp, sel); el.appendChild(lab);
    }
  }

  showResult(r, songTitle) {
    $('resSong').textContent = songTitle;
    $('resRank').textContent = r.rank;
    $('resClear').textContent = r.fullCombo ? '★ FULL COMBO ★' : r.clear ? 'CLEAR' : 'FAILED';
    $('resClear').style.color = r.fullCombo ? '#ffd84a' : r.clear ? '#7df0ff' : '#ff6b8a';
    $('resScore').textContent = String(r.score).padStart(7, '0');
    $('resTable').innerHTML = `<tr><td style="color:#ffe66b">PERFECT</td><td>${r.perfect}</td></tr><tr><td style="color:#7df0ff">GREAT</td><td>${r.great}</td></tr><tr><td style="color:#b9ff8a">GOOD</td><td>${r.good}</td></tr><tr><td style="color:#ff6b8a">MISS</td><td>${r.miss}</td></tr><tr><td>MAX COMBO</td><td>${r.maxCombo}</td></tr><tr><td>正確さ</td><td>${(r.acc * 100).toFixed(1)}%</td></tr>`;
    $('gameResult').classList.remove('hidden');
  }

  recShowLive(src) {
    $('recStep1').classList.add('hidden'); $('recStep2').classList.remove('hidden');
    $('recSrc').textContent = src ? `録音中のタブ: ${src}` : '';
    $('recState').textContent = '曲の再生を待っています…';
  }
  recTick(r) {
    const s = Math.floor(r.elapsed);
    $('recTime').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    $('recLevel').style.width = `${Math.round(r.level * 100)}%`;
    $('recState').textContent = !r.heard ? '曲の再生を待っています…' : r.silentFor > 0.8 ? `静かになりました…(あと${Math.max(0, Math.ceil(4 - r.silentFor))}秒で自動で止まります)` : '録音しています';
  }
  recHide() { $('recPanel').classList.add('hidden'); }

  onCharacter(id) {
    document.querySelectorAll('.chara-card').forEach((b) => b.classList.toggle('active', b.dataset.id === id));
  }

  bind() {
    const app = this.app;
    $('startBtn').onclick = async () => {
      $('title').classList.add('fade');
      setTimeout(() => $('title').classList.add('hidden'), 800);
      await app.start();
    };
    $('playBtn').onclick = () => app.togglePlay();
    $('nextBtn').onclick = () => app.next();
    $('prevBtn').onclick = () => app.prev();
    const seek = $('seek');
    seek.addEventListener('input', () => { this.seeking = true; $('time').textContent = `${fmt((seek.value / 1000) * app.audio.duration)} / ${fmt(app.audio.duration)}`; });
    seek.addEventListener('change', () => { app.seek((seek.value / 1000) * app.audio.duration); this.seeking = false; });
    $('volume').oninput = (e) => app.audio.setVolume(e.target.value / 100);
    $('camBtn').onclick = () => app.setCamMode(app.camMode === 'auto' ? 'free' : app.camMode === 'free' ? 'fixed' : 'auto');
    $('recBtn').onclick = () => app.toggleRecording();
    // 音ゲー
    this.gameDiff = 'normal';
    const openGame = () => { $('gameMenu').classList.remove('hidden'); $('offsetRange').value = Math.round(app.game.offset * 1000); $('offsetVal').textContent = `${$('offsetRange').value}ms`; };
    $('gameBtn').onclick = openGame;
    $('gameStartBtn').onclick = async () => {
      $('title').classList.add('fade'); setTimeout(() => $('title').classList.add('hidden'), 800);
      app.audio.ensure(); await app.audio.ctx.resume(); app.started = true;
      if (!app.song) { await app.selectSong(0); app.audio.pause(); app.ui.onPlayState(); }
      openGame();
    };
    $('diffSeg').querySelectorAll('button').forEach((b) => b.onclick = () => { $('diffSeg').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b)); this.gameDiff = b.dataset.v; });
    $('offsetRange').oninput = (e) => { $('offsetVal').textContent = `${e.target.value}ms`; app.game.setOffset(parseInt(e.target.value)); };
    $('gameGo').onclick = () => { $('gameMenu').classList.add('hidden'); app.startGame(this.gameDiff); };
    $('gameCancel').onclick = () => $('gameMenu').classList.add('hidden');
    $('gameQuit').onclick = () => app.quitGame();
    $('resRetry').onclick = () => { $('gameResult').classList.add('hidden'); app.startGame(this.gameDiff); };
    $('resBack').onclick = () => { $('gameResult').classList.add('hidden'); };
    $('hideBtn').onclick = () => this.toggleUI();
    $('fsBtn').onclick = () => this.fullscreen();
    $('panelBtn').onclick = () => $('panel').classList.toggle('closed');
    $('helpBtn').onclick = () => $('help').classList.remove('hidden');
    $('helpClose').onclick = () => $('help').classList.add('hidden');
    $('help').onclick = (e) => { if (e.target.id === 'help') $('help').classList.add('hidden'); };
    document.querySelectorAll('.tabs button').forEach((b) => b.onclick = () => {
      document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
      document.querySelectorAll('.tab-body section').forEach((s) => s.classList.toggle('active', s.dataset.pane === b.dataset.tab));
    });
    $('audioFile').onchange = (e) => { app.addAudioFiles([...e.target.files]); e.target.value = ''; };
    // ほかのタブの音を録音
    $('tabRecBtn').onclick = () => { $('recStep1').classList.remove('hidden'); $('recStep2').classList.add('hidden'); $('recPanel').classList.remove('hidden'); };
    $('recClose').onclick = () => $('recPanel').classList.add('hidden');
    $('recStart').onclick = () => app.startTabRecording($('recName').value.trim());
    $('recStop').onclick = () => app.finishTabRecording();
    $('recCancel').onclick = () => app.cancelTabRecording();
    $('vrmFile').onchange = (e) => { if (e.target.files[0]) app.loadVRMFile(e.target.files[0]); e.target.value = ''; };
    $('lyricFile').onchange = async (e) => { const f = e.target.files[0]; if (f) { const txt = await f.text(); $('lyricText').value = txt; app.setLyricsText(txt, f.name); } e.target.value = ''; };
    $('lyricApply').onclick = () => app.setLyricsText($('lyricText').value);
    $('reChoreo').onclick = () => app.reChoreo();
    $('confettiBtn').onclick = () => app.stage.confetti.launch(app.stage.palette.map((c) => c.clone()), 1);
    $('mirrorBack').onchange = (e) => { app.mirrorBack = e.target.checked; };
    $('optCrowd').onchange = (e) => { app.stage.crowd.group.visible = e.target.checked; };
    $('optLaser').onchange = (e) => { app.stage.laserMat.uniforms.uIntensity.value = 0; app.stage.lasersEnabled = e.target.checked; app.stage.lasers.material.visible = e.target.checked; };
    $('optSmoke').onchange = (e) => { const v = e.target.checked; app.stage.smoke.group.visible = v; app.stage.sparks.points.visible = v; app.stage.confetti.mesh.visible = v; };
    $('optFeed').onchange = (e) => { app.feedOn = e.target.checked; };
    $('optFps').onchange = (e) => { $('fps').style.display = e.target.checked ? '' : 'none'; };
    $('fps').style.display = 'none';
    $('cutRate').oninput = (e) => { app.director.cutRate = e.target.value / 100; };

    // キーボード
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
      const k = e.key.toLowerCase();
      if (document.body.classList.contains('game-mode')) { if (k === 'escape') app.quitGame(); return; }
      if (k === ' ') { e.preventDefault(); app.togglePlay(); }
      else if (k === 'arrowright') app.seek(app.audio.currentTime + 5);
      else if (k === 'arrowleft') app.seek(app.audio.currentTime - 5);
      else if (k === 'n') app.next();
      else if (k === 'p') app.prev();
      else if (k === 'c') $('camBtn').click();
      else if (k === 'h') this.toggleUI();
      else if (k === 'f') this.fullscreen();
      else if (k === 'r') app.reChoreo();
      else if (k === '?' || k === '/') $('help').classList.toggle('hidden');
      else if (k === 'escape') { $('help').classList.add('hidden'); $('panel').classList.add('closed'); }
      else if (/^[1-9]$/.test(k)) { const names = Object.keys(SHOT_NAMES); const n = names[parseInt(k) - 1]; if (n) app.pickShot(n); }
    });

    // ドラッグ&ドロップ
    let dragDepth = 0;
    window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('drop').classList.remove('hidden'); });
    window.addEventListener('dragleave', (e) => { e.preventDefault(); dragDepth--; if (dragDepth <= 0) $('drop').classList.add('hidden'); });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', async (e) => {
      e.preventDefault(); dragDepth = 0; $('drop').classList.add('hidden');
      const files = [...e.dataTransfer.files];
      if (!files.length) return;
      if (!app.started) { $('title').classList.add('hidden'); app.audio.ensure(); await app.audio.ctx.resume(); app.started = true; }
      const vrm = files.find((f) => /\.vrm$/i.test(f.name));
      const audio = files.filter((f) => /\.(mp3|wav|ogg|m4a|aac|flac|opus|webm)$/i.test(f.name) || f.type.startsWith('audio/'));
      const lyr = files.find((f) => /\.(lrc|txt)$/i.test(f.name));
      if (vrm) await app.loadVRMFile(vrm);
      if (audio.length) await app.addAudioFiles(audio);
      if (lyr) { const txt = await lyr.text(); $('lyricText').value = txt; app.setLyricsText(txt, lyr.name); }
      if (!vrm && !audio.length && !lyr) this.toast('VRM・曲・歌詞(.lrc/.txt)のファイルをドロップしてください', true);
      if (!app.song && !audio.length) app.selectSong(0);
    });

    // 一定時間操作が無ければマウスカーソルを隠す
    let idleT = null;
    window.addEventListener('mousemove', () => {
      document.body.style.cursor = '';
      clearTimeout(idleT);
      idleT = setTimeout(() => { if (document.body.classList.contains('ui-hidden')) document.body.style.cursor = 'none'; }, 2500);
    });
  }

  buildSegs() {
    const app = this.app;
    const seg = (id, items, cur, onPick) => {
      const el = $(id);
      el.innerHTML = '';
      for (const [v, label] of items) {
        const b = document.createElement('button');
        b.dataset.v = v; b.textContent = label;
        if (v === cur) b.classList.add('active');
        b.onclick = () => { el.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b)); onPick(v); };
        el.appendChild(b);
      }
    };
    seg('styleSeg', Object.entries(STYLES), app.style, (v) => app.setStyle(v));
    seg('paletteSeg', Object.entries(PALETTE_NAMES), app.paletteKey, (v) => app.setPalette(v));
    seg('shotSeg', Object.entries(SHOT_NAMES).map(([k, v], i) => [k, `${i < 9 ? i + 1 + ' ' : ''}${v}`]), null, (v) => app.pickShot(v));
    const wire = (id, fn) => $(id).querySelectorAll('button').forEach((b) => b.onclick = () => { $(id).querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b)); fn(b.dataset.v); });
    $('backCount').querySelectorAll('button').forEach((b) => b.classList.toggle('active', parseInt(b.dataset.v) === app.backCount));
    wire('backCount', (v) => { app.setBackCount(parseInt(v)); this.renderBackSlots(); });
    this.renderBackSlots();
    $('danceSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === app.danceMode));
    wire('danceSeg', (v) => app.setDanceMode(v));
    wire('camSeg', (v) => app.setCamMode(v));
    wire('lyricMode', (v) => { app.lyricMode = v; });
    wire('qualitySeg', (v) => { app.manualQuality = true; try { localStorage.setItem('lumina.quality', v); } catch (e) { /* */ } app.setQuality(v); });
  }

  renderSongList() {
    const app = this.app;
    const el = $('songList');
    el.innerHTML = '';
    app.songs.forEach((s, i) => {
      const b = document.createElement('button');
      b.className = 'song-item' + (i === app.current ? ' active' : '');
      const hue = Math.round((s.hue ?? 0.9) * 360);
      b.innerHTML = `<span class="no">${String(i + 1).padStart(2, '0')}</span><span><div class="t"></div><div class="a"></div></span><span class="sw" style="background:linear-gradient(90deg,hsl(${hue} 90% 60%),hsl(${(hue + 120) % 360} 90% 60%))"></span>`;
      b.querySelector('.t').textContent = s.title;
      b.querySelector('.a').textContent = s.artist + (s.data ? `・BPM ${Math.round(s.data.bpm)}` : '');
      b.onclick = () => app.selectSong(i);
      el.appendChild(b);
    });
  }

  onSongChanged() {
    const app = this.app, s = app.song;
    $('songTitle').textContent = s.title;
    $('songArtist').textContent = s.artist || '';
    $('songBpm').textContent = `BPM ${Math.round(s.bpm)}`;
    this.renderSongList();
    // セクションの帯
    const sec = $('sections');
    sec.innerHTML = '';
    const dur = app.audio.duration || 1;
    let last = 0;
    for (const x of s.sections) {
      const start = Math.max(0, x.start), end = Math.min(dur, x.end);
      if (start > last + 0.01) { const gap = document.createElement('div'); gap.style.width = `${((start - last) / dur) * 100}%`; gap.style.background = '#333'; sec.appendChild(gap); }
      const d = document.createElement('div');
      d.style.width = `${((end - start) / dur) * 100}%`;
      d.style.background = ENERGY_COLORS[x.energy];
      d.dataset.label = x.label;
      sec.appendChild(d);
      last = end;
    }
    // 解析結果
    const an = $('analysis');
    an.innerHTML = `<div><b>解析結果</b> ─ BPM ${s.bpm}・${s.sections.length} セクション・${Math.round(s.beats.length / 4)} 小節</div><div class="secs"></div>`;
    const box = an.querySelector('.secs');
    for (const x of s.sections) {
      const sp = document.createElement('span');
      sp.textContent = x.label; sp.style.background = ENERGY_COLORS[x.energy];
      box.appendChild(sp);
    }
  }

  onChoreo(ch) { $('styleBadge').textContent = `振付: ${STYLES[ch.style] || ch.style}`; }

  onPlayState() { $('playBtn').textContent = this.app.audio.playing ? '❚❚' : '▶'; }

  onCamMode() {
    const m = this.app.camMode;
    $('camBtn').textContent = m === 'auto' ? '🎥 自動' : m === 'free' ? '🖐 自由' : '📌 固定';
    $('camSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === m));
    if (m !== 'auto') $('shotBadge').textContent = m === 'free' ? '自由カメラ' : `固定: ${SHOT_NAMES[this.app.director.manualShot || this.app.director.shot] || ''}`;
  }

  onShot(name) { if (this.app.camMode === 'auto') $('shotBadge').textContent = '🎥 ' + (SHOT_NAMES[name] || name); }

  onQuality() { $('qualitySeg').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === this.app.quality)); }

  onRecording(on) { $('recBtn').classList.toggle('rec', on); $('recBtn').textContent = on ? '⏹ 録画停止' : '⏺ 録画'; }

  setCharaName(n) { $('charaName').textContent = n; }
  autoNext() { return $('autoNext').checked; }
  setFps(n) { $('fps').textContent = `${n} FPS`; }

  loading(text, p) {
    const el = $('loading');
    if (text === false) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    if (text) $('loadingText').textContent = text;
    if (p != null) $('loadingBar').style.width = `${Math.round(p * 100)}%`;
  }

  toast(msg, err = false) {
    const d = document.createElement('div');
    d.className = 'toast' + (err ? ' err' : '');
    d.textContent = msg;
    $('toast').appendChild(d);
    setTimeout(() => { d.style.transition = 'opacity .4s'; d.style.opacity = '0'; setTimeout(() => d.remove(), 400); }, 3600);
  }

  toggleUI() { document.body.classList.toggle('ui-hidden'); if (!document.body.classList.contains('ui-hidden')) document.body.style.cursor = ''; }
  fullscreen() { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.(); else document.exitFullscreen?.(); }

  updateSubtitle(t, color) {
    const mode = this.app.lyricMode;
    const el = $('subLine');
    if (t < 0 || !(mode === 'sub' || mode === 'both')) { if (this.subKey !== null) { el.innerHTML = ''; this.subKey = null; } return; }
    const line = this.app.lyrics.current(t);
    if (!line) { if (this.subKey !== null) { el.style.opacity = 0; this.subKey = null; } return; }
    if (this.subKey !== line) {
      this.subKey = line;
      el.innerHTML = '';
      (line.words || [...line.text].map((c) => ({ text: c, time: line.time }))).forEach((w) => {
        const s = document.createElement('span'); s.className = 'ch'; s.textContent = w.text; s._t = w.time; el.appendChild(s);
      });
      el.style.opacity = 1;
    }
    el.style.setProperty('--sub-color', `#${color.getHexString()}`);
    for (const s of el.children) s.classList.toggle('on', t >= s._t);
  }

  update(t, entry, sec) {
    const app = this.app;
    const dur = app.audio.duration;
    if (!this.seeking && dur) {
      $('seek').value = Math.round((t / dur) * 1000);
      $('time').textContent = `${fmt(t)} / ${fmt(dur)}`;
    }
    const label = sec ? `${sec.label}${entry ? ' ・ ' + entry.move.name : ''}` : (app.song ? '一時停止' : '待機中');
    if (label !== this._lastLabel) { $('sectionBadge').textContent = label; this._lastLabel = label; }
  }
}
