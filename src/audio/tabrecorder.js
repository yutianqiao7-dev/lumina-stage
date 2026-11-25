// ほかのタブ(Suno など)で流している音を録音して、曲として取り込む
// Chrome / Edge の「画面共有 → タブの音声を共有」を使う
export class TabRecorder {
  constructor() {
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
    this.level = 0;
    this.heard = false;
    this.silentFor = 0;
    this.elapsed = 0;
    this.label = '';
  }

  static supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia && window.MediaRecorder);
  }

  // 共有するタブを選んでもらい、録音を始める
  async start({ onTick, onAutoStop } = {}) {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true, // 仕様上 映像も必要(すぐ止める)
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      preferCurrentTab: false, selfBrowserSurface: 'exclude', systemAudio: 'include', surfaceSwitching: 'include',
    });
    const audioTracks = stream.getAudioTracks();
    const videoTrack = stream.getVideoTracks()[0];
    this.label = videoTrack ? videoTrack.label || '' : '';
    if (!audioTracks.length) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('NO_AUDIO');
    }
    if (videoTrack) videoTrack.stop();
    this.stream = new MediaStream(audioTracks);
    // 音量メーター
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    src.connect(this.analyser);
    const buf = new Float32Array(this.analyser.fftSize);
    // 録音
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    const mime = types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
    this.recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime, audioBitsPerSecond: 256000 } : undefined);
    this.mime = this.recorder.mimeType || mime;
    this.chunks = [];
    this.recorder.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.done = new Promise((resolve) => { this.recorder.onstop = () => resolve(); });
    this.recorder.start(500);
    this.heard = false; this.silentFor = 0; this.elapsed = 0;
    audioTracks[0].addEventListener('ended', () => this.stop());
    let last = performance.now();
    this.timer = setInterval(() => {
      const now = performance.now(), dt = (now - last) / 1000; last = now;
      this.elapsed += dt;
      this.analyser.getFloatTimeDomainData(buf);
      let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
      const rms = Math.sqrt(s / buf.length);
      this.level = Math.min(1, rms * 6);
      if (rms > 0.01) { this.heard = true; this.silentFor = 0; } else if (this.heard) this.silentFor += dt;
      onTick && onTick(this);
      // 曲が始まってから 4秒 無音が続いたら、曲が終わったとみなして自動で止める
      if (this.heard && this.silentFor > 4 && this.elapsed > 10) { onAutoStop && onAutoStop(); this.stop(); }
    }, 100);
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.ctx) { this.ctx.close().catch(() => {}); this.ctx = null; }
  }

  cancel() { this.stop(); this.chunks = []; this.cancelled = true; }

  // 録音を AudioBuffer にする(前後の無音は切る)
  async toAudioBuffer(decodeCtx) {
    await this.done;
    if (this.cancelled || !this.chunks.length) return null;
    const blob = new Blob(this.chunks, { type: this.mime || 'audio/webm' });
    const ab = await blob.arrayBuffer();
    const audio = await decodeCtx.decodeAudioData(ab);
    return trimSilence(decodeCtx, audio);
  }
}

function trimSilence(ctx, audio, threshold = 0.004, pad = 0.25) {
  const n = audio.length, ch = audio.numberOfChannels, sr = audio.sampleRate;
  const data = [];
  for (let c = 0; c < ch; c++) data.push(audio.getChannelData(c));
  const loud = (i) => { for (let c = 0; c < ch; c++) if (Math.abs(data[c][i]) > threshold) return true; return false; };
  let a = 0, b = n - 1;
  while (a < n && !loud(a)) a++;
  while (b > a && !loud(b)) b--;
  if (b - a < sr * 5) return audio; // ほぼ無音なら何もしない
  a = Math.max(0, a - Math.floor(pad * sr));
  b = Math.min(n - 1, b + Math.floor(pad * 2 * sr));
  const out = ctx.createBuffer(ch, b - a + 1, sr);
  for (let c = 0; c < ch; c++) out.copyToChannel(data[c].subarray(a, b + 1), c);
  return out;
}
