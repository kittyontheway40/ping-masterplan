import geopandas as g, pandas as pd, openpyxl, collections as C, re, json, warnings, numpy as np
warnings.filterwarnings('ignore')
import sys, os
D=sys.argv[1] if len(sys.argv)>1 else 'source/'; OUT=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','data')+'/'
def strip(s,p): return re.sub('^'+p+r'\.\s*','',s or '').strip()
# ---------- tambon geometry + decree ----------
t=g.read_file(D+'tambon_ping.gpkg')
t['tam']=t.TAM_NAM_T.map(lambda s:strip(s,'ต')); t['amp']=t.AMPHOE_T.map(lambda s:strip(s,'อ')); t['prov']=t.PROV_NAM_T.map(lambda s:strip(s,'จ'))
wb=openpyxl.load_workbook(D+'basin_decree.xlsx',data_only=True)
dec=[r for r in wb['รายการ_PDF'].iter_rows(min_row=6,values_only=True) if r[2]=='ลุ่มน้ำปิง']
cov={}
for r in dec:
  pv,am,tm,st=r[3],r[4],r[5],r[6]
  if st=='ครอบคลุมทั้งจังหวัด': sel=t[t.prov==pv]
  elif st=='ครอบคลุมทั้งอำเภอ': sel=t[(t.prov==pv)&(t.amp==am)]
  else: sel=t[(t.prov==pv)&(t.amp==am)&(t.tam==tm)]
  for i in sel.index: cov[i]=st
t=t.loc[sorted(cov)].copy(); t['coverage']=[cov[i] for i in t.index]
t['id']=t.TAMBON_IDN.astype(str)
# ---------- subbasin overlay ----------
sb=g.read_file(D+'subbasin_ping.gpkg').to_crs(32647)
sbcode=dict(zip(sb.SB_NAME_T,sb.SB_CODE))
tu=t.to_crs(32647)
ov=g.overlay(tu[['id','geometry']],sb[['SB_NAME_T','geometry']],how='intersection',keep_geom_type=True)
ov['a']=ov.area/1e6
tarea=dict(zip(tu.id,tu.area/1e6))
sub=C.defaultdict(list)
for _,r in ov.iterrows():
  sh=r.a/tarea[r.id]
  if sh>=0.02: sub[r.id].append((r.SB_NAME_T,round(sh*100,1)))
for k in sub: sub[k].sort(key=lambda x:-x[1])
# กฎเสริม: ลุ่มน้ำสาขาที่ไม่เป็นลุ่มหลักของตำบลใดเลย ให้ตำบลที่ครอบคลุมพื้นที่ลุ่มนั้นมากที่สุดย้ายมาเป็นลุ่มหลัก
main_cnt=C.Counter(v[0][0] for v in sub.values() if v); moved={}
for bname in sb.SB_NAME_T:
  if main_cnt[bname]: continue
  cand=ov[ov.SB_NAME_T==bname].sort_values('a',ascending=False)
  for _,cr in cand.iterrows():
    lst=sub.get(cr.id,[])
    if not lst or main_cnt[lst[0][0]]<=1: continue   # ห้ามทำให้อีกลุ่มว่าง
    old=lst[0][0]; lst.sort(key=lambda x:(x[0]!=bname,-x[1])); main_cnt[old]-=1; main_cnt[bname]+=1
    moved[cr.id]=(bname, round(cr.a/(sb[sb.SB_NAME_T==bname].area.sum()/1e6)*100,1), old); print('rule: moved',cr.id,'from',old,'to',bname); break
# ---------- plan excel ----------
import os
PLAN=os.environ.get('PLAN', D+'plan.xlsx')
p=openpyxl.load_workbook(PLAN,data_only=True)
def cols(ws, hdr_row=3):
  hdr=[str(c.value or '').strip() for c in ws[hdr_row]]
  def f(key, optional=False):
    for i,h in enumerate(hdr):
      if h.startswith(key): return i
    if optional: return None
    raise KeyError(f'{ws.title}: column {key!r} not found in {hdr}')
  return f
