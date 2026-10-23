import geopandas as g, pandas as pd, openpyxl, collections as C, re, json, warnings, numpy as np
warnings.filterwarnings('ignore')
import sys, os
D=sys.argv[1] if len(sys.argv)>1 else 'source/'; OUT=os.path.join(os.path.dirname(__file__),'..','data')+'/'
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
# ---------- plan excel ----------
p=openpyxl.load_workbook(D+'plan.xlsx',data_only=True)
nam=lambda pv,a:('เมือง'+pv if a=='เมือง' else a)
alias={('เชียงใหม่','แม่วาง','ทุ่งปี๊'):'ทุ่งปี้'}
s6=[r for r in p['6 พื้นที่เป้าหมาย 212 ตำบล'].iter_rows(min_row=4,values_only=True) if isinstance(r[0],int)]
key2id={(r.prov,r.amp,r.tam):r.id for r in t.itertuples()}
tamb={}
for r in t.itertuples():
  tamb[r.id]=dict(id=r.id,t=r.tam,a=r.amp,p=r.prov,area=round(r.AREA_SQKM,1),cov=r.coverage,
    sb=[x[0] for x in sub.get(r.id,[])], sbPct=[x[1] for x in sub.get(r.id,[])],
    target=False,prio=None,grp=[],strat=[],F=[],tBasins=[],geo=True)
extra=0; s6basin=C.defaultdict(set)
def splitcodes(s): return [x.strip() for x in str(s or '').replace('/',',').split(',') if x.strip() and x.strip()!='-']
for r in s6:
  pv,am,tm=r[4],nam(r[4],r[3]),r[2]; tm=alias.get((pv,am,tm),tm)
  k=(pv,am,tm)
  if k not in key2id:
    nid='X%03d'%(extra+1); extra+=1; key2id[k]=nid
    tamb[nid]=dict(id=nid,t=tm,a=am,p=pv,area=None,cov='ไม่พบในชั้นข้อมูลขอบเขตตำบล',sb=[],sbPct=[],target=False,prio=None,grp=[],strat=[],F=[],tBasins=[],geo=False)
  d=tamb[key2id[k]]
  d['target']=True; d['prio']=int(str(r[7]).split()[-1])
  d['grpRaw']=r[5] if r[5]!='-' else ''
  d['grp']=sorted(set(d['grp'])|set(splitcodes(r[5])))
  d['strat']=sorted(set(d['strat'])|{int(x) for x in re.findall(r'\d',str(r[6]))})
  d['F']=sorted(set(d['F'])|set(splitcodes(r[8])),key=lambda x:int(x[1:]))
  d['tBasins'].append(r[1]); s6basin[r[1]].add(key2id[k])
  if not d['geo'] and r[1] not in d['sb']: d['sb'].append(r[1])
print('tambons',len(tamb),'extra',extra,'targets',sum(v['target'] for v in tamb.values()))
# target basin vs overlay consistency
bad=[(v['t'],b,v['sb']) for v in tamb.values() for b in v['tBasins'] if v['geo'] and b not in v['sb']]
print('target basin not in overlay',len(bad),bad[:15])
for v in tamb.values():
  for b in v['tBasins']:
    if b not in v['sb']: v['sb'].append(b); v['sbPct'].append(None)
# ---------- projects ----------
s5=[r for r in p['5 ทะเบียนแนวทางรายลุ่มน้ำ'].iter_rows(min_row=4,values_only=True) if isinstance(r[0],int)]
name2ids=C.defaultdict(list)
for v in tamb.values(): name2ids[(v['p'],v['a'],v['t'])].append(v['id'])
projects=[]; unres=0
for r in s5:
  ids=[]
  for m in re.finditer(r'ต\.(\S+)\s+อ\.(\S+)\s+จ\.([^,\s]+)',r[8] or ''):
    tm,am,pv=m.groups(); am=nam(pv,am); tm=alias.get((pv,am,tm),tm)
    k=(pv,am,tm)
    if k in key2id: ids.append(key2id[k])
    else: unres+=1; print('unres',k)
  sn=int(re.search(r'\d',r[3]).group())
  projects.append(dict(id='P%04d'%r[0],seq=r[0],sb=r[1],ref=r[2],s=sn,F=r[4],S=r[5],title=(r[6] or '').strip(),
     detail=('' if (r[7] or '').strip()==(r[6] or '').strip() else (r[7] or '').strip()),tambons=ids,
     agency='',budget=None,yearStart=None,yearEnd=None,status='',note='',src='excel'))
