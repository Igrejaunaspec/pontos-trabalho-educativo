/* ============================================================
   Firebase — autenticação (Email/Password) + Firestore
   Substitui a antiga persistência via Claude Artifact.
   ============================================================ */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, doc, setDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

var firebaseConfig = {
  apiKey: "AIzaSyD3yjy88UlmY7-swELnYE8TkVyhslR-P5k",
  authDomain: "trabalho-educativo-f4f0d.firebaseapp.com",
  projectId: "trabalho-educativo-f4f0d",
  storageBucket: "trabalho-educativo-f4f0d.firebasestorage.app",
  messagingSenderId: "317630867115",
  appId: "1:317630867115:web:e61720cbacf3e1927db9ee"
};

var app = initializeApp(firebaseConfig);
var auth = getAuth(app);
var db = getFirestore(app);
var STATE_DOC = doc(db, "app", "state");

var booted = false;
var unsubscribeSnapshot = null;
var lastSentJSON = null;

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
  if(unsubscribeSnapshot){ unsubscribeSnapshot(); unsubscribeSnapshot = null; }
  booted = false;
  lastSentJSON = null;
  signOut(auth);
};

window.__pontosSaveState = function(state){
  var clean = JSON.parse(JSON.stringify(state));
  lastSentJSON = JSON.stringify(clean);
  return setDoc(STATE_DOC, clean);
};

onAuthStateChanged(auth, function(user){
  if(user){
    showApp();
    if(!appRoot.hasChildNodes()){
      appRoot.innerHTML = '<div class="login-loading">Carregando dados…</div>';
    }
    startListening();
  } else {
    booted = false;
    lastSentJSON = null;
    if(unsubscribeSnapshot){ unsubscribeSnapshot(); unsubscribeSnapshot = null; }
    showLogin();
  }
});

function startListening(){
  if(unsubscribeSnapshot) return;
  unsubscribeSnapshot = onSnapshot(STATE_DOC, function(snap){
    if(!snap.exists()){
      seedInitialState();
      return;
    }
    var data = snap.data();
    var json = JSON.stringify(data);
    if(json === lastSentJSON) return; // eco do nosso próprio salvamento
    if(!booted){
      booted = true;
      window.__pontosBoot(data);
    } else {
      window.__pontosApplyRemote(data);
    }
  }, function(err){
    console.error('[pontos] snapshot error', err);
  });
}

function seedInitialState(){
  fetch('./seed-data.json').then(function(r){ return r.json(); }).then(function(seed){
    return setDoc(STATE_DOC, seed);
  }).catch(function(err){
    console.error('[pontos] falha ao semear dados iniciais', err);
  });
}
