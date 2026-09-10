import * as fs from 'fs';
import * as path from 'path';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, getDocs, deleteDoc, doc } from 'firebase/firestore';

const envPath = path.resolve(__dirname, '../.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || '';
      if (value.length > 0 && value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') {
        value = value.replace(/^"|"$/g, '');
      }
      process.env[key] = value.trim();
    }
  });
}

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

// 파일 경로 (frontend/data/inventory.json)
const DATA_PATH = path.resolve(__dirname, '../data/inventory.json');

async function run() {
  console.log('🧹 Clearing existing inventory_items from Firestore...');
  const snap = await getDocs(collection(db, 'inventory_items'));
  for (const d of snap.docs) {
    await deleteDoc(doc(db, 'inventory_items', d.id));
  }

  const raw = fs.readFileSync(DATA_PATH, 'utf8');
  const items: any[] = JSON.parse(raw);
  console.log(`🚀 ${items.length}개의 레코드를 'inventory_items' 컬렉션에 삽입합니다.`);

  for (const item of items) {
    const docData = {
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
      createdAt: new Date(),
    };
    await addDoc(collection(db, 'inventory_items'), docData);
  }
  console.log('✅ 모두 완료되었습니다.');
  process.exit(0);
}

run().catch(e => console.error('❌ 오류:', e));
