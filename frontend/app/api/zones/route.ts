import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../lib/firebase';
import {
  collection,
  getDocs,
  doc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';

export const dynamic = 'force-dynamic';

const ZONES_COL = 'warehouse_zones';
const INVENTORY_COL = 'inventory_items';

const defaultZones = [
  { id: 'zone_A1', name: 'A-1 구역 (메인 보관 1창고)', state: 'normal', stateLabel: '정상', temp: '-22°C', items: ['고등어(식용)', '명태'], capacity: 120000 },
  { id: 'zone_A2', name: 'A-2 구역 (고밀도 랙 보관소)', state: 'warning', stateLabel: '과다점유', temp: '-20°C', items: ['갈치(국내산)', '갈치(수입산)'], capacity: 30000 },
  { id: 'zone_B1', name: 'B-1 구역 (항온/항습 보관실)', state: 'normal', stateLabel: '정상', temp: '3°C', items: ['조기', '오징어(연안산)', '삼치'], capacity: 40000 },
  { id: 'zone_B2', name: 'B-2 구역 (특수 보관/급속동결실)', state: 'normal', stateLabel: '정상', temp: '-25°C', items: ['전갱이', '꽁치', '오징어(원양산)'], capacity: 60000 },
];

export async function GET() {
  try {
    // 1. 재고 데이터 조회
    const invSnap = await getDocs(collection(db, INVENTORY_COL));
    const invItems = invSnap.docs.map(d => d.data());

    // 2. 창고 구역 데이터 조회
    const zoneSnap = await getDocs(collection(db, ZONES_COL));
    let zoneDocs = zoneSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (zoneDocs.length === 0) {
      for (const z of defaultZones) {
        await setDoc(doc(db, ZONES_COL, z.id), { ...z, updated_at: serverTimestamp() });
      }
      zoneDocs = defaultZones;
    }

    // 3. 각 구역별 품목의 실제 수량을 합산하여 공실률(emptyRatio) 동적 계산
    const updatedZones = zoneDocs.map((z: any) => {
      const itemsList: string[] = Array.isArray(z.items) ? z.items : [];
      const capacity = z.capacity || 100000;

      // 해당 구역에 포함된 품목들의 실재고 수량 합산
      const currentStockSum = invItems
        .filter((inv: any) => itemsList.includes(inv.name))
        .reduce((sum: number, inv: any) => sum + (Number(inv.current) || 0), 0);

      // 점유율 및 공실률 산출 (0.0 ~ 1.0)
      const occupancy = Math.min(1.0, currentStockSum / capacity);
      const emptyRatio = Number((1.0 - occupancy).toFixed(2));

      // 상태 자동 판정
      let state = z.state || 'normal';
      let stateLabel = z.stateLabel || '정상';

      if (emptyRatio >= 0.85 || currentStockSum < 5000) {
        state = 'empty';
        stateLabel = '재고부족 (높은 공실률)';
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
    const { id, name, state, stateLabel, temp, items, capacity } = body;

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
      updated_at: serverTimestamp(),
    };

    await setDoc(doc(db, ZONES_COL, id), zoneDoc, { merge: true });
    return NextResponse.json({ id, ...zoneDoc });
  } catch (err) {
    return NextResponse.json({ error: '구역 정보 저장 실패' }, { status: 500 });
  }
}