print('projects',len(projects),'unresolved',unres,'with tambons',sum(1 for x in projects if x['tambons']))
# ---------- master ----------
s1=list(p['1 แผนงาน-ยุทธศาสตร์'].iter_rows(min_row=4,values_only=True))
strategies=[]; programmes=[]
summ={r[0]:r for r in p['สรุปนำเสนอ'].iter_rows(min_row=13,max_row=17,values_only=True)} 
cur=None
for r in s1:
  if not r[0] and not r[4]: continue
  sn=int(re.search(r'\d',r[0]).group())
  if r[1]:
    strategies.append(dict(n=sn,name=re.sub(r'^ยุทธศาสตร์\s*\d+\s*','',r[0]).strip(),flagship=(r[1] or '').strip(),obj=(r[2] or '').strip()))
  fc=r[4].split()[0]
  programmes.append(dict(code=fc,name=r[4][len(fc):].strip(),s=sn,groups=(r[3] or '').strip(),linked=r[5],where=r[6],targets=r[7],types=r[8],measures=r[9],outputInd=r[10],projects=r[13]))
for st in strategies:
  st['short']=next((x[2] for x in p['สรุปนำเสนอ'].iter_rows(min_row=13,max_row=17,values_only=True) if x[1]==st['n']),st['name'])
measures=[]
for r in p['3 มาตรการ S1-S5'].iter_rows(min_row=4,values_only=True):
  if r[0] and re.match(r'S\d-\d+',str(r[0])):
    measures.append(dict(code=r[0],s=int(r[0][1]),name=r[2],desc=r[3],groups=r[4],F=[x.strip() for x in str(r[5]).split(',')]))
inds=[]
for r in p['2 ตัวชี้วัดและค่าเป้าหมาย'].iter_rows(min_row=4,values_only=True):
  if r[0] and re.match(r'(\d+\.\d+|SYS-\d)',str(r[0])):
    inds.append(dict(code=str(r[0]),s=int(re.search(r'ที่\s*(\d)',r[1]).group(1)),name=r[2],type=r[3],unit=r[4],base=r[5],baseYear=r[6],owner=r[7],bau=r[8],t70=r[9],t75=r[10],t80=r[11],F=r[12]))
# area group dictionary from F rows
groups={}
for pr in programmes:
  for m in re.finditer(r'\b([WPREG]\d)\s+([^,;()]+)',pr['groups']):
    groups.setdefault(m.group(1),re.split(r'\s+(?:และ|เชื่อม)\s+',m.group(2).strip())[0])
gfam={'W':'น้ำอุปโภคบริโภค','P':'น้ำภาคการผลิต','R':'ความเสี่ยงน้ำท่วม–แล้ง','E':'ระบบนิเวศ','G':'การบริหารจัดการ'}
# basin summary from s4
basins=[]
s4={r[0]:r for r in p['4 สรุปรายลุ่มน้ำสาขา'].iter_rows(min_row=4,values_only=True) if r[0] and isinstance(r[1],(int,float))}
sbg=g.read_file(D+'subbasin_ping.gpkg')
for r in sbg.sort_values('SB_CODE').itertuples():
  x=s4.get(r.SB_NAME_T)
  basins.append(dict(code=r.SB_CODE,name=r.SB_NAME_T,area=round(r.AREA_SQKM,1),
     keyF={('F%d'%(i+1)):(x[8+i] or '') for i in range(9)} if x else {}, keyPlans=x[7] if x else ''))
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
