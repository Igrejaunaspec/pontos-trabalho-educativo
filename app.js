(function(){
"use strict";

/* ============================================================
   State load — preenchido pelo firebase-init.js após o login
   (window.__pontosBoot) e a cada mudança remota (window.__pontosApplyRemote)
   ============================================================ */
var STATE = null;
var UI = null;
var MODE = 'admin'; // 'admin' | 'aluno'
function freshUI(){
  return {
    view: 'dashboard',
    drawerId: null,        // student id shown in profile drawer
    drawerEdit: false,
    drawerCreate: false,
    alunoFiltroSetor: 'todos',
    alunoFiltroNivel: 'todos',
    alunoBusca: '',
    alunoAberto: null,      // id do aluno com o card-acordeão aberto (mobile)
    punchMode: 'lider',     // 'lider' | 'aluno'
    punchSetor: (STATE.setores[0] || {}).id || '',
    punchSelected: null,
    punchSearch: '',
    punchBulkMode: false,
    punchBulkSelected: [],
    aprovandoCadastroUid: null,
    aprovandoCadastroDados: null,
    pedidosTab: 'pendentes',
    configTab: 'bolsas',
    calendarioAlunoId: null,
    calendarioBusca: '',
    calendarioDiaSel: null,
    calendarioDiaPreview: null,
    calendarioMesOffset: 0,
    calendarioEditandoRegistroId: null
  };
}
var SYNC = 'idle'; // idle | busy | off

/* ============================================================
   Acordeões (Alunos / Ponto) — animação max-height coreografada
   com flags transientes fora de UI (freshUI() não deve resetá-las)
   ============================================================ */
var PENDING_OPEN_KEY = null;
var PENDING_CLOSE_KEY = null;
function toggleAccordion(fieldName, id){
  var key = fieldName+':'+id;
  if(UI[fieldName] === id){
    PENDING_CLOSE_KEY = key;
    UI[fieldName] = null;
  } else {
    if(UI[fieldName]){ PENDING_CLOSE_KEY = fieldName+':'+UI[fieldName]; }
    UI[fieldName] = id;
    PENDING_OPEN_KEY = key;
  }
}
function accordionPanelClass(fieldName, id){
  var key = fieldName+':'+id;
  var isOpen = UI[fieldName] === id;
  var isClosing = PENDING_CLOSE_KEY === key;
  var cls = 'acc-panel';
  if((isOpen && PENDING_OPEN_KEY!==key) || isClosing) cls += ' acc-open';
  return cls;
}
function accordionShouldRender(fieldName, id){
  var key = fieldName+':'+id;
  return UI[fieldName]===id || PENDING_CLOSE_KEY===key;
}
function syncAccordionAnimations(){
  if(PENDING_OPEN_KEY){
    var key = PENDING_OPEN_KEY; PENDING_OPEN_KEY = null;
    var el = document.querySelector('[data-acc-key="'+key+'"]');
    if(el){ void el.offsetHeight; requestAnimationFrame(function(){ el.classList.add('acc-open'); }); }
  }
  if(PENDING_CLOSE_KEY){
    var key2 = PENDING_CLOSE_KEY;
    var el2 = document.querySelector('[data-acc-key="'+key2+'"]');
    if(el2){ void el2.offsetHeight; requestAnimationFrame(function(){ el2.classList.remove('acc-open'); }); }
    setTimeout(function(){ if(PENDING_CLOSE_KEY===key2) PENDING_CLOSE_KEY=null; render(); }, 260);
  }
}

var DIAS_SEMANA = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
var MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
var DIAS_SEMANA_CURTO_SEG = ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom']; // segunda-feira primeiro (calendário de 30 dias)
// Código de dia da semana por índice de Date.getDay() (0=domingo..6=sábado) — usado
// pra bater o dia real do calendário contra os "dias de trabalho" combinados do aluno.
var DIA_SEMANA_CODE = ['dom','seg','ter','qua','qui','sex','sab'];
// Opções do seletor de "dias de trabalho" (caixinhas no cadastro do aluno), na ordem
// de exibição Seg..Dom.
var DIAS_TRABALHO_OPTS = [
  {code:'seg', label:'Seg'}, {code:'ter', label:'Ter'}, {code:'qua', label:'Qua'},
  {code:'qui', label:'Qui'}, {code:'sex', label:'Sex'}, {code:'sab', label:'Sáb'}, {code:'dom', label:'Dom'}
];
/* Lê s.diasTrabalho (string "seg,ter,qua,qui,sex" salva pelas caixinhas do cadastro)
   como array de códigos válidos. Cadastros antigos, salvos como texto livre (ex.:
   "Seg a sex.") antes dessa mudança, não batem com nenhum código — ficam de fora do
   array (não quebra nada, só não participa do destaque de falta/dia extra no
   Calendário até alguém reabrir o cadastro e marcar as caixinhas certas). */
function diasTrabalhoArray(s){
  var codigos = DIAS_TRABALHO_OPTS.map(function(o){return o.code;});
  return String((s && s.diasTrabalho) || '').split(',').map(function(x){return x.trim().toLowerCase();})
    .filter(function(x){ return codigos.indexOf(x) !== -1; });
}
/* Texto pra exibir nas telas de listagem/perfil — converte os códigos salvos de volta
   pros rótulos (Seg, Ter…). Se o cadastro ainda tiver o texto livre antigo (não bate
   com nenhum código), mostra esse texto como está, pra não perder a informação. */
function diasTrabalhoLabel(s){
  var arr = diasTrabalhoArray(s);
  if(arr.length){
    var map = {}; DIAS_TRABALHO_OPTS.forEach(function(o){ map[o.code]=o.label; });
    return arr.map(function(c){ return map[c]; }).join(', ');
  }
  return (s && s.diasTrabalho) || '';
}

/* ============================================================
   Small utilities
   ============================================================ */
function $(sel, root){ return (root||document).querySelector(sel); }
function $all(sel, root){ return Array.prototype.slice.call((root||document).querySelectorAll(sel)); }
function esc(s){
  s = (s===undefined || s===null) ? '' : String(s);
  return s.replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
function uid(prefix){
  return (prefix||'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
}
function pad2(n){ return String(n).length < 2 ? '0'+n : String(n); }
function nowISO(){ return new Date().toISOString(); }
function todayKey(d){ d = d || new Date(); return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate()); }
// Compara pelo dia LOCAL de verdade (não a data UTC do ISO): à noite, em
// fusos negativos (ex.: Brasil, UTC-3), o "dia" em UTC de um horário como
// 22h já virou o dia seguinte — comparar strings cruas (iso.slice(0,10))
// contra a data local de hoje classificava erradamente um registro de
// hoje à noite como "de outro dia" (ou "sem registro hoje").
function sameDay(iso, d){
  if(!iso) return false;
  var a = new Date(iso);
  var b = d || new Date();
  return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
}
// Meia-noite local de hoje (ou do dia de "d"), como ISO — para usar como
// limite de "desde o início do dia" em minutosTrabalhados(). Diferente de
// todayKey()+'T00:00:00.000Z', que tratava a meia-noite LOCAL como se
// fosse meia-noite UTC (errado fora do fuso UTC+0).
function localMidnightISO(d){
  d = d || new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).toISOString();
}
function fmtDateTime(iso){
  if(!iso) return '—';
  var d = new Date(iso);
  return pad2(d.getDate())+'/'+pad2(d.getMonth()+1)+' '+pad2(d.getHours())+':'+pad2(d.getMinutes());
}
function fmtTime(iso){
  if(!iso) return '—';
  var d = new Date(iso);
  return pad2(d.getHours())+':'+pad2(d.getMinutes());
}
function fmtDateBR(iso){
  if(!iso) return '—';
  var parts = iso.split('-');
  if(parts.length!==3) return iso;
  return parts[2]+'/'+parts[1]+'/'+parts[0];
}
function fmtHoras(mins){
  if(!mins || mins<=0) return '0h';
  var h = Math.floor(mins/60), m = Math.round(mins%60);
  if(m===60){ h += 1; m = 0; } // arredondamento de ponto flutuante (ex.: 239.999min)
  return m>0 ? (h+'h'+pad2(m)) : (h+'h');
}
function initials(nome){
  var parts = (nome||'').trim().split(/\s+/).filter(Boolean);
  if(!parts.length) return '?';
  var a = parts[0][0] || '';
  var b = parts.length>1 ? parts[parts.length-1][0] : '';
  return (a+b).toUpperCase();
}
function setorNome(id){
  var s = STATE.setores.filter(function(x){return x.id===id;})[0];
  return s ? s.nome : id;
}
function isConservacao(s){
  if(!s) return false;
  var nome = s.setorNome || setorNome(s.setor) || '';
  return nome.toLowerCase().indexOf('conserv') !== -1;
}
function studentById(id){
  return STATE.students.filter(function(s){return s.id===id;})[0] || null;
}
function nivelLabel(n){ return n==='EM' ? 'Ensino Médio' : 'Faculdade'; }

function pendenteKind(txt){
  if(!txt) return 'muted';
  var t = txt.trim().toLowerCase();
  if(t==='ok') return 'ok';
  var n = parseInt(t,10);
  if(!isNaN(n)){
    if(n<=8) return 'warn';
    return 'crit';
  }
  return 'muted';
}

/* ============================================================
   Domain calculations
   ============================================================ */
function registrosDoAluno(id){
  return STATE.registros.filter(function(r){return r.studentId===id;})
    .sort(function(a,b){return new Date(a.ts) - new Date(b.ts);});
}
function ultimoRegistro(id){
  var list = registrosDoAluno(id);
  return list.length ? list[list.length-1] : null;
}
function proximoTipo(id){
  var last = ultimoRegistro(id);
  if(!last || last.tipo === 'saida') return 'entrada';
  return 'saida';
}
function minutosTrabalhados(id, sinceISO, untilISO){
  var list = registrosDoAluno(id);
  if(!list.length) return 0;
  // Soma dia a dia (reaproveitando minutosNoDia, que já casa entrada/saída
  // só dentro do MESMO dia) em vez de uma pilha única passando por toda a
  // lista de registros. Isso é de propósito: uma pilha "global" casa a
  // entrada de um dia com a saída de outro dia quando falta uma saída no
  // meio — por exemplo, esqueceu de bater a saída num dia e só bateu de
  // novo dias depois — e aí "soma" um turno fantasma de vários dias
  // seguidos como se fosse uma hora só trabalhada. Somando por dia, um par
  // incompleto (só entrada, sem saída naquele dia, ou vice-versa) não soma
  // nada e não "vaza" pro dia seguinte.
  var inicioRef = sinceISO ? new Date(sinceISO) : new Date(list[0].ts);
  var inicio = new Date(inicioRef.getFullYear(), inicioRef.getMonth(), inicioRef.getDate());
  var fimRef = untilISO ? new Date(untilISO) : new Date(Date.now() + 86400000);
  var fim = new Date(fimRef.getFullYear(), fimRef.getMonth(), fimRef.getDate());
  var total = 0;
  var cursor = new Date(inicio);
  while(cursor < fim){
    total += minutosNoDia(id, cursor);
    cursor.setDate(cursor.getDate()+1);
  }
  return total;
}
/* Intervalo [início, fimExclusivo) do mês atual e do mês anterior, meia-noite
   local, como ISO — para bater "horas devidas este mês" (contra a meta
   proporcional aos dias já passados) e "horas do mês passado" (total do mês
   fechado). "dias" é o total de dias corridos daquele mês, usado na meta. */
function mesAtualRangeISO(){
  var hoje = new Date();
  var inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  var fim = new Date(hoje.getFullYear(), hoje.getMonth()+1, 1);
  return {inicio: localMidnightISO(inicio), fim: localMidnightISO(fim), dias: hoje.getDate()};
}
function mesAnteriorRangeISO(){
  var hoje = new Date();
  var inicio = new Date(hoje.getFullYear(), hoje.getMonth()-1, 1);
  var fim = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  var dias = Math.round((fim-inicio)/86400000);
  return {inicio: localMidnightISO(inicio), fim: localMidnightISO(fim), dias: dias};
}
/* Saldo de horas devidas no mês ATUAL (desde o dia 1 até hoje) contra a
   carga horária semanal cadastrada, proporcional aos dias já passados no
   mês — mesma lógica de saldoMesInfo(), reaproveitada aqui para o card do
   calendário do aluno. */
function horasDevidasMesAtual(s){
  if(!s.horasSemana) return {saldo: null, minsTrabalhados: 0};
  var r = mesAtualRangeISO();
  var mins = minutosTrabalhados(s.id, r.inicio, r.fim);
  var meta = (s.horasSemana||0) * 60 * (r.dias/7);
  return {saldo: mins - meta, minsTrabalhados: mins};
}
/* Total de horas trabalhadas no mês PASSADO (mês fechado, do dia 1 ao
   último dia) — para o card "Horas do mês passado" do calendário do aluno. */
function horasMesPassado(s){
  var r = mesAnteriorRangeISO();
  var mins = minutosTrabalhados(s.id, r.inicio, r.fim);
  var info = {minsTrabalhados: mins, saldo: null};
  if(s.horasSemana){
    var meta = (s.horasSemana||0) * 60 * (r.dias/7);
    info.saldo = mins - meta;
  }
  return info;
}
/* Dias com registro e total de horas do mês ATUAL (dia 1 até hoje), mesma
   contagem usada no calendário do admin (dia incompleto/sem par não soma) —
   reaproveitado no painel do próprio aluno para os cards de resumo. */
function resumoMesAtualAluno(s){
  var hoje = new Date(); hoje.setHours(0,0,0,0);
  var ultimoDiaMes = new Date(hoje.getFullYear(), hoje.getMonth()+1, 0).getDate();
  var totalDiasComRegistro = 0, totalMin = 0;
  for(var dnum=1; dnum<=hoje.getDate(); dnum++){
    var d = new Date(hoje.getFullYear(), hoje.getMonth(), dnum);
    var mins = minutosNoDia(s.id, d);
    if(registrosDoAlunoNoDia(s.id, d).length > 0) totalDiasComRegistro++;
    totalMin += mins;
  }
  return {totalDiasComRegistro: totalDiasComRegistro, ultimoDiaMes: ultimoDiaMes, totalMin: totalMin, mesLabel: MESES[hoje.getMonth()]};
}
/* Registros de um aluno num dia específico (calendário local), já ordenados. */
function registrosDoAlunoNoDia(id, d){
  var iniISO = localMidnightISO(d);
  var fimISO = localMidnightISO(new Date(d.getFullYear(), d.getMonth(), d.getDate()+1));
  return registrosDoAluno(id).filter(function(r){ return r.ts >= iniISO && r.ts < fimISO; });
}
/* Minutos trabalhados num único dia — casa entrada/saída só dentro desse dia
   (pilha reiniciada a cada chamada). Base de minutosTrabalhados() acima
   (que soma isso dia a dia) e também usada direto no calendário do aluno. */
function minutosNoDia(id, d){
  var list = registrosDoAlunoNoDia(id, d);
  var total = 0, pilha = [];
  for(var i=0;i<list.length;i++){
    var r = list[i];
    if(r.tipo === 'entrada'){
      pilha.push(r.ts);
    } else if(r.tipo === 'saida' && pilha.length){
      total += (new Date(r.ts) - new Date(pilha.pop())) / 60000;
    }
  }
  return total;
}
function horasSemanaLabel(s){
  if(s.horasSemana === null || s.horasSemana === undefined) return '—';
  return s.horasSemana + 'h/sem';
}
function pontosDoAluno(id){
  var mins = minutosTrabalhados(id);
  return Math.round((mins/60) * (STATE.pontosPorHora || 1) * 10) / 10;
}
function aniversariantesDoMes(){
  var m = new Date().getMonth();
  return STATE.students.filter(function(s){
    if(!s.aniversario) return false;
    var mm = parseInt(s.aniversario.slice(5,7),10) - 1;
    return mm === m;
  }).sort(function(a,b){ return parseInt(a.aniversario.slice(8,10),10) - parseInt(b.aniversario.slice(8,10),10); });
}
function pedidosPendentes(){
  return STATE.pedidos.filter(function(p){return p.status==='pendente';})
    .sort(function(a,b){ return new Date(a.criadoEm) - new Date(b.criadoEm); });
}
function logAtividade(texto){
  STATE.activityLog.unshift({ts: nowISO(), texto: texto});
  if(STATE.activityLog.length > 60) STATE.activityLog.length = 60;
}
function addRegistro(rec){
  STATE.registros.push(rec);
  if(typeof window.__pontosAddRegistro === 'function') window.__pontosAddRegistro(rec);
}
/* Desfazer um registro de ponto (usado pelo botão "Desfazer" que aparece
   logo depois de bater o ponto por engano). */
function removeRegistro(id){
  STATE.registros = STATE.registros.filter(function(r){ return r.id !== id; });
  if(typeof window.__pontosDeleteRegistro === 'function') window.__pontosDeleteRegistro(id);
}
/* Corrige o horário de um registro já batido (ex.: aluno bateu 8h05 mas era
   8h00) direto pelo Calendário, sem precisar passar por pedido de ajuste —
   usado pela edição inline no card do dia selecionado. */
function updateRegistro(id, patch){
  var r = STATE.registros.filter(function(x){ return x.id===id; })[0];
  if(r) Object.assign(r, patch);
  if(typeof window.__pontosUpdateRegistro === 'function') window.__pontosUpdateRegistro(id, patch);
}
function addPedido(rec){
  STATE.pedidos.push(rec);
  if(typeof window.__pontosAddPedido === 'function') window.__pontosAddPedido(rec);
}
function updatePedidoRemoto(id, patch){
  if(typeof window.__pontosUpdatePedido === 'function') window.__pontosUpdatePedido(id, patch);
}
function pedidoStatusLabel(status){
  return status==='pendente' ? 'Pendente' : status==='aprovado' ? 'Aprovado' : 'Rejeitado';
}
function pedidoStatusCls(status){
  return status==='pendente' ? 'pill-muted' : status==='aprovado' ? 'pill-ok' : 'pill-crit';
}
function mondayDaSemanaISO(){
  var d = new Date();
  var day = d.getDay(); // 0 = domingo
  var diff = (day===0) ? 6 : day-1; // dias desde a última segunda-feira
  d.setDate(d.getDate()-diff);
  d.setHours(0,0,0,0);
  return d.toISOString();
}

/* Saldo de horas da semana atual (desde a última segunda) contra a carga
   horária cadastrada — usado tanto no perfil do próprio aluno quanto na
   lista de Alunos (coluna "Saldo da semana", no lugar da antiga pendência
   herdada da planilha). Só o cálculo é compartilhado; cada tela escolhe
   sua própria frase a partir de "saldo"/"cls". */
function saldoSemanaInfo(s){
  var minsSemana = minutosTrabalhados(s.id, mondayDaSemanaISO());
  var metaSemana = (s.horasSemana||0) * 60;
  var saldo = minsSemana - metaSemana;
  if(!s.horasSemana){
    return {saldo: null, cls: 'pill-muted'};
  }
  return {saldo: saldo, cls: saldo>=0 ? 'pill-ok' : 'pill-crit'};
}
/* Versão compacta para a lista/tabela de Alunos: mostra em destaque quantas
   horas negativas (devendo) faltam cumprir esta semana. */
function saldoPill(s){
  var info = saldoSemanaInfo(s);
  var txt = info.saldo===null ? 'Carga não definida'
    : info.saldo<0 ? fmtHoras(-info.saldo)+' devendo esta semana'
    : info.saldo>0 ? '+'+fmtHoras(info.saldo)+' esta semana'
    : 'Em dia esta semana';
  return '<span class="pill '+info.cls+'">'+esc(txt)+'</span>';
}

/* ============================================================
   Toasts
   ============================================================ */
function toast(msg, kind, opts){
  var stack = $('#toast-stack');
  if(!stack) return;
  opts = opts || {};
  var el = document.createElement('div');
  el.className = 'toast' + (kind ? ' '+kind : '') + (opts.actionLabel ? ' toast-actionable' : '');
  var msgEl = document.createElement('span');
  msgEl.className = 'toast-msg';
  msgEl.textContent = msg;
  el.appendChild(msgEl);
  var dur = opts.duration || 3600;
  if(opts.actionLabel && typeof opts.onAction === 'function'){
    dur = opts.duration || 8000;
    var actionBtn = document.createElement('button');
    actionBtn.type = 'button';
    actionBtn.className = 'toast-action';
    actionBtn.textContent = opts.actionLabel;
    actionBtn.addEventListener('click', function(){
      el.remove();
      opts.onAction();
    });
    el.appendChild(actionBtn);
  }
  stack.appendChild(el);
  setTimeout(function(){ el.remove(); }, dur);
}

/* ============================================================
   Persistence — delega para o Firebase (firebase-init.js).
   window.__pontosSaveState(state) grava no Firestore e sincroniza
   automaticamente com todas as telas abertas via onSnapshot.
   ============================================================ */
function persist(){
  render();
  saveState();
}
function saveState(){
  SYNC = 'busy';
  updateSyncPill();
  if(typeof window.__pontosSaveState !== 'function'){
    SYNC = 'off';
    updateSyncPill();
    return;
  }
  window.__pontosSaveState(STATE).then(function(){
    SYNC = 'idle';
    updateSyncPill();
  }).catch(function(){
    SYNC = 'off';
    updateSyncPill();
    toast('Não foi possível salvar agora. Verifique sua conexão.', 'err');
  });
}
function updateSyncPill(){
  var dots = $all('.sync-dot'), labels = $all('.sync-label');
  if(!dots.length) return;
  var cls = 'sync-dot' + (SYNC==='busy' ? ' busy' : SYNC==='off' ? ' off' : '');
  var text = SYNC==='busy' ? 'Salvando…' : SYNC==='off' ? 'Falha ao salvar' : 'Sincronizado';
  dots.forEach(function(d){ d.className = cls; });
  labels.forEach(function(l){ l.textContent = text; });
}

/* ============================================================
   Views
   ============================================================ */
var NAV = [
  {id:'dashboard', label:'Visão geral', ico:'▣'},
  {id:'alunos', label:'Alunos', ico:'☰'},
  {id:'ponto', label:'Registrar ponto', ico:'●'},
  {id:'calendario', label:'Calendário', ico:'▦'},
  {id:'pedidos', label:'Pedidos de ajuste', ico:'✉'},
  {id:'config', label:'Configurações', ico:'⚙'}
];
var NAV_SHORT = {dashboard:'Início', alunos:'Alunos', ponto:'Ponto', calendario:'Calendário', pedidos:'Pedidos', config:'Ajustes'};

function render(){
  var app = $('#app');
  var today = new Date();
  var dateLabel = DIAS_SEMANA[today.getDay()] + ', ' + today.getDate() + ' de ' + MESES[today.getMonth()] + ' de ' + today.getFullYear();

  var pend = pedidosPendentes().length;
  var cadPend = (STATE.cadastrosPendentes||[]).length;
  var navBadge = {pedidos: pend, alunos: cadPend};

  var navHtml = NAV.map(function(n){
    var n2 = navBadge[n.id] || 0;
    var badge = n2>0 ? '<span class="count">'+n2+'</span>' : '';
    return '<button class="nav-btn' + (UI.view===n.id?' active':'') + '" data-nav="'+n.id+'">' +
      '<span class="ico">'+n.ico+'</span><span>'+n.label+'</span>'+badge+'</button>';
  }).join('');

  var bottomNavHtml = NAV.map(function(n){
    var n2 = navBadge[n.id] || 0;
    var badge = n2>0 ? '<span class="count">'+n2+'</span>' : '';
    return '<button class="bottom-nav-btn' + (UI.view===n.id?' active':'') + '" data-nav="'+n.id+'">' +
      '<span class="ico">'+n.ico+badge+'</span><span class="label">'+(NAV_SHORT[n.id]||n.label)+'</span></button>';
  }).join('');

  app.innerHTML =
    '<nav class="sidebar">' +
      '<div class="brand"><span class="mark">' + esc(STATE.orgName) + '</span><span class="sub">Pontos &amp; presença de bolsistas</span></div>' +
      '<div class="nav">' + navHtml + '</div>' +
      '<div class="sidebar-foot">' +
        '<div class="sync-pill"><span class="sync-dot"></span><span class="sync-label">Sincronizado</span></div>' +
        '<button class="btn btn-ghost btn-sm logout-btn" type="button">Sair</button>' +
      '</div>' +
    '</nav>' +
    '<header class="mobile-topbar">' +
      '<span class="mobile-topbar-mark">' + esc(STATE.orgName) + '</span>' +
      '<div class="mobile-topbar-actions">' +
        '<span class="sync-pill sync-pill-compact" aria-hidden="true"><span class="sync-dot"></span></span>' +
        '<button class="logout-btn" type="button" aria-label="Sair">⏻</button>' +
      '</div>' +
    '</header>' +
    '<main class="main"><div class="view" id="view-root"></div></main>' +
    '<nav class="bottom-nav" aria-label="Navegação principal">' + bottomNavHtml + '</nav>';

  var root = $('#view-root');
  if(UI.view === 'dashboard') root.innerHTML = viewDashboard(dateLabel);
  else if(UI.view === 'alunos') root.innerHTML = viewAlunos();
  else if(UI.view === 'ponto') root.innerHTML = viewPonto();
  else if(UI.view === 'calendario') root.innerHTML = viewCalendario();
  else if(UI.view === 'pedidos') root.innerHTML = viewPedidos();
  else if(UI.view === 'config') root.innerHTML = viewConfig();

  if(!$('.toast-stack')){
    var stack = document.createElement('div');
    stack.className = 'toast-stack';
    stack.id = 'toast-stack';
    document.body.appendChild(stack);
  }

  updateSyncPill();
  bindEvents();
  if(UI.drawerId || UI.drawerCreate) renderDrawer();
  if(UI.calendarioDiaSel) renderCalendarioDiaModal();
  else { var strayDiaModal = $('.overlay.overlay-center'); if(strayDiaModal) strayDiaModal.remove(); }
  syncAccordionAnimations();
}

function viewDashboard(dateLabel){
  var total = STATE.students.filter(function(s){return s.ativo;}).length;
  var pend = pedidosPendentes();
  var aniversariantes = aniversariantesDoMes();
  var minutosSemana = 0;
  var weekAgo = new Date(Date.now() - 7*24*3600*1000).toISOString();
  STATE.students.forEach(function(s){ minutosSemana += minutosTrabalhados(s.id, weekAgo); });

  var maioresPendencias = STATE.students
    .filter(function(s){ var k=pendenteKind(s.pendenteHerdada); return k==='warn'||k==='crit'; })
    .sort(function(a,b){ return (parseInt(b.pendenteHerdada,10)||0) - (parseInt(a.pendenteHerdada,10)||0); })
    .slice(0,8);

  var rows = maioresPendencias.map(function(s){
    return '<tr data-open="'+s.id+'">' +
      '<td data-label="Bolsista">'+studentCell(s)+'</td>' +
      '<td data-label="Setor">'+esc(setorNome(s.setor))+'</td>' +
      '<td data-label="Pendência">'+pill(s.pendenteHerdada)+'</td>' +
    '</tr>';
  }).join('') || '<tr><td colspan="3"><div class="empty-state">Nenhuma pendência herdada da planilha acima de 8h. 🎉</div></td></tr>';

  var atividade = STATE.activityLog.slice(0,8).map(function(a){
    return '<div class="log-item"><span class="t">'+fmtDateTime(a.ts)+'</span><span>'+esc(a.texto)+'</span></div>';
  }).join('') || '<div class="empty-state">Nenhuma atividade registrada ainda nesta ferramenta.</div>';

  var aniversHtml = aniversariantes.length ? aniversariantes.map(function(s){
    return '<div class="log-item"><span class="t">'+s.aniversario.slice(8,10)+'/'+s.aniversario.slice(5,7)+'</span><span>'+esc(s.nome)+' · '+esc(setorNome(s.setor))+'</span></div>';
  }).join('') : '<div class="empty-state">Sem aniversariantes este mês.</div>';

  return (
    '<div class="view-head"><div><h1>Visão geral</h1><div class="view-sub">Painel de administração dos bolsistas do trabalho educativo.</div></div><div class="date">'+dateLabel+'</div></div>' +

    '<div class="banner">Este é o primeiro passo do sistema: os perfis dos '+STATE.students.length+' bolsistas foram importados da planilha. O controle de ponto (chegada/saída) e os pedidos de ajuste começam a contar a partir de agora — a coluna “pendência herdada” abaixo é só o histórico anterior, para referência.</div>' +

    '<div class="stat-grid">' +
      '<div class="stat-card accent"><span class="label">Bolsistas ativos</span><span class="value mono">'+total+'</span><span class="hint">em '+STATE.setores.length+' setores</span></div>' +
      '<div class="stat-card"><span class="label">Pedidos aguardando</span><span class="value mono">'+pend.length+'</span><span class="hint">de ajuste de ponto</span></div>' +
      '<div class="stat-card"><span class="label">Horas registradas (7 dias)</span><span class="value mono">'+fmtHoras(minutosSemana)+'</span><span class="hint">via chegada/saída no sistema</span></div>' +
      '<div class="stat-card"><span class="label">Aniversariantes do mês</span><span class="value mono">'+aniversariantes.length+'</span><span class="hint">'+MESES[new Date().getMonth()]+'</span></div>' +
    '</div>' +

    '<div class="card">' +
      '<div class="card-head"><h2>Maiores pendências herdadas da planilha</h2><span class="meta">clique para abrir o perfil</span></div>' +
      '<div class="card-body tight"><div class="table-wrap"><table><thead><tr><th>Bolsista</th><th>Setor</th><th>Pendência</th></tr></thead><tbody>'+rows+'</tbody></table></div></div>' +
    '</div>' +

    '<div class="field-row">' +
      '<div class="card"><div class="card-head"><h2>Atividade recente</h2></div><div class="card-body">'+atividade+'</div></div>' +
      '<div class="card"><div class="card-head"><h2>Aniversariantes de '+MESES[new Date().getMonth()]+'</h2></div><div class="card-body">'+aniversHtml+'</div></div>' +
    '</div>'
  );
}

function studentCell(s){
  return '<div style="display:flex;align-items:center;gap:9px;">' +
    '<span class="avatar">'+initials(s.nome)+'</span>' +
    '<span><div style="font-weight:500;">'+esc(s.nome)+'</div>' +
    '<div class="mono" style="font-size:11px;color:var(--muted);">'+esc(s.bolsa||'—')+(s.ra ? ' · RA '+esc(s.ra) : '')+'</div></span>' +
  '</div>';
}

function pill(pendenteTxt){
  var kind = pendenteKind(pendenteTxt);
  var cls = kind==='ok' ? 'pill-ok' : kind==='warn' ? 'pill-warn' : kind==='crit' ? 'pill-crit' : 'pill-muted';
  var label = pendenteTxt || 'sem dado';
  return '<span class="pill '+cls+'">'+esc(label)+'</span>';
}

function statusHojePill(id){
  var last = ultimoRegistro(id);
  if(!last) return '<span class="pill pill-muted">Sem registro hoje</span>';
  if(last.tipo==='entrada'){
    if(sameDay(last.ts)) return '<span class="pill pill-accent">Em andamento desde '+fmtTime(last.ts)+'</span>';
    return '<span class="pill pill-crit">Em andamento desde '+fmtDateTime(last.ts)+' ⚠</span>';
  }
  if(sameDay(last.ts)) return '<span class="pill pill-ok">Saiu às '+fmtTime(last.ts)+'</span>';
  return '<span class="pill pill-muted">Sem registro hoje</span>';
}

function statusHojeTexto(id){
  var last = ultimoRegistro(id);
  if(!last) return 'Sem registro hoje';
  if(last.tipo==='entrada'){
    if(sameDay(last.ts)) return 'Em andamento desde ' + fmtTime(last.ts);
    return 'Em andamento desde ' + fmtDateTime(last.ts) + ' (dia anterior)';
  }
  if(sameDay(last.ts)) return 'Saiu às ' + fmtTime(last.ts);
  return 'Sem registro hoje';
}

/* ============================================================
   Exportação para Excel (SheetJS, carregado via CDN no index.html)
   ============================================================ */
/* Primeiro dia do mês corrente, meia-noite local, como ISO — usado como
   marco inicial do saldo do mês (abaixo), do mesmo jeito que
   mondayDaSemanaISO() é o marco do saldo da semana. */
function primeiroDiaMesISO(){
  var d = new Date();
  d.setDate(1);
  d.setHours(0,0,0,0);
  return d.toISOString();
}
/* Saldo de horas do mês corrente (desde o dia 1) contra a carga horária
   semanal cadastrada, convertida proporcionalmente aos dias já passados
   no mês (carga semanal ÷ 7 × dias corridos) — mesma lógica de
   saldoSemanaInfo(), só que com o marco e a meta no nível do mês. Usado
   só na exportação para Excel (a planilha pedida pelo usuário mostra o
   saldo do mês, não mais o da semana). */
function saldoMesInfo(s){
  if(!s.horasSemana){
    return {saldo: null, cls: 'pill-muted'};
  }
  var minsMes = minutosTrabalhados(s.id, primeiroDiaMesISO());
  var diasCorridos = new Date().getDate(); // dia do mês atual (1 a 28-31)
  var metaMes = (s.horasSemana||0) * 60 * (diasCorridos/7);
  var saldo = minsMes - metaMes;
  return {saldo: saldo, cls: saldo>=0 ? 'pill-ok' : 'pill-crit'};
}
/* Texto de horas para a exportação — saldo do mês (contra a carga horária
   cadastrada, proporcional aos dias já passados no mês), em texto simples
   de célula em vez de pill colorida. */
function horasExportTexto(s){
  var info = saldoMesInfo(s);
  if(info.saldo === null) return 'Carga não definida';
  if(info.saldo < 0) return '-' + fmtHoras(-info.saldo);
  if(info.saldo > 0) return '+' + fmtHoras(info.saldo);
  return '0h';
}
function exportarExcel(){
  if(typeof XLSX === 'undefined'){
    toast('Não foi possível carregar a biblioteca de exportação. Verifique sua conexão e tente novamente.', 'err');
    return;
  }
  var wb = XLSX.utils.book_new();

  var alunosOrdenados = STATE.students.slice().sort(function(a,b){ return a.nome.localeCompare(b.nome,'pt-BR'); });
  var alunosData = alunosOrdenados.map(function(s){
    return {
      'Nome': s.nome,
      'RA': s.ra || '',
      'Horas (saldo do mês)': horasExportTexto(s)
    };
  });
  var wsAlunos = XLSX.utils.json_to_sheet(alunosData);
  wsAlunos['!cols'] = [{wch:28},{wch:12},{wch:22}];
  XLSX.utils.book_append_sheet(wb, wsAlunos, 'Alunos');

  var filename = 'trabalho-educativo-' + todayKey() + '.xlsx';
  try{
    XLSX.writeFile(wb, filename);
    logAtividade('Exportou os dados para Excel ('+filename+').');
    toast('Excel gerado: '+filename);
    persist();
  }catch(err){
    toast('Não foi possível gerar o Excel agora.', 'err');
  }
}

/* ============================================================
   Corrigir cadastros duplicados — ferramenta de manutenção (botão
   na aba Alunos). Alguns alunos acabaram com DOIS cadastros: o
   "oficial" (importado da planilha, id no formato "sNN-nome",
   listado normalmente em Alunos) e um "fantasma" (id gerado
   automaticamente, formato "s_xxxxx"), criado quando alguém aprovou
   o autocadastro por RA de uma pessoa sem perceber que já existia
   um cadastro oficial com aquele RA. O login dessa pessoa fica
   ligado ao fantasma, então os pontos que ela bate somem da visão
   da administração (que olha o oficial).

   Importante: o fantasma normalmente NÃO aparece na lista de Alunos
   nem entra na contagem de bolsistas — ele existe só como documento
   solto na coleção "students" do Firestore (nunca foi salvo dentro
   de app/state.students, que é de onde a tela de Alunos lê). Por
   isso a busca dos pares precisa ler a coleção direto do Firestore
   (window.__pontosDetectarDuplicados, em firebase-init.js) em vez
   de STATE.students — senão a ferramenta não encontra nada, mesmo
   havendo duplicados.
   ============================================================ */
function corrigirCadastrosDuplicados(){
  if(typeof window.__pontosDetectarDuplicados !== 'function' || typeof window.__pontosCorrigirDuplicados !== 'function'){
    toast('Não foi possível verificar agora. Verifique sua conexão.', 'err');
    return;
  }
  toast('Verificando cadastros…');
  window.__pontosDetectarDuplicados().then(function(resultado){
    var pares = resultado.pares, manual = resultado.manual;
    if(!pares.length){
      toast(manual.length
        ? (manual.length+' caso(s) de RA repetido precisam de revisão manual (mais de um cadastro com o mesmo RA, nenhum claramente "oficial"): '+manual.map(function(m){return m.nomes.join(' / ');}).join('; ')+'.')
        : 'Nenhum cadastro duplicado encontrado. 🎉', null, {duration: 9000});
      return;
    }
    var totalRegistros = pares.reduce(function(acc,p){ return acc + registrosDoAluno(p.stubId).length; }, 0);
    var msg = pares.length+' cadastro'+(pares.length>1?'s duplicados encontrados':' duplicado encontrado')+
      ' ('+totalRegistros+' registro'+(totalRegistros===1?'':'s')+' de ponto a religar ao cadastro oficial)' +
      (manual.length ? '. Mais '+manual.length+' caso(s) precisam de revisão manual e não serão alterados agora.' : '.') +
      ' Confirma a correção?';
    toast(msg, null, {
      actionLabel: 'Confirmar e corrigir',
      duration: 25000,
      onAction: function(){
        toast('Corrigindo, aguarde…');
        window.__pontosCorrigirDuplicados(pares).then(function(res){
          // A ferramenta já mesclou tudo direto no Firestore; aqui só
          // espelhamos no STATE local: tira qualquer cópia do fantasma que
          // tenha entrado em STATE.students (ex.: pela ferramenta
          // "Sincronizar cadastros soltos") e preenche no oficial o RA/bolsa
          // que a mesclagem completou, pra não sobrescrever com dados
          // desatualizados no próximo persist().
          var camposPreenchidos = 0;
          pares.forEach(function(par){
            STATE.students = STATE.students.filter(function(x){ return x.id !== par.stubId; });
            var oficial = STATE.students.filter(function(x){ return x.id === par.officialId; })[0];
            if(oficial && par.camposPreenchidos){
              Object.assign(oficial, par.camposPreenchidos);
              camposPreenchidos++;
            }
          });
          logAtividade('Corrigiu '+res.paresCorrigidos+' cadastro(s) duplicado(s): '+res.registrosMigrados+' registro(s) de ponto, '+res.pedidosMigrados+' pedido(s) de ajuste e '+res.loginsVinculados+' login(s) religados ao cadastro oficial'+(camposPreenchidos?', '+camposPreenchidos+' cadastro(s) com RA/bolsa completados':'')+'.');
          toast(res.paresCorrigidos+' cadastro(s) corrigido(s): '+res.registrosMigrados+' registro(s) e '+res.pedidosMigrados+' pedido(s) migrado(s), '+res.loginsVinculados+' login(s) religado(s) ao cadastro certo.', null, {duration: 8000});
          persist();
        }).catch(function(err){
          toast('Falha ao corrigir os cadastros. Tente novamente ou avise a administração técnica.', 'err');
        });
      }
    });
  }).catch(function(){
    toast('Não foi possível verificar os cadastros agora. Verifique sua conexão.', 'err');
  });
}

/* ============================================================
   Sincronizar cadastros soltos — ferramenta de manutenção (botão
   "Sincronizar cadastros soltos" na aba Alunos). Ver comentário
   detalhado em firebase-init.js junto de
   window.__pontosDetectarCadastrosSoltos /
   window.__pontosSincronizarCadastrosSoltos.
   ============================================================ */
function sincronizarCadastrosSoltos(){
  if(typeof window.__pontosDetectarCadastrosSoltos !== 'function' || typeof window.__pontosSincronizarCadastrosSoltos !== 'function'){
    toast('Não foi possível verificar agora. Verifique sua conexão.', 'err');
    return;
  }
  toast('Verificando cadastros soltos…');
  window.__pontosDetectarCadastrosSoltos().then(function(resultado){
    var soltos = resultado.soltos, pedidosParaCorrigir = resultado.pedidosParaCorrigir;
    if(!soltos.length && !pedidosParaCorrigir.length){
      toast('Nenhum cadastro solto ou pedido de ajuste com nome pendente encontrado. 🎉', null, {duration: 6000});
      return;
    }
    var msg = (soltos.length ? soltos.length+' cadastro'+(soltos.length>1?'s soltos encontrados':' solto encontrado')+' ('+soltos.map(function(s){return s.nome;}).join(', ')+')' : 'Nenhum cadastro solto novo') +
      (pedidosParaCorrigir.length ? '. '+pedidosParaCorrigir.length+' pedido(s) de ajuste com nome pendente serão corrigidos.' : '.') +
      ' Confirma?';
    toast(msg, null, {
      actionLabel: 'Confirmar e sincronizar',
      duration: 25000,
      onAction: function(){
        toast('Sincronizando, aguarde…');
        window.__pontosSincronizarCadastrosSoltos().then(function(res){
          // A ferramenta já gravou os cadastros soltos e os pedidos corrigidos
          // direto no Firestore (batch atômico); aqui só espelhamos o mesmo
          // resultado no STATE local antes de persist(), pra não sobrescrever
          // com a lista antiga de STATE.students (que ainda não tinha os soltos).
          (res.soltos || []).forEach(function(s){
            if(!STATE.students.some(function(x){ return x.id === s.id; })) STATE.students.push(s);
          });
          logAtividade('Sincronizou '+res.cadastrosSincronizados+' cadastro(s) solto(s) ('+res.nomesSincronizados.join(', ')+') e corrigiu '+res.pedidosCorrigidos+' pedido(s) de ajuste com nome pendente.');
          toast(res.cadastrosSincronizados+' cadastro(s) sincronizado(s), '+res.pedidosCorrigidos+' pedido(s) corrigido(s).', null, {duration: 8000});
          persist();
        }).catch(function(err){
          toast('Falha ao sincronizar os cadastros. Tente novamente ou avise a administração técnica.', 'err');
        });
      }
    });
  }).catch(function(){
    toast('Não foi possível verificar os cadastros soltos agora. Verifique sua conexão.', 'err');
  });
}

/* ============================================================
   Excluir cadastro permanentemente — botão "🗑 Excluir
   permanentemente" no perfil do aluno. Diferente de
   "Desativar"/"Reativar" (reversível, só esconde da lista mas
   guarda histórico), isso apaga de vez o cadastro, o RA, os
   registros de ponto e os pedidos de ajuste — sem volta. Ver
   window.__pontosExcluirCadastro em firebase-init.js pros detalhes
   (inclusive o limite: não apaga a conta de e-mail/senha do
   Firebase Authentication, só os dados do Firestore).
   ============================================================ */
function excluirCadastroPermanente(s){
  if(typeof window.__pontosExcluirCadastro !== 'function'){
    toast('Não foi possível excluir agora. Verifique sua conexão.', 'err');
    return;
  }
  var totalRegistros = registrosDoAluno(s.id).length;
  var totalPedidos = STATE.pedidos.filter(function(p){ return p.studentId === s.id; }).length;
  toast(
    'Excluir "'+s.nome+'" PERMANENTEMENTE: cadastro, RA ('+(s.ra||'—')+'), '+totalRegistros+' registro(s) de ponto e '+totalPedidos+' pedido(s) de ajuste. Não tem como desfazer. Confirma?',
    'err',
    {
      actionLabel: 'Sim, excluir tudo',
      duration: 20000,
      onAction: function(){
        toast('Excluindo, aguarde…');
        window.__pontosExcluirCadastro(s.id).then(function(res){
          STATE.students = STATE.students.filter(function(x){ return x.id !== s.id; });
          STATE.registros = STATE.registros.filter(function(x){ return x.studentId !== s.id; });
          STATE.pedidos = STATE.pedidos.filter(function(x){ return x.studentId !== s.id; });
          logAtividade('Excluiu permanentemente o cadastro de '+s.nome+' ('+res.registrosExcluidos+' registro(s), '+res.pedidosExcluidos+' pedido(s)'+(res.loginDesvinculado?', login desvinculado':'')+').');
          closeDrawer();
          toast(
            'Cadastro de '+s.nome+' excluído: '+res.registrosExcluidos+' registro(s) e '+res.pedidosExcluidos+' pedido(s) apagados.'+
            (res.loginDesvinculado ? ' O login antigo (e-mail/senha) não foi apagado — ficou órfão no Firebase Auth; para remover de vez, apague manualmente em Console do Firebase → Authentication.' : ''),
            null,
            {duration: 12000}
          );
          persist();
        }).catch(function(err){
          toast('Falha ao excluir o cadastro. Tente novamente ou avise a administração técnica.', 'err');
        });
      }
    }
  );
}

function viewAlunos(){
  var setorOpts = '<option value="todos">Todos os setores</option>' + STATE.setores.map(function(s){
    return '<option value="'+s.id+'"'+(UI.alunoFiltroSetor===s.id?' selected':'')+'>'+esc(s.nome)+'</option>';
  }).join('');

  var list = STATE.students.filter(function(s){
    if(UI.alunoFiltroSetor!=='todos' && s.setor!==UI.alunoFiltroSetor) return false;
    if(UI.alunoFiltroNivel!=='todos' && s.nivel!==UI.alunoFiltroNivel) return false;
    if(UI.alunoBusca){
      var q = UI.alunoBusca.toLowerCase();
      if(s.nome.toLowerCase().indexOf(q)===-1 && (s.ra||'').indexOf(q)===-1) return false;
    }
    return true;
  }).sort(function(a,b){ return a.nome.localeCompare(b.nome,'pt-BR'); });

  var rows = list.map(function(s){
    var incompleto = !s.bolsa || !s.diasTrabalho;
    return '<tr data-open="'+s.id+'">' +
      '<td data-label="Bolsista">'+studentCell(s)+(incompleto?' <span class="tag" title="Dados incompletos na planilha original">incompleto</span>':'')+'</td>' +
      '<td data-label="Setor">'+esc(setorNome(s.setor))+'</td>' +
      '<td data-label="Nível"><span class="pill pill-muted">'+nivelLabel(s.nivel)+'</span></td>' +
      '<td class="mono" data-label="Carga">'+horasSemanaLabel(s)+'</td>' +
      '<td data-label="Dias de trabalho">'+esc(diasTrabalhoLabel(s)||'—')+'</td>' +
      '<td data-label="Hoje">'+statusHojePill(s.id)+'</td>' +
      '<td data-label="Saldo da semana">'+saldoPill(s)+'</td>' +
    '</tr>';
  }).join('') || '<tr><td colspan="7"><div class="empty-state">Nenhum bolsista encontrado com esses filtros.</div></td></tr>';

  var accCards = list.map(function(s){
    var incompleto = !s.bolsa || !s.diasTrabalho;
    var key = 'alunoAberto:'+s.id;
    var open = UI.alunoAberto===s.id;
    var panel = '';
    if(accordionShouldRender('alunoAberto', s.id)){
      panel =
        '<div class="'+accordionPanelClass('alunoAberto', s.id)+'" data-acc-key="'+key+'">' +
          '<div class="acc-panel-inner">' +
            '<div class="kv-grid">' +
              '<div class="kv"><span class="k">Setor</span><span class="v">'+esc(setorNome(s.setor))+'</span></div>' +
              '<div class="kv"><span class="k">Nível</span><span class="v">'+nivelLabel(s.nivel)+'</span></div>' +
              '<div class="kv"><span class="k">Carga</span><span class="v mono">'+horasSemanaLabel(s)+'</span></div>' +
              '<div class="kv"><span class="k">Dias de trabalho</span><span class="v">'+esc(diasTrabalhoLabel(s)||'—')+'</span></div>' +
              '<div class="kv"><span class="k">Hoje</span><span class="v">'+statusHojePill(s.id)+'</span></div>' +
              '<div class="kv"><span class="k">Saldo da semana</span><span class="v">'+saldoPill(s)+'</span></div>' +
            '</div>' +
            '<button class="btn btn-sm btn-primary" data-open="'+s.id+'" type="button">Ver perfil completo</button>' +
          '</div>' +
        '</div>';
    }
    return (
      '<div class="aluno-acc">' +
        '<button class="aluno-acc-head'+(open?' open':'')+'" data-toggle-aluno="'+s.id+'" type="button" aria-expanded="'+(open?'true':'false')+'">' +
          '<span class="avatar">'+initials(s.nome)+'</span>' +
          '<span class="aluno-acc-info">' +
            '<span class="aluno-acc-name">'+esc(s.nome)+(incompleto?' <span class="tag" title="Dados incompletos na planilha original">incompleto</span>':'')+'</span>' +
            '<span class="aluno-acc-sub">RA '+esc(s.ra||'—')+' · '+saldoPill(s)+'</span>' +
          '</span>' +
          '<span class="chev">›</span>' +
        '</button>' +
        panel +
      '</div>'
    );
  }).join('') || '<div class="empty-state">Nenhum bolsista encontrado com esses filtros.</div>';

  var cadastrosPendentes = STATE.cadastrosPendentes || [];
  var cadastrosHtml = !cadastrosPendentes.length ? '' : (
    '<div class="card card-pending">' +
      '<div class="card-head"><h2>Cadastros pendentes de aprovação</h2><span class="meta">'+cadastrosPendentes.length+'</span></div>' +
      '<div class="card-body" style="display:flex;flex-direction:column;gap:8px;">' +
        cadastrosPendentes.map(function(c){
          return '<div class="log-item" style="flex-wrap:wrap;">' +
            '<span style="flex:1;min-width:200px;"><b>'+esc(c.nome||'(sem nome)')+'</b> · RA '+esc(c.ra||'—') +
              '<br><span style="color:var(--muted);">'+esc(c.email||'')+' · cadastrado em '+fmtDateTime(c.criadoEm)+'</span></span>' +
            '<button class="btn btn-sm btn-primary" data-aprovar-cadastro="'+esc(c.id)+'" type="button">Aprovar</button>' +
            '<button class="btn btn-sm btn-danger" data-rejeitar-cadastro="'+esc(c.id)+'" type="button">Excluir</button>' +
          '</div>';
        }).join('') +
      '</div>' +
      '<div class="card-body" style="padding-top:0;"><div class="view-sub">Essas pessoas se cadastraram pelo RA delas, mas o RA não foi encontrado na lista de bolsistas — o login já existe, só falta completar o cadastro (setor, nível, etc.) ou excluir se não for válido.</div></div>' +
    '</div>'
  );

  return (
    '<div class="view-head"><div><h1>Alunos</h1><div class="view-sub">'+STATE.students.length+' bolsistas cadastrados. Clique em um nome para ver o perfil completo.</div></div>' +
      '<div class="toolbar" style="gap:8px;">' +
        '<button class="btn btn-ghost" data-action="exportar-excel">⇩ Exportar Excel</button>' +
        '<button class="btn btn-ghost" data-action="corrigir-duplicados" title="Confere se algum aluno ficou com dois cadastros (um oficial e um criado por engano ao aprovar o autocadastro por RA) e liga o login ao cadastro certo.">⚠ Corrigir cadastros duplicados</button>' +
        '<button class="btn btn-ghost" data-action="sincronizar-soltos" title="Confere se algum aluno que se autocadastrou pelo RA nunca entrou na lista de Alunos, e corrige o nome pendente (—) nos Pedidos de ajuste antigos.">🔄 Sincronizar cadastros soltos</button>' +
        '<button class="btn btn-primary" data-action="novo-aluno">+ Novo aluno</button>' +
      '</div></div>' +

    cadastrosHtml +

    '<div class="toolbar">' +
      '<div class="search"><input type="text" id="busca-aluno" placeholder="Buscar por nome ou RA…" value="'+esc(UI.alunoBusca)+'"></div>' +
      '<select id="filtro-setor">'+setorOpts+'</select>' +
      '<select id="filtro-nivel">' +
        '<option value="todos"'+(UI.alunoFiltroNivel==='todos'?' selected':'')+'>Todos os níveis</option>' +
        '<option value="EM"'+(UI.alunoFiltroNivel==='EM'?' selected':'')+'>Ensino Médio</option>' +
        '<option value="FAC"'+(UI.alunoFiltroNivel==='FAC'?' selected':'')+'>Faculdade</option>' +
      '</select>' +
    '</div>' +

    '<div class="card alunos-table-card"><div class="card-body tight"><div class="table-wrap"><table>' +
      '<thead><tr><th>Bolsista</th><th>Setor</th><th>Nível</th><th class="num">Carga</th><th>Dias de trabalho</th><th>Hoje</th><th>Saldo da semana</th></tr></thead>' +
      '<tbody>'+rows+'</tbody>' +
    '</table></div></div></div>' +

    '<div class="aluno-acc-list">'+accCards+'</div>'
  );
}

function turnosHojeCount(id){
  return registrosDoAluno(id).filter(function(r){ return r.tipo==='saida' && sameDay(r.ts); }).length;
}

/* Núcleo compartilhado entre o painel desktop (punchButton) e o
   acordeão inline mobile (punchButtonInline) — status/ações/dica. */
function punchActionsBlock(s){
  var id = s.id;
  var minsHoje = minutosTrabalhados(id, localMidnightISO());
  if(isConservacao(s)){
    var n = turnosHojeCount(id);
    var statusTurno = n>0 ? (n===1 ? '1 turno registrado hoje.' : n+' turnos registrados hoje.') : 'Nenhum turno registrado hoje.';
    return {
      status: statusTurno,
      warn: '',
      actions: '<button class="btn btn-lg btn-primary" data-punch-turno data-id="'+id+'">Marcar turno cumprido (+4h)</button>',
      minsHoje: minsHoje,
      hint: 'Pode apertar mais de uma vez no mesmo dia — por exemplo, um turno pela manhã e outro à noite. Cada toque soma 4 horas.'
    };
  }
  var last = ultimoRegistro(id);
  var next = proximoTipo(id);
  var statusText, warn = '';
  if(!last) statusText = 'Ainda não bateu o ponto hoje.';
  else if(last.tipo==='entrada'){
    if(sameDay(last.ts)) statusText = 'Em andamento desde ' + fmtTime(last.ts) + '.';
    else { statusText = 'Em andamento desde ' + fmtDateTime(last.ts) + '.'; warn = '<div class="banner">Esse registro é de outro dia — se for engano, use a aba “Pedidos de ajuste”.</div>'; }
  } else {
    statusText = sameDay(last.ts) ? ('Saiu às ' + fmtTime(last.ts) + '. Pode registrar nova chegada se voltar hoje.') : 'Ainda não bateu o ponto hoje.';
  }
  return {
    status: statusText,
    warn: warn,
    actions:
      '<button class="btn btn-lg btn-primary" data-punch="entrada" data-id="'+id+'" '+(next!=='entrada'?'disabled':'')+'>Marcar chegada agora</button>' +
      '<button class="btn btn-lg" data-punch="saida" data-id="'+id+'" '+(next!=='saida'?'disabled':'')+'>Marcar saída agora</button>',
    minsHoje: minsHoje,
    hint: 'Esqueceu de bater o ponto num horário certo? Peça o ajuste na aba <b>Pedidos de ajuste</b> — os responsáveis do setor aprovam antes de valer.'
  };
}

/* Painel completo (desktop, coluna lateral da aba Ponto) */
function punchButton(id){
  var s = studentById(id);
  if(!s) return '<div class="empty-state">Selecione um bolsista na lista ao lado.</div>';
  var b = punchActionsBlock(s);
  return (
    '<div class="punch-status">' +
      '<span class="avatar" style="width:44px;height:44px;font-size:15px;">'+initials(s.nome)+'</span>' +
      '<span class="who">'+esc(s.nome)+'</span>' +
      '<span class="state">'+esc(s.setorNome || setorNome(s.setor))+' · '+nivelLabel(s.nivel)+'</span>' +
      '<span class="state">'+b.status+'</span>' +
    '</div>' +
    b.warn +
    '<div class="punch-actions">'+b.actions+'</div>' +
    '<div class="punch-time-row">Horas cumpridas hoje: <span class="mono">&nbsp;'+fmtHoras(b.minsHoje)+'</span></div>' +
    '<div class="view-sub">'+b.hint+'</div>'
  );
}

/* Versão enxuta (mobile, acordeão inline logo abaixo do nome na lista —
   sem cabeçalho de avatar/nome, que já aparece no item da lista) */
function punchButtonInline(s){
  var b = punchActionsBlock(s);
  return (
    '<div class="punch-inline-status">'+b.status+'</div>' +
    b.warn +
    '<div class="punch-actions">'+b.actions+'</div>' +
    '<div class="punch-time-row">Horas cumpridas hoje: <span class="mono">&nbsp;'+fmtHoras(b.minsHoje)+'</span></div>'
  );
}

/* ============================================================
   Bater ponto em lote — seleciona vários alunos na aba Ponto
   (modo líder) e aplica a mesma ação a todos de uma vez.
   ============================================================ */
function bulkPunch(tipo){
  var ids = UI.punchBulkSelected.slice();
  var ok = 0, skip = 0;
  var criados = [];
  ids.forEach(function(id){
    var s = studentById(id);
    if(!s || isConservacao(s)) { if(s) skip++; return; }
    if(proximoTipo(id) !== tipo){ skip++; return; }
    var novoId = uid('r');
    addRegistro({id: novoId, studentId:id, tipo:tipo, ts: nowISO(), origem: UI.punchMode==='lider' ? 'lider' : 'self'});
    logAtividade((tipo==='entrada'?'Chegada':'Saída')+' registrada para '+s.nome+' às '+fmtTime(nowISO())+' (em lote).');
    criados.push(novoId);
    ok++;
  });
  if(ok>0){
    toast((tipo==='entrada'?'Chegada registrada':'Saída registrada')+' para '+ok+' aluno'+(ok>1?'s':'')+(skip>0?' ('+skip+' ignorado'+(skip>1?'s':'')+')':'')+'.', null, {
      actionLabel: 'Desfazer',
      onAction: function(){
        criados.forEach(removeRegistro);
        logAtividade('Registro em lote desfeito ('+criados.length+' aluno'+(criados.length>1?'s':'')+', marcado por engano).');
        toast('Registro em lote desfeito.');
        persist();
      }
    });
  } else {
    toast('Nenhum aluno selecionado estava apto para essa ação.', 'err');
  }
  UI.punchBulkSelected = [];
  UI.punchBulkMode = false;
  persist();
}
function bulkPunchTurno(){
  var ids = UI.punchBulkSelected.slice();
  var ok = 0, skip = 0;
  var inicio = new Date();
  var fim = new Date(inicio.getTime() + 4*60*60*1000);
  var origem = UI.punchMode==='lider' ? 'lider' : 'self';
  var criados = [];
  ids.forEach(function(id){
    var s = studentById(id);
    if(!s || !isConservacao(s)){ if(s) skip++; return; }
    var idEntrada = uid('r'), idSaida = uid('r');
    addRegistro({id: idEntrada, studentId:id, tipo:'entrada', ts: inicio.toISOString(), origem: origem});
    addRegistro({id: idSaida, studentId:id, tipo:'saida', ts: fim.toISOString(), origem: origem});
    logAtividade('Turno de 4h registrado para '+s.nome+' ('+fmtTime(inicio.toISOString())+'–'+fmtTime(fim.toISOString())+', em lote).');
    criados.push(idEntrada, idSaida);
    ok++;
  });
  if(ok>0){
    toast('Turno de 4h registrado para '+ok+' aluno'+(ok>1?'s':'')+(skip>0?' ('+skip+' fora da Conservação, ignorado'+(skip>1?'s':'')+')':'')+'.', null, {
      actionLabel: 'Desfazer',
      onAction: function(){
        criados.forEach(removeRegistro);
        logAtividade('Turno de 4h em lote desfeito ('+ok+' aluno'+(ok>1?'s':'')+', marcado por engano).');
        toast('Turno em lote desfeito.');
        persist();
      }
    });
  } else {
    toast('Nenhum aluno selecionado é do setor Conservação.', 'err');
  }
  UI.punchBulkSelected = [];
  UI.punchBulkMode = false;
  persist();
}

function viewPonto(){
  var pool = STATE.students.filter(function(s){
    if(!s.ativo) return false;
    if(UI.punchMode==='aluno') return s.nivel==='FAC';
    return UI.punchSetor==='todos' || s.setor===UI.punchSetor;
  });
  if(UI.punchSearch){
    var q = UI.punchSearch.toLowerCase();
    pool = pool.filter(function(s){ return s.nome.toLowerCase().indexOf(q)!==-1; });
  }
  pool = pool.slice().sort(function(a,b){ return a.nome.localeCompare(b.nome,'pt-BR'); });

  var setorOpts = STATE.setores.map(function(s){
    return '<option value="'+s.id+'"'+(UI.punchSetor===s.id?' selected':'')+'>'+esc(s.nome)+'</option>';
  }).join('');

  var bulk = UI.punchMode==='lider' && UI.punchBulkMode;

  var listHtml = pool.map(function(s){
    if(bulk){
      var checked = UI.punchBulkSelected.indexOf(s.id)!==-1;
      return (
        '<button class="punch-item bulk-item'+(checked?' selected':'')+'" data-bulk-select="'+s.id+'" type="button" aria-pressed="'+(checked?'true':'false')+'">' +
          '<span class="check-box'+(checked?' checked':'')+'" aria-hidden="true"></span>' +
          '<span class="avatar">'+initials(s.nome)+'</span>' +
          '<span class="name">'+esc(s.nome)+'</span>' +
          statusHojePill(s.id) +
        '</button>'
      );
    }
    var key = 'punchSelected:'+s.id;
    var selected = UI.punchSelected===s.id;
    var inline = '';
    if(accordionShouldRender('punchSelected', s.id)){
      inline =
        '<div class="punch-inline-acc '+accordionPanelClass('punchSelected', s.id)+'" data-acc-key="'+key+'">' +
          '<div class="acc-panel-inner">'+punchButtonInline(s)+'</div>' +
        '</div>';
    }
    return (
      '<div>' +
        '<button class="punch-item'+(selected?' selected':'')+'" data-select-punch="'+s.id+'" type="button" aria-expanded="'+(selected?'true':'false')+'">' +
          '<span class="avatar">'+initials(s.nome)+'</span>' +
          '<span class="name">'+esc(s.nome)+'</span>' +
          statusHojePill(s.id) +
          '<span class="chev">›</span>' +
        '</button>' +
        inline +
      '</div>'
    );
  }).join('') || '<div class="empty-state">Nenhum bolsista nesse filtro.</div>';

  var nSel = UI.punchBulkSelected.length;
  var bulkToolbar = UI.punchMode!=='lider' ? '' : (
    bulk ?
      '<div class="bulk-toolbar">' +
        '<span class="meta">'+nSel+' selecionado'+(nSel===1?'':'s')+'</span>' +
        '<button class="btn btn-sm btn-ghost" data-bulk-select-all type="button">Selecionar todos</button>' +
        '<button class="btn btn-sm btn-ghost" data-bulk-clear type="button">Limpar</button>' +
        '<button class="btn btn-sm btn-ghost" data-bulk-cancel type="button">Cancelar</button>' +
      '</div>'
    :
      '<div class="bulk-toolbar">' +
        '<button class="btn btn-sm btn-ghost" data-bulk-toggle type="button">☑ Selecionar vários</button>' +
      '</div>'
  );

  var bulkActionBar = (bulk && nSel>0) ?
    '<div class="bulk-actionbar">' +
      '<button class="btn btn-primary" data-bulk-punch="entrada" type="button">Marcar chegada de todos</button>' +
      '<button class="btn" data-bulk-punch="saida" type="button">Marcar saída de todos</button>' +
      '<button class="btn btn-ghost" data-bulk-punch-turno type="button">+4h (Conservação)</button>' +
    '</div>'
    : '';

  return (
    '<div class="view-head"><div><h1>Registrar ponto</h1><div class="view-sub">Líderes de setor batem o ponto dos alunos do Ensino Médio; alunos da faculdade registram o próprio.</div></div></div>' +

    '<div class="segmented">' +
      '<button data-punchmode="lider" class="'+(UI.punchMode==='lider'?'active':'')+'">Líder de setor</button>' +
      '<button data-punchmode="aluno" class="'+(UI.punchMode==='aluno'?'active':'')+'">Aluno (faculdade)</button>' +
    '</div>' +

    '<div class="punch-wrap'+(bulk?' bulk-wrap':'')+'">' +
      '<div class="card">' +
        '<div class="card-head">' +
          (UI.punchMode==='lider' ? '<select id="punch-setor">'+setorOpts+'</select>' : '<h2>Buscar meu nome</h2>') +
        '</div>' +
        '<div class="card-body">' +
          '<div class="search" style="margin-bottom:10px;"><input type="text" id="punch-busca" placeholder="Buscar por nome…" value="'+esc(UI.punchSearch)+'"></div>' +
          bulkToolbar +
          '<div class="punch-list">'+listHtml+'</div>' +
          bulkActionBar +
        '</div>' +
      '</div>' +
      (bulk ? '' : '<div class="card punch-detail-card"><div class="card-body punch-detail">'+punchButton(UI.punchSelected)+'</div></div>') +
    '</div>'
  );
}

/* ============================================================
   Calendário — últimos 30 dias de um aluno: em quais dias veio e
   quantas horas fez em cada um.
   ============================================================ */
function viewCalendario(){
  var pool = STATE.students.filter(function(s){ return s.ativo; });
  if(UI.calendarioBusca){
    var q = UI.calendarioBusca.toLowerCase();
    pool = pool.filter(function(s){ return s.nome.toLowerCase().indexOf(q)!==-1 || (s.ra||'').indexOf(q)!==-1; });
  }
  pool = pool.slice().sort(function(a,b){ return a.nome.localeCompare(b.nome,'pt-BR'); });

  var listHtml = pool.map(function(s){
    var key = 'calendarioAlunoId:'+s.id;
    var selected = UI.calendarioAlunoId===s.id;
    var inline = '';
    if(accordionShouldRender('calendarioAlunoId', s.id)){
      inline =
        '<div class="punch-inline-acc cal-acc '+accordionPanelClass('calendarioAlunoId', s.id)+'" data-acc-key="'+key+'">' +
          '<div class="acc-panel-inner">'+calendarioAluno(s)+'</div>' +
        '</div>';
    }
    return (
      '<div>' +
        '<button class="punch-item'+(selected?' selected':'')+'" data-select-calendario="'+s.id+'" type="button" aria-expanded="'+(selected?'true':'false')+'">' +
          '<span class="avatar">'+initials(s.nome)+'</span>' +
          '<span class="name">'+esc(s.nome)+'</span>' +
          '<span class="chev">›</span>' +
        '</button>' +
        inline +
      '</div>'
    );
  }).join('') || '<div class="empty-state">Nenhum bolsista encontrado.</div>';

  var s = UI.calendarioAlunoId ? studentById(UI.calendarioAlunoId) : null;

  return (
    '<div class="view-head"><div><h1>Calendário</h1><div class="view-sub">Selecione um bolsista para ver, dia a dia, nos últimos 30 dias, quando veio e quantas horas cumpriu.</div></div></div>' +

    '<div class="punch-wrap">' +
      '<div class="card">' +
        '<div class="card-head"><h2>Bolsistas</h2></div>' +
        '<div class="card-body">' +
          '<div class="search" style="margin-bottom:10px;"><input type="text" id="calendario-busca" placeholder="Buscar por nome ou RA…" value="'+esc(UI.calendarioBusca)+'"></div>' +
          '<div class="punch-list">'+listHtml+'</div>' +
        '</div>' +
      '</div>' +
      '<div class="card punch-detail-card"><div class="card-body">'+(s ? calendarioAluno(s) : '<div class="empty-state">Selecione um bolsista na lista ao lado para ver o calendário dos últimos 30 dias.</div>')+'</div></div>' +
    '</div>'
  );
}

function calendarioAluno(s){
  var hoje = new Date(); hoje.setHours(0,0,0,0);
  var hojeKey = todayKey(hoje);

  // Mês de referência do calendário = mês atual + offset (offset<=0; não dá
  // pra avançar além do mês atual, só voltar com a seta "‹").
  var offset = UI.calendarioMesOffset || 0;
  var mesRef = new Date(hoje.getFullYear(), hoje.getMonth()+offset, 1);
  var ultimoDiaMes = new Date(mesRef.getFullYear(), mesRef.getMonth()+1, 0).getDate();
  var dias = [];
  for(var dnum=1; dnum<=ultimoDiaMes; dnum++){
    dias.push(new Date(mesRef.getFullYear(), mesRef.getMonth(), dnum));
  }

  // Dias de trabalho combinados do aluno (caixinhas do cadastro). Só entra no
  // destaque de falta/dia-extra quando o cadastro tem pelo menos um dia marcado
  // no formato novo — cadastro sem isso preenchido (ou ainda no texto livre
  // antigo) não ganha destaque nenhum, pra não acusar falta à toa.
  var diasCombinados = diasTrabalhoArray(s);
  var temProgramacao = diasCombinados.length > 0;

  var totalDiasComRegistro = 0, totalMin = 0;
  var cells = dias.map(function(d){
    var futuro = d > hoje;
    var mins = futuro ? 0 : minutosNoDia(s.id, d);
    var temRegistro = !futuro && registrosDoAlunoNoDia(s.id, d).length > 0;
    // Bateu ponto naquele dia, mas ficou sem par (entrada sem saída, ou
    // saída sem entrada, no mesmo dia) — minutosNoDia dá 0 nesse caso.
    // Fica vermelho e NÃO soma nas horas, em vez de contar como dia normal —
    // isso evita o problema de uma entrada solta "vazar" e ser casada com a
    // saída de um dia bem depois, inflando as horas do mês inteiro.
    var incompleto = temRegistro && mins<=0;
    if(temRegistro) totalDiasComRegistro++;
    totalMin += mins;
    var key = todayKey(d);

    // Dia combinado de trabalho = fica com contorno vermelho, tenha ou não
    // registro. Combinado com o preenchido verde (has-reg, quando bateu
    // ponto certinho), dá pra ler os casos direto no calendário: contornado
    // sem verde = faltou num dia combinado; verde sem contorno = veio num
    // dia que não era combinado.
    var deveriaVir = temProgramacao && diasCombinados.indexOf(DIA_SEMANA_CODE[d.getDay()]) !== -1;
    var faltou = !futuro && deveriaVir && !temRegistro;
    var veioExtra = !futuro && temProgramacao && !deveriaVir && temRegistro;
    var titulo = incompleto ? 'Bateu ponto, mas ficou sem par nesse dia (falta entrada ou saída) — não soma nas horas'
      : deveriaVir ? (faltou ? 'Dia de trabalho combinado — sem ponto batido' : 'Dia de trabalho combinado')
      : (veioExtra ? 'Veio num dia que não é combinado' : '');

    var cls = 'cal-cell' + (temRegistro && !incompleto?' has-reg':'') + (incompleto?' cal-incompleto':'') + (key===hojeKey?' is-today':'') + ((UI.calendarioDiaSel===key||UI.calendarioDiaPreview===key)?' selected':'') + (futuro?' cal-futuro':'') + (deveriaVir?' cal-programado':'') + (veioExtra?' cal-extra':'');
    return (
      '<button class="'+cls+'" type="button" data-cal-dia="'+key+'"'+(futuro?' disabled style="opacity:.35;cursor:default;"':'')+(titulo?' title="'+esc(titulo)+'"':'')+'>' +
        '<span class="cal-daynum">'+d.getDate()+'</span>' +
        (mins>0 ? '<span class="cal-hours">'+fmtHoras(mins)+'</span>' : (incompleto ? '<span class="cal-hours">sem par</span>' : '')) +
      '</button>'
    );
  }).join('');

  // Padding para alinhar a 1ª coluna com o dia da semana certo (Seg=0..Dom=6)
  var primeiroDiaSemana = (dias[0].getDay()+6)%7;
  var padCells = '';
  for(var p=0;p<primeiroDiaSemana;p++){ padCells += '<span class="cal-cell cal-pad" aria-hidden="true"></span>'; }

  var headerDias = DIAS_SEMANA_CURTO_SEG.map(function(d){ return '<span class="cal-weekday">'+d+'</span>'; }).join('');

  var mesNav =
    '<div class="cal-nav" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">' +
      '<button class="btn btn-sm btn-ghost" type="button" data-cal-mes="-1" aria-label="Mês anterior" title="Mês anterior">‹</button>' +
      '<span class="cal-mes-label" style="font-weight:600;text-transform:capitalize;">'+MESES[mesRef.getMonth()]+' de '+mesRef.getFullYear()+'</span>' +
      '<button class="btn btn-sm btn-ghost" type="button" data-cal-mes="1" aria-label="Próximo mês" title="Próximo mês"'+(offset>=0?' disabled':'')+'>›</button>' +
    '</div>';

  var devidas = horasDevidasMesAtual(s);
  var devidasCard = devidas.saldo===null ?
    '<div class="stat-card"><span class="label">Horas devidas este mês</span><span class="value mono">—</span><span class="hint">carga horária não definida</span></div>' :
    devidas.saldo<0 ?
      '<div class="stat-card"><span class="label">Horas devidas este mês</span><span class="value mono" style="color:var(--danger,#d33);">'+fmtHoras(-devidas.saldo)+'</span><span class="hint">devendo até hoje</span></div>' :
      '<div class="stat-card"><span class="label">Horas devidas este mês</span><span class="value mono">Em dia</span><span class="hint">'+(devidas.saldo>0?'+'+fmtHoras(devidas.saldo)+' de folga':'—')+'</span></div>';

  var mesPass = horasMesPassado(s);
  var mesPassadoCard =
    '<div class="stat-card"><span class="label">Horas do mês passado</span><span class="value mono">'+fmtHoras(mesPass.minsTrabalhados)+'</span>' +
      '<span class="hint">'+(mesPass.saldo===null ? 'total do mês' : (mesPass.saldo<0 ? fmtHoras(-mesPass.saldo)+' abaixo da meta' : mesPass.saldo>0 ? '+'+fmtHoras(mesPass.saldo)+' acima da meta' : 'bateu a meta'))+'</span>' +
    '</div>';

  return (
    '<div class="punch-status" style="margin-bottom:14px;">' +
      '<span class="avatar" style="width:44px;height:44px;font-size:15px;">'+initials(s.nome)+'</span>' +
      '<span class="who">'+esc(s.nome)+'</span>' +
      '<span class="state">'+esc(s.setorNome || setorNome(s.setor))+' · '+nivelLabel(s.nivel)+'</span>' +
      '<span class="state">Bolsa '+esc(s.bolsa||'—')+' · '+horasSemanaLabel(s)+'</span>' +
    '</div>' +
    '<div class="stat-grid" style="margin-bottom:14px;">' +
      '<div class="stat-card"><span class="label">Dias com registro</span><span class="value mono">'+totalDiasComRegistro+'/'+ultimoDiaMes+'</span><span class="hint">em '+MESES[mesRef.getMonth()]+'</span></div>' +
      '<div class="stat-card"><span class="label">Total de horas</span><span class="value mono">'+fmtHoras(totalMin)+'</span><span class="hint">no mês exibido</span></div>' +
      devidasCard +
      mesPassadoCard +
    '</div>' +
    mesNav +
    '<div class="cal-weekdays">'+headerDias+'</div>' +
    '<div class="cal-grid">'+padCells+cells+'</div>' +
    previewDiaHtml(s, UI.calendarioDiaPreview) +
    '<div class="view-sub" style="margin-top:10px;">Clique num dia para ver os horários registrados. Clique duas vezes para editar ou adicionar um ponto.</div>'
  );
}

/* Preview rápido (1 clique) dos horários batidos num dia — só leitura, fica
   logo abaixo do calendário. Pra editar/adicionar de verdade, usa o pop up
   (2 cliques), que é o renderCalendarioDiaModal(). */
function previewDiaHtml(s, diaKey){
  if(!diaKey) return '';
  var parts = diaKey.split('-');
  var dSel = new Date(parseInt(parts[0],10), parseInt(parts[1],10)-1, parseInt(parts[2],10));
  var regs = registrosDoAlunoNoDia(s.id, dSel);
  var mins = minutosNoDia(s.id, dSel);
  var itens = regs.slice().sort(function(a,b){ return a.ts<b.ts?-1:1; }).map(function(r){
    return '<div class="log-item"><span class="t">'+fmtTime(r.ts)+'</span><span>'+(r.tipo==='entrada'?'Chegada':'Saída')+'</span></div>';
  }).join('') || '<div class="empty-state">Nenhum registro nesse dia.</div>';
  var resumo = regs.length===0 ? '' : (mins>0 ? '<span class="hint">Total: '+fmtHoras(mins)+'</span>' : '<span class="hint" style="color:var(--danger,#d33);">Sem par — não soma nas horas</span>');
  return (
    '<div class="stat-card" style="margin-top:10px;">' +
      '<span class="label">'+DIAS_SEMANA[dSel.getDay()]+', '+fmtDateBR(diaKey)+'</span>' +
      '<div class="log-list" style="margin-top:6px;">'+itens+'</div>' +
      resumo +
    '</div>'
  );
}

/* Popup com o detalhe do dia selecionado no Calendário — registros do dia,
   edição de horário e adicionar ponto que faltou. Fica num overlay próprio
   (mesmo padrão do drawer de editar aluno), então re-render() completo
   (chamado pelos botões dentro dele) reconstrói a tela por trás E chama essa
   função de novo no final, então o popup sempre reflete o dado mais novo. */
function renderCalendarioDiaModal(){
  var existing = $('.overlay.overlay-center');
  if(existing) existing.remove();
  var s = studentById(UI.calendarioAlunoId);
  if(!s || !UI.calendarioDiaSel){ return; }
  var parts = UI.calendarioDiaSel.split('-');
  var dSel = new Date(parseInt(parts[0],10), parseInt(parts[1],10)-1, parseInt(parts[2],10));

  var regsDia = registrosDoAlunoNoDia(s.id, dSel);
  var minsDia = minutosNoDia(s.id, dSel);
  var itens = regsDia.map(function(r){
    if(UI.calendarioEditandoRegistroId === r.id){
      return '<div class="log-item" data-cal-editando="'+r.id+'">' +
        '<span style="flex:1;">'+(r.tipo==='entrada'?'Chegada':'Saída')+'</span>' +
        '<input type="time" class="mono" style="width:auto;" data-cal-hora-edit="'+r.id+'" value="'+fmtTime(r.ts)+'">' +
        '<button class="btn btn-sm btn-primary" data-cal-salvar-registro="'+r.id+'" type="button">Salvar</button>' +
        '<button class="btn btn-sm btn-ghost" data-cal-cancelar-edicao type="button">Cancelar</button>' +
      '</div>';
    }
    return '<div class="log-item"><span class="t">'+fmtTime(r.ts)+'</span><span style="flex:1;">'+(r.tipo==='entrada'?'Chegada':'Saída')+' · <span style="color:var(--muted);">'+esc(r.origem||'')+'</span></span>' +
      '<button class="btn btn-sm btn-ghost" data-cal-editar-registro="'+r.id+'" type="button" title="Corrigir o horário desse registro">Editar horário</button>' +
      '<button class="btn btn-sm btn-ghost" data-cal-del-registro="'+r.id+'" type="button" title="Excluir este registro">Excluir</button>' +
    '</div>';
  }).join('') || '<div class="empty-state">Nenhum registro nesse dia.</div>';
  var formAddPonto =
    '<form data-cal-add-ponto="'+UI.calendarioDiaSel+'" style="margin-top:4px;display:flex;flex-direction:column;gap:8px;padding:10px;background:var(--surface);border-radius:var(--radius-sm);box-shadow:var(--shadow-sm);">' +
      '<div style="display:flex;gap:10px;">' +
        '<label style="flex:1;font-size:11.5px;color:var(--muted);">Chegada<input type="time" name="inicio" class="mono"></label>' +
        '<label style="flex:1;font-size:11.5px;color:var(--muted);">Saída<input type="time" name="fim" class="mono"></label>' +
      '</div>' +
      '<button class="btn btn-sm btn-primary" type="submit">+ Adicionar ponto(s)</button>' +
    '</form>';

  var overlay = document.createElement('div');
  overlay.className = 'overlay overlay-center';
  overlay.innerHTML =
    '<div class="modal-card">' +
      '<div class="drawer-head">' +
        '<div><div class="name" style="font-size:17px;">'+DIAS_SEMANA[dSel.getDay()]+', '+fmtDateBR(UI.calendarioDiaSel)+'</div>' +
          '<div class="setor">'+esc(s.nome)+' · '+(minsDia>0 ? fmtHoras(minsDia)+' no dia' : (regsDia.length ? 'sem par completo' : 'sem registro'))+'</div></div>' +
        '<button class="close-btn" aria-label="Fechar">✕</button>' +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:6px;">'+itens+formAddPonto+'</div>' +
    '</div>';
  document.body.appendChild(overlay);

  overlay.addEventListener('mousedown', function(e){ if(e.target===overlay) closeCalendarioDiaModal(); });
  var closeBtn = $('.close-btn', overlay);
  if(closeBtn) closeBtn.addEventListener('click', closeCalendarioDiaModal);

  $all('[data-cal-del-registro]', overlay).forEach(function(btn){
    btn.addEventListener('click', function(){
      var id = btn.getAttribute('data-cal-del-registro');
      var registro = STATE.registros.filter(function(r){ return r.id===id; })[0];
      if(!registro) return;
      removeRegistro(id);
      logAtividade((registro.tipo==='entrada'?'Chegada':'Saída')+' de '+fmtDateTime(registro.ts)+' excluída manualmente.');
      toast('Registro excluído.', null, {
        actionLabel: 'Desfazer',
        onAction: function(){
          addRegistro(registro);
          logAtividade('Exclusão de registro desfeita.');
          toast('Exclusão desfeita.');
          persist();
        }
      });
      persist();
    });
  });
  $all('[data-cal-editar-registro]', overlay).forEach(function(btn){
    btn.addEventListener('click', function(){
      UI.calendarioEditandoRegistroId = btn.getAttribute('data-cal-editar-registro');
      renderCalendarioDiaModal();
    });
  });
  $all('[data-cal-cancelar-edicao]', overlay).forEach(function(btn){
    btn.addEventListener('click', function(){
      UI.calendarioEditandoRegistroId = null;
      renderCalendarioDiaModal();
    });
  });
  $all('[data-cal-salvar-registro]', overlay).forEach(function(btn){
    btn.addEventListener('click', function(){
      var id = btn.getAttribute('data-cal-salvar-registro');
      var registro = STATE.registros.filter(function(r){ return r.id===id; })[0];
      var input = $('[data-cal-hora-edit="'+id+'"]', overlay);
      if(!registro || !input || !input.value){ return; }
      // Mantém o mesmo dia do registro original, só troca a hora:minuto.
      var diaKey = todayKey(new Date(registro.ts));
      var novoTs = new Date(diaKey+'T'+input.value+':00').toISOString();
      var horaAntiga = fmtTime(registro.ts);
      updateRegistro(id, {ts: novoTs});
      logAtividade('Horário de '+(registro.tipo==='entrada'?'chegada':'saída')+' de '+fmtDateBR(diaKey)+' corrigido de '+horaAntiga+' para '+input.value+'.');
      toast('Horário atualizado.');
      UI.calendarioEditandoRegistroId = null;
      persist();
    });
  });
  $all('[data-cal-add-ponto]', overlay).forEach(function(form){
    form.addEventListener('submit', function(e){
      e.preventDefault();
      var diaKey = form.getAttribute('data-cal-add-ponto');
      var aluno = studentById(UI.calendarioAlunoId);
      if(!aluno) return;
      var fd = new FormData(form);
      var inicio = fd.get('inicio');
      var fim = fd.get('fim');
      if(!inicio && !fim){ toast('Informe a chegada, a saída, ou as duas.', 'err'); return; }
      var partes = [];
      if(inicio){
        addRegistro({id: uid('r'), studentId: aluno.id, tipo:'entrada', ts: new Date(diaKey+'T'+inicio+':00').toISOString(), origem: 'manual-admin'});
        partes.push('chegada às '+inicio);
      }
      if(fim){
        addRegistro({id: uid('r'), studentId: aluno.id, tipo:'saida', ts: new Date(diaKey+'T'+fim+':00').toISOString(), origem: 'manual-admin'});
        partes.push('saída às '+fim);
      }
      logAtividade('Ponto de '+aluno.nome+' em '+fmtDateBR(diaKey)+' ('+partes.join(' e ')+') adicionado manualmente.');
      toast(partes.length>1 ? 'Chegada e saída adicionadas.' : 'Ponto adicionado.');
      persist();
    });
  });
}
function closeCalendarioDiaModal(){
  UI.calendarioDiaSel = null;
  UI.calendarioEditandoRegistroId = null;
  var overlay = $('.overlay.overlay-center'); if(overlay) overlay.remove();
}

function viewPedidos(){
  var pend = pedidosPendentes();
  var resolvidos = STATE.pedidos.filter(function(p){return p.status!=='pendente';})
    .sort(function(a,b){ return new Date(b.resolvidoEm||b.criadoEm) - new Date(a.resolvidoEm||a.criadoEm); })
    .slice(0,25);

  var studentOpts = STATE.students.filter(function(s){return s.ativo;}).slice().sort(function(a,b){return a.nome.localeCompare(b.nome,'pt-BR');})
    .map(function(s){ return '<option value="'+s.id+'">'+esc(s.nome)+' — '+esc(setorNome(s.setor))+'</option>'; }).join('');

  var responsavelOpts = '<option value="Administração">Administração</option>' + STATE.lideres.map(function(l){
    return '<option value="'+esc(l.nome)+'">'+esc(l.nome)+'</option>';
  }).join('');

  var pendRows = pend.map(function(p){
    var s = studentById(p.studentId);
    return '<div class="log-item" style="flex-wrap:wrap;">' +
      '<span class="t">'+fmtDateBR(p.data)+' · '+p.horario+'</span>' +
      '<span style="flex:1;min-width:180px;"><b>'+esc(s?s.nome:'—')+'</b> · pedindo registro de <b>'+(p.tipoAlvo==='entrada'?'chegada':'saída')+'</b>' +
        (p.motivo ? '<br><span style="color:var(--muted);">'+esc(p.motivo)+'</span>' : '') + '</span>' +
      '<select class="mono" style="width:auto;min-width:170px;" data-resp-for="'+p.id+'">'+responsavelOpts+'</select>' +
      '<button class="btn btn-sm btn-primary" data-aprovar="'+p.id+'">Aprovar</button>' +
      '<button class="btn btn-sm btn-danger" data-rejeitar="'+p.id+'">Rejeitar</button>' +
    '</div>';
  }).join('') || '<div class="empty-state">Nenhum pedido aguardando aprovação.</div>';

  var histRows = resolvidos.map(function(p){
    var s = studentById(p.studentId);
    return '<div class="log-item">' +
      '<span class="t">'+fmtDateBR(p.data)+' · '+p.horario+'</span>' +
      '<span style="flex:1;">'+esc(s?s.nome:'—')+' · '+(p.tipoAlvo==='entrada'?'chegada':'saída')+'</span>' +
      pill(p.status==='aprovado' ? 'OK' : 'rejeitado') +
      '<span style="color:var(--muted);font-size:11.5px;">'+esc(p.resolvidoPor||'')+'</span>' +
    '</div>';
  }).join('') || '<div class="empty-state">Ainda sem histórico.</div>';

  return (
    '<div class="view-head"><div><h1>Pedidos de ajuste</h1><div class="view-sub">Quando alguém esquece de bater o ponto, o ajuste é pedido aqui e um responsável aprova antes de valer nas horas do aluno.</div></div></div>' +

    '<div class="card">' +
      '<div class="card-head"><h2>Novo pedido</h2></div>' +
      '<div class="card-body">' +
        '<form id="form-pedido">' +
          '<div class="field-row">' +
            '<label>Aluno<select name="studentId" required><option value="">Selecione…</option>'+studentOpts+'</select></label>' +
            '<label>Data<input type="date" name="data" required value="'+todayKey()+'" max="'+todayKey()+'"></label>' +
            '<label>Tipo<select name="tipoAlvo"><option value="entrada">Chegada</option><option value="saida">Saída</option></select></label>' +
            '<label>Horário<input type="time" name="horario" required></label>' +
          '</div>' +
          '<label>Motivo<textarea name="motivo" placeholder="Ex.: esqueci de bater o ponto na chegada, cheguei às 13h"></textarea></label>' +
          '<div><button class="btn btn-primary" type="submit">Enviar pedido</button></div>' +
        '</form>' +
      '</div>' +
    '</div>' +

    '<div class="card"><div class="card-head"><h2>Aguardando aprovação</h2><span class="meta">'+pend.length+'</span></div><div class="card-body" style="display:flex;flex-direction:column;gap:8px;">'+pendRows+'</div></div>' +
    '<div class="card"><div class="card-head"><h2>Histórico recente</h2></div><div class="card-body" style="display:flex;flex-direction:column;gap:8px;">'+histRows+'</div></div>'
  );
}

function viewConfig(){
  var bolsaRows = Object.keys(STATE.bolsaHoras).sort().map(function(code){
    var v = STATE.bolsaHoras[code];
    return '<tr><td class="mono">'+esc(code)+'</td>' +
      '<td class="num"><input type="number" min="0" class="mono" style="width:90px;text-align:right;" data-bolsa-horas="'+esc(code)+'" value="'+(v===null?'':v)+'" placeholder="?"></td>' +
      '<td><button class="btn btn-sm btn-ghost" data-del-bolsa="'+esc(code)+'">remover</button></td></tr>';
  }).join('');

  var lideresRows = STATE.lideres.map(function(l){
    var opts = STATE.setores.map(function(s){ return '<option value="'+s.id+'"'+(s.id===l.setor?' selected':'')+'>'+esc(s.nome)+'</option>'; }).join('');
    return '<tr><td><input type="text" data-lider-nome="'+l.id+'" value="'+esc(l.nome)+'"></td>' +
      '<td><select data-lider-setor="'+l.id+'">'+opts+'</select></td>' +
      '<td><button class="btn btn-sm btn-ghost" data-del-lider="'+l.id+'">remover</button></td></tr>';
  }).join('');

  return (
    '<div class="view-head"><div><h1>Configurações</h1><div class="view-sub">Ajuste a carga horária de cada código de bolsa, os responsáveis por setor e a conversão de pontos.</div></div></div>' +

    '<div class="segmented">' +
      '<button data-configtab="bolsas" class="'+(UI.configTab==='bolsas'?'active':'')+'">Códigos de bolsa</button>' +
      '<button data-configtab="lideres" class="'+(UI.configTab==='lideres'?'active':'')+'">Responsáveis por setor</button>' +
      '<button data-configtab="pontos" class="'+(UI.configTab==='pontos'?'active':'')+'">Pontuação</button>' +
      '<button data-configtab="exportar" class="'+(UI.configTab==='exportar'?'active':'')+'">Exportar dados</button>' +
    '</div>' +

    (UI.configTab==='bolsas' ?
      '<div class="card"><div class="card-head"><h2>Horas semanais por código de bolsa</h2><span class="meta">usado para calcular a meta de cada aluno</span></div>' +
      '<div class="card-body tight"><div class="table-wrap"><table><thead><tr><th>Código</th><th class="num">Horas/semana</th><th></th></tr></thead><tbody>'+bolsaRows+'</tbody></table></div></div>' +
      '<div class="card-body"><form id="form-novo-bolsa" class="toolbar"><input type="text" name="codigo" class="w-200" placeholder="Novo código (ex.: ADP3)" required><input type="number" name="horas" class="w-140" placeholder="Horas/semana"><button class="btn btn-sm" type="submit">Adicionar código</button></form></div></div>'
      : '') +

    (UI.configTab==='lideres' ?
      '<div class="card"><div class="card-head"><h2>Líderes / chefes de setor</h2><span class="meta">aparecem como opção de responsável nos pedidos de ajuste</span></div>' +
      '<div class="card-body tight"><div class="table-wrap"><table><thead><tr><th>Nome</th><th>Setor</th><th></th></tr></thead><tbody>'+lideresRows+'</tbody></table></div></div>' +
      '<div class="card-body"><form id="form-novo-lider" class="toolbar"><input type="text" name="nome" placeholder="Nome do responsável" required><select name="setor">'+STATE.setores.map(function(s){return '<option value="'+s.id+'">'+esc(s.nome)+'</option>';}).join('')+'</select><button class="btn btn-sm" type="submit">Adicionar</button></form></div></div>'
      : '') +

    (UI.configTab==='pontos' ?
      '<div class="card"><div class="card-head"><h2>Conversão de pontos</h2></div><div class="card-body">' +
      '<label class="w-260">Pontos por hora trabalhada<input type="number" min="0" step="0.5" id="input-pontos-hora" value="'+STATE.pontosPorHora+'"></label>' +
      '<p class="view-sub" style="margin-top:10px;">Cada hora completa registrada (chegada + saída confirmadas) vale essa quantidade de pontos no perfil do aluno. Ajuste aqui se a regra de pontuação mudar.</p>' +
      '</div></div>'
      : '') +

    (UI.configTab==='exportar' ?
      '<div class="card"><div class="card-head"><h2>Exportar para Excel</h2><span class="meta">gera um arquivo .xlsx só com o essencial</span></div><div class="card-body">' +
      '<p class="view-sub">O arquivo baixado traz uma planilha com um aluno por linha e apenas:</p>' +
      '<ul style="margin:10px 0 18px 18px;font-size:13px;color:var(--ink-soft);display:flex;flex-direction:column;gap:4px;">' +
        '<li><b>Nome</b></li>' +
        '<li><b>RA</b></li>' +
        '<li><b>Horas</b> — saldo da semana atual: horas feitas a mais (ex.: "+2h") ou horas negativas, faltando cumprir (ex.: "-3h").</li>' +
      '</ul>' +
      '<button class="btn btn-primary" data-action="exportar-excel">⇩ Baixar Excel (.xlsx)</button>' +
      '</div></div>'
      : '')
  );
}

/* ============================================================
   Drawer (student profile)
   ============================================================ */
function renderDrawer(){
  var existing = $('.overlay');
  if(existing) existing.remove();
  var creating = UI.drawerCreate;
  var aprovando = creating && UI.aprovandoCadastroUid;
  var s = creating ? Object.assign(
    {id:'', nome:'', setor:STATE.setores[0].id, nivel: aprovando?'FAC':'EM', bolsa:'', ra:'', telefone:'', aniversario:'', curso:'', diasTrabalho:'', pendenteHerdada:'', observacao:'', ativo:true},
    (UI.aprovandoCadastroDados || {})
  ) : studentById(UI.drawerId);
  if(!s){ UI.drawerId = null; return; }

  var overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = '<div class="drawer">' + (UI.drawerEdit || creating ? drawerEditForm(s, creating, aprovando) : drawerView(s)) + '</div>';
  document.body.appendChild(overlay);

  overlay.addEventListener('mousedown', function(e){ if(e.target===overlay) closeDrawer(); });
  var closeBtn = $('.close-btn', overlay);
  if(closeBtn) closeBtn.addEventListener('click', closeDrawer);
  var editBtn = $('[data-drawer-edit]', overlay);
  if(editBtn) editBtn.addEventListener('click', function(){ UI.drawerEdit = true; renderDrawer(); });
  var toggleBtn = $('[data-drawer-toggle-ativo]', overlay);
  if(toggleBtn) toggleBtn.addEventListener('click', function(){
    s.ativo = !s.ativo;
    logAtividade((s.ativo?'Reativou':'Desativou')+' o cadastro de '+s.nome+'.');
    persist();
  });
  var excluirBtn = $('[data-drawer-excluir]', overlay);
  if(excluirBtn) excluirBtn.addEventListener('click', function(){ excluirCadastroPermanente(s); });
  var form = $('#form-perfil', overlay);
  if(form) form.addEventListener('submit', function(e){
    e.preventDefault();
    saveProfileForm(form, s, creating);
  });
  var cancelBtn = $('[data-drawer-cancel]', overlay);
  if(cancelBtn) cancelBtn.addEventListener('click', function(){
    if(creating){ closeDrawer(); } else { UI.drawerEdit = false; renderDrawer(); }
  });
}
function closeDrawer(){
  UI.drawerId = null; UI.drawerEdit = false; UI.drawerCreate = false;
  UI.aprovandoCadastroUid = null; UI.aprovandoCadastroDados = null;
  var overlay = $('.overlay'); if(overlay) overlay.remove();
}
function drawerView(s){
  var logs = registrosDoAluno(s.id).slice().reverse().slice(0,30).map(function(r){
    return '<div class="log-item"><span class="t">'+fmtDateTime(r.ts)+'</span><span>'+(r.tipo==='entrada'?'Chegada':'Saída')+' · <span style="color:var(--muted);">'+esc(r.origem||'')+'</span></span></div>';
  }).join('') || '<div class="empty-state">Nenhum registro de ponto ainda.</div>';

  return (
    '<div class="drawer-head">' +
      '<div><div class="name">'+esc(s.nome)+'</div><div class="setor">'+esc(setorNome(s.setor))+' · '+nivelLabel(s.nivel)+(s.ativo?'':' · <span style="color:var(--critical);">inativo</span>')+'</div></div>' +
      '<button class="close-btn" aria-label="Fechar">✕</button>' +
    '</div>' +
    (s.observacao ? '<div class="banner">'+esc(s.observacao)+'</div>' : '') +
    (pendenteKind(s.pendenteHerdada)!=='ok' && pendenteKind(s.pendenteHerdada)!=='muted' ? '<div class="banner">Pendência herdada da planilha (até jun/2026): <b>'+esc(s.pendenteHerdada)+'</b></div>' : '') +

    '<div class="kv-grid">' +
      kv('RA', s.ra || '—') + kv('Telefone', s.telefone || '—') +
      kv('Aniversário', s.aniversario ? fmtDateBR(s.aniversario) : '—') + kv('Curso', s.curso || '—') +
      kv('Bolsa', s.bolsa || '—') + kv('Carga horária', horasSemanaLabel(s)) +
      kv('Dias de trabalho', diasTrabalhoLabel(s) || '—', true) +
    '</div>' +

    '<div class="stat-grid">' +
      '<div class="stat-card"><span class="label">Horas no sistema</span><span class="value mono">'+fmtHoras(minutosTrabalhados(s.id))+'</span></div>' +
      '<div class="stat-card accent"><span class="label">Pontos</span><span class="value mono">'+pontosDoAluno(s.id)+'</span></div>' +
    '</div>' +

    '<div class="toolbar"><button class="btn btn-primary btn-sm" data-drawer-edit>Editar cadastro</button>' +
      '<button class="btn btn-sm '+(s.ativo?'btn-danger':'')+'" data-drawer-toggle-ativo>'+(s.ativo?'Desativar':'Reativar')+'</button>' +
      '<button class="btn btn-sm btn-danger" data-drawer-excluir title="Apaga de vez o cadastro, o RA, os registros de ponto e os pedidos de ajuste. Diferente de \'Desativar\', não tem como desfazer.">🗑 Excluir permanentemente</button></div>' +

    '<div><h3 style="font-size:13px;margin-bottom:8px;">Histórico de ponto</h3><div class="log-list">'+logs+'</div></div>'
  );
}
function kv(k,v,full){
  return '<div class="kv'+(full?' full':'')+'"><span class="k">'+esc(k)+'</span><span class="v">'+esc(v)+'</span></div>';
}
function drawerEditForm(s, creating, aprovando){
  var setorOpts = STATE.setores.map(function(x){ return '<option value="'+x.id+'"'+(x.id===s.setor?' selected':'')+'>'+esc(x.nome)+'</option>'; }).join('');
  return (
    '<div class="drawer-head"><div class="name">'+(aprovando?'Aprovar cadastro':(creating?'Novo aluno':'Editar '+esc(s.nome)))+'</div>' +
      '<button class="close-btn" aria-label="Fechar">✕</button></div>' +
    (aprovando ? '<div class="banner">Essa pessoa já criou o login com o e-mail dela — complete o setor, nível e demais dados abaixo para liberar o acesso.</div>' : '') +
    '<form id="form-perfil" style="display:flex;flex-direction:column;gap:14px;">' +
      '<label>Nome completo<input type="text" name="nome" required value="'+esc(s.nome)+'"></label>' +
      '<div class="field-row">' +
        '<label>Setor<select name="setor">'+setorOpts+'</select></label>' +
        '<label>Nível<select name="nivel"><option value="EM"'+(s.nivel==='EM'?' selected':'')+'>Ensino Médio</option><option value="FAC"'+(s.nivel==='FAC'?' selected':'')+'>Faculdade</option></select></label>' +
      '</div>' +
      '<div class="field-row">' +
        '<label>Código da bolsa<input type="text" name="bolsa" value="'+esc(s.bolsa)+'" placeholder="ex.: ADP6"></label>' +
        '<label>RA<input type="text" name="ra" value="'+esc(s.ra)+'"></label>' +
      '</div>' +
      '<div class="field-row">' +
        '<label>Telefone<input type="text" name="telefone" value="'+esc(s.telefone)+'"></label>' +
        '<label>Aniversário<input type="date" name="aniversario" value="'+esc(s.aniversario)+'"></label>' +
      '</div>' +
      '<label>Curso<input type="text" name="curso" value="'+esc(s.curso)+'"></label>' +
      '<div class="field-block">' +
        '<span class="field-block-label">Dias de trabalho</span>' +
        '<div class="dias-picker">'+(function(){
          var marcados = diasTrabalhoArray(s);
          return DIAS_TRABALHO_OPTS.map(function(opt){
            var checked = marcados.indexOf(opt.code) !== -1;
            return '<label class="dia-check"><input type="checkbox" name="diasTrabalho" value="'+opt.code+'"'+(checked?' checked':'')+'> '+opt.label+'</label>';
          }).join('');
        })()+'</div>' +
      '</div>' +
      '<label>Observações<textarea name="observacao">'+esc(s.observacao)+'</textarea></label>' +
      '<div class="toolbar"><button class="btn btn-primary" type="submit">'+(aprovando?'Aprovar e cadastrar':(creating?'Cadastrar aluno':'Salvar alterações'))+'</button>' +
        '<button class="btn btn-ghost" type="button" data-drawer-cancel>Cancelar</button></div>' +
    '</form>'
  );
}
function saveProfileForm(form, s, creating){
  var fd = new FormData(form);
  var patch = {
    nome: (fd.get('nome')||'').trim(),
    setor: fd.get('setor'),
    nivel: fd.get('nivel'),
    bolsa: (fd.get('bolsa')||'').trim(),
    ra: (fd.get('ra')||'').trim(),
    telefone: (fd.get('telefone')||'').trim(),
    aniversario: fd.get('aniversario') || '',
    curso: (fd.get('curso')||'').trim(),
    diasTrabalho: fd.getAll('diasTrabalho').join(','), // caixinhas marcadas (Seg..Dom), ex.: "seg,ter,qua,qui,sex"
    observacao: (fd.get('observacao')||'').trim()
  };
  if(!patch.nome){ toast('Informe o nome do aluno.', 'err'); return; }
  if(creating){
    var novo = Object.assign({id: uid('s'), pendenteHerdada:'', ativo:true, horasSemana: STATE.bolsaHoras[patch.bolsa]===undefined?null:STATE.bolsaHoras[patch.bolsa]}, patch);
    STATE.students.push(novo);
    var aprovandoUid = UI.aprovandoCadastroUid;
    if(aprovandoUid){
      logAtividade('Aprovou o cadastro de '+novo.nome+' (autocadastro por RA) e vinculou o login.');
      if(typeof window.__pontosAprovarCadastro === 'function'){
        window.__pontosAprovarCadastro(aprovandoUid, novo.id).catch(function(){
          toast('Aluno cadastrado, mas houve um problema ao liberar o login dele. Tente novamente em Alunos.', 'err');
        });
      }
    } else {
      logAtividade('Cadastrou o aluno '+novo.nome+'.');
    }
    UI.drawerCreate = false;
    UI.drawerId = novo.id;
    UI.drawerEdit = false;
    UI.aprovandoCadastroUid = null;
    UI.aprovandoCadastroDados = null;
  } else {
    Object.assign(s, patch);
    s.horasSemana = STATE.bolsaHoras[s.bolsa] === undefined ? s.horasSemana : STATE.bolsaHoras[s.bolsa];
    logAtividade('Atualizou o cadastro de '+s.nome+'.');
    UI.drawerEdit = false;
  }
  toast('Cadastro salvo.');
  persist();
}

/* ============================================================
   Event binding
   ============================================================ */
function bindEvents(){
  $all('[data-nav]').forEach(function(btn){
    btn.addEventListener('click', function(){ UI.view = btn.getAttribute('data-nav'); render(); });
  });
  $all('.logout-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      if(typeof window.__pontosLogout === 'function') window.__pontosLogout();
    });
  });

  // Alunos view
  var busca = $('#busca-aluno');
  if(busca) busca.addEventListener('input', function(){ UI.alunoBusca = busca.value; render(); preserveFocus('#busca-aluno'); });
  var fSetor = $('#filtro-setor');
  if(fSetor) fSetor.addEventListener('change', function(){ UI.alunoFiltroSetor = fSetor.value; render(); });
  var fNivel = $('#filtro-nivel');
  if(fNivel) fNivel.addEventListener('change', function(){ UI.alunoFiltroNivel = fNivel.value; render(); });
  var novoAlunoBtn = $('[data-action="novo-aluno"]');
  if(novoAlunoBtn) novoAlunoBtn.addEventListener('click', function(){
    UI.drawerCreate = true; UI.drawerId = null; UI.drawerEdit = false;
    UI.aprovandoCadastroUid = null; UI.aprovandoCadastroDados = null;
    renderDrawer();
  });
  $all('[data-action="exportar-excel"]').forEach(function(btn){
    btn.addEventListener('click', function(){ exportarExcel(); });
  });
  $all('[data-action="corrigir-duplicados"]').forEach(function(btn){
    btn.addEventListener('click', function(){ corrigirCadastrosDuplicados(); });
  });
  $all('[data-action="sincronizar-soltos"]').forEach(function(btn){
    btn.addEventListener('click', function(){ sincronizarCadastrosSoltos(); });
  });
  $all('[data-open]').forEach(function(tr){
    tr.addEventListener('click', function(){ UI.drawerId = tr.getAttribute('data-open'); UI.drawerCreate=false; UI.drawerEdit = false; renderDrawer(); });
  });
  $all('[data-toggle-aluno]').forEach(function(btn){
    btn.addEventListener('click', function(){ toggleAccordion('alunoAberto', btn.getAttribute('data-toggle-aluno')); render(); });
  });
  $all('[data-aprovar-cadastro]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var uidCad = btn.getAttribute('data-aprovar-cadastro');
      var c = (STATE.cadastrosPendentes||[]).filter(function(x){return x.id===uidCad;})[0];
      var raCad = c ? String(c.ra||'').trim() : '';
      // Evita recriar o bug dos cadastros duplicados: se já existe um cadastro
      // ativo com esse RA (ex.: da planilha original, que ainda não tinha o RA
      // sincronizado quando a pessoa se autocadastrou), liga o login direto a
      // esse cadastro em vez de abrir "Novo aluno" — criar um segundo cadastro
      // pro mesmo RA é o que gerou os cadastros fantasmas (ver "Corrigir
      // cadastros duplicados", na barra de ferramentas de Alunos).
      var existente = raCad ? STATE.students.filter(function(s){ return s.ativo!==false && String(s.ra||'').trim()===raCad; })[0] : null;
      if(existente){
        if(typeof window.__pontosAprovarCadastro !== 'function'){
          toast('Não foi possível vincular agora. Verifique sua conexão.', 'err');
          return;
        }
        window.__pontosAprovarCadastro(uidCad, existente.id).then(function(){
          logAtividade('Vinculou o login de '+(c?c.nome:'')+' ao cadastro já existente de '+existente.nome+' (RA '+raCad+' já cadastrado — evitado cadastro duplicado).');
          toast('Login vinculado ao cadastro existente de '+existente.nome+'.');
          persist();
        }).catch(function(){
          toast('Não foi possível vincular agora. Tente novamente.', 'err');
        });
        return;
      }
      UI.aprovandoCadastroUid = uidCad;
      UI.aprovandoCadastroDados = {nome: c ? (c.nome||'') : '', ra: c ? (c.ra||'') : ''};
      UI.drawerCreate = true; UI.drawerId = null; UI.drawerEdit = false;
      renderDrawer();
    });
  });
  $all('[data-rejeitar-cadastro]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var uidCad = btn.getAttribute('data-rejeitar-cadastro');
      var c = (STATE.cadastrosPendentes||[]).filter(function(x){return x.id===uidCad;})[0];
      if(typeof window.__pontosRejeitarCadastro !== 'function'){
        toast('Não foi possível excluir agora. Verifique sua conexão.', 'err');
        return;
      }
      window.__pontosRejeitarCadastro(uidCad).then(function(){
        logAtividade('Excluiu o cadastro pendente de '+(c?c.nome:uidCad)+' (RA não encontrado).');
        toast('Cadastro excluído.');
        persist();
      }).catch(function(){
        toast('Não foi possível excluir agora. Verifique sua conexão.', 'err');
      });
    });
  });

  // Ponto view
  $all('[data-punchmode]').forEach(function(btn){
    btn.addEventListener('click', function(){
      UI.punchMode = btn.getAttribute('data-punchmode'); UI.punchSelected = null; UI.punchSearch='';
      UI.punchBulkMode = false; UI.punchBulkSelected = [];
      render();
    });
  });
  var punchSetorSel = $('#punch-setor');
  if(punchSetorSel) punchSetorSel.addEventListener('change', function(){ UI.punchSetor = punchSetorSel.value; UI.punchSelected = null; UI.punchBulkSelected = []; render(); });
  var punchBusca = $('#punch-busca');
  if(punchBusca) punchBusca.addEventListener('input', function(){ UI.punchSearch = punchBusca.value; render(); preserveFocus('#punch-busca'); });
  $all('[data-select-punch]').forEach(function(item){
    item.addEventListener('click', function(){ toggleAccordion('punchSelected', item.getAttribute('data-select-punch')); render(); });
  });
  $all('[data-punch]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var id = btn.getAttribute('data-id');
      var tipo = btn.getAttribute('data-punch');
      var s = studentById(id);
      var novoId = uid('r');
      addRegistro({id: novoId, studentId:id, tipo:tipo, ts: nowISO(), origem: UI.punchMode==='lider' ? 'lider' : 'self'});
      logAtividade((tipo==='entrada'?'Chegada':'Saída')+' registrada para '+s.nome+' às '+fmtTime(nowISO())+'.');
      toast((tipo==='entrada'?'Chegada':'Saída')+' registrada para '+s.nome+'.', null, {
        actionLabel: 'Desfazer',
        onAction: function(){
          removeRegistro(novoId);
          logAtividade((tipo==='entrada'?'Chegada':'Saída')+' de '+s.nome+' desfeita (marcada por engano).');
          toast('Registro desfeito.');
          persist();
        }
      });
      persist();
    });
  });
  $all('[data-punch-turno]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var id = btn.getAttribute('data-id');
      var s = studentById(id);
      var inicio = new Date();
      var fim = new Date(inicio.getTime() + 4*60*60*1000);
      var origem = UI.punchMode==='lider' ? 'lider' : 'self';
      var idEntrada = uid('r'), idSaida = uid('r');
      addRegistro({id: idEntrada, studentId:id, tipo:'entrada', ts: inicio.toISOString(), origem: origem});
      addRegistro({id: idSaida, studentId:id, tipo:'saida', ts: fim.toISOString(), origem: origem});
      logAtividade('Turno de 4h registrado para '+s.nome+' ('+fmtTime(inicio.toISOString())+'–'+fmtTime(fim.toISOString())+').');
      toast('Turno de 4h registrado para '+s.nome+'.', null, {
        actionLabel: 'Desfazer',
        onAction: function(){
          removeRegistro(idEntrada);
          removeRegistro(idSaida);
          logAtividade('Turno de 4h de '+s.nome+' desfeito (marcado por engano).');
          toast('Turno desfeito.');
          persist();
        }
      });
      persist();
    });
  });

  // Ponto view — seleção em lote
  var bulkToggleBtn = $('[data-bulk-toggle]');
  if(bulkToggleBtn) bulkToggleBtn.addEventListener('click', function(){ UI.punchBulkMode = true; UI.punchBulkSelected = []; render(); });
  var bulkCancelBtn = $('[data-bulk-cancel]');
  if(bulkCancelBtn) bulkCancelBtn.addEventListener('click', function(){ UI.punchBulkMode = false; UI.punchBulkSelected = []; render(); });
  var bulkClearBtn = $('[data-bulk-clear]');
  if(bulkClearBtn) bulkClearBtn.addEventListener('click', function(){ UI.punchBulkSelected = []; render(); });
  var bulkSelectAllBtn = $('[data-bulk-select-all]');
  if(bulkSelectAllBtn) bulkSelectAllBtn.addEventListener('click', function(){
    $all('[data-bulk-select]').forEach(function(el){
      var id = el.getAttribute('data-bulk-select');
      if(UI.punchBulkSelected.indexOf(id)===-1) UI.punchBulkSelected.push(id);
    });
    render();
  });
  $all('[data-bulk-select]').forEach(function(item){
    item.addEventListener('click', function(){
      var id = item.getAttribute('data-bulk-select');
      var i = UI.punchBulkSelected.indexOf(id);
      if(i===-1) UI.punchBulkSelected.push(id); else UI.punchBulkSelected.splice(i,1);
      render();
    });
  });
  $all('[data-bulk-punch]').forEach(function(btn){
    btn.addEventListener('click', function(){ bulkPunch(btn.getAttribute('data-bulk-punch')); });
  });
  var bulkTurnoBtn = $('[data-bulk-punch-turno]');
  if(bulkTurnoBtn) bulkTurnoBtn.addEventListener('click', function(){ bulkPunchTurno(); });

  // Calendário view
  var calendarioBusca = $('#calendario-busca');
  if(calendarioBusca) calendarioBusca.addEventListener('input', function(){ UI.calendarioBusca = calendarioBusca.value; render(); preserveFocus('#calendario-busca'); });
  $all('[data-select-calendario]').forEach(function(item){
    item.addEventListener('click', function(){
      UI.calendarioDiaSel = null;
      UI.calendarioDiaPreview = null;
      UI.calendarioMesOffset = 0;
      toggleAccordion('calendarioAlunoId', item.getAttribute('data-select-calendario'));
      render();
    });
  });
  $all('[data-cal-dia]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var key = btn.getAttribute('data-cal-dia');
      // 1 clique = só mostra os horários do dia logo abaixo do calendário
      // (preview rápido, sem abrir nada); 2 cliques = abre o pop up completo
      // pra editar/adicionar ponto (handler de dblclick abaixo).
      UI.calendarioDiaPreview = UI.calendarioDiaPreview===key ? null : key;
      render();
    });
    btn.addEventListener('dblclick', function(){
      var key = btn.getAttribute('data-cal-dia');
      UI.calendarioDiaSel = key;
      UI.calendarioEditandoRegistroId = null;
      render();
    });
  });
  $all('[data-cal-mes]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var delta = parseInt(btn.getAttribute('data-cal-mes'),10) || 0;
      var novo = UI.calendarioMesOffset + delta;
      UI.calendarioMesOffset = novo > 0 ? 0 : novo; // não deixa avançar além do mês atual
      UI.calendarioDiaSel = null;
      UI.calendarioDiaPreview = null;
      render();
    });
  });

  // Pedidos view
  var formPedido = $('#form-pedido');
  if(formPedido) formPedido.addEventListener('submit', function(e){
    e.preventDefault();
    var fd = new FormData(formPedido);
    var studentId = fd.get('studentId');
    if(!studentId){ toast('Selecione o aluno.', 'err'); return; }
    var s = studentById(studentId);
    addPedido({
      id: uid('p'), studentId: studentId, data: fd.get('data'), tipoAlvo: fd.get('tipoAlvo'),
      horario: fd.get('horario'), motivo: (fd.get('motivo')||'').trim(),
      status: 'pendente', criadoEm: nowISO()
    });
    logAtividade('Novo pedido de ajuste para '+s.nome+' ('+fmtDateBR(fd.get('data'))+' '+fd.get('horario')+').');
    toast('Pedido enviado para aprovação.');
    persist();
  });
  $all('[data-aprovar]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var id = btn.getAttribute('data-aprovar');
      var resp = $('[data-resp-for="'+id+'"]');
      resolvePedido(id, 'aprovado', resp ? resp.value : 'Administração');
    });
  });
  $all('[data-rejeitar]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var id = btn.getAttribute('data-rejeitar');
      var resp = $('[data-resp-for="'+id+'"]');
      resolvePedido(id, 'rejeitado', resp ? resp.value : 'Administração');
    });
  });

  // Config view
  $all('[data-configtab]').forEach(function(btn){
    btn.addEventListener('click', function(){ UI.configTab = btn.getAttribute('data-configtab'); render(); });
  });
  $all('[data-bolsa-horas]').forEach(function(inp){
    inp.addEventListener('change', function(){
      var code = inp.getAttribute('data-bolsa-horas');
      var v = inp.value === '' ? null : parseInt(inp.value,10);
      STATE.bolsaHoras[code] = v;
      STATE.students.forEach(function(s){ if(s.bolsa===code) s.horasSemana = v; });
      logAtividade('Atualizou a carga horária do código '+code+' para '+(v===null?'indefinida':v+'h/semana')+'.');
      persist();
    });
  });
  $all('[data-del-bolsa]').forEach(function(btn){
    btn.addEventListener('click', function(){
      delete STATE.bolsaHoras[btn.getAttribute('data-del-bolsa')];
      persist();
    });
  });
  var formNovoBolsa = $('#form-novo-bolsa');
  if(formNovoBolsa) formNovoBolsa.addEventListener('submit', function(e){
    e.preventDefault();
    var fd = new FormData(formNovoBolsa);
    var codigo = (fd.get('codigo')||'').trim().toUpperCase();
    if(!codigo) return;
    STATE.bolsaHoras[codigo] = fd.get('horas') ? parseInt(fd.get('horas'),10) : null;
    toast('Código '+codigo+' adicionado.');
    persist();
  });
  $all('[data-lider-nome]').forEach(function(inp){
    inp.addEventListener('change', function(){
      var l = STATE.lideres.filter(function(x){return x.id===inp.getAttribute('data-lider-nome');})[0];
      if(l){ l.nome = inp.value; persist(); }
    });
  });
  $all('[data-lider-setor]').forEach(function(sel){
    sel.addEventListener('change', function(){
      var l = STATE.lideres.filter(function(x){return x.id===sel.getAttribute('data-lider-setor');})[0];
      if(l){ l.setor = sel.value; persist(); }
    });
  });
  $all('[data-del-lider]').forEach(function(btn){
    btn.addEventListener('click', function(){
      STATE.lideres = STATE.lideres.filter(function(x){return x.id!==btn.getAttribute('data-del-lider');});
      persist();
    });
  });
  var formNovoLider = $('#form-novo-lider');
  if(formNovoLider) formNovoLider.addEventListener('submit', function(e){
    e.preventDefault();
    var fd = new FormData(formNovoLider);
    var nome = (fd.get('nome')||'').trim();
    if(!nome) return;
    STATE.lideres.push({id: uid('l'), nome: nome, setor: fd.get('setor')});
    toast('Responsável adicionado.');
    persist();
  });
  var inputPontos = $('#input-pontos-hora');
  if(inputPontos) inputPontos.addEventListener('change', function(){
    STATE.pontosPorHora = parseFloat(inputPontos.value) || 0;
    persist();
  });
}
function resolvePedido(id, status, respPor){
  var p = STATE.pedidos.filter(function(x){return x.id===id;})[0];
  if(!p) return;
  p.status = status;
  p.resolvidoEm = nowISO();
  p.resolvidoPor = respPor;
  updatePedidoRemoto(id, {status: p.status, resolvidoEm: p.resolvidoEm, resolvidoPor: p.resolvidoPor});
  var s = studentById(p.studentId);
  if(status==='aprovado'){
    var ts = p.data + 'T' + p.horario + ':00';
    var d = new Date(ts);
    // Aprovar um pedido SEMPRE adiciona o ponto — nunca apaga um registro
    // existente automaticamente. Já tentamos duas heurísticas pra detectar
    // quando um pedido era uma "correção" de um ponto batido errado (1
    // registro do mesmo tipo no dia; depois, 1 registro no mesmo período do
    // dia) e as duas acabaram apagando turnos de verdade em dias com vários
    // turnos (ex.: duas saídas no mesmo período). Sem uma forma confiável de
    // saber a intenção de quem pediu o ajuste, é mais seguro sempre somar e
    // deixar quem aprova apagar manualmente um ponto duplicado (aba
    // Calendário → dia → "Excluir") nos poucos casos em que for mesmo uma
    // correção.
    addRegistro({id: uid('r'), studentId: p.studentId, tipo: p.tipoAlvo, ts: d.toISOString(), origem:'ajuste-aprovado'});
    logAtividade('Pedido de ajuste de '+(s?s.nome:'')+' aprovado por '+respPor+'.');
    toast('Pedido aprovado e ponto ajustado.');
  } else {
    logAtividade('Pedido de ajuste de '+(s?s.nome:'')+' rejeitado por '+respPor+'.');
    toast('Pedido rejeitado.', 'warn');
  }
  persist();
}
function preserveFocus(sel){
  var el = $(sel);
  if(el){
    el.focus();
    try{ var v = el.value; el.setSelectionRange(v.length, v.length); }catch(e){}
  }
}

