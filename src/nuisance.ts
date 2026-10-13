import type { BrowserContext } from 'playwright';
import type { Intervention } from './types.ts';
import { now } from './utils.ts';
import { GALLERY_SPECS } from './library-specs.ts';

export const AD_HOSTS = [
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'carbonads.net',
  'buysellads.com',
  'adroll.com',
  'adsrvr.org',
  'ads-twitter.com',
  'ads.linkedin.com',
];
export const AD_CONTAINERS =
  '[data-sponsored="true"],[data-ad-slot],[data-advertisement],[data-folio-advertisement],ins.adsbygoogle,[aria-label="Advertisement"],iframe[title="Advertisement"],a[rel~="sponsored"],.carbon-wrap,#carbonads,.ad-block-navbar,.sponsored-card-mobile-btm,.opl-sponsor-link';
export const GALLERY_AD_HOSTS = [
  ...new Set([
    'styles.refero.design',
    'recent.design',
    ...GALLERY_SPECS.flatMap((spec) => spec.hosts),
  ]),
];

/** Telemetry failure says nothing about a gallery's ability to load its next batch. */
export function isTelemetryUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname;
    if (host === 'frog.wix.com') return true;
    if (host === 'panorama.wixapps.net' && /^\/api\/v1\/bulklog\/?$/.test(new URL(value).pathname))
      return true;
    return [
      'google-analytics.com',
      'googletagmanager.com',
      'analytics.google.com',
      'sentry.io',
      'segment.io',
      'segment.com',
      'posthog.com',
      'posthog.cloud',
      'clarity.ms',
      'plausible.io',
    ].some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

export function isAdvertisingUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return AD_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

/** Restrict blocking to identified ad services. Product media and consent scripts load normally. */
export async function guardNuisances(
  context: BrowserContext,
  log: Intervention[],
  manageDialogs = true,
): Promise<void> {
  await context.route('**/*', async (route) => {
    const request = route.request();
    if (!isAdvertisingUrl(request.url())) {
      await route.fallback();
      return;
    }
    log.push({
      at: now(),
      frameUrl: request.url(),
      action: 'block-ad-request',
      target: request.url(),
      method: 'known-ad-service',
      verified: true,
    });
    await route.abort('blockedbyclient');
  });
  if (!manageDialogs) return;
  context.on('page', (page) => {
    page.on('dialog', (dialog) => {
      log.push({
        at: now(),
        frameUrl: page.url(),
        action: 'dismiss-browser-dialog',
        target: dialog.type(),
        method: 'browser-dialog',
        verified: true,
      });
      void dialog.dismiss().catch(() => undefined);
    });
    page.on('popup', (popup) => {
      void popup
        .close()
        .then(() => {
          log.push({
            at: now(),
            frameUrl: page.url(),
            action: 'close-unrequested-window',
            target: popup.url(),
            method: 'browser-popup-event',
            verified: true,
          });
        })
        .catch(() => undefined);
    });
  });
}
