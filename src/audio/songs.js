// 内蔵デモ曲(このアプリ用に書いたオリジナル曲と歌詞)

export const DEMO_SONGS = [
  {
    id: 'neon',
    title: 'ネオン・ホライズン',
    artist: 'LUMINA STAGE オリジナル',
    bpm: 128,
    key: 57, // A
    mode: 'minor',
    progression: [0, 5, 2, 6], // Am F C G
    seed: 1287,
    style: 'cool',
    palette: { hues: [0.53, 0.83, 0.62], name: 'サイバー' },
    structure: [
      { label: 'イントロ', energy: 0, bars: 8, arp: true, filter: [400, 6000], hatsSoft: true },
      { label: 'Aメロ', energy: 1, bars: 16, melody: 'verse' },
      { label: 'Bメロ', energy: 2, bars: 8, melody: 'pre', build: true, riser: 2 },
      { label: 'サビ', energy: 3, bars: 16, melody: 'chorus' },
      { label: '間奏', energy: 0, bars: 8, arp: true, bells: true, filter: [900, 9000], kick: false },
      { label: 'Aメロ2', energy: 1, bars: 8, melody: 'verse' },
      { label: 'Bメロ2', energy: 2, bars: 8, melody: 'pre', build: true, riser: 2 },
      { label: 'ラストサビ', energy: 3, bars: 16, melody: 'chorus' },
      { label: 'アウトロ', energy: 1, bars: 8, arp: true, filter: [9000, 500], fill: false },
    ],
    lyrics: {
      verse: [
        '夜をつらぬく ネオンの川',
        '鼓動がリズムを 刻みだす',
        'ひとりじゃないと 気づいたなら',
        'その手をのばして 光のほうへ',
        'ざわめく街の 地図をぬけて',
        'まだ見ぬ朝を さがしにいこう',
      ],
      pre: [
        'カウントダウン 胸が鳴る',
        'いま 扉がひらく',
      ],
      chorus: [
        'ネオン・ホライズン 夜明けまで',
        '踊りつづけよう 君とふたり',
        'ネオン・ホライズン 声をあげて',
        'この瞬間を 永遠にしよう',
      ],
    },
  },
  {
    id: 'sakura',
    title: 'さくらドライブ',
    artist: 'LUMINA STAGE オリジナル',
    bpm: 116,
    key: 50, // D
    mode: 'major',
    progression: [0, 4, 5, 3], // D A Bm G
    seed: 4242,
    swing: 0.12,
    hat16: true,
    bassStyle: 'funk',
    seventh: true,
    style: 'cute',
    stabPattern: [0, 1.5, 2, 3.5],
    palette: { hues: [0.92, 0.12, 0.55], name: 'さくら' },
    structure: [
      { label: 'イントロ', energy: 1, bars: 8, bells: true, filter: [700, 14000] },
      { label: 'Aメロ', energy: 1, bars: 16, melody: 'verse' },
      { label: 'Bメロ', energy: 2, bars: 8, melody: 'pre', riser: 1 },
      { label: 'サビ', energy: 3, bars: 16, melody: 'chorus' },
      { label: '間奏', energy: 2, bars: 8, arp: true, bells: true },
      { label: 'Bメロ2', energy: 2, bars: 8, melody: 'pre', build: true, riser: 2 },
      { label: 'ラストサビ', energy: 3, bars: 16, melody: 'chorus' },
      { label: 'アウトロ', energy: 1, bars: 8, bells: true, filter: [12000, 700], fill: false },
    ],
    lyrics: {
      verse: [
        '窓をあけたら 春のにおい',
        'イヤホンの中 はずむメロディ',
        '信号待ちも なんだか楽しい',
        'となりで君が 笑ってるから',
      ],
      pre: [
        'ねえ どこまでも行けそうだね',
        'アクセル ふみこんで',
      ],
      chorus: [
        'さくらドライブ 花びらの道',
        'ハートのビート 止まらない',
        'さくらドライブ 手をふって',
        'きらめく今日を つかまえよう',
      ],
    },
  },
  {
    id: 'moon',
    title: '月あかりのステップ',
    artist: 'LUMINA STAGE オリジナル',
    bpm: 88,
    key: 52, // E
    mode: 'minor',
    progression: [0, 5, 3, 4], // Em C Am B(m)
    seed: 777,
    halftime: true,
    seventh: true,
    arp: true,
    style: 'elegant',
    stabPattern: [0, 2],
    palette: { hues: [0.62, 0.72, 0.08], name: 'ムーンライト' },
    structure: [
      { label: 'イントロ', energy: 0, bars: 4, bells: true, arp: true },
      { label: 'Aメロ', energy: 0, bars: 8, melody: 'verse', arp: true, bass: true },
      { label: 'Aメロ\'', energy: 1, bars: 8, melody: 'verse' },
      { label: 'サビ', energy: 2, bars: 8, melody: 'chorus', arp: true },
      { label: '間奏', energy: 1, bars: 4, bells: true },
      { label: 'Bメロ', energy: 2, bars: 4, melody: 'pre', build: true, riser: 1 },
      { label: 'ラストサビ', energy: 3, bars: 8, melody: 'chorus' },
      { label: 'アウトロ', energy: 0, bars: 4, bells: true, arp: true, filter: [8000, 600] },
    ],
    lyrics: {
      verse: [
        'しずかな夜に 月がのぼる',
        '影がふたつ 重なってゆく',
        'ことばにできない 想いのかけら',
        'ステップにのせて 君に送るよ',
      ],
      pre: [
        'ほどけた心 いま空へ',
      ],
      chorus: [
        '月あかりの下で 踊ろう',
        'この夜が 明けるまで',
        'ゆれる光が ほら 道になる',
        'わすれないで 今日のこと',
      ],
    },
  },
];