/* ============================================================
   Painel do aluno (login individual — faculdade)
   Acesso restrito: só o próprio perfil e os próprios registros.
   ============================================================ */
function viewAlunoPainel(){
  var s = STATE.students[0];
  var conservacao = isConservacao(s);
  var last = ultimoRegistro(s.id);
  var next = proximoTipo(s.id);
  var statusText;
  if(conservacao){
    var nTurnos = turnosHojeCount(s.id);
    statusText = nTurnos>0 ? (nTurnos===1 ? '1 turno registrado hoje.' : nTurnos+' turnos registrados hoje.') : 'Nenhum turno registrado hoje.';
  } else if(!last){
    statusText = 'Você ainda não bateu o ponto hoje.';
  } else if(last.tipo==='entrada'){
    statusText = sameDay(last.ts) ? ('Em andamento desde ' + fmtTime(last.ts) + '.') : ('Em andamento desde ' + fmtDateTime(last.ts) + '.');
  } else {
    statusText = sameDay(last.ts) ? ('Você saiu às ' + fmtTime(last.ts) + '. Pode registrar nova chegada se voltar hoje.') : 'Você ainda não bateu o ponto hoje.';
  }

  var saldoInfo = saldoSemanaInfo(s);
  var saldoTxt = saldoInfo.saldo===null ? 'Carga horária semanal não definida.'
    : saldoInfo.saldo>=0 ? fmtHoras(saldoInfo.saldo) + ' a mais esta semana'
    : fmtHoras(-saldoInfo.saldo) + ' devendo esta semana';
  var saldoCls = saldoInfo.cls;

  var resumoMes = resumoMesAtualAluno(s);
  var devidas = horasDevidasMesAtual(s);
  var devidasCard = devidas.saldo===null ?
    '<div class="stat-card"><span class="label">Horas devidas este mês</span><span class="value mono">—</span><span class="hint">carga horária não definida</span></div>' :
    devidas.saldo<0 ?
      '<div class="stat-card"><span class="label">Horas devidas este mês</span><span class="value mono" style="color:var(--danger,#d33);">'+fmtHoras(-devidas.saldo)+'</span><span class="hint">devendo até hoje</span></div>' :
      '<div class="stat-card"><span class="label">Horas devidas este mês</span><span class="value mono">Em dia</span><span class="hint">'+(devidas.saldo>0?'+'+fmtHoras(devidas.saldo)+' de folga':'—')+'</span></div>';

  var mesPass = horasMesPassado(s);
  var mesPassadoCard =
    '<div class="stat-card"><span class="label">Horas do mês passado</span><span class="value mono">'+fmtHoras(mesPass.minsTrabalhados)+'</span>' +
      '<span class="hint">'+(mesPass.saldo===null ? 'total do mês' : (mesPass.saldo<0 ? fmtHoras(-mesPass.saldo)+' abaixo da meta' : mesPass.saldo>0 ? '+'+fmtHoras(mesPass.saldo)+' acima da meta' : 'bateu a meta'))+'</span>' +
    '</div>';

  var historico = registrosDoAluno(s.id).slice().reverse().slice(0,10).map(function(r){
    return '<div class="log-item"><span class="t">'+fmtDateTime(r.ts)+'</span><span>'+(r.tipo==='entrada'?'Chegada':'Saída')+'</span></div>';
  }).join('') || '<div class="empty-state">Nenhum registro ainda.</div>';

  var meusPedidos = STATE.pedidos.slice().sort(function(a,b){ return new Date(b.criadoEm) - new Date(a.criadoEm); });
  var pedidosHtml = meusPedidos.slice(0,8).map(function(p){
    return '<div class="log-item"><span class="t">'+fmtDateBR(p.data)+' · '+p.horario+'</span>' +
      '<span style="flex:1;">'+(p.tipoAlvo==='entrada'?'Chegada':'Saída')+'</span>' +
      '<span class="pill '+pedidoStatusCls(p.status)+'">'+pedidoStatusLabel(p.status)+'</span></div>';
  }).join('') || '<div class="empty-state">Nenhum pedido enviado ainda.</div>';

  return (
    '<div class="aluno-card">' +
      '<div class="aluno-head">' +
        '<span class="avatar" style="width:52px;height:52px;font-size:17px;">'+initials(s.nome)+'</span>' +
        '<div><div class="name">'+esc(s.nome)+'</div><div class="setor">'+esc(s.setorNome||'')+'</div></div>' +
      '</div>' +
      '<div class="view-sub">'+statusText+'</div>' +
      (conservacao ?
        ('<div class="punch-actions">' +
          '<button class="btn btn-lg btn-primary" data-punch-turno-self>Marcar turno cumprido (+4h)</button>' +
        '</div>' +
        '<div class="view-sub">Pode apertar mais de uma vez no mesmo dia — por exemplo, um turno pela manhã e outro à noite.</div>')
        :
        ('<div class="punch-actions">' +
          '<button class="btn btn-lg btn-primary" data-punch-self="entrada" '+(next!=='entrada'?'disabled':'')+'>Marcar chegada agora</button>' +
          '<button class="btn btn-lg" data-punch-self="saida" '+(next!=='saida'?'disabled':'')+'>Marcar saída agora</button>' +
        '</div>')
      ) +
      '<div class="stat-grid" style="margin-top:18px;">' +
        '<div class="stat-card"><span class="label">Dias com registro</span><span class="value mono">'+resumoMes.totalDiasComRegistro+'/'+resumoMes.ultimoDiaMes+'</span><span class="hint">em '+resumoMes.mesLabel+'</span></div>' +
        '<div class="stat-card"><span class="label">Total de horas</span><span class="value mono">'+fmtHoras(resumoMes.totalMin)+'</span><span class="hint">no mês atual</span></div>' +
        devidasCard +
        mesPassadoCard +
      '</div>' +
      '<div class="stat-card" style="margin-top:12px;">' +
        '<span class="label">Saldo desta semana</span>' +
        '<span class="pill '+saldoCls+'" style="font-size:14px;margin-top:6px;">'+saldoTxt+'</span>' +
        '<span class="hint">meta: '+(s.horasSemana?s.horasSemana+'h/semana':'—')+'</span>' +
      '</div>' +
      '<div style="margin-top:18px;"><h3 style="font-size:13px;margin-bottom:8px;">Últimos registros</h3><div class="log-list">'+historico+'</div></div>' +
      '<div style="margin-top:22px;">' +
        '<h3 style="font-size:13px;margin-bottom:8px;">Pedir ajuste de ponto</h3>' +
        '<div class="view-sub" style="margin-bottom:10px;">Esqueceu de bater o ponto num horário certo? Peça o ajuste aqui — a administração aprova antes de valer nas suas horas.</div>' +
        '<form id="form-pedido-aluno" style="display:flex;flex-direction:column;gap:10px;">' +
          '<div class="field-row">' +
            '<label>Data<input type="date" name="data" required value="'+todayKey()+'" max="'+todayKey()+'"></label>' +
            '<label>Tipo<select name="tipoAlvo"><option value="entrada">Chegada</option><option value="saida">Saída</option></select></label>' +
            '<label>Horário<input type="time" name="horario" required></label>' +
          '</div>' +
          '<label>Motivo<textarea name="motivo" placeholder="Ex.: esqueci de bater o ponto na chegada, cheguei às 13h"></textarea></label>' +
          '<div><button class="btn btn-primary btn-sm" type="submit">Enviar pedido</button></div>' +
        '</form>' +
        '<div class="log-list" style="margin-top:14px;">'+pedidosHtml+'</div>' +
      '</div>' +
    '</div>'
  );
}
function renderAluno(){
  var app = $('#app');
  app.innerHTML =
    '<div class="aluno-shell">' +
      '<div class="aluno-topbar"><span class="mark">'+esc(STATE.orgName||'Trabalho Educativo')+'</span>' +
        '<button class="btn btn-ghost btn-sm" id="logout-btn" type="button">Sair</button></div>' +
      '<div class="aluno-wrap">'+viewAlunoPainel()+'</div>' +
    '</div>';
  if(!$('.toast-stack')){
    var stack = document.createElement('div');
    stack.className = 'toast-stack';
    stack.id = 'toast-stack';
    document.body.appendChild(stack);
  }
  bindEventsAluno();
}
function bindEventsAluno(){
  var logoutBtn = $('#logout-btn');
  if(logoutBtn) logoutBtn.addEventListener('click', function(){
    if(typeof window.__pontosLogout === 'function') window.__pontosLogout();
  });
  $all('[data-punch-self]').forEach(function(btn){
    btn.addEventListener('click', function(){
      if(typeof window.__pontosAddRegistro !== 'function'){
        toast('Não foi possível registrar agora. Verifique sua conexão.', 'err');
        return;
      }
      btn.disabled = true;
      var tipo = btn.getAttribute('data-punch-self');
      var s = STATE.students[0];
      var rec = {id: uid('r'), studentId: s.id, tipo: tipo, ts: nowISO(), origem:'self'};
      // Não mexemos em STATE.registros aqui: o listener em tempo real
      // (window.__pontosStudentApply) já traz o novo registro e re-renderiza
      // assim que o Firestore confirma — evita duplicar a entrada na tela.
      window.__pontosAddRegistro(rec).then(function(){
        toast((tipo==='entrada'?'Chegada':'Saída')+' registrada.');
      }).catch(function(){
        toast('Não foi possível registrar agora. Verifique sua conexão.', 'err');
        btn.disabled = false;
      });
    });
  });
  $all('[data-punch-turno-self]').forEach(function(btn){
    btn.addEventListener('click', function(){
      if(typeof window.__pontosAddRegistro !== 'function'){
        toast('Não foi possível registrar agora. Verifique sua conexão.', 'err');
        return;
      }
      btn.disabled = true;
      var s = STATE.students[0];
      var inicio = new Date();
      var fim = new Date(inicio.getTime() + 4*60*60*1000);
      var recEntrada = {id: uid('r'), studentId: s.id, tipo:'entrada', ts: inicio.toISOString(), origem:'self'};
      var recSaida = {id: uid('r'), studentId: s.id, tipo:'saida', ts: fim.toISOString(), origem:'self'};
      window.__pontosAddRegistro(recEntrada).then(function(){
        return window.__pontosAddRegistro(recSaida);
      }).then(function(){
        toast('Turno de 4h registrado.');
        btn.disabled = false;
      }).catch(function(){
        toast('Não foi possível registrar agora. Verifique sua conexão.', 'err');
        btn.disabled = false;
      });
    });
  });
  var formPedidoAluno = $('#form-pedido-aluno');
  if(formPedidoAluno) formPedidoAluno.addEventListener('submit', function(e){
    e.preventDefault();
    if(typeof window.__pontosAddPedido !== 'function'){
      toast('Não foi possível enviar agora. Verifique sua conexão.', 'err');
      return;
    }
    var fd = new FormData(formPedidoAluno);
    var s = STATE.students[0];
    var rec = {
      id: uid('p'), studentId: s.id, data: fd.get('data'), tipoAlvo: fd.get('tipoAlvo'),
      horario: fd.get('horario'), motivo: (fd.get('motivo')||'').trim(),
      status: 'pendente', criadoEm: nowISO()
    };
    // Assim como no ponto: não mexemos em STATE.pedidos aqui, o listener em
    // tempo real traz o pedido recém-criado e re-renderiza sozinho.
    window.__pontosAddPedido(rec).then(function(){
      formPedidoAluno.reset();
      toast('Pedido enviado para aprovação.');
    }).catch(function(){
      toast('Não foi possível enviar o pedido agora.', 'err');
    });
  });
}

