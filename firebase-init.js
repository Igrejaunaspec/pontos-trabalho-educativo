/* ============================================================
   Firebase — autenticação (Email/Password) + Firestore
   Admin: usa o documento único app/state (como antes).
   Alunos (login individual): usam as coleções students/{id} e
   registros/{id}, com acesso restrito só aos próprios dados
   (ver regras de segurança do Firestore).
   ============================================================ */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, onSnapshot, collection, query, where, writeBatch
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

var firebaseConfig = {
  apiKey: "AIzaSyD3yjy88UlmY7-swELnYE8TkVyhslR-P5k",
  authDomain: "trabalho-educativo-f4f0d.firebaseapp.com",
  projectId: "trabalho-educativo-f4f0d",
  storageBucket: "trabalho-educativo-f4f0d.firebasestorage.app",
  messagingSenderId: "317630867115",
  appId: "1:317630867115:web:e61720cbacf3e1927db9ee"
};

var ADMIN_EMAIL = "administracao@trabalhoeducativo.app";

var app = initializeApp(firebaseConfig);
var auth = getAuth(app);
var db = getFirestore(app);
var STATE_DOC = doc(db, "app", "state");

var booted = false;
var lastSentJSON = null;

// listeners ativos (para poder cancelar ao trocar de papel / deslogar)
var unsubAdminState = null;
var unsubAdminRegistros = null;
var unsubAlunoPerfil = null;
var unsubAlunoRegistros = null;

var loginScreen = document.getElementById('login-screen');
var appRoot = document.getElementById('app');
var loginForm = document.getElementById('login-form');
var loginError = document.getElementById('login-error');

function showLogin(msg){
  loginScreen.hidden = false;
  appRoot.hidden = true;
  if(msg){ loginError.textContent = msg; loginError.hidden = false; }
  else { loginError.hidden = true; }
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

window.__pontosLogout = function(){
  stopAllListeners();
  booted = false;
  lastSentJSON = null;
  signOut(auth);
};

function stopAllListeners(){
  if(unsubAdminState){ unsubAdminState(); unsubAdminState = null; }
  if(unsubAdminRegistros){ unsubAdminRegistros(); unsubAdminRegistros = null; }
  if(unsubAlunoPerfil){ unsubAlunoPerfil(); unsubAlunoPerfil = null; }
  if(unsubAlunoRegistros){ unsubAlunoRegistros(); unsubAlunoRegistros = null; }
}

/* ============================================================
   Admin — app/state (perfis, setores, líderes, bolsas, pedidos,
   log de atividade) + coleção registros (chegadas/saídas)
   ============================================================ */
window.__pontosSaveState = function(state){
  var clean = JSON.parse(JSON.stringify(state));
  delete clean.registros; // registros vivem só na coleção "registros" agora
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

function startListeningAdmin(){
  if(unsubAdminState) return;
  var lastDocData = null;
  var lastRegistros = [];

  function emit(){
    if(lastDocData===null) return;
    var merged = Object.assign({}, lastDocData, {registros: lastRegistros});
    if(!booted){
      booted = true;
      window.__pontosBoot(merged);
    } else {
      window.__pontosApplyRemote(merged);
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
   students/{seuId} e registros do próprio id.
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
    var perfil = null, registros = [], perfilLoaded = false;

    function emitAluno(){
      if(!perfilLoaded) return;
      if(!booted){
        booted = true;
        window.__pontosStudentBoot(perfil, registros);
      } else {
        window.__pontosStudentApply(perfil, registros);
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
  }).catch(function(err){
    console.error('[pontos] alunoAuth lookup error', err);
    showLogin('Não foi possível carregar seu acesso agora. Verifique sua conexão.');
  });
}

onAuthStateChanged(auth, function(user){
  if(user){
    showApp();
    if(!appRoot.hasChildNodes()){
      appRoot.innerHTML = '<div class="login-loading">Carregando dados…</div>';
    }
    if(user.email === ADMIN_EMAIL){
      startListeningAdmin();
    } else {
      startListeningAluno(user.uid);
    }
  } else {
    stopAllListeners();
    booted = false;
    lastSentJSON = null;
    showLogin();
  }
});
