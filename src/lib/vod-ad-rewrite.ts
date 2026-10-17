import { analyzeVodAds, VodAdRange, vodAttributes } from './vod-ad-detection';

export function toVodContentTime(time: number, ranges: readonly VodAdRange[]) {
  return ranges.reduce(
    (value, range) =>
      value - Math.max(0, Math.min(time, range.end) - range.start),
    time
  );
}

export function toVodSourceTime(time: number, ranges: readonly VodAdRange[]) {
  let source = time;
  for (const range of ranges) {
    if (source < range.start) break;
    source += range.end - range.start;
  }
  return source;
}

// Remove whole media segments, never seek across a hole in the media buffer.
// Retain key/map state, and make implicit sequence IVs and byte offsets explicit
// wherever removing a segment would otherwise change their meaning.
export function rewriteVodAds(
  lines: string[],
  analysis: NonNullable<ReturnType<typeof analyzeVodAds>>
) {
  const removed = new Set(
    analysis.segments
      .filter((segment) =>
        analysis.ranges.some(
          (range) =>
            segment.start >= range.start - 0.001 &&
            segment.end <= range.end + 0.001
        )
      )
      .map((segment) => segment.line)
  );
  if (!removed.size)
    return {
      lines: lines.filter((_, index) =>
        // A partial timed ad must not remove its containing program segment.
        analysis.ranges.length ? true : !analysis.removeLines.has(index)
      ),
      ranges: [] as VodAdRange[],
    };
  if (removed.size === analysis.segments.length) return null;
  const ranges: VodAdRange[] = [];
  for (const segment of analysis.segments) {
    if (!removed.has(segment.line)) continue;
    const previous = ranges[ranges.length - 1];
    if (previous && Math.abs(previous.end - segment.start) < 0.001)
      previous.end = segment.end;
    else ranges.push({ start: segment.start, end: segment.end });
  }
  const newline = lines.some((line) => line.endsWith('\r')) ? '\r' : '';
  const output: string[] = [];
  const keys = new Map<string, { text: string; implicit: boolean }>();
  const sequenceLine = lines.find((line) =>
    line.startsWith('#EXT-X-MEDIA-SEQUENCE:')
  );
  const sequence = sequenceLine ? Number(sequenceLine.trim().slice(22)) : 0;
  if (!Number.isSafeInteger(sequence) || sequence < 0) return null;
  let previousLine = -1;
  let skipped = 0;
  let byteEnd: number | undefined;
  let byteUri: string | undefined;
  let discontinuity = false;
  for (let index = 0; index < analysis.segments.length; index++) {
    const segment = analysis.segments[index];
    const discard = removed.has(segment.line);
    let byteRange: { length: number; offset: number } | undefined;
    const pending: string[] = [];
    for (let line = previousLine + 1; line < segment.line; line++) {
      const raw = lines[line];
      const text = raw.trim();
      if (text.startsWith('#EXT-X-KEY:')) {
        const attrs = vodAttributes(text.slice(11));
        if (!attrs?.METHOD) return null;
        if (attrs.METHOD === 'NONE') keys.clear();
        else {
          const implicit = !attrs.IV;
          if (implicit && attrs.METHOD !== 'AES-128') return null;
          keys.set(attrs.KEYFORMAT || 'identity', { text, implicit });
        }
        pending.push(raw);
      } else if (text.startsWith('#EXT-X-MAP:')) pending.push(raw);
      else if (text === '#EXT-X-DISCONTINUITY') discontinuity = true;
      else if (text.startsWith('#EXT-X-BYTERANGE:')) {
        const match = /^#EXT-X-BYTERANGE:(\d+)(?:@(\d+))?$/.exec(text);
        if (!match) return null;
        const offset = match[2] === undefined ? byteEnd : Number(match[2]);
        if (
          offset === undefined ||
          (match[2] === undefined && byteUri !== segment.url?.href)
        )
          return null;
        byteRange = { length: Number(match[1]), offset };
        if (
          !Number.isSafeInteger(offset) ||
          !Number.isSafeInteger(byteRange.length) ||
          byteRange.length <= 0
        )
          return null;
      } else if (
        analysis.removeLines.has(line) ||
        /^#EXT-X-(?:CUE-|OATCLS-SCTE35:|SCTE35:)/.test(text)
      ) {
        // Advertising events refer to the old timeline and must not be applied
        // a second time when a playlist is parsed/reloaded.
      } else if (
        !discard ||
        !/^#(?:EXTINF:|EXT-X-(?:GAP$|PROGRAM-DATE-TIME:|BITRATE:))/.test(text)
      )
        pending.push(raw);
    }
    byteEnd = byteRange ? byteRange.offset + byteRange.length : undefined;
    byteUri = segment.url?.href;
    previousLine = segment.line;
    if (discard) {
      skipped++;
      // Timed cue breaks need not contain a discontinuity tag. Reset the
      // timestamp mapping after a removed run even when the source omitted it.
      discontinuity = true;
      output.push(...pending);
      continue;
    }
    if (discontinuity) {
      const firstMediaTag = pending.findIndex((line) =>
        /^#(?:EXTINF:|EXT-X-(?:KEY:|MAP:|GAP|PROGRAM-DATE-TIME:|BITRATE:))/.test(
          line
        )
      );
      pending.splice(
        firstMediaTag < 0 ? pending.length : firstMediaTag,
        0,
        '#EXT-X-DISCONTINUITY' + newline
      );
      discontinuity = false;
    }
    output.push(...pending);
    if (skipped) {
      const originalSequence = sequence + index;
      if (!Number.isSafeInteger(originalSequence)) return null;
      for (const key of Array.from(keys.values())) {
        if (key.implicit)
          output.push(
            `${key.text},IV=0x${originalSequence
              .toString(16)
              .padStart(32, '0')}${newline}`
          );
      }
    }
    if (byteRange)
      output.push(
        `#EXT-X-BYTERANGE:${byteRange.length}@${byteRange.offset}${newline}`
      );
    output.push(lines[segment.line]);
  }
  for (let line = previousLine + 1; line < lines.length; line++) {
    if (!analysis.removeLines.has(line)) output.push(lines[line]);
  }
  const sourceDuration = analysis.segments[analysis.segments.length - 1].end;
  return {
    lines: output.map((line) => {
      if (!line.startsWith('#EXT-X-START:')) return line;
      const attrs = vodAttributes(line.trim().slice(13));
      const offset = Number(attrs?.['TIME-OFFSET']);
      if (!Number.isFinite(offset)) return line;
      const target = toVodContentTime(
        offset < 0 ? sourceDuration + offset : offset,
        ranges
      );
      const mapped =
        offset < 0 ? target - toVodContentTime(sourceDuration, ranges) : target;
      return line.replace(/TIME-OFFSET=[^,\r]+/, `TIME-OFFSET=${mapped}`);
    }),
    ranges,
  };
}
