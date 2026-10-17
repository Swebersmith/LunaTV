interface Channel {
  url: string;
  name: string;
  tvgId: string;
}

function identity(name: string) {
  const clean = name.toUpperCase().replace(/\s/g, '');
  const cctv = /^CCTV[-_]?0*(\d+)(\+?)/.exec(clean);
  if (cctv) return `CCTV${cctv[1]}${cctv[2]}`;
  return clean
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/(?:超清|高清|标清|FHD|UHD|HD|SD)$/g, '');
}

export function nextLiveAlternative<T extends Channel>(
  channels: T[],
  current: T,
  attempted: Set<string>
): T | undefined {
  // Bound automatic failover to three addresses of the same station. Never
  // replace the programme with an unrelated channel or revisit a failed URL.
  if (attempted.size >= 3) return;
  if (!current.tvgId && !identity(current.name)) return;
  return channels.find(
    (channel) =>
      !attempted.has(channel.url) &&
      channel.url !== current.url &&
      ((current.tvgId && channel.tvgId === current.tvgId) ||
        identity(channel.name) === identity(current.name))
  );
}