/* ============================================================
   Boot — chamado pelo firebase-init.js
   ============================================================ */
window.__pontosBoot = function(initialState){
  MODE = 'admin';
  STATE = initialState;
  STATE.cadastrosPendentes = STATE.cadastrosPendentes || [];
  UI = freshUI();
  render();
};
window.__pontosApplyRemote = function(newState){
  if(MODE!=='admin' || !STATE) return; // ainda não fez boot, ou é sessão de aluno
  STATE = newState;
  STATE.cadastrosPendentes = STATE.cadastrosPendentes || [];
  render();
};

window.__pontosStudentBoot = function(perfil, registros, pedidos){
  MODE = 'aluno';
  STATE = {
    students: [perfil],
    registros: registros || [],
    pedidos: pedidos || [],
    setores: [], lideres: [], bolsaHoras: {}, activityLog: [],
    pontosPorHora: 0, orgName: 'Trabalho Educativo'
  };
  renderAluno();
};
window.__pontosStudentApply = function(perfil, registros, pedidos){
  if(MODE!=='aluno' || !STATE) return;
  STATE.students = [perfil];
  STATE.registros = registros || [];
  STATE.pedidos = pedidos || [];
  renderAluno();
};

/* Cadastro por RA feito, mas ainda aguardando a administração completar
   o perfil (setor, nível, etc.) — ver README do fluxo em firebase-init.js. */
