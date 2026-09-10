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

    // 1. 등록된 재고 품목 목록 (텍스트 정보)
    let registeredItems: string[] = [];
    try {
      const invSnap = await getDocs(collection(db, INVENTORY_COL));
      registeredItems = invSnap.docs.map(d => {
        const data = d.data();
        return `- ${data.name} (현재 ${data.current}톤, 안전기준 ${data.safe}톤, 상태: ${data.statusLabel})`;
      });
    } catch {}

    // 2. 학습된 레퍼런스 이미지 데이터 (시각적 학습 데이터)
    let referenceList: any[] = [];
    try {
      const refSnap = await getDocs(collection(db, 'item_references'));
      referenceList = refSnap.docs.map(d => d.data());
    } catch {}

    const itemList = registeredItems.length > 0
      ? `\n현재 창고 관리 품목 정보:\n${registeredItems.join('\n')}`
      : '';

    const refTextList = referenceList.length > 0
      ? `\nAI가 사전에 학습받은 등록 품목 시각적 샘플:\n${referenceList.map((r, i) => `[샘플 ${i+1}] 품목명: "${r.name}" (${r.description || '설명 없음'})`).join('\n')}`
      : '';

    const prompt = `당신은 창고 재고 관리 전문가 AI입니다.
첨부된 실시간 카메라 화면을 분석해주세요.
${itemName ? '관리자가 지정한 우선 감지 품목: ' + itemName : ''}
${itemList}
${refTextList}

[품목 식별 지침]
- 사전에 등록/학습된 이미지 샘플과 실시간 화면을 대조하여, 카메라에 보이는 품목이 어떤 품목인지 정확히 식별해주세요.
- 학습된 품목 중 일치하는 것이 있다면 그 품목명(itemName)을 정확히 반환하고, 처음 보는 품목이면 명확한 품목 이름을 지정하세요.

다음 항목을 JSON 형식으로만 분석해 반환해주세요:
{
  "itemName": "감지된 품목명 (한국어, 학습 데이터 목록 항목과 정확히 일치시키는 것을 우선)",
  "estimatedQuantity": 숫자 (추정 재고량, 톤/개/박스 기준),
  "unit": "톤 또는 개 또는 박스 또는 kg",
  "status": "shortage 또는 safe 또는 overstock",
  "statusLabel": "재고 부족 또는 안전 재고 또는 재고 과다",
  "confidence": 0에서 100 사이 숫자 (학습된 샘플과 일치할수록 높은 신뢰도),
  "recommendation": "구체적인 행동 추천 (한국어, 1~2문장)",
  "reason": "판단 근거 (학습된 비주얼 샘플과의 유사성 포함, 1문장)"
}

판단 기준:
- 선반/공간이 비어있거나 재고가 매우 적으면: shortage
- 선반이 절반 정도 채워져 있으면: safe  
- 선반이 가득 차거나 넘치면: overstock

JSON만 반환하세요.`;

    // 이미지 및 텍스트 프롬프트 구성 (레퍼런스 이미지도 함께 전달)
    const contentPayload: any[] = [
      { type: 'text', text: prompt },
    ];

    // 학습된 레퍼런스 이미지들 첨부 (최대 3개)
    referenceList.slice(0, 3).forEach((ref, idx) => {
      if (ref.thumbnail) {
        contentPayload.push({
          type: 'text',
          text: `[학습 레퍼런스 이미지 ${idx + 1}: 품목명 "${ref.name}"]`
        });
        contentPayload.push({
          type: 'image_url',
          image_url: { url: ref.thumbnail.startsWith('data:') ? ref.thumbnail : 'data:image/jpeg;base64,' + ref.thumbnail }
        });
      }
    });

    // 실시간 카메라 이미지 첨부
    contentPayload.push({
      type: 'text',
      text: '[실시간 분석 대상 카메라 화면]'
    });
    contentPayload.push({
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,' + base64Data }
    });

    const response = await groq.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [
        {
          role: 'user',
          content: contentPayload,
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

    // 분석 결과를 inventory_items에 자동 반영 (모든 상태)
    const q = query(collection(db, INVENTORY_COL), where('name', '==', result.itemName));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const itemDoc = snap.docs[0];
      await updateDoc(itemDoc.ref, {
        current: result.estimatedQuantity,
        status: result.status,
        statusLabel: result.statusLabel,
        date: new Date().toISOString().split('T')[0],
        updated_at: serverTimestamp(),
      });
    } else {
      // 해당 품목이 inventory_items에 없으면 새로 생성
      const safe = result.status === 'shortage' ? result.estimatedQuantity * 3
        : result.status === 'overstock' ? Math.floor(result.estimatedQuantity * 0.5)
        : result.estimatedQuantity;
      const diff = result.estimatedQuantity - safe;
      const diffText = result.status === 'shortage' ? `부족분: ${diff}톤`
        : result.status === 'overstock' ? `초과분: +${diff}톤`
        : '적정 범위 유지';
      await addDoc(collection(db, INVENTORY_COL), {
        name: result.itemName,
        current: result.estimatedQuantity,
        safe,
        status: result.status,
        statusLabel: result.statusLabel,
        diffText,
        recommendation: result.recommendation,
        cycle: '월간',
        date: new Date().toISOString().split('T')[0],
        createdAt: serverTimestamp(),
      });
    }

    return NextResponse.json({ ...result, savedToDb: true });
  } catch (error: unknown) {
    console.error('Monitor POST 오류:', error);
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
