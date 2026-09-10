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
  updateDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';

// 지원 택배사 목록 및 코드
const CARRIERS: Record<string, { code: string; name: string }> = {
  '01': { code: '01', name: '우체국택배' },
  '04': { code: '04', name: 'CJ대한통운' },
  '05': { code: '05', name: '한진택배' },
  '06': { code: '06', name: '로젠택배' },
  '08': { code: '08', name: '롯데택배' },
  '11': { code: '11', name: '일양로지스' },
  '23': { code: '23', name: '경동택배' },
  '22': { code: '22', name: '대신택배' },
  '32': { code: '32', name: '합동택배' },
  '24': { code: '24', name: 'CVSnet 편의점택배 (GS25/CU)' },
};

// 오픈 트래커 API (apis.tracker.delivery) 매핑
const TRACKER_DELIVERY_IDS: Record<string, string> = {
  '01': 'kr.epost',
  '04': 'kr.cjlogistics',
  '05': 'kr.hanjin',
  '06': 'kr.logen',
  '08': 'kr.lotte',
  '11': 'kr.ilyanglogis',
  '23': 'kr.kdexp',
  '22': 'kr.daesin',
  '32': 'kr.hdexp',
  '24': 'kr.cvsnet',
};

// 운송장 번호로 택배사 자동 판별
async function detectCarrierAuto(invoiceNo: string): Promise<{ code: string; name: string }> {
  const clean = invoiceNo.replace(/[^0-9]/g, '');
  const tKey = process.env.SWEET_TRACKER_API_KEY;

  if (tKey && clean.length >= 9) {
    try {
      const res = await fetch(`http://info.sweettracker.co.kr/api/v1/recommend/companylist?t_key=${tKey}&t_invoice=${clean}`);
      if (res.ok) {
        const data = await res.json();
        if (data.Company && data.Company.length > 0) {
          const top = data.Company[0];
          return { code: top.Code, name: top.Name };
        }
      }
    } catch (e) {
      console.warn('스마트택배 추천 API 호출 실패, 내부 규칙 사용:', e);
    }
  }

  // 국내 주요 택배사 자릿수 및 번호 프리픽스 규칙
  if (clean.length === 13) {
    if (clean.startsWith('6') || clean.startsWith('7')) return CARRIERS['01']; // 우체국
    return CARRIERS['22']; // 대신택배
  }
  if (clean.length === 11) {
    if (clean.startsWith('9')) return CARRIERS['06']; // 로젠택배
    if (clean.startsWith('1') || clean.startsWith('2')) return CARRIERS['23']; // 경동택배
    return CARRIERS['06'];
  }
  if (clean.length === 10) {
    if (clean.startsWith('1') || clean.startsWith('4')) return CARRIERS['11']; // 일양로지스
    return CARRIERS['05']; // 한진택배
  }
  if (clean.length === 12) {
    if (clean.startsWith('6') || clean.startsWith('5') || clean.startsWith('3')) {
      return CARRIERS['04']; // CJ대한통운
    }
    if (clean.startsWith('2') || clean.startsWith('4') || clean.startsWith('0')) {
      return CARRIERS['08']; // 롯데택배
    }
    return CARRIERS['04'];
  }

  return CARRIERS['04']; // 기본값 CJ대한통운
}