nam=lambda pv,a:('เมือง'+pv if a=='เมือง' else a)
alias={('เชียงใหม่','แม่วาง','ทุ่งปี๊'):'ทุ่งปี้'}
ws6=p['6 พื้นที่เป้าหมาย 212 ตำบล']; c6=cols(ws6)
I6=dict(sb=c6('ลุ่มน้ำสาขา'),t=c6('ตำบล'),a=c6('อำเภอ'),p=c6('จังหวัด'),g=c6('กลุ่มพื้นที่'),s=c6('ยุทธศาสตร์ที่มีปัญหา'),pr=c6('Priority',True),F=c6('แผนงาน F'))
s6=[r for r in ws6.iter_rows(min_row=4,values_only=True) if isinstance(r[0],int)]
key2id={(r.prov,r.amp,r.tam):r.id for r in t.itertuples()}
tamb={}
for r in t.itertuples():
  tamb[r.id]=dict(id=r.id,t=r.tam,a=r.amp,p=r.prov,area=round(r.AREA_SQKM,1),cov=r.coverage,
    sb=[x[0] for x in sub.get(r.id,[])], sbPct=[x[1] for x in sub.get(r.id,[])],
    target=False,prio=None,grp=[],strat=[],F=[],tBasins=[],geo=True)
extra=0; s6basin=C.defaultdict(set)
def splitcodes(s): return [x.strip() for x in str(s or '').replace('/',',').split(',') if x.strip() and x.strip()!='-']
for r in s6:
  pv,am,tm=r[I6['p']],nam(r[I6['p']],r[I6['a']]),r[I6['t']]; tm=alias.get((pv,am,tm),tm)
  k=(pv,am,tm)
  if k not in key2id:
    nid='X%03d'%(extra+1); extra+=1; key2id[k]=nid
    tamb[nid]=dict(id=nid,t=tm,a=am,p=pv,area=None,cov='ไม่พบในชั้นข้อมูลขอบเขตตำบล',sb=[],sbPct=[],target=False,prio=None,grp=[],strat=[],F=[],tBasins=[],geo=False)
  d=tamb[key2id[k]]
  d['target']=True
  if I6['pr'] is not None and r[I6['pr']]: d['prio']=int(str(r[I6['pr']]).split()[-1])
  gr=r[I6['g']]; d['grpRaw']=gr if gr and gr!='-' else ''
  d['grp']=sorted(set(d['grp'])|set(splitcodes(gr)))
  d['strat']=sorted(set(d['strat'])|{int(x) for x in re.findall(r'\d',str(r[I6['s']] or ''))})
  d['F']=sorted(set(d['F'])|set(splitcodes(r[I6['F']])),key=lambda x:int(x[1:]))
  b0=r[I6['sb']]; d['tBasins'].append(b0); s6basin[b0].add(key2id[k])
  if not d['geo'] and b0 not in d['sb']: d['sb'].append(b0)
for mid,(bn,share,old) in moved.items():
  if mid in tamb: tamb[mid]['sbNote']=f'กำหนดให้อยู่ลุ่มน้ำสาขา{bn} เพราะตำบลนี้ครอบคลุม {share}% ของพื้นที่ลุ่ม (ลุ่มนี้ไม่มีตำบลที่มีพื้นที่ส่วนใหญ่อยู่ในลุ่ม)'
print('tambons',len(tamb),'extra',extra,'targets',sum(v['target'] for v in tamb.values()))
# target basin vs overlay consistency
bad=[(v['t'],b,v['sb']) for v in tamb.values() for b in v['tBasins'] if v['geo'] and b not in v['sb']]
print('target basin not in overlay',len(bad),bad[:15])
for v in tamb.values():
  for b in v['tBasins']:
    if b not in v['sb']: v['sb'].append(b); v['sbPct'].append(None)
