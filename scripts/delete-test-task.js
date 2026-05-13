/**
 * 검증용 TEST 업무 삭제 (일회성)
 * 조건: title === 'TEST' && assigneeName === '최선아' && category === '매출'
 */
require('dotenv').config();
const { initializeApp } = require('firebase/app');
const {
  getFirestore,
  collection,
  getDocs,
  doc,
  deleteDoc,
} = require('firebase/firestore');

const app = initializeApp({
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
});
const db = getFirestore(app);

async function main() {
  const snap = await getDocs(collection(db, 'tasks'));
  const candidates = snap.docs
    .map((d) => ({ taskId: d.id, ...d.data() }))
    .filter(
      (t) =>
        (t.title || '').trim().toUpperCase() === 'TEST' &&
        t.assigneeName === '최선아' &&
        t.category === '매출'
    );

  console.log(`매칭 ${candidates.length}건:`);
  candidates.forEach((t) => {
    const due = t.dueDate?.toDate?.()?.toISOString?.()?.slice(0, 10) || '-';
    console.log(`  - [${t.taskId}] "${t.title}" · ${t.assigneeName} · ${t.category} · 마감 ${due}`);
  });

  if (candidates.length === 0) {
    console.log('삭제 대상 없음.');
    process.exit(0);
  }

  for (const t of candidates) {
    await deleteDoc(doc(db, 'tasks', t.taskId));
    console.log(`  ✅ 삭제: ${t.taskId}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('❌', e);
  process.exit(1);
});
