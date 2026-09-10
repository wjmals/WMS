import { NextRequest, NextResponse } from 'next/server';
import Groq from 'groq-sdk';
import { db } from '../../../lib/firebase';
import {
  collection,
  getDocs,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const LOGS_COL = 'monitor_logs';
const INVENTORY_COL = 'inventory_items';

// GET: 최근 분석 이력 조회
export async function GET() {
  try {
    const q = query(collection(db, LOGS_COL), orderBy('analyzed_at', 'desc'), limit(50));
    const snap = await getDocs(q);
    const rows = snap.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));
    return NextResponse.json(rows);
  } catch (error) {
    console.error('Monitor GET 오류:', error);
    return NextResponse.json([], { status: 200 });
  }
}

// POST: 이미지 분석 + 이력 저장 + 재고 부족 시 inventory_items 업데이트
export async function POST(req: NextRequest) {
  try {
    const { image, itemName, cameraUrl } = await req.json();

    if (!image) {
      return NextResponse.json({ error: '이미지가 없습니다.' }, { status: 400 });
    }

    const base64Data = image.replace(/^data:image\/(png|jpg|jpeg|webp);base64,/, '');

    const prompt = `당신은 창고 재고 관리 전문가 AI입니다.
이 이미지는 창고 또는 선반의 실시간 CCTV/카메라 화면입니다.
${itemName ? '관리 품목: ' + itemName : ''}

다음 항목을 JSON 형식으로 분석해주세요:
{
  "itemName": "감지된 품목명 (한국어, 모르면 일반적인 설명)",
  "estimatedQuantity": 숫자 (추정 재고량, 없으면 0),
  "unit": "개 또는 kg 또는 박스 또는 톤",
  "status": "shortage 또는 safe 또는 overstock",
  "statusLabel": "재고 부족 또는 안전 재고 또는 재고 과다",
  "confidence": 0에서 100 사이 숫자,
  "recommendation": "구체적인 행동 추천 (한국어, 1~2문장)",
  "reason": "판단 근거 (한국어, 1문장)"
}

판단 기준:
- 선반/공간이 비어있거나 재고가 매우 적으면: shortage
- 선반이 절반 정도 채워져 있으면: safe  
- 선반이 가득 차거나 넘치면: overstock

JSON만 반환하세요.`;

    const response = await groq.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + base64Data } },
            { type: 'text', text: prompt },
          ],
        },
      ],
      max_tokens: 512,
      temperature: 0.1,
    });

    const content = response.choices[0]?.message?.content || '';
    let result: any;

    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      result = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch {
      result = null;
    }

    if (!result) {
      result = {
        itemName: itemName || '알 수 없는 품목',
        estimatedQuantity: 0,
        unit: '개',
        status: 'safe',
        statusLabel: '안전 재고',
        confidence: 30,
        recommendation: '이미지를 다시 촬영해주세요.',
        reason: 'AI 분석 결과를 파싱하지 못했습니다.',
      };
    }

    // 분석 이력 저장
    await addDoc(collection(db, LOGS_COL), {
      camera_url: cameraUrl || 'webcam',
      item_name: result.itemName,
      status: result.status,
      status_label: result.statusLabel,
      estimated_quantity: result.estimatedQuantity,
      unit: result.unit,
      confidence: result.confidence,
      recommendation: result.recommendation,
      reason: result.reason,
      image_snapshot: image.substring(0, 1000),
      analyzed_at: serverTimestamp(),
    });

    // 재고 부족 감지 시 inventory_items에도 자동 반영
    if (result.status === 'shortage') {
      const q = query(collection(db, INVENTORY_COL), where('name', '==', result.itemName));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const itemDoc = snap.docs[0];
        await updateDoc(itemDoc.ref, {
          current: result.estimatedQuantity,
          status: 'shortage',
          statusLabel: '재고 부족',
          date: new Date().toISOString().split('T')[0],
          updated_at: serverTimestamp(),
        });
      }
    }

    return NextResponse.json({ ...result, savedToDb: true });
  } catch (error: unknown) {
    console.error('Monitor POST 오류:', error);
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
