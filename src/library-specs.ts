/** Public collection routes and card identities inspected on the source galleries. */
export type GallerySpec = {
  id: string;
  hosts: string[];
  listings: string;
  details: string;
  entrySelector?: string;
  collections?: string;
  expandFrom?: string[];
  directSelector?: string;
  relatedDetails?: string;
  originalSelector?: string;
  indexPaths?: string[];
  paginationRoots?: string[];
  allowDisplayedUrl?: boolean;
  prefetchDetails?: boolean;
  ignoredRequests?: Array<{ host: string; paths: string }>;
  relatedSelector?: string;
  relatedText?: string;
  intermediates?: Array<{ hosts: string[]; paths: string; selector: string }>;
};

export const GALLERY_SPECS: GallerySpec[] = [
  {
    id: 'refs-gallery',
    hosts: ['refs.gallery'],
    listings: '^/(?:categories|collections|category/[^/]+|collections/[^/]+)?/?$',
    details: '^/projects/[^/]+/?$',
    collections: '^/(?:category|collections)/[^/]+/?$',
    expandFrom: ['/'],
  },
  {
    id: 'site-of-sites',
    hosts: ['siteofsites.co'],
    listings: '^/(?:websites|collections|collections/[^/]+)?/?$',
    details: '^/websites/[^/]+/?$',
    collections: '^/collections/[^/]+/?$',
    expandFrom: ['/'],
  },
  {
    id: 'awwwards-sites',
    hosts: ['awwwards.com'],
    listings: '^/(?:websites(?:/[^/]+)*|collections(?:/[^/]+)*)?/?$',
    details: '^/sites/[^/]+/?$',
    originalSelector: 'h1 a[href],a.toolbar-bts__item[href]',
    collections: '^/websites/[^/]+/?$',
    expandFrom: ['/'],
  },
  {
    id: 'awwwards-elements',
    hosts: ['awwwards.com'],
    listings: '^/elements(?:/[^/]+)*/?$',
    details: '^/inspiration/[^/]+/?$',
    relatedDetails: '^/sites/[^/]+/?$',
    originalSelector: 'a.toolbar-bts__item[href]',
  },
  {
    id: 'a1-websites',
    hosts: ['a1.gallery'],
    listings: '^/(?:websites|style/[^/]+|industry/[^/]+)?/?$',
    details: '^/website/[^/]+/?$',
    intermediates: [
      {
        hosts: ['framer.com'],
        paths: '^/marketplace/templates/[^/]+/?$',
        selector: 'a.button:not(.is-secondary)',
      },
    ],
  },
  {
    id: 'a1-pages',
    hosts: ['a1.gallery'],
    listings: '^/pages(?:/[^/]+)?/?$',
    details: '^/page/[^/]+/?$',
    collections: '^/pages/[^/]+/?$',
    expandFrom: ['/pages'],
  },
  {
    id: 'a1-sections',
    hosts: ['a1.gallery'],
    listings: '^/sections(?:/[^/]+)?/?$',
    details: '^/section/[^/]+/?$',
    collections: '^/sections/[^/]+/?$',
    expandFrom: ['/sections'],
  },
  {
    id: 'maxibestof',
    hosts: ['maxibestof.one'],
    listings: '^/(?:websites(?:/[^/]+)*|collections(?:/[^/]+)*)?/?$',
    details: '^/websites/[0-9]+-[^/]+/?$',
    paginationRoots: ['/', '/websites'],
    collections: '^/collections/[^/]+/?$',
    expandFrom: ['/'],
  },
  {
    id: 'siteinspire',
    hosts: ['siteinspire.com'],
    listings: '^/(?:websites(?:/[^/]+)*)?/?$',
    details: '^/website/[^/]+/?$',
    entrySelector: 'a.WebsiteCard__imageWrapper',
    originalSelector: 'a[aria-label^="Visit "][aria-label*=" - https://"]',
    paginationRoots: ['/', '/websites'],
  },
  {
    id: 'minimal-gallery',
    hosts: ['minimal.gallery'],
    listings: '^/(?:websites|category/[^/]+|page/[0-9]+)?/?$',
    details: '^/[^/]+/?$',
    entrySelector: 'a[aria-label^="View details for"]',
    collections: '^/category/[^/]+/?$',
    expandFrom: ['/'],
  },
  {
    id: 'curated-websites',
    hosts: ['curated.design'],
    listings: '^/(?:inspiration|websites|categories/[^/]+)?/?$',
    details: '^/sites/s/[0-9]+/?$',
  },
  {
    id: 'curated-sections',
    hosts: ['curated.design'],
    listings: '^/sections/?$',
    details: '^/sections/[0-9]+/?$',
    originalSelector: 'a[title^="Visit "][target="_blank"]',
  },
  {
    id: 'hoverstates',
    hosts: ['hoverstat.es'],
    listings: '^/(?:page/[0-9]+)?/?$',
    details: '^/features/[^/]+/?$',
    allowDisplayedUrl: true,
  },
  {
    id: 'inspo',
    hosts: ['inspomcp.dev'],
    listings: '^/(?:screens|sites)?/?$',
    details: '^/(?:screens|sites)/[^/]+/?$',
    collections: '^/(?:screens|sites)/?$',
    expandFrom: ['/'],
  },
  {
    id: 'lapa-websites',
    hosts: ['lapa.ninja'],
    listings: '^/(?:post(?:/page/[0-9]+)?|page/[0-9]+|category/[^/]+|year/[0-9]+)?/?$',
    details: '^/post/(?!page/)[^/]+/?$',
    collections: '^/category/[^/]+/?$',
    expandFrom: ['/'],
  },
  {
    id: 'lapa-elements',
    hosts: ['lapa.ninja'],
    listings:
      '^/elements(?:/(?:loading|mouse-interaction|menu|hover|gallery|footer|text-effect))?/?$',
    details:
      '^/elements/(?!(?:loading|mouse-interaction|menu|hover|gallery|footer|text-effect)/?$)[^/]+/?$',
    collections:
      '^/elements/(?:loading|mouse-interaction|menu|hover|gallery|footer|text-effect)/?$',
    expandFrom: ['/elements'],
  },
  {
    id: 'saaspo-pages',
    hosts: ['saaspo.com'],
    listings: '^/(?:inspiration|page-types/[^/]+|industries/[^/]+)?/?$',
    details: '^/pages/[^/]+/?$',
  },
  {
    id: 'saaspo-sections',
    hosts: ['saaspo.com'],
    listings: '^/sections/?$',
    details: '^/sections/[^/]+/?$',
  },
  {
    id: 'landingfolio',
    hosts: ['landingfolio.com'],
    listings: '^/(?:inspiration(?:/(?!post(?:/|$))[^/]+)*)?/?$',
    details: '^/inspiration/post/[^/]+/?$',
    collections: '^/inspiration/(?!post(?:/|$))[^/]+/?$',
    expandFrom: ['/'],
  },
  {
    id: 'one-page-love',
    hosts: ['onepagelove.com'],
    listings: '^/(?:inspiration(?:/page/[0-9]+)?|genre/[^/]+(?:/page/[0-9]+)?)/?$',
    details: '^/[^/]+/?$',
    entrySelector: 'a.link-image-video,a.link-image-long,a.link-image',
    originalSelector: 'a[title^="Visit "][title$=" Website"]',
    collections: '^/genre/[^/]+/?$',
    expandFrom: ['/inspiration'],
  },
  {
    id: 'one-page-love-sections',
    hosts: ['onepagelove.com'],
    listings: '^/(?:sections|section/[^/]+(?:/page/[0-9]+)?)/?$',
    details: '^/section/[^/]+/[^/]+/?$',
    entrySelector: 'a.opl-section-zoom',
    collections: '^/section/[^/]+/?$',
    expandFrom: ['/sections'],
    indexPaths: ['/sections'],
    relatedDetails: '^/[^/]+/?$',
    relatedSelector: 'a[target="_blank"]',
    relatedText: '^View full page\\s*[→↗]?$',
    originalSelector: 'a[title^="Visit "][title$=" Website"]',
  },
  {
    id: 'landing-love',
    hosts: ['landing.love'],
    listings: '^/(?:sites|page/[0-9]+|categories/[^/]+(?:/page/[0-9]+)?)?/?$',
    details: '^/sites/[^/]+/?$',
    collections: '^/(?:sites|categories/[^/]+)/?$',
    paginationRoots: ['/', '/sites'],
    ignoredRequests: [{ host: 'landing.love', paths: '^/api/membership/me/?$' }],
    expandFrom: ['/'],
  },
  {
    id: 'navbar-gallery',
    hosts: ['navbar.gallery'],
    listings: '^/(?:browse|type/[^/]+)?/?$',
    details: '^/navbar/[^/]+/?$',
    collections: '^/(?:browse|type/[^/]+)/?$',
    expandFrom: ['/'],
  },
  {
    id: 'supahero',
    prefetchDetails: true,
    hosts: ['supahero.io'],
    listings: '^/(?:category/[^/]+|heroes)?/?$',
    details: '^/hero/[^/]+/?$',
  },
  {
    id: 'unsection',
    hosts: ['unsection.com'],
    listings: '^/(?:category/[^/]+|sections)?/?$',
    details: '^/section/[^/]+/?$',
  },
  {
    id: 'footer-design',
    hosts: ['footer.design'],
    listings: '^/(?:type/[^/]+|browse)?/?$',
    details: '^/sites/[^/]+/?$',
    originalSelector: 'a.button.secondary[href]',
  },
  {
    id: 'cta-gallery',
    hosts: ['cta.gallery'],
    listings: '^/(?:type/[^/]+|category/[^/]+)?/?$',
    details: '^/cta/[^/]+/?$',
  },
  {
    id: 'gridddy',
    hosts: ['gridddy.framer.website'],
    listings: '^/(?:category/[^/]+)?/?$',
    details: '^/sites/[^/]+/?$',
  },
  { id: '404s', hosts: ['404s.design'], listings: '^/$', details: '^/sites/[^/]+/?$' },
  {
    id: 'bento-grids',
    hosts: ['bentogrids.com'],
    listings: '^/$',
    details: '(?!)',
    directSelector: 'a.group\\/link[href]',
  },
  {
    id: '60fps',
    hosts: ['60fps.design'],
    listings: '^/(?:shots/filter(?:/[^/]+)?|appsites|apps(?:/category/[^/]+)?)?/?$',
    details: '^/shots/(?!filter(?:/|$)|watch(?:/|$))[^/]+/?$',
    relatedDetails: '^/apps/(?!category(?:/|$))[^/]+/?$',
  },
  {
    id: 'design-spells',
    hosts: ['designspells.com'],
    listings: '^/(?:platform/[^/]+|category/[^/]+|tags/[^/]+)?/?$',
    details: '^/spells/[^/]+/?$',
    relatedDetails: '^/apps/[^/]+/?$',
    originalSelector: 'h1 a[href][target="_blank"]',
  },
  {
    id: 'recent-app-screenshots',
    prefetchDetails: true,
    ignoredRequests: [{ host: 'api.recent.design', paths: '^/admin/presence/?$' }],
    hosts: ['recent.design'],
    listings: '^/app-store-screenshots(?:/[^/]+)?/?$',
    details: '^/i/[^/]+/?$',
  },
];

export function galleryHost(spec: GallerySpec, value: string): boolean {
  try {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      spec.hosts.includes(url.hostname.replace(/^www\./, ''))
    );
  } catch {
    return false;
  }
}

export function galleryListing(spec: GallerySpec, value: string): boolean {
  return galleryHost(spec, value) && new RegExp(spec.listings).test(new URL(value).pathname);
}
