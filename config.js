// ตั้งค่าระบบ
// ถ้ายังไม่ใส่ค่า Firebase (apiKey ว่าง) ข้อมูลที่เพิ่ม/แก้จะเก็บในเบราว์เซอร์เครื่องนั้นเท่านั้น
window.APP_CONFIG = {
  // เลขเวอร์ชันแสดงมุมขวาบน: v<รุ่น> · <วัน.เดือน.ปี พ.ศ. ที่อัปเดต>
  version: "v1.8 · 24.10.2569",
  firebase: {
    apiKey: "AIzaSyCr7JAjfQB4DTMtL0a9gSejcLCXaO1qfRk",
    authDomain: "ping-masterplan.firebaseapp.com",
    projectId: "ping-masterplan",
    storageBucket: "ping-masterplan.firebasestorage.app",
    messagingSenderId: "719887663623",
    appId: "1:719887663623:web:190d03c4db2379917c20a2"
  },
  // แผนที่ฐาน (ต้องต่ออินเทอร์เน็ต) ปิดได้ถ้าหน่วยงานไม่อนุญาต
  basemap: true,
  // รหัสผู้ดูแลเก็บเป็นค่า SHA-256 (ไม่เก็บรหัสจริงในไฟล์) · รหัสปัจจุบัน: แจ้งเฉพาะผู้ดูแล
  // เปลี่ยนรหัส: เปิด https://emn178.github.io/online-tools/sha256.html พิมพ์รหัสใหม่ แล้วนำค่ามาแทนด้านล่าง
  adminCodeHash: "89900c1b793d16fee1729404f61c328f258787a2fd1764d589c3d6d81262bedb",
  // เมื่อเชื่อม Firebase: สร้างบัญชีผู้ดูแลกลาง 1 บัญชีใน Authentication ด้วยอีเมลนี้ และตั้งรหัสผ่านเป็นรหัสผู้ดูแล
  // (เว้นว่างไว้ ถ้าต้องการให้ผู้ดูแลแต่ละคนล็อกอินด้วยอีเมลของตัวเอง)
  adminEmail: "chidsumons@gmail.com"
};
