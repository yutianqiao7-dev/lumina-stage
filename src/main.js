// ルミナステージ 本体
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { AudioEngine } from './audio/engine.js';
import { renderSong } from './audio/synth.js';
import { DEMO_SONGS } from './audio/songs.js';
import { analyzeAudio, parseLyrics } from './audio/analyze.js';
import { composeChoreography, timeToBeat } from './dance/composer.js';
import { neutralPose, mirrorPose, copyPose } from './dance/pose.js';
import { MOVE_BY_ID } from './dance/moves.js';
import { Dancer, loadVRMFromBuffer, recolorVRM } from './dance/dancer.js';
import { Stage, STAGE_H } from './stage/stage.js';
import { Director, FeedDirector } from './camera/director.js';
import { Lyrics3D, LYRIC_FONT, clearGlyphCache } from './lyrics/lyrics3d.js';
import { Post } from './post/post.js';
import { UI } from './ui.js';
import { Rng } from './util/math.js';
import { PALETTES } from './main-consts.js';
import { CHARACTERS } from './characters.js';
import { RhythmGame } from './game/rhythm.js';
import { TabRecorder, trimSilence } from './audio/tabrecorder.js';
import { loadDanceLibrary, composeMocap, makeIdleMocap, newFrame } from './dance/mocap.js';

const BACK_POS = [[-2.5, -1.9], [2.5, -1.9], [-5.0, -3.4], [5.0, -3.4]];
const BACK_HUES = [0.5, 0.18, 0.72, 0.35];
const ACCENTS = [['#ff4fa3', '#4fe3ff'], ['#4fb8ff', '#ffe14f'], ['#b36bff', '#7dffb5'], ['#ff9b3f', '#ff4fd8'], ['#42ffd0', '#ff6b6b']];

export const IS_MOBILE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 900);

class App {
  constructor() {
    this.canvas = document.getElementById('view');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false; // 影は1フレームに1回だけ計算する

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.05, 300);
    this.camera.position.set(0, 5, 22);
    this.feedCam = new THREE.PerspectiveCamera(30, 16 / 9, 0.05, 200);
    this.feedCam.position.set(0, 2.5, 4);
    this.feedRT = new THREE.WebGLRenderTarget(640, 360, { type: THREE.HalfFloatType, samples: 0 });
    this.feedRT.texture.colorSpace = THREE.LinearSRGBColorSpace;

    this.stage = new Stage(this.scene, this.renderer);
    this.audio = new AudioEngine();
    this.audio.onEnded = () => this.onSongEnd();
    this.director = new Director(this.camera);
    this.feedDirector = new FeedDirector(this.feedCam);
    this.lyrics = new Lyrics3D(this.scene);
    this.post = new Post(this.renderer, this.scene, this.camera);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.target.set(0, STAGE_H + 1.2, 0);
    this.controls.enabled = false;
    this.controls.maxDistance = 60;

    // ダンサー
    this.main = new Dancer({ isMain: true });
    this.main.group.position.set(0, STAGE_H, 0);
    this.scene.add(this.main.group);
    this.main.useMannequin(...ACCENTS[0]);
    this.backs = [];
    this.backCount = 2;
    this.backChoices = ['auto', 'auto', 'auto', 'auto'];
    try {
      const bc = JSON.parse(localStorage.getItem('lumina.backs') || 'null'); if (Array.isArray(bc)) this.backChoices = bc.concat(['auto', 'auto', 'auto', 'auto']).slice(0, 4);
      const n = parseInt(localStorage.getItem('lumina.backCount')); if ([0, 2, 4].includes(n)) this.backCount = n; else if (IS_MOBILE) this.backCount = 0;
    } catch (e) { /* */ }
    this.mirrorBack = true;
    this.vrmBuffer = null;

