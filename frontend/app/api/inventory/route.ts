import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../lib/firebase';
import {
  collection,
  getDocs,
  addDoc,
  deleteDoc,
  updateDoc,
  doc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import seedInventory from '../../../data/inventory.json';

export const dynamic = 'force-dynamic';

const DEFAULT_WH_ID = 'wh_wjmals';

const defaultInventory = seedInventory;

function getSubCol(whId: string) {
  return collection(db, 'warehouses', whId, 'inventory_items');
}

// GET /api/inventory?warehouseId=...
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const search = searchParams.get('search') || '';
  const statusFilter = searchParams.get('status') || '';
  const warehouseId = searchParams.get('warehouseId') || DEFAULT_WH_ID;

  try {
    const colRef = getSubCol(warehouseId);
    const snap = await getDocs(colRef);
    let items = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];

    if (items.length === 0 && warehouseId === DEFAULT_WH_ID) {
      for (const item of defaultInventory) {
        await setDoc(doc(db, 'warehouses', warehouseId, 'inventory_items', item.id), {
          ...item,
          createdAt: new Date().toISOString(),
        });
      }
      items = defaultInventory;
    }

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
    console.warn('Inventory subcollection error:', err);
    return NextResponse.json(defaultInventory, { status: 200 });
  }
}

// POST /api/inventory
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, current, safe, cycle, warehouseId: bodyWhId } = body;
    const warehouseId = bodyWhId || DEFAULT_WH_ID;

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
      createdAt: new Date().toISOString(),
    };

    const colRef = getSubCol(warehouseId);
    const docRef = await addDoc(colRef, newItem);
    return NextResponse.json({ id: docRef.id, ...newItem }, { status: 201 });
  } catch (err) {
    console.error('Firestore 재고 추가 실패:', err);
    return NextResponse.json({ error: '저장 실패' }, { status: 500 });
  }
}

// DELETE /api/inventory?id=xxx&warehouseId=...
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const warehouseId = searchParams.get('warehouseId') || DEFAULT_WH_ID;

  if (!id) {
    return NextResponse.json({ error: 'id가 없습니다.' }, { status: 400 });
  }

  try {
    await deleteDoc(doc(db, 'warehouses', warehouseId, 'inventory_items', id));
    return NextResponse.json({ success: true, deletedId: id });
  } catch (err) {
    console.error('Firestore 재고 삭제 실패:', err);
    return NextResponse.json({ error: '삭제 실패' }, { status: 500 });
  }
}

// PATCH /api/inventory
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, current, safe, warehouseId: bodyWhId } = body;
    const warehouseId = bodyWhId || DEFAULT_WH_ID;

    if (!id || current === undefined) {
      return NextResponse.json({ error: 'id 및 current 수량이 필요합니다.' }, { status: 400 });
    }

    const colRef = getSubCol(warehouseId);
    const snap = await getDocs(colRef);
    let targetDoc = snap.docs.find(d => d.id === id || d.data().id === id);

    if (!targetDoc) {
      return NextResponse.json({ error: '해당 아이템을 찾을 수 없습니다.' }, { status: 404 });
    }

    const safeStock = safe ?? targetDoc.data().safe ?? 10000;
    const diff = current - safeStock;

    let status = 'safe';
    let statusLabel = '안전 재고';
    let diffText = '적정 범위 유지';
    let recommendation = '수요 안정적 → 현 유통 계획 유지';

    if (current < safeStock * 0.5) {
      status = 'shortage';
      statusLabel = '재고 부족';
      diffText = `부족분: ${diff}톤`;
      recommendation = '재고 하한선 이탈 → 즉시 추가 발주 필요';
    } else if (current > safeStock * 2) {
      status = 'overstock';
      statusLabel = '재고 과다';
      diffText = `초과분: +${diff}톤`;
      recommendation = '창고 점유율 초과 → 프로모션 및 출하량 증대 필요';
    }

    const updateData = {
      current,
      status,
      statusLabel,
      diffText,
      recommendation,
      updatedAt: new Date().toISOString()
    };

    await updateDoc(doc(db, 'warehouses', warehouseId, 'inventory_items', targetDoc.id), updateData);
    return NextResponse.json({ id: targetDoc.id, itemId: targetDoc.data().id, ...targetDoc.data(), ...updateData });
  } catch (err) {
    console.error('Firestore 재고 수정 실패:', err);
    return NextResponse.json({ error: '수정 실패' }, { status: 500 });
  }
}
