/* Service worker do app instalável (tela inicial do celular).
   Estratégia "rede primeiro": sempre busca a versão mais nova do site
   (pra cada atualização colada no GitHub chegar logo em quem instalou) e
   só usa a cópia guardada se o celular estiver sem internet.
   Só mexe nos arquivos deste próprio site — Firebase, fontes e outras
   bibliotecas externas passam direto, sem cache. */
var CACHE = 'pontos-te-v1';

self.addEventListener('install', function(){ self.skipWaiting(); });

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e){
  var req = e.request;
  if(req.method !== 'GET') return;
  var url = new URL(req.url);
  if(url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then(function(res){
      if(res && res.ok){
        var copia = res.clone();
        caches.open(CACHE).then(function(c){ c.put(req, copia); });
      }
      return res;
    }).catch(function(){
      return caches.match(req).then(function(r){ return r || caches.match('./'); });
    })
  );
});