    // 状態
    this.songs = DEMO_SONGS.map((d) => ({ id: d.id, title: d.title, artist: d.artist, kind: 'demo', def: d, data: null, hue: d.palette.hues[0] }));
    this.current = -1;
    this.song = null;
    this.choreo = null;
    this.style = 'auto';
    this.seed = 1;
    this.paletteKey = 'auto';
    this.camMode = 'auto';
    this.lyricMode = '3d';
    this.quality = 'high';
    this.feedOn = true;
    this.pose = neutralPose();
    this.backPose = neutralPose();
    // 本物のダンス(AIST++)
    this.danceMode = 'mocap';
    try { this.danceMode = localStorage.getItem('lumina.danceMode') || 'mocap'; } catch (e) { /* */ }
    this.danceLib = null;
    this.mocapChoreo = null;
    this.mocapFrame = newFrame();
    this.backFrames = [newFrame(), newFrame(), newFrame(), newFrame()];
    this.energy = 0;
    this.idleBeat = 0;
    this.lastT = performance.now();
    this.frames = 0; this.fpsTime = 0;
    this.started = false;
    this.endTimer = null;
    this.idleChoreo = { sample: (b, out) => { copyPose(out, neutralPose()); MOVE_BY_ID.idle.fn(out, ((b % 4) + 4) % 4, { e: 0.3 }); } };