// 실제 배송 추적 데이터 조회 (스마트택배 및 오픈 트래커 API 연동)
async function fetchTracking(invoiceNo: string, carrierCode: string) {
  const tKey = process.env.SWEET_TRACKER_API_KEY;

  // 1. 스마트택배 API 키가 있는 경우 우선 조회
  if (tKey) {
    try {
      const res = await fetch(
        `http://info.sweettracker.co.kr/api/v1/trackingInfo?t_key=${tKey}&t_code=${carrierCode}&t_invoice=${invoiceNo}`
      );
      if (res.ok) {
        const data = await res.json();
        if (data.result !== 'N' && data.level) {
          const isDelivered = data.level === 6;
          const isOut = data.level === 5;
          const status = isDelivered ? '배송완료' : isOut ? '배달출발' : data.level >= 2 ? '상품이동중' : '상품인수';
          const statusCode = isDelivered ? 'DELIVERED' : isOut ? 'OUT_FOR_DELIVERY' : data.level >= 2 ? 'IN_TRANSIT' : 'AT_PICKUP';

          const details = (data.trackingDetails || []).map((d: any) => ({
            time: d.timeString || '',
            where: d.where || '',
            kind: d.kind || '',
            tel: d.telno || '',
          }));

          return {
            status,
            statusCode,
            currentLocation: data.where || (details.length > 0 ? details[details.length - 1].where : '택배사 접수'),
            deliveredAt: isDelivered ? new Date() : null,
            details,
            isRealData: true,
          };
        }
      }
    } catch (e) {
      console.warn('SweetTracker API 실패, 오픈 API로 대체:', e);
    }
  }

  // 2. 무료 오픈 배송 조회 API (apis.tracker.delivery) 실시간 조회
  const trackerCarrierId = TRACKER_DELIVERY_IDS[carrierCode] || 'kr.cjlogistics';
  try {
    const res = await fetch(`https://apis.tracker.delivery/carriers/${trackerCarrierId}/tracks/${invoiceNo}`, {
      headers: { 'Accept': 'application/json' },
      next: { revalidate: 30 },
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.state && data.progresses) {
        const stateId = data.state.id;
        let statusCode = 'IN_TRANSIT';
        let status = data.state.text || '상품이동중';
        let isDelivered = false;

        if (stateId === 'delivered') {
          statusCode = 'DELIVERED';
          status = '배송완료';
          isDelivered = true;
        } else if (stateId === 'out_for_delivery') {
          statusCode = 'OUT_FOR_DELIVERY';
          status = '배달출발';
        } else if (stateId === 'at_pickup' || stateId === 'information_received') {
          statusCode = 'AT_PICKUP';
          status = data.state.text || '상품인수';
        } else {
          statusCode = 'IN_TRANSIT';
          status = '허브이동중';
        }

        const details = (data.progresses || []).map((p: any) => ({
          time: p.time ? new Date(p.time).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '',
          where: p.location?.name || '',
          kind: p.description || p.status?.text || '',
        }));

        const lastProgress = details.length > 0 ? details[details.length - 1] : null;
        const currentLocation = lastProgress?.where
          ? `${lastProgress.where} (${lastProgress.kind})`
          : (status || '배송 진행중');

        return {
          status,
          statusCode,
          currentLocation,
          deliveredAt: isDelivered ? new Date() : null,
          details,
          isRealData: true,
        };
      }
    }
  } catch (e) {
    console.warn('오픈 배송 조회 API 호출 실패:', e);
  }

  // 3. 실제 택배 전산에 아직 미등록되었거나 조회되지 않는 경우
  // ※ 가짜 임의 위치나 가짜 타임라인을 만들지 않고 실제 대기 상태로 정직하게 기록합니다.
  return {
    status: '상품준비중',
    statusCode: 'AT_PICKUP',
    currentLocation: '물류센터 출고대기 (택배사 전산 반영 대기)',
    deliveredAt: null,
    details: [
      {
        time: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
        where: 'WMS 스마트 물류센터',
        kind: '운송장 등록 완료 (택배사 전산 집하 대기중)',
      }
    ],
    isRealData: false,
  };
}

const COL = 'delivery_tracking';

const stageOrder: Record<string, number> = {
  AT_PICKUP: 1,
  IN_TRANSIT: 2,
  OUT_FOR_DELIVERY: 3,
  DELIVERED: 4,
};

function toISO(val: any): string | null {
  if (!val) return null;
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (val instanceof Date) return val.toISOString();
  return String(val);
}

// GET: 배송 목록 조회 or 택배사 자동 감지
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const detectInvoice = searchParams.get('detect');

    if (detectInvoice) {
      const detected = await detectCarrierAuto(detectInvoice);
      return NextResponse.json(detected);
    }

    const snap = await getDocs(collection(db, COL));
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;

    const toDelete: string[] = [];
    const toUpdate: { id: string; data: any }[] = [];
    let items: any[] = [];

    for (const d of snap.docs) {
      const data = d.data();
      const deliveredAt = data.delivered_at ? toISO(data.delivered_at) : null;

      // 배송완료 후 24시간 지난 건 자동 정리
      if (deliveredAt && now - new Date(deliveredAt).getTime() > oneDayMs) {
        toDelete.push(d.id);
        continue;
      }

      // 배송완료가 아닌 건: 5분마다 실제 택배사 전산 API를 새로 조회하여 상태 업데이트
      const updatedAt = data.updated_at ? toISO(data.updated_at) : null;
      const diffSec = updatedAt ? (now - new Date(updatedAt).getTime()) / 1000 : 999;

      if (data.status_code !== 'DELIVERED' && diffSec >= 300) {
        try {
          const realTrack = await fetchTracking(data.invoice_no, data.carrier_code);
          if (realTrack.isRealData) {
            toUpdate.push({
              id: d.id,
              data: {
                status: realTrack.status,
                status_code: realTrack.statusCode,
                current_location: realTrack.currentLocation,
                delivered_at: realTrack.deliveredAt ? realTrack.deliveredAt.toISOString() : null,
                tracking_details: realTrack.details,
                updated_at: serverTimestamp(),
              }
            });
          }
        } catch (err) {
          console.warn('배송 실시간 동기화 오류:', err);
        }
      }

      items.push({
        id: d.id,
        invoice_no: data.invoice_no,
        carrier_code: data.carrier_code,
        carrier_name: data.carrier_name,
        item_name: data.item_name,
        sender_name: data.sender_name,
        receiver_name: data.receiver_name,
        status: data.status,
        status_code: data.status_code,
        current_location: data.current_location,
        delivered_at: deliveredAt,
        tracking_details: data.tracking_details || [],
        created_at: toISO(data.created_at),
        updated_at: toISO(data.updated_at),
        minutes_until_expiration: deliveredAt
          ? Math.round((new Date(deliveredAt).getTime() + oneDayMs - now) / 60000)
          : null,
      });
    }

    // 비동기로 정리 및 업데이트 반영
    await Promise.all([
      ...toDelete.map(id => deleteDoc(doc(db, COL, id))),
      ...toUpdate.map(({ id, data }) => updateDoc(doc(db, COL, id), data)),
    ]);

    for (const u of toUpdate) {
      const item = items.find(i => i.id === u.id);
      if (item) Object.assign(item, u.data);
    }

    // 단계순 정렬
    items.sort((a, b) =>
      (stageOrder[a.status_code] || 5) - (stageOrder[b.status_code] || 5)
    );

    return NextResponse.json(items);
  } catch (error: any) {
    console.error('배송 목록 조회 실패:', error);
    return NextResponse.json([], { status: 200 });
  }
}

