# สร้างแบบฟอร์ม Excel สำหรับนำเข้าโครงการ: python3 tools/build_template.py
import json, re, os
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.utils import get_column_letter
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
M = json.load(open(os.path.join(ROOT,'data/master.json'), encoding='utf-8'))
app = open(os.path.join(ROOT,'assets/app.js'), encoding='utf-8').read()
GD = json.loads(re.search(r'const GROUP_DESC = (\{.*?\});', app).group(1))
STATUS = json.loads(re.search(r"const STATUS_OPTS = (\[.*?\]);", app).group(1).replace("'",'"'))
FAM = 'WPREG'
tams = sorted([t for t in M['tambons'] if t.get('sb')], key=lambda t:(t['p'],t['a'],t['t']))
provs = sorted({t['p'] for t in tams})
amps = sorted({t['a'] for t in tams})
strats = [f"{s['n']} {s['short']}" for s in M['strategies']]
grp_keys = sorted(M['groups'], key=lambda k:(FAM.index(k[0]), int(k[1:])))
grps = [f"{k} {M['groups'][k]}" for k in grp_keys]

NAVY='1E3A6E'; PINK='C2477E'; LBL='EAF0FA'
thin=Side(style='thin',color='C9D3E3'); B=Border(left=thin,right=thin,top=thin,bottom=thin)
F=lambda **k: Font(name='Sarabun', **k)
wb=Workbook()

# 1) วิธีกรอก
ws=wb.active; ws.title='วิธีกรอก'
lines=[('แบบฟอร์มเสนอแนวทาง/โครงการ แผนแม่บทการบริหารจัดการทรัพยากรน้ำ ลุ่มน้ำปิง',True,16,NAVY),
('',False,11,None),
('ขั้นตอน',True,13,PINK),
('1. กรอกข้อมูลในชีต "กรอกข้อมูล" โดย 1 แถว = 1 โครงการ (ดูตัวอย่างได้ที่ชีต "ตัวอย่าง")',False,12,None),
('2. ช่องที่มีเครื่องหมาย * ต้องกรอกทุกแถว',False,12,None),
('3. ยุทธศาสตร์ สภาพพื้นที่ จังหวัด อำเภอ และสถานะ ให้เลือกจากดรอปดาวน์ในเซลล์',False,12,None),
('4. สภาพพื้นที่ต้องตรงกับยุทธศาสตร์: ยศ.1 → W  ·  ยศ.2 → P  ·  ยศ.3 → R  ·  ยศ.4 → E  ·  ยศ.5 → G (ความหมายดูชีต "สภาพพื้นที่")',False,12,None),
('5. ตำบล: พิมพ์ชื่อตำบลในอำเภอที่เลือก หลายตำบลคั่นด้วยเครื่องหมายจุลภาค เช่น  ช่างเคิ่ง, ท่าผา  หรือพิมพ์ "ทั้งอำเภอ"',False,12,None),
('    ชื่อตำบลต้องสะกดตรงกับชีต "รายชื่อตำบล" (ไม่ต้องพิมพ์คำว่า ต. หรือ ตำบล)',False,12,None),
('    ถ้าโครงการครอบคลุมหลายอำเภอ ให้แยกเป็นแถวละอำเภอ',False,12,None),
('6. ปีเริ่มและปีสิ้นสุดใช้ปี พ.ศ. เช่น 2570  ·  งบประมาณใส่เป็นตัวเลข หน่วยล้านบาท เช่น 12.5',False,12,None),
('7. บันทึกไฟล์ แล้วกลับไปที่หน้าเว็บ กด "+ เสนอโครงการ" → "นำเข้าจาก Excel" → อัปโหลดไฟล์',False,12,None),
('8. ระบบจะตรวจทุกแถวและบอกแถวที่ต้องแก้ไข ส่งได้ครั้งละไม่เกิน 300 โครงการ',False,12,None),
('',False,11,None),
('หมายเหตุ',True,13,PINK),
('• ห้ามเปลี่ยนชื่อชีต "กรอกข้อมูล" และห้ามลบหรือย้ายหัวตาราง',False,12,None),
('• ลุ่มน้ำสาขาไม่ต้องกรอก ระบบกำหนดให้อัตโนมัติจากตำบลที่เลือก',False,12,None),
('• โครงการที่ส่งจะเข้ากล่องรอพิจารณา และแสดงในระบบเมื่อผู้ดูแลอนุมัติแล้ว',False,12,None)]
for i,(t,b,sz,c) in enumerate(lines,1):
    ws.cell(i,1,t).font=F(bold=b,size=sz,color=c or '1F2937')
