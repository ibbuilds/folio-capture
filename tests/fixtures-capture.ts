import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export async function captureFixture() {
  const base = `<!doctype html><html><head><title>Capture fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="A controlled design reference"><style>
    *{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;background:white;color:#123}header{height:60px;position:sticky;top:0;z-index:20;background:#123;color:white;padding:16px}
    main section{padding:40px;min-height:640px}h1,h2{margin:0 0 32px}#hero{background:#fff4de}#features{background:#cceeff}#features img{width:300px;max-width:100%;height:160px}footer{height:160px;background:#123;color:white;padding:40px}
    .nuisance{position:fixed;inset:0;z-index:1000;background:#ff00ff;display:flex;align-items:center;justify-content:center;flex-direction:column}
    .legit{position:fixed;right:40px;top:90px;width:300px;height:220px;background:#ff2200;z-index:200;padding:20px}
  </style></head><body><header>Fixture navigation</header><main><section id="hero"><h1>Editorial hero</h1><p>A complete composition with neighboring context.</p></section><section id="features"><h2>Feature comparison</h2><p>Images enter the viewport later.</p><img loading="lazy" src="IMAGE" alt="Lazy illustration"></section></main><footer>Fixture footer</footer>EXTRA</body></html>`;
  const server = createServer((req, res) => {
    const route = req.url?.split('?')[0];
    if (route === '/image.svg') {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="160"><rect width="300" height="160" fill="#0077aa"/><circle cx="150" cy="80" r="45" fill="#ffffff"/></svg>'); return;
    }
    if (route === '/broken.svg') { res.writeHead(404); res.end('missing'); return; }
    if (route === '/consent-frame') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<body style="margin:0"><div role="dialog" aria-modal="true" style="position:fixed;inset:0;background:#ff00ff">Cookies and privacy<button onclick="this.parentElement.remove()">Reject all</button></div></body>'); return;
    }
    let extra = '';
    if(route==='/neighbor-broken'){
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
      res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;font:18px Arial}section{height:500px;padding:32px}h1,h2{margin:0 0 24px}img{width:200px;height:100px}</style><main><section id="healthy"><h1>Healthy hero</h1><p>Complete section with no broken media.</p></section><section id="broken"><h2>Broken showcase</h2><img src="/broken.svg" alt="Broken neighbor"></section></main>');return;
    }
    if(route==='/semantic-wrapper'){
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
      res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;font:18px Arial}#intro,.chapter{height:650px;padding:40px}#intro{background:#fff4de}.chapter{background:#cceeff}.chapter:last-child{background:#eedddd}.cards{display:flex;gap:16px}.card{width:30%;height:180px;padding:20px;border:1px solid}h1,h2{margin:0 0 24px}</style><main><section id="page-wrapper"><div id="intro"><h1>Product introduction</h1><p>One complete hero.</p></div><section class="chapter" id="features"><h2><span style="display:block">Features</span><span style="display:block">Overview</span></h2><div class="cards"><section class="card"><h3>Speed</h3><p>Supporting detail</p></section><section class="card"><h3>Clarity</h3><p>Supporting detail</p></section></div></section><section class="chapter" id="proof"><h2>Customer stories</h2><p>A distinct complete composition.</p></section></section></main>');return;
    }
    if (route === '/recurrent') extra = `<script>
      function show(){if(document.querySelector('#newsletter-popup'))return;const modal=document.createElement('div');modal.id='newsletter-popup';modal.className='nuisance';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.innerHTML='<h2>Join our newsletter</h2><button>Close</button>';modal.querySelector('button').onclick=()=>{modal.remove();setTimeout(show,80)};document.body.append(modal)}setTimeout(show,20);
    </script>`;
    if (route === '/scan-race' || route === '/observer-race' || route === '/observer-gate-race') {
      const creation = `function inject(gate){const modal=document.createElement('div');modal.id='newsletter-popup';modal.className='nuisance';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.innerHTML=gate?'<h2>Account access</h2><p>Sign in to continue</p><button>Close</button>':'<h2>Join our newsletter</h2><button>Close</button>';modal.querySelector('button').onclick=()=>modal.remove();document.body.append(modal);window.raceInjections=(window.raceInjections||0)+1}`;
      if (route === '/scan-race') extra = `<script>${creation};const nativeQuery=Document.prototype.querySelectorAll;Document.prototype.querySelectorAll=function(selector){const snapshot=nativeQuery.call(this,selector);if(selector==='*'&&!window.raceInjections)inject(false);return snapshot}</script>`;
      else extra = `<script>${creation};inject(false);const NativeObserver=MutationObserver;window.MutationObserver=class extends NativeObserver{constructor(callback){inject(${route === '/observer-gate-race'});super(callback)}};</script>`;
    }
    if (route === '/cookie') extra = `<div id="onetrust-banner-sdk" class="nuisance" role="dialog" aria-modal="true"><h2>Cookies and privacy</h2><button id="onetrust-reject-all-handler" onclick="document.querySelector('#onetrust-banner-sdk').remove();window.rejected=true">Reject all</button><button onclick="window.accepted=true">Accept all</button></div>`;
    if (route === '/cookiebot-api') extra = '<div id="CybotCookiebotDialog" class="nuisance" role="dialog" aria-modal="true"><h2>Cookies and privacy</h2></div><script>window.Cookiebot={hasResponse:false,consent:{preferences:true,statistics:true,marketing:true},submitCustomConsent:function(p,s,m){this.consent={preferences:p,statistics:s,marketing:m};this.hasResponse=true;document.querySelector("#CybotCookiebotDialog").remove()}}</script>';
    if (route === '/apple-locale') extra = '<aside id="ac-localeswitcher" data-analytics-region="locale switcher" lang="es-MX" aria-label="Choose country or region" style="position:absolute;top:0;left:0;width:100%;height:70px;background:#ff00ff;z-index:90"><div class="ac-ls-content">Elige otro país o región <span>México</span><a id="ac-ls-continue" href="/mx/iphone-duo/" role="button" onclick="window.countryChanged=true">Continuar</a><button id="ac-ls-close" class="ac-ls-close" aria-label="Cerrar el selector de país o región" onclick="window.localeClosed=true;document.querySelector(\'#ac-localeswitcher\').remove()">×</button></div></aside>';
    if (route === '/country-design') extra = '<script>const section=document.createElement("div");section.id="country-product-design";section.innerHTML=\'<p>Choose country or region: México</p><button>Continuar</button>\';document.querySelector("#hero").append(section)</script>';
    if (route === '/eleven-floating') extra = '<div id="floating-voice" data-floating-agent style="position:fixed;left:16px;bottom:16px;width:343px;height:48px;background:#ff00ff;z-index:150"><button onclick="window.microphoneOpened=true">Voice chat</button></div><script>const demo=document.createElement("div");demo.id="inline-voice";demo.setAttribute("data-floating-agent","");demo.innerHTML=\'<button onclick="window.microphoneOpened=true">Voice chat</button>\';document.querySelector("#hero").append(demo)</script>';
    if (route === '/preserve') extra = '<div class="legit" role="dialog" aria-modal="true"><h2>Application editor</h2><p>A legitimate product composition.</p><button>Close</button></div>';
    if (route === '/unknown') extra = '<div class="nuisance" role="dialog" aria-modal="true"><h2>Account access</h2><p>Sign in to continue</p><button>Close</button></div>';
    if (route === '/shadow') extra = `<div id="consent-host"></div><script>const root=document.querySelector('#consent-host').attachShadow({mode:'open'});root.innerHTML='<style>.overlay{position:fixed;inset:0;background:#ff00ff;z-index:1000}</style><div id="shadow-cookie" class="overlay" role="dialog" aria-modal="true"><h2>Cookies and privacy</h2><button>Reject all</button></div>';root.querySelector('button').onclick=()=>root.querySelector('#shadow-cookie').remove();</script>`;
    if (route === '/iframe') extra = '<iframe title="Cookie consent" src="/consent-frame" style="position:fixed;bottom:0;left:0;width:100%;height:240px;z-index:900;border:0"></iframe>';
    if (route === '/native') extra = '<dialog id="native-newsletter" class="nuisance"><h2>Join our newsletter</h2><button>Close</button></dialog><script>document.querySelector("#native-newsletter").showModal()</script>';
    if (route === '/residual') extra = '<div id="residual-newsletter" class="nuisance" role="dialog" aria-modal="true"><h2>Join our newsletter</h2></div><script>document.body.style.overflow="hidden";document.querySelector("main").setAttribute("inert","");document.querySelector("main").style.filter="blur(4px)"</script>';
    if (route === '/swap') extra = '<script>const img=document.querySelector("#features img");const watch=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setTimeout(()=>img.src="/image.svg",180);watch.disconnect()}});watch.observe(img)</script>';
    if (route === '/reveal') extra = '<style>@keyframes reveal{from{opacity:0}to{opacity:1}}#hero{opacity:0}#hero.revealing{animation:reveal .35s .1s both}</style><script>const hero=document.querySelector("#hero");new IntersectionObserver(entries=>entries.forEach(entry=>hero.classList.toggle("revealing",entry.isIntersecting))).observe(hero)</script>';
    if (route === '/delayed-reveal' || route === '/hidden-section') extra = `<style>@keyframes reveal{from{opacity:0}to{opacity:1}}#hero{opacity:0}#hero.revealing{animation:reveal .2s .1s both}</style><script>
      const hero=document.querySelector('#hero'),nativeScroll=window.scrollTo.bind(window);let revealTimer;
      window.scrollTo=(...args)=>{nativeScroll(...args);clearTimeout(revealTimer);hero.classList.remove('revealing');if(scrollY<700&&${route !== '/hidden-section'})revealTimer=setTimeout(()=>hero.classList.add('revealing'),600)};
      window.scrollTo({top:0,behavior:'instant'});
    </script>`;
    if (route === '/clipped-media') extra = '<script>const box=document.createElement("div");box.style.cssText="position:relative;width:250px;height:120px;overflow:hidden";box.innerHTML=\'<img src="/broken.svg" style="position:absolute;left:270px;top:0;width:300px;height:100px">\';document.querySelector("#hero").append(box)</script>';
    if (route === '/infinite') extra = `<script>addEventListener('scroll',()=>{if(scrollY+innerHeight>=document.documentElement.scrollHeight-50){const section=document.createElement('section');section.style.height='800px';section.innerHTML='<h2>More content</h2>';document.querySelector('main').append(section)}})</script>`;
    if (route === '/nested') extra = '<div style="height:400px;overflow:auto;width:100%;position:relative" id="internal"><div style="height:1800px">An internally scrolling application view</div></div>';
    let html = base.replace('IMAGE', route === '/broken' || route === '/swap' ? '/broken.svg' : '/image.svg').replace('EXTRA', extra);
    if(route==='/real-sections'||route==='/wrapped-sections'){
      const names=['Overview','Company details','Invisible Approach','Our Progress','Scientific Evidence','Driven by People'];
      html=`<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;font:18px Arial}header{height:100vh;background:#ffeccc;padding:40px}main{position:relative}main>section{height:720px;padding:40px;background:#def}main>section:nth-child(even){background:#cba}h1,h2{margin:0 0 24px}.decoration{position:absolute;inset:0;pointer-events:none}.card{display:inline-block;width:30%;height:220px;border:1px solid;padding:20px}footer{height:300px;padding:40px}</style><body><header id="hero"><h1>Beyond Humanware</h1></header><main>${names.map((name,i)=>`<section id="chapter-${i}"><h2>${name}</h2><p>A complete page chapter with its own visual composition.</p>${i===3?['One','Two','Three'].map(card=>`<section class="card"><h3>${card}</h3><p>Supporting card content inside the Progress section.</p></section>`).join(''):''}</section>`).join('')}<div class="decoration" aria-hidden="true"><svg width="100%" height="100%"><path d="M0 0L10 10"/></svg></div></main><footer><h2>Footer</h2></footer></body></html>`;
      if(route==='/wrapped-sections')html=html.replaceAll('<section','<div').replaceAll('</section>','</div>').replaceAll('main>section','.page-wrapper>div:not(.decoration)').replace('<main>','<main><div class="page-wrapper">').replace('</main>','</div></main>');
    }
    if(route==='/static-tail'||route==='/floating-navigation'||route==='/scroll-evidence'){
      const nav=route==='/floating-navigation'?'<div style="position:fixed;top:20px;left:0;width:100%;height:50px;z-index:10"><nav style="height:50px;background:#ff00ff">Floating site navigation</nav></div>':'';
      const content=route==='/scroll-evidence'?'<div id="scene" style="height:1800px"><div style="position:sticky;top:0;height:600px"><h2 id="state-title"></h2></div></div><script>function state(){document.querySelector("#state-title").innerText=scrollY>600?"Later visible state":"";}addEventListener("scroll",state);state();</script>':'<section id="tail" style="height:605px;background:#cceeff"><h2>End section</h2><p>Complete static content</p></section>';
      html=`<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:Arial}*{box-sizing:border-box}h2{margin:0;padding-top:80px}</style><body>${nav}<main>${route==='/floating-navigation'?'<section style="height:600px"><h2>Hero with navigation</h2></section>':''}${content}</main></body></html>`;
    }
    if (route === '/no-meta') html = html.replace('<meta name="viewport" content="width=device-width,initial-scale=1">', '');
    if (route === '/nested') html = html.replace('</main>', '<section id="nested-section" style="height:640px"><h2>Scrollable pane</h2><div style="height:400px;overflow:auto;width:100%" id="internal-pane"><div style="height:1800px">Internal content</div></div></section></main>');
    if (route === '/horizontal' || route === '/horizontal-budget') {
      const cards = Array.from({ length: route === '/horizontal-budget' ? 30 : 3 }, (_, index) => `<div style="flex:0 0 300px;height:340px;background:${['#cc3344', '#33aa77', '#3377aa'][index % 3]};padding:20px"><h3>Project ${index + 1}</h3>${index === 2 ? '<img loading="lazy" src="/image.svg" alt="Later carousel artwork" style="width:260px;height:160px">' : '<p>Observed public carousel state</p>'}</div>`).join('');
      html = html.replace('</main>', `<section id="carousel-section"><h2>Project carousel</h2><div id="carousel" style="display:flex;gap:24px;overflow-x:auto;width:100%;height:360px">${cards}</div></section></main><script>document.querySelector('#carousel').scrollLeft=120</script>`);
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
