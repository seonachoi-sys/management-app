require('dotenv').config();
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, deleteDoc, doc } = require('firebase/firestore');

const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function main() {
  const snap = await getDocs(collection(db, 'projects'));
  const kvipDocs = [];
  snap.forEach(d => {
    const data = d.data();
    const name = data.shortName || data.projectName || '';
    if (name.includes('VIP') || name.includes('암젠') || name.toLowerCase().includes('kvip') || name.toLowerCase().includes('k-vip')) {
      kvipDocs.push({ id: d.id, shortName: data.shortName, projectName: data.projectName, status: data.status });
    }
  });

  console.log('K-VIP/KVIP 관련 과제 목록:');
  kvipDocs.forEach(d => console.log(`  ID: ${d.id}, shortName: ${d.shortName}, projectName: ${d.projectName}, status: ${d.status}`));

  if (kvipDocs.length > 1) {
    // 두 번째 중복 삭제 (나중에 추가된 것)
    const toDelete = kvipDocs[kvipDocs.length - 1];
    console.log(`\n삭제 대상: ${toDelete.id} (${toDelete.shortName})`);
    await deleteDoc(doc(db, 'projects', toDelete.id));
    console.log('✅ 삭제 완료!');
  } else {
    console.log('중복 없음 — 삭제하지 않음');
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
