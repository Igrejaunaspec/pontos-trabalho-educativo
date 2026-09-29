/* ============================================================
   Firebase — autenticação (Email/Password) + Firestore
   Admin: usa o documento único app/state (como antes) mais as
   coleções "registros" e "pedidos".
   Alunos (login individual): usam students/{id}, e as coleções
   "registros" e "pedidos" filtradas só pelos próprios dados
   (ver regras de segurança do Firestore).
   ============================================================ */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence,
  createUserWithEmailAndPassword, deleteUser, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs, onSnapshot, collection, query, where, writeBatch
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

var firebaseConfig = {
  apiKey: "AIzaSyD3yjy88UlmY7-swELnYE8TkVyhslR-P5k",
  authDomain: "trabalho-educativo-f4f0d.firebaseapp.com",
  projectId: "trabalho-educativo-f4f0d",
  storageBucket: "trabalho-educativo-f4f0d.firebasestorage.app",
  messagingSenderId: "317630867115",
  appId: "1:317630867115:web:e61720cbacf3e1927db9ee"
};

var ADMIN_EMAILS = ["administracao@trabalhoeducativo.app", "aquila.almeida@adventistas.org"];
function isAdminEmail(email){
  return ADMIN_EMAILS.indexOf((email||'').toLowerCase()) !== -1;
}

var app = initializeApp(firebaseConfig);
var auth = getAuth(app);
var db = getFirestore(app);
var STATE_DOC = doc(db, "app", "state");

var booted = false;
var lastSentJSON = null;
// true durante o fluxo de cadastro (entre createUserWithEmailAndPassword e o
// commit do vínculo em alunoAuth/alunoClaimed) — evita que onAuthStateChanged
// trate o novo usuário como "sem vínculo" antes da hora, numa corrida.
var suppressAuthHandling = false;
// mensagem a exibir na tela de login assim que o onAuthStateChanged perceber
// o logout (usado quando o próprio código força um signOut(auth) por algum
// problema — evita que a chamada showLogin() sem argumento, disparada pelo
// listener de auth logo em seguida, apague a mensagem antes que dê tempo de
// aparecer).
var pendingLoginMessage = null;
// vigia global: se "booted" não virar true em ~15s depois do login (perfil
// não encontrado, permissão negada sem erro claro, conexão instável no
// celular, etc.), evita que a tela fique presa em "Carregando dados…" para
// sempre — desloga com uma mensagem explicativa em vez de travar em silêncio.
var loadTimeoutId = null;
function clearLoadTimeout(){
  if(loadTimeoutId){ clearTimeout(loadTimeoutId); loadTimeoutId = null; }
}
function scheduleLoadTimeout(){
  clearLoadTimeout();
  loadTimeoutId = setTimeout(function(){
    loadTimeoutId = null;
    if(booted) return;
    pendingLoginMessage = 'Não foi possível carregar seus dados agora. Verifique sua conexão e tente entrar novamente.';
    signOut(auth);
  }, 15000);
}

// listeners ativos (para poder cancelar ao trocar de papel / deslogar)
var unsubAdminState = null;
var unsubAdminRegistros = null;
var unsubAdminPedidos = null;
var unsubAdminCadastros = null;
var unsubAlunoPerfil = null;
var unsubAlunoRegistros = null;
var unsubAlunoPedidos = null;

var loginScreen = document.getElementById('login-screen');
var appRoot = document.getElementById('app');
var loginForm = document.getElementById('login-form');
var loginError = document.getElementById('login-error');
var signupForm = document.getElementById('signup-form');
var signupError = document.getElementById('signup-error');
var showSignupLink = document.getElementById('show-signup');
var showLoginLink = document.getElementById('show-login');
var forgotForm = document.getElementById('forgot-form');
var forgotError = document.getElementById('forgot-error');
var forgotSuccess = document.getElementById('forgot-success');
var showForgotLink = document.getElementById('show-forgot');
var showLoginFromForgotLink = document.getElementById('show-login-from-forgot');
var conviteForm = document.getElementById('convite-form');
var conviteError = document.getElementById('convite-error');
var showLoginFromConviteLink = document.getElementById('show-login-from-convite');

/* Login por RA (aluno) — não existe e-mail de verdade por trás, então a
   gente inventa um "e-mail fantasma" fixo a partir do RA só pra servir de
   identificador único no Firebase Auth. O aluno nunca vê nem digita isso.
   Sempre o mesmo RA -> sempre o mesmo e-mail fantasma (determinístico). */
function raGhostEmail(ra){
  var limpo = (ra || '').toString().trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return 'ra-' + limpo + '@aluno.trabalhoeducativo.app';
}
function pareceEmail(v){ return (v || '').indexOf('@') !== -1; }

// Link de convite: ?ra=123&nome=Fulano — abre direto a tela de criar senha
// pra esse RA (a administração já cadastrou o aluno com esse RA antes de
// gerar o link, então o vínculo é automático, sem precisar de aprovação).
var urlParams = new URLSearchParams(window.location.search);
var conviteRA = (urlParams.get('ra') || '').trim();
var conviteNome = (urlParams.get('nome') || '').trim();
var conviteDismissed = false;

