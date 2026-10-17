export interface EpgProgram {
  start: string;
  end: string;
  title: string;
}

export function beijingEpgDate(now = Date.now()) {
  return new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function isDiypEpg(url: string) {
  try {
    const address = new URL(url);
    if (/\.xml(?:\.gz)?$/i.test(address.pathname)) return false;
    return (
      /\/diyp(?:\/|$)/i.test(address.pathname) || address.searchParams.has('ch')
    );
  } catch {
    return false;
  }
}

export function diypChannelNames(channel: { name: string; tvgId: string }) {
  const normalize = (value: string) => {
    const name = value.normalize('NFKC').trim();
    const cctv = /^CCTV[\s-]*(\d{1,2})(\+|PLUS)?/i.exec(name);
    if (cctv) return 'CCTV' + Number(cctv[1]) + (cctv[2] ? '+' : '');
    return name
      .replace(
        /[([]\s*(?:\d{3,4}p|[248]k|[FU]?HD|超清|高清|标清)\s*[)\]]/gi,
        ''
      )
      .replace(/\s*(?:\d{3,4}p|[248]k|[FU]?HD|超清|高清|标清)$/i, '')
      .trim();
  };
  return Array.from(
    new Set([channel.name, channel.tvgId].map(normalize).filter(Boolean))
  ).slice(0, 2);
}

export function diypEpgUrl(url: string, channel: string, date: string) {
  const address = new URL(url);
  address.searchParams.set('ch', channel);
  address.searchParams.set('date', date);
  return address.href;
}

export function parseDiypPrograms(data: unknown, date: string): EpgProgram[] {
  if (!data || typeof data !== 'object') return [];
  const guide = data as Record<string, unknown>;
  if (!Array.isArray(guide.epg_data) || guide.channel_name === '未提供')
    return [];
  if (typeof guide.date === 'string') {
    const day = guide.date.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
    if (day !== date) return [];
  }
  const midnight = Date.parse(date + 'T00:00:00+08:00');
  if (!Number.isFinite(midnight)) return [];
  const minutes = (value: unknown) => {
    if (typeof value !== 'string') return null;
    const match = /^(\d{1,2}):(\d{2})(?::00)?$/.exec(value.trim());
    if (!match) return null;
    const hour = Number(match[1]),
      minute = Number(match[2]);
    if (hour > 24 || minute > 59 || (hour === 24 && minute !== 0)) return null;
    return hour * 60 + minute;
  };
  const programs: EpgProgram[] = [];
  for (const entry of guide.epg_data.slice(0, 2000)) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    if (
      typeof row.title !== 'string' ||
      !row.title.trim() ||
      /暂未提供节目预告信息/.test(row.title)
    )
      continue;
    const start = minutes(row.start),
      stop = minutes(row.end);
    if (start === null || stop === null || start >= 1440) continue;
    const end = stop <= start ? stop + 1440 : stop;
    programs.push({
      start: new Date(midnight + start * 60000).toISOString(),
      end: new Date(midnight + end * 60000).toISOString(),
      title: row.title.trim().slice(0, 2000),
    });
  }
  return programs;
}
