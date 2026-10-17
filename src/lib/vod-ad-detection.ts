export interface VodAdRange {
  start: number;
  end: number;
}

interface Segment extends VodAdRange {
  line: number;
  url: URL | null;
  group: number;
  hasGap: boolean;
}

interface DateRange {
  attrs: Record<string, string>;
  lines: number[];
  out?: number;
  in?: number;
  invalid: boolean;
}

function attributes(text: string): Record<string, string> | null {
  const result: Record<string, string> = {};
  const pattern = /\s*([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))(?:,|$)/gy;
  while (pattern.lastIndex < text.length) {
    const match = pattern.exec(text);
    if (!match || match[1] in result) return null;
    result[match[1]] = match[2] ?? match[3].trim();
  }
  return result;
}

function resolve(uri: string, base: string) {
  try {
    const url = new URL(uri, base);
    return /^https?:$/.test(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function family(segment: Segment) {
  const url = segment.url;
  return url
    ? url.origin + url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1)
    : '';
}

function knownAd(segment: Segment) {
  return (
    !!segment.url &&
    /^\/video\/adjump\/time\/[\w-]+\.ts$/.test(segment.url.pathname)
  );
}

function namedAd(segment: Segment) {
  return (
    !!segment.url &&
    segment.url.pathname
      .toLowerCase()
      .split('/')
      .some((part) =>
        /^(?:ad|ads|advert|advertisement|advertisements|preroll|midroll|postroll|adbreak|adjump)(?:\.[\w]+)?$/.test(
          part
        )
      )
  );
}

function detectIslands(segments: Segment[], complex: boolean): VodAdRange[] {
  const groups: Segment[][] = [];
  for (const segment of segments) {
    const previous = groups[groups.length - 1];
    if (previous?.[0].group === segment.group) previous.push(segment);
    else groups.push([segment]);
  }
  const length = (group: Segment[]) =>
    group[group.length - 1].end - group[0].start;
  const singleFamily = (group?: Segment[]) => {
    if (!group) return '';
    const value = family(group[0]);
    return value && group.every((segment) => family(segment) === value)
      ? value
      : '';
  };
  const ranges: VodAdRange[] = [];
  const repeated = new Map<string, Segment[][]>();
  groups.forEach((group, index) => {
    if (length(group) > 120) return;
    const before = groups[index - 1];
    const after = groups[index + 1];
    const ownFamily = singleFamily(group);
    const beforeFamily = singleFamily(before);
    const afterFamily = singleFamily(after);
    // A short, separately spliced ad directory must leave and return to the
    // same program directory. A different CDN or short scene alone is no proof.
    const programFamily =
      before && after
        ? beforeFamily && beforeFamily === afterFamily
          ? beforeFamily
          : ''
        : beforeFamily || afterFamily;
    const surroundingLength =
      (before ? length(before) : 0) + (after ? length(after) : 0);
    if (
      !programFamily ||
      !ownFamily ||
      ownFamily === programFamily ||
      surroundingLength < 120
    )
      return;
    if (group.every(namedAd)) {
      ranges.push({ start: group[0].start, end: group[group.length - 1].end });
      return;
    }
    // Hash-only ad URLs can repeat in unrelated resources. Require two full
    // identical islands surrounded by long program runs. Do not infer repeats
    // across changing byte offsets, encryption keys or initialization maps.
    if (
      complex ||
      !before ||
      !after ||
      length(before) < 120 ||
      length(after) < 120
    )
      return;
    const signature = group
      .map(
        (segment) =>
          `${segment.url?.href}|${(segment.end - segment.start).toFixed(3)}`
      )
      .join('\n');
    const matches = repeated.get(signature) || [];
    matches.push(group);
    repeated.set(signature, matches);
  });
  for (const matches of Array.from(repeated.values())) {
    if (matches.length < 2) continue;
    for (const group of matches)
      ranges.push({ start: group[0].start, end: group[group.length - 1].end });
  }
  return ranges;
}

export function analyzeVodAds(lines: string[], playlistUrl: string) {
  const segments: Segment[] = [];
  const ranges: VodAdRange[] = [];
  const removeLines = new Set<number>();
  const dates = new Map<string, DateRange>();
  const anchors: Array<{ time: number; date: number }> = [];
  let time = 0;
  let duration = 0;
  let group = 0;
  let hasGap = false;
  let complex = false;
  let cue: { start: number; invalid: boolean } | undefined;

  for (let index = 0; index < lines.length; index++) {
    const text = lines[index].trim();
    if (text.startsWith('#EXTINF:'))
      duration = Number(text.slice(8).split(',')[0]);
    else if (text === '#EXT-X-DISCONTINUITY') group++;
    else if (text === '#EXT-X-GAP') hasGap = true;
    else if (/^#EXT-X-(?:KEY|MAP|BYTERANGE):/.test(text)) complex = true;
    else if (/^#EXT-X-CUE-OUT(?::|$)/.test(text)) {
      const value = text
        .slice('#EXT-X-CUE-OUT'.length)
        .replace(/^:/, '')
        .trim();
      const declared = value.includes('=')
        ? attributes(value)?.DURATION
        : value;
      const invalid =
        !!value &&
        (!declared ||
          !Number.isFinite(Number(declared)) ||
          Number(declared) <= 0);
      cue = cue ? { ...cue, invalid: true } : { start: time, invalid };
    } else if (/^#EXT-X-CUE-IN(?::|$)/.test(text)) {
      if (cue && !cue.invalid && time > cue.start)
        ranges.push({ start: cue.start, end: time });
      cue = undefined;
    } else if (text.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) {
      const date = Date.parse(text.slice(25));
      if (Number.isFinite(date)) anchors.push({ time, date });
    } else if (text.startsWith('#EXT-X-DATERANGE:')) {
      const attrs = attributes(text.slice(17));
      if (!attrs?.ID) continue;
      const entry = dates.get(attrs.ID) || {
        attrs: {},
        lines: [],
        invalid: false,
      };
      for (const key of Object.keys(attrs)) {
        if (key in entry.attrs && entry.attrs[key] !== attrs[key])
          entry.invalid = true;
      }
      Object.assign(entry.attrs, attrs);
      entry.lines.push(index);
      if ('SCTE35-OUT' in attrs && entry.out === undefined) entry.out = time;
      if ('SCTE35-IN' in attrs) entry.in = time;
      dates.set(attrs.ID, entry);
    } else if (text && !text.startsWith('#')) {
      if (!Number.isFinite(duration) || duration <= 0) return null;
      const segment = {
        line: index,
        start: time,
        end: time + duration,
        url: resolve(text, playlistUrl),
        group,
        hasGap,
      };
      segments.push(segment);
      if (knownAd(segment))
        ranges.push({ start: segment.start, end: segment.end });
      time += duration;
      duration = 0;
      hasGap = false;
    }
  }

  for (const entry of Array.from(dates.values())) {
    if (entry.invalid) continue;
    const attrs = entry.attrs;
    if (
      attrs.CLASS === 'com.apple.hls.interstitial' &&
      (attrs['X-ASSET-URI'] || attrs['X-ASSET-LIST'])
    ) {
      // These assets are inserted beside the primary timeline. Suppress only
      // the scheduling tags; never mistake their duration for missing movie.
      entry.lines.forEach((line) => removeLines.add(line));
      continue;
    }
    const adClass =
      /(?:^|[.\-_:])(?:ad|ads|advertisement|preroll|midroll|postroll)(?:$|[.\-_:])/i.test(
        attrs.CLASS || ''
      );
    if (!('SCTE35-OUT' in attrs) && !adClass) continue;
    const date = Date.parse(attrs['START-DATE']);
    const endDate = Date.parse(attrs['END-DATE']);
    const actualDuration =
      attrs.DURATION !== undefined
        ? Number(attrs.DURATION)
        : (endDate - date) / 1000;
    const positions = anchors.map(
      (anchor) => anchor.time + (date - anchor.date) / 1000
    );
    // Date tags may announce ads ahead of time. Use a real clock anchor, or
    // a completed OUT/IN pair at distinct positions; planned duration is not
    // evidence of where main-program content ends.
    if (
      positions.length &&
      positions.every(Number.isFinite) &&
      positions.reduce((max, value) => Math.max(max, value), -Infinity) -
        positions.reduce((min, value) => Math.min(min, value), Infinity) <
        0.05 &&
      actualDuration > 0
    ) {
      ranges.push({ start: positions[0], end: positions[0] + actualDuration });
    } else if (
      entry.out !== undefined &&
      entry.in !== undefined &&
      entry.in > entry.out
    ) {
      ranges.push({ start: entry.out, end: entry.in });
    }
  }

  ranges.push(...detectIslands(segments, complex));
  const merged: VodAdRange[] = [];
  for (const range of ranges
    .filter(
      ({ start, end }) =>
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        start >= -0.001 &&
        end > start &&
        end <= time + 0.001
    )
    .sort((a, b) => a.start - b.start)) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end + 0.001)
      previous.end = Math.max(previous.end, range.end);
    else
      merged.push({
        start: Math.max(0, range.start),
        end: Math.min(time, range.end),
      });
  }
  return { segments, ranges: merged, removeLines };
}