function showLogin(msg){
  loginScreen.hidden = false;
  appRoot.hidden = true;
  loginForm.hidden = false;
  signupForm.hidden = true;
  if(forgotForm) forgotForm.hidden = true;
  if(conviteForm) conviteForm.hidden = true;
  if(msg){ loginError.textContent = msg; loginError.hidden = false; }
  else { loginError.hidden = true; }
}
function showSignupScreen(msg){
  loginScreen.hidden = false;
  appRoot.hidden = true;
  loginForm.hidden = true;
  signupForm.hidden = false;
  if(forgotForm) forgotForm.hidden = true;
  if(conviteForm) conviteForm.hidden = true;
  if(msg){ signupError.textContent = msg; signupError.hidden = false; }
  else { signupError.hidden = true; }
}
function showForgotScreen(){
  loginScreen.hidden = false;
  appRoot.hidden = true;
  loginForm.hidden = true;
  signupForm.hidden = true;
  if(conviteForm) conviteForm.hidden = true;
  forgotForm.hidden = false;
  forgotError.hidden = true;
  forgotSuccess.hidden = true;
  forgotForm.reset();
}
function showConviteScreen(msg){
  loginScreen.hidden = false;
  appRoot.hidden = true;
  loginForm.hidden = true;
  signupForm.hidden = true;
  if(forgotForm) forgotForm.hidden = true;
  conviteForm.hidden = false;
  var raInput = conviteForm.querySelector('[name="ra"]');
  var nomeInput = conviteForm.querySelector('[name="nome"]');
  if(raInput && !raInput.value) raInput.value = conviteRA;
  if(nomeInput && !nomeInput.value) nomeInput.value = conviteNome;
  if(msg){ conviteError.textContent = msg; conviteError.hidden = false; }
  else { conviteError.hidden = true; }
}
function showApp(){
  loginScreen.hidden = true;
  appRoot.hidden = false;
}

setPersistence(auth, browserLocalPersistence).catch(function(){ /* ok manter padrão */ });

loginForm.addEventListener('submit', function(e){
  e.preventDefault();
  var fd = new FormData(loginForm);
  var digitado = (fd.get('email') || '').trim();
  var email = pareceEmail(digitado) ? digitado : raGhostEmail(digitado);
  var password = fd.get('password') || '';
  var btn = loginForm.querySelector('button[type="submit"]');
  btn.disabled = true;
  loginError.hidden = true;
  signInWithEmailAndPassword(auth, email, password).catch(function(err){
    showLogin('RA/e-mail ou senha incorretos.');
  }).finally(function(){
    btn.disabled = false;
  });
});

if(showLoginFromConviteLink) showLoginFromConviteLink.addEventListener('click', function(e){
  e.preventDefault();
  conviteDismissed = true;
  showLogin();
});

if(showSignupLink) showSignupLink.addEventListener('click', function(e){
  e.preventDefault();
  showSignupScreen();
});
if(showLoginLink) showLoginLink.addEventListener('click', function(e){
  e.preventDefault();
  showLogin();
});
if(showForgotLink) showForgotLink.addEventListener('click', function(e){
  e.preventDefault();
  showForgotScreen();
});
if(showLoginFromForgotLink) showLoginFromForgotLink.addEventListener('click', function(e){
  e.preventDefault();
  showLogin();
});
if(forgotForm) forgotForm.addEventListener('submit', function(e){
  e.preventDefault();
  var fd = new FormData(forgotForm);
  var email = (fd.get('email') || '').trim();
  var btn = forgotForm.querySelector('button[type="submit"]');
  btn.disabled = true;
  forgotError.hidden = true;
  forgotSuccess.hidden = true;
  sendPasswordResetEmail(auth, email).then(function(){
    forgotSuccess.textContent = 'Enviamos um e-mail para ' + email + ' com um link para redefinir a senha. Confira também a caixa de spam.';
    forgotSuccess.hidden = false;
  }).catch(function(err){
    // Por segurança, não confirmamos se o e-mail existe ou não no sistema —
    // mesma mensagem de sucesso mesmo se o e-mail não estiver cadastrado
    // (evita que alguém use esta tela para descobrir e-mails cadastrados).
    // Só avisamos de verdade quando o e-mail é claramente inválido.
    if(err && err.code === 'auth/invalid-email'){
      forgotError.textContent = 'Digite um e-mail válido.';
      forgotError.hidden = false;
    } else {
      forgotSuccess.textContent = 'Se esse e-mail estiver cadastrado, enviamos um link para redefinir a senha. Confira também a caixa de spam.';
      forgotSuccess.hidden = false;
    }
  }).finally(function(){
    btn.disabled = false;
  });
});

/* ============================================================
   Cadastro do próprio aluno (faculdade) — usa o RA para achar o
   cadastro certo em "alunoRA/{ra}" e reivindica esse aluno de
   forma exclusiva via "alunoClaimed/{studentId}" (regra garante
   que só o primeiro a reivindicar consegue vincular o login).

   Se o RA não é encontrado (aluno novo, ainda não está na lista
   de bolsistas), o cadastro NÃO é recusado: cria o login mesmo
   assim e registra um pedido em "cadastrosPendentes/{uid}" para a
   administração completar (setor, nível, etc.) ou excluir depois,
   na aba Alunos. Até lá, "alunoAuth/{uid}" fica com status
   "pendente" (sem studentId) e o painel mostra uma tela de espera
   (ver window.__pontosStudentPending em app.js).
   ============================================================ */
/* Núcleo compartilhado por "Cadastre-se com seu RA" (signup-form, aluno
   digita o próprio e-mail) e pelo link de convite (convite-form, e-mail
   fantasma gerado do RA) — cria a conta no Auth, confere o RA em
   "alunoRA/{ra}" e vincula automaticamente se achar (ou deixa pendente
   pra administração completar, se o RA ainda não foi cadastrado). */