// POST: 신규 운송장 등록 (실제 배송 API 실시간 조회)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { invoice_no, item_name, sender_name, receiver_name } = body;
    let { carrier_code, carrier_name } = body;

    if (!invoice_no) {
      return NextResponse.json({ error: '운송장 번호를 입력해주세요.' }, { status: 400 });
    }

    const cleanInvoice = invoice_no.replace(/[^0-9]/g, '');
    if (!carrier_code || !carrier_name) {
      const detected = await detectCarrierAuto(cleanInvoice);
      carrier_code = detected.code;
      carrier_name = detected.name;
    }

    // 실제 택배사 전산 API 실시간 조회
    const tracking = await fetchTracking(cleanInvoice, carrier_code);

    const docRef = await addDoc(collection(db, COL), {
      invoice_no: cleanInvoice,
      carrier_code,
      carrier_name,
      item_name: item_name || '물류 출고건',
      sender_name: sender_name || 'WMS 스마트 물류센터',
      receiver_name: receiver_name || '고객님',
      status: tracking.status,
      status_code: tracking.statusCode,
      current_location: tracking.currentLocation,
      delivered_at: tracking.deliveredAt ? tracking.deliveredAt.toISOString() : null,
      tracking_details: tracking.details || [],
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });

    return NextResponse.json({
      success: true,
      id: docRef.id,
      invoice_no: cleanInvoice,
      carrier_name,
      status: tracking.status,
      current_location: tracking.currentLocation,
      tracking_details: tracking.details,
    });
  } catch (error: any) {
    console.error('운송장 등록 실패:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE: 배송 건 삭제
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const invoiceNo = searchParams.get('invoice_no');

    if (id) {
      await deleteDoc(doc(db, COL, id));
    } else if (invoiceNo) {
      const snap = await getDocs(query(collection(db, COL), where('invoice_no', '==', invoiceNo)));
      await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
    } else {
      return NextResponse.json({ error: 'id 또는 invoice_no 가 필요합니다.' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('삭제 실패:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PUT: 배송 단계 수동 전진 (관리자용)
export async function PUT(req: NextRequest) {
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 });

    const docSnap = await getDocs(query(collection(db, COL), where('__name__', '==', id)));
    if (docSnap.empty) return NextResponse.json({ error: '항목 없음' }, { status: 404 });

    const current = docSnap.docs[0].data();
    let nextStatus = '배송완료', nextCode = 'DELIVERED', nextLocation = '고객 지정장소 (문 앞 배송완료)';
    let deliveredAt: string | null = new Date().toISOString();

    if (current.status_code === 'AT_PICKUP') {
      nextStatus = '허브터미널 이동중'; nextCode = 'IN_TRANSIT'; nextLocation = '허브터미널 (간선하차 및 분류)'; deliveredAt = null;
    } else if (current.status_code === 'IN_TRANSIT') {
      nextStatus = '배달출발'; nextCode = 'OUT_FOR_DELIVERY'; nextLocation = '배송캠프 (배송기사 배달출발)'; deliveredAt = null;
    }

    await updateDoc(doc(db, COL, id), {
      status: nextStatus,
      status_code: nextCode,
      current_location: nextLocation,
      delivered_at: deliveredAt,
      updated_at: serverTimestamp(),
    });

    return NextResponse.json({ success: true, status: nextStatus, statusCode: nextCode });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