ws.column_dimensions['A'].width=130
ws.sheet_view.showGridLines=False

# 2) กรอกข้อมูล
HEAD=[('ลำดับ',7),('ชื่อแนวทาง/โครงการ *',46),('รายละเอียด',46),('ยุทธศาสตร์ *',30),('สภาพพื้นที่ *',34),('จังหวัด *',14),('อำเภอ *',18),('ตำบล *',30),
('หน่วยงานรับผิดชอบ',26),('งบประมาณ (ล้านบาท)',14),('ปีเริ่ม (พ.ศ.)',11),('ปีสิ้นสุด (พ.ศ.)',11),('สถานะ',18),('หมายเหตุ',28)]
def header(ws):
    for j,(h,w) in enumerate(HEAD,1):
        c=ws.cell(1,j,h); c.font=F(bold=True,color='FFFFFF',size=11); c.fill=PatternFill('solid',fgColor=PINK if '*' in h else NAVY)
        c.alignment=Alignment(horizontal='center',vertical='center',wrap_text=True); c.border=B
        ws.column_dimensions[get_column_letter(j)].width=w
    ws.row_dimensions[1].height=36; ws.freeze_panes='C2'
ws2=wb.create_sheet('กรอกข้อมูล'); header(ws2)
N=301
for r in range(2,N+1):
    ws2.cell(r,1,r-1).font=F(color='8A94A6')
    for j in range(1,len(HEAD)+1):
        c=ws2.cell(r,j); c.border=B; c.alignment=Alignment(vertical='top',wrap_text=j in (2,3,8,14))
        if j>1: c.font=F()

# lists (hidden)
wl=wb.create_sheet('_lists')
for col,vals in enumerate([strats,grps,provs,amps,STATUS],1):
    for i,v in enumerate(vals,1): wl.cell(i,col,v)
wl.sheet_state='hidden'
def dv(col_letter,lc,n,title,prompt):
    d=DataValidation(type='list',formula1=f"=_lists!${lc}$1:${lc}${n}",allow_blank=True,showDropDown=False)
    d.error='กรุณาเลือกจากรายการ'; d.errorTitle=title; d.prompt=prompt; d.promptTitle=title; d.showErrorMessage=True; d.showInputMessage=True
    d.add(f'{col_letter}2:{col_letter}{N}'); return d
for sh in (ws2,):
    sh.add_data_validation(dv('D','A',len(strats),'ยุทธศาสตร์','เลือกยุทธศาสตร์ 1–5'))
    sh.add_data_validation(dv('E','B',len(grps),'สภาพพื้นที่','เลือกรหัสให้ตรงยุทธศาสตร์: ยศ.1=W ยศ.2=P ยศ.3=R ยศ.4=E ยศ.5=G'))
    sh.add_data_validation(dv('F','C',len(provs),'จังหวัด','เลือกจังหวัดในลุ่มน้ำปิง'))
    sh.add_data_validation(dv('G','D',len(amps),'อำเภอ','เลือกอำเภอ (ดูความสัมพันธ์จังหวัด–อำเภอ–ตำบล ในชีต รายชื่อตำบล)'))
    sh.add_data_validation(dv('M','E',len(STATUS),'สถานะ','เลือกสถานะ หรือเว้นว่าง'))
    for col,title,msg in [('H','ตำบล','หลายตำบลคั่นด้วย , หรือพิมพ์ ทั้งอำเภอ'),('K','ปีเริ่ม','ปี พ.ศ. เช่น 2570'),('L','ปีสิ้นสุด','ปี พ.ศ. เช่น 2572'),('J','งบประมาณ','ตัวเลข หน่วยล้านบาท')]:
        d=DataValidation(type='custom',formula1='TRUE',allow_blank=True); d.prompt=msg; d.promptTitle=title; d.showInputMessage=True; d.add(f'{col}2:{col}{N}'); sh.add_data_validation(d)

