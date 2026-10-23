// Local implementation of discontinuity-group heuristics described/used by the
// Juliang player. No remote player runtime, models or rule service is required.
// HLS state is rebuilt separately: removing a group must not renumber implicit
// AES-128 IVs or discard a real timestamp discontinuity in the retained movie.
export interface VodAdRange {
  start: number;
  end: number;
}

export interface VodAdFilterResult {
  playlist: string;
  originalDuration: number;
  removed: VodAdRange[];
  reason: 'filtered' | 'no-match' | 'unsupported';
}

interface MediaSegment {
  uri: string;
  duration: number;
  start: number;
  sequence: number;
  discontinuity: number;
  key: string;
  tags: string[];
}

interface SegmentGroup {
  segments: MediaSegment[];
  duration: number;
  directory: string | null;
  explicitAdInsertion: boolean;
}

function attributes(line: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of Array.from(
    line.matchAll(/([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))/g)
  )) {
    result[match[1]] = match[2] ?? match[3];
  }
  return result;
}

function directory(uri: string, baseUrl: string): string {
  const url = new URL(uri, baseUrl);
  return url.origin + url.pathname.slice(0, url.pathname.lastIndexOf('/'));
}

function parsePlaylist(content: string, baseUrl: string) {
  // Leave rolling/live, low-latency, byte-range, fMP4 and DRM playlists intact.
  // Their shared state requires a separate, coordinated rewriting strategy.
  if (
    !/^\uFEFF?#EXTM3U(?:\r?\n|$)/.test(content) ||
    !/^#EXT-X-ENDLIST\s*$/m.test(content) ||
    /^#EXT-X-(?:STREAM-INF|MEDIA|I-FRAMES-ONLY|PART|SKIP|MAP|BYTERANGE|PRELOAD-HINT|SERVER-CONTROL|GAP)(?::|\s*$)/m.test(
      content
    )
  )
    return null;
  const header: string[] = [];
  const footer: string[] = [];
  const segments: MediaSegment[] = [];
  let tags: string[] = [];
  let duration = 0;
  let start = 0;
  let sequence = 0;
  let discontinuity = 0;
  let initialDiscontinuity = 0;
  let key = '';
  let ended = false;
  for (const original of content.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = original.trim();
    if (!line) continue;
    if (ended) {
      if (!line.startsWith('#')) return null;
      footer.push(original);
    } else if (line === '#EXT-X-ENDLIST') {
      if (duration) return null;
      footer.push(...tags, original);
      tags = [];
      ended = true;
    } else if (/^#EXT-X-(?:MEDIA|DISCONTINUITY)-SEQUENCE:/.test(line)) {
      if (segments.length || duration) return null;
      const value = Number(line.slice(line.indexOf(':') + 1));
      if (!Number.isSafeInteger(value) || value < 0) return null;
      if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) sequence = value;
      else discontinuity = initialDiscontinuity = value;
      header.push(original);
    } else if (line.startsWith('#EXT-X-KEY:')) {
      const attr = attributes(line);
      if (
        attr.METHOD !== 'NONE' &&
        (attr.METHOD !== 'AES-128' ||
          !attr.URI ||
          (attr.KEYFORMAT && attr.KEYFORMAT !== 'identity') ||
          (attr.IV && !/^0x[\da-f]{32}$/i.test(attr.IV)))
      )
        return null;
      key = line;
    } else if (line === '#EXT-X-DISCONTINUITY') {
      if (duration) return null;
      discontinuity++;
    } else if (line.startsWith('#EXTINF:')) {
      if (duration) return null;
      duration = Number(line.slice(8).split(',')[0]);
      if (!Number.isFinite(duration) || duration <= 0) return null;
      tags.push(original);
    } else if (!line.startsWith('#')) {
      if (!duration || !Number.isSafeInteger(sequence)) return null;
      try {
        directory(line, baseUrl);
      } catch {
        return null;
      }
      segments.push({
        uri: original,
        duration,
        start,
        sequence,
        discontinuity,
        key,
        tags,
      });
      start += duration;
      sequence++;
      duration = 0;
      tags = [];
    } else if (
      !segments.length &&
      !duration &&
      /^#(?:EXTM3U|EXT-X-(?:VERSION|TARGETDURATION|PLAYLIST-TYPE|INDEPENDENT-SEGMENTS|START))(?::|$)/.test(
        line
      )
    ) {
      header.push(original);
    } else {
      tags.push(original);
    }
  }
  if (!ended || !segments.length || !Number.isFinite(start)) return null;
  const groups: SegmentGroup[] = [];
  for (const segment of segments) {
    let group = groups[groups.length - 1];
    if (!group || group.segments[0].discontinuity !== segment.discontinuity) {
      group = {
        segments: [],
        duration: 0,
        directory: directory(segment.uri.trim(), baseUrl),
        explicitAdInsertion: true,
      };
      groups.push(group);
    }
    group.segments.push(segment);
    // Baofeng's /video/adjump/time/ is a dedicated insertion namespace.
    // Check every URI in the bounded group, never an arbitrary "ad" substring.
    try {
      const path = decodeURIComponent(
        new URL(segment.uri.trim(), baseUrl).pathname
      );
      group.explicitAdInsertion &&=
        /(?:^|\/)video\/adjump\/time\/[^/]+\.ts$/i.test(path);
    } catch {
      group.explicitAdInsertion = false;
    }
    group.duration += segment.duration;
    if (group.directory !== directory(segment.uri.trim(), baseUrl))
      group.directory = null;
  }
  return {
    header,
    footer,
    segments,
    groups,
    duration: start,
    initialDiscontinuity,
  };
}

