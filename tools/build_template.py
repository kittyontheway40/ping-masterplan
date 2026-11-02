# สร้างแบบฟอร์ม Excel สำหรับนำเข้าโครงการ: python3 tools/build_template.py
import json, re, os
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.utils import get_column_letter
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
M = json.load(open(os.path.join(ROOT,'data/master.json'), encoding='utf-8'))
app = open(os.path.join(ROOT,'assets/app.js'), encoding='utf-8').read()
GI = M['groupInfo']
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

DESC_SHEET='คำอธิบายสภาพพื้นที่ (อ่านก่อน)'
# 2) กรอกข้อมูล
HEAD=[('ลำดับ',7),('ชื่อแนวทาง/โครงการ *',46),('รายละเอียด',46),('ยุทธศาสตร์ *',30),('สภาพพื้นที่ *',34),('จังหวัด *',14),('อำเภอ *',18),('ตำบล *',30),
('หน่วยงานรับผิดชอบ',26),('งบประมาณ (ล้านบาท)',14),('ปีเริ่ม (พ.ศ.)',11),('ปีสิ้นสุด (พ.ศ.)',11),('สถานะ',18),('หมายเหตุ',28)]
def header(ws,banner=False):
    r0=1
    if banner:
        ws.merge_cells(start_row=1,start_column=1,end_row=1,end_column=len(HEAD))
        c=ws.cell(1,1,f'กรอก 1 แถว = 1 โครงการ  ·  หัวตารางสีชมพู = ต้องกรอก  ·  สภาพพื้นที่ต้องตรงยุทธศาสตร์ (ยศ.1=W  ยศ.2=P  ยศ.3=R  ยศ.4=E  ยศ.5=G)  ·  อ่านความหมายที่ชีต “{DESC_SHEET}”  ·  ตำบลหลายตำบลคั่นด้วย , หรือพิมพ์ ทั้งอำเภอ')
        c.font=F(bold=True,color=NAVY,size=11); c.fill=PatternFill('solid',fgColor='FDF2F7'); c.alignment=Alignment(vertical='center',wrap_text=True)
        ws.row_dimensions[1].height=42; r0=2
    for j,(h,w) in enumerate(HEAD,1):
        c=ws.cell(r0,j,h); c.font=F(bold=True,color='FFFFFF',size=11); c.fill=PatternFill('solid',fgColor=PINK if '*' in h else NAVY)
        c.alignment=Alignment(horizontal='center',vertical='center',wrap_text=True); c.border=B
        ws.column_dimensions[get_column_letter(j)].width=w
    ws.row_dimensions[r0].height=36; ws.freeze_panes=f'C{r0+1}'
ws2=wb.active; ws2.title='กรอกข้อมูล'; header(ws2,banner=True)
N=301
for r in range(3,N+2):
    ws2.cell(r,1,r-2).font=F(color='8A94A6')
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
    d.add(f'{col_letter}3:{col_letter}{N+1}'); return d
for sh in (ws2,):
    sh.add_data_validation(dv('D','A',len(strats),'ยุทธศาสตร์','เลือกยุทธศาสตร์ 1–5'))
    sh.add_data_validation(dv('E','B',len(grps),'สภาพพื้นที่','เลือกให้ตรงยุทธศาสตร์: ยศ.1=W ยศ.2=P ยศ.3=R ยศ.4=E ยศ.5=G · ดูความหมายที่ชีตคำอธิบายสภาพพื้นที่'))
    sh.add_data_validation(dv('F','C',len(provs),'จังหวัด','เลือกจังหวัดในลุ่มน้ำปิง'))
    sh.add_data_validation(dv('G','D',len(amps),'อำเภอ','เลือกอำเภอในจังหวัดที่เลือก'))
    sh.add_data_validation(dv('M','E',len(STATUS),'สถานะ','เลือกสถานะ หรือเว้นว่าง'))
    for col,title,msg in [('H','ตำบล','หลายตำบลคั่นด้วย , หรือพิมพ์ ทั้งอำเภอ'),('K','ปีเริ่ม','ปี พ.ศ. เช่น 2570'),('L','ปีสิ้นสุด','ปี พ.ศ. เช่น 2572'),('J','งบประมาณ','ตัวเลข หน่วยล้านบาท')]:
        d=DataValidation(type='custom',formula1='TRUE',allow_blank=True); d.prompt=msg; d.promptTitle=title; d.showInputMessage=True; d.add(f'{col}3:{col}{N+1}'); sh.add_data_validation(d)

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

# 3) คำอธิบายสภาพพื้นที่
ws4=wb.create_sheet(DESC_SHEET)
ws4.merge_cells('A1:E1'); c=ws4.cell(1,1,'คำอธิบายสภาพพื้นที่ — ใช้เลือกช่อง “สภาพพื้นที่” ในชีตกรอกข้อมูล (เลือกรหัสที่ตรงกับยุทธศาสตร์ของโครงการ)')
c.font=F(bold=True,size=13,color=NAVY); c.fill=PatternFill('solid',fgColor='FDF2F7'); ws4.row_dimensions[1].height=30; c.alignment=Alignment(vertical='center')
for j,(h,w) in enumerate([('รหัส',8),('สภาพพื้นที่',38),('ยุทธศาสตร์',28),('เงื่อนไขการจำแนก (ความหมาย)',60),('แนวทาง/แผนงานหลักที่เหมาะสม',70)],1):
    c=ws4.cell(2,j,h); c.font=F(bold=True,color='FFFFFF'); c.fill=PatternFill('solid',fgColor=NAVY); c.border=B; c.alignment=Alignment(vertical='center',wrap_text=True); ws4.column_dimensions[get_column_letter(j)].width=w
FILL={'W':'EAF3FB','P':'EDF6EE','R':'FCF1E4','E':'E8F5F3','G':'F1ECF7'}
for i,k in enumerate(grp_keys,3):
    for j,v in enumerate([k,M['groups'][k],strats[FAM.index(k[0])],GI[k]['cond'],GI[k]['plan']],1):
        c=ws4.cell(i,j,v); c.font=F(bold=(j<=2),color=NAVY if j<=2 else '1F2937'); c.border=B; c.alignment=Alignment(vertical='top',wrap_text=True); c.fill=PatternFill('solid',fgColor=FILL[k[0]])
ws4.freeze_panes='C3'
ws2.sheet_properties.tabColor=PINK; ws4.sheet_properties.tabColor=NAVY
wb._sheets=[ws2,ws4,ws3,wl]   # ลำดับ: กรอกข้อมูล · คำอธิบายสภาพพื้นที่ · ตัวอย่าง (+ ชีตรายการที่ซ่อนไว้)
wb.active=0
out=os.path.join(ROOT,'assets/template_proposal.xlsx'); wb.save(out); print('saved',out,len(tams),'tambons')
