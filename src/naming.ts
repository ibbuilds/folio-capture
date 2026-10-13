import { hash } from './utils.ts';

export const NAMING_VERSION = 1;
export function nameComponent(value: string, max = 24) {
  const cleaned = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return cleaned || 'reference';
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
  const page = `${nameComponent(decodePath(parsed.pathname.split('/').filter(Boolean).at(-1) ?? 'home'), 12)}-${hash(url).slice(0, 6)}`;
  const section = detail.section
    ? `s${String(detail.section.order + 1).padStart(3, '0')}-${nameComponent(detail.section.title, 16)}`
    : undefined;
  const state = detail.stateKey ? `state-${hash(detail.stateKey).slice(0, 6)}-` : 'part-';
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
