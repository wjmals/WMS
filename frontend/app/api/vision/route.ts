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

const COL = 'item_references';

// GET: 등록된 레퍼런스 이미지 목록 조회
export async function GET() {
  try {
    const snap = await getDocs(collection(db, COL));
    const items = snap.docs.map(d => ({
      id: d.id,
      ...d.data(),
    }));
    return NextResponse.json(items);
  } catch (error) {
    console.error('Vision GET 오류:', error);
    return NextResponse.json([]);
  }
}

// POST: 레퍼런스 이미지 등록 (품목 학습)
export async function POST(req: NextRequest) {
  try {
    const { image, name, description } = await req.json();

    if (!image || !name) {
      return NextResponse.json(
        { error: '이미지와 품목명은 필수입니다.' },
        { status: 400 }
      );
    }

    // 이미지를 리사이즈하여 저장 (base64 썸네일, 앞 50000자까지만 저장)
    const thumbnail = image.substring(0, 50000);

    const docRef = await addDoc(collection(db, COL), {
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
  const id = new URL(req.url).searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id가 없습니다.' }, { status: 400 });
  }
  try {
    await deleteDoc(doc(db, COL, id));
    return NextResponse.json({ success: true, deletedId: id });
  } catch (error) {
    console.error('Vision DELETE 오류:', error);
    return NextResponse.json({ error: '삭제 실패' }, { status: 500 });
  }
}
