require('dotenv').config();
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');

const app = initializeApp({
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
});
const db = getFirestore(app);

async function check() {
  const tasksSnap = await getDocs(collection(db, 'tasks'));
  const tasks = tasksSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  const kpisSnap = await getDocs(collection(db, 'kpis'));
  const kpis = kpisSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // 1. 복수 담당자
  const multiTasks = tasks.filter(t => t.assigneeName && t.assigneeName.includes(','));
  const multiKpis = kpis.filter(k => k.assigneeName && k.assigneeName.includes(','));

  console.log('=== 복수 담당자 (쉼표 포함) ===');
  console.log(`Tasks: ${multiTasks.length}건`);
  multiTasks.forEach(t => console.log(`  [${t.id}] "${t.title}" → "${t.assigneeName}"`));
  console.log(`KPIs: ${multiKpis.length}건`);
  multiKpis.forEach(k => console.log(`  [${k.id}] "${k.title}" → "${k.assigneeName}"`));

  // 2. SeonA Choi
  const seonaTasks = tasks.filter(t => t.assigneeName === 'SeonA Choi');
  const seonaKpis = kpis.filter(k => k.assigneeName === 'SeonA Choi');

  console.log('\n=== SeonA Choi ===');
  console.log(`Tasks: ${seonaTasks.length}건`);
  seonaTasks.forEach(t => console.log(`  [${t.id}] "${t.title}"`));
  console.log(`KPIs: ${seonaKpis.length}건`);
  seonaKpis.forEach(k => console.log(`  [${k.id}] "${k.title}"`));

  // 3. 미배정
  const unassignedTasks = tasks.filter(t => !t.assigneeName || t.assigneeName.trim() === '');
  const unassignedKpis = kpis.filter(k => !k.assigneeName || k.assigneeName.trim() === '');

  console.log('\n=== 미배정 (assigneeName 없음/빈값) ===');
  console.log(`Tasks: ${unassignedTasks.length}건`);
  unassignedTasks.forEach(t => {
    const dd = t.dueDate?.toDate ? t.dueDate.toDate() : null;
    const dateStr = dd ? `${dd.getMonth()+1}.${dd.getDate()}` : '-';
    console.log(`  "${t.title}" · ${t.category || '-'} · ${dateStr}`);
  });
  console.log(`KPIs: ${unassignedKpis.length}건`);
  unassignedKpis.forEach(k => console.log(`  "${k.title}" · ${k.period}`));

  process.exit(0);
}
check().catch(e => { console.error(e); process.exit(1); });