# ---------- projects ----------
ws5=p['5 ทะเบียนแนวทางรายลุ่มน้ำ']; c5=cols(ws5)
I5=dict(seq=c5('ลำดับ'),sb=c5('ลุ่มน้ำสาขา'),ref=c5('ตารางอ้างอิง',True),s=c5('ยุทธศาสตร์'),F=c5('แผนงาน F'),S=c5('มาตรการ S'),title=c5('แนวทาง/โครงการ'),detail=c5('รายละเอียด'),tg=c5('พื้นที่เป้าหมาย'))
s5=[r for r in ws5.iter_rows(min_row=4,values_only=True) if isinstance(r[I5['seq']],int)]
name2ids=C.defaultdict(list)
for v in tamb.values(): name2ids[(v['p'],v['a'],v['t'])].append(v['id'])
projects=[]; unres=0
for r in s5:
  ids=[]
  for m in re.finditer(r'ต\.(\S+)\s+อ\.(\S+)\s+จ\.([^,\s]+)',r[I5['tg']] or ''):
    tm,am,pv=m.groups(); am=nam(pv,am); tm=alias.get((pv,am,tm),tm)
    k=(pv,am,tm)
    if k in key2id: ids.append(key2id[k])
    else: unres+=1; print('unres',k)
  sn=int(re.search(r'\d',r[I5['s']]).group())
  ti=(r[I5['title']] or '').strip(); de=(r[I5['detail']] or '').strip()
  projects.append(dict(id='P%04d'%r[I5['seq']],seq=r[I5['seq']],sb=r[I5['sb']],ref=(r[I5['ref']] if I5['ref'] is not None else '') or '',s=sn,F=(r[I5['F']] or '').strip(),S=(r[I5['S']] or '').strip(),title=ti,
     detail=('' if de==ti else de),tambons=ids,
     agency='',budget=None,yearStart=None,yearEnd=None,status='',note='',src='excel'))
print('projects',len(projects),'unresolved',unres,'with tambons',sum(1 for x in projects if x['tambons']))
# ---------- master ----------
s1=list(p['1 แผนงาน-ยุทธศาสตร์'].iter_rows(min_row=4,values_only=True))
strategies=[]; programmes=[]
summ={r[0]:r for r in p['สรุปนำเสนอ'].iter_rows(min_row=13,max_row=17,values_only=True)} 
cur=None; lastS=None
for r in s1:
  if not r[0] and not r[4]: continue
  sname = r[0] or lastS; lastS = sname
  sn=int(re.search(r'\d',sname).group())
  if r[1]:
    strategies.append(dict(n=sn,name=re.sub(r'^ยุทธศาสตร์\s*\d+\s*','',sname).strip(),flagship=(r[1] or '').strip(),obj=(r[2] or '').strip()))
  fc=r[4].split()[0]
  programmes.append(dict(code=fc,name=r[4][len(fc):].strip(),s=sn,groups=(r[3] or '').strip(),linked=r[5],where=r[6],targets=r[7],types=r[8],measures=r[9],outputInd=r[10],projects=r[13]))
for st in strategies:
  st['short']=next((x[2] for x in p['สรุปนำเสนอ'].iter_rows(min_row=13,max_row=17,values_only=True) if x[1]==st['n']),st['name'])
measures=[]
for r in p['3 มาตรการ S1-S5'].iter_rows(min_row=4,values_only=True):
  if r[0] and re.match(r'S\d-\d+',str(r[0])):
    measures.append(dict(code=r[0],s=int(r[0][1]),name=r[2],desc=r[3],groups=r[4],F=[x.strip() for x in str(r[5]).split(',')]))