const durationKey = (value: number) => value.toFixed(3);
const frameRates = [
  24,
  25,
  30,
  50,
  60,
  24000 / 1001,
  30000 / 1001,
  60000 / 1001,
];
const onFrameGrid = (duration: number, rate: number) =>
  Math.abs(duration - Math.round(duration * rate) / rate) <= 0.00051;

function detectGroups(groups: SegmentGroup[], total: number): Set<number> {
  const removed = new Set<number>();
  // A short clip, a single continuous stream, or a mostly-ad playlist does not
  // provide enough evidence about what the main programme looks like.
  if (total < 120 || groups.length < 2) return removed;
  const directoryDurations = new Map<string, number>();
  const durations = new Map<string, number>();
  const all = groups.flatMap((group) =>
    group.segments.map((segment) => segment.duration)
  );
  for (const group of groups) {
    if (group.directory !== null)
      directoryDurations.set(
        group.directory,
        (directoryDurations.get(group.directory) || 0) + group.duration
      );
    for (const segment of group.segments) {
      const value = durationKey(segment.duration);
      durations.set(value, (durations.get(value) || 0) + 1);
    }
  }
  const topDirectory = Array.from(directoryDurations).sort(
    (a, b) => b[1] - a[1]
  )[0];
  const mainDirectory =
    topDirectory && topDirectory[1] >= total * 0.5 ? topDirectory[0] : null;
  const topDuration = Array.from(durations).sort((a, b) => b[1] - a[1])[0];
  const mainDuration =
    topDuration && topDuration[1] >= all.length * 0.7 ? topDuration[0] : null;
  const fingerprints = new Map<string, number[]>();
  const isMain = (index: number) =>
    mainDirectory !== null && groups[index]?.directory === mainDirectory;
  const grid =
    all.length >= 100
      ? frameRates.find(
          (rate) =>
            all.filter((value) => onFrameGrid(value, rate)).length /
              all.length >=
            0.97
        )
      : undefined;
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index];
    const values = group.segments.map((segment) => segment.duration);
    if (group.duration <= 0 || group.duration > 60 || group.directory === null)
      continue;
    // Real Baofeng movie/series cadences vary, so a 70% modal-duration
    // requirement cannot be used for explicit insertion paths. Their current
    // ad package has nine fragments (8 x 3s + 2.04s), not at most eight.
    if (group.explicitAdInsertion) removed.add(index);
    const keys = values.map(durationKey);
    const mainCount = mainDuration
      ? keys.filter((value) => value === mainDuration).length
      : 0;
    const counts = new Map<string, number>();
    keys.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
    const repeatedCadence =
      Math.max(...Array.from(counts.values())) >=
      Math.max(3, Math.ceil(values.length / 2));
    const differentCadence =
      !!mainDuration && mainCount === 0 && repeatedCadence;
    const integerCadence =
      !!mainDuration &&
      !mainDuration.endsWith('000') &&
      keys.every((value) => value !== mainDuration && value.endsWith('000'));
    const uniform = keys.slice(0, -1).every((value) => value === keys[0]);
    const shortTail =
      values[values.length - 1] < 3 && values[values.length - 1] < values[0];
    const packaged =
      group.duration <= 30 &&
      values.length >= 7 &&
      values.length <= 9 &&
      uniform &&
      shortTail;
    const mainMinority =
      !!mainDuration &&
      mainCount > 0 &&
      mainCount * 2 < values.length &&
      values.filter(
        (value) => durationKey(value) !== mainDuration && value >= 0.15
      ).length >= 2;
    if (
      isMain(index) &&
      (differentCadence ||
        integerCadence ||
        mainMinority ||
        (packaged && mainDuration && keys[0] !== mainDuration))
    )
      removed.add(index);
    if (mainDirectory && group.directory !== mainDirectory) {
      if (
        /(?:^|\/)209\d\/(?:0[1-9]|1[0-2])\/video(?:\/|$)/.test(group.directory)
      )
        removed.add(index);
      // An isolated path change is not enough: require a repeated duration
      // fingerprint, with programme groups immediately around each insertion.
      if (
        values.length >= 2 &&
        values.length <= 8 &&
        group.duration >= 3 &&
        group.duration <= 30 &&
        (index === 0 || isMain(index - 1)) &&
        (index === groups.length - 1 || isMain(index + 1)) &&
        mainDuration &&
        mainCount * 2 < values.length
      ) {
        const fingerprint = keys.join(',');
        fingerprints.set(fingerprint, [
          ...(fingerprints.get(fingerprint) || []),
          index,
        ]);
      }
      // A packaged preroll with a different cadence and a long, stable movie.
      if (
        index === 0 &&
        packaged &&
        mainDuration &&
        mainCount === 0 &&
        groups.slice(1).every((_, i) => isMain(i + 1))
      )
        removed.add(index);
    }
    if (
      grid &&
      index > 0 &&
      index < groups.length - 1 &&
      isMain(index) &&
      values.length >= 2 &&
      values.length <= 8 &&
      group.duration >= 3 &&
      group.duration <= 30 &&
      values.filter((value) => !onFrameGrid(value, grid)).length >= 2 &&
      frameRates.some(
        (rate) =>
          rate !== grid && values.every((value) => onFrameGrid(value, rate))
      ) &&
      groups[index - 1].segments.every((segment) =>
        onFrameGrid(segment.duration, grid)
      ) &&
      groups[index + 1].segments.every((segment) =>
        onFrameGrid(segment.duration, grid)
      )
    )
      removed.add(index);
  }
  fingerprints.forEach((indices) => {
    if (indices.length >= 2) indices.forEach((index) => removed.add(index));
  });
  const removedDuration = Array.from(removed).reduce(
    (sum, index) => sum + groups[index].duration,
    0
  );
  // Apply one budget to the combined decisions, not each rule independently.
  if (
    removed.size > 5 ||
    removedDuration > total * 0.1 ||
    removed.size === groups.length
  )
    return new Set<number>();
  return removed;
}

