import { discoverRefero, isReferoLibrary, resolveReferoEntry } from './discovery.ts';
import { discoverRecent, isRecentLibrary, resolveRecentEntry } from './recent.ts';
import { discoverGallery, resolveGallery } from './gallery.ts';
import { GALLERY_SPECS, galleryListing } from './library-specs.ts';
import type { DiscoveredEntry } from './types.ts';
export type LibraryAdapter = { id:string; matches:(url:string)=>boolean; discover:typeof discoverRefero; resolve:(options:Parameters<typeof resolveReferoEntry>[0] & {entry?:DiscoveredEntry})=>ReturnType<typeof resolveReferoEntry> };
export const LIBRARY_ADAPTERS:LibraryAdapter[]=[
  {id:'refero-styles',matches:isReferoLibrary,discover:discoverRefero,resolve:resolveReferoEntry},
  {id:'recent',matches:isRecentLibrary,discover:discoverRecent,resolve:resolveRecentEntry},
  ...GALLERY_SPECS.map(spec=>({id:spec.id,matches:(url:string)=>galleryListing(spec,url),discover:(options:Parameters<typeof discoverRefero>[0])=>discoverGallery(spec,options),resolve:(options:Parameters<LibraryAdapter['resolve']>[0])=>resolveGallery(spec,options)})),
];
export function libraryAdapter(url:string):LibraryAdapter|undefined{return LIBRARY_ADAPTERS.find(adapter=>adapter.matches(url));}
export function isKnownLibrary(value:string):boolean {
  const hostname=new URL(value).hostname.replace(/^www\./,'');
  return ['styles.refero.design','refero.design','recent.design','godly.website',...GALLERY_SPECS.flatMap(spec=>spec.hosts)].includes(hostname);
}