inds=[]
ws2=p['2 ตัวชี้วัดและค่าเป้าหมาย']; c2=cols(ws2)
I2={k:c2(h,True) for k,h in dict(code='รหัส',st='ยุทธศาสตร์',name='ตัวชี้วัด',type='ประเภท',unit='หน่วย',base='ค่าฐาน',baseYear='ปีฐาน',owner='หน่วยงานเจ้าของข้อมูล',bau='A0 ปี 2580',t70='A3 ปี 2570',t75='A3 ปี 2575',t80='A3 ปี 2580',F='แผนงานที่เกี่ยวข้อง').items()}
for r in ws2.iter_rows(min_row=4,values_only=True):
  gv=lambda k: (r[I2[k]] if I2[k] is not None else None)
  if gv('code') and re.match(r'(\d+\.\d+|SYS-\d)',str(gv('code'))):
    inds.append(dict(code=str(gv('code')),s=int(re.search(r'ที่\s*(\d)',gv('st')).group(1)),name=gv('name'),type=gv('type'),unit=gv('unit'),base=gv('base'),baseYear=gv('baseYear'),owner=gv('owner'),bau=gv('bau'),t70=gv('t70'),t75=gv('t75'),t80=gv('t80'),F=gv('F')))
    continue
    inds.append(dict(code=str(r[0]),s=0,name=r[2],type=r[3],unit=r[4],base=r[5],baseYear=r[6],owner=r[7],bau=r[8],t70=r[9],t75=r[10],t80=r[11],F=r[12]))
# area group dictionary from F rows
groups={}
for pr in programmes:
  for m in re.finditer(r'\b([WPREG]\d)\s+([^,;()]+)',pr['groups']):
    groups.setdefault(m.group(1),re.split(r'\s+(?:และ|เชื่อม)\s+',m.group(2).strip())[0])
gfam={'W':'น้ำอุปโภคบริโภค','P':'น้ำภาคการผลิต','R':'ความเสี่ยงน้ำท่วม–แล้ง','E':'ระบบนิเวศ','G':'การบริหารจัดการ'}
# basin summary from s4
basins=[]
ws4=p['4 สรุปรายลุ่มน้ำสาขา']; c4=cols(ws4)
I4=dict(tg=c4('ตำบลเป้าหมาย'),plans=c4('แผนงานที่สำคัญ'),**{('F%d'%i):c4('โครงการ/แนวทางหลัก F%d'%i) for i in range(1,10)})
s4={r[0]:r for r in ws4.iter_rows(min_row=4,values_only=True) if r[0] and str(r[I4['tg']]).strip().isdigit()}
sbg=g.read_file(D+'subbasin_ping.gpkg')
for r in sbg.sort_values('SB_CODE').itertuples():
  x=s4.get(r.SB_NAME_T)
  basins.append(dict(code=r.SB_CODE,name=r.SB_NAME_T,area=round(r.AREA_SQKM,1),
     keyF={('F%d'%i):(x[I4['F%d'%i]] or '') for i in range(1,10)} if x else {}, keyPlans=x[I4['plans']] if x else ''))
print('strategies',len(strategies),'F',len(programmes),'S',len(measures),'ind',len(inds),'groups',len(groups))
json.dump(dict(strategies=strategies,programmes=programmes,measures=measures,indicators=inds,groups=groups,groupFamilies=gfam,basins=basins,
  tambons=list(tamb.values()),provinces=sorted({v['p'] for v in tamb.values()})),open(OUT+'master.json','w'),ensure_ascii=False)
json.dump(projects,open(OUT+'projects_seed.json','w'),ensure_ascii=False)
# ---------- geojson (simplified) ----------
def gj(df,tol,props,fn,prec=4):
  d=df.to_crs(32647); d['geometry']=d.geometry.simplify(tol,preserve_topology=True); d=d.to_crs(4326)
  d[props+['geometry']].to_file(OUT+fn,driver='GeoJSON',COORDINATE_PRECISION=prec)
tt=t[['id','geometry']].copy(); gj(tt,120,['id'],'tambon.geojson')
sbg2=sbg[['SB_CODE','SB_NAME_T','geometry']].rename(columns={'SB_CODE':'code','SB_NAME_T':'name'}); gj(sbg2,150,['code','name'],'subbasin.geojson')
pr=g.read_file(D+'province_ping.gpkg')[['ADM1_TH','geometry']].rename(columns={'ADM1_TH':'name'}); print(pr.name.tolist()); gj(pr,400,['name'],'province.geojson',3)
rv=g.read_file(D+'ping_mainriver.gpkg'); rv['k']=1; rv=rv.dissolve('k').reset_index(); gj(rv,80,['k'],'river.geojson')