export function filterVodAdSegments(
  content: string,
  baseUrl = 'https://playlist.invalid/index.m3u8'
): VodAdFilterResult {
  const unchanged: VodAdFilterResult = {
    playlist: content,
    originalDuration: 0,
    removed: [],
    reason: 'unsupported',
  };
  const parsed = parsePlaylist(content, baseUrl);
  if (!parsed) return unchanged;
  const removedGroups = detectGroups(parsed.groups, parsed.duration);
  if (!removedGroups.size)
    return {
      ...unchanged,
      originalDuration: parsed.duration,
      reason: 'no-match',
    };
  const removed: VodAdRange[] = [];
  const excluded = new Set<MediaSegment>();
  for (const index of Array.from(removedGroups)) {
    const group = parsed.groups[index];
    const start = group.segments[0].start;
    removed.push({ start, end: start + group.duration });
    group.segments.forEach((segment) => excluded.add(segment));
  }
  removed.sort((a, b) => a.start - b.start);
  const header = [...parsed.header];
  // An explicit IV needs HLS protocol version 2 or newer.
  const versionIndex = header.findIndex((line) =>
    line.startsWith('#EXT-X-VERSION:')
  );
  if (versionIndex < 0) header.push('#EXT-X-VERSION:3');
  else if (Number(header[versionIndex].split(':')[1]) < 2)
    header[versionIndex] = '#EXT-X-VERSION:3';
  const lines = [...header];
  let lastKey = '';
  let lastDiscontinuity = parsed.initialDiscontinuity;
  for (const segment of parsed.segments) {
    if (excluded.has(segment)) continue;
    for (; lastDiscontinuity < segment.discontinuity; lastDiscontinuity++)
      lines.push('#EXT-X-DISCONTINUITY');
    let key = segment.key;
    if (key && attributes(key).METHOD === 'AES-128' && !attributes(key).IV) {
      // Preserve the original sequence-derived IV even after URI removal has
      // made the output's media sequence numbers consecutive again (RFC 8216).
      key += `,IV=0x${segment.sequence.toString(16).padStart(32, '0')}`;
    }
    if (key !== lastKey) {
      lines.push(key || '#EXT-X-KEY:METHOD=NONE');
      lastKey = key;
    }
    lines.push(...segment.tags, segment.uri);
  }
  lines.push(...parsed.footer);
  return {
    playlist: lines.join('\n') + '\n',
    originalDuration: parsed.duration,
    removed,
    reason: 'filtered',
  };
}

export function sourceToFilteredTime(
  ranges: VodAdRange[],
  sourceTime: number
): number {
  return Math.max(
    0,
    sourceTime -
      ranges.reduce(
        (sum, range) =>
          sum + Math.max(0, Math.min(sourceTime, range.end) - range.start),
        0
      )
  );
}

export function filteredToSourceTime(
  ranges: VodAdRange[],
  filteredTime: number
): number {
  let sourceTime = Math.max(0, filteredTime);
  for (const range of ranges) {
    if (sourceTime < range.start - 0.000001) break;
    sourceTime += range.end - range.start;
  }
  return sourceTime;
}
