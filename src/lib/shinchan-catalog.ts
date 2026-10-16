import type { SearchResult } from './types';

export interface ShinchanMovie {
  year: number;
  title: string;
  aliases: string[];
}

// Release years checked against https://www.shinchan-app.jp/about/index.php.
// Localized titles are aliases, not separate movies. 2023 includes the 3DCG film.
export const SHINCHAN_MOVIES: ShinchanMovie[] = [
  {
    year: 1993,
    title: '动感超人大战泳装魔王',
    aliases: [
      '动感超人大战高衩魔王',
      '动感超人大战高叉魔王',
      'アクション仮面VSハイグレ魔王',
    ],
  },
  {
    year: 1994,
    title: '布里布里王国的宝藏',
    aliases: [
      '卟哩卟哩王国的秘密宝藏',
      '不理不理王国的秘宝',
      'ブリブリ王国の秘宝',
    ],
  },
  {
    year: 1995,
    title: '云黑斋的野心',
    aliases: ['云黑斋的野望', '雲黒斎の野望'],
  },
  {
    year: 1996,
    title: '奇异乐园大冒险',
    aliases: ['搞怪游乐园大冒险', 'ヘンダーランドの大冒険'],
  },
  {
    year: 1997,
    title: '黑暗珠珠大追击',
    aliases: ['黑暗珠珠大追逐', '暗黒タマタマ大追跡'],
  },
  {
    year: 1998,
    title: '电击！猪之蹄大作战',
    aliases: ['电击猪蹄大作战', '電撃ブタのヒヅメ大作戦'],
  },
  {
    year: 1999,
    title: '爆发！温泉火热大决战',
    aliases: ['温泉激烈大决战', '爆発温泉わくわく大決戦'],
  },
  {
    year: 2000,
    title: '呼风唤雨的热带雨林',
    aliases: ['森林里的暴风雨', '风起云涌的丛林冒险', '嵐を呼ぶジャングル'],
  },
  {
    year: 2001,
    title: '呼风唤雨！猛烈！大人帝国的反击',
    aliases: ['大人帝国的反击', '大人帝国反击战', 'オトナ帝国の逆襲'],
  },
  {
    year: 2002,
    title: '呼风唤雨！战国大合战',
    aliases: ['战国大合战', '戦国大合戦'],
  },
  {
    year: 2003,
    title: '呼风唤雨！光荣的烤肉之路',
    aliases: ['光荣的烤肉之路', '光荣烧肉之路', '栄光のヤキニクロード'],
  },
  {
    year: 2004,
    title: '呼风唤雨！夕阳下的春日部男孩',
    aliases: [
      '夕阳下的春日部男孩',
      '夕阳下的春日部男孩们',
      '夕陽のカスカベボーイズ',
    ],
  },
  {
    year: 2005,
    title: '呼唤传说！三分钟嘎巴大进攻',
    aliases: [
      '三分钟嘎巴大进攻',
      '3分钟百变大进击',
      '三分钟百变大进击',
      'ブリブリ3分ポッキリ大進撃',
    ],
  },
  {
    year: 2006,
    title: '呼唤传说！跳吧！朋友！',
    aliases: ['跳吧朋友', '跳舞吧朋友', '风起云涌跳舞吧', '踊れアミーゴ'],
  },
  {
    year: 2007,
    title: '呼风唤雨！会唱歌的屁股炸弹',
    aliases: ['会唱歌的屁股炸弹', '唱歌的光屁股炸弹', '歌うケツだけ爆弾'],
  },
  {
    year: 2008,
    title: '呼风唤雨！金矛之勇者',
    aliases: ['金矛之勇者', '金剑传说', '金矛の勇者'],
  },
  {
    year: 2009,
    title: '呐喊！春日部野生王国',
    aliases: ['春日部野生王国', '春日部野生王国大冒险', 'カスカベ野生王国'],
  },
  {
    year: 2010,
    title: '超时空！呼风唤雨的我的新娘',
    aliases: [
      '呼风唤雨的我的新娘',
      '超时空新娘',
      '我的超时空新娘',
      'オラの花嫁',
    ],
  },
  {
    year: 2011,
    title: '呼风唤雨！黄金的间谍大作战',
    aliases: ['黄金的间谍大作战', '黄金间谍大作战', '黄金のスパイ大作戦'],
  },
  {
    year: 2012,
    title: '呼风唤雨！我与宇宙公主',
    aliases: [
      '我的宇宙公主',
      '我和宇宙公主',
      '我与宇宙公主',
      'オラと宇宙のプリンセス',
    ],
  },
  {
    year: 2013,
    title: '超级美味！B级美食大逃亡',
    aliases: ['B级美食大逃亡', 'B级美食大作战', 'B級グルメサバイバル'],
  },
  {
    year: 2014,
    title: '决一胜负！逆袭的机器人爸爸',
    aliases: ['逆袭的机器人爸爸', '机器人爸爸的反击', '逆襲のロボとーちゃん'],
  },
  {
    year: 2015,
    title: '我的搬家物语 仙人掌大袭击',
    aliases: ['我的搬家物语', '搬家物语仙人掌', 'オラの引越し物語'],
  },
  {
    year: 2016,
    title: '爆睡！梦境世界大突击',
    aliases: ['梦境世界大突击', '梦世界大突击', 'ユメミーワールド大突撃'],
  },
  {
    year: 2017,
    title: '宇宙人来袭',
    aliases: ['宇宙人来袭', '外星人西里里', '外星人希莉莉', '宇宙人シリリ'],
  },
  {
    year: 2018,
    title: '爆盛！功夫男孩～拉面大乱～',
    aliases: ['功夫男孩', '功夫小子', 'カンフーボーイズ'],
  },
  {
    year: 2019,
    title: '新婚旅行飓风之遗失的野原广志',
    aliases: ['新婚旅行', '蜜月风暴', '新婚旅行ハリケーン'],
  },
  {
    year: 2020,
    title: '激战！涂鸦王国和约四位勇士',
    aliases: ['涂鸦王国', '激突涂鸦', 'ラクガキングダム'],
  },
  {
    year: 2021,
    title: '谜团！花之天下春日部学院',
    aliases: ['花之天下春日部', '花天狂澜春日部', '花の天カス学園'],
  },
  {
    year: 2022,
    title: '幽灵忍者珍风传',
    aliases: [
      '幽灵忍者',
      '好别致的影分身',
      '忍者珍风传',
      'もののけニンジャ珍風伝',
    ],
  },
  {
    year: 2023,
    title: '新次元！超能力大决战',
    aliases: ['超能力大决战', '超能力大決戦', '飞吧手卷寿司'],
  },
  {
    year: 2024,
    title: '我们的恐龙日记',
    aliases: ['我们的恐龙日记', '我們的恐龍日記', 'オラたちの恐竜日記'],
  },
  {
    year: 2025,
    title: '超华丽！灼热的春日部舞者们',
    aliases: ['春日部舞者', '春日部舞男', '灼热的春日部', 'カスカベダンサーズ'],
  },
  {
    year: 2026,
    title: '奇奇怪怪！我的妖怪假期',
    aliases: ['妖怪假期', '妖怪暑假', '妖怪バケ', '妖怪度假'],
  },
];

