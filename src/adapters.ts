import { discoverRefero, isReferoLibrary, resolveReferoEntry } from './discovery.ts';
import { discoverRecent, isRecentLibrary, resolveRecentEntry } from './recent.ts';
export type LibraryAdapter = { id:string; matches:(url:string)=>boolean; discover:typeof discoverRefero; resolve:typeof resolveReferoEntry };
export const LIBRARY_ADAPTERS:LibraryAdapter[]=[
  {id:'refero-styles',matches:isReferoLibrary,discover:discoverRefero,resolve:resolveReferoEntry},
  {id:'recent',matches:isRecentLibrary,discover:discoverRecent,resolve:resolveRecentEntry},
];
export function libraryAdapter(url:string):LibraryAdapter|undefined{return LIBRARY_ADAPTERS.find(adapter=>adapter.matches(url));}
export function isKnownLibrary(value:string):boolean {
  const hostname=new URL(value).hostname.replace(/^www\./,'');
  return ['styles.refero.design','refero.design','recent.design','godly.website','refs.gallery','siteofsites.co','a1.gallery','awwwards.com','minimal.gallery','siteinspire.com','curated.design','lapa.ninja','landingfolio.com','saaspo.com','hoverstat.es'].includes(hostname);
}