function criarLoginEVincular(opts){
  // opts: {nome, ra, email, password, password2, mostrarErro, aoTerminar}
  var nome = opts.nome, ra = opts.ra, email = opts.email;
  var password = opts.password, password2 = opts.password2;
  var mostrarErro = opts.mostrarErro;

  if(!nome){ mostrarErro('Informe seu nome completo.'); return; }
  if(!ra){ mostrarErro('Informe seu RA.'); return; }
  if(password.length < 6){ mostrarErro('A senha precisa ter pelo menos 6 caracteres.'); return; }
  if(password !== password2){ mostrarErro('As senhas não coincidem.'); return; }

  suppressAuthHandling = true; // segura o onAuthStateChanged até o vínculo terminar
  var createdUser = null;

  // Precisa criar a conta primeiro: a regra de "alunoRA" exige usuário
  // autenticado para leitura, então o RA só pode ser conferido depois.
  createUserWithEmailAndPassword(auth, email, password).then(function(cred){
    createdUser = cred.user;
    return getDoc(doc(db, 'alunoRA', ra));
  }).then(function(raSnap){
    if(!raSnap.exists()){
      // RA não encontrado: cria um cadastro pendente em vez de recusar.
      var pend = {id: createdUser.uid, nome: nome, ra: ra, email: email, criadoEm: new Date().toISOString(), status: 'pendente'};
      return setDoc(doc(db, 'cadastrosPendentes', createdUser.uid), pend)
        .then(function(){
          return setDoc(doc(db, 'alunoAuth', createdUser.uid), {status: 'pendente', nome: nome});
        });
    }
    var studentId = raSnap.data().studentId;
    // Duas escritas sequenciais (não um batch): a regra de "alunoAuth"
    // confere a reivindicação em "alunoClaimed" via get(), e isso só
    // enxerga escritas já confirmadas — não outras do mesmo batch.
    return setDoc(doc(db, 'alunoClaimed', studentId), {uid: createdUser.uid, claimadoEm: new Date().toISOString()})
      .then(function(){
        return setDoc(doc(db, 'alunoAuth', createdUser.uid), {studentId: studentId});
      });
  }).then(function(){
    suppressAuthHandling = false;
    if(auth.currentUser){ handleUserSignedIn(auth.currentUser); }
    if(opts.aoTerminar) opts.aoTerminar(true);
  }).catch(function(err){
    var msg = 'Não foi possível criar seu login agora. Tente novamente.';
    if(err && err.code === 'auth/email-already-in-use'){
      msg = opts.emailFantasma ? 'Esse RA já tem uma senha criada. Tente entrar, ou peça um novo link pra administração.' : 'Este e-mail já está em uso. Tente entrar, ou use outro e-mail.';
    } else if(err && err.code === 'auth/weak-password'){
      msg = 'Senha muito fraca. Use pelo menos 6 caracteres.';
    } else if(err && err.code === 'auth/invalid-email'){
      msg = 'E-mail inválido.';
    } else if(err && err.code === 'auth/network-request-failed'){
      msg = 'Falha de conexão com a internet. Verifique o sinal/wifi e tente novamente.';
    } else if(err && err.code === 'auth/too-many-requests'){
      msg = 'Muitas tentativas seguidas. Aguarde alguns minutos e tente novamente.';
    } else if(err && (err.code === 'permission-denied' || (err.message||'').indexOf('permission') !== -1)){
      msg = 'Este RA já tem um login cadastrado. Fale com a administração se isso não deveria acontecer.';
    }
    // se a conta de auth chegou a ser criada mas o vínculo falhou, desfaz para não deixar login órfão
    var cleanup = createdUser ? deleteUser(createdUser).catch(function(){ /* melhor esforço */ }) : Promise.resolve();
    return cleanup.then(function(){
      suppressAuthHandling = false;
      mostrarErro(msg);
      if(opts.aoTerminar) opts.aoTerminar(false);
    });
  });
}

signupForm.addEventListener('submit', function(e){
  e.preventDefault();
  var fd = new FormData(signupForm);
  var btn = signupForm.querySelector('button[type="submit"]');
  // Evita duplo envio (duplo toque no celular, tecla Enter repetida etc.):
  // sem isso, dois envios quase simultâneos podem criar a conta com sucesso
  // no primeiro envio e mostrar um erro confuso no segundo.
  if(btn.disabled) return;
  btn.disabled = true;
  signupError.hidden = true;
  criarLoginEVincular({
    nome: (fd.get('nome') || '').trim(),
    ra: (fd.get('ra') || '').trim(),
    email: (fd.get('email') || '').trim(),
    password: fd.get('password') || '',
    password2: fd.get('password2') || '',
    mostrarErro: showSignupScreen,
    aoTerminar: function(ok){
      btn.disabled = false;
      if(ok) signupForm.reset();
    }
  });
});

/* Link de convite (?ra=&nome=): mesma lógica acima, só que o e-mail é
   fantasma (gerado do RA) — o aluno só digita nome (já vem preenchido),
   RA (travado, vem do link) e a senha que ele escolher. */
if(conviteForm) conviteForm.addEventListener('submit', function(e){
  e.preventDefault();
  var fd = new FormData(conviteForm);
  var btn = conviteForm.querySelector('button[type="submit"]');
  if(btn.disabled) return;
  var ra = (fd.get('ra') || '').trim();
  if(!ra){ showConviteScreen('Link inválido — falta o RA. Peça pra administração gerar o link de novo.'); return; }
  btn.disabled = true;
  conviteError.hidden = true;
  criarLoginEVincular({
    nome: (fd.get('nome') || '').trim(),
    ra: ra,
    email: raGhostEmail(ra),
    password: fd.get('password') || '',
    password2: fd.get('password2') || '',
    emailFantasma: true,
    mostrarErro: showConviteScreen,
    aoTerminar: function(ok){
      btn.disabled = false;
      if(ok) conviteForm.reset();
    }
  });
});