const traditional =
  '蠟筆劇場電視國語話臺灣風雲傳說戰鬥擊動決勝襲來夢異樂園時黃間諜壯學謎團機親愛華麗熱們龍記級寶藏祕溫發與過衛隊頭藍這遺廣歸';
const simplified =
  '蜡笔剧场电视国语话台湾风云传说战斗击动决胜袭来梦异乐园时黄间谍壮学谜团机亲爱华丽热们龙记级宝藏秘温发与过卫队头蓝这遗广归';
const translations = Object.fromEntries(
  Array.from(traditional).map((letter, index) => [letter, simplified[index]])
);

export function normalizeShinchanTitle(title: string): string {
  return Array.from(title.normalize('NFKC').toLowerCase())
    .map((letter) => translations[letter] ?? letter)
    .join('')
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]/g, '');
}

export function isShinchanVideo(result: SearchResult): boolean {
  const title = normalizeShinchanTitle(result.title);
  return (
    /蜡笔小新|クレヨンしんちゃん|crayonshinchan/.test(title) &&
    !/解说|解說|预告|預告|trailer|讲解|reaction/.test(title) &&
    result.episodes.length > 0
  );
}

export function getShinchanMovie(
  result: SearchResult
): ShinchanMovie | undefined {
  if (!isShinchanVideo(result)) return undefined;
  const title = normalizeShinchanTitle(result.title);
  return SHINCHAN_MOVIES.find((movie) =>
    [movie.title, ...movie.aliases].some((alias) =>
      title.includes(normalizeShinchanTitle(alias))
    )
  );
}