    this.ui = new UI(this);
    this.game = new RhythmGame(this);
    this.updateBackDancers();
    let saved = 'default';
    try { saved = localStorage.getItem('lumina.chara') || 'default'; } catch (e) { /* */ }
    this.selectCharacter(saved, false);
    let savedQ = null;
    try { savedQ = localStorage.getItem('lumina.quality'); } catch (e) { /* */ }
    if (savedQ) this.manualQuality = true;
    this.setQuality(savedQ || this.autoQuality());
    window.addEventListener('resize', () => this.onResize());
    this.stage.setPalette(DEMO_SONGS[0].palette.hues);
    this.stage.setWallText(this.makeTitleTexture('LUMINA STAGE', 'ルミナステージ'));
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);

    document.fonts && document.fonts.load(`900 64px "Zen Maru Gothic"`).then(() => clearGlyphCache()).catch(() => {});
    this.preloadDemos();
    this.loadDances();
  }

  // ---------------- 曲 ----------------
  async start() {
    this.audio.ensure();
    await this.audio.ctx.resume();
    this.started = true;
    await this.selectSong(0);
  }

  // デモ曲は裏で先に演奏・録音しておく(silent=true なら画面に出さない)
  async prepare(entry, silent = false) {
    if (entry.data) return entry.data;
    if (entry.kind !== 'demo') return entry.data;
    if (!entry.promise) {
      entry.progress = 0.03;
      entry.promise = renderSong(entry.def, (v) => {
        entry.progress = v == null ? Math.min(0.95, entry.progress + 0.04) : v;
        if (this._showing === entry) this.ui.loading(null, entry.progress);
      }).then((d) => (entry.data = d));
    }
    if (!silent) { this._showing = entry; this.ui.loading(`「${entry.title}」を演奏して録音しています…`, entry.progress); }
    const data = await entry.promise;
    if (this._showing === entry) this._showing = null;
    return data;
  }

  preloadDemos() {
    let demos = this.songs.filter((s) => s.kind === 'demo');
    if (IS_MOBILE) demos = demos.slice(0, 1); // スマホは最初の1曲だけ先に作る
    demos.reduce((p, s) => p.then(() => this.prepare(s, true)).catch(() => {}), Promise.resolve());
  }

  async selectSong(i) {
    if (i < 0 || i >= this.songs.length) return;
    clearTimeout(this.endTimer);
    const entry = this.songs[i];
    this.audio.stop();
    try {
      const data = await this.prepare(entry);
      this.current = i;
      this.song = data;
      this.audio.setBuffer(data.buffer);
      this.applyPalette();
      this.lyrics.setLyrics(entry.lyricsOverride || data.lyrics || []);
      this.rebuildChoreo();
      this.stage.setWallText(this.makeTitleTexture(data.title, data.artist || ''));
      this.stage.lastSection = -1;
      this.director.lastSectionIdx = -999;
      this.ui.onSongChanged();
      this.ui.loading(false);
      await this.audio.play();
      this.ui.onPlayState();
    } catch (e) {
      console.error(e);
      this.ui.loading(false);
      this.ui.toast('曲の準備に失敗しました: ' + e.message, true);
    }
  }

  loadDances() {
    // スマホは軽量版(約5MB・79本)、パソコンは全部(約22MB・300本以上)
    loadDanceLibrary('./dances/', IS_MOBILE ? 'aist_lite' : 'aist').then((lib) => {
      this.danceLib = lib;
      this.idleMocap = makeIdleMocap(lib);
      this.rebuildChoreo();
    }).catch((e) => { console.warn('ダンスデータを読み込めませんでした', e); this.danceMode = 'procedural'; });
  }

  setDanceMode(m) {
    this.danceMode = m;
    try { localStorage.setItem('lumina.danceMode', m); } catch (e) { /* */ }
    this.rebuildChoreo();
  }

  rebuildChoreo() {
    if (!this.song) return;
    if (this.danceLib) this.mocapChoreo = composeMocap(this.danceLib, this.song, { style: this.style, seed: this.seed });
    const lyr = this.lyrics.lines;
    this.choreo = composeChoreography(this.song, { style: this.style, seed: this.seed, hasLyrics: lyr.length > 0 });
    this.ui.onChoreo(this.choreo);
  }

  reChoreo() { this.seed = Math.floor(Math.random() * 100000); this.rebuildChoreo(); this.ui.toast('振り付けを作り直しました'); }

  setStyle(s) { this.style = s; this.rebuildChoreo(); }

  applyPalette() {
    const hues = PALETTES[this.paletteKey] || (this.song && this.song.palette && this.song.palette.hues) || [0.92, 0.55, 0.12];
    this.stage.setPalette(hues);
  }
  setPalette(k) { this.paletteKey = k; this.applyPalette(); }

  // 解析して曲リストに加える(ファイルでも録音でも共通)
  async addAudioBuffer(audioBuf, name, artist = '読み込んだ曲') {
    this.ui.loading('テンポ・拍・曲の構成を解析しています…', 0.1);
    const an = await analyzeAudio(audioBuf, (p) => this.ui.loading(null, 0.1 + p * 0.85));
    const rng = new Rng(Array.from(name).reduce((s, c) => s + c.charCodeAt(0), 0));
    const pals = Object.values(PALETTES).filter(Boolean);
    const data = { id: 'file-' + Date.now(), title: name, artist, buffer: audioBuf, ...an, lyrics: [], palette: { hues: rng.pick(pals) }, style: null };
    this.songs.push({ id: data.id, title: name, artist, kind: 'file', data, hue: data.palette.hues[0] });
    this.ui.renderSongList();
    this.ui.toast(`解析完了: BPM ${an.bpm}・${an.sections.length}セクション`);
    await this.selectSong(this.songs.length - 1);
  }

  // ---------------- ほかのタブの音を録音 ----------------
  async startTabRecording(name) {
    if (!TabRecorder.supported()) { this.ui.toast('このブラウザでは使えません(パソコンの Chrome / Edge で開いてください)', true); return; }
    this.audio.pause(); this.ui.onPlayState();
    this.recName = name;
    this.tabRec = new TabRecorder();
    try {
      await this.tabRec.start({ onTick: (r) => this.ui.recTick(r), onAutoStop: () => this.finishTabRecording() });
      this.ui.recShowLive(this.tabRec.label);
    } catch (e) {
      this.tabRec = null;
      if (e && e.message === 'NO_AUDIO') this.ui.toast('音が共有されていません。「タブの音声も共有する」をオンにして選び直してください', true);
      else if (e && e.name === 'NotAllowedError') this.ui.toast('共有がキャンセルされました');
      else { console.error(e); this.ui.toast('録音を始められませんでした', true); }
    }
  }
  async finishTabRecording() {
    const rec = this.tabRec; if (!rec || this._finishing) return;
    this._finishing = true;
    rec.stop();
    this.ui.recHide();
    try {
      this.ui.loading('録音した音を読み込んでいます…', 0.05);
      this.audio.ensure();
      const buf = await rec.toAudioBuffer(this.audio.ctx);
      if (!buf || buf.duration < 5) { this.ui.loading(false); this.ui.toast('音がほとんど録音されていませんでした。曲を再生しながら録音してください', true); return; }
      const title = this.recName || (rec.label || '').replace(/\s*[-|｜].*$/, '').trim() || `録音した曲 ${new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`;
      await this.addAudioBuffer(buf, title, 'タブから録音');
    } catch (e) {
      console.error(e); this.ui.loading(false); this.ui.toast('録音を読み込めませんでした', true);
    } finally { this.tabRec = null; this._finishing = false; }
  }
  cancelTabRecording() {
    if (this.tabRec) this.tabRec.cancel();
    this.tabRec = null;
    this.ui.recHide();
  }

  async addAudioFiles(files) {
    for (const f of files) {
      try {
        this.ui.loading(`「${f.name}」を読み込んでいます…`, 0.05);
        const buf = await f.arrayBuffer();
        let audioBuf;
        try { audioBuf = await this.audio.decode(buf); }
        catch (err) { throw new Error(/\.(mp4|mov)$/i.test(f.name) || f.type.startsWith('video/') ? 'この動画の音を読み込めませんでした' : '曲を読み込めませんでした'); }
        // 画面録画の動画: 前後の無音を切る
        const isVideo = f.type.startsWith('video/') || /\.(mp4|mov)$/i.test(f.name);
        if (isVideo) audioBuf = trimSilence(this.audio.ctx, audioBuf);
        const name = isVideo && /^(ScreenRecording|Screen_Recording|RPReplay|IMG_|画面収録|スクリーン)/i.test(f.name) ? `録画した曲 ${new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}` : f.name.replace(/\.[^.]+$/, '');
        await this.addAudioBuffer(audioBuf, name, isVideo ? '画面録画から' : '読み込んだ曲');
      } catch (e) {
        console.error(e);
        this.ui.loading(false);
        this.ui.toast(`「${f.name}」を読み込めませんでした`, true);
      }
    }
  }

  setLyricsText(text, filename = '') {
    if (!this.song) { this.ui.toast('先に曲を選んでください', true); return; }
    const lines = parseLyrics(text, this.song);
    if (!lines.length) { this.ui.toast('歌詞を読み取れませんでした', true); return; }
    this.songs[this.current].lyricsOverride = lines;
    this.lyrics.setLyrics(lines);
    this.rebuildChoreo();
    this.ui.toast(`歌詞を ${lines.length} 行読み込みました${filename ? '(' + filename + ')' : ''}`);
  }

  // ---------------- キャラ ----------------
  async loadVRMFile(file) {
    try {
      this.ui.loading('VRMを読み込んでいます…', 0.2);
      const buf = await file.arrayBuffer();
      this.charId = null; this.ui.onCharacter(null);
      const name = await this.useVRMBuffer(buf, file.name.replace(/\.vrm$/i, ''), true);
      this.ui.loading(false);
      this.ui.toast(`「${name}」がステージに立ちました！`);
    } catch (e) {
      console.error(e);
      this.ui.loading(false);
      this.ui.toast('VRMを読み込めませんでした: ' + e.message, true);
    }
  }

  async useVRMBuffer(buf, fallbackName, showProgress = false, displayName = null, token = (this._vrmToken = (this._vrmToken || 0) + 1)) {
    const vrm = await loadVRMFromBuffer(buf.slice(0));
    if (token !== this._vrmToken) return null; // 途中で別のキャラが選ばれた
    this.main.useVRM(vrm);
    this.vrmBuffer = buf;
    this.stage.charLight = 0.3;
    const name = vrm.meta?.name || vrm.meta?.title || fallbackName;
    this.ui.setCharaName(displayName || name);
    if (showProgress) this.ui.loading('バックダンサーを色違いで作っています…', 0.6);
    await this.updateBackDancers(true, token);
    return displayName || name;
  }

  // キャラ選択(CHARACTERS の id)。選んだキャラは次回も使う
  async selectCharacter(id, showProgress = true) {
    const c = CHARACTERS.find((x) => x.id === id) || CHARACTERS[0];
    this.charId = c.id;
    try { localStorage.setItem('lumina.chara', c.id); } catch (e) { /* */ }
    this.ui.onCharacter(c.id);
    if (c.mannequin) { await this.useMannequin(); return; }
    const token = (this._vrmToken = (this._vrmToken || 0) + 1);
    try {
      if (showProgress) this.ui.loading(`「${c.name}」を読み込んでいます…`, 0.15);
      this._charBufs ||= {};
      if (!this._charBufs[c.id]) {
        const res = await fetch('./models/' + c.file);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        this._charBufs[c.id] = await res.arrayBuffer();
      }
      if (token !== this._vrmToken) return;
      if (showProgress) this.ui.loading(null, 0.4);
      await this.useVRMBuffer(this._charBufs[c.id], c.name, showProgress, c.name, token);
      if (showProgress && token === this._vrmToken) this.ui.toast(`「${c.name}」がステージに立ちました！`);
    } catch (e) {
      console.warn(e);
      if (token === this._vrmToken) { this.ui.toast(`「${c.name}」を読み込めませんでした`, true); if (!this.main.rig) await this.useMannequin(); }
    } finally {
      if (showProgress && token === this._vrmToken) this.ui.loading(false);
    }
  }
  loadDefaultVRM(showProgress = false) { return this.selectCharacter('default', showProgress); }

  async useMannequin() {
    this._vrmToken = (this._vrmToken || 0) + 1;
    this.vrmBuffer = null;
    this.stage.charLight = 1;
    this.main.useMannequin(...ACCENTS[0]);
    this.ui.setCharaName('ロボット風キャラ「ルミナ」');
    await this.updateBackDancers(true);
  }

  async fetchCharBuf(c) {
    this._charBufs ||= {};
    if (!this._charBufs[c.id]) {
      const res = await fetch('./models/' + c.file);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      this._charBufs[c.id] = await res.arrayBuffer();
    }
    return this._charBufs[c.id];
  }

  // バックダンサー1人分を作る。choice: 'auto'=メインの色違い / キャラid
  async buildBack(i) {
    const d = new Dancer({ isMain: false });
    d.group.position.set(BACK_POS[i][0], STAGE_H, BACK_POS[i][1]);
    const choice = this.backChoices[i] || 'auto';
    const c = choice === 'auto' ? null : CHARACTERS.find((x) => x.id === choice);
    if (!c) {
      if (this.vrmBuffer) {
        const vrm = await loadVRMFromBuffer(this.vrmBuffer.slice(0));
        recolorVRM(vrm, BACK_HUES[i]);
        d.useVRM(vrm);
      } else d.useMannequin(...ACCENTS[(i + 1) % ACCENTS.length]);
    } else if (c.mannequin) {
      d.useMannequin(...ACCENTS[(i + 1) % ACCENTS.length]);
    } else {
      const vrm = await loadVRMFromBuffer((await this.fetchCharBuf(c)).slice(0));
      d.useVRM(vrm);
    }
    d.choice = choice;
    return d;
  }

  removeBack(i) {
    const b = this.backs[i];
    if (b) { b.clear(); this.scene.remove(b.group); }
    this.backs[i] = null;
  }

  // メインが変わったとき(rebuild): 「色違い」の人だけ作り直す
  async updateBackDancers(rebuild = false, token = this._vrmToken) {
    this._backTok ||= [];
    for (let i = this.backCount; i < 4; i++) this.removeBack(i);
    this.backs.length = this.backCount;
    for (let i = 0; i < this.backCount; i++) {
      const cur = this.backs[i];
      const want = this.backChoices[i] || 'auto';
      const needs = !cur || cur.choice !== want || (rebuild && want === 'auto');
      if (!needs) continue;
      const tok = (this._backTok[i] = (this._backTok[i] || 0) + 1);
      let d;
      try { d = await this.buildBack(i); } catch (e) { console.warn(e); continue; }
      if (token !== this._vrmToken || tok !== this._backTok[i] || i >= this.backCount) { d.clear(); return; }
      this.removeBack(i);
      this.scene.add(d.group);
      this.backs[i] = d;
    }
    this.director.hasGroup = this.backCount > 0;
  }
  async setBackCount(n) {
    this.backCount = n;
    try { localStorage.setItem('lumina.backCount', String(n)); } catch (e) { /* */ }
    this.ui.loading(n > this.backs.filter(Boolean).length ? 'バックダンサーを用意しています…' : false, 0.5);
    await this.updateBackDancers();
    this.ui.loading(false);
  }
  async setBackChoice(i, id) {
    this.backChoices[i] = id;
    try { localStorage.setItem('lumina.backs', JSON.stringify(this.backChoices)); } catch (e) { /* */ }
    this.ui.renderBackSlots();
    if (i >= this.backCount) return;
    const name = id === 'auto' ? 'メインの色違い' : (CHARACTERS.find((x) => x.id === id)?.name || id);
    this.ui.loading(`バックダンサー${i + 1}を「${name}」にしています…`, 0.5);
    await this.updateBackDancers();
    this.ui.loading(false);
  }

  // ---------------- 再生 ----------------
  async togglePlay() {
    if (!this.started) return this.start();
    if (!this.song) return this.selectSong(0);
    if (this.audio.playing) this.audio.pause(); else { clearTimeout(this.endTimer); await this.audio.play(); }
    this.ui.onPlayState();
  }
  seek(t) { this.audio.seek(t); this.lyrics.reset(); this.stage.lastSection = -1; }
  next() { this.selectSong((this.current + 1) % this.songs.length); }
  prev() { if (this.audio.currentTime > 4) this.seek(0); else this.selectSong((this.current - 1 + this.songs.length) % this.songs.length); }

  // ---------------- 音ゲー ----------------
  async startGame(diff) {
    if (!this.song) await this.selectSong(Math.max(0, this.current));
    clearTimeout(this.endTimer);
    this.audio.pause();
    this.audio.seek(0);
    this.lyrics.reset();
    this.stage.lastSection = -1;
    this.game.start(this.song, diff);
    if (this.camMode === 'free') this.setCamMode('auto');
    await this.audio.play();
    this.ui.onPlayState();
  }
  quitGame() {
    this.game.stop();
    document.getElementById('gameResult').classList.add('hidden');
  }
  playTick(lane) {
    const ctx = this.audio.ctx; if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.value = [880, 1046, 1318, 1568][lane] || 1000;
    g.gain.setValueAtTime(0.08, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.09);
  }

  onSongEnd() {
    this.stage.finale();
    this.ui.onPlayState();
    if (this.game.active) {
      const r = this.game.result();
      this.game.finished = true;
      setTimeout(() => { this.game.stop(); this.ui.showResult(r, this.song.title); }, 2500);
      return;
    }
    if (this.recorder) { setTimeout(() => this.stopRecording(), 4500); return; }
    if (this.ui.autoNext()) this.endTimer = setTimeout(() => this.next(), 9000);
  }

  // ---------------- 録画 ----------------
  async toggleRecording() {
    if (this.recorder) { this.stopRecording(); return; }
    if (!this.song) return;
    const stream = this.canvas.captureStream(60);
    this.audio.ensure();
    for (const tr of this.audio.streamDest.stream.getAudioTracks()) stream.addTrack(tr);
    const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
    const mime = types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
    if (!mime) { this.ui.toast('このブラウザは録画に対応していません', true); return; }
    this.recChunks = [];
    this.recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 16_000_000 });
    this.recorder.ondataavailable = (e) => e.data.size && this.recChunks.push(e.data);
    this.recorder.onstop = () => {
      const blob = new Blob(this.recChunks, { type: mime });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${this.song.title}_ライブ.${mime.includes('mp4') ? 'mp4' : 'webm'}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      this.ui.toast('録画したライブ動画を保存しました');
    };
    this.audio.seek(0);
    this.lyrics.reset();
    this.recorder.start(1000);
    await this.audio.play();
    this.ui.onRecording(true);
    this.ui.onPlayState();
    this.ui.toast('録画中… 曲の最後まで再生すると自動で保存します');
  }
  stopRecording() {
    if (!this.recorder) return;
    this.recorder.stop();
    this.recorder = null;
    this.ui.onRecording(false);
  }

  // ---------------- 表示 ----------------
  setCamMode(m) {
    this.camMode = m;
    this.controls.enabled = m === 'free';
    if (m === 'free') {
      const d = this.main.group.position;
      this.controls.target.set(d.x, STAGE_H + 1.1, d.z);
    }
    if (m !== 'fixed') this.director.manualShot = null;
    if (m === 'fixed' && !this.director.manualShot) this.director.forceShot('full');
    if (m === 'auto') this.director.shotStartBeat = -999;
    this.ui.onCamMode();
  }
  pickShot(name) { this.camMode = 'fixed'; this.controls.enabled = false; this.director.forceShot(name); this.ui.onCamMode(); }

  // 端末に合わせた最初の画質: スマホ=低、内蔵GPU=中、専用GPU=高
  autoQuality() {
    if (IS_MOBILE) return 'low';
    let gpu = '';
    try {
      const gl = this.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    } catch (e) { /* */ }
    if (/RTX|GTX|Radeon RX|Radeon Pro|Arc A|Apple M[1-9]/i.test(gpu)) return 'high';
    return 'medium';
  }

  setQuality(q) {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    const pr = q === 'high' ? Math.min(dpr, 1.75) : q === 'medium' ? Math.min(dpr, 1.0) : Math.min(dpr, IS_MOBILE ? 0.75 : 0.85);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.post.setQuality(q);
    this.post.setPixelRatio(pr);
    this.post.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = q !== 'low';
    this.stage.setQuality(q);
    this.lyrics.lite = q === 'low';
    this.ui.onQuality();
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.post.setSize(w, h);
  }

  makeTitleTexture(title, sub) {
    const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 533;
    const g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    let size = 150;
    g.font = `900 ${size}px ${LYRIC_FONT}`;
    while (g.measureText(title).width > 1150 && size > 40) { size -= 6; g.font = `900 ${size}px ${LYRIC_FONT}`; }
    g.shadowColor = 'rgba(255,255,255,0.8)'; g.shadowBlur = 30;
    g.fillStyle = '#ffffff';
    g.fillText(title, 640, 240);
    g.shadowBlur = 0;
    g.font = `700 52px ${LYRIC_FONT}`;
    g.fillStyle = 'rgba(255,230,250,0.9)';
    g.fillText(sub, 640, 390);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  sectionAt(beat) {
    const s = this.song?.sections || [];
    for (let i = 0; i < s.length; i++) if (beat >= s[i].startBeat && beat < s[i].endBeat) return i;
    return beat < (s[0]?.startBeat ?? 0) ? 0 : s.length - 1;
  }

  energyAtTime(t) {
    if (!this.song) return 0;
    const b = timeToBeat(this.song.beats, t);
    const i = this.sectionAt(b);
    return this.song.sections[i]?.energy ?? 0;
  }

  // ---------------- 毎フレーム ----------------
  loop(now) {
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, Math.max(0.0001, (now - this.lastT) / 1000));
    this.lastT = now;
    this.frames++; this.fpsTime += dt;
    if (this.fpsTime > 0.5) {
      const fps = this.frames / this.fpsTime;
      this.ui.setFps(Math.round(fps));
      // 重いときは自動で画質を下げる(再生中・画面表示中のみ)
      if (this.audio.playing && !document.hidden && !this.manualQuality) {
        this.slowCount = fps < 38 ? (this.slowCount || 0) + 1 : 0;
        if (this.slowCount >= 6 && this.quality !== 'low') {
          this.slowCount = 0;
          this.setQuality(this.quality === 'high' ? 'medium' : 'low');
          this.ui.toast(`動きをなめらかにするため画質を「${this.quality === 'medium' ? '中' : '低'}」にしました(設定パネルで変更できます)`);
        }
      }
      this.frames = 0; this.fpsTime = 0;
    }

    const levels = this.audio.update(dt);
    const song = this.song;
    const playing = this.audio.playing;
    const t = this.audio.currentTime;
    let beat, secIdx = -1, sec = null, nextSec = null, beatsToNext = null;
    const active = song && (playing || t > 0.01);
    if (active) {
      beat = timeToBeat(song.beats, t);
      secIdx = this.sectionAt(beat);
      sec = song.sections[secIdx];
      nextSec = song.sections[secIdx + 1] || null;
      beatsToNext = nextSec ? nextSec.startBeat - beat : null;
    } else {
      this.idleBeat += dt * (100 / 60);
      beat = this.idleBeat;
    }
    const ended = song && !playing && t >= this.audio.duration - 0.06;
    const targetE = active && (playing || ended) ? (sec ? sec.energy : 0) : 0;
    this.energy += (targetE - this.energy) * (1 - Math.exp(-dt * 2.5));

    // ---- 振り付け ----
    const pose = this.pose;
    let entry = null;
    if (active && this.choreo) {
      const r = this.choreo.sample(beat, pose, { e: 0.6, boost: levels.kick * 0.1 });
      entry = r.entry;
      if (!playing && !ended) { pose.cp += Math.sin(now / 600) * 0.01; }
    } else this.idleChoreo.sample(beat, pose);
    // 本物のダンスを重ねる(表情は手作りの振りから)
    const useMocap = this.danceMode === 'mocap' && this.danceLib;
    pose.mocap = null;
    if (useMocap) {
      let me = null;
      if (active && this.mocapChoreo) me = this.mocapChoreo.sample(beat, this.mocapFrame);
      else this.idleMocap.sample(beat, this.mocapFrame);
      pose.mocap = this.mocapFrame;
      if (me) entry = { move: { name: this.danceLib.genres[me.clip.genre] || me.clip.genre } };
    }

    // 歌っているか
    let singing = 0;
    if (active && playing) {
      const cur = this.lyrics.current(t);
      if (this.lyrics.lines.length) singing = cur ? 1 : 0; else singing = sec && sec.energy >= 1 ? 0.7 : 0.2;
    }
    const mainPos = this.main.group.position;
    // キャラ用の照明: VRM(MToon)は明るく出るので弱める。ロボットとVRMが混ざるときは中間
    this.stage.charLight = this.main.vrm ? 0.3 : this.backs.some((x) => x && x.vrm) ? 0.55 : 1;
    this.main.update(dt, pose, this.camera, levels, { singing, lookAtCamera: true });
    for (let i = 0; i < this.backs.length; i++) {
      const bd = this.backs[i];
      if (!bd) continue;
      if (active && this.choreo) this.choreo.sample(beat - 0.03 * (i + 1), this.backPose, { e: 0.6 });
      else this.idleChoreo.sample(beat + i * 0.5, this.backPose);
      const left = BACK_POS[i][0] < 0;
      const mir = this.mirrorBack && left;
      let p;
      if (useMocap) {
        const f = this.backFrames[i];
        if (active && this.mocapChoreo) this.mocapChoreo.sample(beat - 0.03 * (i + 1), f, mir);
        else this.idleMocap.sample(beat + i * 0.5, f, mir);
        this.backPose.mocap = f;
        p = this.backPose;
      } else { this.backPose.mocap = null; p = mir ? mirrorPose(this.backPose) : this.backPose; }
      bd.update(dt, p, this.camera, levels, { singing: 0, lookAtCamera: false });
    }

    // ---- カメラ ----
    const head = this.main.rig.getHeadWorld(new THREE.Vector3());
    const chest = this.main.rig.getChestWorld(new THREE.Vector3());
    const info = { H: STAGE_H, d: mainPos.clone(), head, chest, time: now / 1000, downbeatOffset: song?.firstDownbeat || 0 };
    if (this.camMode === 'free') this.controls.update();
    else {
      const e = active ? this.energy : 0;
      const cut = this.director.update(dt, { beat, energy: e, sectionIdx: active ? secIdx : -1, section: active ? sec : null, info });
      if (cut) this.ui.onShot(this.director.shot);
    }
    this.feedDirector.update(dt, beat, info);

    // ---- ステージ ----
    this.stage.dancerPos.copy(mainPos);
    const lastChorus = song ? song.sections.reduce((m, s, i) => (s.energy >= 3 ? i : m), -1) : -1;
    this.stage.update(dt, {
      beat, energy: this.energy, section: active ? sec : { energy: 0, label: '' }, sectionIdx: active ? secIdx : 0,
      nextSection: active ? nextSec : null, beatsToNext, levels, playing: playing || false,
      feedTexture: this.feedRT.texture, feedOn: this.feedOn,
      showTitle: !playing || t < 6,
      isLastChorus: secIdx === lastChorus,
      prevEnergy: secIdx > 0 && song ? song.sections[secIdx - 1].energy : 0,
    });

    // ---- 歌詞 ----
    this.lyrics.mode = this.lyricMode === '3d' || this.lyricMode === 'both' ? '3d' : 'off';
    this.lyrics.update(t, this.camera, { dancer: mainPos, palette: this.stage.palette, energyAt: (x) => this.energyAtTime(x), H: STAGE_H });
    this.ui.updateSubtitle(active ? t : -1, this.stage.palette[0]);

    // ---- 描画 ----
    this._feedTick = (this._feedTick || 0) + 1;
    this.renderer.shadowMap.needsUpdate = true;
    // スクリーン用のライブ映像: 高=2フレームに1回、中=3フレームに1回、低=なし
    const feedEvery = this.quality === 'high' ? 2 : this.quality === 'medium' ? 3 : 0;
    if (this.feedOn && feedEvery && this._feedTick % feedEvery === 0) {
      const rv = this.stage.reflector.visible, cv = this.stage.crowd.group.visible, hv = this.stage.haze.points.visible;
      this.stage.reflector.visible = false;
      this.stage.crowd.group.visible = false;
      this.stage.haze.points.visible = false;
      this.lyrics.group.visible = false;
      this.renderer.setRenderTarget(this.feedRT);
      this.renderer.render(this.scene, this.feedCam);
      this.renderer.setRenderTarget(null);
      this.stage.reflector.visible = rv;
      this.stage.crowd.group.visible = cv;
      this.stage.haze.points.visible = hv;
      this.lyrics.group.visible = true;
    }
    const fb = ((beat % 1) + 1) % 1;
    this.post.render(dt, { kick: Math.exp(-fb * 6) * (playing ? 1 : 0), energy: this.energy });

    this.game.update(dt);
    this.ui.update(t, entry, sec);
  }
}

window.app = new App();

