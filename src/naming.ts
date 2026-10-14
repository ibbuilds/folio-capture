import { canonicalUrl } from './utils.ts';

export const NAMING_VERSION = 2;
export function pageFolder(url: string) {
  const parsed = new URL(canonicalUrl(url));
  const domain =
    parsed.hostname.toLowerCase().replace(/[^a-z0-9.-]/g, '-') +
    (parsed.port ? `--port-${parsed.port}` : '');
  const pieces = parsed.pathname
    .split('/')
    .filter(Boolean)
    .map((part) => nameComponent(decodePath(part), 24));
  let page = pieces.join('--') || 'home';
  for (const [key, value] of parsed.searchParams)
    page += `--${nameComponent(key, 16)}-${nameComponent(value, 24)}`;
  if (parsed.hash) page += `--${nameComponent(decodePath(parsed.hash.slice(1)), 24)}`;
  return `.folio/captures/${domain}/${page.slice(0, 80).replace(/-+$/, '')}`;
}
export function captureVersion(at: string, ordinal: number) {
  return `${new Date(at).toISOString().replace('T', '_').replaceAll(':', '-').replace('.', '-')}--v${String(ordinal).padStart(3, '0')}`;
}
export function nameComponent(value: string, max = 24) {
  const cleaned = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  const component=cleaned || 'reference';
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(component)?`${component}-page`:component;
}
export function imageName(
  url: string,
  profile: string,
  detail: {
    section?: { title: string; order: number };
    part?: number;
    stateKey?: string;
    diagnostic?: string;
  } = {},
) {
  const parsed = new URL(url);
  const host = nameComponent(parsed.hostname.replace(/^www\./, ''), 16);
  const page=nameComponent(pageFolder(url).split('/').at(-1)!,32);
  const section = detail.section
    ? `s${String(detail.section.order + 1).padStart(3, '0')}-${nameComponent(detail.section.title, 16)}`
    : undefined;
  const state = detail.stateKey ? 'state-' : 'part-';
  const ending = detail.diagnostic
    ? nameComponent(detail.diagnostic, 24)
    : `${state}${String(detail.part ?? 1).padStart(3, '0')}`;
  return [host, page, section, nameComponent(profile, 16), ending].filter(Boolean).join('--');
}
function decodePath(path: string) {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