window.__pontosLogout = function(){
  stopAllListeners();
  booted = false;
  lastSentJSON = null;
  signOut(auth);
};

function stopAllListeners(){
  if(unsubAdminState){ unsubAdminState(); unsubAdminState = null; }
  if(unsubAdminRegistros){ unsubAdminRegistros(); unsubAdminRegistros = null; }
  if(unsubAdminPedidos){ unsubAdminPedidos(); unsubAdminPedidos = null; }
  if(unsubAdminCadastros){ unsubAdminCadastros(); unsubAdminCadastros = null; }
  if(unsubAlunoPerfil){ unsubAlunoPerfil(); unsubAlunoPerfil = null; }
  if(unsubAlunoRegistros){ unsubAlunoRegistros(); unsubAlunoRegistros = null; }
  if(unsubAlunoPedidos){ unsubAlunoPedidos(); unsubAlunoPedidos = null; }
  clearLoadTimeout();
}

/* ============================================================
   Admin — app/state (perfis, setores, líderes, bolsas, log de
   atividade) + coleções "registros" e "pedidos"
   ============================================================ */
window.__pontosSaveState = function(state){
  var clean = JSON.parse(JSON.stringify(state));
  delete clean.registros; // vive só na coleção "registros" agora
  delete clean.pedidos;   // vive só na coleção "pedidos" agora
  lastSentJSON = JSON.stringify(clean);

  var batch = writeBatch(db);
  batch.set(STATE_DOC, clean);
  (clean.students || []).forEach(function(s){
    var setorNome = '';
    (clean.setores || []).some(function(x){ if(x.id === s.setor){ setorNome = x.nome; return true; } return false; });
    batch.set(doc(db, 'students', s.id), Object.assign({}, s, {setorNome: setorNome}));
  });
  return batch.commit();
};

window.__pontosAddRegistro = function(rec){
  return setDoc(doc(db, 'registros', rec.id), rec);
};
window.__pontosDeleteRegistro = function(id){
  return deleteDoc(doc(db, 'registros', id));
};
window.__pontosUpdateRegistro = function(id, patch){
  return updateDoc(doc(db, 'registros', id), patch);
};
window.__pontosAddPedido = function(rec){
  return setDoc(doc(db, 'pedidos', rec.id), rec);
};
window.__pontosUpdatePedido = function(id, patch){
  return updateDoc(doc(db, 'pedidos', id), patch);
};

function startListeningAdmin(){
  if(unsubAdminState) return;
  var lastDocData = null;
  var lastRegistros = [];
  var lastPedidos = [];
  var lastCadastros = [];
  var alunoRASynced = false;

  function emit(){
    if(lastDocData===null) return;
    var merged = Object.assign({}, lastDocData, {registros: lastRegistros, pedidos: lastPedidos, cadastrosPendentes: lastCadastros});
    if(!booted){
      booted = true;
      clearLoadTimeout();
      window.__pontosBoot(merged);
    } else {
      window.__pontosApplyRemote(merged);
    }
    if(!alunoRASynced){
      alunoRASynced = true;
      syncAlunoRA(merged.students || []);
    }
  }

  unsubAdminState = onSnapshot(STATE_DOC, function(snap){
    if(!snap.exists()){
      seedInitialState();
      return;
    }
    var data = snap.data();
    var json = JSON.stringify(data);
    lastDocData = data;
    if(json === lastSentJSON) return; // eco do nosso próprio salvamento
    emit();
  }, function(err){ console.error('[pontos] snapshot error', err); });

  unsubAdminRegistros = onSnapshot(collection(db, 'registros'), function(snap){
    lastRegistros = snap.docs.map(function(d){ return d.data(); });
    emit();
  }, function(err){ console.error('[pontos] registros snapshot error', err); });

  unsubAdminPedidos = onSnapshot(collection(db, 'pedidos'), function(snap){
    lastPedidos = snap.docs.map(function(d){ return d.data(); });
    emit();
  }, function(err){ console.error('[pontos] pedidos snapshot error', err); });

  unsubAdminCadastros = onSnapshot(collection(db, 'cadastrosPendentes'), function(snap){
    lastCadastros = snap.docs.map(function(d){ return d.data(); });
    emit();
  }, function(err){ console.error('[pontos] cadastrosPendentes snapshot error', err); });
}

/* Aprovar um cadastro pendente: a administração já criou o perfil
   completo do aluno (novoStudentId) em app/state — aqui só falta
   vincular o login já existente a esse perfil e remover o pendente. */
window.__pontosAprovarCadastro = function(uidCadastro, novoStudentId){
  return setDoc(doc(db, 'alunoAuth', uidCadastro), {studentId: novoStudentId})
    .then(function(){
      return deleteDoc(doc(db, 'cadastrosPendentes', uidCadastro));
    });
};
/* Excluir um cadastro pendente (RA inválido, duplicado, etc.): remove
   o pedido e desvincula o login — na próxima tentativa de entrar, a
   pessoa recebe a mensagem de "login não vinculado a nenhum aluno".
   A conta de login em si não é apagada (isso exigiria acesso de
   administrador do Firebase Authentication, fora do alcance do app). */
window.__pontosRejeitarCadastro = function(uidCadastro){
  return deleteDoc(doc(db, 'alunoAuth', uidCadastro))
    .then(function(){
      return deleteDoc(doc(db, 'cadastrosPendentes', uidCadastro));
    });
};

