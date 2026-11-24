// 選べるキャラ(すべて再配布・改変・商用利用OK、クレジット不要)
// default: pixiv の VRM 1.0 サンプル(VRM Public License 1.0)
// それ以外: VRoid Studio 旧ベータ版の CC0 サンプルモデル(pixiv / VRoidプロジェクト)
export const CHARACTERS = [
  { id: 'tame', name: 'ため', sub: 'オリジナル', file: 'my_model.vrm' },
  { id: 'default', name: '標準キャラ', sub: 'pixiv サンプル', file: 'default.vrm' },
  { id: 'shibu', name: '千駄ヶ谷 渋', sub: 'VRoid サンプル', file: 'vroid_d.vrm', thumb: 'vroid_d.jpg' },
  { id: 'shibu_dark', name: '渋(ダーク)', sub: 'VRoid サンプル', file: 'vroid_d_dark.vrm', thumb: 'vroid_d_dark.jpg' },
  { id: 'vivi', name: 'ビビ', sub: 'VRoid サンプル', file: 'vroid_e.vrm', thumb: 'vroid_e.jpg' },
  { id: 'vita', name: 'ヴィータ', sub: 'VRoid サンプル', file: 'vroid_f.vrm', thumb: 'vroid_f.jpg' },
  { id: 'victoria', name: 'ヴィクトリア', sub: 'VRoid サンプル', file: 'vroid_g.vrm', thumb: 'vroid_g.jpg' },
  { id: 'shino', name: '千駄ヶ谷 篠', sub: 'VRoid サンプル', file: 'shino.vrm', thumb: 'shino.jpg' },
  { id: 'fumiriya', name: '桜田 史利矢', sub: 'VRoid サンプル', file: 'sakurada.vrm', thumb: 'sakurada.jpg' },
  { id: 'lumina', name: 'ルミナ', sub: 'ロボット風', mannequin: true },
].map((c) => ({ ...c, thumb: c.mannequin ? null : `./models/thumbs/${c.thumb || c.file.replace('.vrm', '.jpg')}` }));
