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
    punchMode: 'lider',     // 'lider' | 'aluno'
    punchSetor: (STATE.setores[0] || {}).id || '',
    punchSelected: null,
    punchSearch: '',
    pedidosTab: 'pendentes',
    configTab: 'bolsas'
  };
}
var SYNC = 'idle'; // idle | busy | off

var DIAS_SEMANA = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
var MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
var MESES_ABREV = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];

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
function sameDay(iso, d){ return iso && iso.slice(0,10) === todayKey(d); }
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
function minutosTrabalhados(id, sinceISO){
  var list = registrosDoAluno(id);
  var total = 0, abertura = null;
  for(var i=0;i<list.length;i++){
    var r = list[i];
    if(sinceISO && r.ts < sinceISO) continue;
    if(r.tipo === 'entrada'){
      abertura = r.ts;
    } else if(r.tipo === 'saida' && abertura){
      total += (new Date(r.ts) - new Date(abertura)) / 60000;
      abertura = null;
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
function mondayDaSemanaISO(){
  var d = new Date();
  var day = d.getDay(); // 0 = domingo
  var diff = (day===0) ? 6 : day-1; // dias desde a última segunda-feira
  d.setDate(d.getDate()-diff);
  d.setHours(0,0,0,0);
  return d.toISOString();
}

/* ============================================================
   Toasts
   ============================================================ */
function toast(msg, kind){
  var stack = $('#toast-stack');
  if(!stack) return;
  var el = document.createElement('div');
  el.className = 'toast' + (kind ? ' '+kind : '');
  el.textContent = msg;
  stack.appendChild(el);
  setTimeout(function(){ el.remove(); }, 3600);
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
  var dot = $('#sync-dot'), label = $('#sync-label');
  if(!dot) return;
  dot.className = 'sync-dot' + (SYNC==='busy' ? ' busy' : SYNC==='off' ? ' off' : '');
  label.textContent = SYNC==='busy' ? 'Salvando…' : SYNC==='off' ? 'Falha ao salvar' : 'Sincronizado';
}

/* ============================================================
   Views
   ============================================================ */
var NAV = [
  {id:'dashboard', label:'Visão geral', ico:'▣'},
  {id:'alunos', label:'Alunos', ico:'☰'},
  {id:'ponto', label:'Registrar ponto', ico:'●'},
  {id:'pedidos', label:'Pedidos de ajuste', ico:'✉'},
  {id:'config', label:'Configurações', ico:'⚙'}
];

function render(){
  var app = $('#app');
  var today = new Date();
  var dateLabel = DIAS_SEMANA[today.getDay()] + ', ' + today.getDate() + ' de ' + MESES[today.getMonth()] + ' de ' + today.getFullYear();

  var pend = pedidosPendentes().length;

  var navHtml = NAV.map(function(n){
    var badge = (n.id==='pedidos' && pend>0) ? '<span class="count">'+pend+'</span>' : '';
    return '<button class="nav-btn' + (UI.view===n.id?' active':'') + '" data-nav="'+n.id+'">' +
      '<span class="ico">'+n.ico+'</span><span>'+n.label+'</span>'+badge+'</button>';
  }).join('');

  app.innerHTML =
    '<nav class="sidebar">' +
      '<div class="brand"><span class="mark">' + esc(STATE.orgName) + '</span><span class="sub">Pontos &amp; presença de bolsistas</span></div>' +
      '<div class="nav">' + navHtml + '</div>' +
      '<div class="sidebar-foot">' +
        '<div class="sync-pill"><span class="sync-dot" id="sync-dot"></span><span id="sync-label">Sincronizado</span></div>' +
        '<button class="btn btn-ghost btn-sm" id="logout-btn" type="button">Sair</button>' +
      '</div>' +
    '</nav>' +
    '<main class="main"><div class="view" id="view-root"></div></main>';

  var root = $('#view-root');
  if(UI.view === 'dashboard') root.innerHTML = viewDashboard(dateLabel);
  else if(UI.view === 'alunos') root.innerHTML = viewAlunos();
  else if(UI.view === 'ponto') root.innerHTML = viewPonto();
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
      '<td>'+studentCell(s)+'</td>' +
      '<td>'+esc(setorNome(s.setor))+'</td>' +
      '<td>'+pill(s.pendenteHerdada)+'</td>' +
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
      'Setor': setorNome(s.setor),
      'Nível': nivelLabel(s.nivel),
      'Bolsa': s.bolsa || '',
      'Carga horária (h/sem)': (s.horasSemana===null || s.horasSemana===undefined) ? '' : s.horasSemana,
      'Dias de trabalho': s.diasTrabalho || '',
      'Telefone': s.telefone || '',
      'Aniversário': s.aniversario ? fmtDateBR(s.aniversario) : '',
      'Curso': s.curso || '',
      'Pendência herdada (planilha)': s.pendenteHerdada || '',
      'Horas no sistema': fmtHoras(minutosTrabalhados(s.id)),
      'Pontos': pontosDoAluno(s.id),
      'Status hoje': statusHojeTexto(s.id),
      'Ativo': s.ativo ? 'Sim' : 'Não',
      'Observações': s.observacao || ''
    };
  });
  var wsAlunos = XLSX.utils.json_to_sheet(alunosData);
  wsAlunos['!cols'] = [{wch:28},{wch:12},{wch:16},{wch:14},{wch:10},{wch:14},{wch:16},{wch:14},{wch:12},{wch:22},{wch:20},{wch:16},{wch:8},{wch:24},{wch:8},{wch:30}];
  XLSX.utils.book_append_sheet(wb, wsAlunos, 'Alunos');

  var registrosData = STATE.registros.slice().sort(function(a,b){ return new Date(a.ts) - new Date(b.ts); }).map(function(r){
    var s = studentById(r.studentId);
    return {
      'Aluno': s ? s.nome : '(removido)',
      'Setor': s ? setorNome(s.setor) : '',
      'Tipo': r.tipo==='entrada' ? 'Chegada' : 'Saída',
      'Data': r.ts ? fmtDateBR(r.ts.slice(0,10)) : '',
      'Hora': fmtTime(r.ts),
      'Origem': r.origem || ''
    };
  });
  var wsRegistros = XLSX.utils.json_to_sheet(registrosData);
  wsRegistros['!cols'] = [{wch:28},{wch:16},{wch:10},{wch:12},{wch:8},{wch:16}];
  XLSX.utils.book_append_sheet(wb, wsRegistros, 'Registros de ponto');

  var pedidosData = STATE.pedidos.slice().sort(function(a,b){ return new Date(a.criadoEm) - new Date(b.criadoEm); }).map(function(p){
    var s = studentById(p.studentId);
    return {
      'Aluno': s ? s.nome : '(removido)',
      'Setor': s ? setorNome(s.setor) : '',
      'Data do ajuste': fmtDateBR(p.data),
      'Tipo': p.tipoAlvo==='entrada' ? 'Chegada' : 'Saída',
      'Horário': p.horario || '',
      'Motivo': p.motivo || '',
      'Status': p.status==='pendente' ? 'Pendente' : p.status==='aprovado' ? 'Aprovado' : 'Rejeitado',
      'Criado em': fmtDateTime(p.criadoEm),
      'Resolvido em': p.resolvidoEm ? fmtDateTime(p.resolvidoEm) : '',
      'Resolvido por': p.resolvidoPor || ''
    };
  });
  var wsPedidos = XLSX.utils.json_to_sheet(pedidosData);
  wsPedidos['!cols'] = [{wch:28},{wch:16},{wch:14},{wch:10},{wch:10},{wch:32},{wch:12},{wch:16},{wch:16},{wch:18}];
  XLSX.utils.book_append_sheet(wb, wsPedidos, 'Pedidos de ajuste');

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
      '<td>'+studentCell(s)+(incompleto?' <span class="tag" title="Dados incompletos na planilha original">incompleto</span>':'')+'</td>' +
      '<td>'+esc(setorNome(s.setor))+'</td>' +
      '<td><span class="pill pill-muted">'+nivelLabel(s.nivel)+'</span></td>' +
      '<td class="mono">'+horasSemanaLabel(s)+'</td>' +
      '<td>'+esc(s.diasTrabalho||'—')+'</td>' +
      '<td>'+statusHojePill(s.id)+'</td>' +
      '<td>'+pill(s.pendenteHerdada)+'</td>' +
    '</tr>';
  }).join('') || '<tr><td colspan="7"><div class="empty-state">Nenhum bolsista encontrado com esses filtros.</div></td></tr>';

  return (
    '<div class="view-head"><div><h1>Alunos</h1><div class="view-sub">'+STATE.students.length+' bolsistas cadastrados. Clique em um nome para ver o perfil completo.</div></div>' +
      '<div class="toolbar" style="gap:8px;">' +
        '<button class="btn btn-ghost" data-action="exportar-excel">⇩ Exportar Excel</button>' +
        '<button class="btn btn-primary" data-action="novo-aluno">+ Novo aluno</button>' +
      '</div></div>' +

    '<div class="toolbar">' +
      '<div class="search"><input type="text" id="busca-aluno" placeholder="Buscar por nome ou RA…" value="'+esc(UI.alunoBusca)+'"></div>' +
      '<select id="filtro-setor">'+setorOpts+'</select>' +
      '<select id="filtro-nivel">' +
        '<option value="todos"'+(UI.alunoFiltroNivel==='todos'?' selected':'')+'>Todos os níveis</option>' +
        '<option value="EM"'+(UI.alunoFiltroNivel==='EM'?' selected':'')+'>Ensino Médio</option>' +
        '<option value="FAC"'+(UI.alunoFiltroNivel==='FAC'?' selected':'')+'>Faculdade</option>' +
      '</select>' +
    '</div>' +

    '<div class="card"><div class="card-body tight"><div class="table-wrap"><table>' +
      '<thead><tr><th>Bolsista</th><th>Setor</th><th>Nível</th><th class="num">Carga</th><th>Dias de trabalho</th><th>Hoje</th><th>Pendência herdada</th></tr></thead>' +
      '<tbody>'+rows+'</tbody>' +
    '</table></div></div></div>'
  );
}

