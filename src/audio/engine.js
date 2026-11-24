// 再生・一時停止・シーク・リアルタイム周波数解析
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.buffer = null;
    this.source = null;
    this.playing = false;
    this.offset = 0; // 一時停止位置
    this.startedAt = 0;
    this.volume = 0.85;
    this.levels = { bass: 0, mid: 0, high: 0, vocal: 0, total: 0, kick: 0 };
    this._prevBass = 0;
    this.onEnded = null;
  }

  ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.gain = this.ctx.createGain();
    this.gain.gain.value = this.volume;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.6;
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    this.gain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    this.streamDest = this.ctx.createMediaStreamDestination();
    this.gain.connect(this.streamDest);
    return this.ctx;
  }

  async decode(arrayBuffer) {
    this.ensure();
    return await this.ctx.decodeAudioData(arrayBuffer);
  }

  setBuffer(buffer) {
    this.stop();
    this.buffer = buffer;
    this.offset = 0;
  }

  get duration() { return this.buffer ? this.buffer.duration : 0; }

  get currentTime() {
    if (!this.buffer) return 0;
    if (!this.playing) return this.offset;
    // 出力遅延ぶんを差し引いて映像と音を合わせる
    const lat = (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0);
    return Math.max(0, this.ctx.currentTime - this.startedAt - lat * 0.5);
  }

  async play() {
    if (!this.buffer) return;
    this.ensure();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    if (this.playing) return;
    if (this.offset >= this.buffer.duration - 0.05) this.offset = 0;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.gain);
    src.onended = () => {
      if (this.source !== src) return;
      this.playing = false;
      this.offset = this.buffer.duration;
      this.source = null;
      this.onEnded && this.onEnded();
    };
    this.startedAt = this.ctx.currentTime - this.offset;
    src.start(0, this.offset);
    this.source = src;
    this.playing = true;
  }

  pause() {
    if (!this.playing) return;
    this.offset = this.currentTime;
    this.stop(true);
  }

  stop(keepOffset = false) {
    if (this.source) {
      const s = this.source; this.source = null;
      try { s.stop(); } catch (e) { /* */ }
    }
    this.playing = false;
    if (!keepOffset) this.offset = 0;
  }

  seek(t) {
    const was = this.playing;
    this.stop(true);
    this.offset = Math.max(0, Math.min(this.duration - 0.01, t));
    if (was) this.play();
  }

  setVolume(v) {
    this.volume = v;
    if (this.gain) this.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  // 毎フレーム呼ぶ: 帯域ごとの音量(0..1)
  update(dt) {
    const L = this.levels;
    if (!this.analyser || !this.playing) {
      for (const k in L) L[k] *= Math.pow(0.02, dt);
      return L;
    }
    this.analyser.getByteFrequencyData(this.freq);
    const binHz = this.ctx.sampleRate / this.analyser.fftSize;
    const avg = (lo, hi) => {
      const a = Math.max(1, Math.floor(lo / binHz)), b = Math.max(a + 1, Math.floor(hi / binHz));
      let s = 0; for (let i = a; i < b; i++) s += this.freq[i];
      return s / (b - a) / 255;
    };
    const bass = avg(30, 140), mid = avg(300, 2000), high = avg(5000, 14000), vocal = avg(500, 3000);
    const sm = (k, v, up = 0.5, down = 0.12) => { L[k] += (v - L[k]) * (v > L[k] ? up : down); };
    sm('bass', bass); sm('mid', mid); sm('high', high, 0.6, 0.2); sm('vocal', vocal, 0.5, 0.25);
    sm('total', (bass + mid + high) / 3);
    const kick = Math.max(0, bass - this._prevBass) * 4;
    this._prevBass = bass;
    L.kick = Math.max(L.kick * Math.pow(0.001, dt), Math.min(1, kick));
    return L;
  }
}
