/* ============================================================
   CAFÉ DE L'ORMEAU — APP v4
   + Planning semaine éditable par la direction
   ============================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, doc,
  addDoc, updateDoc, deleteDoc, setDoc, getDoc, getDocs,
  onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD_PdHJucO8Fy8FGtn5JBpBlyhiSaBo5JU",
  authDomain: "ormeau-direction-88fa3.firebaseapp.com",
  projectId: "ormeau-direction-88fa3",
  storageBucket: "ormeau-direction-88fa3.firebasestorage.app",
  messagingSenderId: "511690909181",
  appId: "1:511690909181:web:c311138f039b2afc05e594"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

const COL = {
  messages:       () => collection(db, 'messages'),
  tasks:          () => collection(db, 'tasks'),
  reminders:      () => collection(db, 'reminders'),
  suppliers:      () => collection(db, 'suppliers'),
  history:        () => collection(db, 'history'),
  staffMessages:  () => collection(db, 'staffMessages'),
  checklists:     () => collection(db, 'checklists'),
  shiftChefs:     () => collection(db, 'shiftChefs'),
  shiftRoles:     () => collection(db, 'shiftRoles'),
  weeklyPlanning: () => collection(db, 'weeklyPlanning'),
  checklistItems: () => collection(db, 'checklistItems'),
  dailyReports:   () => collection(db, 'dailyReports'),
};

// ============================================================
// CONSTANTES
// ============================================================

const DAYS_FR    = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
const DAYS_SHORT = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
const MONTHS_FR  = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
const SHIFTS     = ['Off','Matin','Soir','Coupure','10H-18H'];

const DIRECTION_USERS = {
  jb:     { id:'jb',     name:'JB',     initials:'JB', role:'Gérant',    isDirection:true },
  yohann: { id:'yohann', name:'Yohann', initials:'YO', role:'Directeur', isDirection:true },
};

const CHECKLISTS = {
  'matin-ouverture': { label:'Ouverture Matin', sections:[
    { title:'Extérieur', items:['Nettoyer les tables (lavette + produit vitre)','Balayer la terrasse','Mise en place des banquettes','Mise en place des cendriers','Faire les panneaux plat du jour (21€) + dessert (12€)','Ouvrir la salle 300 — nettoyer, dresser en lunch, allumer les lumières','Vérifier les toilettes','Trier les vides + faire les vides'] },
    { title:'Intérieur', items:['Vérifier banquettes et plateaux','Préparer la corbeille à viennoiseries + ranger les pains','Mettre en place les sauces + petit-déjeuner + confitures','Faire les vitres','Descendre les chaises','Plier les serviettes pour le midi'] },
  ]},
  'matin-fermeture': { label:'Fermeture Midi', sections:[
    { title:'Vaisselle & Couverts', items:['Faire les couverts + assiettes (liteau + vinaigre)','Nettoyer sel, poivre et condiments','Nettoyer carte foods-drinks-vins','Nettoyer les stands à vin'] },
    { title:'Hygiène & Divers', items:['Faire les toilettes du bas + du haut','Escalier des toilettes (dépoussiérage)','Vider toutes les poubelles du restaurant','Descendre les vides'] },
    { title:'Salle', items:['Nettoyer banquettes et tables','Balayer la salle','Nettoyer le frigo','Nettoyer la commode à pain'] },
  ]},
  'soir-ouverture': { label:'Ouverture Soir', sections:[
    { title:'Mise en place', items:['Nettoyer les bougies','Faire les panneaux suggestions','Trier les vides + faire les vides','Plier les serviettes','Dressage de la salle du fond','Dresser la salle 300'] },
  ]},
  'soir-fermeture': { label:'Fermeture Soir', sections:[
    { title:'Extérieur', items:['Nettoyer les tables (lavette + produit vitre)','Balayer la terrasse','Ranger les banquettes','Nettoyer les panneaux','Nettoyer la salle 300 + fermer','Faire les toilettes du bas + du haut','Dépoussiérage à hauteur des yeux (toilettes)'] },
    { title:'Intérieur', items:['Nettoyer les plateaux + torpilleur','Nettoyer les banquettes et entre les banquettes','Faire les couverts + assiettes (liteau + vinaigre)','Nettoyer la commode à pain — Balayer + serpillière','Sortir les poubelles','Nettoyage des cartes food & drinks','Nettoyer sel, poivre et condiments','Nettoyage du frigo','Nettoyer les cendriers + remettre en place'] },
  ]},
};

// ============================================================
// ÉTAT
// ============================================================

let currentUser    = null;
let listeners      = [];
let selectedUserId = null;
let dynamicStaff   = [];
let todayChef      = null;
let weeklyPlanDoc  = null; // document du planning de la semaine en cours

const DB = {
  messages:[], tasks:[], reminders:[], suppliers:[],
  staffMessages:[], checklists:[], shiftChefs:[], weeklyPlanning:[]
};

let currentTaskFilter  = 'today';
let currentMsgFilter   = 'all';
let currentStaffFilter = 'requests';
let currentSupFilter   = 'all';
let currentCheckFilter = 'matin-ouverture';

// ============================================================
// UTILS
// ============================================================

function pad(n)     { return String(n).padStart(2,'0'); }
function todayStr() { const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function todayDay() { return new Date().getDay(); }

// Numéro de semaine ISO (lundi = début)
function getWeekKey() {
  const d = new Date();
  const day = d.getDay()||7;
  d.setDate(d.getDate()+4-day);
  const yearStart = new Date(d.getFullYear(),0,1);
  const weekNo = Math.ceil(((d-yearStart)/86400000+1)/7);
  return `${d.getFullYear()}-W${String(weekNo).padStart(2,'0')}`;
}

// Dates lundi→dimanche de la semaine courante
function getWeekDates() {
  const today = new Date();
  const day = today.getDay()||7;
  const monday = new Date(today);
  monday.setDate(today.getDate()-day+1);
  return Array.from({length:7},(_,i)=>{
    const d = new Date(monday);
    d.setDate(monday.getDate()+i);
    return d;
  });
}

function formatDateTime(ts) {
  if (!ts) return '';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return `${d.getDate()} ${MONTHS_FR[d.getMonth()]} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getAllUsers() {
  const all = {...DIRECTION_USERS};
  dynamicStaff.forEach(s=>{ all[s.id]=s; });
  return all;
}

function getUserLabel(id) {
  if (id==='both') return 'JB & Yohann';
  return getAllUsers()[id]?.name || id;
}

function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function isTaskToday(t) {
  switch(t.freq) {
    case 'once':    return true;
    case 'daily':   return true;
    case 'weekly':  return String(todayDay())===String(t.day);
    case 'monthly': return new Date().getDate()===parseInt(t.day);
    default:        return false;
  }
}

function isOverdue(r) {
  if (!r.time||r.done) return false;
  const [h,m]=r.time.split(':').map(Number), now=new Date();
  if (r.date&&r.date<todayStr()) return true;
  if (r.date&&r.date>todayStr()) return false;
  return now.getHours()>h||(now.getHours()===h&&now.getMinutes()>m);
}

function getPriorityLabel(p) { return p==='urgent'?'Urgent':p==='low'?'Basse':'Normale'; }
function getFreqLabel(f)     { return f==='daily'?'Quotidien':f==='weekly'?'Hebdo':f==='monthly'?'Mensuel':''; }

function getShiftClass(s) {
  if (!s||s==='Off')  return 'shift-off';
  if (s==='Matin')    return 'shift-matin';
  if (s==='Soir')     return 'shift-soir';
  if (s==='Coupure')  return 'shift-coupure';
  return 'shift-custom';
}

function getInitials(name) {
  return (name||'').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)||'??';
}

// Récupère le shift d'un employé pour un jour donné (dayIndex 0-6)
function getShiftForDay(staffId, dayIndex) {
  if (!weeklyPlanDoc) return 'Off';
  return weeklyPlanDoc[staffId]?.[String(dayIndex)] || 'Off';
}

function getTodayShiftFromPlan(staffId) {
  return getShiftForDay(staffId, todayDay());
}

async function simpleHash(str) {
  const data = new TextEncoder().encode(str+'ormeau-salt-2024');
  const buf  = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

// ============================================================
// PLANNING HEBDOMADAIRE
// ============================================================

async function loadWeeklyPlanning() {
  const weekKey = getWeekKey();
  try {
    const d = await getDoc(doc(db,'weeklyPlanning',weekKey));
    if (d.exists()) {
      weeklyPlanDoc = d.data();
    } else {
      // Créer un planning vide pour cette semaine basé sur les profils
      weeklyPlanDoc = {};
      dynamicStaff.forEach(s=>{
        weeklyPlanDoc[s.id] = {...(s.planning||{})};
      });
      await setDoc(doc(db,'weeklyPlanning',weekKey), {...weeklyPlanDoc, _weekKey:weekKey, _createdAt: new Date().toISOString()});
    }
  } catch(e) {
    weeklyPlanDoc = {};
  }
}

async function updateShiftCell(staffId, dayIndex, newShift) {
  const weekKey = getWeekKey();
  if (!weeklyPlanDoc[staffId]) weeklyPlanDoc[staffId]={};
  weeklyPlanDoc[staffId][String(dayIndex)] = newShift;
  await updateDoc(doc(db,'weeklyPlanning',weekKey), {
    [`${staffId}.${dayIndex}`]: newShift,
    _updatedAt: new Date().toISOString(),
    _updatedBy: currentUser?.id
  });
}

function renderPlanningEditor(el) {
  const weekDates = getWeekDates();
  const today = todayDay();
  const weekKey = getWeekKey();

  // En-tête avec dates
  let html = `<div style="margin-bottom:12px;font-size:12px;color:var(--gray);font-weight:600">Semaine du ${weekDates[0].getDate()} ${MONTHS_FR[weekDates[0].getMonth()]} au ${weekDates[6].getDate()} ${MONTHS_FR[weekDates[6].getMonth()]}</div>`;
  
  html += `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch">
  <table style="width:100%;border-collapse:collapse;min-width:500px">
    <thead>
      <tr>
        <th style="text-align:left;padding:8px 10px;font-size:12px;font-weight:600;color:var(--gray);border-bottom:2px solid var(--cream-dark);white-space:nowrap">Employé</th>`;
  
  // Jours lundi → dimanche (index 1→0)
  const dayOrder = [1,2,3,4,5,6,0];
  dayOrder.forEach((dayIdx,i) => {
    const date = weekDates[i];
    const isToday = dayIdx === today;
    html += `<th style="padding:8px 6px;font-size:11px;font-weight:600;color:${isToday?'var(--green-dark)':'var(--gray)'};border-bottom:2px solid var(--cream-dark);text-align:center;min-width:70px">
      ${DAYS_SHORT[dayIdx]}<br><span style="font-weight:300">${date.getDate()}/${date.getMonth()+1}</span>
    </th>`;
  });
  html += '</tr></thead><tbody>';

  dynamicStaff.forEach(s => {
    html += `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid var(--cream-dark);white-space:nowrap">
        <div style="font-weight:600;font-size:13px">${s.name}</div>
        <div style="font-size:11px;color:var(--gray)">${s.poste||''}</div>
      </td>`;
    dayOrder.forEach((dayIdx,i) => {
      const isToday = dayIdx === today;
      const shift = weeklyPlanDoc?.[s.id]?.[String(dayIdx)] || 'Off';
      html += `<td style="padding:4px 4px;border-bottom:1px solid var(--cream-dark);text-align:center;background:${isToday?'rgba(26,58,46,0.04)':''}">
        <select onchange="onShiftChange('${s.id}',${dayIdx},this.value)" 
          style="font-size:11px;padding:4px 2px;border-radius:6px;border:1px solid var(--cream-dark);background:var(--cream);width:100%;cursor:pointer;font-family:var(--font-body)">
          ${SHIFTS.map(sh=>`<option value="${sh}" ${shift===sh?'selected':''}>${sh}</option>`).join('')}
        </select>
      </td>`;
    });
    html += '</tr>';
  });

  html += `</tbody></table></div>`;

  // Bouton chef de shift
  html += `<div style="margin-top:16px;display:flex;gap:10px">
    <button class="btn-primary" style="flex:1" onclick="openAssignChef()">👑 Chef de shift du soir</button>
  </div>`;
  if (todayChef) {
    html += `<div style="text-align:center;margin-top:10px;font-size:13px;color:var(--green-mid)">👑 Chef ce soir : <strong>${getUserLabel(todayChef.userId)}</strong></div>`;
  }

  el.innerHTML = html;
}

async function onShiftChange(staffId, dayIndex, newShift) {
  await updateShiftCell(staffId, dayIndex, newShift);
  showToast('Planning mis à jour ✓');
  // Mettre à jour le badge du jour si c'est aujourd'hui
  if (dayIndex === todayDay()) {
    renderStaffAvatarHeader();
    renderChefBadge();
  }
}

// ============================================================
// STAFF DYNAMIQUE
// ============================================================

async function loadDynamicStaff() {
  try {
    const snap = await getDocs(collection(db,'staffProfiles'));
    dynamicStaff = snap.docs.map(d=>({...d.data(), id:d.id}));
  } catch(e) {
    dynamicStaff = [];
  }
}

async function initDefaultStaff() {
  const defaultStaff = [
    { id:'romane',    name:'Romane',    initials:'RO', poste:'Bar',    planning:{'1':'Soir','2':'Coupure','3':'Off','4':'Coupure','5':'Coupure','6':'Coupure','0':'Coupure'} },
    { id:'eleonore',  name:'Éléonore',  initials:'EL', poste:'Salle',  planning:{'1':'Soir','2':'Off','3':'Soir','4':'10H-18H','5':'Soir','6':'Soir','0':'10H-18H'} },
    { id:'florian',   name:'Florian',   initials:'FL', poste:'Salle',  planning:{'1':'Off','2':'Matin','3':'Matin','4':'Soir','5':'Soir','6':'Soir','0':'Soir'} },
    { id:'jeando',    name:'Jean Do',   initials:'JD', poste:'Salle',  planning:{'1':'Soir','2':'Soir','3':'Off','4':'Soir','5':'Soir','6':'Matin','0':'Matin'} },
    { id:'guillaume', name:'Guillaume', initials:'GU', poste:'Salle',  planning:{'1':'Matin','2':'Matin','3':'Matin','4':'Matin','5':'Matin','6':'Matin','0':'Matin'} },
    { id:'heloise',   name:'Héloïse',   initials:'HE', poste:'Salle',  planning:{'1':'Matin','2':'Soir','3':'Soir','4':'Matin','5':'Matin','6':'Off','0':'Soir'} },
    { id:'maxime',    name:'Maxime',    initials:'MA', poste:'Runner', planning:{'1':'Coupure','2':'Soir','3':'Soir','4':'10H-18H','5':'Soir','6':'Off','0':'Matin'} },
    { id:'lenny',     name:'Lenny',     initials:'LE', poste:'Runner', planning:{'1':'Off','2':'Matin','3':'Matin','4':'Soir','5':'Matin','6':'Matin','0':'Soir'} },
  ];
  for (const s of defaultStaff) {
    await setDoc(doc(db,'staffProfiles',s.id), s);
  }
  dynamicStaff = defaultStaff;
}

// ============================================================
// LOGIN
// ============================================================

function buildUserList() {
  const el = document.getElementById('user-list'); if(!el) return;
  let html = '<div class="section-divider">Direction</div>';
  Object.values(DIRECTION_USERS).forEach(u=>{
    html+=`<button class="user-btn direction-btn" onclick="selectUser('${u.id}')">
      <div class="user-avatar">${u.initials}</div>
      <div><span class="user-name">${u.name}</span><span class="user-role">${u.role}</span></div>
    </button>`;
  });
  html+='<div class="section-divider">Équipe</div>';
  dynamicStaff.forEach(s=>{
    const shift = getTodayShiftFromPlan(s.id);
    html+=`<button class="user-btn" onclick="selectUser('${s.id}')">
      <div class="user-avatar">${s.initials||getInitials(s.name)}</div>
      <div>
        <span class="user-name">${s.name}</span>
        <span class="user-role">${s.poste||''} · <span class="planning-shift ${getShiftClass(shift)}" style="font-size:10px;padding:1px 6px">${shift}</span></span>
      </div>
    </button>`;
  });
  el.innerHTML=html;
}

async function selectUser(userId) {
  selectedUserId=userId;
  const user=getAllUsers()[userId];
  document.getElementById('login-step-1').classList.add('hidden');
  document.getElementById('login-step-2').classList.remove('hidden');
  document.getElementById('login-selected-name').textContent=user.name;
  try {
    const d=await getDoc(doc(db,'users',userId));
    if(d.exists()&&d.data().passwordHash) {
      document.getElementById('login-enter-pwd').classList.remove('hidden');
      document.getElementById('login-create-pwd').classList.add('hidden');
    } else {
      document.getElementById('login-create-pwd').classList.remove('hidden');
      document.getElementById('login-enter-pwd').classList.add('hidden');
    }
  } catch(e) {
    document.getElementById('login-create-pwd').classList.remove('hidden');
    document.getElementById('login-enter-pwd').classList.add('hidden');
  }
}

function backToStep1() {
  selectedUserId=null;
  document.getElementById('login-step-1').classList.remove('hidden');
  document.getElementById('login-step-2').classList.add('hidden');
  document.getElementById('login-create-pwd').classList.add('hidden');
  document.getElementById('login-enter-pwd').classList.add('hidden');
  document.getElementById('login-error').classList.add('hidden');
}

async function createPassword() {
  const pwd=document.getElementById('pwd-create').value;
  const conf=document.getElementById('pwd-confirm').value;
  if(!pwd||pwd.length<4){showToast('Minimum 4 caractères');return;}
  if(pwd!==conf){showToast('Les mots de passe ne correspondent pas');return;}
  const hash=await simpleHash(pwd);
  await setDoc(doc(db,'users',selectedUserId),{passwordHash:hash,updatedAt:serverTimestamp()},{merge:true});
  doLogin(selectedUserId);
}

async function checkPassword() {
  const pwd=document.getElementById('pwd-enter').value; if(!pwd) return;
  const hash=await simpleHash(pwd);
  const d=await getDoc(doc(db,'users',selectedUserId));
  if(d.exists()&&d.data().passwordHash===hash) {
    document.getElementById('login-error').classList.add('hidden');
    doLogin(selectedUserId);
  } else {
    document.getElementById('login-error').classList.remove('hidden');
  }
}

function doLogin(userId) {
  currentUser=getAllUsers()[userId];
  localStorage.setItem('ormeau_user',userId);
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('current-user-badge').textContent=currentUser.initials||getInitials(currentUser.name);
  if(currentUser.isDirection) {
    document.getElementById('nav-direction').classList.remove('hidden');
    document.getElementById('nav-staff').classList.add('hidden');
  } else {
    document.getElementById('nav-direction').classList.add('hidden');
    document.getElementById('nav-staff').classList.remove('hidden');
  }
  initApp();
}

function logout() {
  if(!confirm('Se déconnecter ?')) return;
  listeners.forEach(u=>u()); listeners=[];
  currentUser=null; localStorage.removeItem('ormeau_user');
  document.getElementById('app').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
  backToStep1();
}

async function restoreSession() {
  const saved=localStorage.getItem('ormeau_user'); if(!saved) return;
  if(!getAllUsers()[saved]){localStorage.removeItem('ormeau_user');return;}
  try {
    const d=await getDoc(doc(db,'users',saved));
    if(d.exists()&&d.data().passwordHash) doLogin(saved);
    else localStorage.removeItem('ormeau_user');
  } catch(e) { localStorage.removeItem('ormeau_user'); }
}

// ============================================================
// INIT
// ============================================================

function initApp() {
  updateHeaderDate();
  attachListeners();
  if(currentUser.isDirection) showPage('dashboard');
  else showPage('staff-dashboard');
  setInterval(checkReminders,60000);
  if('Notification'in window&&Notification.permission==='default') Notification.requestPermission();
}

function updateHeaderDate() {
  const d=new Date();
  document.getElementById('header-date').textContent=`${DAYS_FR[d.getDay()]} ${d.getDate()} ${MONTHS_FR[d.getMonth()]}`;
}

function attachListeners() {
  listeners.push(onSnapshot(query(COL.messages(),orderBy('createdAt','asc')),snap=>{
    DB.messages=snap.docs.map(d=>({id:d.id,...d.data()}));
    renderDashboardMessages(); renderMessages(); updateMsgBadge();
  }));
  listeners.push(onSnapshot(query(COL.tasks(),orderBy('createdAt','asc')),snap=>{
    DB.tasks=snap.docs.map(d=>({id:d.id,...d.data()}));
    renderDashboardTasks(); renderTasks();
  }));
  listeners.push(onSnapshot(query(COL.reminders(),orderBy('createdAt','asc')),snap=>{
    DB.reminders=snap.docs.map(d=>({id:d.id,...d.data()}));
    renderDashboardReminders(); renderUrgentReminders(); checkReminders();
  }));
  listeners.push(onSnapshot(query(COL.suppliers(),orderBy('createdAt','asc')),snap=>{
    DB.suppliers=snap.docs.map(d=>({id:d.id,...d.data()}));
    if(DB.suppliers.length===0) initDefaultSuppliers();
    renderSuppliers(); renderDashboardSuppliers();
  }));
  listeners.push(onSnapshot(query(COL.staffMessages(),orderBy('createdAt','asc')),snap=>{
    DB.staffMessages=snap.docs.map(d=>({id:d.id,...d.data()}));
    renderStaffSection(); renderDashboardStaffRequests(); updateStaffBadge();
    renderStaffMessages(); renderStaffDirMessages();
  }));
  listeners.push(onSnapshot(query(COL.checklists(),orderBy('createdAt','asc')),snap=>{
    DB.checklists=snap.docs.map(d=>({id:d.id,...d.data()}));
    renderChecklist(); renderStaffTodayChecklist();
  }));
  // Items checklist partagés (temps réel entre tous)
  listeners.push(onSnapshot(query(COL.checklistItems(),orderBy('createdAt','asc')),snap=>{
    DB.checklistItems=snap.docs.map(d=>({id:d.id,...d.data()}));
    renderChecklist(); renderStaffTodayChecklist();
  }));
  // Rôles de shift
  listeners.push(onSnapshot(query(COL.shiftRoles(),orderBy('createdAt','asc')),snap=>{
    DB.shiftRoles=snap.docs.map(d=>({id:d.id,...d.data()}));
    renderStaffAvatarHeader(); renderChecklist();
  }));
  // Historique + rapports (direction seulement)
  if(currentUser?.isDirection) {
    listeners.push(onSnapshot(query(COL.history(),orderBy('doneAt','desc')),snap=>{
      DB.history=snap.docs.map(d=>({id:d.id,...d.data()}));
      renderHistory();
    }));
    listeners.push(onSnapshot(query(COL.dailyReports(),orderBy('validatedAt','desc')),snap=>{
      DB.dailyReports=snap.docs.map(d=>({id:d.id,...d.data()}));
      renderHistory();
    }));
  }
  listeners.push(onSnapshot(query(COL.shiftChefs(),orderBy('date','desc')),snap=>{
    DB.shiftChefs=snap.docs.map(d=>({id:d.id,...d.data()}));
    todayChef=DB.shiftChefs.find(c=>c.date===todayStr())||null;
    renderChefBadge(); renderStaffAvatarHeader(); renderDashboardTeam();
  }));
  // Planning semaine en live
  listeners.push(onSnapshot(doc(db,'weeklyPlanning',getWeekKey()),snap=>{
    if(snap.exists()) {
      weeklyPlanDoc=snap.data();
      buildUserList();
      renderDashboardTeam();
      if(currentStaffFilter==='planning') {
        const el=document.getElementById('staff-list');
        if(el) renderPlanningEditor(el);
      }
      renderStaffAvatarHeader();
    }
  }));
  // Staff profiles en live
  onSnapshot(collection(db,'staffProfiles'),snap=>{
    dynamicStaff=snap.docs.map(d=>({...d.data(),id:d.id}));
    buildUserList();
  });
}

// ============================================================
// NAVIGATION
// ============================================================

function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('page-'+pageId)?.classList.add('active');
  document.querySelector(`.nav-btn[data-page="${pageId}"]`)?.classList.add('active');
  if(pageId==='dashboard') { renderAvatarHeader(); renderDashboardTeam(); }
  if(pageId==='staff-dashboard') renderStaffAvatarHeader();
  if(pageId==='staff-checklist') renderChecklist(currentCheckFilter);
  if(pageId==='staff-planning') renderFullPlanning();
  if(pageId==='history') { if(!currentUser?.isDirection){showPage('staff-dashboard');return;} renderHistory(); }
}

// ============================================================
// AVATAR HEADERS
// ============================================================

function renderAvatarHeader() {
  const el=document.getElementById('avatar-header'); if(!el||!currentUser) return;
  const dirPlan={'jb':{1:'On',2:'Off',3:'On',4:'On',5:'On',6:'On',0:'On'},'yohann':{1:'Off',2:'On',3:'On',4:'Marché',5:'Apéro',6:'On',0:'Marché'}};
  const plan=dirPlan[currentUser.id];
  const shift=plan?.[todayDay()]||'On';
  const isOff=shift==='Off';
  const d=new Date();
  el.innerHTML=`<div class="avatar-circle">${currentUser.initials}</div>
    <div class="avatar-info">
      <div class="avatar-name">Bonjour, ${currentUser.name}</div>
      <div class="avatar-role">${currentUser.role}</div>
      ${isOff?'<div class="avatar-off">🌙 Jour de repos</div>':`<div class="avatar-today">📅 ${DAYS_FR[d.getDay()]} ${d.getDate()} ${MONTHS_FR[d.getMonth()]} · ${shift}</div>`}
      ${todayChef?`<div class="avatar-today" style="color:var(--gold-light)">👑 Chef de shift : ${getUserLabel(todayChef.userId)}</div>`:''}
    </div>`;
}

function renderStaffAvatarHeader() {
  const el=document.getElementById('staff-avatar-header'); if(!el||!currentUser) return;
  const shift=getTodayShiftFromPlan(currentUser.id);
  const isOff=shift==='Off';
  const d=new Date();
  const isChef=todayChef?.userId===currentUser.id;
  el.innerHTML=`<div class="avatar-circle">${currentUser.initials||getInitials(currentUser.name)}</div>
    <div class="avatar-info">
      <div class="avatar-name">Bonjour, ${currentUser.name}</div>
      <div class="avatar-role">${currentUser.poste||''}</div>
      ${isOff?'<div class="avatar-off">🌙 Jour de repos</div>':`<div class="avatar-today">📅 ${DAYS_FR[d.getDay()]} · Shift ${shift}</div>`}
      ${isChef?'<div class="avatar-today" style="color:var(--gold-light)">👑 Vous êtes chef de shift aujourd\'hui</div>':''}
    </div>`;
  const planEl=document.getElementById('staff-week-planning'); if(!planEl) return;
  const weekDates=getWeekDates();
  const dayOrder=[1,2,3,4,5,6,0];
  let html='<div class="planning-grid">';
  dayOrder.forEach((dayIdx,i)=>{
    const s=weeklyPlanDoc?.[currentUser.id]?.[String(dayIdx)]||'Off';
    const isToday=dayIdx===todayDay();
    html+=`<span class="planning-day" style="${isToday?'color:var(--green-dark);font-weight:700':''}">${DAYS_SHORT[dayIdx]} ${weekDates[i].getDate()}</span>
           <span class="planning-shift ${getShiftClass(s)}" style="${isToday?'font-weight:700':''}">${s}</span>`;
  });
  html+='</div>';
  planEl.innerHTML=html;
}

function renderChefBadge() {
  if(currentUser?.isDirection) renderAvatarHeader();
}

// ============================================================
// CHEF DE SHIFT
// ============================================================

function openAssignChef() {
  const today=todayDay();
  const soirStaff=dynamicStaff.filter(s=>{
    const shift=weeklyPlanDoc?.[s.id]?.[String(today)]||'Off';
    return shift==='Soir'||shift==='Coupure';
  });
  const el=document.getElementById('chef-select-list'); if(!el) return;
  el.innerHTML=soirStaff.map(s=>`
    <button class="user-btn" style="margin-bottom:8px" onclick="setChefDeShift('${s.id}')">
      <div class="user-avatar">${s.initials||getInitials(s.name)}</div>
      <div><span class="user-name">${s.name}</span><span class="user-role">${s.poste}</span></div>
    </button>`).join('');
  if(!soirStaff.length) el.innerHTML='<div class="empty-state-sm">Aucun employé de soir aujourd\'hui</div>';
  openModal('modal-chef');
}

async function setChefDeShift(userId) {
  const today=todayStr();
  const existing=DB.shiftChefs.find(c=>c.date===today);
  if(existing) await deleteDoc(doc(db,'shiftChefs',existing.id));
  await addDoc(COL.shiftChefs(),{userId,date:today,assignedBy:currentUser.id,createdAt:serverTimestamp()});
  closeModal('modal-chef');
  showToast(`${getUserLabel(userId)} est chef de shift ✓`);
}

// ============================================================
// AJOUT UTILISATEUR
// ============================================================

function toggleNewUserRole(){
  const role=document.getElementById('new-user-role').value;
  document.getElementById('new-user-staff-fields').classList.toggle('hidden', role==='direction');
  document.getElementById('new-user-direction-fields').classList.toggle('hidden', role==='staff');
}

function openAddUser() {
  if(!currentUser?.isDirection){showToast('Accès direction uniquement');return;}
  ['new-user-name','new-user-title'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('new-user-poste').value='Salle';
  document.getElementById('new-user-role').value='staff';
  document.getElementById('new-user-staff-fields').classList.remove('hidden');
  document.getElementById('new-user-direction-fields').classList.add('hidden');
  const dayOrder=[1,2,3,4,5,6,0];
  const planDiv=document.getElementById('new-user-planning');
  planDiv.innerHTML=dayOrder.map(dayIdx=>`
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <span style="font-size:12px;font-weight:600;min-width:36px;color:var(--gray)">${DAYS_SHORT[dayIdx]}</span>
      <select id="plan-${dayIdx}" style="flex:1;padding:8px 10px;background:var(--cream);border-radius:6px;font-size:13px;border:1px solid var(--cream-dark)">
        ${SHIFTS.map(s=>`<option value="${s}">${s}</option>`).join('')}
      </select>
    </div>`).join('');
  openModal('modal-add-user');
}

async function saveNewUser() {
  const name=document.getElementById('new-user-name').value.trim();
  const role=document.getElementById('new-user-role').value;
  if(!name){showToast('Donnez un prénom');return;}
  const id=name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,'').replace(/[^a-z]/g,'');
  const initials=getInitials(name);

  if(role==='direction'){
    const title=document.getElementById('new-user-title')?.value.trim()||'Direction';
    // Ajouter comme utilisateur direction dans Firestore
    await setDoc(doc(db,'directionProfiles',id),{
      id,name,initials,role:title,isDirection:true,
      createdAt:serverTimestamp()
    });
    showToast(name+' ajouté(e) à la direction ✓');
  } else {
    const poste=document.getElementById('new-user-poste').value;
    const planning={};
    [0,1,2,3,4,5,6].forEach(d=>{planning[String(d)]=document.getElementById('plan-'+d)?.value||'Off';});
    await setDoc(doc(db,'staffProfiles',id),{id,name,poste,initials,planning,createdAt:serverTimestamp()});
    const weekKey=getWeekKey();
    const updates={};
    Object.keys(planning).forEach(d=>{updates[id+'.'+d]=planning[d];});
    try{await updateDoc(doc(db,'weeklyPlanning',weekKey),updates);}catch(e){}
    showToast(name+' ajouté(e) à l\'équipe ✓');
  }
  closeModal('modal-add-user');
}

async function deleteStaffMember(id) {
  if(!currentUser?.isDirection){showToast('Accès direction uniquement');return;}
  if(!confirm('Supprimer cet employé ?')) return;
  await deleteDoc(doc(db,'staffProfiles',id));
  try { await deleteDoc(doc(db,'users',id)); } catch(e){}
  showToast('Employé supprimé');
}


// ============================================================
// ÉQUIPE DU JOUR (dashboard)
// ============================================================

function renderDashboardTeam() {
  const el = document.getElementById('dashboard-team'); if(!el) return;
  const today = String(todayDay());
  const todayShift = weeklyPlanDoc || {};

  // Trouver qui travaille aujourd'hui
  const working = dynamicStaff.filter(s => {
    const shift = weeklyPlanDoc?.[s.id]?.[today] || 'Off';
    return shift !== 'Off';
  });

  if (!working.length) {
    el.innerHTML = '<div class="empty-state-sm" style="color:rgba(245,240,232,0.5)">Aucun employé en shift aujourd\'hui</div>';
    return;
  }

  el.innerHTML = '<div class="team-day-grid">' + working.map(s => {
    const shift = weeklyPlanDoc?.[s.id]?.[today] || 'Off';
    const isChef = todayChef?.userId === s.id;
    return '<div class="team-member-chip">'
      + '<div class="team-chip-avatar">' + (s.initials || getInitials(s.name)) + '</div>'
      + '<div>'
        + '<span class="team-chip-name">' + escHtml(s.name)
          + (isChef ? '<span class="team-chef-badge">👑 Chef</span>' : '')
        + '</span>'
        + '<span class="team-chip-shift">' + shift + '</span>'
      + '</div>'
    + '</div>';
  }).join('') + '</div>';
}

// ============================================================
// DASHBOARD
// ============================================================

function renderDashboard() {
  renderAvatarHeader();
  renderDashboardTeam();
  renderDashboardMessages();
  renderDashboardTasks();
  renderDashboardSuppliers();
  renderDashboardReminders();
  renderDashboardStaffRequests();
  renderUrgentReminders();
}

function renderDashboardMessages() {
  const msgs=DB.messages.filter(m=>
    !m.archived && !m.deleted &&
    (m.to===currentUser?.id || m.to==='all' ||
     (currentUser?.isDirection && (m.from===currentUser.id||m.to===currentUser.id)))
  ).slice(-3).reverse();
  const el=document.getElementById('dashboard-messages'); if(!el) return;
  el.innerHTML=msgs.length?msgs.map(m=>`<div class="dash-msg-item">
    <div class="dash-msg-from">${getUserLabel(m.from)} → ${getUserLabel(m.to)}</div>
    <div class="dash-msg-text">${escHtml(m.content)}</div>
  </div>`).join(''):'<div class="empty-state-sm">Aucun message récent</div>';
}

function renderDashboardTasks() {
  const tasks=DB.tasks.filter(isTaskToday).slice(0,5);
  const el=document.getElementById('dashboard-tasks'); if(!el) return;
  el.innerHTML=tasks.length?tasks.map(t=>`<div class="dash-task-item">
    <div class="dot dash-priority ${t.priority}"></div>
    <button class="dash-check ${t.status==='done'?'checked':''}" onclick="quickToggleTask('${t.id}')">${t.status==='done'?'✓':''}</button>
    <span class="dash-task-text ${t.status==='done'?'done':''}">${escHtml(t.title)}</span>
    ${t.time?`<span style="font-size:11px;color:var(--gray);white-space:nowrap">${t.time}</span>`:''}
  </div>`).join(''):'<div class="empty-state-sm">Aucune tâche aujourd\'hui</div>';
}

function renderDashboardSuppliers() {
  const dayMap={0:'dim',1:'lun',2:'mar',3:'mer',4:'jeu',5:'ven',6:'sam'};
  const todayAbbr=dayMap[todayDay()];
  const sups=DB.suppliers.filter(s=>s.days&&s.days.toLowerCase().split(/[,\s]+/).some(d=>d.startsWith(todayAbbr)));
  const el=document.getElementById('dashboard-suppliers'); if(!el) return;
  el.innerHTML=sups.length?sups.map(s=>`<div class="dash-sup-item">
    <span class="dash-sup-name">${escHtml(s.name)}</span>
    ${s.url&&s.url!=='#'?`<a class="dash-sup-link" href="${s.url}" target="_blank">Commander →</a>`:'<span style="font-size:12px;color:var(--gray)">Pas de lien</span>'}
  </div>`).join(''):'<div class="empty-state-sm">Aucune commande aujourd\'hui</div>';
}

function renderDashboardReminders() {
  const today=todayStr(),now=new Date();
  const rems=DB.reminders.filter(r=>{
    if(r.done) return false;
    if(r.freq==='once') return r.date===today;
    if(r.freq==='daily') return true;
    if(r.freq==='weekly') return new Date(r.date||today).getDay()===now.getDay();
    return false;
  });
  const el=document.getElementById('dashboard-reminders'); if(!el) return;
  el.innerHTML=rems.length?rems.map(r=>{const ov=isOverdue(r);return`<div class="dash-reminder-item">
    <span class="dash-reminder-time ${ov?'overdue':''}">${r.time||'--:--'}</span>
    <span class="dash-reminder-title">${escHtml(r.title)}</span>
    <button class="dash-reminder-done" onclick="markReminderDone('${r.id}')">✓</button>
  </div>`;}).join(''):'<div class="empty-state-sm">Aucun rappel</div>';
}

function renderUrgentReminders() {
  const overdue=DB.reminders.filter(r=>!r.done&&isOverdue(r));
  const el=document.getElementById('urgent-reminders'),list=document.getElementById('urgent-reminders-list');
  if(!el||!list) return;
  if(!overdue.length){el.classList.add('hidden');return;}
  el.classList.remove('hidden');
  list.innerHTML=overdue.map(r=>`<div class="reminder-item overdue" style="margin-bottom:8px">
    <span class="reminder-time overdue-time">${r.time||'--:--'}</span>
    <div class="reminder-info"><div class="reminder-title-text">${escHtml(r.title)}</div>${r.note?`<div class="reminder-note">${escHtml(r.note)}</div>`:''}</div>
    <button class="reminder-check" onclick="markReminderDone('${r.id}')">✓</button>
  </div>`).join('');
}

function renderDashboardStaffRequests() {
  const reqs=DB.staffMessages.filter(m=>!m.archived).slice(-3);
  const el=document.getElementById('dashboard-staff-requests'); if(!el) return;
  el.innerHTML=reqs.length?reqs.map(m=>`<div class="request-item ${m.type==='problem'?'problem':m.type==='info'?'info':''}">
    <div class="request-header">
      <span class="request-name">${getUserLabel(m.from)}</span>
      <span class="request-type-badge badge-${m.type}">${m.type==='request'?'Requête':m.type==='problem'?'Problème':'Info'}</span>
      ${!m.read?'<span class="msg-badge unread">Nouveau</span>':''}
    </div>
    <div class="request-text">${escHtml(m.content)}</div>
    <div class="request-time">${formatDateTime(m.createdAt)}</div>
  </div>`).join(''):'<div class="empty-state-sm">Aucune requête en attente</div>';
}

// ============================================================
// MESSAGES
// ============================================================

function renderMessages() {
  let msgs=[...DB.messages].filter(m=>!m.deleted);
  if(currentMsgFilter==='unread') msgs=msgs.filter(m=>!m.read&&(m.to===currentUser.id||m.to==='all')&&!m.archived);
  else if(currentMsgFilter==='mine') msgs=msgs.filter(m=>(m.to===currentUser.id||m.to==='all')&&!m.archived);
  else if(currentMsgFilter==='archived') msgs=msgs.filter(m=>m.archived);
  else msgs=msgs.filter(m=>!m.archived);
  msgs=msgs.reverse();
  const el=document.getElementById('messages-list'); if(!el) return;
  if(!msgs.length){el.innerHTML='<div class="empty-state-sm" style="padding:20px;text-align:center">Aucun message</div>';return;}
  el.innerHTML=msgs.map(m=>{
    const unread=!m.read&&m.to===currentUser.id;
    const replies=m.replies||[];
    return `<div class="message-item ${unread?'unread':''} ${m.archived?'archived':''} ${m.priority==='urgent'?'urgent-msg':''}">
      <div class="message-meta">
        <span class="msg-author">${getUserLabel(m.from)}</span>
        <span style="font-size:12px;color:var(--gray)">→</span>
        <span class="msg-author" style="background:rgba(74,140,107,.15)">${getUserLabel(m.to)}</span>
        <span class="msg-time">${formatDateTime(m.createdAt)}</span>
        ${unread?'<span class="msg-badge unread">Nouveau</span>':''}
        ${m.priority==='urgent'?'<span class="msg-badge urgent">Urgent</span>':''}
      </div>
      <div class="message-text">${escHtml(m.content)}</div>
      ${replies.length?`<div class="reply-thread">${replies.map(r=>`<div class="reply-item"><div class="reply-meta">${getUserLabel(r.from)} · ${formatDateTime(r.createdAt)}</div>${escHtml(r.content)}</div>`).join('')}</div>`:''}
      <div class="message-actions">
        <button class="msg-action-btn" onclick="openReply('${m.id}','messages')">↩ Répondre</button>
        ${unread?`<button class="msg-action-btn" onclick="markMsgRead('${m.id}')">✓ Lu</button>`:''}
        ${!m.archived?`<button class="msg-action-btn archive" onclick="archiveMsg('${m.id}')">Archiver</button>`:''}
        <button class="msg-action-btn archive" onclick="deleteMsg('${m.id}')">🗑 Supprimer</button>
      </div>
    </div>`;
  }).join('');
}

function filterMessages(f,btn){document.querySelectorAll('#page-messages .filter-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');currentMsgFilter=f;renderMessages();}
function buildMessageRecipients() {
  const sel = document.getElementById('msg-to'); if(!sel) return;
  let opts = '';
  // Toute l'équipe
  opts += '<option value="all">📢 Toute l\'équipe</option>';
  // Direction (sauf soi-même)
  Object.values(DIRECTION_USERS).forEach(u=>{
    if(u.id !== currentUser.id)
      opts += '<option value="'+u.id+'">'+u.name+' (Direction)</option>';
  });
  // Staff
  dynamicStaff.forEach(s=>{
    opts += '<option value="'+s.id+'">'+s.name+' ('+s.poste+')</option>';
  });
  sel.innerHTML = opts;
}

function openNewMessage(){
  buildMessageRecipients();
  document.getElementById('msg-content').value='';
  document.querySelector('input[name="msg-priority"][value="normal"]').checked=true;
  openModal('modal-message');
}
async function saveMessage(){
  const content=document.getElementById('msg-content').value.trim();
  if(!content){showToast('Écrivez un message');return;}
  const to=document.getElementById('msg-to').value;
  const priority=document.querySelector('input[name="msg-priority"]:checked')?.value||'normal';
  await addDoc(COL.messages(),{
    from:currentUser.id, to, content, priority,
    read:false, archived:false, deleted:false, replies:[],
    createdAt:serverTimestamp()
  });
  closeModal('modal-message');
  showToast(to==='all'?'Message envoyé à toute l\'équipe ✓':'Message envoyé ✓');
}
async function markMsgRead(id){await updateDoc(doc(db,'messages',id),{read:true});}
async function archiveMsg(id){await updateDoc(doc(db,'messages',id),{archived:true});showToast('Archivé');}
async function deleteMsg(id){
  if(!confirm('Supprimer ce message ? Il restera dans l\'historique.')) return;
  await updateDoc(doc(db,'messages',id),{deleted:true});
  // Garder trace dans historique
  const m=DB.messages.find(x=>x.id===id);
  if(m) await addDoc(COL.history(),{type:'message',title:(m.content||'').slice(0,60),from:currentUser.id,doneAt:serverTimestamp()});
  showToast('Message supprimé');
}
function openReply(msgId,collName){const coll=collName==='staffMessages'?DB.staffMessages:DB.messages;const m=coll.find(x=>x.id===msgId);if(!m)return;document.getElementById('reply-to-id').value=msgId;document.getElementById('reply-collection').value=collName||'messages';document.getElementById('reply-original').innerHTML=`<strong>${getUserLabel(m.from)}</strong> : ${escHtml((m.content||'').slice(0,80))}`;document.getElementById('reply-content').value='';openModal('modal-reply');}
async function sendReply(){const content=document.getElementById('reply-content').value.trim();const msgId=document.getElementById('reply-to-id').value;const collName=document.getElementById('reply-collection').value||'messages';if(!content){showToast('Écrivez une réponse');return;}const coll=collName==='staffMessages'?DB.staffMessages:DB.messages;const m=coll.find(x=>x.id===msgId);if(!m)return;const replies=[...(m.replies||[]),{from:currentUser.id,content,createdAt:new Date().toISOString()}];await updateDoc(doc(db,collName,msgId),{replies,read:true});closeModal('modal-reply');showToast('Réponse envoyée ✓');}
function updateMsgBadge(){const unread=DB.messages.filter(m=>!m.read&&!m.archived&&!m.deleted&&(m.to===currentUser?.id||m.to==='all')).length;const badge=document.getElementById('msg-badge');if(!badge)return;if(unread>0){badge.textContent=unread;badge.classList.remove('hidden');}else badge.classList.add('hidden');}

// ============================================================
// TÂCHES
// ============================================================

function renderTasks(){
  let tasks=[...DB.tasks];
  if(currentTaskFilter==='today') tasks=tasks.filter(isTaskToday);
  else if(currentTaskFilter==='urgent') tasks=tasks.filter(t=>t.priority==='urgent');
  else if(currentTaskFilter==='mine') tasks=tasks.filter(t=>t.assignee===currentUser.id||t.assignee==='both');
  tasks.sort((a,b)=>{if(a.priority==='urgent'&&b.priority!=='urgent')return -1;if(b.priority==='urgent'&&a.priority!=='urgent')return 1;return(a.time||'99:99').localeCompare(b.time||'99:99');});
  const el=document.getElementById('tasks-list');if(!el)return;
  if(!tasks.length){el.innerHTML='<div class="empty-state-sm" style="padding:20px;text-align:center">Aucune tâche</div>';return;}
  el.innerHTML=tasks.map(t=>`<div class="task-item ${t.status==='done'?'done':''}">
    <button class="task-checkbox ${t.status==='done'?'checked':''} ${t.priority==='urgent'?'urgent-cb':''}" onclick="toggleTask('${t.id}')">
      ${t.status==='done'?'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>':''}
    </button>
    <div class="task-content">
      <div class="task-title-row">
        <span class="task-title ${t.status==='done'?'done-text':''}">${escHtml(t.title)}</span>
        ${t.priority!=='normal'?`<span class="task-badge badge-${t.priority}">${getPriorityLabel(t.priority)}</span>`:''}
        ${t.freq!=='once'?`<span class="task-badge badge-${t.freq}">${getFreqLabel(t.freq)}</span>`:''}
      </div>
      ${t.desc?`<div class="task-desc">${escHtml(t.desc)}</div>`:''}
      <div class="task-meta">
        <span class="task-meta-item">👤 ${getUserLabel(t.assignee)}</span>
        ${t.time?`<span class="task-meta-item">⏰ ${t.time}</span>`:''}
        ${t.status==='done'&&t.doneBy?`<span class="task-meta-item">✓ ${getUserLabel(t.doneBy)}</span>`:''}
      </div>
      ${t.link?`<a class="task-link" href="${t.link}" target="_blank">↗ Ouvrir le lien</a>`:''}
    </div>
    <button class="task-delete" onclick="deleteTask('${t.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg></button>
  </div>`).join('');
}
function filterTasks(f,btn){document.querySelectorAll('#page-tasks .filter-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');currentTaskFilter=f;renderTasks();}
async function toggleTask(id){const t=DB.tasks.find(x=>x.id===id);if(!t)return;if(t.status==='done'){await updateDoc(doc(db,'tasks',id),{status:'todo',doneAt:null,doneBy:null});}else{await updateDoc(doc(db,'tasks',id),{status:'done',doneAt:new Date().toISOString(),doneBy:currentUser.id});await addDoc(COL.history(),{type:'task',title:t.title,from:currentUser.id,doneAt:serverTimestamp()});}}
function quickToggleTask(id){toggleTask(id);}
async function deleteTask(id){if(!confirm('Supprimer ?'))return;await deleteDoc(doc(db,'tasks',id));showToast('Supprimée');}
function openNewTask(){['task-title','task-desc','task-time','task-link'].forEach(id=>document.getElementById(id).value='');document.getElementById('task-assignee').value=currentUser.id;document.getElementById('task-priority').value='normal';document.getElementById('task-freq').value='once';document.getElementById('task-day-group').style.display='none';openModal('modal-task');}
function toggleDayPicker(){document.getElementById('task-day-group').style.display=(['weekly','monthly'].includes(document.getElementById('task-freq').value))?'block':'none';}
async function saveTask(){const title=document.getElementById('task-title').value.trim();if(!title){showToast('Donnez un titre');return;}await addDoc(COL.tasks(),{title,desc:document.getElementById('task-desc').value.trim(),assignee:document.getElementById('task-assignee').value,priority:document.getElementById('task-priority').value,freq:document.getElementById('task-freq').value,day:document.getElementById('task-day').value,time:document.getElementById('task-time').value,link:document.getElementById('task-link').value.trim(),status:'todo',createdAt:serverTimestamp(),createdBy:currentUser.id});closeModal('modal-task');showToast('Tâche créée ✓');}

// ============================================================
// RAPPELS
// ============================================================

function openNewReminder(){['reminder-title','reminder-note'].forEach(id=>document.getElementById(id).value='');document.getElementById('reminder-date').value=todayStr();document.getElementById('reminder-time').value='';document.getElementById('reminder-freq').value='once';openModal('modal-reminder');}
async function saveReminder(){const title=document.getElementById('reminder-title').value.trim();if(!title){showToast('Donnez un titre');return;}await addDoc(COL.reminders(),{title,date:document.getElementById('reminder-date').value,time:document.getElementById('reminder-time').value,freq:document.getElementById('reminder-freq').value,note:document.getElementById('reminder-note').value.trim(),done:false,createdAt:serverTimestamp(),createdBy:currentUser.id});closeModal('modal-reminder');showToast('Rappel créé ✓');}
async function markReminderDone(id){const r=DB.reminders.find(x=>x.id===id);if(!r)return;await updateDoc(doc(db,'reminders',id),{done:true,doneAt:new Date().toISOString(),doneBy:currentUser.id});await addDoc(COL.history(),{type:'reminder',title:r.title,from:currentUser.id,doneAt:serverTimestamp()});}
let lastNotifSent={};
function checkReminders(){const today=todayStr(),nowTime=new Date();const due=DB.reminders.filter(r=>{if(r.done)return false;if(r.freq==='once'&&r.date!==today)return false;if(!r.time)return false;const[h,m]=r.time.split(':').map(Number);return nowTime.getHours()>=h&&(nowTime.getHours()>h||nowTime.getMinutes()>=m);});const dot=document.getElementById('notif-dot');if(due.length>0){dot?.classList.remove('hidden');due.forEach(r=>{if(!lastNotifSent[r.id]&&'Notification'in window&&Notification.permission==='granted'){new Notification('⏰ L\'Ormeau',{body:r.title,icon:'./icon-192.png'});lastNotifSent[r.id]=true;}});}else dot?.classList.add('hidden');renderNotifPanel(due);}
function renderNotifPanel(due){const el=document.getElementById('notif-panel-list');if(!el)return;if(!due||!due.length){el.innerHTML='<div style="padding:16px;color:var(--gray);font-size:13px">Aucun rappel</div>';return;}el.innerHTML=due.map(r=>`<div class="notif-panel-item"><div class="notif-time">⏰ ${r.time}</div><div class="notif-text">${escHtml(r.title)}</div>${r.note?`<div style="font-size:12px;color:var(--gray)">${escHtml(r.note)}</div>`:''}<button onclick="markReminderDone('${r.id}')" style="margin-top:6px;font-size:12px;color:var(--green-mid);font-weight:600">Marquer fait ✓</button></div>`).join('');}
function toggleNotifPanel(){document.getElementById('notif-panel').classList.toggle('hidden');}
function closeNotifPanel(){document.getElementById('notif-panel').classList.add('hidden');}

// ============================================================
// FOURNISSEURS
// ============================================================

async function initDefaultSuppliers(){const d=[{name:'Covadis',desc:'Boissons, épicerie, hygiène',url:'https://www.covadis.fr',days:'Lun, Mer, Ven',assignee:'jb',category:'fournisseurs'},{name:'Fruits & Légumes',desc:'Marché local',url:'#',days:'Mar, Jeu',assignee:'yohann',category:'fournisseurs'},{name:'Boucherie',desc:'Viandes et charcuteries',url:'#',days:'Lun, Mer',assignee:'yohann',category:'fournisseurs'},{name:'Poissonnerie',desc:'Poissons et fruits de mer',url:'#',days:'Mer, Sam',assignee:'yohann',category:'fournisseurs'},{name:'Logiciel caisse',desc:'Support & administration',url:'#',days:'',assignee:'jb',category:'direction'},{name:'Documents RH',desc:'Drive partagé direction',url:'#',days:'',assignee:'both',category:'documents'}];for(const s of d) await addDoc(COL.suppliers(),{...s,createdAt:serverTimestamp()});}
function renderSuppliers(){
  let sups=[...DB.suppliers];
  if(currentSupFilter!=='all')sups=sups.filter(s=>s.category===currentSupFilter);
  const el=document.getElementById('suppliers-list');if(!el)return;
  if(!sups.length){el.innerHTML='<div class="empty-state-sm" style="padding:20px;text-align:center">Aucun lien</div>';return;}
  el.innerHTML=sups.map(s=>{
    const isWA=s.url?.includes('wa.me')||s.url?.includes('whatsapp');
    const isDoc=s.category==='documents';
    return '<div class="supplier-item">'
      +'<div class="supplier-icon '+(isWA?'whatsapp':isDoc?'doc':'')+'">'+(isWA?'💬':isDoc?'📄':s.name.charAt(0).toUpperCase())+'</div>'
      +'<div class="supplier-info">'
        +'<div class="supplier-name">'+escHtml(s.name)+'</div>'
        +(s.desc?'<div class="supplier-desc">'+escHtml(s.desc)+'</div>':'')
        +'<div class="supplier-meta">'
          +'<span class="sup-tag">👤 '+getUserLabel(s.assignee)+'</span>'
          +(s.days?'<span class="sup-tag day-tag">📅 '+escHtml(s.days)+'</span>':'')
          +(s.category!=='fournisseurs'?'<span class="sup-tag cat-'+s.category+'">'+(s.category==='direction'?'Direction':'Document')+'</span>':'')
        +'</div>'
      +'</div>'
      +(s.url&&s.url!=='#'?'<a class="supplier-link" href="'+s.url+'" target="_blank"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>':'')
      +'<div style="display:flex;flex-direction:column;gap:4px">'
        +'<button class="msg-action-btn" onclick="openEditSupplier(\''+s.id+'\')">✏</button>'
        +'<button class="supplier-delete" onclick="deleteSupplier(\''+s.id+'\')">✕</button>'
      +'</div>'
    +'</div>';
  }).join('');
}

function openEditSupplier(id) {
  const s=DB.suppliers.find(x=>x.id===id); if(!s) return;
  document.getElementById('edit-sup-id').value=id;
  document.getElementById('edit-sup-name').value=s.name||'';
  document.getElementById('edit-sup-desc').value=s.desc||'';
  document.getElementById('edit-sup-url').value=s.url||'';
  document.getElementById('edit-sup-days').value=s.days||'';
  document.getElementById('edit-sup-assignee').value=s.assignee||'jb';
  document.getElementById('edit-sup-category').value=s.category||'fournisseurs';
  openModal('modal-edit-supplier');
}

async function saveEditSupplier() {
  const id=document.getElementById('edit-sup-id').value;
  const name=document.getElementById('edit-sup-name').value.trim();
  if(!name){showToast('Donnez un nom');return;}
  await updateDoc(doc(db,'suppliers',id),{
    name,
    desc:document.getElementById('edit-sup-desc').value.trim(),
    url:document.getElementById('edit-sup-url').value.trim(),
    days:document.getElementById('edit-sup-days').value.trim(),
    assignee:document.getElementById('edit-sup-assignee').value,
    category:document.getElementById('edit-sup-category').value,
    updatedAt:serverTimestamp()
  });
  closeModal('modal-edit-supplier');
  showToast('Lien mis à jour ✓');
}

function filterSuppliers(f,btn){document.querySelectorAll('#page-suppliers .filter-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');currentSupFilter=f;renderSuppliers();}
function openNewSupplier(){['sup-name','sup-desc','sup-url','sup-days'].forEach(id=>document.getElementById(id).value='');document.getElementById('sup-assignee').value='jb';document.getElementById('sup-category').value='fournisseurs';openModal('modal-supplier');}
async function saveSupplier(){const name=document.getElementById('sup-name').value.trim();const url=document.getElementById('sup-url').value.trim();if(!name){showToast('Donnez un nom');return;}if(!url){showToast('Ajoutez une URL');return;}await addDoc(COL.suppliers(),{name,url,desc:document.getElementById('sup-desc').value.trim(),days:document.getElementById('sup-days').value.trim(),assignee:document.getElementById('sup-assignee').value,category:document.getElementById('sup-category').value,createdAt:serverTimestamp()});closeModal('modal-supplier');showToast('Lien ajouté ✓');}
async function deleteSupplier(id){if(!confirm('Supprimer ?'))return;await deleteDoc(doc(db,'suppliers',id));showToast('Supprimé');}

// ============================================================
// STAFF SECTION (direction)
// ============================================================

function renderStaffSection(){const el=document.getElementById('staff-list');if(!el)return;if(currentStaffFilter==='requests')renderStaffRequests(el);else if(currentStaffFilter==='planning')renderPlanningEditor(el);else if(currentStaffFilter==='checklists')renderStaffChecklists(el);else if(currentStaffFilter==='equipe')renderEquipeManagement(el);}
function filterStaff(f,btn){document.querySelectorAll('#page-staff .filter-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');currentStaffFilter=f;renderStaffSection();}
function updateStaffBadge(){const unread=DB.staffMessages.filter(m=>!m.read&&!m.archived).length;const badge=document.getElementById('staff-badge');if(!badge)return;if(unread>0){badge.textContent=unread;badge.classList.remove('hidden');}else badge.classList.add('hidden');}

function renderStaffRequests(el){
  const msgs=[...DB.staffMessages].filter(m=>!m.archived&&!m.deleted).reverse();
  if(!msgs.length){el.innerHTML='<div class="empty-state-sm" style="padding:20px;text-align:center">Aucune requête</div>';return;}
  el.innerHTML=msgs.map(m=>`<div class="request-item ${m.type==='problem'?'problem':m.type==='info'?'info':''}">
    <div class="request-header">
      <span class="request-name">${getUserLabel(m.from)}</span>
      <span class="request-type-badge badge-${m.type}">${m.type==='request'?'Requête':m.type==='problem'?'Problème':m.type==='passation'?'Passation':'Info'}</span>
      ${!m.read?'<span class="msg-badge unread">Nouveau</span>':''}
    </div>
    <div class="request-text" style="white-space:pre-wrap">${escHtml(m.content)}</div>
    ${(m.replies||[]).length?'<div class="reply-thread">'+m.replies.map(r=>'<div class="reply-item"><div class="reply-meta">'+getUserLabel(r.from)+' · '+formatDateTime(r.createdAt)+'</div>'+escHtml(r.content)+'</div>').join('')+'</div>':''}
    <div class="request-actions">
      <button class="msg-action-btn" onclick="openReply('${m.id}','staffMessages')">↩ Répondre</button>
      ${!m.read?`<button class="msg-action-btn validate" onclick="markStaffMsgRead('${m.id}')">✓ Lu</button>`:''}
      <button class="msg-action-btn archive" onclick="archiveStaffMsg('${m.id}')">Archiver</button>
      <button class="msg-action-btn archive" onclick="deleteStaffMsg('${m.id}')">🗑 Supprimer</button>
    </div>
    <div class="request-time">${formatDateTime(m.createdAt)}</div>
  </div>`).join('');
}


// ============================================================
// ÉDITION PROFIL EMPLOYÉ
// ============================================================

async function openEditUser(userId) {
  if(!currentUser?.isDirection){showToast('Accès direction uniquement');return;}
  const s=dynamicStaff.find(x=>x.id===userId); if(!s) return;
  document.getElementById('edit-user-id').value=userId;
  document.getElementById('edit-user-name').value=s.name;
  document.getElementById('edit-user-poste').value=s.poste||'Salle';
  const dayOrder=[1,2,3,4,5,6,0];
  const planDiv=document.getElementById('edit-user-planning');
  planDiv.innerHTML=dayOrder.map(d=>{
    const cur=s.planning?.[String(d)]||'Off';
    const opts=SHIFTS.map(sh=>'<option value="'+sh+'"'+(cur===sh?' selected':'')+'>'+sh+'</option>').join('');
    return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span style="font-size:12px;font-weight:600;min-width:36px;color:var(--gray)">'+DAYS_SHORT[d]+'</span><select id="edit-plan-'+d+'" style="flex:1;padding:8px;background:var(--cream);border-radius:6px;font-size:13px;border:1px solid var(--cream-dark)">'+opts+'</select></div>';
  }).join('');
  const pwdEl=document.getElementById('edit-user-pwd-status');
  try {
    const d=await getDoc(doc(db,'users',userId));
    const ok=d.exists()&&d.data().passwordHash;
    pwdEl.textContent=ok?'✓ Mot de passe défini':'⚠ Pas encore de mot de passe';
    pwdEl.style.color=ok?'var(--green-mid)':'var(--orange)';
  } catch(e){pwdEl.textContent='Statut inconnu';}
  openModal('modal-edit-user');
}

async function saveEditUser() {
  const userId=document.getElementById('edit-user-id').value;
  const name=document.getElementById('edit-user-name').value.trim();
  const poste=document.getElementById('edit-user-poste').value;
  if(!name){showToast('Donnez un prénom');return;}
  const planning={};
  [0,1,2,3,4,5,6].forEach(d=>{planning[String(d)]=document.getElementById('edit-plan-'+d)?.value||'Off';});
  await updateDoc(doc(db,'staffProfiles',userId),{name,poste,initials:getInitials(name),planning,updatedAt:serverTimestamp()});
  const updates={};
  Object.keys(planning).forEach(d=>{updates[userId+'.'+d]=planning[d];});
  try{await updateDoc(doc(db,'weeklyPlanning',getWeekKey()),updates);}catch(e){}
  closeModal('modal-edit-user');showToast(name+' mis à jour ✓');
}

async function resetUserPassword() {
  const userId=document.getElementById('edit-user-id').value;
  if(!confirm('Réinitialiser le mot de passe ? L\'employé devra en créer un nouveau.')) return;
  await setDoc(doc(db,'users',userId),{passwordHash:null,updatedAt:serverTimestamp()},{merge:true});
  document.getElementById('edit-user-pwd-status').textContent='⚠ Réinitialisé';
  document.getElementById('edit-user-pwd-status').style.color='var(--orange)';
  showToast('Mot de passe réinitialisé ✓');
}

function renderEquipeManagement(el){
  let html='<button class="btn-primary" style="width:100%;margin-bottom:16px" onclick="openAddUser()">+ Ajouter un employé</button>';
  if(!dynamicStaff.length){el.innerHTML=html+'<div class="empty-state-sm" style="padding:20px;text-align:center">Aucun employé</div>';return;}
  html+=dynamicStaff.map(s=>{
    const shift=weeklyPlanDoc?.[s.id]?.[String(todayDay())]||'Off';
    return '<div class="staff-member-card">'
      +'<div class="staff-avatar">'+(s.initials||getInitials(s.name))+'</div>'
      +'<div class="staff-info">'
        +'<div class="staff-name">'+escHtml(s.name)+'</div>'
        +'<div class="staff-pos">'+escHtml(s.poste||'')+'</div>'
        +'<span class="planning-shift '+getShiftClass(shift)+'" style="font-size:11px;margin-top:4px;display:inline-block">'+shift+'</span>'
      +'</div>'
      +'<div style="display:flex;gap:6px;align-items:center">'
        +'<button class="msg-action-btn" onclick="openEditUser(\''+s.id+'\')">✏ Éditer</button>'
        +'<button class="supplier-delete" onclick="deleteStaffMember(\''+s.id+'\')">✕</button>'
      +'</div>'
    +'</div>';
  }).join('');
  el.innerHTML=html;
}

function renderStaffChecklists(el){const today=todayStr();const todayCLs=DB.checklists.filter(c=>c.date===today);if(!todayCLs.length){el.innerHTML='<div class="empty-state-sm" style="padding:20px;text-align:center">Aucune checklist soumise aujourd\'hui</div>';return;}el.innerHTML=todayCLs.map(c=>{const member=getAllUsers()[c.userId];const total=c.items?.length||0;const done=c.items?.filter(i=>i.done).length||0;return`<div class="staff-member-card"><div class="staff-avatar">${member?.initials||getInitials(member?.name||c.userId)}</div><div class="staff-info"><div class="staff-name">${member?.name||c.userId}</div><div class="staff-pos">${c.type} — ${done}/${total} tâches</div><div class="checklist-progress" style="margin-top:8px;margin-bottom:0"><div class="checklist-progress-bar" style="width:${total?Math.round(done/total*100):0}%"></div></div></div></div>`;}).join('');}

async function markStaffMsgRead(id){await updateDoc(doc(db,'staffMessages',id),{read:true});}
async function archiveStaffMsg(id){await updateDoc(doc(db,'staffMessages',id),{archived:true});showToast('Archivé');}
async function deleteStaffMsg(id){
  if(!confirm('Supprimer cette requête ?')) return;
  await updateDoc(doc(db,'staffMessages',id),{deleted:true,archived:true});
  showToast('Requête supprimée');
}

// ============================================================
// STAFF VUE EMPLOYÉ
// ============================================================

function openStaffMessage(){openModal('modal-staff-message');}
async function saveStaffMessage(){const content=document.getElementById('staff-msg-content').value.trim();if(!content){showToast('Écrivez un message');return;}const type=document.getElementById('staff-msg-type').value;await addDoc(COL.staffMessages(),{from:currentUser.id,content,type,read:false,archived:false,replies:[],createdAt:serverTimestamp()});closeModal('modal-staff-message');showToast('Message envoyé à la direction ✓');}
function renderStaffMessages(){const el=document.getElementById('staff-messages-list');if(!el)return;const myMsgs=[...DB.staffMessages].filter(m=>m.from===currentUser.id).reverse();if(!myMsgs.length){el.innerHTML='<div class="empty-state-sm" style="padding:20px;text-align:center">Aucun message envoyé</div>';return;}el.innerHTML=myMsgs.map(m=>`<div class="message-item ${m.type==='problem'?'urgent-msg':m.type==='request'?'staff-msg':''}"><div class="message-meta"><span class="msg-author">${getUserLabel(m.from)}</span><span style="font-size:12px;color:var(--gray)">→ Direction</span><span class="msg-time">${formatDateTime(m.createdAt)}</span><span class="msg-badge ${m.type}">${m.type==='request'?'Requête':m.type==='problem'?'Problème':m.type==='passation'?'Passation':'Info'}</span></div><div class="message-text" style="white-space:pre-wrap">${escHtml(m.content)}</div>${(m.replies||[]).length?`<div class="reply-thread">${(m.replies||[]).map(r=>`<div class="reply-item"><div class="reply-meta">${getUserLabel(r.from)} · ${formatDateTime(r.createdAt)}</div>${escHtml(r.content)}</div>`).join('')}</div>`:''}</div>`).join('');}
function renderStaffDirMessages(){const el=document.getElementById('staff-dir-messages');if(!el)return;const dirMsgs=[...DB.messages].filter(m=>m.to==='all'||m.to===currentUser.id).reverse().slice(0,5);if(!dirMsgs.length){el.innerHTML='<div class="empty-state-sm">Aucun message de la direction</div>';return;}el.innerHTML=dirMsgs.map(m=>`<div class="dash-msg-item"><div class="dash-msg-from">${getUserLabel(m.from)}</div><div class="dash-msg-text">${escHtml(m.content)}</div></div>`).join('');}

function renderFullPlanning(){
  const el=document.getElementById('full-planning-view');if(!el)return;
  const today=todayDay();const weekDates=getWeekDates();const dayOrder=[1,2,3,4,5,6,0];
  let html='<div style="font-size:12px;color:var(--gray);margin-bottom:12px">Semaine du '+weekDates[0].getDate()+' '+MONTHS_FR[weekDates[0].getMonth()]+'</div>';
  html+='<div style="overflow-x:auto"><table class="planning-full-table"><thead><tr><th>Nom</th>';
  dayOrder.forEach((d,i)=>html+=`<th style="${d===today?'color:var(--green-dark)':''}"><div>${DAYS_SHORT[d]}</div><div style="font-weight:300;font-size:10px">${weekDates[i].getDate()}/${weekDates[i].getMonth()+1}</div></th>`);
  html+='</tr></thead><tbody>';
  dynamicStaff.forEach(s=>{html+=`<tr><td class="staff-name-cell">${s.name}<div class="staff-role-cell">${s.poste||''}</div></td>`;dayOrder.forEach(d=>{const sh=weeklyPlanDoc?.[s.id]?.[String(d)]||'Off';html+=`<td><span class="planning-shift ${getShiftClass(sh)}" style="font-size:11px">${sh}</span></td>`;});html+='</tr>';});
  html+='</tbody></table></div>';el.innerHTML=html;
}

// ============================================================
// CHECKLISTS
// ============================================================

function renderChecklist(filter){
  if(filter) currentCheckFilter=filter;
  const cl=CHECKLISTS[currentCheckFilter];
  const el=document.getElementById('checklist-list');
  const pf=document.getElementById('passation-form');
  if(!el)return;
  if(currentCheckFilter==='passation'){el.innerHTML='';pf?.classList.remove('hidden');return;}
  pf?.classList.add('hidden');
  if(!cl){el.innerHTML='';return;}

  const today=todayStr();
  const amChef=isChefForRole(currentCheckFilter);
  const todayRoles=getTodayRoles();
  const chefUserId=todayRoles[currentCheckFilter];

  // Récupérer tous les items cochés aujourd'hui pour ce type (tous les utilisateurs)
  const sharedItems=DB.checklistItems?.filter(i=>i.date===today&&i.type===currentCheckFilter)||[];
  // Fallback sur ancienne méthode
  const allChecked={};
  DB.checklists.filter(c=>c.date===today&&c.type===currentCheckFilter).forEach(c=>{
    (c.items||[]).forEach(i=>{
      if(i.done) allChecked[i.key]={doneBy:i.doneBy,doneAt:i.doneAt||null};
    });
  });
  sharedItems.forEach(i=>{ if(i.done) allChecked[i.key]={doneBy:i.doneBy,doneAt:i.doneAt}; });

  let total=0,done=0,html='';

  // Badge chef
  if(amChef) {
    const role=SHIFT_ROLES.find(r=>r.id===currentCheckFilter);
    html+=`<div style="background:var(--gold);color:var(--green-dark);border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:13px;font-weight:600;text-align:center">👑 Vous êtes chef — ${role?.label||''}</div>`;
  } else if(chefUserId) {
    html+=`<div style="background:var(--cream-dark);border-radius:10px;padding:8px 14px;margin-bottom:14px;font-size:12px;color:var(--gray);text-align:center">Chef : ${getUserLabel(chefUserId)}</div>`;
  }

  cl.sections.forEach(sec=>{
    html+=`<div class="checklist-section"><div class="checklist-section-title">${sec.title}</div>`;
    sec.items.forEach((item,idx)=>{
      const key=`${sec.title}-${idx}`;
      const itemData=allChecked[key];
      const isDone=!!itemData;
      const doneBy=itemData?.doneBy||null;
      const doneAt=itemData?.doneAt||null;
      total++;if(isDone)done++;
      const timeStr=doneAt?new Date(doneAt).getHours()+':'+String(new Date(doneAt).getMinutes()).padStart(2,'0'):'';
      html+=`<div class="checklist-item ${isDone?'done':''}">
        <button class="checklist-cb ${isDone?'checked':''}" onclick="toggleChecklistItem('${key}','${currentCheckFilter}')">
          ${isDone?'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>':''}
        </button>
        <div style="flex:1">
          <span class="checklist-text ${isDone?'done':''}">${escHtml(item)}</span>
          ${isDone&&doneBy?`<div style="font-size:11px;color:var(--green-mid);margin-top:2px">✓ ${getUserLabel(doneBy)}${timeStr?' · '+timeStr:''}</div>`:''}
        </div>
        ${amChef&&isDone?`<button onclick="toggleChecklistItem('${key}','${currentCheckFilter}')" style="font-size:11px;color:var(--gray);padding:2px 6px;background:var(--cream-dark);border-radius:4px">✕</button>`:''}
      </div>`;
    });
    html+='</div>';
  });

  // Bouton validation chef
  if(amChef) {
    const pct=total?Math.round(done/total*100):0;
    html+=`<div style="margin-top:16px">
      <button class="btn-primary" style="width:100%;background:${pct===100?'var(--gold)':'var(--green-mid)'};color:${pct===100?'var(--green-dark)':'white'}" onclick="validateShiftAsChef('${currentCheckFilter}')">
        👑 ${pct===100?'Valider et envoyer le rapport':'Envoyer rapport ('+done+'/'+total+')'}
      </button>
    </div>`;
  }

  el.innerHTML=`<div class="checklist-progress"><div class="checklist-progress-bar" style="width:${total?Math.round(done/total*100):0}%"></div></div>
    <div style="font-size:12px;color:var(--gray);margin-bottom:14px;text-align:center">${done} / ${total} tâches · ${total?Math.round(done/total*100):0}%</div>${html}`;
}

async function toggleChecklistItem(key,type){
  const today=todayStr();
  const itemId=today+'-'+type+'-'+key;
  // Chercher si cet item existe déjà (partagé entre tous)
  const existing=DB.checklistItems?.find(i=>i.itemId===itemId);
  if(existing) {
    const isDone=!existing.done;
    await updateDoc(doc(db,'checklistItems',existing.id),{
      done:isDone,
      doneBy:isDone?currentUser.id:null,
      doneAt:isDone?new Date().toISOString():null,
      updatedAt:serverTimestamp()
    });
  } else {
    await addDoc(COL.checklistItems(),{
      itemId, key, type, date:today,
      done:true, doneBy:currentUser.id,
      doneAt:new Date().toISOString(),
      createdAt:serverTimestamp()
    });
  }
  // Aussi sauvegarder dans l'ancienne collection pour compatibilité
  const oldExisting=DB.checklists.find(c=>c.userId===currentUser.id&&c.date===today&&c.type===type);
  let items=oldExisting?.items?JSON.parse(JSON.stringify(oldExisting.items)):[];
  const idx=items.findIndex(i=>i.key===key);
  if(idx>=0){items[idx].done=!items[idx].done;if(items[idx].done)items[idx].doneBy=currentUser.id;}
  else items.push({key,done:true,doneBy:currentUser.id,doneAt:new Date().toISOString()});
  if(oldExisting)await updateDoc(doc(db,'checklists',oldExisting.id),{items,updatedAt:serverTimestamp()});
  else await addDoc(COL.checklists(),{userId:currentUser.id,date:today,type,items,createdAt:serverTimestamp()});
}
async function validateShiftAsChef(roleId) {
  const role=SHIFT_ROLES.find(r=>r.id===(roleId||currentCheckFilter));
  const today=todayStr();
  const sharedItems=DB.checklistItems?.filter(i=>i.date===today&&i.type===(roleId||currentCheckFilter))||[];
  const cl=CHECKLISTS[roleId||currentCheckFilter];
  let rapport='👑 RAPPORT '+( role?.label||'').toUpperCase()+'\n';
  rapport+='Date : '+today+'\n';
  rapport+='Chef : '+currentUser.name+'\n\n';

  // Résumé par section
  cl?.sections.forEach(sec=>{
    rapport+=sec.title+' :\n';
    const allChecked={};
    DB.checklists.filter(c=>c.date===today&&c.type===(roleId||currentCheckFilter)).forEach(c=>{
      (c.items||[]).forEach(i=>{if(i.done)allChecked[i.key]={doneBy:i.doneBy,doneAt:i.doneAt};});
    });
    sharedItems.forEach(i=>{if(i.done)allChecked[i.key]={doneBy:i.doneBy,doneAt:i.doneAt};});
    sec.items.forEach((item,idx)=>{
      const key=sec.title+'-'+idx;
      const d=allChecked[key];
      const time=d?.doneAt?new Date(d.doneAt).getHours()+':'+String(new Date(d.doneAt).getMinutes()).padStart(2,'0'):'';
      rapport+=(d?'  ✓ ':'  ○ ')+item+(d?' — '+getUserLabel(d.doneBy)+(time?' à '+time:''):'')+' \n';
    });
    rapport+='\n';
  });

  await addDoc(COL.staffMessages(),{
    from:currentUser.id,
    content:rapport,
    type:'passation',
    roleId:roleId||currentCheckFilter,
    read:false,archived:false,deleted:false,replies:[],
    createdAt:serverTimestamp()
  });

  // Sauvegarder dans dailyReports
  await addDoc(COL.dailyReports(),{
    date:today, roleId:roleId||currentCheckFilter,
    chefId:currentUser.id, rapport,
    validatedAt:serverTimestamp()
  });

  showToast('Rapport envoyé à la direction ✓');
}
function renderStaffTodayChecklist(){const el=document.getElementById('staff-today-checklist');if(!el)return;const shift=getTodayShiftFromPlan(currentUser.id);const type=shift==='Matin'?'matin-ouverture':shift==='Soir'?'soir-ouverture':null;if(!type||shift==='Off'){el.innerHTML='<div class="empty-state-sm">Pas de checklist pour ce shift</div>';return;}const cl=CHECKLISTS[type];if(!cl){el.innerHTML='';return;}const today=todayStr();const existing=DB.checklists.find(c=>c.userId===currentUser.id&&c.date===today&&c.type===type);const checkedItems=existing?.items||[];let total=0,done=0;cl.sections.forEach(s=>s.items.forEach((_,i)=>{total++;if(checkedItems.find(ci=>ci.key===`${s.title}-${i}`)?.done)done++;}));el.innerHTML=`<div class="checklist-progress"><div class="checklist-progress-bar" style="width:${total?Math.round(done/total*100):0}%"></div></div><div style="font-size:13px;color:var(--gray);text-align:center;margin-top:8px">${done} / ${total} — ${cl.label}</div>`;}
function filterChecklist(f,btn){document.querySelectorAll('#page-staff-checklist .filter-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');renderChecklist(f);}
async function submitPassation(){const msg=document.getElementById('passation-msg').value.trim();const tasks=document.getElementById('passation-tasks').value.trim();if(!msg){showToast('Ajoutez un message');return;}await addDoc(COL.staffMessages(),{from:currentUser.id,content:`📋 PASSATION\n${msg}${tasks?'\n\nTâches non faites :\n'+tasks:''}`,type:'passation',read:false,archived:false,replies:[],createdAt:serverTimestamp()});document.getElementById('passation-msg').value='';document.getElementById('passation-tasks').value='';showToast('Passation envoyée ✓');}


// ============================================================
// HISTORIQUE DIRECTION — navigation par jour
// ============================================================

let currentHistFilter = 'all';
let historyViewDate   = todayStr();

function renderHistory(filter) {
  if(!currentUser?.isDirection) return;
  if(filter) currentHistFilter=filter;
  const el=document.getElementById('history-list'); if(!el) return;

  // Navigation dates
  const navHtml=`<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;background:var(--white);border-radius:var(--radius-sm);padding:10px 14px;box-shadow:var(--shadow)">
    <button onclick="historyPrevDay()" style="font-size:20px;color:var(--green-mid);padding:4px 8px">←</button>
    <span style="font-size:14px;font-weight:600;color:var(--green-dark)">${formatHistDate(historyViewDate)}</span>
    <button onclick="historyNextDay()" style="font-size:20px;color:${historyViewDate===todayStr()?'var(--gray-light)':'var(--green-mid)'};padding:4px 8px" ${historyViewDate===todayStr()?'disabled':''}>→</button>
  </div>`;

  // Rapports du jour
  const reports=DB.dailyReports?.filter(r=>r.date===historyViewDate)||[];
  let reportHtml='';
  if(reports.length){
    reportHtml='<div class="card-section card-gold" style="margin-bottom:12px">'
      +'<div class="card-section-header gold"><span class="card-icon">👑</span><span class="card-title">Rapports du jour</span></div>';
    reports.forEach(r=>{
      const role=SHIFT_ROLES.find(x=>x.id===r.roleId);
      const t=r.validatedAt?.toDate?r.validatedAt.toDate():new Date(r.validatedAt||0);
      reportHtml+='<div style="padding:10px 0;border-bottom:1px solid var(--cream-dark)">'
        +'<div style="font-size:13px;font-weight:600;color:var(--green-dark)">'+(role?.label||r.roleId)+'</div>'
        +'<div style="font-size:12px;color:var(--gray)">Chef : '+getUserLabel(r.chefId)+' · '+pad(t.getHours())+':'+pad(t.getMinutes())+'</div>'
        +'<details style="margin-top:6px"><summary style="font-size:12px;color:var(--green-mid);cursor:pointer">Voir le rapport</summary>'
        +'<pre style="font-size:11px;color:var(--gray);white-space:pre-wrap;margin-top:6px;background:var(--cream);padding:8px;border-radius:6px">'+escHtml(r.rapport||'')+'</pre>'
        +'</details>'
      +'</div>';
    });
    reportHtml+='</div>';
  }

  // Tâches du jour
  let items=[...DB.history].filter(h=>{
    const d=h.doneAt?.toDate?h.doneAt.toDate():new Date(h.doneAt||0);
    return d.toISOString().startsWith(historyViewDate);
  });
  if(currentHistFilter==='tasks') items=items.filter(h=>h.type==='task');
  else if(currentHistFilter==='messages') items=items.filter(h=>h.type==='message');
  else if(currentHistFilter==='reminders') items=items.filter(h=>h.type==='reminder');
  else if(currentHistFilter==='checklist') items=items.filter(h=>h.type==='checklist');

  items.sort((a,b)=>{
    const ta=a.doneAt?.toDate?a.doneAt.toDate():new Date(a.doneAt||0);
    const tb=b.doneAt?.toDate?b.doneAt.toDate():new Date(b.doneAt||0);
    return tb-ta;
  });

  const icons={task:'✓',message:'✉',reminder:'⏰',checklist:'📋'};
  const colors={task:'#d1fae5',message:'#dbeafe',reminder:'#fce7f3',checklist:'#fef3c7'};
  const itemsHtml=items.length?items.map(h=>{
    const d=h.doneAt?.toDate?h.doneAt.toDate():new Date(h.doneAt||0);
    return '<div class="history-item">'
      +'<div class="history-icon" style="background:'+(colors[h.type]||'#e5e7eb')+'">'+(icons[h.type]||'·')+'</div>'
      +'<div class="history-info">'
        +'<div class="history-title">'+escHtml(h.title||'')+'</div>'
        +'<div class="history-meta">'+getUserLabel(h.from)+' · '+pad(d.getHours())+':'+pad(d.getMinutes())+'</div>'
      +'</div>'
    +'</div>';
  }).join(''):'<div class="empty-state-sm" style="padding:20px;text-align:center">Aucune activité ce jour</div>';

  el.innerHTML=navHtml+reportHtml+itemsHtml;
}

function formatHistDate(dateStr) {
  if(dateStr===todayStr()) return "Aujourd'hui";
  const d=new Date(dateStr+'T12:00:00');
  return DAYS_FR[d.getDay()]+' '+d.getDate()+' '+MONTHS_FR[d.getMonth()]+' '+d.getFullYear();
}

function historyPrevDay(){
  const d=new Date(historyViewDate+'T12:00:00');
  d.setDate(d.getDate()-1);
  historyViewDate=d.toISOString().slice(0,10);
  renderHistory();
}
function historyNextDay(){
  if(historyViewDate===todayStr()) return;
  const d=new Date(historyViewDate+'T12:00:00');
  d.setDate(d.getDate()+1);
  historyViewDate=d.toISOString().slice(0,10);
  renderHistory();
}

function filterHistory(filter,btn){
  document.querySelectorAll('#page-history .filter-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderHistory(filter);
}

// ============================================================
// MODALES / TOAST
// ============================================================

function openModal(id){document.getElementById(id).classList.remove('hidden');document.body.style.overflow='hidden';}
function closeModal(id){document.getElementById(id).classList.add('hidden');document.body.style.overflow='';}
let toastTimeout;
function showToast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.remove('hidden');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>t.classList.add('hidden'),2500);}

// ============================================================
// DÉMARRAGE
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
  // Afficher le loader pendant le chargement
  const userList = document.getElementById('user-list');
  if(userList) userList.innerHTML = '<div style="text-align:center;padding:20px;color:var(--gray);font-size:13px">Chargement...</div>';

  try {
    // Charger staff et planning
    await loadDynamicStaff();
    if(dynamicStaff.length===0) await initDefaultStaff();
    await loadWeeklyPlanning();
  } catch(e) {
    console.warn('Erreur chargement initial:', e);
  }

  // Construire la liste et tenter de restaurer la session
  buildUserList();

  if('serviceWorker'in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
  document.getElementById('pwd-enter')?.addEventListener('keydown',e=>{if(e.key==='Enter')checkPassword();});
  document.getElementById('pwd-confirm')?.addEventListener('keydown',e=>{if(e.key==='Enter')createPassword();});

  // Restaurer session en dernier
  await restoreSession();
});

Object.assign(window,{
  selectUser,backToStep1,createPassword,checkPassword,logout,showPage,
  openNewMessage,saveMessage,filterMessages:filterMessages,markMsgRead,archiveMsg,deleteMsg,openReply,sendReply,
  openNewTask,saveTask,filterTasks,toggleTask,quickToggleTask,deleteTask,toggleDayPicker,
  openNewReminder,saveReminder,markReminderDone,
  openNewSupplier,saveSupplier,deleteSupplier,filterSuppliers,
  filterStaff,markStaffMsgRead,archiveStaffMsg,
  openStaffMessage,saveStaffMessage,
  filterChecklist,toggleChecklistItem,submitPassation,validateShiftAsChef,
  openAssignChef,setChefDeShift,setChefRole,isAnyChef,isChefForRole,historyPrevDay,historyNextDay,validateShiftAsChef,
  openAddUser,saveNewUser,deleteStaffMember,openEditUser,saveEditUser,resetUserPassword,toggleNewUserRole,
  onShiftChange,
  openModal,closeModal,toggleNotifPanel,closeNotifPanel,renderHistory,filterHistory,openEditSupplier,saveEditSupplier,renderDashboardTeam,deleteStaffMsg,renderDashboard
});
