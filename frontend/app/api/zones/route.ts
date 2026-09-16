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

const COL = 'warehouse_zones';

// 품목 수에 따른 공실률 자동 계산 함수
function calculateEmptyRatio(items: string[], inputEmptyRatio?: number): number {
  if (!items || items.length === 0) return 1.0; // 0개 품목 = 100% 공실률 (완전 빈 구역)
  if (items.length === 1) return 0.65; // 1개 품목 = 65% 공실률
  if (items.length === 2) return 0.35; // 2개 품목 = 35% 공실률
  return Math.max(0.05, Number((1 - (items.length * 0.28)).toFixed(2)));
}

const defaultZones = [
  { id: 'zone_A1', name: 'A-1 구역 (메인 보관 1창고)', state: 'normal', stateLabel: '정상', emptyRatio: 0.35, temp: '-22°C', items: ['고등어(식용)', '명태'] },
  { id: 'zone_A2', name: 'A-2 구역 (고밀도 랙 보관소)', state: 'warning', stateLabel: '점검필요', emptyRatio: 0.35, temp: '-20°C', items: ['갈치(국내산)', '갈치(수입산)'] },
  { id: 'zone_B1', name: 'B-1 구역 (항온/항습 보관실)', state: 'normal', stateLabel: '정상', emptyRatio: 0.16, temp: '3°C', items: ['조기', '오징어(연안산)', '삼치'] },
  { id: 'zone_B2', name: 'B-2 구역 (특수 보관/급속동결실)', state: 'empty', stateLabel: '재고부족', emptyRatio: 0.16, temp: '-25°C', items: ['전갱이', '꽁치', '오징어(원양산)'] },
];

export async function GET() {
  try {
    const snap = await getDocs(collection(db, COL));
    if (snap.empty) {
      for (const z of defaultZones) {
        await setDoc(doc(db, COL, z.id), { ...z, updated_at: serverTimestamp() });
      }
      return NextResponse.json(defaultZones);
    }
    const rows = snap.docs.map(d => {
      const data = d.data();
      const itemsList = Array.isArray(data.items) ? data.items : [];
      const computedEmptyRatio = calculateEmptyRatio(itemsList, data.emptyRatio);
      return { id: d.id, ...data, emptyRatio: computedEmptyRatio };
    });
    return NextResponse.json(rows);
  } catch (err) {
    return NextResponse.json(defaultZones);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, name, state, stateLabel, emptyRatio, temp, items } = body;

    if (!id || !name) {
      return NextResponse.json({ error: 'id와 name은 필수입니다.' }, { status: 400 });
    }

    const itemsList = Array.isArray(items) ? items : [];
    const computedEmptyRatio = calculateEmptyRatio(itemsList, emptyRatio);

    const zoneDoc = {
      name,
      state: state || (itemsList.length === 0 ? 'empty' : 'normal'),
      stateLabel: stateLabel || (itemsList.length === 0 ? '빈 구역' : '정상'),
      emptyRatio: computedEmptyRatio,
      temp: temp || '-20°C',
      items: itemsList,
      updated_at: serverTimestamp(),
    };

    await setDoc(doc(db, COL, id), zoneDoc, { merge: true });
    return NextResponse.json({ id, ...zoneDoc });
  } catch (err) {
    return NextResponse.json({ error: '구역 정보 저장 실패' }, { status: 500 });
  }
}
