/* ระบบติดตามแผนงานโครงการ แผนแม่บทการบริหารจัดการทรัพยากรน้ำ ลุ่มน้ำปิง */
(function(){
'use strict';
const CFG = window.APP_CONFIG || {firebase:{}};
const DATA = (window.DATA_BASE || 'data/');
const STATUS_OPTS = ['เตรียมการ','กำลังดำเนินการ','โครงการต่อเนื่อง','แล้วเสร็จ'];
// ความหมายของสภาพพื้นที่ (กลุ่มพื้นที่) แต่ละรหัส ใช้ในฟอร์มเสนอโครงการและแบบฟอร์ม Excel
let GROUP_DESC = {};   // เงื่อนไขการจำแนกสภาพพื้นที่ โหลดจาก master.json (groupInfo)
const STAGES = [['เตรียมการ','#e2963a'],['กำลังดำเนินการ','#2c5ea5'],['โครงการต่อเนื่อง','#7b5ea7'],['แล้วเสร็จ','#2f8a54'],['ยังไม่ระบุ','#c3cbd8']];
const LEGACY = {'แนวคิดโครงการ':'เตรียมการ','ศึกษาความเหมาะสม':'เตรียมการ','สำรวจออกแบบ':'เตรียมการ','เสนอของบประมาณ':'เตรียมการ','ได้รับงบประมาณ':'เตรียมการ','อยู่ระหว่างดำเนินการ':'กำลังดำเนินการ','ดำเนินการแล้วเสร็จ':'แล้วเสร็จ'};
const stageOf = p => { const v = LEGACY[p.status] || p.status; return STATUS_OPTS.includes(v) ? v : 'ยังไม่ระบุ'; };
const SCOL = {1:'var(--s1)',2:'var(--s2)',3:'var(--s3)',4:'var(--s4)',5:'var(--s5)'};
const SHEX = {1:'#2f7fc1',2:'#4c9a56',3:'#d0862a',4:'#23938a',5:'#7656a8'};
const TGHEX = '#e07b39';
const PAGE = 40;

let M, T = {}, P = [], SEED = [], SUBS = [], REJ = [], AUDIT = [];
let IDX = {byTam:{}, byBasin:{}}, MEAS = {}, PROG = {}, STRAT = {}, BAS = {};
const S = {
  tab:'area', prov:null, amp:null, tam:null, basin:null,
  f:{q:'', s:new Set(), F:'', S:'', grp:'', src:'', stage:''},
  admin:false, user:null, seedFallback:false,
  adminTab:'pending', sel:new Set()
};
const $ = (s, el=document) => el.querySelector(s);
const $$ = (s, el=document) => [...el.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = n => (n==null||n==='') ? '–' : Number(n).toLocaleString('th-TH');
const LS = {
  get(k, d){ try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
};
const SESSION_DAYS = 30;
const Sess = {
  get(){ let v=null; try{ v = JSON.parse(localStorage.getItem('ping_session')||'null') || JSON.parse(sessionStorage.getItem('ping_session')||'null'); }catch(e){} if(v && v.exp && v.exp < Date.now()) { this.clear(); return null; } return v; },
  set(v, remember){ const rec = Object.assign({}, v, {exp: remember ? Date.now()+SESSION_DAYS*864e5 : null}); try{ (remember?localStorage:sessionStorage).setItem('ping_session', JSON.stringify(rec)); (remember?sessionStorage:localStorage).removeItem('ping_session'); }catch(e){} },
  clear(){ try{ localStorage.removeItem('ping_session'); sessionStorage.removeItem('ping_session'); }catch(e){} }
};
async function sha256(t){ const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)); return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join(''); }
function toast(msg){
  const el = document.createElement('div'); el.className='toast'; el.textContent=msg; document.body.appendChild(el);
  setTimeout(()=>el.remove(), 3200);
}
function normSub(o){ if(!o.grp && /^grp:/.test(o.ref||'')){ o.grp=o.ref.slice(4); o.ref=''; } return o; }
const tsOf = x => x?.seconds ? x.seconds*1000 : (typeof x==='number' ? x : (x ? Date.parse(x)||0 : 0));
function normProj(p){
  return Object.assign({id:'',seq:0,sb:'',ref:'',s:null,F:'',S:'',grp:'',title:'',detail:'',tambons:[],agency:'',budget:null,yearStart:null,yearEnd:null,status:'',note:'',src:'excel'}, p);
}

/* ================= STORE ================= */
const Store = {
  mode: (CFG.firebase && CFG.firebase.apiKey) ? 'firebase' : 'demo',
  db:null, auth:null, unsub:[],
  async init(){
    if(this.mode === 'firebase'){
      try{ await this.loadFirebase(); }catch(e){ console.error(e); this.mode='demo'; toast('เชื่อมต่อฐานข้อมูลออนไลน์ไม่ได้ ข้อมูลที่เพิ่มจะเก็บในเครื่องนี้ชั่วคราว'); }
    }
    if(this.mode === 'firebase') this.initFirebase(); else this.initDemo();
  },
  loadScript(src){ return new Promise((res, rej)=>{ const s=document.createElement('script'); s.src=src; s.onload=res; s.onerror=rej; document.head.appendChild(s); }); },
  async loadFirebase(){
    const b='https://cdn.jsdelivr.net/npm/firebase@10.12.2/';
    await this.loadScript(b+'firebase-app-compat.js');
    await this.loadScript(b+'firebase-auth-compat.js');
    await this.loadScript(b+'firebase-firestore-compat.js');
    firebase.initializeApp(CFG.firebase);
    this.db = firebase.firestore(); this.auth = firebase.auth();
  },
  /* ---- demo (เก็บในเบราว์เซอร์) ---- */
  initDemo(){
    const o = LS.get('ping_overrides', {edited:{}, added:[], deleted:[]});
    P = SEED.filter(p=>!o.deleted.includes(p.id)).map(p=> normProj(o.edited[p.id] || p)).concat(o.added.map(normProj));
    SUBS = LS.get('ping_subs', []).filter(s=>s.review==='pending');
    REJ = LS.get('ping_subs', []).filter(s=>s.review==='rejected').sort((a,b)=>tsOf(b.reviewedAt)-tsOf(a.reviewedAt));
    AUDIT = LS.get('ping_audit', []);
    const ss = Sess.get(); if(ss && ss.role==='admin'){ S.admin=true; S.user={email: ss.name || 'ผู้ดูแลระบบ'}; }
    onData();
  },
  demoSave(fn){ const o = LS.get('ping_overrides', {edited:{}, added:[], deleted:[]}); fn(o); LS.set('ping_overrides', o); this.initDemo(); },
  demoAudit(action, id, detail){ const a = LS.get('ping_audit', []); a.unshift({ts:Date.now(), by:S.user?.email||'-', action, id, detail}); LS.set('ping_audit', a.slice(0,200)); },
  /* ---- firebase ---- */
  initFirebase(){
    this.db.collection('projects').onSnapshot(snap=>{
      if(snap.empty){ P = SEED.map(normProj); S.seedFallback = true; }
      else { P = snap.docs.map(d=>normProj(d.data())); S.seedFallback = false; }
      onData();
    }, err=>{ console.error(err); toast('อ่านข้อมูลโครงการไม่ได้: '+err.message); P = SEED.map(normProj); S.seedFallback=true; onData(); });
    this.auth.onAuthStateChanged(async u=>{
      this.unsub.forEach(f=>f()); this.unsub=[]; SUBS=[]; AUDIT=[];
      S.user = u ? {email:u.email, uid:u.uid} : null; S.admin=false;
      if(u){
        // ตรวจสิทธิ์ตามกฎ Firestore จริง: อ่านกล่องรอพิจารณาได้ = เป็นผู้ดูแล
        try{ await this.db.collection('submissions').limit(1).get(); S.admin = true; }catch(e){ S.admin=false; S.permErr = e.code||e.message; }
        if(!S.admin){ toast('บัญชีนี้ยังไม่ได้รับสิทธิ์ผู้ดูแลระบบ'); }
        else {
          this.unsub.push(this.db.collection('submissions').where('review','==','pending').onSnapshot(s=>{ SUBS = s.docs.map(d=>normSub(Object.assign({_id:d.id}, d.data()))).sort((a,b)=>tsOf(b.createdAt)-tsOf(a.createdAt)); renderHeader(); if(S.tab==='admin') renderView(); }));
          this.unsub.push(this.db.collection('submissions').where('review','==','rejected').onSnapshot(s=>{ REJ = s.docs.map(d=>normSub(Object.assign({_id:d.id}, d.data()))).sort((a,b)=>tsOf(b.reviewedAt)-tsOf(a.reviewedAt)); if(S.tab==='admin') renderView(); }));
          this.unsub.push(this.db.collection('audit').orderBy('ts','desc').limit(60).onSnapshot(s=>{ AUDIT = s.docs.map(d=>d.data()); if(S.tab==='admin') renderView(); }));
        }
      }
      renderHeader(); renderView();
    });
  },
  /* ---- actions ---- */
  async login(email, pass, remember){
    if(this.mode==='demo'){
      if(await sha256(pass) === CFG.adminCodeHash){ S.admin=true; S.user={email:email||'ผู้ดูแลระบบ'}; renderHeader(); renderView(); return; }
      throw new Error('รหัสผู้ดูแลไม่ถูกต้อง');
    }
    await this.auth.setPersistence(remember===false ? firebase.auth.Auth.Persistence.SESSION : firebase.auth.Auth.Persistence.LOCAL);
    await this.auth.signInWithEmailAndPassword(email || CFG.adminEmail, pass);
  },
  async logout(){ if(this.mode==='demo'){ S.admin=false; S.user=null; renderHeader(); renderView(); return; } await this.auth.signOut(); },
  async resetPassword(email){ if(this.mode==='demo') throw new Error('โหมดทดลองไม่มีระบบรีเซ็ตรหัสผ่าน'); await this.auth.sendPasswordResetEmail(email); },
  async submit(data){
    const rec = Object.assign({}, data, {review:'pending'});
    if(this.mode==='demo'){
      rec._id = 'S'+Date.now(); rec.createdAt = {seconds: Math.floor(Date.now()/1000)};
      const a = LS.get('ping_subs', []); a.unshift(rec); LS.set('ping_subs', a); SUBS = a.filter(s=>s.review==='pending'); renderHeader(); return;
    }
    rec.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    try{ await this.db.collection('submissions').add(rec); }
    catch(e){
      // กฎ Firestore รุ่นเก่ายังไม่รู้จักช่อง grp → เก็บไว้ในช่อง ref แทน
      if(rec.grp && /permission/i.test(e.code||e.message)){ const r2=Object.assign({}, rec, {ref:'grp:'+rec.grp}); delete r2.grp; await this.db.collection('submissions').add(r2); }
      else throw e;
    }
  },
  async submitMany(list){
    if(this.mode==='demo'){ const a = LS.get('ping_subs', []); list.forEach((r,i)=>a.unshift(Object.assign({}, r, {review:'pending', _id:'S'+Date.now()+'_'+i, createdAt:{seconds:Math.floor(Date.now()/1000)}}))); LS.set('ping_subs', a); SUBS=a.filter(s=>s.review==='pending'); renderHeader(); return; }
    const write = async (enc)=>{ for(let i=0;i<list.length;i+=400){ const b=this.db.batch();
      list.slice(i,i+400).forEach(r=>{ let o=Object.assign({}, r, {review:'pending', createdAt:firebase.firestore.FieldValue.serverTimestamp()}); if(enc && o.grp){ o.ref='grp:'+o.grp; delete o.grp; } b.set(this.db.collection('submissions').doc(), o); });
      await b.commit(); } };
    try{ await write(false); }catch(e){ if(/permission/i.test(e.code||e.message)) await write(true); else throw e; }
  },
  nextId(){ const mx = P.reduce((m,p)=>Math.max(m, p.seq||0), 0); return {seq:mx+1, id:'P'+String(mx+1).padStart(4,'0')}; },
  async ensureSeeded(){
    if(this.mode!=='firebase' || !S.seedFallback) return;
    toast('กำลังนำเข้าข้อมูลตั้งต้น 808 โครงการลงฐานข้อมูลก่อน…');
    await this.seed();
    S.seedFallback = false;
  },
  async approve(sub, data, forced){
    await this.ensureSeeded();
    const {id, seq} = forced || this.nextId();
    const proj = normProj(Object.assign({}, pickProj(data), {id, seq, src:'new', proposer:sub.proposer||'', proposerOrg:sub.proposerOrg||'', proposerContact:sub.proposerContact||'', approvedBy:S.user?.email||'', approvedAt:new Date().toISOString()}));
    if(this.mode==='demo'){
      const a = LS.get('ping_subs', []); const s = a.find(x=>x._id===sub._id); if(s){ s.review='approved'; s.projectId=id; } LS.set('ping_subs', a);
      this.demoAudit('อนุมัติโครงการใหม่', id, proj.title);
      this.demoSave(o=>o.added.push(proj)); return id;
    }
    const b = this.db.batch();
    b.set(this.db.doc('projects/'+id), proj);
    b.update(this.db.doc('submissions/'+sub._id), {review:'approved', projectId:id, reviewedBy:S.user.email, reviewedAt:firebase.firestore.FieldValue.serverTimestamp()});
    b.set(this.db.collection('audit').doc(), {ts:firebase.firestore.FieldValue.serverTimestamp(), by:S.user.email, action:'อนุมัติโครงการใหม่', id, detail:proj.title});
    await b.commit(); return id;
  },
  async reject(sub, reason){ return this.rejectMany([sub], reason); },
  async rejectMany(list, reason){
    if(this.mode==='demo'){
      const a = LS.get('ping_subs', []); const ids=new Set(list.map(x=>x._id));
      a.forEach(s=>{ if(ids.has(s._id)){ s.review='rejected'; s.reason=reason||''; s.reviewedBy=S.user?.email||'ผู้ดูแลระบบ'; s.reviewedAt=Date.now(); } }); LS.set('ping_subs', a);
      list.forEach(x=>this.demoAudit('ไม่อนุมัติ', x._id, x.title+(reason?' — '+reason:''))); this.initDemo(); return;
    }
    for(let i=0;i<list.length;i+=200){ const b=this.db.batch();
      list.slice(i,i+200).forEach(x=>{ b.update(this.db.doc('submissions/'+x._id), {review:'rejected', reason:reason||'', reviewedBy:S.user.email, reviewedAt:firebase.firestore.FieldValue.serverTimestamp()});
        b.set(this.db.collection('audit').doc(), {ts:firebase.firestore.FieldValue.serverTimestamp(), by:S.user.email, action:'ไม่อนุมัติ', id:x._id, detail:x.title+(reason?' — '+reason:'')}); });
      await b.commit(); }
  },
  async restoreMany(list){
    if(this.mode==='demo'){
      const a = LS.get('ping_subs', []); const ids=new Set(list.map(x=>x._id));
      a.forEach(s=>{ if(ids.has(s._id)){ s.review='pending'; } }); LS.set('ping_subs', a);
      list.forEach(x=>this.demoAudit('นำกลับไปพิจารณาใหม่', x._id, x.title)); this.initDemo(); return;
    }
    for(let i=0;i<list.length;i+=200){ const b=this.db.batch();
      list.slice(i,i+200).forEach(x=>{ b.update(this.db.doc('submissions/'+x._id), {review:'pending'});
        b.set(this.db.collection('audit').doc(), {ts:firebase.firestore.FieldValue.serverTimestamp(), by:S.user.email, action:'นำกลับไปพิจารณาใหม่', id:x._id, detail:x.title}); });
      await b.commit(); }
  },
  async approveMany(list){
    await this.ensureSeeded();
    let {seq} = this.nextId(); const ids=[];
    for(const x of list){ const id='P'+String(seq).padStart(4,'0'); await this.approve(x, x, {id, seq}); ids.push(id); seq++; }
    return ids;
  },
  async saveProject(id, data){
    const old = P.find(p=>p.id===id);
    const upd = Object.assign({}, old, pickProj(data), {updatedBy:S.user?.email||'', updatedAt:new Date().toISOString()});
    const changed = Object.keys(pickProj(data)).filter(k=>JSON.stringify(old[k]??'')!==JSON.stringify(upd[k]??''));
    if(this.mode==='demo'){
      this.demoAudit('แก้ไขโครงการ', id, changed.map(k=>FIELD_TH[k]||k).join(', '));
      this.demoSave(o=>{ const i=o.added.findIndex(x=>x.id===id); if(i>=0) o.added[i]=upd; else o.edited[id]=upd; }); return;
    }
    await this.ensureSeeded();
    const b = this.db.batch();
    b.set(this.db.doc('projects/'+id), upd);
    b.set(this.db.collection('audit').doc(), {ts:firebase.firestore.FieldValue.serverTimestamp(), by:S.user.email, action:'แก้ไขโครงการ', id, detail:changed.map(k=>FIELD_TH[k]||k).join(', ')});
    await b.commit();
  },
  async deleteProject(id){
    await this.ensureSeeded();
    const old = P.find(p=>p.id===id);
    if(this.mode==='demo'){
      this.demoAudit('ลบโครงการ', id, old?.title);
      this.demoSave(o=>{ const i=o.added.findIndex(x=>x.id===id); if(i>=0) o.added.splice(i,1); else o.deleted.push(id); }); return;
    }
    const b = this.db.batch();
    b.delete(this.db.doc('projects/'+id));
    b.set(this.db.collection('audit').doc(), {ts:firebase.firestore.FieldValue.serverTimestamp(), by:S.user.email, action:'ลบโครงการ', id, detail:old?.title||''});
    await b.commit();
  },
  async syncSeed(onProgress){
    const PLAN_F = ['sb','s','F','S','title','detail','tambons','ref'];
    const byId = Object.fromEntries(P.map(p=>[p.id,p]));
    const seedIds = new Set(SEED.map(p=>p.id));
    const todo = SEED.filter(sp=>{ const cur=byId[sp.id]; return !cur || PLAN_F.some(f=>JSON.stringify(cur[f]??'')!==JSON.stringify(sp[f]??'')); });
    const gone = P.filter(p=>p.src!=='new' && !seedIds.has(p.id));
    const merged = todo.map(sp=>{ const cur=byId[sp.id]||{}; const o=Object.assign({}, normProj(sp), cur.id?{agency:cur.agency||'',budget:cur.budget??null,yearStart:cur.yearStart??null,yearEnd:cur.yearEnd??null,status:cur.status||'',note:cur.note||''}:{}); return o; });
    if(this.mode==='demo'){
      this.demoSave(o=>{ merged.forEach(m=>{ if(o.edited[m.id]) o.edited[m.id]=Object.assign({}, o.edited[m.id], pickPlan(m)); }); });
      this.demoAudit('อัปเดตข้อมูลจาก Excel ฉบับใหม่','-', merged.length+' โครงการ'); return {n:merged.length, gone:gone.length};
    }
    const N = 15;
    for(let i=0;i<merged.length;i+=N){ const b=this.db.batch(); merged.slice(i,i+N).forEach(m=>b.set(this.db.doc('projects/'+m.id), m)); await b.commit(); onProgress && onProgress(Math.min(i+N,merged.length), merged.length); }
    for(let i=0;i<gone.length;i+=N){ const b=this.db.batch(); gone.slice(i,i+N).forEach(m=>b.delete(this.db.doc('projects/'+m.id))); await b.commit(); }
    await this.db.collection('audit').add({ts:firebase.firestore.FieldValue.serverTimestamp(), by:S.user.email, action:'อัปเดตข้อมูลจาก Excel ฉบับใหม่', id:'-', detail:`ปรับ ${merged.length} โครงการ${gone.length?` · ลบ ${gone.length}`:''} (คงสถานะ/หน่วยงาน/งบประมาณที่ผู้ดูแลกรอกไว้)`});
    return {n:merged.length, gone:gone.length};
  },
  async seed(onProgress){
    if(this.mode!=='firebase') return;
    const all = SEED.map(normProj);
    const N = 15; // กฎความปลอดภัยตรวจสิทธิ์ทุกเอกสาร จึงส่งทีละชุดเล็ก
    for(let i=0;i<all.length;i+=N){
      const b = this.db.batch();
      all.slice(i,i+N).forEach(p=>b.set(this.db.doc('projects/'+p.id), p));
      await b.commit(); onProgress && onProgress(Math.min(i+N, all.length), all.length);
    }
    await this.db.collection('audit').add({ts:firebase.firestore.FieldValue.serverTimestamp(), by:S.user.email, action:'นำเข้าข้อมูลตั้งต้น', id:'-', detail:all.length+' โครงการ'});
  }
};
const PROJ_FIELDS = ['sb','ref','s','F','S','grp','title','detail','tambons','agency','budget','yearStart','yearEnd','status','note'];
const FIELD_TH = {sb:'ลุ่มน้ำสาขา',ref:'ตารางอ้างอิง',s:'ยุทธศาสตร์',F:'แผนงาน',S:'มาตรการ',grp:'สภาพพื้นที่',title:'ชื่อแนวทาง/โครงการ',detail:'รายละเอียด',tambons:'ตำบลเป้าหมาย',agency:'หน่วยงานรับผิดชอบ',budget:'งบประมาณ',yearStart:'ปีเริ่ม',yearEnd:'ปีสิ้นสุด',status:'สถานะ',note:'หมายเหตุ'};
function pickPlan(d){ const o={}; ['sb','s','F','S','title','detail','tambons','ref'].forEach(k=>o[k]=d[k]); return o; }
function seedDiffCount(){ const byId=Object.fromEntries(P.map(p=>[p.id,p])); return SEED.filter(sp=>{ const c=byId[sp.id]; return !c || ['sb','s','F','S','title','detail','tambons','ref'].some(f=>JSON.stringify(c[f]??'')!==JSON.stringify(sp[f]??'')); }).length; }
function pickProj(d){ const o={}; PROJ_FIELDS.forEach(k=>{ if(k in d) o[k]=d[k]; }); return o; }

/* ================= INDEX & FILTER ================= */
function buildIndex(){
  IDX = {byTam:{}, byBasin:{}};
  P.forEach(p=>{
    (p.tambons||[]).forEach(t=>{ (IDX.byTam[t] ||= []).push(p); });
    (IDX.byBasin[p.sb] ||= []).push(p);
  });
}
/* ตำบลหนึ่งอยู่ได้ลุ่มน้ำสาขาเดียว = ลุ่มที่ครอบคลุมพื้นที่ตำบลมากที่สุด (sb[0]) */
const sbMain = t => t.sb[0] || '';
function tamInBasin(b){ return M.tambons.filter(t=>sbMain(t)===b); }
function tamInBasinAll(b){ return M.tambons.filter(t=>t.sb.includes(b)); }
function projGroups(p){
  if(p.grp) return new Set([p.grp]);   // สภาพพื้นที่ที่ผู้เสนอระบุ
  const g = new Set();
  (p.tambons||[]).forEach(id=>(T[id]?.grp||[]).forEach(c=>g.add(c)));
  return g;
}
function matchGrp(codes, sel){ if(!sel) return true; for(const c of codes){ if(sel.length===1 ? c[0]===sel : c===sel) return true; } return false; }
function projMatch(p, ignoreStage){
  const f = S.f;
  if(f.stage && !ignoreStage && stageOf(p)!==f.stage) return false;
  if(f.s.size && !f.s.has(p.s)) return false;
  if(f.F && !String(p.F).split(/,\s*/).includes(f.F)) return false;
  if(f.S && p.S!==f.S) return false;
  if(f.src && p.src!==f.src) return false;
  if(f.grp){
    let codes = projGroups(p);
    if(!codes.size && MEAS[p.S]) codes = new Set((MEAS[p.S].groups||'').match(/[WPREG]\d/g)||[]);
    if(!matchGrp(codes, f.grp)) return false;
  }
  if(f.q){
    const q = f.q.toLowerCase();
    const hay = (p.title+' '+p.detail+' '+p.sb+' '+p.id+' '+p.agency+' '+p.S+' '+(p.tambons||[]).map(id=>T[id]?.t+' '+T[id]?.a).join(' ')).toLowerCase();
    if(!hay.includes(q)) return false;
  }
  return true;
}
const filt = list => list.filter(p=>projMatch(p));
function filterActive(){ const f=S.f; return !!(f.q||f.s.size||f.F||f.S||f.grp||f.src||f.stage); }

/* ================= COMPONENTS ================= */
const sPill = n => `<span class="pill s" style="background:${SCOL[n]}" title="${esc(STRAT[n]?.short)}">ยศ.${n}</span>`;
const tPill = t => t.target ? `<span class="pill tg">พื้นที่เป้าหมาย</span>` : `<span class="pill p0">ไม่ใช่พื้นที่เป้าหมาย</span>`;
const tamName = t => t ? `ต.${t.t} อ.${t.a} จ.${t.p}` : '';
function stratBar(list){
  const c = {1:0,2:0,3:0,4:0,5:0}; list.forEach(p=>c[p.s]++); const n = list.length||1;
  return `<div class="stackbar">${[1,2,3,4,5].map(i=>`<span style="width:${c[i]/n*100}%;background:${SCOL[i]}" title="ยศ.${i}: ${c[i]}"></span>`).join('')}</div>
  <div class="legend">${[1,2,3,4,5].map(i=>`<span><i class="dot" style="background:${SCOL[i]}"></i>ยศ.${i} ${fmt(c[i])}</span>`).join('')}</div>`;
}
const TABLES = {};
function projTable(key, list, opts={}){
  TABLES[key] = {list, n:PAGE, opts};
  return `<div data-table="${key}">${tableInner(key)}</div>`;
}
function projLoc(p){
  const ts = (p.tambons||[]).map(id=>T[id]).filter(Boolean);
  const uniq = a => [...new Set(a)];
  return {ts, prov: uniq(ts.map(t=>t.p)), amp: uniq(ts.map(t=>t.a)), tam: ts.map(t=>t.t)};
}
function projGrpList(p){
  const g = [...projGroups(p)];
  if(g.length) return {codes: sortGrp(g), fromMeasure:false};
  return {codes: sortGrp((MEAS[p.S]?.groups||'').match(/[WPREG]\d/g)||[]), fromMeasure:true};
}
function sortGrp(a){ return [...new Set(a)].sort((x,y)=>x[0]===y[0]? +x.slice(1)-+y.slice(1) : 'WPREG'.indexOf(x[0])-'WPREG'.indexOf(y[0])); }
function shortList(arr, pre, max=2){
  if(!arr.length) return '';
  const shown = arr.slice(0,max).map(x=>pre+esc(x)).join(', ');
  return arr.length>max ? `${shown} <span class="sub">+${arr.length-max}</span>` : shown;
}
function tableInner(key){
  const {list, n, opts} = TABLES[key];
  if(!list.length) return `<div class="empty">${opts.empty || 'ไม่มีโครงการ'}</div>`;
  const rows = list.slice(0, n).map(p=>{
    const L = projLoc(p); const G = projGrpList(p);
    const basinLvl = '<span class="sub">ระดับลุ่มน้ำ</span>';
    const full = G.codes.map(c=>`${c} ${M.groups[c]||''}`).join('\n');
    const grp = G.codes.length ? `<span class="gcodes" title="${esc(full)}">${G.codes.slice(0,6).map(c=>`<b style="color:${SCOL['WPREG'.indexOf(c[0])+1]}">${c}</b>`).join(' ')}${G.codes.length>6?` <span class="sub">+${G.codes.length-6}</span>`:''}</span>`+(G.fromMeasure?'<div class="sub">ตามมาตรการ</div>':'') : '–';
    return `<tr class="row" data-pid="${esc(p.id)}">
      <td class="num sub">${esc(p.id)}</td>
      <td>${sPill(p.s)}</td>
      <td class="t">${esc(p.title)}${p.src==='new'?' <span class="pill new">เพิ่มใหม่</span>':''}${stageOf(p)!=='ยังไม่ระบุ'?`<div class="sub"><i class="dot" style="background:${STAGES.find(x=>x[0]===stageOf(p))[1]};width:7px;height:7px"></i> ${esc(stageOf(p))}</div>`:''}</td>
      <td>${p.F||p.S?`<span class="pill code">${esc(p.F)}</span> <span class="pill code">${esc(p.S)}</span>`:'<span class="sub">–</span>'}</td>
      ${opts.noBasin?'':`<td class="b">${esc(p.sb)}</td>`}
      <td class="loc">${L.ts.length?shortList(L.prov,'จ.'):basinLvl}</td>
      <td class="loc">${L.ts.length?shortList(L.amp,'อ.'):''}</td>
      <td class="loc">${L.ts.length?shortList(L.tam,'ต.'):''}</td>
      <td class="grp">${grp}</td></tr>`;
  }).join('');
  return `<div class="tbl-tools"><span class="note">${fmt(list.length)} รายการ</span><button class="btn sm" data-act="xls" data-key="${key}">ดาวน์โหลด Excel</button></div>
  <div class="tbl-wrap"><table><thead><tr><th>รหัส</th><th>ยศ.</th><th>แนวทาง/โครงการ</th><th>แผนงาน/มาตรการ</th>${opts.noBasin?'':'<th>ลุ่มน้ำสาขา</th>'}<th>จังหวัด</th><th>อำเภอ</th><th>ตำบล</th><th>กลุ่มพื้นที่</th></tr></thead><tbody>${rows}</tbody></table></div>
  ${list.length>n?`<div class="more"><button class="btn sm" data-act="more" data-key="${key}">แสดงเพิ่ม (เหลืออีก ${fmt(list.length-n)} รายการ)</button></div>`:''}`;
}
function stratProblems(tg){ const sc={1:0,2:0,3:0,4:0,5:0}; tg.forEach(t=>t.strat.forEach(n=>sc[n]++)); return `<div class="legend" style="font-size:.84rem">${[1,2,3,4,5].map(i=>`<span>${sPill(i)} ${esc(shortS(i))} <b class="num">${sc[i]}</b></span>`).join('')}</div>`; }
function grpCounts(tams){
  const c = {}; tams.forEach(t=>t.grp.forEach(g=>c[g]=(c[g]||0)+1));
  const keys = Object.keys(c).sort((a,b)=>a[0]===b[0]? +a.slice(1)-+b.slice(1) : 'WPREG'.indexOf(a[0])-'WPREG'.indexOf(b[0]));
  if(!keys.length) return '<div class="note">ไม่มีตำบลที่จัดอยู่ในกลุ่มพื้นที่ปัญหา</div>';
  return `<div class="grp-list">${keys.map(k=>`<span class="grp-item" title="${esc(M.groupFamilies[k[0]]||'')}"><b class="c" style="color:${SCOL['WPREG'.indexOf(k[0])+1]}">${k}</b>${esc(M.groups[k]||'')}<span class="n">${c[k]}</span></span>`).join('')}</div>`;
}
function tamInfo(t, compact){
  const sbs = `<b>${esc(sbMain(t))}</b>${t.sbPct[0]!=null?` <span class="note">(${t.sbPct[0]}% ของพื้นที่ตำบล)</span>`:''}` + (t.sbNote ? `<div class="note" style="color:var(--blue)">${esc(t.sbNote)}</div>` : '') + (t.sb.length>1 ? `<div class="note">คาบเกี่ยว: ${t.sb.slice(1).map((b,i)=>esc(b)+(t.sbPct[i+1]!=null?` ${t.sbPct[i+1]}%`:'')).join(', ')}</div>` : '');
  const grps = t.grp.length ? t.grp.map(g=>`<div><span class="pill code">${g}</span> ${esc(M.groups[g]||'')} <span class="note">· ${esc(M.groupFamilies[g[0]]||'')}</span></div>`).join('') : '<span class="note">ไม่อยู่ในกลุ่มพื้นที่ปัญหา</span>';
  return `<dl class="dl">
    <dt>สถานะเป้าหมาย</dt><dd>${tPill(t)} ${t.target?`<span class="note">พบปัญหา ${t.strat.length} ยุทธศาสตร์</span>`:'<span class="note">ไม่พบปัญหาเด่นตามเกณฑ์ 5 ยุทธศาสตร์</span>'}</dd>
    <dt>ยุทธศาสตร์ที่มีปัญหา</dt><dd>${t.strat.length ? t.strat.map(n=>`${sPill(n)} ${esc(STRAT[n]?.short)}`).join('<br>') : '–'}</dd>
    <dt>กลุ่มพื้นที่</dt><dd>${grps}</dd>
    ${compact?'':`<dt>แผนงานที่ควรใช้ (เสนอ)</dt><dd>${t.F.length ? t.F.map(f=>`<span class="pill code">${f}</span> ${esc(PROG[f]?.name||'')}`).join('<br>') : '–'}</dd>`}
    <dt>ลุ่มน้ำสาขา</dt><dd>${sbs||'–'}</dd>
    <dt>พื้นที่ตำบล</dt><dd class="num">${t.area!=null? fmt(t.area)+' ตร.กม.':'–'}</dd>
  </dl>`;
}

/* ================= HEADER / KPIs / FILTERS ================= */
function renderHeader(){
  $('#mode').outerHTML = `<span id="mode" class="mode ver" title="${Store.mode==='firebase'?'เชื่อมต่อฐานข้อมูลออนไลน์':'ยังไม่ได้เชื่อมต่อฐานข้อมูลออนไลน์ ข้อมูลที่เพิ่มเก็บในเบราว์เซอร์นี้'}"><i class="mdot ${Store.mode==='firebase'?'on':''}"></i>${esc(CFG.version||'')}</span>`;
  const ss = Sess.get();
  const role = S.admin ? 'admin' : (S.user ? 'noperm' : (ss?.role==='user' ? 'user' : ''));
  const RL = {admin:['ผู้ดูแลระบบ','แก้ไข อนุมัติ และลบโครงการได้'], user:['ผู้ใช้ทั่วไป','ดูข้อมูลและเสนอโครงการได้'], noperm:['ยังไม่มีสิทธิ์ผู้ดูแล','บัญชีนี้ยังไม่ได้อยู่ในรายชื่อผู้ดูแล'], '':['ยังไม่ได้เข้าสู่ระบบ','']};
  const rb = $('#roleBadge'); if(rb){ rb.className = 'role-badge r-'+(role||'none'); rb.innerHTML = `<i></i><span class="rl">สถานะ</span> <b>${RL[role][0]}</b>`; rb.title = RL[role][1]; }
  $('#authBtn').innerHTML = (S.admin || S.user) ? 'ออกจากระบบ' : 'เข้าสู่ระบบผู้ดูแล';
  const t = $('.tab[data-tab="admin"]'); t.innerHTML = `ผู้ดูแลระบบ${S.admin && SUBS.length ? `<span class="badge-n">${SUBS.length}</span>`:''}`;
}
const tip = t => `<button type="button" class="tip" aria-label="${esc(t)}" data-tip="${esc(t)}">i</button>`;
function statsBox(inner){ return `<details class="statsbox" ${S.statsOpen?'open':''}><summary>ดูสถิติพื้นที่ <span class="note">สัดส่วนโครงการ · ยุทธศาสตร์ที่มีปัญหา · กลุ่มพื้นที่</span></summary><div class="statsbox-in">${inner}</div></details>`; }
/* ปุ่ม "ล้าง" ในแต่ละช่องตัวกรอง */
function addClearButtons(root){
  if(!root) return;
  root.querySelectorAll('.fld').forEach(fld=>{
    fld.querySelector(':scope > .clr')?.remove();
    const ctl = fld.querySelector('select, input[type=search]');
    let on = false, target = '';
    if(ctl){ on = !ctl.disabled && ctl.value !== '' && !(ctl.tagName==='SELECT' && ctl.selectedIndex===0 && ctl.options[0]?.value!==''); target = ctl.id; }
    else if(fld.querySelector('[data-act="fs"]')){ on = S.f.s.size>0; target = '__strat'; }
    if(!on || !target) return;
    const b = document.createElement('button'); b.type='button'; b.className='clr'; b.dataset.act='clr'; b.dataset.v=target; b.title='ล้างตัวกรองนี้'; b.innerHTML='× ล้าง';
    fld.classList.add('has-clr'); fld.appendChild(b);
  });
}
function renderKPIs(){
  const tg = M.tambons.filter(t=>t.target);
  const amp = new Set(M.tambons.map(t=>t.p+'|'+t.a)).size;
  const k = [
    [M.provinces.length,'จังหวัด'],[amp,'อำเภอ'],[M.tambons.filter(t=>t.geo).length,'ตำบลในลุ่มน้ำปิง'],[M.basins.length,'ลุ่มน้ำสาขา'],
    [tg.length,'ตำบลเป้าหมาย'],[P.length,'แนวทาง/โครงการ',true]];
  $('#kpis').innerHTML = `<span class="kl">ภาพรวมลุ่มน้ำปิง</span>` + k.map(([v,l,p])=>`<span class="ki"><b class="${p?'pinkv':''}">${fmt(v)}</b> ${l}</span>`).join('<span class="ksep">·</span>');
}
function renderFilters(){
  const f = S.f;
  const Fopts = M.programmes.filter(p=>!f.s.size || f.s.has(p.s));
  const Sopts = M.measures.filter(m=>(!f.s.size || f.s.has(m.s)) && (!f.F || m.F.includes(f.F)));
  let loc = '';
  if(S.tab==='area'){
    const amps = S.prov ? [...new Set(M.tambons.filter(t=>t.p===S.prov).map(t=>t.a))].sort((a,b)=>a.localeCompare(b,'th')) : [];
    const tams = S.amp ? M.tambons.filter(t=>t.p===S.prov&&t.a===S.amp).sort((a,b)=>a.t.localeCompare(b.t,'th')) : [];
    loc = `<div class="locrow">
      <div class="fld"><label for="fLp">จังหวัด</label><select id="fLp"><option value="">ทั้ง 6 จังหวัดในลุ่มน้ำปิง</option>${M.provinces.map(p=>`<option ${S.prov===p?'selected':''}>${esc(p)}</option>`).join('')}</select></div>
      <div class="fld"><label for="fLa">อำเภอ</label><select id="fLa" ${S.prov?'':'disabled'}><option value="">${S.prov?'ทุกอำเภอ':'เลือกจังหวัดก่อน'}</option>${amps.map(a=>`<option ${S.amp===a?'selected':''}>${esc(a)}</option>`).join('')}</select></div>
      <div class="fld"><label for="fLt">ตำบล</label><select id="fLt" ${S.amp?'':'disabled'}><option value="">${S.amp?'ทุกตำบล':'เลือกอำเภอก่อน'}</option>${tams.map(t=>`<option value="${t.id}" ${S.tam===t.id?'selected':''}>${esc(t.t)}${t.target?' (เป้าหมาย)':''}</option>`).join('')}</select></div>
    </div>`;
  } else if(S.tab==='basin'){
    const pool = S.basin ? tamInBasin(S.basin) : [];
    const provs = [...new Set(pool.map(t=>t.p))].sort((a,b)=>a.localeCompare(b,'th'));
    const amps = S.bprov ? [...new Set(pool.filter(t=>t.p===S.bprov).map(t=>t.a))].sort((a,b)=>a.localeCompare(b,'th')) : [];
    const tams = S.bamp ? pool.filter(t=>t.p===S.bprov&&t.a===S.bamp).sort((a,b)=>a.t.localeCompare(b.t,'th')) : [];
    loc = `<div class="locrow"><div class="fld"><label for="fLb">ลุ่มน้ำสาขา</label><select id="fLb"><option value="">ทั้ง 30 ลุ่มน้ำสาขา</option>${M.basins.map(b=>`<option ${S.basin===b.name?'selected':''}>${esc(b.name)}</option>`).join('')}</select></div>
      <div class="fld"><label for="fBp">จังหวัด (ในลุ่มน้ำนี้)</label><select id="fBp" ${S.basin?'':'disabled'}><option value="">${S.basin?`ทุกจังหวัดในลุ่มน้ำนี้ (${provs.length})`:'เลือกลุ่มน้ำสาขาก่อน'}</option>${provs.map(p=>`<option ${S.bprov===p?'selected':''}>${esc(p)}</option>`).join('')}</select></div>
      <div class="fld"><label for="fBa">อำเภอ</label><select id="fBa" ${S.bprov?'':'disabled'}><option value="">${S.bprov?'ทุกอำเภอ':'เลือกจังหวัดก่อน'}</option>${amps.map(a=>`<option ${S.bamp===a?'selected':''}>${esc(a)}</option>`).join('')}</select></div>
      <div class="fld"><label for="fBt">ตำบล</label><select id="fBt" ${S.bamp?'':'disabled'}><option value="">${S.bamp?'ทุกตำบล':'เลือกอำเภอก่อน'}</option>${tams.map(t=>`<option value="${t.id}" ${S.btam===t.id?'selected':''}>${esc(t.t)}${t.target?' (เป้าหมาย)':''}</option>`).join('')}</select></div></div>`;
  }
  if(S.tab==='area' || S.tab==='basin') loc = loc.replace(/<\/div>\s*$/, tracker()+'</div>');
  else if(S.tab==='map') loc = `<div class="locrow trk-only">${tracker()}</div>`;
  $('#filters').innerHTML = loc + `
    <div class="fld search"><label for="fq">ค้นหา</label><input id="fq" type="search" placeholder="ชื่อโครงการ ตำบล อำเภอ ลุ่มน้ำ หรือรหัส" value="${esc(f.q)}"></div>
    <div class="fld"><span class="lbl">ยุทธศาสตร์</span><div class="chips"><button class="chip all" data-act="fsall" aria-pressed="${!f.s.size}">ทั้งหมด</button>${M.strategies.map(s=>`<button class="chip" data-act="fs" data-n="${s.n}" aria-pressed="${f.s.has(s.n)}" title="${esc(s.short)}"><i style="background:${SCOL[s.n]}"></i>${s.n} ${esc(shortS(s.n))}</button>`).join('')}</div></div>
    <div class="morebar"><button type="button" class="morebtn" data-act="morefilt" aria-expanded="${!!S.moreOpen}">ตัวกรองโครงการเพิ่มเติม${(f.F?1:0)+(f.S?1:0)+(f.grp?1:0)?` <span class="badge-n">${(f.F?1:0)+(f.S?1:0)+(f.grp?1:0)}</span>`:''} <span aria-hidden="true">${S.moreOpen?'▴':'▾'}</span></button><div class="fcount">${scopeCount()}</div></div><div class="morefilt" ${S.moreOpen?'':'hidden'}>
    <div class="fld"><label for="fF">แผนงานหลัก</label><select id="fF"><option value="">ทั้งหมด</option>${Fopts.map(p=>`<option value="${p.code}" ${f.F===p.code?'selected':''}>${p.code} ${esc(p.name)}</option>`).join('')}</select></div>
    <div class="fld"><label for="fS">มาตรการ</label><select id="fS"><option value="">ทั้งหมด</option>${Sopts.map(m=>`<option value="${m.code}" ${f.S===m.code?'selected':''}>${m.code} ${esc(m.name)}</option>`).join('')}</select></div>
    <div class="fld"><label for="fG">กลุ่มพื้นที่</label><select id="fG"><option value="">ทั้งหมด</option>${'WPREG'.split('').map(fm=>`<optgroup label="${fm} · ${esc(M.groupFamilies[fm])}"><option value="${fm}" ${f.grp===fm?'selected':''}>${fm} ทั้งกลุ่ม</option>${Object.keys(M.groups).filter(k=>k[0]===fm).sort((a,b)=>+a.slice(1)-+b.slice(1)).map(k=>`<option value="${k}" ${f.grp===k?'selected':''}>${k} ${esc(M.groups[k])}</option>`).join('')}</optgroup>`).join('')}</select></div></div>
`;
  addClearButtons($('#filters'));
}
function scopeBase(){
  let base = P, label = '';
  if(S.tab==='area' && S.prov){
    const ids = new Set(M.tambons.filter(t=>t.p===S.prov && (!S.amp||t.a===S.amp) && (!S.tam||t.id===S.tam)).map(t=>t.id));
    base = P.filter(p=>(p.tambons||[]).some(id=>ids.has(id)));
    label = S.tam ? 'ต.'+T[S.tam].t : S.amp ? 'อ.'+S.amp : 'จ.'+S.prov;
  } else if(S.tab==='map' && typeof MS!=='undefined' && ((MS.kind==='basin' && MS.basin) || MS.prov)){
    const ids = new Set(M.tambons.filter(t=>inScope(t)).map(t=>t.id));
    base = P.filter(p=>(MS.kind!=='basin' || !MS.basin || p.sb===MS.basin) && ((p.tambons||[]).some(id=>ids.has(id)) || (MS.kind==='basin' && MS.basin && !MS.prov && p.sb===MS.basin && !(p.tambons||[]).length)));
    label = MS.kind==='basin' && MS.basin ? 'ลุ่มน้ำสาขา'+MS.basin+(MS.prov?' · '+(MS.tam?'ต.'+T[MS.tam].t:MS.amp?'อ.'+MS.amp:'จ.'+MS.prov):'') : (MS.tam?'ต.'+T[MS.tam].t:MS.amp?'อ.'+MS.amp:'จ.'+MS.prov);
  } else if(S.tab==='basin' && S.basin){
    base = P.filter(p=>p.sb===S.basin); label = 'ลุ่มน้ำสาขา'+S.basin;
    if(S.bprov){
      const ids = new Set(tamInBasin(S.basin).filter(t=>t.p===S.bprov && (!S.bamp||t.a===S.bamp) && (!S.btam||t.id===S.btam)).map(t=>t.id));
      base = base.filter(p=>(p.tambons||[]).some(id=>ids.has(id)));
      label += ' · ' + (S.btam ? 'ต.'+T[S.btam].t : S.bamp ? 'อ.'+S.bamp : 'จ.'+S.bprov);
    }
  }
  return {base, label};
}
function scopeCount(){
  const {base, label} = scopeBase();
  const n = filt(base).length;
  const where = label ? ` ใน${esc(label)}` : '';
  return filterActive()
    ? `พบ <b class="num">${fmt(n)}</b> จาก ${fmt(base.length)} โครงการ${where} · <button class="linkbtn" data-act="clear">ล้างตัวกรอง</button>`
    : `${fmt(base.length)} โครงการ${where}`;
}
function tracker(){
  const {base} = scopeBase();
  const list = base.filter(p=>projMatch(p, true));
  const c = {}; STAGES.forEach(([k])=>c[k]=0); list.forEach(p=>c[stageOf(p)]++);
  const n = list.length || 1;
  const bar = STAGES.map(([k,col])=>c[k]?`<span style="width:${c[k]/n*100}%;background:${col}" title="${k} ${c[k]}"></span>`:'').join('');
  const items = STAGES.map(([k,col])=>`<button type="button" class="trk-i" data-act="stage" data-v="${k}" aria-pressed="${S.f.stage===k}"><i style="background:${col}"></i>${k} <b class="num">${fmt(c[k])}</b></button>`).join('');
  return `<div class="tracker"><div class="trk-h"><span class="lbl">ติดตามสถานะโครงการ ${tip('นับตามพื้นที่และตัวกรองที่เลือก · กดที่สถานะเพื่อกรองเฉพาะสถานะนั้น · ผู้ดูแลปรับสถานะได้ที่ปุ่ม "แก้ไขข้อมูล" ในรายละเอียดโครงการ')}</span>${S.f.stage?'<button type="button" class="linkbtn" data-act="stage" data-v="">ดูทุกสถานะ</button>':''}</div><div class="trk-bar">${bar}</div><div class="trk-items">${items}</div></div>`;
}
function shortS(n){ return ({1:'อุปโภคบริโภค',2:'ภาคการผลิต',3:'ท่วม–แล้ง',4:'ระบบนิเวศ',5:'บริหารจัดการ'})[n]; }

/* ================= VIEW: AREA (จังหวัด-อำเภอ-ตำบล) ================= */
function renderArea(){
  const el = $('#view');
  const fl = filt(P);
  const projIn = tams => { const ids = new Set(tams.map(t=>t.id)); const seen=new Set(); const out=[]; fl.forEach(p=>{ if((p.tambons||[]).some(id=>ids.has(id)) && !seen.has(p.id)){ seen.add(p.id); out.push(p);} }); return out; };
  // tree
  let tree='', head='', crumbs = `<button data-act="goprov" data-v="">ทั้ง 6 จังหวัดในลุ่มน้ำปิง</button>`;
  if(!S.prov){
    head = 'จังหวัด';
    tree = M.provinces.map(pv=>{ const ts=M.tambons.filter(t=>t.p===pv); return `<button class="nav-chip" data-act="goprov" data-v="${esc(pv)}">จ.${esc(pv)}</button>`; }).join('');
  } else if(!S.amp){
    head = `อำเภอใน จ.${S.prov}`;
    const amps = [...new Set(M.tambons.filter(t=>t.p===S.prov).map(t=>t.a))].sort((a,b)=>a.localeCompare(b,'th'));
    tree = amps.map(a=>{ const ts=M.tambons.filter(t=>t.p===S.prov&&t.a===a); const tg=ts.filter(t=>t.target).length; return `<button class="nav-chip" data-act="goamp" data-v="${esc(a)}">อ.${esc(a)}</button>`; }).join('');
    crumbs += `<span class="sep">›</span><strong>จ.${esc(S.prov)}</strong>`;
  } else {
    head = `ตำบลใน อ.${S.amp}`;
    const ts = M.tambons.filter(t=>t.p===S.prov&&t.a===S.amp).sort((a,b)=>a.t.localeCompare(b.t,'th'));
    tree = ts.map(t=>{ const n = projIn([t]).length; return `<button class="nav-chip" data-act="gotam" data-v="${t.id}" aria-current="${S.tam===t.id}" title="${t.target?'พื้นที่เป้าหมาย':'ไม่ใช่พื้นที่เป้าหมาย'}"><i class="dot" style="background:${t.target?'var(--blue)':'var(--p0)'}"></i>ต.${esc(t.t)}</button>`; }).join('');
    crumbs += `<span class="sep">›</span><button data-act="goprov" data-v="${esc(S.prov)}">จ.${esc(S.prov)}</button><span class="sep">›</span>${S.tam?`<button data-act="goamp" data-v="${esc(S.amp)}">อ.${esc(S.amp)}</button><span class="sep">›</span><strong>ต.${esc(T[S.tam].t)}</strong>`:`<strong>อ.${esc(S.amp)}</strong>`}`;
  }
  // detail
  let detail='';
  if(S.tam){
    const t = T[S.tam];
    const pj = projIn([t]);
    const bl = filt(P).filter(p=>!(p.tambons||[]).length && t.sb.includes(p.sb));
    detail = `<div class="info"><h2>ต.${esc(t.t)} <span class="note" style="font-size:.9rem">อ.${esc(t.a)} จ.${esc(t.p)}</span></h2><!--NAV-->${tamInfo(t)}
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm" data-act="maptam" data-v="${t.id}">ดูบนแผนที่</button>${t.sb.map(b=>`<button class="btn sm" data-act="gobasin" data-v="${esc(b)}">ลุ่มน้ำสาขา${esc(b)}</button>`).join('')}</div></div>
      <div class="sec-h"><h3>โครงการที่มีตำบลนี้เป็นพื้นที่เป้าหมาย (${fmt(pj.length)})</h3><button class="btn sm pink" data-act="newproj" data-tam="${t.id}">+ เสนอโครงการในตำบลนี้</button></div>
      ${projTable('tam', pj, {name:`ต.${t.t}_อ.${t.a}_จ.${t.p}`, empty: t.target ? 'ยังไม่มีโครงการที่ระบุตำบลนี้เป็นพื้นที่เป้าหมาย' : 'ไม่มีโครงการ — ตำบลนี้ไม่ได้เป็นพื้นที่เป้าหมายของแผนแม่บท'})}
      <details class="basin-level"><summary>แนวทางระดับลุ่มน้ำสาขาที่ตำบลนี้อยู่ (ไม่ระบุตำบลเป้าหมาย) · ${fmt(bl.length)} รายการ</summary><div class="inner">${projTable('tambl', bl, {name:`ระดับลุ่มน้ำ_ต.${t.t}`})}</div></details>`;
  } else {
    const ts = M.tambons.filter(t=>(!S.prov||t.p===S.prov)&&(!S.amp||t.a===S.amp));
    const tg = ts.filter(t=>t.target); const pj = projIn(ts);
    const lvl = S.amp ? `อ.${S.amp} จ.${S.prov}` : S.prov ? `จ.${S.prov}` : 'ทั้ง 6 จังหวัดในลุ่มน้ำปิง';
    const sbs = [...new Set(ts.flatMap(t=>t.sb))];
    detail = `<div class="info"><h2>${esc(lvl)}</h2><!--NAV-->
      <div class="sumgrid" style="margin-top:10px">
        <div class="stat"><div class="v">${fmt(ts.filter(t=>t.geo).length)}</div><div class="l">ตำบลในลุ่มน้ำปิง</div></div>
        <div class="stat"><div class="v">${fmt(tg.length)}</div><div class="l">ตำบลเป้าหมาย</div></div>
        <div class="stat"><div class="v">${fmt(sbs.length)}</div><div class="l">ลุ่มน้ำสาขาที่เกี่ยวข้อง</div></div>
        <div class="stat"><div class="v" style="color:var(--pink)">${fmt(pj.length)}</div><div class="l">โครงการที่ลงตำบล${filterActive()?' (ตามตัวกรอง)':''}</div></div>
      </div>
      ${statsBox(`<div class="lbl">สัดส่วนโครงการรายยุทธศาสตร์</div>${stratBar(pj)}
        <div class="lbl" style="margin-top:12px">ยุทธศาสตร์ที่มีปัญหา (จำนวนตำบลเป้าหมาย)</div>${stratProblems(tg)}
        <div class="lbl" style="margin-top:12px">กลุ่มพื้นที่ที่พบ ${tip('ตัวเลขในวง = จำนวนตำบลเป้าหมายที่อยู่ในกลุ่มพื้นที่นั้น')}</div>${grpCounts(tg)}`)}
    </div>
    <div class="sec-h"><h3>โครงการในพื้นที่ (${fmt(pj.length)}) ${tip('นับเฉพาะโครงการที่ระบุตำบลเป้าหมายในพื้นที่นี้ · โครงการเดียวอาจลงหลายตำบล จึงนับครั้งเดียว')}</h3></div>
    ${projTable('area', pj, {name: lvl})}`;
  }
  const nav = `<div class="navbox"><span class="lbl">${esc(head)}${S.amp?' '+tip('จุดสีน้ำเงิน = ตำบลพื้นที่เป้าหมาย · จุดสีเทา = ไม่ใช่พื้นที่เป้าหมาย'):''}</span><div class="nav-chips">${tree}</div>${S.prov?`<button class="linkbtn" data-act="up">ย้อนกลับ</button>`:''}</div>`;
  el.innerHTML = `<div class="crumbs">${crumbs}</div>${detail.replace('<!--NAV-->', nav)}`;
}

/* ================= VIEW: BASIN ================= */
function renderBasin(){
  const el = $('#view');
  const fl = filt(P);
  if(!S.basin){
    el.innerHTML = `<div class="sec-h" style="margin-top:0"><h2>ลุ่มน้ำสาขา 30 ลุ่มน้ำ</h2><span class="note">เลือกลุ่มน้ำสาขาเพื่อดูกลุ่มพื้นที่ ตำบลเป้าหมาย และโครงการ</span></div>
    <div class="bgrid">${M.basins.map(b=>{ const ts=tamInBasin(b.name); const tg=ts.filter(t=>t.target); const n=fl.filter(p=>p.sb===b.name).length;
      return `<button class="bcard" data-act="gobasin" data-v="${esc(b.name)}"><span class="code">รหัส ${esc(b.code)} · ${fmt(b.area)} ตร.กม.</span><span class="nm">${esc(b.name)}</span>
      <span class="row2"><span>ตำบล <b>${ts.length}</b></span><span>เป้าหมาย <b>${tg.length}</b></span><span>โครงการ <b style="color:var(--pink)">${fmt(n)}</b></span></span>
      ${stratBar(fl.filter(p=>p.sb===b.name)).split('<div class="legend">')[0]}</button>`; }).join('')}</div>`;
    return;
  }
  const b = BAS[S.basin];
  const sub = !!S.bprov;
  const ts = tamInBasin(b.name).filter(t=>(!S.bprov||t.p===S.bprov)&&(!S.bamp||t.a===S.bamp)&&(!S.btam||t.id===S.btam)); const tg = ts.filter(t=>t.target);
  const tsIds = new Set(ts.map(t=>t.id));
  const pj = fl.filter(p=>p.sb===b.name && (!sub || (p.tambons||[]).some(id=>tsIds.has(id))));
  const subLbl = S.btam ? `ต.${T[S.btam].t} อ.${S.bamp} จ.${S.bprov}` : S.bamp ? `อ.${S.bamp} จ.${S.bprov}` : S.bprov ? `จ.${S.bprov}` : '';
  const sc = {1:0,2:0,3:0,4:0,5:0}; tg.forEach(t=>t.strat.forEach(n=>sc[n]++));
  const provs = [...new Set(ts.map(t=>t.p))];
  el.innerHTML = `<div class="crumbs"><button data-act="gobasin" data-v="">ลุ่มน้ำสาขาทั้งหมด</button><span class="sep">›</span>${subLbl?`<button data-act="gobasin" data-v="${esc(b.name)}">${esc(b.name)}</button><span class="sep">›</span><strong>${esc(subLbl)}</strong>`:`<strong>${esc(b.name)}</strong>`}</div>
  <div class="info"><h2>ลุ่มน้ำสาขา${esc(b.name)}${subLbl?` <span class="note" style="font-size:.95rem">· เฉพาะ ${esc(subLbl)}</span>`:''}</h2><div class="note">รหัส ${esc(b.code)} · พื้นที่ ${fmt(b.area)} ตร.กม. · จังหวัด ${provs.map(esc).join(', ')}</div>
    <div class="sumgrid" style="margin-top:10px">
      <div class="stat"><div class="v">${ts.length}</div><div class="l">${subLbl?'ตำบลในพื้นที่ที่เลือก':'ตำบลที่อยู่ในลุ่มน้ำ'}</div></div>
      <div class="stat"><div class="v">${tg.length}</div><div class="l">ตำบลเป้าหมาย</div></div>
      <div class="stat"><div class="v" style="color:var(--pink)">${fmt(pj.length)}</div><div class="l">แนวทาง/โครงการ${filterActive()?' (ตามตัวกรอง)':''}</div></div>
    </div>
    ${statsBox(`<div class="lbl">สัดส่วนโครงการรายยุทธศาสตร์</div>${stratBar(pj)}
      <div class="lbl" style="margin-top:12px">ยุทธศาสตร์ที่มีปัญหา (จำนวนตำบลเป้าหมาย)</div>${stratProblems(tg)}
      <div class="lbl" style="margin-top:12px">กลุ่มพื้นที่ในลุ่มน้ำนี้ ${tip('ตัวเลขในวง = จำนวนตำบลเป้าหมายที่อยู่ในกลุ่มพื้นที่นั้น')}</div>${grpCounts(tg)}`)}
    <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm" data-act="mapbasin" data-v="${esc(b.name)}">ดูบนแผนที่</button><button class="btn sm pink" data-act="newproj" data-sb="${esc(b.name)}">+ เสนอโครงการในลุ่มน้ำนี้</button></div>
  </div>
  ${Object.values(b.keyF||{}).some(Boolean)?`<div class="keyf-box"><div class="keyf-h"><span class="lbl">แนวทางสำคัญรายแผนงาน (สรุปจากแผนแม่บท) · กดหรือชี้ที่แผนงานเพื่อดูรายละเอียด</span></div>
    <div class="keyf-chips">${Object.entries(b.keyF).filter(([k,v])=>v).map(([k,v])=>`<button type="button" class="chip keyf-c" data-act="keyf" data-v="${k}" aria-expanded="false" title="${esc(k+' '+(PROG[k]?.name||'')+'\n'+v)}"><b>${k}</b> ${esc(PROG[k]?.name||'')}</button>`).join('')}<button type="button" class="linkbtn" data-act="keyfall">แสดงทั้งหมด</button></div>
    <div class="keyf-panel" id="keyfPanel" hidden></div>
    <template id="keyfData">${Object.entries(b.keyF).filter(([k,v])=>v).map(([k,v])=>`<div data-k="${k}"><b>${k} ${esc(PROG[k]?.name||'')}</b>${esc(v)}</div>`).join('')}</template></div>`:''}
  <div class="sec-h"><h3>${subLbl?'ตำบลใน'+esc(subLbl):'ตำบลในลุ่มน้ำ'} (${ts.length})</h3><span class="note">คลิกเพื่อดูข้อมูลตำบล</span></div>
  <div class="chips">${ts.sort((x,y)=>(y.target-x.target)||x.t.localeCompare(y.t,'th')).map(t=>`<button class="chip" data-act="gotamfull" data-v="${t.id}" title="${esc(tamName(t))}"><i style="background:${t.target?'var(--blue)':'var(--p0)'}"></i>ต.${esc(t.t)}</button>`).join('')}</div>
  <div class="sec-h"><h3>แนวทาง/โครงการ${subLbl?'ที่ลง'+esc(subLbl):'ในลุ่มน้ำ'} (${fmt(pj.length)})</h3>${subLbl?'<span class="note">เฉพาะโครงการที่ระบุตำบลเป้าหมายในพื้นที่นี้</span>':''}</div>
  ${projTable('basin', pj, {noBasin:true, name:'ลุ่มน้ำสาขา'+b.name+(subLbl?'_'+subLbl:'')})}`;
}

/* ================= VIEW: MAP ================= */
let MAP=null, L_T=null, L_SB=null, L_PV=null, L_AM=null, L_RV=null, L_HS=null, L_BASE=null, L_LBL=null, GEO={};
let mapMode='target', mapStrat='all', L_PIE=null, mapSel=null, mapOp=.55, MF={active:false,cnt:{}};
const MS = {kind:'basin', basin:'', prov:'', amp:'', tam:'', lyr:{pv:false, am:false, tam:false}};
let L_PV2=null, L_AM2=null, L_TO=null;
const RIVER='#2a7fd4';
async function loadGeo(){
  if(GEO.t) return;
  const names=['tambon','subbasin','province','amphoe','river'];
  const res = await Promise.all(names.map(n=>fetch(DATA+n+'.geojson').then(r=>r.json())).concat([fetch(DATA+'hillshade_bounds.json').then(r=>r.json())]));
  GEO = {t:res[0], sb:res[1], pv:res[2], am:res[3], rv:res[4], hb:res[5]};
}
function projFilterActive(){ const f=S.f; return !!(f.q||f.s.size||f.F||f.S||f.src); }
function computeMF(){
  const cnt={}; filt(P).forEach(p=>(p.tambons||[]).forEach(id=>cnt[id]=(cnt[id]||0)+1));
  MF = {active: filterActive(), proj: projFilterActive(), cnt};
}
function tamMatch(t){
  if(!t) return false;
  const f=S.f;
  if(f.grp && !matchGrp(t.grp, f.grp)) return false;
  if(MF.proj && !MF.cnt[t.id]) return false;
  return true;
}
function inScope(t){
  if(!t) return false;
  if(MS.kind==='basin' && MS.basin && sbMain(t)!==MS.basin) return false;
  return (!MS.prov||t.p===MS.prov) && (!MS.amp||t.a===MS.amp) && (!MS.tam||t.id===MS.tam);
}
function pieSVG(list, d){
  const r = d/2, n = list.length;
  if(n===1) return `<svg width="${d}" height="${d}" viewBox="0 0 ${d} ${d}"><circle cx="${r}" cy="${r}" r="${r-1}" fill="${SHEX[list[0]]}" stroke="#fff" stroke-width="1.5"/></svg>`;
  let a0 = -Math.PI/2, paths = '';
  list.forEach(k=>{ const a1 = a0 + 2*Math.PI/n; const rr = r-1;
    const x0 = r+rr*Math.cos(a0), y0 = r+rr*Math.sin(a0), x1 = r+rr*Math.cos(a1), y1 = r+rr*Math.sin(a1);
    paths += `<path d="M${r},${r} L${x0.toFixed(2)},${y0.toFixed(2)} A${rr},${rr} 0 ${a1-a0>Math.PI?1:0} 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z" fill="${SHEX[k]}"/>`; a0 = a1; });
  return `<svg width="${d}" height="${d}" viewBox="0 0 ${d} ${d}">${paths}<circle cx="${r}" cy="${r}" r="${r-1}" fill="none" stroke="#fff" stroke-width="1.5"/></svg>`;
}
function refreshPies(){
  if(!MAP) return;
  if(L_PIE){ L_PIE.remove(); L_PIE=null; }
  if(!(mapMode==='strat' && mapStrat==='all')) return;
  const z = MAP.getZoom(); const d = z<8 ? 10 : z<9 ? 14 : z<10 ? 18 : 22;
  L_PIE = L.layerGroup();
  L_T.getLayers().forEach(l=>{ const t=T[l.feature.properties.id]; if(!t || !t.strat.length || !inScope(t) || !tamMatch(t)) return;
    L.marker(l.getBounds().getCenter(), {interactive:false, keyboard:false, icon:L.divIcon({className:'pie', html:pieSVG(t.strat,d), iconSize:[d,d], iconAnchor:[d/2,d/2]})}).addTo(L_PIE); });
  L_PIE.addTo(MAP);
}
function restyle(){ L_T.setStyle(tamStyle); refreshPies(); }
function tamStyle(f){
  const t = T[f.properties.id]; let fill='#cfd6e2', op=mapOp;
  if(mapMode==='target'){ fill = t?.target ? TGHEX : '#ffffff'; if(!t?.target) op = mapOp*.35; }
  else if(mapMode==='count'){ const n = MF.cnt[t.id]||0; const ramp=['#ffffff','#c6d7ee','#8fb0dd','#4f7fc2','#2c5ea5','#1d3766']; fill = ramp[n===0?0:n<=3?1:n<=6?2:n<=10?3:n<=15?4:5]; if(!n) op=mapOp*.35; }
  else if(mapMode==='strat' && mapStrat==='all'){ const n = t?.strat.length||0; fill = ['#ffffff','#e3e7ee','#c9d0dc','#a9b3c4','#8692a8','#6b7790'][n]; if(!n) op=mapOp*.35; }
  else if(mapMode==='strat'){ const on = t?.strat.includes(+mapStrat); fill = on ? SHEX[mapStrat] : '#ffffff'; if(!on) op=mapOp*.35; }
  if(!inScope(t) && mapSel!==f.properties.id) return {opacity:0, fillOpacity:0, weight:0};
  const live = tamMatch(t) || mapSel===f.properties.id;
  if(!live){ op = .04; }
  const sel = mapSel===f.properties.id;
  return {color: sel?'#c04a80':(live?'#ffffff':'#ffffff'), weight: sel?3:(live?.8:.3), opacity: live?.9:.35, fillColor:fill, fillOpacity:op};
}
function scopeBounds(){
  const lyr = L_T.getLayers().filter(l=>{ const t=T[l.feature.properties.id]; return inScope(t) && tamMatch(t); });
  if(!lyr.length) return null;
  return L.featureGroup(lyr).getBounds();
}
function fitScope(){
  let b = scopeBounds();
  if((!b || !b.isValid()) && MS.kind==='basin' && MS.basin){ const l = L_SB.getLayers().find(x=>x.feature.properties.name===MS.basin); if(l) b = l.getBounds(); }
  if(b && b.isValid()) MAP.fitBounds(b, {padding:[20,20], maxZoom:11});
}
function mapLabels(){
  if(L_LBL) L_LBL.remove();
  L_LBL = L.layerGroup();
  const add = (layer, text)=>{ const c = layer.getBounds().getCenter(); L.tooltip({permanent:true, direction:'center', className:'tlbl', interactive:false}).setLatLng(c).setContent(esc(text)).addTo(L_LBL); };
  if(MS.kind==='basin'){
    L_SB.getLayers().forEach(l=>{ const n=l.feature.properties.name; if(!MS.basin || MS.basin===n) add(l, n); });
  } else if(MS.prov){
    L_AM.getLayers().forEach(l=>{ const [p,a]=l.feature.properties.key.split('|'); if(p===MS.prov && (!MS.amp||MS.amp===a)) add(l, 'อ.'+a); });
  } else {
    L_PV.getLayers().forEach(l=>add(l, 'จ.'+l.feature.properties.name));
  }
  L_LBL.addTo(MAP); labelZoom();
}
function labelZoom(){ if(!L_LBL) return; const crowded = MS.kind==='basin' ? !MS.basin : !MS.prov; const show = !crowded || MAP.getZoom()>=8.75; show ? L_LBL.addTo(MAP) : L_LBL.remove(); }
function mapBoundaryLayers(){
  const basin = MS.kind==='basin';
  [L_SB].forEach(l=> basin ? l.addTo(MAP) : l.remove());
  [L_PV, L_AM].forEach(l=> basin ? l.remove() : l.addTo(MAP));
  L_SB.setStyle(f=>{ const hide = MS.basin && MS.basin!==f.properties.name; return {color:'#1d3766', weight: MS.basin?3:1.6, opacity: hide?0:1, fill:false}; });
  L_AM.setStyle(f=>{ const [p,a]=f.properties.key.split('|'); const hide = (MS.prov && MS.prov!==p) || (MS.amp && MS.amp!==a); return {color:'#1d3766', weight: MS.amp===a?3:.9, opacity: hide?0:.8, fill:false}; });
  L_PV.setStyle(f=>{ const hide = MS.prov && MS.prov!==f.properties.name; return {color:'#1d3766', weight: MS.prov?3:2, opacity: hide?0:1, dashArray:'6 4', fill:false}; });
  // ชั้นขอบเขตการปกครองเสริม (เปิด/ปิดได้ในโหมดลุ่มน้ำสาขา)
  const lyrs = [[L_TO,'tam'],[L_AM2,'am'],[L_PV2,'pv']];
  lyrs.forEach(([l,k])=>{ if(!l) return; (basin && MS.lyr[k]) ? l.addTo(MAP) : l.remove(); });
  L_RV.bringToFront();
}
function scopeTools(){
  const pool = M.tambons.filter(t=>t.geo && (MS.kind!=='basin' || !MS.basin || sbMain(t)===MS.basin));
  const provs = [...new Set(pool.map(t=>t.p))].sort((a,b)=>a.localeCompare(b,'th'));
  const amps = MS.prov ? [...new Set(pool.filter(t=>t.p===MS.prov).map(t=>t.a))].sort((a,b)=>a.localeCompare(b,'th')) : [];
  const tams = MS.amp ? pool.filter(t=>t.p===MS.prov&&t.a===MS.amp).sort((a,b)=>a.t.localeCompare(b.t,'th')) : [];
  const inB = MS.kind==='basin' && MS.basin;
  const lyrSel = MS.kind==='basin' ? `<div class="fld lyrfld"><span class="lbl">แสดงขอบเขตการปกครอง</span><div class="chips">
      <label class="chip"><input type="checkbox" data-lyr="pv" ${MS.lyr.pv?'checked':''}> จังหวัด</label>
      <label class="chip"><input type="checkbox" data-lyr="am" ${MS.lyr.am?'checked':''}> อำเภอ</label>
      <label class="chip"><input type="checkbox" data-lyr="tam" ${MS.lyr.tam?'checked':''}> ตำบล</label></div></div>` : '';
  const basinSel = MS.kind==='basin' ? `<div class="fld"><label for="msBasin">ลุ่มน้ำสาขา</label><select id="msBasin"><option value="">ทั้ง 30 ลุ่มน้ำสาขา</option>${M.basins.map(b=>`<option ${MS.basin===b.name?'selected':''}>${esc(b.name)}</option>`).join('')}</select></div>` : '';
  return basinSel + lyrSel + `<div class="fld"><label for="msProv">จังหวัด${inB?' (ในลุ่มน้ำนี้)':''}</label><select id="msProv"><option value="">${inB?`ทุกจังหวัดในลุ่มน้ำนี้ (${provs.length})`:'ทั้ง 6 จังหวัดในลุ่มน้ำปิง'}</option>${provs.map(p=>`<option ${MS.prov===p?'selected':''}>${esc(p)}</option>`).join('')}</select></div>
  <div class="fld"><label for="msAmp">อำเภอ</label><select id="msAmp" ${MS.prov?'':'disabled'}><option value="">${MS.prov?'ทุกอำเภอ':'เลือกจังหวัดก่อน'}</option>${amps.map(a=>`<option ${MS.amp===a?'selected':''}>${esc(a)}</option>`).join('')}</select></div>
  <div class="fld"><label for="msTam">ตำบล</label><select id="msTam" ${MS.amp?'':'disabled'}><option value="">${MS.amp?'ทุกตำบล':'เลือกอำเภอก่อน'}</option>${tams.map(t=>`<option value="${t.id}" ${MS.tam===t.id?'selected':''}>${esc(t.t)}${t.target?' (เป้าหมาย)':''}</option>`).join('')}</select></div>`;
}
function bindScope(){
  const on = (id, fn)=>{ const el=$('#'+id); if(el) el.onchange = e=>{ fn(e.target.value); afterScope(); }; };
  on('msBasin', v=>{ MS.basin=v; MS.prov=''; MS.amp=''; MS.tam=''; mapSel=null; });
  on('msProv', v=>{ MS.prov=v; MS.amp=''; MS.tam=''; mapSel=null; });
  on('msAmp', v=>{ MS.amp=v; MS.tam=''; mapSel=null; });
  on('msTam', v=>{ MS.tam=v; if(!v) mapSel=null; });
  $$('#mScope [data-lyr]').forEach(cb=>cb.onchange = ()=>{ MS.lyr[cb.dataset.lyr] = cb.checked; mapBoundaryLayers(); mapLegend(); });
}
function afterScope(){
  $('#mScope').innerHTML = scopeTools(); bindScope(); addClearButtons($('#mScope'));
  if(MS.kind!=='admin' || !MS.tam){ if(mapSel && !inScope(T[mapSel])) mapSel=null; }
  mapBoundaryLayers(); restyle(); mapLabels(); fitScope(); mapLegend(); mapProjects();
  const fc=$('#filters .fcount'); if(fc) fc.innerHTML = scopeCount();
  if(L_HS) L_HS.setOpacity((MS.basin && MS.kind==='basin') || MS.prov ? .5 : 1);
  if(MS.tam){ const l=L_T.getLayers().find(x=>x.feature.properties.id===MS.tam); if(l) MAP.fitBounds(l.getBounds(), {maxZoom:11, padding:[30,30]}); mapPick(MS.tam, true); }
}
async function renderMap(){
  const el = $('#view');
  computeMF();
  if(!$('#map')){
    el.innerHTML = `<div class="map-tools">
        <div class="fld"><span class="lbl">ดูตามขอบเขตพื้นที่</span><div class="seg" role="radiogroup">
          <button type="button" class="seg-b" data-act="mkind" data-v="basin" aria-pressed="${MS.kind==='basin'}">ลุ่มน้ำสาขา</button>
          <button type="button" class="seg-b" data-act="mkind" data-v="admin" aria-pressed="${MS.kind==='admin'}">จังหวัด › อำเภอ › ตำบล</button></div></div>
        <div id="mScope" style="display:contents"></div>
      </div>
      <div class="map-tools">
        <div class="fld"><label for="mMode">ระบายสีตำบลตาม</label><select id="mMode"><option value="target">พื้นที่เป้าหมาย</option><option value="count">จำนวนโครงการ</option><option value="strat">ยุทธศาสตร์ที่มีปัญหา</option></select></div>
        <div class="fld" id="mStratWrap" hidden><label for="mStrat">ยุทธศาสตร์</label><select id="mStrat"><option value="all" selected>แสดงครบทั้ง 5 ยุทธศาสตร์</option>${M.strategies.map(s=>`<option value="${s.n}">${s.n} ${esc(s.short)}</option>`).join('')}</select></div>
        <div class="fld"><label for="mOp">ความเข้มสีตำบล</label><input id="mOp" type="range" min="0" max="90" value="${Math.round(mapOp*100)}"></div>
        <label class="chip"><input type="checkbox" id="mHS" checked> ภูมิประเทศ (DEM)</label>
        ${CFG.basemap?`<div class="fld"><label for="mBase">แผนที่ฐาน</label><select id="mBase"><option value="gray">แผนที่สีเทา</option><option value="osm">OpenStreetMap</option><option value="sat">ภาพถ่ายดาวเทียม</option><option value="none">ไม่แสดง</option></select></div>`:''}
      </div>
      <div class="mapbox"><div style="min-width:0">
      <div id="map" role="region" aria-label="แผนที่ลุ่มน้ำปิง"></div>
      <div class="map-legend" id="mLegend"></div></div>
      <div id="mapSide" class="panel" style="min-width:0"><div class="panel-h"><h3>ข้อมูลตำบล</h3></div><div style="padding:14px" class="note">คลิกตำบลบนแผนที่เพื่อดูข้อมูลพื้นที่</div></div></div>
      <div id="mapProj"></div>`;
    $('#mScope').innerHTML = scopeTools();
    await loadGeo();
    MAP = L.map('map', {zoomSnap:.25, preferCanvas:true}).setView([17.6,99.1], 7.5);
    if(CFG.basemap){ setBase('gray'); }
    L_HS = L.imageOverlay(DATA+'hillshade.webp', GEO.hb, {opacity:1}).addTo(MAP);
    L_T = L.geoJSON(GEO.t, {style:tamStyle, onEachFeature:(f,l)=>{ const t=T[f.properties.id]; l.bindTooltip(t?`ต.${t.t} อ.${t.a}`:'', {sticky:true}); l.on('tooltipopen',()=>{ if(!inScope(t)) l.closeTooltip(); }); l.on('click',e=>{ if(inScope(t)) mapPick(f.properties.id, true, false, e.latlng); }); }}).addTo(MAP);
    L_PV = L.geoJSON(GEO.pv, {interactive:false});
    L_AM = L.geoJSON(GEO.am, {interactive:false});
    L_SB = L.geoJSON(GEO.sb, {interactive:false});
    L_TO = L.geoJSON(GEO.t, {interactive:false, style:{color:'#5a6880', weight:.7, opacity:.85, fill:false}});
    L_AM2 = L.geoJSON(GEO.am, {interactive:false, style:{color:'#7656a8', weight:1.4, opacity:.9, dashArray:'4 3', fill:false}});
    L_PV2 = L.geoJSON(GEO.pv, {interactive:false, style:{color:'#c04a80', weight:2.4, opacity:.95, dashArray:'8 5', fill:false}});
    L_RV = L.geoJSON(GEO.rv, {style:{color:RIVER, weight:2.2, opacity:.95}, interactive:false}).addTo(MAP);
    $('#mMode').onchange = e=>{ mapMode=e.target.value; $('#mStratWrap').hidden = mapMode!=='strat'; restyle(); mapLegend(); };
    $('#mStrat').onchange = e=>{ mapStrat=e.target.value; restyle(); mapLegend(); };
    $('#mOp').oninput = e=>{ mapOp = e.target.value/100; restyle(); };
    $('#mHS').onchange = e=> e.target.checked ? L_HS.addTo(MAP) : L_HS.remove();
    if($('#mBase')) $('#mBase').onchange = e=> setBase(e.target.value);
    MAP.on('zoomend', ()=>{ labelZoom(); refreshPies(); });
    afterScope();
    if(mapSel && !MS.tam) mapPick(mapSel, false);
  } else {
    restyle(); mapLegend(); mapProjects();
    if(MF.active) fitScope();
    setTimeout(()=>MAP.invalidateSize(),50);
  }
}
const BASES = {
  gray:['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}','แผนที่ฐาน © Esri',16],
  osm:['https://tile.openstreetmap.org/{z}/{x}/{y}.png','© OpenStreetMap contributors',19],
  sat:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}','ภาพถ่ายดาวเทียม © Esri, Maxar, Earthstar Geographics',18]
};
function setBase(k){
  if(L_BASE){ L_BASE.remove(); L_BASE=null; }
  const b = BASES[k]; if(!b) return;
  L_BASE = L.tileLayer(b[0], {attribution:b[1], maxZoom:b[2]}).addTo(MAP); L_BASE.bringToBack();
}
function mapProjects(){
  const el = $('#mapProj'); if(!el) return;
  let list, title;
  if(mapSel && T[mapSel]){
    const t = T[mapSel]; list = filt(IDX.byTam[mapSel]||[]);
    title = `โครงการที่ลง ต.${esc(t.t)} อ.${esc(t.a)} จ.${esc(t.p)}`;
  } else {
    const ids = new Set(M.tambons.filter(t=>inScope(t)).map(t=>t.id));
    list = filt(P).filter(p=>(MS.kind!=='basin' || !MS.basin || p.sb===MS.basin) && ((p.tambons||[]).some(id=>ids.has(id)) || (MS.kind==='basin' && MS.basin && !MS.prov && p.sb===MS.basin && !(p.tambons||[]).length)));
    const adm = MS.tam ? 'ต.'+esc(T[MS.tam].t)+' อ.'+esc(MS.amp) : MS.amp ? 'อ.'+esc(MS.amp)+' จ.'+esc(MS.prov) : MS.prov ? 'จ.'+esc(MS.prov) : '';
    const where = MS.kind==='basin' && MS.basin ? 'ลุ่มน้ำสาขา'+esc(MS.basin)+(adm?' · '+adm:'') : (adm || 'ทั้ง 6 จังหวัดในลุ่มน้ำปิง');
    title = `โครงการใน${where}`;
  }
  el.innerHTML = `<div class="sec-h"><h3>${title} (${fmt(list.length)})</h3><span class="note">${MF.active?'ตามตัวกรองด้านบน · ':''}${mapSel?'<button class="linkbtn" data-act="mapunsel">ดูโครงการทั้งพื้นที่ที่เลือก</button>':'คลิกตำบลบนแผนที่เพื่อดูเฉพาะตำบล'}</span></div>${projTable('map', list, {name: title.replace(/<[^>]+>/g,'').replace(/&amp;/g,'&')})}`;
}
function mapLegend(){
  let h='';
  if(mapMode==='target') h = `<span><i style="background:${TGHEX}"></i>พื้นที่เป้าหมาย (212 ตำบล)</span><span><i style="background:#ffffff"></i>ไม่ใช่พื้นที่เป้าหมาย</span>`;
  if(mapMode==='count') h = [['#ffffff','0'],['#c6d7ee','1–3'],['#8fb0dd','4–6'],['#4f7fc2','7–10'],['#2c5ea5','11–15'],['#1d3766','มากกว่า 15']].map(([c,l])=>`<span><i style="background:${c}"></i>${l} โครงการ</span>`).join('');
  if(mapMode==='strat' && mapStrat==='all') h = M.strategies.map(st=>`<span><i style="background:${SHEX[st.n]};border-radius:50%"></i>ยศ.${st.n} ${esc(st.short)}</span>`).join('') + `<span class="note">วงกลมในตำบลแบ่งสีตามยุทธศาสตร์ที่มีปัญหา · พื้นตำบลยิ่งเข้มยิ่งมีปัญหาหลายด้าน</span>`;
  else if(mapMode==='strat') h = `<span><i style="background:${SHEX[mapStrat]}"></i>มีปัญหาด้าน${esc(STRAT[mapStrat].short)}</span><span><i style="background:#ffffff"></i>ไม่พบปัญหาด้านนี้</span>`;
  if(MS.kind==='basin'){ if(MS.lyr.pv) h += `<span><i style="background:transparent;border:2px dashed #c04a80"></i>ขอบเขตจังหวัด</span>`; if(MS.lyr.am) h += `<span><i style="background:transparent;border:1.5px dashed #7656a8"></i>ขอบเขตอำเภอ</span>`; if(MS.lyr.tam) h += `<span><i style="background:transparent;border:1px solid #5a6880"></i>ขอบเขตตำบล</span>`; }
  h += `<span><i style="background:${RIVER};height:3px;border:0"></i>แม่น้ำปิงและลำน้ำสายหลัก</span><span><i style="background:transparent;border:2px solid #1d3766"></i>${MS.kind==='basin'?'ขอบเขตลุ่มน้ำสาขา':'ขอบเขตจังหวัด/อำเภอ'}</span>`;
  const n = M.tambons.filter(t=>t.geo && inScope(t) && tamMatch(t)).length;
  const fl = filt(P);
  const basinOnly = fl.filter(p=>!(p.tambons||[]).length && (MS.kind!=='basin' || !MS.basin || p.sb===MS.basin)).length;
  const note = MF.active
    ? `<div class="map-note">ตัวกรองทำงานอยู่ · แสดง <b>${fmt(n)}</b> ตำบลที่ตรงเงื่อนไข${MF.proj?` (มีโครงการตรงตัวกรอง)`:''} · ตำบลอื่นจางลง${MF.proj&&basinOnly?` · มีแนวทางระดับลุ่มน้ำที่ไม่ระบุตำบลอีก ${fmt(basinOnly)} รายการ`:''} <button class="linkbtn" data-act="clear">ล้างตัวกรอง</button></div>`
    : `<div class="map-note">แสดง ${fmt(n)} ตำบล · ใช้ตัวกรองด้านบน (ยุทธศาสตร์ แผนงาน มาตรการ กลุ่มพื้นที่ หรือคำค้น) เพื่อไฮไลต์ตำบลบนแผนที่</div>`;
  $('#mLegend').innerHTML = note + `<div style="display:flex;flex-wrap:wrap;gap:4px 14px">${h}</div>`;
}
function tamPopup(t){
  const n = (IDX.byTam[t.id]||[]).length, nf = MF.cnt[t.id]||0;
  return `<div class="pop"><b class="pop-t">ต.${esc(t.t)}</b><div class="pop-s">อ.${esc(t.a)} จ.${esc(t.p)}</div>
    <div class="pop-r">${tPill(t)}</div>
    ${t.strat.length?`<div class="pop-r">${t.strat.map(sPill).join(' ')}</div>`:''}
    ${t.grp.length?`<div class="pop-r"><span class="pop-k">กลุ่มพื้นที่</span> ${t.grp.join(', ')}</div>`:''}
    <div class="pop-r"><span class="pop-k">ลุ่มน้ำสาขา</span> ${esc(sbMain(t))}</div>
    <div class="pop-r"><span class="pop-k">โครงการ</span> <b>${fmt(n)}</b> รายการ${MF.proj?` · ตรงตัวกรอง ${fmt(nf)}`:''}</div>
    <button class="btn sm primary" data-act="gotamfull" data-v="${t.id}" style="margin-top:6px">เปิดหน้าตำบล</button></div>`;
}
function mapPick(id, noZoom, noPopup, latlng){
  mapSel = id; restyle();
  const t = T[id]; const pj = filt(IDX.byTam[id]||[]);
  const lyr = L_T.getLayers().find(l=>l.feature.properties.id===id);
  if(lyr){ lyr.bringToFront(); L_RV.bringToFront(); }
  if(lyr && !noZoom && !MAP.getBounds().contains(lyr.getBounds())) MAP.fitBounds(lyr.getBounds(), {maxZoom:11});
  if(lyr){ L.popup({maxWidth:280, autoPanPadding:[20,20]}).setLatLng(latlng || lyr.getBounds().getCenter()).setContent(tamPopup(t)).openOn(MAP); }
  $('#mapSide').innerHTML = `<div class="panel-h"><h3>ต.${esc(t.t)} อ.${esc(t.a)} จ.${esc(t.p)}</h3></div><div style="padding:4px 14px 14px">${tamInfo(t, true)}
    <div class="lbl" style="margin-top:10px">โครงการ</div><div><b class="num">${fmt(pj.length)}</b> รายการ${MF.proj?' (ตามตัวกรอง)':''} · <button class="linkbtn" data-act="mapgoproj">ดูรายการใต้แผนที่</button></div>
    <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap"><button class="btn sm primary" data-act="gotamfull" data-v="${id}">เปิดหน้าตำบล</button><button class="btn sm" data-act="newproj" data-tam="${id}">+ เสนอโครงการ</button></div></div>`;
  mapProjects();
}

/* ================= VIEW: ADMIN ================= */
/* ---------- กล่องรอพิจารณา / ถังไม่ผ่านอนุมัติ (ตาราง) ---------- */
function subLoc(x){ const ts=(x.tambons||[]).map(id=>T[id]).filter(Boolean); const u=a=>[...new Set(a)]; return {p:u(ts.map(t=>t.p)), a:u(ts.map(t=>t.a)), t:ts.map(t=>t.t)}; }
function subErrs(x){ return validateRec(subToVal(x), {proposer:true, legacy:true, allowNoGrp: !x.grp && !!(x.F||x.S)}); }
function adminInbox(){
  const tab=S.adminTab, list = tab==='rejected' ? REJ : SUBS;
  [...S.sel].forEach(id=>{ if(!list.some(x=>x._id===id)) S.sel.delete(id); });
  const nSel=S.sel.size, allSel = list.length && list.every(x=>S.sel.has(x._id));
  const dt = v => { const t=tsOf(v); return t ? new Date(t).toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'2-digit'})+'<br><span class="sub">'+new Date(t).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})+'</span>' : ''; };
  const rows = list.map((x,i)=>{ const L=subLoc(x), errs = tab==='pending' ? subErrs(x) : [], id=esc(x._id);
    const chk = errs.length ? `<span class="vbad" title="${esc(errs.map(e=>`${FIELD_LABEL[e.f]}: ${e.msg}`).join('\n'))}">⚠ ${errs.length} จุด</span><div class="verr">${errs.slice(0,3).map(e=>`<div>• <b>${esc(FIELD_LABEL[e.f])}</b> ${esc(e.msg)}</div>`).join('')}${errs.length>3?`<div class="sub">…และอีก ${errs.length-3} จุด</div>`:''}</div>` : '<span class="vok">✓ ครบถ้วน</span>';
    const acts = tab==='pending'
      ? `<button class="btn sm primary" data-act="approve" data-sid="${id}" ${errs.length?'disabled title="มีข้อผิดพลาด กด “ตรวจ/แก้ไข” ก่อนอนุมัติ"':''}>อนุมัติ</button><button class="btn sm" data-act="review" data-sid="${id}">ตรวจ/แก้ไข</button><button class="btn sm danger" data-act="reject" data-sid="${id}">ไม่อนุมัติ</button>`
      : `<button class="btn sm" data-act="restore" data-sid="${id}">นำกลับไปพิจารณา</button>`;
    return `<tr class="${S.sel.has(x._id)?'rsel':''} ${errs.length?'rbad':''}">
      <td class="cchk"><input type="checkbox" data-act="selsub" data-sid="${id}" ${S.sel.has(x._id)?'checked':''} aria-label="เลือกแถว ${i+1}"></td>
      <td class="num sub">${i+1}</td>
      <td class="num">${dt(tab==='rejected'?x.reviewedAt:x.createdAt)}</td>
      <td class="ttl"><button class="linkbtn" data-act="${tab==='pending'?'review':'viewsub'}" data-sid="${id}">${esc(x.title||'(ไม่มีชื่อ)')}</button>${x.detail?`<div class="sub clamp2">${esc(x.detail)}</div>`:''}</td>
      <td>${x.s?sPill(x.s):'<span class="sub">–</span>'}</td>
      <td class="grpc">${x.grp?`<span class="gcode f${'WPREG'.indexOf(x.grp[0])+1}">${esc(x.grp)}</span> <span>${esc(M.groups[x.grp]||'')}</span>`:esc([x.F,x.S].filter(Boolean).join(' / '))||'<span class="sub">–</span>'}</td>
      <td>${esc(L.p.join(', '))}</td><td>${esc(L.a.join(', '))}</td><td class="tamc">${esc(L.t.join(', '))}</td>
      <td>${esc(x.agency||'')}</td>
      <td class="num">${x.budget!=null&&x.budget!==''?toBaht(x.budget).toLocaleString('th-TH'):''}</td>
      <td class="num">${x.yearStart||x.yearEnd?`${esc(x.yearStart||'?')}–${esc(x.yearEnd||'?')}`:''}</td>
      <td>${esc(LEGACY[x.status]||x.status||'')}</td>
      <td>${propLine(x)}${x.proposerContact?`<div class="sub">${esc(x.proposerContact)}</div>`:''}</td>
      ${tab==='pending'?`<td class="vcol">${chk}</td>`:`<td>${esc(x.reason||'–')}</td><td class="sub">${esc(x.reviewedBy||'')}</td>`}
      <td class="acts-c">${acts}</td></tr>`; }).join('');
  const head = `<tr><th class="cchk"><input type="checkbox" data-act="selall" ${allSel?'checked':''} aria-label="เลือกทั้งหมด"></th><th>#</th><th>${tab==='rejected'?'วันที่ไม่อนุมัติ':'วันที่ส่ง'}</th><th>ชื่อแนวทาง/โครงการ</th><th>ยศ.</th><th>สภาพพื้นที่</th><th>จังหวัด</th><th>อำเภอ</th><th>ตำบล</th><th>หน่วยงานรับผิดชอบ</th><th>งบประมาณ (บาท)</th><th>ปี พ.ศ.</th><th>สถานะ</th><th>ผู้เสนอ</th>${tab==='pending'?'<th>ผลตรวจข้อมูล</th>':'<th>เหตุผลที่ไม่อนุมัติ</th><th>ผู้พิจารณา</th>'}<th>จัดการ</th></tr>`;
  const nBad = tab==='pending' ? SUBS.filter(x=>subErrs(x).length).length : 0;
  const tools = tab==='pending'
    ? `<button class="btn sm primary" data-act="approvesel" ${nSel?'':'disabled'}>อนุมัติที่เลือก${nSel?` (${nSel})`:''}</button><button class="btn sm danger" data-act="rejectsel" ${nSel?'':'disabled'}>ไม่อนุมัติที่เลือก${nSel?` (${nSel})`:''}</button>`
    : `<button class="btn sm" data-act="restoresel" ${nSel?'':'disabled'}>นำกลับไปพิจารณาที่เลือก${nSel?` (${nSel})`:''}</button>`;
  return `<div class="sec-h" style="margin-top:0"><h2>คัดกรองโครงการที่เสนอเข้ามา</h2><span class="note">โครงการจะแสดงให้ทุกคนเห็นเมื่อผู้ดูแลอนุมัติแล้วเท่านั้น</span></div>
  <div class="itabs" role="tablist"><button class="itab" role="tab" data-act="subtab" data-v="pending" aria-selected="${tab==='pending'}">กล่องรอพิจารณา <b>${SUBS.length}</b></button><button class="itab rej" role="tab" data-act="subtab" data-v="rejected" aria-selected="${tab==='rejected'}">ถังโครงการที่ไม่ผ่านอนุมัติ <b>${REJ.length}</b></button></div>
  <div class="ibox">
  ${list.length?`<div class="itools">${tools}<span class="sp"></span>${nBad?`<span class="vbad">⚠ มีข้อมูลต้องแก้ไข ${nBad} รายการ (อนุมัติไม่ได้จนกว่าจะแก้)</span>`:''}<button class="btn sm" data-act="subxls">ดาวน์โหลดรายการเป็น Excel</button></div>
  <div class="tbl-wrap itbl"><table><thead>${head}</thead><tbody>${rows}</tbody></table></div>`
  : `<div class="empty">${tab==='pending'?'ไม่มีโครงการรอพิจารณา':'ยังไม่มีโครงการที่ไม่ผ่านอนุมัติ'}</div>`}
  ${tab==='rejected'&&list.length?'<div class="note" style="margin-top:6px">โครงการในถังนี้ไม่แสดงในระบบ กด “นำกลับไปพิจารณา” เพื่อย้ายกลับไปกล่องรอพิจารณา</div>':''}
  </div>`;
}
function openRejectModal(list){
  const QUICK=['ข้อมูลไม่ครบถ้วน','อยู่นอกขอบเขตลุ่มน้ำปิง','ซ้ำกับโครงการที่มีอยู่แล้ว','ไม่สอดคล้องกับยุทธศาสตร์/สภาพพื้นที่','ข้อมูลไม่ถูกต้อง'];
  modal(`<div class="modal-h"><div><h2>ไม่อนุมัติ ${list.length>1?list.length+' โครงการ':'โครงการ'}</h2><div class="note">โครงการจะถูกย้ายไป “ถังโครงการที่ไม่ผ่านอนุมัติ” และนำกลับมาพิจารณาใหม่ได้</div></div><button class="x" data-act="close" aria-label="ปิด">×</button></div>
  <div class="modal-b">
    <div class="note-box">${list.slice(0,5).map(x=>'• '+esc(x.title)).join('<br>')}${list.length>5?`<br>…และอีก ${list.length-5} โครงการ`:''}</div>
    <div class="fld"><label for="rj_reason">เหตุผล (ไม่บังคับ)</label><textarea id="rj_reason" rows="3" maxlength="500"></textarea>
    <div class="qreason">${QUICK.map(q=>`<button type="button" class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div></div>
  </div>
  <div class="modal-f"><button class="btn" data-act="close">ยกเลิก</button><button class="btn danger" id="rj_ok">ยืนยันไม่อนุมัติ</button></div>`);
  $('.qreason').onclick = e=>{ const b=e.target.closest('[data-q]'); if(!b) return; const t=$('#rj_reason'); t.value = t.value ? t.value.replace(/\s*$/,'')+' · '+b.dataset.q : b.dataset.q; };
  $('#rj_ok').onclick = async ()=>{ const b=$('#rj_ok'); b.disabled=true; b.textContent='กำลังบันทึก…';
    try{ await Store.rejectMany(list, $('#rj_reason').value.trim()); list.forEach(x=>S.sel.delete(x._id)); closeModal(); toast(`ย้าย ${list.length} โครงการไปถังไม่ผ่านอนุมัติแล้ว`); renderView(); }
    catch(err){ b.disabled=false; b.textContent='ลองอีกครั้ง'; toast('ไม่สำเร็จ: '+err.message); } };
}
function subXlsx(){
  if(!window.XLSX){ toast('ยังโหลดตัวส่งออกไม่เสร็จ ลองใหม่อีกครั้ง'); return; }
  const rej=S.adminTab==='rejected', list=rej?REJ:SUBS;
  const rows=list.map((x,i)=>{ const L=subLoc(x); const o={'ลำดับ':i+1,'ชื่อแนวทาง/โครงการ':x.title,'รายละเอียด':x.detail||'','ยุทธศาสตร์':x.s?`${x.s} ${STRAT[x.s]?.short||''}`:'','สภาพพื้นที่':x.grp?`${x.grp} ${M.groups[x.grp]||''}`:'',
    'จังหวัด':L.p.join(', '),'อำเภอ':L.a.join(', '),'ตำบล':L.t.join(', '),'หน่วยงานรับผิดชอบ':x.agency||'','งบประมาณ (บาท)':toBaht(x.budget),'ปีเริ่ม (พ.ศ.)':x.yearStart||'','ปีสิ้นสุด (พ.ศ.)':x.yearEnd||'','สถานะ':LEGACY[x.status]||x.status||'','หมายเหตุ':x.note||'',
    'ผู้เสนอ':x.proposer||'','หน่วยงาน/ชุมชนผู้เสนอ':x.proposerOrg||'','ติดต่อ':x.proposerContact||'','วันที่ส่ง':tsOf(x.createdAt)?new Date(tsOf(x.createdAt)).toLocaleString('th-TH'):''};
    if(rej){ o['เหตุผลที่ไม่อนุมัติ']=x.reason||''; o['ผู้พิจารณา']=x.reviewedBy||''; } else { o['ผลตรวจข้อมูล']=subErrs(x).map(e=>`${FIELD_LABEL[e.f]}: ${e.msg}`).join('; ')||'ครบถ้วน'; } return o; });
  const ws=XLSX.utils.json_to_sheet(rows); ws['!cols']=[6,44,40,26,34,12,14,26,22,14,10,10,14,20,20,24,16,18,40].map(w=>({wch:w}));
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, rej?'ไม่ผ่านอนุมัติ':'รอพิจารณา');
  XLSX.writeFile(wb, `${rej?'โครงการไม่ผ่านอนุมัติ':'โครงการรอพิจารณา'}_ลุ่มน้ำปิง_${new Date().toISOString().slice(0,10)}.xlsx`);
}
function renderAdmin(){
  const el = $('#view');
  if(!S.admin && S.user && Store.mode!=='demo'){
    el.innerHTML = `<div class="info" style="max-width:760px"><h2>เข้าสู่ระบบสำเร็จ แต่บัญชียังไม่มีสิทธิ์ผู้ดูแล</h2>
      <p>รหัสผ่านถูกต้องแล้ว แต่ฐานข้อมูล Firebase ยังไม่รู้จักบัญชีนี้ว่าเป็นผู้ดูแล จึงยังอนุมัติ/แก้ไขไม่ได้ ต้องตั้งค่าใน Firebase Console หนึ่งครั้ง</p>
      <table class="kv"><tr><th>อีเมล</th><td>${esc(S.user.email||'-')}</td></tr>
      <tr><th>UID</th><td><code id="myUid">${esc(S.user.uid||'-')}</code> <button class="btn sm copyb" data-act="copyuid">คัดลอก</button></td></tr></table>
      <h3>วิธีแก้ (เลือกอย่างใดอย่างหนึ่ง)</h3>
      <ol class="steps-ol">
        <li><b>อัปเดตกฎความปลอดภัย (แนะนำ)</b> — เปิด <a href="https://console.firebase.google.com/project/ping-masterplan/firestore/rules" target="_blank" rel="noopener">Firestore → Rules</a> ลบของเดิมทั้งหมด วางเนื้อหาไฟล์ <code>firestore.rules</code> ฉบับล่าสุดใน GitHub แล้วกด <b>Publish</b> (กฎใหม่ให้สิทธิ์ผู้ดูแลกับอีเมล ${esc(CFG.adminEmail||'')} อัตโนมัติ)</li>
        <li><b>หรือเพิ่มรายชื่อผู้ดูแลเอง</b> — เปิด <a href="https://console.firebase.google.com/project/ping-masterplan/firestore/data" target="_blank" rel="noopener">Firestore → Data</a> กด Start collection ตั้งชื่อ <code>admins</code> → Document ID วาง UID ด้านบน → เพิ่มฟิลด์ <code>email</code> = อีเมลผู้ดูแล → Save</li>
      </ol>
      <p class="muted">ทำเสร็จแล้วกด “ตรวจสิทธิ์อีกครั้ง” ได้เลย ไม่ต้องออกจากระบบ</p>
      <button class="btn primary" data-act="recheck">ตรวจสิทธิ์อีกครั้ง</button>
      ${S.permErr?`<p class="muted" style="margin-top:10px">รหัสข้อผิดพลาด: ${esc(S.permErr)}</p>`:''}
</div>`;
    return;
  }
  if(!S.admin){
    el.innerHTML = `<div class="info" style="max-width:640px"><h2>สำหรับผู้ดูแลระบบ</h2>
      <p>หน้านี้ใช้คัดกรองและอนุมัติโครงการที่มีผู้เสนอเข้ามา รวมทั้งแก้ไขข้อมูลโครงการที่มีอยู่แล้ว ต้องเข้าสู่ระบบด้วยบัญชีผู้ดูแลก่อน</p>
      <button class="btn primary" data-act="login">เข้าสู่ระบบผู้ดูแล</button>
</div>`;
    return;
  }
  const inbox = adminInbox();
  const aud = AUDIT.slice(0,40).map(a=>{ const ts = a.ts?.seconds ? a.ts.seconds*1000 : a.ts; return `<tr><td class="num sub">${ts?new Date(ts).toLocaleString('th-TH'):''}</td><td>${esc(a.by)}</td><td>${esc(a.action)}</td><td class="num">${esc(a.id)}</td><td>${esc(a.detail)}</td></tr>`; }).join('');
  el.innerHTML = `${inbox}
  ${S.seedFallback?`<div class="info" style="margin-top:18px;border-color:var(--pink)"><h3>ฐานข้อมูลออนไลน์ยังว่าง</h3><p class="note">ตอนนี้หน้าเว็บแสดงข้อมูลตั้งต้นจากไฟล์ Excel แบบอ่านอย่างเดียว กดปุ่มนี้หนึ่งครั้งเพื่อนำเข้า ${fmt(SEED.length)} โครงการลงฐานข้อมูล ก่อนจึงจะแก้ไขได้</p><button class="btn pink" data-act="seed">นำเข้าข้อมูลตั้งต้น</button> <span id="seedProg" class="note"></span></div>`:''}
  ${!S.seedFallback && seedDiffCount() ? `<div class="info" style="margin-top:18px;border-color:var(--blue)"><h3>มีข้อมูลแผนแม่บทฉบับใหม่</h3><p class="note">โครงการในฐานข้อมูล ${fmt(seedDiffCount())} รายการต่างจากไฟล์ Excel ฉบับล่าสุด (เช่น แผนงาน มาตรการ ชื่อ หรือตำบลเป้าหมาย) กดอัปเดตเพื่อใช้ข้อมูลตามไฟล์ใหม่ · ระบบจะคงสถานะ หน่วยงาน งบประมาณ ปี และหมายเหตุที่ผู้ดูแลกรอกไว้ และไม่แตะโครงการที่เพิ่มใหม่ผ่านเว็บ</p><button class="btn primary" data-act="syncseed">อัปเดตตาม Excel ฉบับใหม่</button> <span id="syncProg" class="note"></span></div>` : ''}
  <div class="sec-h"><h2>เครื่องมือข้อมูล</h2></div>
  <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-act="export">ส่งออกโครงการเป็น Excel</button>${Store.mode==='demo'?'<button class="btn danger" data-act="demoreset">ล้างข้อมูลทดลองในเบราว์เซอร์นี้</button>':''}</div>
  <div id="resetBox"></div>
  <div class="sec-h"><h2>ประวัติการแก้ไขล่าสุด</h2></div>
  ${aud?`<div class="tbl-wrap"><table><thead><tr><th>เวลา</th><th>ผู้ดำเนินการ</th><th>การดำเนินการ</th><th>รหัส</th><th>รายละเอียด</th></tr></thead><tbody>${aud}</tbody></table></div>`:'<div class="empty">ยังไม่มีประวัติ</div>'}`;
}

/* ================= PROJECT DETAIL & FORM ================= */
function modal(html, cls='', locked=false){
  closeModal();
  const bg = document.createElement('div'); bg.className='modal-bg'; bg.id='modalBg';
  bg.innerHTML = `<div class="modal ${cls}" role="dialog" aria-modal="true">${html}</div>`;
  if(locked) bg.dataset.locked='1';
  bg.addEventListener('click', e=>{ if(e.target===bg && !locked) closeModal(); });
  document.body.appendChild(bg);
  const f = bg.querySelector('input,select,textarea,button.btn'); if(f) f.focus();
}
function closeModal(){ $('#modalBg')?.remove(); }
function openProject(id){
  const p = P.find(x=>x.id===id); if(!p) return;
  const tams = (p.tambons||[]).map(i=>T[i]).filter(Boolean);
  const grp = [...projGroups(p)].sort();
  modal(`<div class="modal-h"><div><div class="note">${esc(p.id)} · ${p.src==='new'?'เพิ่มใหม่':'จากแผนแม่บท'}</div><h2>${esc(p.title)}</h2></div><button class="x" data-act="close" aria-label="ปิด">×</button></div>
  <div class="modal-b">
    <dl class="dl" style="margin:0">
      <dt>ยุทธศาสตร์</dt><dd>${sPill(p.s)} ${esc(STRAT[p.s]?.short||'')}</dd>
      ${p.grp?`<dt>สภาพพื้นที่</dt><dd><span class="pill code">${esc(p.grp)}</span> ${esc(M.groups[p.grp]||'')}</dd>`:''}
      ${p.F?`<dt>แผนงานหลัก</dt><dd>${String(p.F).split(/,\s*/).map(f=>`<span class="pill code">${esc(f)}</span> ${esc(PROG[f]?.name||'')}`).join('<br>')}</dd>`:''}
      ${p.S?`<dt>มาตรการเชิงยุทธศาสตร์</dt><dd><span class="pill code">${esc(p.S)}</span> ${esc(MEAS[p.S]?.name||'')}${MEAS[p.S]?.desc?`<div class="note">${esc(MEAS[p.S].desc)}</div>`:''}</dd>`:''}
      <dt>ลุ่มน้ำสาขา</dt><dd><button class="linkbtn" data-act="gobasin" data-v="${esc(p.sb)}">${esc(p.sb)}</button></dd>
      ${p.ref?`<dt>ตารางอ้างอิง</dt><dd>${esc(p.ref)}</dd>`:''}
      <dt>รายละเอียด</dt><dd style="white-space:pre-line">${esc(p.detail||p.title)}</dd>
      <dt>ตำบลเป้าหมาย</dt><dd>${tams.length ? tams.map(t=>`<button class="linkbtn" data-act="gotamfull" data-v="${t.id}">${esc(tamName(t))}</button>`).join('<br>') : 'ไม่มีตำบลเป้าหมายตามยุทธศาสตร์นี้ (แนวทางระดับลุ่มน้ำสาขา)'}</dd>
      <dt>กลุ่มพื้นที่</dt><dd>${grp.length ? grp.map(g=>`<span class="pill code" title="${esc(M.groups[g]||'')}">${g}</span>`).join(' ') : (MEAS[p.S]?.groups?`<span class="note">ตามมาตรการ: ${esc(MEAS[p.S].groups)}</span>`:'–')}</dd>
      <dt>หน่วยงานรับผิดชอบ</dt><dd>${esc(p.agency)||'–'}</dd>
      <dt>งบประมาณ</dt><dd class="num">${fmtBaht(p.budget)}</dd>
      <dt>ระยะเวลา</dt><dd class="num">${p.yearStart||p.yearEnd?`พ.ศ. ${esc(p.yearStart||'?')} – ${esc(p.yearEnd||'?')}`:'–'}</dd>
      <dt>สถานะ</dt><dd>${stageOf(p)==='ยังไม่ระบุ'?'<span class="note">ยังไม่ระบุ</span>':esc(stageOf(p))}</dd>
      ${p.note?`<dt>หมายเหตุ</dt><dd>${esc(p.note)}</dd>`:''}
      ${p.proposer?`<dt>ผู้เสนอ</dt><dd>${esc(p.proposer)} · ${esc(p.proposerOrg)}</dd>`:''}
      ${p.updatedBy?`<dt>แก้ไขล่าสุด</dt><dd class="note">${esc(p.updatedBy)} · ${new Date(p.updatedAt).toLocaleString('th-TH')}</dd>`:''}
    </dl>
    <div id="delBox"></div>
  </div>
  <div class="modal-f">${S.admin?`<button class="btn danger" data-act="del" data-pid="${p.id}">ลบโครงการ</button><button class="btn primary" data-act="edit" data-pid="${p.id}">แก้ไขข้อมูล</button>`:`<span class="note" style="margin-right:auto">ผู้ดูแลระบบเท่านั้นที่แก้ไขข้อมูลได้</span>`}<button class="btn" data-act="close">ปิด</button></div>`);
}

/* ---------- งบประมาณ (เก็บในฐานข้อมูลเป็นล้านบาท แสดง/กรอกเป็นบาท) ---------- */
const toBaht = m => (m==null || m==='') ? null : Math.round(+m*1e6);
const fmtBaht = m => { const b=toBaht(m); return b==null ? '–' : b.toLocaleString('th-TH')+' บาท'; };
const parseBaht = v => { const t=String(v??'').replace(/[,\s]|บาท/g,''); if(t==='') return null; const n=Number(t); return isFinite(n) ? n : NaN; };
const STATUS_HELP = {'เตรียมการ':'ยังไม่เริ่มดำเนินการ — อยู่ระหว่างคิดโครงการ ศึกษา ออกแบบ หรือเสนอขอรับงบประมาณ (โครงการที่ยื่นเสนอใหม่ส่วนใหญ่เลือกข้อนี้)',
  'กำลังดำเนินการ':'ได้รับงบประมาณและเริ่มดำเนินการแล้ว', 'โครงการต่อเนื่อง':'ดำเนินการมาแล้วในปีก่อน และเสนอเพื่อดำเนินการต่อในระยะถัดไป', 'แล้วเสร็จ':'ดำเนินการเสร็จสิ้นแล้ว'};
/* ---------- ตรวจความถูกต้องของข้อมูลโครงการ (ใช้ทั้งฟอร์ม Excel และกล่องรอพิจารณา) ---------- */
const FIELD_LABEL = {ptype:'ผู้เสนอเป็น', org:'ชื่อหน่วยงาน/องค์กร', contact:'อีเมลหรือโทรศัพท์', tambons:'ตำบล', s:'ยุทธศาสตร์', grp:'สภาพพื้นที่', title:'ชื่อแนวทาง/โครงการ', detail:'รายละเอียด', agency:'หน่วยงานรับผิดชอบ', budget:'งบประมาณ (บาท)', yearStart:'ปีเริ่ม (พ.ศ.)', yearEnd:'ปีสิ้นสุด (พ.ศ.)', status:'สถานะ'};
function validateRec(r, o={}){
  // r: {s, grp, title, detail, tambons, agency, budgetBaht, yearStart, yearEnd, status, proposer, proposerOrg, proposerContact}
  const E=[]; const add=(f,msg)=>E.push({f,msg});
  if(o.proposer){
    if(!r.proposer) add('ptype','กรุณาเลือกประเภทผู้เสนอ');
    else if(!PROPOSER_TYPES.includes(r.proposer) && !o.legacy) add('ptype','ประเภทผู้เสนอไม่อยู่ในรายการ');
    if(r.proposer && r.proposer!==CITIZEN && !(r.proposerOrg||'').trim()) add('org','กรุณากรอกชื่อหน่วยงาน/องค์กร');
    else if((r.proposerOrg||'').length>200) add('org','ชื่อหน่วยงานยาวเกิน 200 ตัวอักษร');
    const c=(r.proposerContact||'').trim();
    if(c && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c) && !/^[0-9+\-()\s]{9,20}$/.test(c)) add('contact','รูปแบบไม่ถูกต้อง — ใส่อีเมล (เช่น name@mail.com) หรือเบอร์โทร 9–10 หลัก');
  }
  if(!o.allowNoTambon && !(r.tambons||[]).length) add('tambons','กรุณาเลือกตำบลอย่างน้อย 1 ตำบล');
  if((r.tambons||[]).length>120) add('tambons','เลือกได้ไม่เกิน 120 ตำบลต่อโครงการ');
  if((r.tambons||[]).some(id=>!T[id])) add('tambons','มีรหัสตำบลที่ไม่อยู่ในลุ่มน้ำปิง');
  if(!r.s) add('s','กรุณาเลือกยุทธศาสตร์');
  if(!r.grp){ if(!o.allowNoGrp) add('grp', r.s ? 'กรุณาเลือกสภาพพื้นที่' : 'เลือกยุทธศาสตร์ก่อน แล้วเลือกสภาพพื้นที่'); }
  else if(!M.groups[r.grp]) add('grp',`ไม่มีรหัสสภาพพื้นที่ ${r.grp}`);
  else if(r.s && r.grp[0]!==famOf(r.s)) add('grp',`สภาพพื้นที่ ${r.grp} ไม่อยู่ในยุทธศาสตร์ที่ ${r.s} (ต้องเป็นรหัส ${famOf(r.s)})`);
  const t=(r.title||'').trim();
  if(!t) add('title','กรุณากรอกชื่อแนวทาง/โครงการ'); else if(t.length<5) add('title','ชื่อสั้นเกินไป (อย่างน้อย 5 ตัวอักษร)'); else if(t.length>300) add('title','ชื่อยาวเกิน 300 ตัวอักษร');
  if((r.detail||'').length>3000) add('detail','รายละเอียดยาวเกิน 3,000 ตัวอักษร');
  if((r.agency||'').length>200) add('agency','ชื่อหน่วยงานยาวเกิน 200 ตัวอักษร');
  const b=r.budgetBaht;
  if(b!=null){ if(Number.isNaN(b)) add('budget','ใส่เป็นตัวเลขเท่านั้น เช่น 250000 หรือ 1,250,000'); else if(b<0) add('budget','งบประมาณต้องไม่ติดลบ'); else if(b>0 && b<100) add('budget','ตัวเลขน้อยผิดปกติ — กรอกเป็นหน่วย “บาท” เช่น 1.5 ล้านบาท ให้กรอก 1500000'); else if(b>1e11) add('budget','ตัวเลขสูงผิดปกติ — ตรวจหน่วย (บาท)'); }
  const yr=(k,lbl)=>{ const v=r[k]; if(v==null||v==='') return null; if(Number.isNaN(+v)||!Number.isInteger(+v)) { add(k,`${lbl}ต้องเป็นตัวเลขปี พ.ศ. เช่น 2570`); return null; } if(+v<2500) { add(k,`ใช้ปี พ.ศ. ไม่ใช่ ค.ศ. (เช่น 2570)`); return null; } if(+v<2560||+v>2600){ add(k,`${lbl}ควรอยู่ระหว่าง 2560–2600`); return null; } return +v; };
  const ys=yr('yearStart','ปีเริ่ม'), ye=yr('yearEnd','ปีสิ้นสุด');
  if(ys&&ye&&ye<ys) add('yearEnd','ปีสิ้นสุดต้องไม่น้อยกว่าปีเริ่ม');
  if(r.status && !STATUS_OPTS.includes(LEGACY[r.status]||r.status)) add('status',`สถานะ “${r.status}” ไม่อยู่ในตัวเลือก`);
  return E;
}
const subToVal = x => Object.assign({}, x, {budgetBaht: toBaht(x.budget)});
/* ---------- ฟอร์มเสนอ/แก้ไขโครงการ ---------- */
const PROPOSER_TYPES = ['หน่วยงานภาครัฐ','องค์กรปกครองส่วนท้องถิ่น','ภาคเอกชน/สถาบันการศึกษา','ชุมชน/กลุ่มองค์กร','ประชาชนทั่วไป'];
const CITIZEN = 'ประชาชนทั่วไป';
const famOf = s => 'WPREG'[s-1];
const grpKeys = s => { const fam=famOf(s); return fam ? Object.keys(M.groups).filter(k=>k[0]===fam).sort((a,b)=>+a.slice(1)-+b.slice(1)) : []; };
const pingTams = () => M.tambons.filter(t=>t.sb && t.sb.length);
// ลุ่มน้ำสาขาหลักของชุดตำบล = ลุ่มน้ำที่ตำบลส่วนใหญ่สังกัด (ตามพื้นที่มากที่สุดของแต่ละตำบล)
function basinOfTams(ids){ const c={}; ids.forEach(id=>{ const b=T[id]?.sb?.[0]; if(b) c[b]=(c[b]||0)+1; }); return Object.entries(c).sort((a,b)=>b[1]-a[1])[0]?.[0] || ''; }
function propLine(x){ const t=x.proposer||'', o=String(x.proposerOrg||''); const rest=o.startsWith(t+' · ')?o.slice(t.length+3):(o===t?'':o); return esc(t)+(rest?' · '+esc(rest):''); }
function grpOptLabel(k){ return `${k} ${M.groups[k]} : ${GROUP_DESC[k]||''}`; }

function openForm(mode, data={}, sub=null){
  // mode: new | edit | review
  const d = Object.assign({sb:'', s:'', F:'', S:'', grp:'', title:'', detail:'', tambons:[], agency:'', budget:'', yearStart:'', yearEnd:'', status:'', note:'', ref:'', proposer:'', proposerOrg:'', proposerContact:''}, data);
  const title = mode==='new' ? 'เสนอแนวทาง/โครงการใหม่' : mode==='edit' ? `แก้ไขโครงการ ${d.id}` : 'ตรวจและแก้ไขก่อนอนุมัติ';
  const isCit0 = d.proposer===CITIZEN;
  const proposerSec = mode==='new' ? `<div class="formsec">ผู้เสนอ</div>
    <div class="form-grid">
      <div class="fld full"><label class="req" for="ff_ptype">ผู้เสนอเป็น</label><select id="ff_ptype"><option value="">เลือกประเภทผู้เสนอ</option>${PROPOSER_TYPES.map(t=>`<option>${t}</option>`).join('')}</select></div>
      <div class="fld full" id="ff_orgBox"><label class="req" for="ff_proposerOrg">ชื่อหน่วยงาน/องค์กร</label><input id="ff_proposerOrg" placeholder="เช่น อบต.แม่แตง, สำนักงานชลประทานที่ 1"></div>
      <div class="fld full" id="ff_citBox" hidden><label for="ff_community">หมู่บ้าน/ชุมชนที่อาศัย (ถ้ามี)</label><input id="ff_community" placeholder="เช่น บ้านป่าไผ่ หมู่ 3"><div class="note">ประชาชนไม่ต้องระบุชื่อ–นามสกุล แนะนำให้ใส่ช่องทางติดต่อกลับ เพื่อให้เจ้าหน้าที่สอบถามรายละเอียดเพิ่มเติมได้</div></div>
      <div class="fld full"><label for="ff_proposerContact">อีเมลหรือโทรศัพท์สำหรับติดต่อกลับ</label><input id="ff_proposerContact" placeholder="ไม่บังคับ"></div></div>`
    : mode==='review' ? `<div class="formsec">ผู้เสนอ</div><div class="note-box">${propLine(d)||'-'}${d.proposerContact?' · ติดต่อ '+esc(d.proposerContact):''}</div>` : '';
  const provs = [...new Set(pingTams().map(t=>t.p))].sort((a,b)=>a.localeCompare(b,'th'));
  modal(`<div class="modal-h"><div><h2>${title}</h2>${mode==='new'?'<div class="note">ผู้ดูแลระบบจะตรวจสอบก่อนแสดงในระบบ</div>':''}</div><button class="x" data-act="close" aria-label="ปิด">×</button></div>
  <div class="modal-b">
  ${proposerSec}
  ${mode==='new'?`<div class="formsec">วิธีเสนอ <span class="note">(กดเลือก 1 แบบ)</span></div><div class="mpick" role="radiogroup" aria-label="วิธีเสนอ">
    <button type="button" class="mcard m1" id="ff_m1" role="radio" aria-checked="true"><span class="mic">✎</span><span class="mtx"><b>กรอกทีละโครงการ</b><small>กรอกในหน้าเว็บ เหมาะกับ 1–5 โครงการ</small></span><span class="mchk" aria-hidden="true">✓</span></button>
    <button type="button" class="mcard m2" id="ff_m2" role="radio" aria-checked="false"><span class="mic">⊞</span><span class="mtx"><b>นำเข้าจาก Excel</b><small>หลายโครงการในครั้งเดียว (สูงสุด 300)</small></span><span class="mchk" aria-hidden="true">✓</span></button></div>`:''}
  <form id="pform" class="pform" novalidate>
    <div class="formsec">พื้นที่ดำเนินการ</div><div class="form-grid">
      <div class="fld"><label class="req" for="ff_prov">จังหวัด</label><select id="ff_prov"><option value="">เลือกจังหวัด</option>${provs.map(p=>`<option>${esc(p)}</option>`).join('')}</select></div>
      <div class="fld"><label class="req" for="ff_amp">อำเภอ</label><select id="ff_amp" disabled><option value="">เลือกจังหวัดก่อน</option></select></div>
      <div class="fld full"><span class="lbl req">ตำบล <span class="note">(เลือกได้หลายตำบล · เปลี่ยนอำเภอเพื่อเพิ่มตำบลจากอำเภออื่นได้)</span></span>
        <div class="tam-tools" id="ff_tamTools" hidden><button type="button" class="linkbtn" id="ff_allAmp">เลือกทุกตำบลในอำเภอนี้</button> · <button type="button" class="linkbtn" id="ff_clrAmp">ล้างตำบลในอำเภอนี้</button></div>
        <div class="tam-pick" id="ff_tams"><div class="note" style="padding:6px 10px">เลือกจังหวัดและอำเภอก่อน</div></div>
        <div class="picked" id="ff_picked"></div>
        <div class="note" id="ff_basin"></div></div>
    </div>
    <div class="formsec">ยุทธศาสตร์และสภาพพื้นที่</div><div class="form-grid">
      <div class="fld full"><label class="req" for="ff_s">ยุทธศาสตร์</label><select id="ff_s"><option value="">เลือกยุทธศาสตร์</option>${M.strategies.map(s=>`<option value="${s.n}" ${+d.s===s.n?'selected':''}>ยุทธศาสตร์ที่ ${s.n} ${esc(s.short)}</option>`).join('')}</select></div>
      <div class="fld full"><label class="${mode==='edit'?'':'req'}" for="ff_gpBtn">สภาพพื้นที่</label><input type="hidden" id="ff_grp_sel" value="">
        <div class="gpick" id="ff_gpick"><button type="button" class="gp-btn" id="ff_gpBtn" aria-haspopup="listbox" aria-expanded="false"></button><div class="gp-list" id="ff_gpList" role="listbox" hidden></div></div>
        <div class="grp-desc" id="ff_grpDesc" hidden></div>
        <div class="note" id="ff_grpHint"></div></div>
      ${d.F||d.S?`<div class="fld full note">แผนงาน/มาตรการเดิมจากแผนแม่บท: ${esc([d.F,d.S].filter(Boolean).join(' / '))} (คงไว้ตามเดิม)</div>`:''}
    </div>
    <div class="formsec">รายละเอียดแนวทาง/โครงการ</div><div class="form-grid">
      <div class="fld full"><label class="req" for="ff_title">ชื่อแนวทาง/โครงการ</label><input id="ff_title" maxlength="300" value="${esc(d.title)}"></div>
      <div class="fld full"><label for="ff_detail">รายละเอียดเพิ่มเติม</label><textarea id="ff_detail" rows="3" maxlength="3000" placeholder="ปัญหาที่พบ สิ่งที่จะทำ ประโยชน์ที่ได้รับ">${esc(d.detail)}</textarea></div>
    </div>
    <div class="formsec">ข้อมูลประกอบ</div><div class="form-grid">
      <div class="fld"><label for="ff_agency">หน่วยงานรับผิดชอบ</label><input id="ff_agency" value="${esc(d.agency)}"></div>
      <div class="fld"><label for="ff_budget">งบประมาณ (บาท)</label><input id="ff_budget" inputmode="decimal" placeholder="เช่น 250,000" value="${d.budget!=null&&d.budget!==''?toBaht(d.budget).toLocaleString('en-US'):''}"><div class="note" id="ff_budgetHint"></div></div>
      <div class="fld"><label for="ff_yearStart">ปีเริ่ม (พ.ศ.)</label><input id="ff_yearStart" type="number" min="2560" max="2600" value="${esc(d.yearStart??'')}"></div>
      <div class="fld"><label for="ff_yearEnd">ปีสิ้นสุด (พ.ศ.)</label><input id="ff_yearEnd" type="number" min="2560" max="2600" value="${esc(d.yearEnd??'')}"></div>
      <div class="fld"><label for="ff_status">สถานะ</label><select id="ff_status"><option value="">ไม่ระบุ</option>${STATUS_OPTS.map(o=>`<option ${((LEGACY[d.status]||d.status)||(mode==='new'?'เตรียมการ':''))===o?'selected':''}>${o}</option>`).join('')}</select><div class="note" id="ff_statusHint"></div></div>
      <div class="fld full"><label for="ff_note">หมายเหตุ</label><input id="ff_note" value="${esc(d.note)}"></div>
    </div>
    <div class="err" id="ff_err" role="alert"></div>
  </form>
  ${mode==='new'?`<div id="xform" hidden>${xlsPanel()}</div>`:''}
  </div>
  <div class="modal-f"><button class="btn" data-act="close">ยกเลิก</button><button class="btn ${mode==='new'?'pink':'primary'}" id="ff_save">${mode==='new'?'ส่งให้ผู้ดูแลพิจารณา':mode==='edit'?'บันทึกการแก้ไข':'อนุมัติและบันทึกลงระบบ'}</button></div>`);

  let picked = new Set(d.tambons||[]);
  /* ผู้เสนอ */
  const ptype = ()=>$('#ff_ptype')?.value || '';
  const proposerInfo = ()=>{ const t=ptype(), cit=t===CITIZEN; const com=($('#ff_community')?.value||'').trim();
    return {proposer:t, proposerOrg: cit ? (CITIZEN+(com?' · '+com:'')) : ($('#ff_proposerOrg')?.value||'').trim(), proposerContact:($('#ff_proposerContact')?.value||'').trim()}; };
  if(mode==='new'){
    $('#ff_ptype').onchange=()=>{ const cit=ptype()===CITIZEN; $('#ff_orgBox').hidden=cit; $('#ff_citBox').hidden=!cit; };
    const setM = x=>{ $('#ff_m1').setAttribute('aria-checked',x===1); $('#ff_m2').setAttribute('aria-checked',x===2); $('#pform').hidden=x!==1; $('#xform').hidden=x!==2; $('#ff_save').hidden=x!==1; };
    $('#ff_m1').onclick=()=>setM(1); $('#ff_m2').onclick=()=>setM(2);
    xlsBind(proposerInfo);
  }
  /* พื้นที่: จังหวัด → อำเภอ → ตำบล */
  const fillAmp = ()=>{ const p=$('#ff_prov').value, sel=$('#ff_amp');
    if(!p){ sel.innerHTML='<option value="">เลือกจังหวัดก่อน</option>'; sel.disabled=true; return; }
    const amps=[...new Set(pingTams().filter(t=>t.p===p).map(t=>t.a))].sort((a,b)=>a.localeCompare(b,'th'));
    sel.disabled=false; sel.innerHTML='<option value="">เลือกอำเภอ</option>'+amps.map(a=>`<option>${esc(a)}</option>`).join(''); };
  const ampTams = ()=>{ const p=$('#ff_prov').value, a=$('#ff_amp').value; return p&&a ? pingTams().filter(t=>t.p===p&&t.a===a) : []; };
  const fillT = ()=>{ const s=+$('#ff_s').value, ts=ampTams().sort((x,y)=>(y.strat.includes(s)-x.strat.includes(s))||(y.target-x.target)||x.t.localeCompare(y.t,'th'));
    $('#ff_tamTools').hidden=!ts.length;
    $('#ff_tams').innerHTML = ts.length ? ts.map(t=>`<label><input type="checkbox" value="${t.id}" ${picked.has(t.id)?'checked':''}> ${s&&t.strat.includes(s)?'★ ':''}ต.${esc(t.t)} ${t.target?'<span class="pill tg">เป้าหมาย</span>':''}</label>`).join('') : `<div class="note" style="padding:6px 10px">${$('#ff_prov').value?'เลือกอำเภอ':'เลือกจังหวัดและอำเภอก่อน'}</div>`;
    showPicked(); };
  const showPicked = ()=>{ const ids=[...picked].filter(id=>T[id]);
    $('#ff_picked').innerHTML = ids.length ? `<span class="lbl">ตำบลที่เลือก ${ids.length} ตำบล:</span> `+ids.map(id=>`<span class="pchip">ต.${esc(T[id].t)} อ.${esc(T[id].a)} จ.${esc(T[id].p)}<button type="button" data-rm="${id}" aria-label="เอาออก">×</button></span>`).join('') : '';
    const sb = ids.length ? basinOfTams(ids) : d.sb;
    $('#ff_basin').textContent = sb ? `ลุ่มน้ำสาขา (ระบบกำหนดจากตำบลที่เลือก): ${sb}` : '';
    fillG(); };
  /* สภาพพื้นที่ */
  const gItem = (k,inT,tag='button')=>`<${tag} ${tag==='button'?`type="button" class="gp-item" role="option" data-k="${k}" aria-selected="${d.grp===k}"`:'class="gp-sel"'}><span class="gcode f${'WPREG'.indexOf(k[0])+1}">${k}</span><span class="gtx"><b class="gname">${esc(M.groups[k])}${inT&&inT.has(k)?' <span class="gstar" title="พบในตำบลที่เลือก">★</span>':''}</b><span class="gcond">${esc(GROUP_DESC[k]||'')}</span></span></${tag}>`;
  const fillG = ()=>{ const s=+$('#ff_s').value, btn=$('#ff_gpBtn'), list=$('#ff_gpList');
    const inT=new Set(); picked.forEach(id=>(T[id]?.grp||[]).forEach(c=>inT.add(c)));
    const ks=grpKeys(s); if(d.grp && !ks.includes(d.grp)) d.grp='';
    $('#ff_grp_sel').value=d.grp||'';
    btn.disabled=!s; list.hidden=true; btn.setAttribute('aria-expanded','false');
    btn.innerHTML = !s ? '<span class="gp-ph">เลือกยุทธศาสตร์ก่อน</span>' : d.grp ? gItem(d.grp,inT,'span') : '<span class="gp-ph">กดเพื่อเลือกสภาพพื้นที่</span>';
    list.innerHTML = ks.map(k=>gItem(k,inT)).join('');
    $('#ff_grpHint').textContent = !s ? 'เลือกยุทธศาสตร์ก่อน แล้วจึงเลือกสภาพพื้นที่ของยุทธศาสตร์นั้น' : ks.some(k=>inT.has(k)) ? '★ = พบสภาพพื้นที่นี้ในตำบลที่เลือก (จากการวิเคราะห์ในแผนแม่บท)' : '';
    descG(); };
  const descG = ()=>{ const k=d.grp, box=$('#ff_grpDesc'); box.hidden=!k; if(k) box.innerHTML=`<span class="gd-l">แนวทางที่เหมาะสมกับสภาพพื้นที่นี้</span>${esc(M.groupInfo?.[k]?.plan||'')}`; };
  $('#ff_gpBtn').onclick = ()=>{ const l=$('#ff_gpList'), open=l.hidden; l.hidden=!open; $('#ff_gpBtn').setAttribute('aria-expanded',open); if(open) (l.querySelector('[aria-selected="true"]')||l.querySelector('.gp-item'))?.focus(); };
  $('#ff_gpList').addEventListener('click', e=>{ const it=e.target.closest('.gp-item'); if(!it) return; d.grp=it.dataset.k; fillG(); $('#ff_gpBtn').focus(); });
  $('#ff_gpick').addEventListener('keydown', e=>{ if($('#ff_gpList').hidden) return; const items=[...$$('#ff_gpList .gp-item')], i=items.indexOf(document.activeElement);
    if(e.key==='ArrowDown'){ e.preventDefault(); items[Math.min(i+1,items.length-1)]?.focus(); }
    else if(e.key==='ArrowUp'){ e.preventDefault(); items[Math.max(i-1,0)]?.focus(); }
    else if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); $('#ff_gpList').hidden=true; $('#ff_gpBtn').setAttribute('aria-expanded','false'); $('#ff_gpBtn').focus(); } });
  document.addEventListener('click', e=>{ if(!e.target.closest('#ff_gpick')){ const l=$('#ff_gpList'); if(l && !l.hidden){ l.hidden=true; $('#ff_gpBtn').setAttribute('aria-expanded','false'); } } });
  $('#ff_prov').onchange = ()=>{ fillAmp(); fillT(); };
  $('#ff_amp').onchange = fillT;
  $('#ff_s').onchange = ()=>{ d.grp=''; fillT(); };
  $('#ff_tams').addEventListener('change', e=>{ if(e.target.type==='checkbox'){ e.target.checked?picked.add(e.target.value):picked.delete(e.target.value); showPicked(); } });
  $('#ff_picked').addEventListener('click', e=>{ const b=e.target.closest('[data-rm]'); if(!b) return; picked.delete(b.dataset.rm); fillT(); });
  $('#ff_allAmp').onclick = ()=>{ ampTams().forEach(t=>picked.add(t.id)); fillT(); };
  $('#ff_clrAmp').onclick = ()=>{ ampTams().forEach(t=>picked.delete(t.id)); fillT(); };
  // ค่าเริ่มต้น: ใช้จังหวัด/อำเภอของตำบลแรกที่มีอยู่
  const t0 = T[[...picked][0]];
  if(t0){ $('#ff_prov').value=t0.p; fillAmp(); $('#ff_amp').value=t0.a; }
  fillT();

  /* คำแนะนำสถานะ + งบประมาณ */
  const stHint = ()=>{ const v=$('#ff_status').value; $('#ff_statusHint').textContent = v ? STATUS_HELP[v]||'' : 'โครงการที่ยื่นเสนอใหม่ (ยังไม่เริ่ม) ให้เลือก “เตรียมการ”'; };
  $('#ff_status').addEventListener('change', stHint); stHint();
  const bHint = ()=>{ const b=parseBaht($('#ff_budget').value); $('#ff_budgetHint').textContent = (b && !Number.isNaN(b)) ? `= ${b.toLocaleString('th-TH')} บาท${b>=1e6?` (${(b/1e6).toLocaleString('th-TH',{maximumFractionDigits:2})} ล้านบาท)`:''}` : ''; };
  $('#ff_budget').addEventListener('input', bHint); $('#ff_budget').addEventListener('blur', ()=>{ const b=parseBaht($('#ff_budget').value); if(b!=null && !Number.isNaN(b)) $('#ff_budget').value=b.toLocaleString('en-US'); bHint(); }); bHint();
  /* แสดงข้อผิดพลาดรายช่อง */
  const FIELD_EL = {ptype:'#ff_ptype', org:'#ff_proposerOrg', contact:'#ff_proposerContact', tambons:'#ff_tams', s:'#ff_s', grp:'#ff_gpBtn', title:'#ff_title', detail:'#ff_detail', agency:'#ff_agency', budget:'#ff_budget', yearStart:'#ff_yearStart', yearEnd:'#ff_yearEnd', status:'#ff_status'};
  const clearErr = ()=>{ $$('.modal .ferr').forEach(e=>e.remove()); $$('.modal .invalid').forEach(e=>e.classList.remove('invalid')); $('#ff_err').innerHTML=''; };
  const showErr = errs=>{ clearErr(); errs.forEach(e=>{ const el=$(FIELD_EL[e.f]); if(!el) return; el.classList.add('invalid'); const m=document.createElement('div'); m.className='ferr'; m.dataset.f=e.f; m.textContent='⚠ '+e.msg; (el.closest('.gpick')||el).insertAdjacentElement('afterend', m); });
    $('#ff_err').innerHTML = `<div class="err-sum"><b>พบข้อผิดพลาด ${errs.length} จุด</b> — แก้ไขช่องที่มีกรอบสีแดง:<ul>${errs.map(e=>`<li><button type="button" class="linkbtn" data-goerr="${e.f}">${esc(FIELD_LABEL[e.f]||e.f)}</button>: ${esc(e.msg)}</li>`).join('')}</ul></div>`;
    const first=$(FIELD_EL[errs[0].f]); if(first){ first.scrollIntoView({block:'center', behavior:'smooth'}); setTimeout(()=>first.focus({preventScroll:true}),300); } };
  $('#ff_err').addEventListener('click', e=>{ const b=e.target.closest('[data-goerr]'); if(!b) return; const el=$(FIELD_EL[b.dataset.goerr]); if(el){ el.scrollIntoView({block:'center',behavior:'smooth'}); setTimeout(()=>el.focus({preventScroll:true}),300); } });
  $('#pform').addEventListener('input', e=>{ const el=e.target.closest('.invalid'); if(el){ el.classList.remove('invalid'); el.parentElement.querySelector('.ferr')?.remove(); } });
  $('#pform').addEventListener('change', e=>{ const el=e.target.closest('.invalid')||e.target.closest('.tam-pick'); if(el){ el.classList.remove('invalid'); el.parentElement.querySelector(':scope > .ferr')?.remove(); } });

  $('#ff_save').onclick = async ()=>{
    const v = id=>($('#ff_'+id)?.value||'').trim();
    const tams=[...picked].filter(id=>T[id]);
    const bb=parseBaht(v('budget'));
    const raw = {s:+v('s')||null, grp:$('#ff_grp_sel').value, title:v('title'), detail:v('detail'), tambons:tams, agency:v('agency'), budgetBaht:bb,
      yearStart: v('yearStart')===''?null:+v('yearStart'), yearEnd: v('yearEnd')===''?null:+v('yearEnd'), status:v('status')};
    let pinfo = null;
    if(mode==='new'){ pinfo=proposerInfo(); Object.assign(raw, pinfo); }
    const errs = validateRec(raw, {proposer: mode==='new', allowNoTambon: mode==='edit', allowNoGrp: mode==='edit'});
    if(mode==='edit' && !tams.length && !d.sb) errs.push({f:'tambons', msg:'กรุณาเลือกตำบลอย่างน้อย 1 ตำบล'});
    if(errs.length){ showErr(errs); return; }
    clearErr();
    const rec = {sb: tams.length ? basinOfTams(tams) : d.sb, s:raw.s, grp:raw.grp, title:raw.title, detail:raw.detail, tambons:tams, agency:raw.agency,
      budget: bb==null ? null : bb/1e6, yearStart:raw.yearStart, yearEnd:raw.yearEnd, status:raw.status, note:v('note')};
    const btn = $('#ff_save'); btn.disabled = true; btn.textContent = 'กำลังบันทึก…';
    try{
      if(mode==='new'){ await Store.submit(Object.assign(rec, pinfo)); closeModal(); toast('ส่งโครงการแล้ว รอผู้ดูแลระบบพิจารณา'); }
      else if(mode==='edit'){ await Store.saveProject(d.id, rec); closeModal(); toast('บันทึกการแก้ไขแล้ว'); }
      else { const id = await Store.approve(sub, rec); closeModal(); toast(`อนุมัติแล้ว บันทึกเป็นโครงการ ${id}`); }
    }catch(e){ console.error(e); $('#ff_err').textContent = 'บันทึกไม่สำเร็จ: '+(e.message||e); btn.disabled=false; btn.textContent='ลองอีกครั้ง'; }
  };
}

/* ---------- นำเข้าโครงการจาก Excel ---------- */
const XLS_MAX = 300;
function xlsPanel(){
  return `<div class="xsteps">
    <div class="xstep"><div class="xn">1</div><div><b>ดาวน์โหลดแบบฟอร์ม Excel</b><div class="note">มี 3 ชีต: กรอกข้อมูล · ตัวอย่าง · คำอธิบายสภาพพื้นที่ (ตัวเลือกส่วนใหญ่เป็นดรอปดาวน์)</div>
      <a class="btn sm primary" href="assets/template_proposal.xlsx?v=${encodeURIComponent(CFG.version||'')}" download="แบบฟอร์มเสนอโครงการ_ลุ่มน้ำปิง.xlsx">ดาวน์โหลดแบบฟอร์ม (.xlsx)</a></div></div>
    <div class="xstep"><div class="xn">2</div><div><b>กรอกข้อมูลในชีต "กรอกข้อมูล"</b><div class="note">1 แถว = 1 โครงการ · ช่องที่มี * ต้องกรอก · ตำบลหลายตำบลคั่นด้วยเครื่องหมายจุลภาค ( , ) หรือพิมพ์ "ทั้งอำเภอ" · ส่งได้ครั้งละไม่เกิน ${XLS_MAX} โครงการ</div></div></div>
    <div class="xstep"><div class="xn">3</div><div><b>อัปโหลดไฟล์ที่กรอกแล้ว</b><div class="note">ระบบจะตรวจทุกแถวและแสดงผลก่อนส่ง</div>
      <label class="upl"><input type="file" id="xl_file" accept=".xlsx,.xls"><span>เลือกไฟล์ Excel</span></label> <span class="note" id="xl_name"></span></div></div>
  </div>
  <div id="xl_res"></div>`;
}
const cleanLoc = (s, kind) => String(s||'').trim().replace(kind==='p'?/^(จังหวัด|จ\.)\s*/:kind==='a'?/^(อำเภอ|อ\.)\s*/:/^(ตำบล|ต\.)\s*/,'').trim();
function xlsParseRows(wb){
  const sn = wb.SheetNames.find(n=>n.trim()==='กรอกข้อมูล') || wb.SheetNames.find(n=>{ const r=XLSX.utils.sheet_to_json(wb.Sheets[n],{header:1,blankrows:false}); return r.some(x=>x.some(c=>String(c).includes('ชื่อแนวทาง'))); });
  if(!sn) throw new Error('ไม่พบชีต "กรอกข้อมูล" กรุณาใช้แบบฟอร์มที่ดาวน์โหลดจากระบบ');
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], {header:1, defval:'', blankrows:false});
  const hi = rows.findIndex(r=>r.some(c=>String(c).includes('ชื่อแนวทาง')));
  if(hi<0) throw new Error('ไม่พบหัวตาราง "ชื่อแนวทาง/โครงการ" ในชีตกรอกข้อมูล');
  const H = rows[hi].map(h=>String(h).replace(/\*/g,'').replace(/\s+/g,'').trim());
  const col = name => H.findIndex(h=>h.startsWith(name));
  const C = {title:col('ชื่อแนวทาง'), detail:col('รายละเอียด'), s:col('ยุทธศาสตร์'), grp:col('สภาพพื้นที่'), p:col('จังหวัด'), a:col('อำเภอ'), t:col('ตำบล'),
    agency:col('หน่วยงานรับผิดชอบ'), budget:col('งบประมาณ'), budgetMillion: H[col('งบประมาณ')]?.includes('ล้าน'), ys:col('ปีเริ่ม'), ye:col('ปีสิ้นสุด'), status:col('สถานะ'), note:col('หมายเหตุ')};
  const g = (r,k)=> (typeof C[k]==='number' && C[k]>=0) ? String(r[C[k]]??'').trim() : '';
  const LET = i => i>=0 ? String.fromCharCode(65+i) : '';
  xlsParseRows.cols = Object.fromEntries(Object.entries(C).filter(([k,v])=>typeof v==='number').map(([k,v])=>[k, v>=0 ? `${LET(v)} · ${rows[hi][v]||k}`.replace(/\*/g,'').trim() : k]));
  xlsParseRows.million = !!C.budgetMillion;
  const out=[];
  rows.slice(hi+1).forEach((r,i)=>{ const x={row:hi+2+i}; Object.keys(C).filter(k=>typeof C[k]==='number').forEach(k=>x[k]=g(r,k)); if(x.title||x.s||x.grp||x.p||x.t) out.push(x); });
  return out;
}
function xlsValidate(x){
  const err=[];
  if(x.title.length<5) err.push('ชื่อโครงการสั้นเกินไป (อย่างน้อย 5 ตัวอักษร)');
  if(x.title.length>300) err.push('ชื่อโครงการยาวเกิน 300 ตัวอักษร');
  if(x.detail.length>3000) err.push('รายละเอียดยาวเกิน 3,000 ตัวอักษร');
  const s = +((x.s.match(/[1-5]/)||[])[0]||0); if(!s) err.push('ยังไม่ได้เลือกยุทธศาสตร์ (1–5)');
  const grp = (x.grp.toUpperCase().match(/[WPREG]\d/)||[])[0]||'';
  if(!grp || !M.groups[grp]) err.push('ยังไม่ได้เลือกสภาพพื้นที่');
  else if(s && grp[0]!==famOf(s)) err.push(`สภาพพื้นที่ ${grp} ไม่อยู่ในยุทธศาสตร์ที่ ${s} (ต้องเป็นรหัส ${famOf(s)})`);
  const p=cleanLoc(x.p,'p'), a=cleanLoc(x.a,'a');
  const all = pingTams();
  let tams=[];
  if(!p) err.push('ยังไม่ได้ระบุจังหวัด');
  else if(!all.some(t=>t.p===p)) err.push(`ไม่พบจังหวัด "${p}" ในลุ่มน้ำปิง`);
  else if(!a) err.push('ยังไม่ได้ระบุอำเภอ');
  else if(!all.some(t=>t.p===p&&t.a===a)) err.push(`ไม่พบอำเภอ "${a}" ของ จ.${p} ในลุ่มน้ำปิง`);
  else {
    const inA = all.filter(t=>t.p===p&&t.a===a);
    if(!x.t) err.push('ยังไม่ได้ระบุตำบล');
    else if(/ทั้งอำเภอ|ทุกตำบล/.test(x.t)) tams = inA.map(t=>t.id);
    else { const bad=[]; x.t.split(/[,，、;\/\n]+/).map(s=>cleanLoc(s,'t')).filter(Boolean).forEach(n=>{ const t=inA.find(t=>t.t===n); t?tams.push(t.id):bad.push(n); });
      if(bad.length) err.push(`ไม่พบตำบล ${bad.map(b=>'"'+b+'"').join(', ')} ใน อ.${a} · ตำบลใน อ.${a} ที่อยู่ในลุ่มน้ำปิง ได้แก่ ${inA.map(t=>t.t).sort((x,y)=>x.localeCompare(y,'th')).join(', ')}`);
      if(!tams.length && !bad.length) err.push('ยังไม่ได้ระบุตำบล'); }
  }
  tams=[...new Set(tams)];
  let bb=parseBaht(x.budget); if(bb!=null && !Number.isNaN(bb) && xlsParseRows.million) bb=bb*1e6;
  const yn = v => v==='' ? null : (Number.isNaN(+v) ? NaN : +v);
  const status = x.status ? (LEGACY[x.status]||x.status) : 'เตรียมการ';
  const raw = {s:s||null, grp, title:x.title, detail:x.detail, tambons:tams, agency:x.agency, budgetBaht:bb, yearStart:yn(x.ys), yearEnd:yn(x.ye), status};
  // ข้อผิดพลาดจาก validateRec ที่ยังไม่ซ้ำกับที่ตรวจด้านบน (พื้นที่/ยุทธศาสตร์/สภาพพื้นที่/ชื่อ ตรวจแล้ว)
  validateRec(raw, {allowNoTambon:true, allowNoGrp:true}).filter(e=>!['tambons','s','grp','title'].includes(e.f) || (e.f==='tambons' && tams.length>120)).forEach(e=>err.push(`@@${e.f}@@${e.msg}`));
  // ระบุคอลัมน์ที่ต้องแก้
  const COLMAP = xlsParseRows.cols||{};
  const FK={budget:'budget',yearStart:'ys',yearEnd:'ye',status:'status',detail:'detail',agency:'agency',tambons:'t'};
  const tag = m => { const mm=/^@@(\w+)@@/.exec(m); if(mm){ const k=FK[mm[1]], t=m.slice(mm[0].length); return COLMAP[k] ? `[คอลัมน์ ${COLMAP[k]}] ${t}` : `${FIELD_LABEL[mm[1]]}: ${t}`; } const k = /^ชื่อ|ชื่อโครงการ/.test(m)?'title':/ยุทธศาสตร์/.test(m)&&!/สภาพพื้นที่/.test(m)?'s':/สภาพพื้นที่/.test(m)?'grp':/จังหวัด/.test(m)?'p':/อำเภอ/.test(m)&&!/ตำบล/.test(m)?'a':/ตำบล/.test(m)?'t':/งบประมาณ/.test(m)?'budget':/^ปีสิ้นสุด/.test(m)?'ye':/^ปีเริ่ม/.test(m)?'ys':/สถานะ/.test(m)?'status':/รายละเอียด/.test(m)?'detail':/หน่วยงาน/.test(m)?'agency':''; return k&&COLMAP[k] ? `[คอลัมน์ ${COLMAP[k]}] ${m}` : m; };
  return {err: err.map(tag), rec:{sb: basinOfTams(tams), s:s||null, grp, title:x.title, detail:x.detail, tambons:tams, agency:x.agency, budget: (bb==null||Number.isNaN(bb))?null:bb/1e6, yearStart:raw.yearStart||null, yearEnd:raw.yearEnd||null, status, note:x.note}};
}
function xlsBind(proposerInfo){
  let ok=[];
  $('#xl_file').onchange = async e=>{
    const f=e.target.files[0]; if(!f) return; $('#xl_name').textContent=f.name; const box=$('#xl_res');
    if(!window.XLSX){ box.innerHTML='<div class="err">ตัวอ่าน Excel ยังโหลดไม่เสร็จ ลองเลือกไฟล์อีกครั้ง</div>'; return; }
    try{
      const wb = XLSX.read(await f.arrayBuffer(), {type:'array'});
      const rows = xlsParseRows(wb);
      if(!rows.length) throw new Error('ไม่พบข้อมูลโครงการในชีต "กรอกข้อมูล"');
      if(rows.length>XLS_MAX) throw new Error(`มี ${rows.length} แถว เกิน ${XLS_MAX} แถวต่อครั้ง กรุณาแบ่งเป็นหลายไฟล์`);
      const res = rows.map(x=>Object.assign({row:x.row}, xlsValidate(x)));
      ok = res.filter(r=>!r.err.length).map(r=>r.rec);
      const bad = res.filter(r=>r.err.length);
      box.innerHTML = `<div class="xsum"><span class="okc">ถูกต้อง ${fmt(ok.length)} โครงการ</span>${bad.length?` · <span class="badc">ต้องแก้ไข ${fmt(bad.length)} แถว</span>`:''}</div>
        ${bad.length?`<div class="note">แถวที่ต้องแก้ไขจะไม่ถูกส่ง แก้ในไฟล์แล้วอัปโหลดใหม่ หรือส่งเฉพาะแถวที่ถูกต้องก่อนก็ได้</div>`:''}
        <div class="tbl-wrap xprev"><table><thead><tr><th>แถว</th><th>ผล</th><th>ชื่อแนวทาง/โครงการ</th><th>ยศ.</th><th>สภาพพื้นที่</th><th>พื้นที่</th></tr></thead><tbody>
        ${res.map(r=>`<tr class="${r.err.length?'xbad':''}"><td class="num">${r.row}</td><td>${r.err.length?`<span class="badc">✕</span> ${r.err.map(esc).join('<br>')}`:'<span class="okc">✓ พร้อมส่ง</span>'}</td><td>${esc(r.rec.title)}</td><td>${r.rec.s?sPill(r.rec.s):''}</td><td>${esc(r.rec.grp)}</td><td>${r.rec.tambons.length?`${r.rec.tambons.length} ตำบล · ${esc(T[r.rec.tambons[0]].a)}`:''}</td></tr>`).join('')}
        </tbody></table></div>
        <div class="err" id="xl_err"></div>
        ${ok.length?`<button class="btn pink" id="xl_send">ส่ง ${fmt(ok.length)} โครงการให้ผู้ดูแลพิจารณา</button>`:''}`;
      const sb=$('#xl_send'); if(sb) sb.onclick = async ()=>{
        const pinfo=proposerInfo();
        if(!pinfo.proposer || (pinfo.proposer!==CITIZEN && !pinfo.proposerOrg)){ $('#xl_err').textContent='กรุณากรอกข้อมูลผู้เสนอด้านบนก่อน (ประเภทผู้เสนอ และชื่อหน่วยงาน/องค์กร)'; $('#ff_proposerOrg')?.focus(); return; }
        sb.disabled=true; sb.textContent='กำลังส่ง…';
        try{ await Store.submitMany(ok.map(r=>Object.assign({}, r, pinfo))); closeModal(); toast(`ส่งแล้ว ${fmt(ok.length)} โครงการ รอผู้ดูแลระบบพิจารณา`); }
        catch(e2){ console.error(e2); $('#xl_err').textContent='ส่งไม่สำเร็จ: '+(e2.message||e2); sb.disabled=false; sb.textContent='ลองอีกครั้ง'; }
      };
    }catch(err){ box.innerHTML=`<div class="err">${esc(err.message||String(err))}</div>`; ok=[]; }
  };
}

function openLogin(start){ openWelcome(start||'admin'); }
function openWelcome(start){
  const ss = Sess.get() || {};
  const fb = Store.mode==='firebase';
  const locked = !ss.role;
  modal(`<div class="modal-h"><div><h2>เข้าใช้งานระบบ</h2><div class="note">โครงการศึกษาจัดทำแผนแม่บทการบริหารจัดการทรัพยากรน้ำในเขตลุ่มน้ำปิง ปรับปรุงช่วงที่ 1 (พ.ศ. 2566-2580)</div></div>${locked?'':'<button class="x" data-act="close" aria-label="ปิด">×</button>'}</div>
  <div class="modal-b">
    <div class="role-pick" role="tablist">
      <button type="button" class="role-b" data-act="enteruser"><b>ผู้ใช้ทั่วไป</b><span>ดูข้อมูล ค้นหา และเสนอโครงการ กดเพื่อเข้าใช้งานได้ทันที</span></button>
      <button type="button" class="role-b" data-act="role" data-v="admin" aria-pressed="${start==='admin'}"><b>ผู้ดูแลระบบ</b><span>อนุมัติ แก้ไข และลบโครงการ ต้องใช้รหัสผู้ดูแล</span></button>
    </div>
    <form id="wf_admin" class="stack" ${start==='admin'?'':'hidden'}>
      ${fb && !CFG.adminEmail ? `<div class="fld"><label for="lg_email">อีเมลผู้ดูแล</label><input id="lg_email" type="email" autocomplete="username"></div>` : ''}
      <div class="fld"><label for="lg_pass">รหัสผู้ดูแลระบบ</label><input id="lg_pass" type="password" autocomplete="current-password"></div>
      <label class="remember"><input type="checkbox" id="lg_rem" checked> จดจำในเครื่องนี้ (${SESSION_DAYS} วัน) · ไม่ควรเลือกถ้าเป็นเครื่องสาธารณะ</label>
      <div class="err" id="lg_err" role="alert"></div>
      <button class="btn pink" type="submit">เข้าสู่ระบบผู้ดูแล</button>
      ${fb && !CFG.adminEmail ? '<button class="linkbtn" type="button" data-act="forgot">ลืมรหัสผ่าน ส่งลิงก์ตั้งรหัสใหม่ทางอีเมล</button>' : ''}
    </form>
  </div>`, 'center welcome', locked);
  $('#wf_admin').onsubmit = async e=>{ e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
    try{
      const rem = $('#lg_rem').checked;
      await Store.login($('#lg_email')?.value.trim(), $('#lg_pass').value, rem);
      Sess.set({role:'admin'}, rem);
      closeModal(); renderHeader(); toast('เข้าสู่ระบบผู้ดูแลแล้ว');
    }catch(err){ btn.disabled=false; const code=(err.code||'')+' '+(err.message||''); $('#lg_err').textContent = /too-many-requests/i.test(code) ? 'ใส่รหัสผิดหลายครั้ง ระบบพักการเข้าสู่ระบบชั่วคราว ลองใหม่ในอีกไม่กี่นาที' : /network-request-failed/i.test(code) ? 'เชื่อมต่ออินเทอร์เน็ตไม่ได้ ตรวจสอบการเชื่อมต่อแล้วลองใหม่' : /user-not-found|user-disabled/i.test(code) ? 'ไม่พบบัญชีผู้ดูแล หรือบัญชีถูกปิดใช้งาน' : /invalid|wrong|password|credential|ไม่ถูกต้อง/i.test(code) ? 'รหัสผู้ดูแลไม่ถูกต้อง' : 'เข้าสู่ระบบไม่สำเร็จ: '+(err.message||''); $('#lg_pass').select(); }
  };
}
function exportXlsx(list, name){
  if(!window.XLSX){ toast('ยังโหลดตัวส่งออกไม่เสร็จ ลองใหม่อีกครั้ง'); return; }
  list = list || filt(P);
  const rows = list.map(p=>{ const L = projLoc(p); const G = projGrpList(p); return {
    'รหัส':p.id,'ยุทธศาสตร์':`${p.s} ${STRAT[p.s]?.short||''}`,'แผนงาน':p.F?String(p.F).split(/,\s*/).map(f=>`${f} ${PROG[f]?.name||''}`).join('; '):'','มาตรการ':p.S?`${p.S} ${MEAS[p.S]?.name||''}`:'','สภาพพื้นที่ (ผู้เสนอระบุ)':p.grp?`${p.grp} ${M.groups[p.grp]||''}`:'',
    'แนวทาง/โครงการ':p.title,'รายละเอียด':p.detail,'ลุ่มน้ำสาขา':p.sb,
    'จังหวัด':L.prov.join(', '),'อำเภอ':L.amp.join(', '),'ตำบล':L.tam.join(', ')||'ไม่มีตำบลเป้าหมาย (ระดับลุ่มน้ำ)',
    'ตำบลเป้าหมาย (เต็ม)':L.ts.map(tamName).join(', '),
    'กลุ่มพื้นที่':G.codes.join(', '),'คำอธิบายกลุ่มพื้นที่':G.codes.map(c=>`${c} ${M.groups[c]||''}`).join('; '),'ที่มากลุ่มพื้นที่':G.codes.length?(p.grp?'ผู้เสนอระบุ':G.fromMeasure?'ตามมาตรการ':'ตามตำบลเป้าหมาย'):'',
    'หน่วยงานรับผิดชอบ':p.agency,'งบประมาณ (บาท)':toBaht(p.budget),'ปีเริ่ม (พ.ศ.)':p.yearStart,'ปีสิ้นสุด (พ.ศ.)':p.yearEnd,'สถานะ':stageOf(p),'หมายเหตุ':p.note,
    }; });
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [8,22,30,40,30,60,50,22,16,20,30,50,18,40,16,22,14,10,10,16,24].map(w=>({wch:w}));
  ws['!autofilter'] = {ref: XLSX.utils.encode_range({s:{r:0,c:0}, e:{r:rows.length, c:Object.keys(rows[0]||{a:1}).length-1}})};
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'โครงการ');
  const fn = ('โครงการ_' + String(name||'ลุ่มน้ำปิง').replace(/^โครงการ(ที่ลง|ใน)?\s*/,'')).replace(/[\\/:*?"<>|]+/g,' ').replace(/\s+/g,'_').slice(0,90);
  XLSX.writeFile(wb, fn + '.xlsx');
  toast(`ดาวน์โหลด ${fmt(rows.length)} รายการแล้ว`);
}

/* ================= ROUTING & EVENTS ================= */
function setTab(t){ S.tab=t; $$('.tab').forEach(b=>b.setAttribute('aria-selected', b.dataset.tab===t)); try{ history.replaceState(null,'','#'+t); }catch(e){} renderFilters(); renderView(); }
function renderView(){
  if(!M) return;
  $('#filters').hidden = S.tab==='admin';
  if(S.tab==='area') renderArea(); else if(S.tab==='basin') renderBasin(); else if(S.tab==='map') renderMap(); else renderAdmin();
}
function onData(){ buildIndex(); renderKPIs(); renderFilters(); renderHeader(); renderView(); }
function bind(){
  document.addEventListener('click', async e=>{
    const pr = e.target.closest('[data-pid]:not([data-act])'); if(pr){ openProject(pr.dataset.pid); return; }
    const a = e.target.closest('[data-act]'); if(!a) return;
    const act = a.dataset.act, v = a.dataset.v;
    const sub = ()=>SUBS.find(s=>s._id===a.dataset.sid) || REJ.find(s=>s._id===a.dataset.sid);
    switch(act){
      case 'close': closeModal(); break;
      case 'goprov': S.prov=v||null; S.amp=null; S.tam=null; renderFilters(); renderView(); break;
      case 'goamp': S.amp=v; S.tam=null; renderFilters(); renderView(); break;
      case 'gotam': S.tam=v; renderFilters(); renderView(); break;
      case 'gotamfull': { const t=T[v]; S.prov=t.p; S.amp=t.a; S.tam=v; closeModal(); setTab('area'); window.scrollTo({top:0}); break; }
      case 'up': if(S.tam) S.tam=null; else if(S.amp) S.amp=null; else S.prov=null; renderFilters(); renderView(); break;
      case 'gobasin': S.basin=v||null; S.bprov=S.bamp=S.btam=null; closeModal(); setTab('basin'); window.scrollTo({top:0}); break;
      case 'maptam': { const t=T[v]; mapSel=v; Object.assign(MS,{kind:'admin',prov:t.p,amp:t.a,tam:v}); setTab('map'); if(MAP){ $$('.seg-b').forEach(b=>b.setAttribute('aria-pressed', b.dataset.v==='admin')); afterScope(); } break; }
      case 'mapbasin': Object.assign(MS,{kind:'basin',basin:v}); setTab('map'); if(MAP){ $$('.seg-b').forEach(b=>b.setAttribute('aria-pressed', b.dataset.v==='basin')); afterScope(); } break;
      case 'mapunsel': mapSel=null; MAP && MAP.closePopup(); restyle(); $('#mapSide').innerHTML='<div class="panel-h"><h3>ข้อมูลตำบล</h3></div><div style="padding:14px" class="note">คลิกตำบลบนแผนที่เพื่อดูข้อมูลพื้นที่</div>'; mapProjects(); break;
      case 'mapgoproj': $('#mapProj')?.scrollIntoView({behavior:'smooth'}); break;
      case 'keyf': { const pnl=$('#keyfPanel'); const open = a.getAttribute('aria-expanded')==='true';
        $$('.keyf-c').forEach(c=>c.setAttribute('aria-expanded','false'));
        if(open){ pnl.hidden=true; break; }
        a.setAttribute('aria-expanded','true'); pnl.innerHTML = $('#keyfData').content.querySelector(`[data-k="${v}"]`).outerHTML; pnl.hidden=false; break; }
      case 'keyfall': { const pnl=$('#keyfPanel'); const showing = pnl.dataset.all==='1' && !pnl.hidden;
        $$('.keyf-c').forEach(c=>c.setAttribute('aria-expanded', showing?'false':'true'));
        if(showing){ pnl.hidden=true; pnl.dataset.all=''; a.textContent='แสดงทั้งหมด'; break; }
        pnl.innerHTML = `<div class="keyf">${$('#keyfData').innerHTML}</div>`; pnl.dataset.all='1'; pnl.hidden=false; a.textContent='ซ่อน'; break; }
      case 'mkind': if(MS.kind!==v){ MS.prov=''; MS.amp=''; MS.tam=''; mapSel=null; } MS.kind=v; $$('.seg-b').forEach(b=>b.setAttribute('aria-pressed', b.dataset.v===v)); afterScope(); break;
      case 'clr': { if(v==='__strat'){ S.f.s.clear(); renderFilters(); renderView(); break; }
        const el2 = document.getElementById(v); if(!el2) break;
        el2.value = '';
        if(el2.tagName==='INPUT'){ S.f.q=''; renderFilters(); renderView(); }
        else el2.dispatchEvent(new Event('change', {bubbles:true}));
        break; }
      case 'stage': S.f.stage = (S.f.stage===v ? '' : v); renderFilters(); renderView(); break;
      case 'morefilt': S.moreOpen=!S.moreOpen; renderFilters(); break;
      case 'fsall': S.f.s.clear(); S.f.F=''; S.f.S=''; renderFilters(); renderView(); break;
      case 'more': { TABLES[a.dataset.key].n += PAGE*2; a.closest('[data-table]').innerHTML = tableInner(a.dataset.key); break; }
      case 'fs': { const n=+a.dataset.n; S.f.s.has(n)?S.f.s.delete(n):S.f.s.add(n); S.f.F=''; S.f.S=''; renderFilters(); renderView(); break; }
      case 'clear': S.f={q:'',s:new Set(),F:'',S:'',grp:'',src:'',stage:''}; renderFilters(); renderView(); break;
      case 'newproj': { const d={}; if(a.dataset.tam){ const t=T[a.dataset.tam]; d.sb=t.sb[0]||''; d.tambons=[t.id]; } if(a.dataset.sb) d.sb=a.dataset.sb; openForm('new', d); break; }
      case 'edit': openForm('edit', P.find(p=>p.id===a.dataset.pid)); break;
      case 'del': $('#delBox').innerHTML = `<div class="confirm-box"><span>ลบโครงการ ${esc(a.dataset.pid)} ออกจากระบบถาวร?</span><button class="btn sm danger" data-act="delok" data-v="${esc(a.dataset.pid)}">ยืนยันลบ</button><button class="btn sm" data-act="delno">ยกเลิก</button></div>`; break;
      case 'delno': $('#delBox').innerHTML=''; break;
      case 'delok': try{ await Store.deleteProject(v); closeModal(); toast('ลบโครงการแล้ว'); }catch(err){ toast('ลบไม่สำเร็จ: '+err.message); } break;
      case 'login': openLogin(); break;
      case 'copyuid': { try{ await navigator.clipboard.writeText(S.user?.uid||''); toast('คัดลอก UID แล้ว'); }catch(e){ toast('คัดลอกไม่ได้ กรุณาเลือกข้อความเอง'); } break; }
      case 'recheck': { try{ await Store.db.collection('submissions').limit(1).get(); location.reload(); }catch(e){ S.permErr=e.code||e.message; toast('ยังไม่มีสิทธิ์ผู้ดูแล ตรวจการตั้งค่าใน Firebase อีกครั้ง'); renderView(); } break; }
      case 'auth': { if(S.admin||S.user){ await Store.logout(); Sess.set({role:'user'}, true); renderHeader(); toast('ออกจากระบบผู้ดูแลแล้ว ใช้งานต่อในฐานะผู้ใช้ทั่วไป'); } else openWelcome('admin'); break; }
      case 'role': { $$('.role-b').forEach(b=>b.setAttribute('aria-pressed', b.dataset.v==='admin')); $('#wf_admin').hidden=false; $('#lg_pass').focus(); break; }
      case 'enteruser': { if(S.admin) await Store.logout(); Sess.set({role:'user'}, true); closeModal(); renderHeader(); toast('เข้าใช้งานในฐานะผู้ใช้ทั่วไป'); break; }
      case 'forgot': { const em=$('#lg_email').value.trim(); if(!em){ $('#lg_err').textContent='กรอกอีเมลก่อน'; break; } try{ await Store.resetPassword(em); $('#lg_err').textContent='ส่งลิงก์ไปที่อีเมลแล้ว'; }catch(err){ $('#lg_err').textContent=err.message; } break; }
      case 'approve': { const s=sub(); a.disabled=true; try{ const id=await Store.approve(s, s); toast(`อนุมัติแล้ว บันทึกเป็นโครงการ ${id}`); }catch(err){ a.disabled=false; toast('อนุมัติไม่สำเร็จ: '+err.message); } break; }
      case 'review': { const s=sub(); openForm('review', s, s); break; }
      case 'reject': openRejectModal([sub()]); break;
      case 'subtab': S.adminTab=v; S.sel.clear(); renderView(); break;
      case 'selsub': { a.checked?S.sel.add(a.dataset.sid):S.sel.delete(a.dataset.sid); renderView(); break; }
      case 'selall': { const list=S.adminTab==='rejected'?REJ:SUBS; if(a.checked) list.forEach(x=>S.sel.add(x._id)); else S.sel.clear(); renderView(); break; }
      case 'rejectsel': { const list=SUBS.filter(x=>S.sel.has(x._id)); if(list.length) openRejectModal(list); break; }
      case 'approvesel': { const list=SUBS.filter(x=>S.sel.has(x._id)); const ok=list.filter(x=>!subErrs(x).length), bad=list.length-ok.length;
        if(!ok.length){ toast('รายการที่เลือกมีข้อมูลต้องแก้ไขทั้งหมด กด “ตรวจ/แก้ไข” ก่อน'); break; }
        a.disabled=true; a.textContent='กำลังอนุมัติ…';
        try{ const ids=await Store.approveMany(ok); ok.forEach(x=>S.sel.delete(x._id)); toast(`อนุมัติแล้ว ${ids.length} โครงการ (${ids[0]}${ids.length>1?'–'+ids[ids.length-1]:''})${bad?` · ข้าม ${bad} รายการที่ต้องแก้ไข`:''}`); renderView(); }
        catch(err){ toast('อนุมัติไม่สำเร็จ: '+err.message); renderView(); } break; }
      case 'restore': { const s=sub(); try{ await Store.restoreMany([s]); S.sel.delete(s._id); toast('นำกลับไปกล่องรอพิจารณาแล้ว'); renderView(); }catch(err){ toast('ไม่สำเร็จ: '+err.message); } break; }
      case 'restoresel': { const list=REJ.filter(x=>S.sel.has(x._id)); try{ await Store.restoreMany(list); list.forEach(x=>S.sel.delete(x._id)); toast(`นำกลับไปพิจารณา ${list.length} โครงการแล้ว`); renderView(); }catch(err){ toast('ไม่สำเร็จ: '+err.message); } break; }
      case 'viewsub': { const s=sub(); openForm('review', s, s); break; }
      case 'subxls': subXlsx(); break;
      case 'seed': { a.disabled=true; try{ await Store.seed((n,t)=>{ const el=$('#seedProg'); if(el) el.textContent=`นำเข้าแล้ว ${n}/${t}`; }); toast('นำเข้าข้อมูลตั้งต้นแล้ว'); }catch(err){ a.disabled=false; toast('นำเข้าไม่สำเร็จ: '+err.message); } break; }
      case 'export': exportXlsx(); break;
      case 'syncseed': { a.disabled=true; try{ const r=await Store.syncSeed((n,t)=>{ const el=$('#syncProg'); if(el) el.textContent=`อัปเดตแล้ว ${n}/${t}`; }); toast(`อัปเดตตาม Excel ฉบับใหม่แล้ว ${fmt(r.n)} โครงการ`); renderView(); }catch(err){ a.disabled=false; toast('อัปเดตไม่สำเร็จ: '+err.message); } break; }
      case 'xls': { const T0=TABLES[a.dataset.key]; exportXlsx(T0.list, T0.opts.name); break; }
      case 'demoreset': $('#resetBox').innerHTML = `<div class="confirm-box" style="margin-top:8px"><span>ล้างโครงการที่เพิ่ม/แก้ไขในโหมดทดลองทั้งหมด?</span><button class="btn sm danger" data-act="demoresetok">ยืนยัน</button><button class="btn sm" data-act="demoresetno">ยกเลิก</button></div>`; break;
      case 'demoresetno': $('#resetBox').innerHTML=''; break;
      case 'demoresetok': ['ping_overrides','ping_subs','ping_audit'].forEach(k=>{ try{localStorage.removeItem(k);}catch(e){} }); Store.initDemo(); toast('ล้างข้อมูลทดลองแล้ว'); break;
    }
  });
  document.addEventListener('toggle', e=>{ if(e.target.classList && e.target.classList.contains('statsbox')) S.statsOpen = e.target.open; }, true);
  document.addEventListener('keydown', e=>{ if(e.key==='Escape' && !$('#modalBg')?.dataset.locked) closeModal(); });
  $$('.tab').forEach(b=>b.onclick = ()=>setTab(b.dataset.tab));
  $('#newBtn').onclick = ()=>openForm('new');
  $('#authBtn').dataset.act = 'auth';
  let qt;
  $('#filters').addEventListener('input', e=>{
    if(e.target.id==='fq'){ clearTimeout(qt); qt=setTimeout(()=>{ S.f.q=e.target.value.trim(); renderView(); const fc=$('.fcount'); if(fc){ const pos=e.target.selectionStart; renderFilters(); const q=$('#fq'); q.focus(); q.setSelectionRange(pos,pos);} }, 250); }
  });
  $('#filters').addEventListener('change', e=>{
    const id=e.target.id; if(id==='fq') return;
    if(id==='fLp'){ S.prov=e.target.value||null; S.amp=null; S.tam=null; }
    if(id==='fLa'){ S.amp=e.target.value||null; S.tam=null; }
    if(id==='fLt'){ S.tam=e.target.value||null; }
    if(id==='fLb'){ S.basin=e.target.value||null; S.bprov=S.bamp=S.btam=null; }
    if(id==='fBp'){ S.bprov=e.target.value||null; S.bamp=S.btam=null; }
    if(id==='fBa'){ S.bamp=e.target.value||null; S.btam=null; }
    if(id==='fBt'){ S.btam=e.target.value||null; }
    if(id==='fF'){ S.f.F=e.target.value; S.f.S=''; } if(id==='fS') S.f.S=e.target.value; if(id==='fG') S.f.grp=e.target.value;
    renderFilters(); renderView();
  });
}

/* ================= BOOT ================= */
async function boot(){
  bind();
  try{
    const [m, seed] = await Promise.all([fetch(DATA+'master.json?v='+encodeURIComponent(CFG.version||'')).then(r=>r.json()), fetch(DATA+'projects_seed.json?v='+encodeURIComponent(CFG.version||'')).then(r=>r.json())]);
    M = m; SEED = seed;
    M.tambons.forEach(t=>T[t.id]=t);
    GROUP_DESC = Object.fromEntries(Object.entries(M.groupInfo||{}).map(([k,v])=>[k,v.cond]));
    M.measures.forEach(x=>MEAS[x.code]=x); M.programmes.forEach(x=>PROG[x.code]=x); M.strategies.forEach(x=>STRAT[x.n]=x); M.basins.forEach(x=>BAS[x.name]=x);
  }catch(e){ $('#view').innerHTML = `<div class="empty">โหลดข้อมูลไม่สำเร็จ (${esc(e.message)}) ตรวจว่าโฟลเดอร์ data อยู่ข้างไฟล์ index.html</div>`; return; }
  const h = (location.hash||'').slice(1); if(['area','basin','map','admin'].includes(h)) S.tab=h;
  $$('.tab').forEach(b=>b.setAttribute('aria-selected', b.dataset.tab===S.tab));
  await Store.init();
  const ss = Sess.get();
  if(!ss) openWelcome();
  else if(ss.role==='admin' && Store.mode==='firebase'){ setTimeout(()=>{ if(!S.admin && !Store.auth.currentUser){ Sess.clear(); openWelcome('admin'); } }, 2500); }
}
/* ปรับขนาดชื่อระบบให้พอดีบรรทัดเดียวตามฟอนต์จริงที่โหลด */
function fitTitle(){
  const h = document.querySelector('.brand h1'); if(!h) return;
  h.style.fontSize = '';
  let size = parseFloat(getComputedStyle(h).fontSize);
  const max = 38; size = Math.min(max, size * (h.clientWidth / Math.max(1, h.scrollWidth)) * 1.15);
  h.style.fontSize = size + 'px';
  let guard = 40;
  while(h.scrollWidth > h.clientWidth + 1 && guard-- > 0){ size -= 0.5; h.style.fontSize = size + 'px'; }
}
let fitT; window.addEventListener('resize', ()=>{ clearTimeout(fitT); fitT = setTimeout(fitTitle, 80); });
if(document.fonts && document.fonts.ready) document.fonts.ready.then(fitTitle);
window.addEventListener('load', fitTitle);
setTimeout(fitTitle, 50); setTimeout(fitTitle, 1200); setTimeout(fitTitle, 3500);
if(window.ResizeObserver){ const ro = new ResizeObserver(()=>{ clearTimeout(fitT); fitT = setTimeout(fitTitle, 60); }); document.addEventListener('DOMContentLoaded', ()=>{ const b=document.querySelector('.brand'); if(b) ro.observe(b); }); const b0=document.querySelector('.brand'); if(b0) ro.observe(b0); }
document.readyState==='loading' ? document.addEventListener('DOMContentLoaded', boot) : boot();
})();
