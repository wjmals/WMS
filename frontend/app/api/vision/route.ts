import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../lib/firebase';
import {
  collection,
  getDocs,
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp,
} from 'firebase/firestore';

export const dynamic = 'force-dynamic';

const COL = 'item_references';
const DEFAULT_WH_ID = 'wh_wjmals';

function getReferenceCollection(warehouseId: string) {
  return collection(db, 'warehouses', warehouseId, COL);
}

// GET: 등록된 레퍼런스 이미지 목록 조회
export async function GET(req: NextRequest) {
  const warehouseId = new URL(req.url).searchParams.get('warehouseId') || DEFAULT_WH_ID;
  try {
    const snap = await getDocs(getReferenceCollection(warehouseId));
    const items = snap.docs.map(d => ({
      id: d.id,
      ...d.data(),
    }));
    return NextResponse.json(items);
  } catch (error) {
    console.error('Vision GET 오류:', error);
    return NextResponse.json(
      { error: '학습 데이터를 불러오지 못했습니다.' },
      { status: 503 }
    );
  }
}

// POST: 레퍼런스 이미지 등록 (품목 학습)
export async function POST(req: NextRequest) {
  try {
    const { image, name, description, warehouseId: bodyWarehouseId } = await req.json();
    const warehouseId = bodyWarehouseId || DEFAULT_WH_ID;

    if (!image || !name) {
      return NextResponse.json(
        { error: '이미지와 품목명은 필수입니다.' },
        { status: 400 }
      );
    }

    // 이미지를 리사이즈하여 저장 (base64 썸네일, 앞 50000자까지만 저장)
    const thumbnail = image.substring(0, 50000);

    const docRef = await addDoc(getReferenceCollection(warehouseId), {
      name,
      description: description || '',
      thumbnail,
      createdAt: serverTimestamp(),
    });

    return NextResponse.json(
      { id: docRef.id, name, description, saved: true },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error('Vision POST 오류:', error);
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE: 레퍼런스 이미지 삭제
export async function DELETE(req: NextRequest) {
  const searchParams = new URL(req.url).searchParams;
  const id = searchParams.get('id');
  const warehouseId = searchParams.get('warehouseId') || DEFAULT_WH_ID;
  if (!id) {
    return NextResponse.json({ error: 'id가 없습니다.' }, { status: 400 });
  }
  try {
    await deleteDoc(doc(db, 'warehouses', warehouseId, COL, id));
    return NextResponse.json({ success: true, deletedId: id });
  } catch (error) {
    console.error('Vision DELETE 오류:', error);
    return NextResponse.json({ error: '삭제 실패' }, { status: 500 });
  }
}
