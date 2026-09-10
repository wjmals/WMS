import * as fs from 'fs';
import * as path from 'path';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc } from 'firebase/firestore';

// Firebase client config – same values as .env.local
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// 파일 경로 (프로젝트 루트 기준 /frontend/data/seafood.json)
const DATA_PATH = path.resolve(__dirname, '..', '..', 'data', 'seafood.json');

async function run() {
  const raw = fs.readFileSync(DATA_PATH, 'utf8');
  const items: any[] = JSON.parse(raw);
  console.log(`🚀 ${items.length}개의 레코드를 'inventory_items' 컬렉션에 삽입합니다.`);

  for (const item of items) {
    const doc = {
      id: item.id,
      name: item.name,
      status: item.status,
      statusLabel: item.statusLabel,
      current: Number(item.current),
      safe: Number(item.safe),
      diffText: item.diffText,
      recommendation: item.recommendation,
      cycle: item.cycle,
      date: item.date,
      created_at: new Date(),
    };
    await addDoc(collection(db, 'inventory_items'), doc);
  }
  console.log('✅ 모두 완료되었습니다.');
}

run().catch(e => console.error('❌ 오류:', e));