function punchButton(id){
  var s = studentById(id);
  if(!s) return '<div class="empty-state">Selecione um bolsista na lista ao lado.</div>';
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
  var minsHoje = minutosTrabalhados(id, todayKey()+'T00:00:00.000Z');
  return (
    '<div class="punch-status">' +
      '<span class="avatar" style="width:44px;height:44px;font-size:15px;">'+initials(s.nome)+'</span>' +
      '<span class="who">'+esc(s.nome)+'</span>' +
      '<span class="state">'+esc(setorNome(s.setor))+' · '+nivelLabel(s.nivel)+'</span>' +
      '<span class="state">'+statusText+'</span>' +
    '</div>' +
    warn +
    '<div class="punch-actions">' +
      '<button class="btn btn-lg btn-primary" data-punch="entrada" data-id="'+id+'" '+(next!=='entrada'?'disabled':'')+'>Marcar chegada agora</button>' +
      '<button class="btn btn-lg" data-punch="saida" data-id="'+id+'" '+(next!=='saida'?'disabled':'')+'>Marcar saída agora</button>' +
    '</div>' +
    '<div class="punch-time-row">Horas cumpridas hoje: <span class="mono">&nbsp;'+fmtHoras(minsHoje)+'</span></div>' +
    '<div class="view-sub">Esqueceu de bater o ponto num horário certo? Peça o ajuste na aba <b>Pedidos de ajuste</b> — os responsáveis do setor aprovam antes de valer.</div>'
  );
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

  var listHtml = pool.map(function(s){
    return '<div class="punch-item'+(UI.punchSelected===s.id?' selected':'')+'" data-select-punch="'+s.id+'">' +
      '<span class="avatar">'+initials(s.nome)+'</span>' +
      '<span class="name">'+esc(s.nome)+'</span>' +
      statusHojePill(s.id) +
    '</div>';
  }).join('') || '<div class="empty-state">Nenhum bolsista nesse filtro.</div>';

  return (
    '<div class="view-head"><div><h1>Registrar ponto</h1><div class="view-sub">Líderes de setor batem o ponto dos alunos do Ensino Médio; alunos da faculdade registram o próprio.</div></div></div>' +

    '<div class="segmented">' +
      '<button data-punchmode="lider" class="'+(UI.punchMode==='lider'?'active':'')+'">Líder de setor</button>' +
      '<button data-punchmode="aluno" class="'+(UI.punchMode==='aluno'?'active':'')+'">Aluno (faculdade)</button>' +
    '</div>' +

    '<div class="punch-wrap">' +
      '<div class="card">' +
        '<div class="card-head">' +
          (UI.punchMode==='lider' ? '<select id="punch-setor">'+setorOpts+'</select>' : '<h2>Buscar meu nome</h2>') +
        '</div>' +
        '<div class="card-body">' +
          '<div class="search" style="margin-bottom:10px;"><input type="text" id="punch-busca" placeholder="Buscar por nome…" value="'+esc(UI.punchSearch)+'"></div>' +
          '<div class="punch-list">'+listHtml+'</div>' +
        '</div>' +
      '</div>' +
      '<div class="card"><div class="card-body punch-detail">'+punchButton(UI.punchSelected)+'</div></div>' +
    '</div>'
  );
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
      '<div class="card-body"><form id="form-novo-bolsa" class="toolbar"><input type="text" name="codigo" placeholder="Novo código (ex.: ADP3)" style="max-width:200px;" required><input type="number" name="horas" placeholder="Horas/semana" style="max-width:140px;"><button class="btn btn-sm" type="submit">Adicionar código</button></form></div></div>'
      : '') +

    (UI.configTab==='lideres' ?
      '<div class="card"><div class="card-head"><h2>Líderes / chefes de setor</h2><span class="meta">aparecem como opção de responsável nos pedidos de ajuste</span></div>' +
      '<div class="card-body tight"><div class="table-wrap"><table><thead><tr><th>Nome</th><th>Setor</th><th></th></tr></thead><tbody>'+lideresRows+'</tbody></table></div></div>' +
      '<div class="card-body"><form id="form-novo-lider" class="toolbar"><input type="text" name="nome" placeholder="Nome do responsável" required><select name="setor">'+STATE.setores.map(function(s){return '<option value="'+s.id+'">'+esc(s.nome)+'</option>';}).join('')+'</select><button class="btn btn-sm" type="submit">Adicionar</button></form></div></div>'
      : '') +

    (UI.configTab==='pontos' ?
      '<div class="card"><div class="card-head"><h2>Conversão de pontos</h2></div><div class="card-body">' +
      '<label style="max-width:260px;">Pontos por hora trabalhada<input type="number" min="0" step="0.5" id="input-pontos-hora" value="'+STATE.pontosPorHora+'"></label>' +
      '<p class="view-sub" style="margin-top:10px;">Cada hora completa registrada (chegada + saída confirmadas) vale essa quantidade de pontos no perfil do aluno. Ajuste aqui se a regra de pontuação mudar.</p>' +
      '</div></div>'
      : '') +

    (UI.configTab==='exportar' ?
      '<div class="card"><div class="card-head"><h2>Exportar para Excel</h2><span class="meta">gera um arquivo .xlsx com 3 planilhas</span></div><div class="card-body">' +
      '<p class="view-sub">O arquivo baixado traz três planilhas com todos os dados atuais do sistema:</p>' +
      '<ul style="margin:10px 0 18px 18px;font-size:13px;color:var(--ink-soft);display:flex;flex-direction:column;gap:4px;">' +
        '<li><b>Alunos</b> — cadastro completo, setor, nível, bolsa, carga horária, horas cumpridas, pontos e status de hoje.</li>' +
        '<li><b>Registros de ponto</b> — todas as chegadas e saídas já registradas no sistema.</li>' +
        '<li><b>Pedidos de ajuste</b> — histórico de pedidos, com status e quem aprovou ou rejeitou.</li>' +
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
  var s = creating ? {id:'', nome:'', setor:STATE.setores[0].id, nivel:'EM', bolsa:'', ra:'', telefone:'', aniversario:'', curso:'', diasTrabalho:'', pendenteHerdada:'', observacao:'', ativo:true} : studentById(UI.drawerId);
  if(!s){ UI.drawerId = null; return; }

  var overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = '<div class="drawer">' + (UI.drawerEdit || creating ? drawerEditForm(s, creating) : drawerView(s)) + '</div>';
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
      kv('Dias de trabalho', s.diasTrabalho || '—', true) +
    '</div>' +

    '<div class="stat-grid">' +
      '<div class="stat-card"><span class="label">Horas no sistema</span><span class="value mono">'+fmtHoras(minutosTrabalhados(s.id))+'</span></div>' +
      '<div class="stat-card accent"><span class="label">Pontos</span><span class="value mono">'+pontosDoAluno(s.id)+'</span></div>' +
    '</div>' +

    '<div class="toolbar"><button class="btn btn-primary btn-sm" data-drawer-edit>Editar cadastro</button>' +
      '<button class="btn btn-sm '+(s.ativo?'btn-danger':'')+'" data-drawer-toggle-ativo>'+(s.ativo?'Desativar':'Reativar')+'</button></div>' +

    '<div><h3 style="font-size:13px;margin-bottom:8px;">Histórico de ponto</h3><div class="log-list">'+logs+'</div></div>'
  );
}
function kv(k,v,full){
  return '<div class="kv'+(full?' full':'')+'"><span class="k">'+esc(k)+'</span><span class="v">'+esc(v)+'</span></div>';
}
function drawerEditForm(s, creating){
  var setorOpts = STATE.setores.map(function(x){ return '<option value="'+x.id+'"'+(x.id===s.setor?' selected':'')+'>'+esc(x.nome)+'</option>'; }).join('');
  return (
    '<div class="drawer-head"><div class="name">'+(creating?'Novo aluno':'Editar '+esc(s.nome))+'</div>' +
      '<button class="close-btn" aria-label="Fechar">✕</button></div>' +
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
      '<div class="field-row">' +
        '<label>Curso<input type="text" name="curso" value="'+esc(s.curso)+'"></label>' +
        '<label>Dias de trabalho<input type="text" name="diasTrabalho" value="'+esc(s.diasTrabalho)+'" placeholder="ex.: Seg. a sex."></label>' +
      '</div>' +
      '<label>Observações<textarea name="observacao">'+esc(s.observacao)+'</textarea></label>' +
      '<div class="toolbar"><button class="btn btn-primary" type="submit">'+(creating?'Cadastrar aluno':'Salvar alterações')+'</button>' +
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
    diasTrabalho: (fd.get('diasTrabalho')||'').trim(),
    observacao: (fd.get('observacao')||'').trim()
  };
  if(!patch.nome){ toast('Informe o nome do aluno.', 'err'); return; }
  if(creating){
    var novo = Object.assign({id: uid('s'), pendenteHerdada:'', ativo:true, horasSemana: STATE.bolsaHoras[patch.bolsa]===undefined?null:STATE.bolsaHoras[patch.bolsa]}, patch);
    STATE.students.push(novo);
    logAtividade('Cadastrou o aluno '+novo.nome+'.');
    UI.drawerCreate = false;
    UI.drawerId = novo.id;
    UI.drawerEdit = false;
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
  var logoutBtn = $('#logout-btn');
  if(logoutBtn) logoutBtn.addEventListener('click', function(){
    if(typeof window.__pontosLogout === 'function') window.__pontosLogout();
  });

  // Alunos view
  var busca = $('#busca-aluno');
  if(busca) busca.addEventListener('input', function(){ UI.alunoBusca = busca.value; render(); preserveFocus('#busca-aluno'); });
  var fSetor = $('#filtro-setor');
  if(fSetor) fSetor.addEventListener('change', function(){ UI.alunoFiltroSetor = fSetor.value; render(); });
  var fNivel = $('#filtro-nivel');
  if(fNivel) fNivel.addEventListener('change', function(){ UI.alunoFiltroNivel = fNivel.value; render(); });
  var novoAlunoBtn = $('[data-action="novo-aluno"]');
  if(novoAlunoBtn) novoAlunoBtn.addEventListener('click', function(){ UI.drawerCreate = true; UI.drawerId = null; UI.drawerEdit = false; renderDrawer(); });
  $all('[data-action="exportar-excel"]').forEach(function(btn){
    btn.addEventListener('click', function(){ exportarExcel(); });
  });
  $all('[data-open]').forEach(function(tr){
    tr.addEventListener('click', function(){ UI.drawerId = tr.getAttribute('data-open'); UI.drawerCreate=false; UI.drawerEdit = false; renderDrawer(); });
  });

  // Ponto view
  $all('[data-punchmode]').forEach(function(btn){
    btn.addEventListener('click', function(){ UI.punchMode = btn.getAttribute('data-punchmode'); UI.punchSelected = null; UI.punchSearch=''; render(); });
  });
  var punchSetorSel = $('#punch-setor');
  if(punchSetorSel) punchSetorSel.addEventListener('change', function(){ UI.punchSetor = punchSetorSel.value; UI.punchSelected = null; render(); });
  var punchBusca = $('#punch-busca');
  if(punchBusca) punchBusca.addEventListener('input', function(){ UI.punchSearch = punchBusca.value; render(); preserveFocus('#punch-busca'); });
  $all('[data-select-punch]').forEach(function(item){
    item.addEventListener('click', function(){ UI.punchSelected = item.getAttribute('data-select-punch'); render(); });
  });
  $all('[data-punch]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var id = btn.getAttribute('data-id');
      var tipo = btn.getAttribute('data-punch');
      var s = studentById(id);
      addRegistro({id: uid('r'), studentId:id, tipo:tipo, ts: nowISO(), origem: UI.punchMode==='lider' ? 'lider' : 'self'});
      logAtividade((tipo==='entrada'?'Chegada':'Saída')+' registrada para '+s.nome+' às '+fmtTime(nowISO())+'.');
      toast((tipo==='entrada'?'Chegada':'Saída')+' registrada para '+s.nome+'.');
      persist();
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
    STATE.pedidos.push({
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
  var s = studentById(p.studentId);
  if(status==='aprovado'){
    var ts = p.data + 'T' + p.horario + ':00';
    var d = new Date(ts);
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
  var last = ultimoRegistro(s.id);
  var next = proximoTipo(s.id);
  var statusText;
  if(!last){
    statusText = 'Você ainda não bateu o ponto hoje.';
  } else if(last.tipo==='entrada'){
    statusText = sameDay(last.ts) ? ('Em andamento desde ' + fmtTime(last.ts) + '.') : ('Em andamento desde ' + fmtDateTime(last.ts) + '.');
  } else {
    statusText = sameDay(last.ts) ? ('Você saiu às ' + fmtTime(last.ts) + '. Pode registrar nova chegada se voltar hoje.') : 'Você ainda não bateu o ponto hoje.';
  }

  var minsSemana = minutosTrabalhados(s.id, mondayDaSemanaISO());
  var metaSemana = (s.horasSemana||0) * 60;
  var saldo = minsSemana - metaSemana;
  var saldoTxt, saldoCls;
  if(!s.horasSemana){
    saldoTxt = 'Carga horária semanal não definida.'; saldoCls = 'pill-muted';
  } else if(saldo >= 0){
    saldoTxt = fmtHoras(saldo) + ' a mais esta semana'; saldoCls = 'pill-ok';
  } else {
    saldoTxt = fmtHoras(-saldo) + ' devendo esta semana'; saldoCls = 'pill-crit';
  }

  var historico = registrosDoAluno(s.id).slice().reverse().slice(0,10).map(function(r){
    return '<div class="log-item"><span class="t">'+fmtDateTime(r.ts)+'</span><span>'+(r.tipo==='entrada'?'Chegada':'Saída')+'</span></div>';
  }).join('') || '<div class="empty-state">Nenhum registro ainda.</div>';

  return (
    '<div class="aluno-card">' +
      '<div class="aluno-head">' +
        '<span class="avatar" style="width:52px;height:52px;font-size:17px;">'+initials(s.nome)+'</span>' +
        '<div><div class="name">'+esc(s.nome)+'</div><div class="setor">'+esc(s.setorNome||'')+'</div></div>' +
      '</div>' +
      '<div class="view-sub">'+statusText+'</div>' +
      '<div class="punch-actions">' +
        '<button class="btn btn-lg btn-primary" data-punch-self="entrada" '+(next!=='entrada'?'disabled':'')+'>Marcar chegada agora</button>' +
        '<button class="btn btn-lg" data-punch-self="saida" '+(next!=='saida'?'disabled':'')+'>Marcar saída agora</button>' +
      '</div>' +
      '<div class="stat-card" style="margin-top:18px;">' +
        '<span class="label">Saldo desta semana</span>' +
        '<span class="pill '+saldoCls+'" style="font-size:14px;margin-top:6px;">'+saldoTxt+'</span>' +
        '<span class="hint">meta: '+(s.horasSemana?s.horasSemana+'h/semana':'—')+'</span>' +
      '</div>' +
      '<div style="margin-top:18px;"><h3 style="font-size:13px;margin-bottom:8px;">Últimos registros</h3><div class="log-list">'+historico+'</div></div>' +
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
      window.__pontosAddRegistro(rec).then(function(){
        STATE.registros.push(rec);
        toast((tipo==='entrada'?'Chegada':'Saída')+' registrada.');
        renderAluno();
      }).catch(function(){
        toast('Não foi possível registrar agora. Verifique sua conexão.', 'err');
        btn.disabled = false;
      });
    });
  });
}

/* ============================================================
   Boot — chamado pelo firebase-init.js
   ============================================================ */
window.__pontosBoot = function(initialState){
  MODE = 'admin';
  STATE = initialState;
  UI = freshUI();
  render();
};
window.__pontosApplyRemote = function(newState){
  if(MODE!=='admin' || !STATE) return; // ainda não fez boot, ou é sessão de aluno
  STATE = newState;
  render();
};

window.__pontosStudentBoot = function(perfil, registros){
  MODE = 'aluno';
  STATE = {
    students: [perfil],
    registros: registros || [],
    setores: [], lideres: [], bolsaHoras: {}, pedidos: [], activityLog: [],
    pontosPorHora: 0, orgName: 'Trabalho Educativo'
  };
  renderAluno();
};
window.__pontosStudentApply = function(perfil, registros){
  if(MODE!=='aluno' || !STATE) return;
  STATE.students = [perfil];
  STATE.registros = registros || [];
  renderAluno();
};

})();