# 3) ตัวอย่าง
ws3=wb.create_sheet('ตัวอย่าง'); header(ws3)
ex=[
[1,'ปรับปรุงระบบประปาหมู่บ้านบ้านป่าไผ่','ระบบประปาเดิมชำรุด น้ำไหลอ่อนในหน้าแล้ง ปรับปรุงถังพักน้ำและเปลี่ยนท่อเมนประมาณ 2 กม.',strats[0],'W2 '+M['groups']['W2'],'เชียงใหม่','แม่แตง','ช่อแล','อบต.ช่อแล',4.5,2570,2571,'เตรียมการ',''],
[2,'ขุดลอกและป้องกันตลิ่งน้ำแม่แตงช่วงไหลผ่านชุมชน','ตลิ่งถูกกัดเซาะต่อเนื่องทุกปี',strats[2],'R4 '+M['groups']['R4'],'เชียงใหม่','แม่แตง','อินทขิล, ขี้เหล็ก','กรมเจ้าท่า',25,2570,2572,'โครงการต่อเนื่อง','ต่อเนื่องจากปี 2568'],
[3,'ฟื้นฟูป่าต้นน้ำและสร้างฝายชะลอน้ำ','ร่วมกับชุมชนในพื้นที่',strats[3],'E2 '+M['groups']['E2'],'เชียงใหม่','เชียงดาว','ทั้งอำเภอ','สำนักงานทรัพยากรธรรมชาติและสิ่งแวดล้อมจังหวัด','','2570','2574','',''],
]
for i,row in enumerate(ex,2):
    for j,v in enumerate(row,1):
        c=ws3.cell(i,j,v); c.font=F(); c.border=B; c.alignment=Alignment(vertical='top',wrap_text=True)
ws3.cell(6,2,'* ชีตนี้เป็นตัวอย่างเท่านั้น ระบบอ่านข้อมูลจากชีต "กรอกข้อมูล"').font=F(italic=True,color=PINK)

# 4) สภาพพื้นที่
ws4=wb.create_sheet('สภาพพื้นที่')
for j,(h,w) in enumerate([('รหัส',8),('สภาพพื้นที่',30),('ยุทธศาสตร์',30),('ความหมาย',100)],1):
    c=ws4.cell(1,j,h); c.font=F(bold=True,color='FFFFFF'); c.fill=PatternFill('solid',fgColor=NAVY); c.border=B; ws4.column_dimensions[get_column_letter(j)].width=w
for i,k in enumerate(grp_keys,2):
    for j,v in enumerate([k,M['groups'][k],strats[FAM.index(k[0])],GD.get(k,'')],1):
        c=ws4.cell(i,j,v); c.font=F(bold=(j==1)); c.border=B; c.alignment=Alignment(vertical='top',wrap_text=True)
        if i%2==0: c.fill=PatternFill('solid',fgColor='F6F8FC')
ws4.freeze_panes='A2'

# 5) รายชื่อตำบล
ws5=wb.create_sheet('รายชื่อตำบล')
for j,(h,w) in enumerate([('จังหวัด',14),('อำเภอ',20),('ตำบล',20),('ลุ่มน้ำสาขาหลัก',30),('ตำบลเป้าหมาย',14)],1):
    c=ws5.cell(1,j,h); c.font=F(bold=True,color='FFFFFF'); c.fill=PatternFill('solid',fgColor=NAVY); c.border=B; ws5.column_dimensions[get_column_letter(j)].width=w
for i,t in enumerate(tams,2):
    for j,v in enumerate([t['p'],t['a'],t['t'],t['sb'][0],'✓' if t.get('target') else ''],1):
        c=ws5.cell(i,j,v); c.font=F(); c.border=B
ws5.auto_filter.ref=f"A1:E{len(tams)+1}"; ws5.freeze_panes='A2'

wb.active=1
out=os.path.join(ROOT,'assets/template_proposal.xlsx'); wb.save(out); print('saved',out,len(tams),'tambons')
