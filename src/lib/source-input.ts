function text(value: unknown, label: string, required = false): string {
  if (value !== undefined && typeof value !== 'string') {
    throw new Error(`${label}格式错误`);
  }
  const result = (value || '').toString().trim();
  if (required && !result) throw new Error(`请填写${label}`);
  if (result.length > 2000) throw new Error(`${label}不能超过 2000 个字符`);
  return result;
}

function address(value: unknown, label: string, required = false): string {
  const result = text(value, label, required);
  if (!result) return '';
  try {
    const url = new URL(result);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
  } catch {
    throw new Error(`${label}须为有效的 HTTP 或 HTTPS 地址`);
  }
  return result;
}

export function parseVideoSourceInput(body: Record<string, unknown>) {
  return {
    key: text(body.key, 'Key', true),
    name: text(body.name, '名称', true),
    api: address(body.api, 'API 地址', true),
    detail: address(body.detail, 'Detail 地址'),
    note: text(body.note, '备注'),
  };
}

export function parseLiveSourceInput(body: Record<string, unknown>) {
  return {
    key: text(body.key, 'Key', true),
    name: text(body.name, '名称', true),
    url: address(body.url, 'M3U 地址', true),
    epg: address(body.epg, '节目单地址'),
    ua: text(body.ua, 'User-Agent'),
    note: text(body.note, '备注'),
  };
}

export function parseEpgSourceInput(body: Record<string, unknown>) {
  return {
    key: text(body.key, '节目单源标识', true),
    name: text(body.name, '名称', true),
    url: address(body.url, '节目单地址', true),
    ua: text(body.ua, 'User-Agent'),
    note: text(body.note, '备注'),
  };
}
