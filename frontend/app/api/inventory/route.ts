import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../lib/firebase';
import {
  collection,
  getDocs,
  addDoc,
  deleteDoc,
  doc,
  query,
  where,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore';

export const dynamic = 'force-dynamic';

const COL = 'inventory_items';

// GET /api/inventory
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const search = searchParams.get('search') || '';
  const statusFilter = searchParams.get('status') || '';

  try {
    const snap = await getDocs(collection(db, COL));
    let items = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];

    if (search) {
      items = items.filter((i: any) =>
        i.name?.includes(search) || i.id?.includes(search)
      );
    }
    if (statusFilter && statusFilter !== '전체') {
      items = items.filter((i: any) => i.statusLabel === statusFilter);
    }

    return NextResponse.json(items);
  } catch (err) {
    console.warn('[Firestore Fallback] 연결 불가:', err);
    return NextResponse.json([], { status: 200 });
  }
}

// POST /api/inventory
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, current, safe, cycle } = body;

  if (!name || current === undefined || safe === undefined) {
    return NextResponse.json({ error: '필수값(name, current, safe)이 없습니다.' }, { status: 400 });
  }

  const diff = current - safe;
  let status = 'safe';
  let statusLabel = '안전 재고';
  let diffText = '적정 범위 유지';
  let recommendation = '수요 안정적 → 현 유통 계획 유지';

  if (current < safe * 0.5) {
    status = 'shortage';
    statusLabel = '재고 부족';
    diffText = `부족분: ${diff}톤`;
    recommendation = '재고 하한선 이탈 → 즉시 추가 발주 필요';
  } else if (current > safe * 2) {
    status = 'overstock';
    statusLabel = '재고 과다';
    diffText = `초과분: +${diff}톤`;
    recommendation = '창고 점유율 초과 → 프로모션 및 출하량 증대 필요';
  }

  const date = new Date().toISOString().split('T')[0];
  const newItem = {
    name, current, safe, status, statusLabel, diffText, recommendation,
    cycle: cycle || '월간',
    date,
    createdAt: serverTimestamp(),
  };

  try {
    const docRef = await addDoc(collection(db, COL), newItem);
    return NextResponse.json({ id: docRef.id, ...newItem }, { status: 201 });
  } catch (err) {
    console.error('Firestore 재고 추가 실패:', err);
    return NextResponse.json({ error: '저장 실패' }, { status: 500 });
  }
}

// DELETE /api/inventory?id=xxx
export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id가 없습니다.' }, { status: 400 });
  }

  try {
    await deleteDoc(doc(db, COL, id));
    return NextResponse.json({ success: true, deletedId: id });
  } catch (err) {
    console.error('Firestore 재고 삭제 실패:', err);
    return NextResponse.json({ error: '삭제 실패' }, { status: 500 });
  }
}
