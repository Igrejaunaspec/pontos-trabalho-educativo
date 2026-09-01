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
  createUserWithEmailAndPassword, deleteUser
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, doc, setDoc, updateDoc, getDoc, onSnapshot, collection, query, where, writeBatch
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

// listeners ativos (para poder cancelar ao trocar de papel / deslogar)
var unsubAdminState = null;
var unsubAdminRegistros = null;
var unsubAdminPedidos = null;
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

function showLogin(msg){
  loginScreen.hidden = false;
  appRoot.hidden = true;
  loginForm.hidden = false;
  signupForm.hidden = true;
  if(msg){ loginError.textContent = msg; loginError.hidden = false; }
  else { loginError.hidden = true; }
}
function showSignupScreen(msg){
  loginScreen.hidden = false;
  appRoot.hidden = true;
  loginForm.hidden = true;
  signupForm.hidden = false;
  if(msg){ signupError.textContent = msg; signupError.hidden = false; }
  else { signupError.hidden = true; }
}
function showApp(){
  loginScreen.hidden = true;
  appRoot.hidden = false;
}

setPersistence(auth, browserLocalPersistence).catch(function(){ /* ok manter padrão */ });

loginForm.addEventListener('submit', function(e){
  e.preventDefault();
  var fd = new FormData(loginForm);
  var email = (fd.get('email') || '').trim();
  var password = fd.get('password') || '';
  var btn = loginForm.querySelector('button[type="submit"]');
  btn.disabled = true;
  loginError.hidden = true;
  signInWithEmailAndPassword(auth, email, password).catch(function(err){
    showLogin('E-mail ou senha incorretos.');
  }).finally(function(){
    btn.disabled = false;
  });
});

if(showSignupLink) showSignupLink.addEventListener('click', function(e){
  e.preventDefault();
  showSignupScreen();
});
if(showLoginLink) showLoginLink.addEventListener('click', function(e){
  e.preventDefault();
  showLogin();
});

/* ============================================================
   Cadastro do próprio aluno (faculdade) — usa o RA para achar o
   cadastro certo em "alunoRA/{ra}" e reivindica esse aluno de
   forma exclusiva via "alunoClaimed/{studentId}" (regra garante
   que só o primeiro a reivindicar consegue vincular o login).
   ============================================================ */
signupForm.addEventListener('submit', function(e){
  e.preventDefault();
  var fd = new FormData(signupForm);
  var ra = (fd.get('ra') || '').trim();
  var email = (fd.get('email') || '').trim();
  var password = fd.get('password') || '';
  var password2 = fd.get('password2') || '';
  var btn = signupForm.querySelector('button[type="submit"]');

  if(!ra){ showSignupScreen('Informe seu RA.'); return; }
  if(password.length < 6){ showSignupScreen('A senha precisa ter pelo menos 6 caracteres.'); return; }
  if(password !== password2){ showSignupScreen('As senhas não coincidem.'); return; }

  btn.disabled = true;
  signupError.hidden = true;
  suppressAuthHandling = true; // segura o onAuthStateChanged até o vínculo terminar

  var createdUser = null;

  // Precisa criar a conta primeiro: a regra de "alunoRA" exige usuário
  // autenticado para leitura, então o RA só pode ser conferido depois.
  createUserWithEmailAndPassword(auth, email, password).then(function(cred){
    createdUser = cred.user;
    return getDoc(doc(db, 'alunoRA', ra));
  }).then(function(raSnap){
    if(!raSnap.exists()){
      throw {code: 'pontos/ra-nao-encontrado'};
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
    signupForm.reset();
    suppressAuthHandling = false;
    if(auth.currentUser){ handleUserSignedIn(auth.currentUser); }
  }).catch(function(err){
    var msg = 'Não foi possível criar seu login agora. Tente novamente.';
    if(err && err.code === 'pontos/ra-nao-encontrado'){
      msg = 'RA não encontrado. Verifique o número ou fale com a administração.';
    } else if(err && err.code === 'auth/email-already-in-use'){
      msg = 'Este e-mail já está em uso. Tente entrar, ou use outro e-mail.';
    } else if(err && err.code === 'auth/weak-password'){
      msg = 'Senha muito fraca. Use pelo menos 6 caracteres.';
    } else if(err && err.code === 'auth/invalid-email'){
      msg = 'E-mail inválido.';
    } else if(err && (err.code === 'permission-denied' || (err.message||'').indexOf('permission') !== -1)){
      msg = 'Este RA já tem um login cadastrado. Fale com a administração se isso não deveria acontecer.';
    }
    // se a conta de auth chegou a ser criada mas o vínculo falhou, desfaz para não deixar login órfão
    var cleanup = createdUser ? deleteUser(createdUser).catch(function(){ /* melhor esforço */ }) : Promise.resolve();
    return cleanup.then(function(){
      suppressAuthHandling = false;
      showSignupScreen(msg);
    });
  }).finally(function(){
    btn.disabled = false;
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
  if(unsubAlunoPerfil){ unsubAlunoPerfil(); unsubAlunoPerfil = null; }
  if(unsubAlunoRegistros){ unsubAlunoRegistros(); unsubAlunoRegistros = null; }
  if(unsubAlunoPedidos){ unsubAlunoPedidos(); unsubAlunoPedidos = null; }
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
  var alunoRASynced = false;

  function emit(){
    if(lastDocData===null) return;
    var merged = Object.assign({}, lastDocData, {registros: lastRegistros, pedidos: lastPedidos});
    if(!booted){
      booted = true;
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
}

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
      showLogin('Este login não está vinculado a nenhum aluno. Fale com a administração.');
      signOut(auth);
      return;
    }
    var studentId = snap.data().studentId;
    var perfil = null, registros = [], pedidos = [], perfilLoaded = false;

    function emitAluno(){
      if(!perfilLoaded) return;
      if(!booted){
        booted = true;
        window.__pontosStudentBoot(perfil, registros, pedidos);
      } else {
        window.__pontosStudentApply(perfil, registros, pedidos);
      }
    }

    unsubAlunoPerfil = onSnapshot(doc(db, 'students', studentId), function(s){
      if(!s.exists()) return;
      perfil = s.data();
      perfilLoaded = true;
      emitAluno();
    }, function(err){ console.error('[pontos] perfil snapshot error', err); });

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
    showLogin();
  }
});
