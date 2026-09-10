import { NextRequest, NextResponse } from 'next/server';
import Groq from 'groq-sdk';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const { image, itemName } = await req.json();

    if (!image) {
      return NextResponse.json({ error: '이미지가 없습니다.' }, { status: 400 });
    }

    const base64Data = image.replace(/^data:image\/(png|jpg|jpeg|webp);base64,/, '');

    const prompt = `당신은 창고 재고 관리 전문가 AI입니다.
이 이미지는 창고 또는 선반의 사진입니다.
${itemName ? '품목명: ' + itemName : ''}

다음 항목을 JSON 형식으로 분석해주세요:
{
  "itemName": "감지된 품목명 (한국어)",
  "estimatedQuantity": 숫자 (추정 재고량),
  "unit": "단위 (개/kg/박스/톤)",
  "status": "shortage 또는 safe 또는 overstock",
  "statusLabel": "재고 부족 또는 안전 재고 또는 재고 과다",
  "confidence": 0에서 100 사이 숫자,
  "recommendation": "구체적인 행동 추천 (한국어, 1~2문장)",
  "reason": "판단 근거 (한국어, 1~2문장)"
}

판단 기준:
- 선반이 비어있거나 재고가 매우 적으면: shortage
- 선반이 절반 정도 채워져 있으면: safe
- 선반이 가득 차거나 넘치면: overstock

JSON만 반환하고 다른 텍스트는 포함하지 마세요.`;

    const response = await groq.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: 'data:image/jpeg;base64,' + base64Data,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
      max_tokens: 1024,
      temperature: 0.1,
    });

    const content = response.choices[0]?.message?.content || '';

    let result;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('JSON not found');
      }
    } catch {
      result = {
        itemName: itemName || '알 수 없는 품목',
        estimatedQuantity: 0,
        unit: '개',
        status: 'safe',
        statusLabel: '안전 재고',
        confidence: 50,
        recommendation: '이미지를 다시 촬영해주세요.',
        reason: 'AI가 이미지를 정확히 분석하지 못했습니다.',
      };
    }

    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error('Vision API 오류:', error);
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