/* ============================================================
   Corrigir cadastros duplicados (ferramenta de manutenção, botão
   "Corrigir cadastros duplicados" na aba Alunos — ver app.js).

   window.__pontosDetectarDuplicados() lê a coleção "students" do
   Firestore DIRETO (não app/state.students, que é só a lista que a
   tela de Alunos mostra) — os cadastros "fantasma" (studentId
   gerado, ex. "s_xxxxx") em geral nunca foram salvos dentro de
   app/state.students, só existem soltos na coleção, então só
   aparecem lendo a coleção inteira. Agrupa primeiro por RA (quando os
   dois lados têm RA preenchido e igual) e, pro que sobrar, também por
   nome completo igual — cobre o caso de um cadastro oficial
   importado incompleto (sem RA) que ganhou depois um fantasma com o
   RA certo, criado quando a pessoa se autocadastrou. Em cada grupo,
   separa o cadastro "oficial" (id no formato "sNN-nome") dos
   "fantasmas" (id "s_xxxxx"); devolve {pares, manual} — pares é a
   lista de {stubId, officialId, nome, ra, raFantasma, bolsaFantasma}
   prontos pra corrigir, e manual é os grupos repetidos sem um oficial
   claro (ex.: duas contas fantasma da mesma pessoa), que ficam de
   fora da correção automática.

   window.__pontosCorrigirDuplicados(pares) migra, para cada par:
   todo registro de ponto do fantasma passa a apontar pro oficial; o
   login (alunoAuth) que estava ligado ao fantasma passa a apontar
   pro oficial; alunoClaimed do oficial é marcado com esse login; o
   alunoClaimed do fantasma é removido; o RA/bolsa do fantasma são
   copiados pro oficial SE o oficial estiver com esses campos vazios
   (caso do cadastro incompleto); e o próprio documento
   students/{fantasma} é marcado ativo:false com uma observação —
   direto na coleção, já que ele normalmente não está dentro de
   app/state.students pra ser desativado pelo caminho normal
   (persist()/__pontosSaveState).
   Devolve {paresCorrigidos, registrosMigrados, loginsVinculados}.
   ============================================================ */
window.__pontosDetectarDuplicados = function(){
  return getDocs(collection(db, 'students')).then(function(snap){
    var todos = [];
    snap.forEach(function(d){
      var s = Object.assign({}, d.data(), {id: d.id});
      if(s.ativo===false) return;
      todos.push(s);
    });

    var usados = {};
    var pares = [], manual = [];

    // 1ª passada: agrupa por RA (comportamento original).
    var porRA = {};
    todos.forEach(function(s){
      var ra = String(s.ra||'').trim();
      if(!ra) return;
      (porRA[ra] = porRA[ra] || []).push(s);
    });
    Object.keys(porRA).forEach(function(ra){
      var grupo = porRA[ra];
      if(grupo.length < 2) return;
      var oficiais = grupo.filter(function(s){ return !/^s_/.test(s.id); });
      var fantasmas = grupo.filter(function(s){ return /^s_/.test(s.id); });
      if(oficiais.length===1 && fantasmas.length>=1){
        fantasmas.forEach(function(f){
          pares.push({stubId: f.id, officialId: oficiais[0].id, nome: oficiais[0].nome, ra: ra, raFantasma: f.ra||'', bolsaFantasma: f.bolsa||''});
          usados[f.id] = true; usados[oficiais[0].id] = true;
        });
      } else {
        manual.push({ra: ra, nomes: grupo.map(function(s){return s.nome;})});
        grupo.forEach(function(s){ usados[s.id] = true; });
      }
    });

    // 2ª passada: pro que sobrou (não pareado por RA), agrupa por nome
    // completo igual — pega o caso do oficial sem RA + fantasma com RA.
    var porNome = {};
    todos.forEach(function(s){
      if(usados[s.id]) return;
      var chave = String(s.nome||'').trim().toLowerCase();
      if(!chave) return;
      (porNome[chave] = porNome[chave] || []).push(s);
    });
    Object.keys(porNome).forEach(function(nome){
      var grupo = porNome[nome];
      if(grupo.length < 2) return;
      var oficiais = grupo.filter(function(s){ return !/^s_/.test(s.id); });
      var fantasmas = grupo.filter(function(s){ return /^s_/.test(s.id); });
      if(oficiais.length===1 && fantasmas.length>=1){
        fantasmas.forEach(function(f){
          pares.push({stubId: f.id, officialId: oficiais[0].id, nome: oficiais[0].nome, ra: f.ra || oficiais[0].ra || '', raFantasma: f.ra||'', bolsaFantasma: f.bolsa||''});
        });
      } else {
        manual.push({ra: '(mesmo nome)', nomes: grupo.map(function(s){return s.nome;})});
      }
    });

    return {pares: pares, manual: manual};
  });
};
window.__pontosCorrigirDuplicados = function(pares){
  if(!pares || !pares.length){
    return Promise.resolve({paresCorrigidos:0, registrosMigrados:0, loginsVinculados:0});
  }
  return Promise.all([
    getDocs(collection(db, 'alunoAuth')),
    getDocs(collection(db, 'registros')),
    getDocs(collection(db, 'pedidos')),
    getDocs(collection(db, 'students'))
  ]).then(function(results){
    var authSnap = results[0], regSnap = results[1], pedSnap = results[2], studSnap = results[3];
    var studPorId = {};
    studSnap.forEach(function(d){ studPorId[d.id] = d.data(); });
    var authPorStudentId = {};
    authSnap.forEach(function(d){
      var data = d.data();
      if(data && data.studentId) authPorStudentId[data.studentId] = d.id;
    });
    var regsPorStudentId = {};
    regSnap.forEach(function(d){
      var data = d.data();
      if(!data || !data.studentId) return;
      (regsPorStudentId[data.studentId] = regsPorStudentId[data.studentId] || []).push(d.id);
    });
    var pedidosPorStudentId = {};
    pedSnap.forEach(function(d){
      var data = d.data();
      if(!data || !data.studentId) return;
      (pedidosPorStudentId[data.studentId] = pedidosPorStudentId[data.studentId] || []).push(d.id);
    });

    var ops = []; // {ref, data|null} — null = excluir
    var registrosMigrados = 0, loginsVinculados = 0, pedidosMigrados = 0;
    var hoje = new Date().toISOString().slice(0,10);
    pares.forEach(function(par){
      (regsPorStudentId[par.stubId] || []).forEach(function(regId){
        ops.push({ref: doc(db, 'registros', regId), data: {studentId: par.officialId}});
        registrosMigrados++;
      });
      (pedidosPorStudentId[par.stubId] || []).forEach(function(pedId){
        ops.push({ref: doc(db, 'pedidos', pedId), data: {studentId: par.officialId}});
        pedidosMigrados++;
      });
      var uidLogado = authPorStudentId[par.stubId];
      if(uidLogado){
        ops.push({ref: doc(db, 'alunoAuth', uidLogado), data: {studentId: par.officialId}});
        ops.push({ref: doc(db, 'alunoClaimed', par.officialId), data: {uid: uidLogado, claimadoEm: new Date().toISOString()}});
        loginsVinculados++;
      }
      ops.push({ref: doc(db, 'alunoClaimed', par.stubId), data: null});
      ops.push({ref: doc(db, 'students', par.stubId), data: {
        ativo: false,
        observacao: 'Cadastro duplicado (mesmo RA '+par.ra+') — mesclado com '+par.officialId+' em '+hoje+' pela ferramenta "Corrigir cadastros duplicados".'
      }});

      // Preenche RA/bolsa do oficial se estiverem vazios e o fantasma tiver
      // esses dados (caso do cadastro oficial importado incompleto).
      var oficialAtual = studPorId[par.officialId] || {};
      var patchOficial = {};
      if(!String(oficialAtual.ra||'').trim() && par.raFantasma) patchOficial.ra = par.raFantasma;
      if(!String(oficialAtual.bolsa||'').trim() && par.bolsaFantasma) patchOficial.bolsa = par.bolsaFantasma;
      if(Object.keys(patchOficial).length){
        ops.push({ref: doc(db, 'students', par.officialId), data: patchOficial});
        par.camposPreenchidos = patchOficial;
      }
    });

    var chunks = [];
    for(var i=0; i<ops.length; i+=400){ chunks.push(ops.slice(i, i+400)); }
    var chain = Promise.resolve();
    chunks.forEach(function(chunk){
      chain = chain.then(function(){
        var batch = writeBatch(db);
        chunk.forEach(function(op){
          if(op.data === null) batch.delete(op.ref);
          else batch.set(op.ref, op.data, {merge: true});
        });
        return batch.commit();
      });
    });
    return chain.then(function(){
      return {paresCorrigidos: pares.length, registrosMigrados: registrosMigrados, loginsVinculados: loginsVinculados, pedidosMigrados: pedidosMigrados};
    });
  });
};

