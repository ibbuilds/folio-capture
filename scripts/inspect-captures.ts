import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import sharp from 'sharp';
import { Store } from '../src/store.ts';
import { inside, atomicJson } from '../src/utils.ts';

const output=resolve(process.argv[2] ?? 'validation-output/live');
const audit=join(output,'reports','visual-audit');await mkdir(audit,{recursive:true});
const store=new Store(output);const captures=store.latestCaptures();store.close();
const sheets:Array<{page:string;profile:string;sheet:string;frames:Array<{region:string;image:string}>}>=[];
const xml=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
for(const capture of captures){
  if(!capture.manifest)continue;
  for(const variant of capture.manifest.variants){
    const frames=variant.regions.flatMap(region=>region.frames.map((frame,i)=>({region:region.title,image:frame.path,thumbnail:frame.thumbnail,label:`${region.order+1}. ${region.title.slice(0,48)} / ${i+1}`})));
    for(let start=0;start<frames.length;start+=12){
      const slice=frames.slice(start,start+12);const columns=4,w=480,h=350,pad=16,top=58;
      const width=columns*w+(columns+1)*pad;const height=Math.ceil(slice.length/columns)*(h+pad)+top;
      const composites:sharp.OverlayOptions[]=[];
      const header=`<svg width="${width}" height="${height}"><rect width="100%" height="100%" fill="#eee"/><text x="16" y="30" font-family="Arial" font-size="20">${xml(new URL(capture.manifest.requestedUrl).hostname)} — ${xml(variant.profile.id)} — frames ${start+1}–${start+slice.length}</text></svg>`;
      for(const [i,frame]of slice.entries()){
        const x=pad+(i%columns)*(w+pad),y=top+Math.floor(i/columns)*(h+pad);
        const image=await sharp(inside(inside(output,capture.directory),frame.thumbnail)).resize(w,h-32,{fit:'contain',background:'#fff'}).png().toBuffer();
        composites.push({input:image,left:x,top:y+32});
        composites.push({input:Buffer.from(`<svg width="${w}" height="32"><rect width="100%" height="100%" fill="white"/><text x="8" y="21" font-family="Arial" font-size="13">${xml(frame.label)}</text></svg>`),left:x,top:y});
      }
      const sheet=`${capture.pageId}-${variant.profile.id}-${Math.floor(start/12)+1}.jpg`;
      await sharp(Buffer.from(header)).composite(composites).jpeg({quality:90}).toFile(join(audit,sheet));
      sheets.push({page:capture.manifest.requestedUrl,profile:variant.profile.id,sheet,frames:slice.map(f=>({region:f.region,image:`${capture.directory}/${f.image}`}))});
    }
  }
}
await atomicJson(join(audit,'sheets.json'),sheets);
console.log(JSON.stringify({sheets:sheets.length,frames:sheets.reduce((n,s)=>n+s.frames.length,0),directory:audit},null,2));
