import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../lib/firebase';
import {
  collection,
  getDocs,
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';

export const dynamic = 'force-dynamic';

const DEFAULT_WH_ID = 'wh_wjmals';

const defaultZones = [
  { id: 'zone_A1', name: 'A-1 구역 (메인 보관 1창고)', state: 'normal', stateLabel: '정상', temp: '-22°C', items: ['고등어(식용)', '명태'], capacity: 120000 },
  { id: 'zone_A2', name: 'A-2 구역 (고밀도 랙 보관소)', state: 'warning', stateLabel: '과다점유', temp: '-20°C', items: ['갈치(국내산)', '갈치(수입산)'], capacity: 30000 },
  { id: 'zone_B1', name: 'B-1 구역 (항온/항습 보관실)', state: 'normal', stateLabel: '정상', temp: '3°C', items: ['조기', '오징어(연안산)', '삼치'], capacity: 40000 },
  { id: 'zone_B2', name: 'B-2 구역 (특수 보관/급속동결실)', state: 'normal', stateLabel: '정상', temp: '-25°C', items: ['전갱이', '꽁치', '오징어(원양산)'], capacity: 60000 },
];

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const warehouseId = searchParams.get('warehouseId') || DEFAULT_WH_ID;

  try {
    // 1. 해당 창고의 재고 품목 데이터 조회
    const invSnap = await getDocs(collection(db, 'warehouses', warehouseId, 'inventory_items'));
    const invItems = invSnap.docs.map(d => d.data());

    // 2. 해당 창고의 구역 데이터 조회
    const zoneColRef = collection(db, 'warehouses', warehouseId, 'warehouse_zones');
    const zoneSnap = await getDocs(zoneColRef);
    let zoneDocs = zoneSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (zoneDocs.length === 0 && warehouseId === DEFAULT_WH_ID) {
      for (const z of defaultZones) {
        await setDoc(doc(db, 'warehouses', warehouseId, 'warehouse_zones', z.id), { ...z, updated_at: new Date().toISOString() });
      }
      zoneDocs = defaultZones;
    }

    // 3. 구역별 공실률 동적 계산
    const updatedZones = zoneDocs.map((z: any) => {
      const itemsList: string[] = Array.isArray(z.items) ? z.items : [];
      const capacity = z.capacity || 100000;

      const currentStockSum = invItems
        .filter((inv: any) => itemsList.includes(inv.name))
        .reduce((sum: number, inv: any) => sum + (Number(inv.current) || 0), 0);

      const occupancy = Math.min(1.0, currentStockSum / capacity);
      const emptyRatio = Number((1.0 - occupancy).toFixed(2));

      let state = z.state || 'normal';
      let stateLabel = z.stateLabel || '정상';

      if (itemsList.length === 0 || currentStockSum === 0) {
        state = 'empty';
        stateLabel = '미보관 (공실 100%)';
      } else if (emptyRatio >= 0.80) {
        state = 'shortage';
        stateLabel = '보관량 부족 (높은 공실률)';
      } else if (emptyRatio <= 0.15 || currentStockSum > capacity * 0.9) {
        state = 'warning';
        stateLabel = '과다점유 (낮은 공실률)';
      } else {
        state = 'normal';
        stateLabel = '정상 보관 중';
      }

      return {
        ...z,
        currentStockSum,
        emptyRatio,
        state,
        stateLabel,
      };
    });

    return NextResponse.json(updatedZones);
  } catch (err) {
    console.error('Zones GET error:', err);
    return NextResponse.json(defaultZones);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, name, state, stateLabel, temp, items, capacity, warehouseId: bodyWhId } = body;
    const warehouseId = bodyWhId || DEFAULT_WH_ID;

    if (!id || !name) {
      return NextResponse.json({ error: 'id와 name은 필수입니다.' }, { status: 400 });
    }

    const itemsList = Array.isArray(items) ? items : [];

    const zoneDoc = {
      name,
      state: state || 'normal',
      stateLabel: stateLabel || '정상',
      temp: temp || '-20°C',
      items: itemsList,
      capacity: capacity || 100000,
      updated_at: new Date().toISOString(),
    };

    await setDoc(doc(db, 'warehouses', warehouseId, 'warehouse_zones', id), zoneDoc, { merge: true });
    return NextResponse.json({ id, ...zoneDoc });
  } catch (err) {
    return NextResponse.json({ error: '구역 정보 저장 실패' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const warehouseId = searchParams.get('warehouseId') || DEFAULT_WH_ID;

  if (!id) {
    return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 });
  }

  try {
    await deleteDoc(doc(db, 'warehouses', warehouseId, 'warehouse_zones', id));
    return NextResponse.json({ success: true, deletedId: id });
  } catch (err) {
    return NextResponse.json({ error: '구역 삭제 실패' }, { status: 500 });
  }
}