/* ============================================================
   Sincronizar cadastros soltos (ferramenta de manutenção, botão
   "Sincronizar cadastros soltos" na aba Alunos — ver app.js).

   Alunos que se auto-cadastram pelo RA recebem um documento em
   students/{s_xxxxx}, mas esse perfil só passa a aparecer na aba
   Alunos (e contar no total de bolsistas) quando alguém completa o
   cadastro pelo painel e ele é salvo dentro de app/state.students.
   Se isso nunca acontece, o aluno continua batendo ponto e pedindo
   ajustes normalmente (as regras de segurança permitem, pelo
   próprio studentId) mas fica invisível pra administração — e é
   por isso que o nome dele aparece como "—" nos Pedidos de ajuste:
   a tela busca o nome em STATE.students (=app/state.students), não
   na coleção "students" inteira.

   window.__pontosDetectarCadastrosSoltos() é só leitura: devolve
   {soltos, pedidosParaCorrigir} — soltos são os perfis ativos que
   existem na coleção mas não em app/state.students (fora os IDs em
   EXCLUIDOS_DA_SINCRONIA, que são casos tratados manualmente à
   parte); pedidosParaCorrigir são pedidos cujo studentId aponta pra
   um cadastro já mesclado por "Corrigir cadastros duplicados" antes
   dessa ferramenta existir (por isso nunca foram migrados).

   window.__pontosSincronizarCadastrosSoltos() refaz essas mesmas
   contas e GRAVA: acrescenta os soltos a app/state.students e
   corrige o studentId dos pedidos afetados — tudo num único batch.
   ============================================================ */
var EXCLUIDOS_DA_SINCRONIA = ['s_mtkiyqnkm67y6', 's_mtklhni6onno9']; // Marlon (duplicado, ver s_mtlyklxdk2wqb) + cadastro de teste da administração

function calcularCadastrosSoltos(stateData, studSnap, pedSnap){
  var students = (stateData.students || []).slice();
  var stateIds = {};
  students.forEach(function(s){ stateIds[s.id] = true; });

  var mescladoMap = {};
  studSnap.forEach(function(d){
    var s = d.data();
    if(s.ativo === false){
      var m = /mesclado com (\S+) em/.exec(s.observacao||'');
      if(m) mescladoMap[d.id] = m[1];
    }
  });

  var soltos = [];
  studSnap.forEach(function(d){
    var s = Object.assign({}, d.data(), {id: d.id});
    if(s.ativo === false) return;
    if(stateIds[s.id]) return;
    if(EXCLUIDOS_DA_SINCRONIA.indexOf(s.id) !== -1) return;
    delete s.observacao;
    soltos.push(s);
  });

  var pedidosParaCorrigir = [];
  pedSnap.forEach(function(d){
    var p = d.data();
    if(!p.studentId) return;
    var alvo = mescladoMap[p.studentId];
    if(alvo && alvo !== p.studentId){
      pedidosParaCorrigir.push({id: d.id, de: p.studentId, para: alvo});
    }
  });

  return {students: students, soltos: soltos, pedidosParaCorrigir: pedidosParaCorrigir};
}