window.__pontosStudentPending = function(nome){
  MODE = 'aluno-pendente';
  renderPendente(nome);
};
function renderPendente(nome){
  var app = $('#app');
  app.innerHTML =
    '<div class="aluno-shell">' +
      '<div class="aluno-topbar"><span class="mark">Trabalho Educativo</span>' +
        '<button class="btn btn-ghost btn-sm" id="logout-btn" type="button">Sair</button></div>' +
      '<div class="aluno-wrap">' +
        '<div class="aluno-card" style="display:flex;flex-direction:column;align-items:center;text-align:center;">' +
          '<span class="avatar" style="width:52px;height:52px;font-size:17px;">'+initials(nome||'?')+'</span>' +
          '<div class="name" style="margin-top:10px;">'+(nome?esc(nome):'Cadastro enviado')+'</div>' +
          '<div class="view-sub" style="margin-top:6px;">Seu login foi criado, mas seu RA ainda não estava na lista de bolsistas do sistema — seu cadastro está aguardando a administração completar as informações (setor, nível, etc.).</div>' +
          '<div class="view-sub" style="margin-top:10px;">Assim que for aprovado, é só entrar de novo por aqui que o painel de ponto aparece normalmente.</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  if(!$('.toast-stack')){
    var stack = document.createElement('div');
    stack.className = 'toast-stack';
    stack.id = 'toast-stack';
    document.body.appendChild(stack);
  }
  var logoutBtn = $('#logout-btn');
  if(logoutBtn) logoutBtn.addEventListener('click', function(){
    if(typeof window.__pontosLogout === 'function') window.__pontosLogout();
  });
}

})();
