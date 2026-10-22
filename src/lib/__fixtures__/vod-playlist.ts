export function adFixture(
  options: {
    key?: string;
    adPath?: string;
    programPath?: string;
    adDurations?: readonly number[];
    before?: number;
    after?: number;
  } = {}
) {
  const key = options.key || '';
  const before = options.before ?? 24;
  const after = options.after ?? 24;
  const adDurations = options.adDurations || [2, 2, 2, 2, 2, 2, 0.5];
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:7',
    '#EXT-X-MEDIA-SEQUENCE:20',
    '#EXT-X-DISCONTINUITY-SEQUENCE:7',
  ];
  if (key) lines.push(key);
  for (let i = 0; i < before; i++)
    lines.push(
      '#EXTINF:6.006,',
      `${options.programPath || '/video'}/before-${i}.ts`
    );
  lines.push('#EXT-X-DISCONTINUITY');
  adDurations.forEach((duration, i) =>
    lines.push(
      `#EXTINF:${duration},`,
      `${options.adPath || '/video'}/insert-${i}.ts`
    )
  );
  lines.push('#EXT-X-DISCONTINUITY');
  for (let i = 0; i < after; i++)
    lines.push(
      '#EXTINF:6.006,',
      `${options.programPath || '/video'}/after-${i}.ts`
    );
  lines.push('#EXT-X-ENDLIST');
  return lines.join('\n') + '\n';
}