window.__pontosDetectarCadastrosSoltos = function(){
  return Promise.all([
    getDoc(STATE_DOC),
    getDocs(collection(db, 'students')),
    getDocs(collection(db, 'pedidos'))
  ]).then(function(results){
    var stateData = results[0].data() || {};
    var calc = calcularCadastrosSoltos(stateData, results[1], results[2]);
    return {soltos: calc.soltos, pedidosParaCorrigir: calc.pedidosParaCorrigir};
  });
};

window.__pontosSincronizarCadastrosSoltos = function(){
  return Promise.all([
    getDoc(STATE_DOC),
    getDocs(collection(db, 'students')),
    getDocs(collection(db, 'pedidos')),
    getDocs(collection(db, 'alunoAuth'))
  ]).then(function(results){
    var stateSnap = results[0], studSnap = results[1], pedSnap = results[2], authSnap = results[3];
    var stateData = stateSnap.data() || {};
    var calc = calcularCadastrosSoltos(stateData, studSnap, pedSnap);
    var novaLista = calc.students.concat(calc.soltos);

    var authParaRemover = [];
    authSnap.forEach(function(d){
      var data = d.data();
      if(data && EXCLUIDOS_DA_SINCRONIA.indexOf(data.studentId) !== -1) authParaRemover.push(d.id);
    });

    var hoje = new Date().toISOString().slice(0,10);
    var batch = writeBatch(db);
    batch.set(STATE_DOC, Object.assign({}, stateData, {students: novaLista}));
    batch.set(doc(db, 'students', 's_mtkiyqnkm67y6'), {
      ativo: false,
      observacao: 'Cadastro duplicado (mesmo RA 81816) — mesclado com s_mtlyklxdk2wqb em '+hoje+' pela ferramenta "Sincronizar cadastros soltos".'
    }, {merge: true});
    batch.set(doc(db, 'students', 's_mtklhni6onno9'), {
      ativo: false,
      observacao: 'Cadastro de teste (equipe de administração) desativado em '+hoje+' pela ferramenta "Sincronizar cadastros soltos".'
    }, {merge: true});
    authParaRemover.forEach(function(uid){ batch.delete(doc(db, 'alunoAuth', uid)); });
    calc.pedidosParaCorrigir.forEach(function(p){
      batch.update(doc(db, 'pedidos', p.id), {studentId: p.para});
    });

    return batch.commit().then(function(){
      return {
        cadastrosSincronizados: calc.soltos.length,
        nomesSincronizados: calc.soltos.map(function(s){ return s.nome; }),
        soltos: calc.soltos,
        pedidosCorrigidos: calc.pedidosParaCorrigir.length
      };
    });
  });
};

/* ============================================================
   Excluir cadastro permanentemente (botão "Excluir permanentemente"
   no perfil do aluno — ver app.js). Diferente de "Desativar"
   (reversível, só marca ativo:false e mantém tudo pra histórico),
   isso APAGA de vez: o documento em students/{id}, todos os
   registros de ponto, todos os pedidos de ajuste, o vínculo de
   login (alunoAuth) se houver, o alunoClaimed/{id} e o
   alunoRA/{ra} (se ainda apontar pra esse id) — e por último
   remove o aluno de app/state.students.

   Limite importante: isso só apaga dados do Firestore. A conta de
   login em si (e-mail/senha) mora no Firebase Authentication, e o
   app (rodando só no navegador, sem acesso de administrador do
   Firebase Auth) não tem como apagar a conta de OUTRA pessoa por
   ali — só a pessoa dona da conta consegue apagar a própria conta
   (deleteUser(auth.currentUser), usado no cancelamento do próprio
   cadastro). Depois dessa função rodar, a conta de e-mail/senha
   continua existindo no Firebase Auth, só que órfã (sem nenhum
   vínculo com studentId nenhum) — pra removê-la de vez é preciso
   apagar manualmente em Console do Firebase → Authentication.

   Devolve {registrosExcluidos, pedidosExcluidos, loginDesvinculado,
   ra}.
   ============================================================ */
window.__pontosExcluirCadastro = function(id){
  return Promise.all([
    getDoc(doc(db, 'students', id)),
    getDocs(query(collection(db, 'registros'), where('studentId', '==', id))),
    getDocs(query(collection(db, 'pedidos'), where('studentId', '==', id))),
    getDocs(query(collection(db, 'alunoAuth'), where('studentId', '==', id))),
    getDoc(doc(db, 'alunoClaimed', id))
  ]).then(function(results){
    var studSnap = results[0], regSnap = results[1], pedSnap = results[2], authSnap = results[3], claimedSnap = results[4];
    var ra = studSnap.exists() ? String((studSnap.data()||{}).ra || '').trim() : '';

    var ops = [];
    regSnap.forEach(function(d){ ops.push(doc(db, 'registros', d.id)); });
    pedSnap.forEach(function(d){ ops.push(doc(db, 'pedidos', d.id)); });
    authSnap.forEach(function(d){ ops.push(doc(db, 'alunoAuth', d.id)); });
    if(claimedSnap.exists()) ops.push(doc(db, 'alunoClaimed', id));
    ops.push(doc(db, 'students', id));

    var registrosExcluidos = regSnap.size, pedidosExcluidos = pedSnap.size, loginDesvinculado = authSnap.size > 0;

    var raCheck = ra ? getDoc(doc(db, 'alunoRA', ra)) : Promise.resolve(null);
    return raCheck.then(function(raSnap){
      if(raSnap && raSnap.exists() && raSnap.data().studentId === id){
        ops.push(doc(db, 'alunoRA', ra));
      }
      var chunks = [];
      for(var i=0; i<ops.length; i+=400){ chunks.push(ops.slice(i, i+400)); }
      var chain = Promise.resolve();
      chunks.forEach(function(chunk){
        chain = chain.then(function(){
          var batch = writeBatch(db);
          chunk.forEach(function(ref){ batch.delete(ref); });
          return batch.commit();
        });
      });
      return chain.then(function(){
        return {registrosExcluidos: registrosExcluidos, pedidosExcluidos: pedidosExcluidos, loginDesvinculado: loginDesvinculado, ra: ra};
      });
    });
  });
};

