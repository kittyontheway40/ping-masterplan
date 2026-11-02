# ปรับชื่อ/นิยามสภาพพื้นที่ใน master.json ตาม data/groups.json (รันซ้ำได้ ปลอดภัย)
# ใช้หลัง build_data.py ทุกครั้ง: python3 tools/apply_groups.py
import json, os, re
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mp=os.path.join(ROOT,'data/master.json')
M=json.load(open(mp,encoding='utf-8'))
G=json.load(open(os.path.join(ROOT,'data/groups.json'),encoding='utf-8')); G.pop('_source',None)
old=dict(M.get('groupsOld') or M['groups'])   # ชื่อเดิมจาก Excel แผนแม่บท
FAM='WPREG'
if M.get('groupsVersion')!=2:
    # ระบบรหัส E เดิม (8 กลุ่ม) → ใหม่ (7 กลุ่ม): E7 คุ้มครองแหล่งน้ำดิบ→E6, E8 ช่องว่างข้อมูล→E7, E6 การไหลเพื่อระบบนิเวศ→E4 (ความเชื่อมโยงระบบนิเวศลำน้ำ)
    EMAP={'E6':'E4','E7':'E6','E8':'E7'}
    sub=lambda s: re.sub(r'\bE[678]\b', lambda m: EMAP[m.group(0)], s) if isinstance(s,str) else s
    # ข้อความแผนงาน: แทนรหัส+ชื่อเดิม ด้วยรหัส+ชื่อใหม่
    def ren(s):
        if not isinstance(s,str): return s
        s=s.replace('E6 การไหลเชิงนิเวศ','การไหลเชิงนิเวศ').replace('E6 การไหลเพื่อระบบนิเวศ, ','')
        for k,v in sorted(old.items(), key=lambda kv:-len(kv[1])):
            s=s.replace(f'{k} พื้นที่{v}', f'@@{k[0]}_{k[1:]}@@').replace(f'{k} {v}', f'@@{k[0]}_{k[1:]}@@')
        s=sub(s)
        s=re.sub(r'@@(\w)_(\d)@@', lambda m: (lambda nk: f'{nk} {G[nk][0]}')(EMAP.get(m.group(1)+m.group(2),m.group(1)+m.group(2))), s)
        # ตัดรายการรหัสซ้ำ เช่น "E4, E4" และ "E4 ชื่อ, E4 ชื่อ"
        for _ in range(3):
            s=re.sub(r'\b([WPREG]\d)((?: [^,;()]+)?), \1\2(?=[,;)\s]|$)', r'\1\2', s)
        return s
    for p in M['programmes']:
        for k in ('groups','where','targets'): p[k]=ren(p.get(k))
    for m in M['measures']:
        m['groups']=', '.join(dict.fromkeys(sub(x.strip()) for x in str(m.get('groups') or '').split(',') if x.strip()))
    for t in M['tambons']: t['grp']=list(dict.fromkeys(sub(g) for g in t.get('grp',[])))
    M['groupsOld']=old
    M['groupsVersion']=2
M['groups']={k:v[0] for k,v in sorted(G.items(), key=lambda kv:(FAM.index(kv[0][0]),int(kv[0][1:])))}
M['groupInfo']={k:{'cond':v[1],'plan':v[2]} for k,v in G.items()}
json.dump(M,open(mp,'w',encoding='utf-8'),ensure_ascii=False)
print('groups',len(M['groups']))