export function getShinchanSeason(title: string): number | null {
  const normalized = normalizeShinchanTitle(title);
  const match =
    normalized.match(/第([0-9一二三四五六七八九十百零两]+)[季部]/) ??
    normalized.match(/(?:season|s)(\d+)/);
  if (!match) return null;
  if (/^\d+$/.test(match[1])) return Number(match[1]) || null;
  const digits: Record<string, number> = {
    零: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (match[1].includes('十')) {
    const [tens, ones] = match[1].split('十');
    return (tens ? digits[tens] ?? 0 : 1) * 10 + (digits[ones] ?? 0);
  }
  return digits[match[1]] ?? null;
}

export interface ShinchanSeriesGroup {
  key: string;
  title: string;
  season: number | null;
  results: SearchResult[];
}

export function buildShinchanCollection(input: SearchResult[]) {
  const unique = new Map<string, SearchResult>();
  for (const result of input)
    if (isShinchanVideo(result))
      unique.set(`${result.source}\0${result.id}`, result);
  const groups = new Map<string, ShinchanSeriesGroup>();
  const movies = new Map<number, SearchResult[]>();
  const bundles: SearchResult[] = [];
  const extras: SearchResult[] = [];
  for (const result of Array.from(unique.values())) {
    const title = normalizeShinchanTitle(result.title);
    const movie = getShinchanMovie(result);
    if (movie) {
      movies.set(movie.year, [...(movies.get(movie.year) ?? []), result]);
      continue;
    }
    if (/剧场版合集|剧场版全集|电影合集|电影全集/.test(title)) {
      bundles.push(result);
      continue;
    }
    if (/剧场|电影|外传|特别|特別|sp$/.test(title)) {
      extras.push(result);
      continue;
    }
    const season = getShinchanSeason(result.title);
    if (!season && result.episodes.length === 1) {
      extras.push(result);
      continue;
    }
    const key = season ? `season-${season}` : 'complete';
    const group = groups.get(key) ?? {
      key,
      title: season ? `第 ${season} 季` : '全集 / 连载',
      season,
      results: [],
    };
    group.results.push(result);
    groups.set(key, group);
  }
  for (const group of Array.from(groups.values()))
    group.results.sort((a, b) => b.episodes.length - a.episodes.length);
  return {
    series: Array.from(groups.values()).sort(
      (a, b) => (a.season ?? 0) - (b.season ?? 0)
    ),
    movies,
    bundles,
    extras,
  };
}

export function shinchanPlaybackUrl(result: SearchResult): string {
  const params = new URLSearchParams({
    source: result.source,
    id: result.id,
    title: result.title,
    returnTo: '/shinchan',
  });
  if (result.year && result.year !== 'unknown') params.set('year', result.year);
  return `/play?${params.toString()}`;
}