/* Mantém "alunoRA/{ra}" -> {studentId} em dia para os bolsistas da
   faculdade (ativos), para permitir o auto-cadastro por RA. Roda uma
   vez por sessão do admin logado — escrita idempotente, barata. */
function syncAlunoRA(students){
  var elegiveis = (students || []).filter(function(s){
    return s && s.ativo && s.nivel === 'FAC' && s.ra;
  });
  if(!elegiveis.length) return;
  var batch = writeBatch(db);
  elegiveis.forEach(function(s){
    batch.set(doc(db, 'alunoRA', String(s.ra)), {studentId: s.id});
  });
  batch.commit().catch(function(err){ console.error('[pontos] falha ao sincronizar alunoRA', err); });
}

function seedInitialState(){
  fetch('./seed-data.json').then(function(r){ return r.json(); }).then(function(seed){
    return setDoc(STATE_DOC, seed);
  }).catch(function(err){
    console.error('[pontos] falha ao semear dados iniciais', err);
  });
}

/* ============================================================
   Aluno (faculdade) — login individual, acesso restrito a
   students/{seuId} e aos registros/pedidos do próprio id.
   ============================================================ */
function startListeningAluno(uid){
  if(unsubAlunoPerfil) return;
  getDoc(doc(db, 'alunoAuth', uid)).then(function(snap){
    if(!snap.exists()){
      pendingLoginMessage = 'Este login não está vinculado a nenhum aluno. Fale com a administração.';
      signOut(auth);
      return;
    }
    var authData = snap.data();
    if(authData.status === 'pendente' && !authData.studentId){
      // RA não encontrado no cadastro do sistema — aguardando a
      // administração completar o perfil (ver "cadastrosPendentes").
      clearLoadTimeout();
      window.__pontosStudentPending(authData.nome || '');
      return;
    }
    var studentId = authData.studentId;
    var perfil = null, registros = [], pedidos = [], perfilLoaded = false;

    function emitAluno(){
      if(!perfilLoaded) return;
      if(!booted){
        booted = true;
        clearLoadTimeout();
        window.__pontosStudentBoot(perfil, registros, pedidos);
      } else {
        window.__pontosStudentApply(perfil, registros, pedidos);
      }
    }

    unsubAlunoPerfil = onSnapshot(doc(db, 'students', studentId), function(s){
      if(!s.exists()){
        // alunoAuth aponta pra um studentId que não existe mais (por ex.
        // um cadastro apagado e recriado do zero pela administração) —
        // sem isso, a tela ficava presa em "Carregando dados…" pra sempre.
        pendingLoginMessage = 'Não foi possível encontrar seu cadastro de aluno. Fale com a administração.';
        signOut(auth);
        return;
      }
      perfil = s.data();
      perfilLoaded = true;
      emitAluno();
    }, function(err){
      console.error('[pontos] perfil snapshot error', err);
      pendingLoginMessage = 'Não foi possível carregar seus dados agora. Verifique sua conexão e tente novamente.';
      signOut(auth);
    });

    unsubAlunoRegistros = onSnapshot(
      query(collection(db, 'registros'), where('studentId', '==', studentId)),
      function(snap){
        registros = snap.docs.map(function(d){ return d.data(); });
        emitAluno();
      },
      function(err){ console.error('[pontos] registros(aluno) snapshot error', err); }
    );

    unsubAlunoPedidos = onSnapshot(
      query(collection(db, 'pedidos'), where('studentId', '==', studentId)),
      function(snap){
        pedidos = snap.docs.map(function(d){ return d.data(); });
        emitAluno();
      },
      function(err){ console.error('[pontos] pedidos(aluno) snapshot error', err); }
    );
  }).catch(function(err){
    console.error('[pontos] alunoAuth lookup error', err);
    showLogin('Não foi possível carregar seu acesso agora. Verifique sua conexão.');
  });
}

function handleUserSignedIn(user){
  showApp();
  if(!appRoot.hasChildNodes()){
    appRoot.innerHTML = '<div class="login-loading">Carregando dados…</div>';
  }
  scheduleLoadTimeout();
  if(isAdminEmail(user.email)){
    startListeningAdmin();
  } else {
    startListeningAluno(user.uid);
  }
}

onAuthStateChanged(auth, function(user){
  if(suppressAuthHandling) return; // fluxo de cadastro em andamento — ele decide quando prosseguir
  if(user){
    handleUserSignedIn(user);
  } else {
    stopAllListeners();
    booted = false;
    lastSentJSON = null;
    if(conviteRA && !conviteDismissed && !pendingLoginMessage){
      showConviteScreen();
    } else {
      showLogin(pendingLoginMessage);
    }
    pendingLoginMessage = null;
  }
});
