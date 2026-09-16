import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../lib/firebase';
import {
  collection,
  getDocs,
  addDoc,
  setDoc,
  doc,
  query,
  where,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';

export const dynamic = 'force-dynamic';

const USERS_COL = 'users';
const REQUESTS_COL = 'warehouse_access_requests';

// Master Super Admin account credentials
const MASTER_ADMIN = {
  username: 'wjmals',
  email: 'wjmals@wms-smartstock.ai',
  password: 'wjdals99!',
  name: 'wjmals (총괄 관리자)',
  role: '관리자',
  status: 'APPROVED',
  warehouseId: 'wh_wjmals',
};

// GET /api/users?action=...
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') || 'list';
  const email = searchParams.get('email') || '';
  const adminEmail = searchParams.get('adminEmail') || '';

  try {
    // 1. 특정 사용자의 실시간 정보 조회
    if (action === 'get_user' && email) {
      if (email === 'wjmals' || email === MASTER_ADMIN.email) {
        return NextResponse.json(MASTER_ADMIN);
      }
      const q = query(collection(db, USERS_COL), where('email', '==', email));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const uDoc = snap.docs[0];
        return NextResponse.json({ id: uDoc.id, ...uDoc.data() });
      }
      return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 });
    }

    // 2. 관리자가 승인 대기 중인 요청 목록 및 소속 창고지기 목록 조회
    if (action === 'list_requests' && adminEmail) {
      // 대기 중인 접근 요청들
      const reqQuery = query(collection(db, REQUESTS_COL), where('adminEmail', '==', adminEmail), where('status', '==', 'PENDING'));
      const reqSnap = await getDocs(reqQuery);
      const pendingRequests = reqSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      // 승인된 소속 팀원들
      const teamQuery = query(collection(db, USERS_COL), where('adminEmail', '==', adminEmail), where('status', '==', 'APPROVED'));
      const teamSnap = await getDocs(teamQuery);
      const teamMembers = teamSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      return NextResponse.json({ pendingRequests, teamMembers });
    }

    // 3. 마스터 관리자가 관리자 승인 신청 목록 조회
    if (action === 'list_admin_requests') {
      const q = query(collection(db, USERS_COL), where('role', '==', '관리자'), where('status', '==', 'PENDING_ADMIN'));
      const snap = await getDocs(q);
      const pendingAdmins = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      return NextResponse.json(pendingAdmins);
    }

    // 기본: 전체 유저 목록
    const snap = await getDocs(collection(db, USERS_COL));
    const allUsers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return NextResponse.json(allUsers);
  } catch (err) {
    console.error('Users GET error:', err);
    return NextResponse.json({ error: '데이터 조회 실패' }, { status: 500 });
  }
}

// POST /api/users
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, email, username, password, name, role, adminEmail, targetEmail, requestId } = body;

    // A. 로그인 처리 (Login)
    if (action === 'login') {
      const inputId = (username || email || '').trim();

      // 마스터 관리자 (wjmals / wjdals99!) 검증
      if ((inputId === 'wjmals' || inputId === MASTER_ADMIN.email) && password === MASTER_ADMIN.password) {
        return NextResponse.json({ success: true, user: MASTER_ADMIN });
      }

      // DB에서 유저 조회
      const q = query(collection(db, USERS_COL), where('email', '==', inputId));
      const snap = await getDocs(q);

      if (snap.empty) {
        return NextResponse.json({ error: '등록되지 않은 계정입니다. 회원가입 후 이용하세요.' }, { status: 404 });
      }

      const uDoc = snap.docs[0];
      const userData = uDoc.data();

      if (userData.password && userData.password !== password) {
        return NextResponse.json({ error: '비밀번호가 일치하지 않습니다.' }, { status: 401 });
      }

      return NextResponse.json({ success: true, user: { id: uDoc.id, ...userData } });
    }

    // B. 회원가입 처리 (Signup)
    if (action === 'signup') {
      if (!email || !password || !name) {
        return NextResponse.json({ error: '모든 항목(이메일, 비밀번호, 이름)을 입력해주세요.' }, { status: 400 });
      }

      // 중복 체크
      const checkQ = query(collection(db, USERS_COL), where('email', '==', email));
      const checkSnap = await getDocs(checkQ);
      if (!checkSnap.empty) {
        return NextResponse.json({ error: '이미 존재하는 이메일입니다.' }, { status: 400 });
      }

      const isRequestedAdmin = role === '관리자';
      const userDoc = {
        email,
        password,
        name,
        role: role || '창고지기',
        // 창고지기는 PENDING_WAREHOUSE, 관리자 신청은 PENDING_ADMIN
        status: isRequestedAdmin ? 'PENDING_ADMIN' : 'PENDING_WAREHOUSE',
        warehouseId: isRequestedAdmin ? `wh_${Date.now()}` : null,
        adminEmail: isRequestedAdmin ? email : null,
        createdAt: new Date().toISOString(),
      };

      const docRef = await addDoc(collection(db, USERS_COL), userDoc);
      return NextResponse.json({ success: true, user: { id: docRef.id, ...userDoc } });
    }

    // C. 창고지기가 관리자의 이메일을 지정하여 권한 요청 (Request Access)
    if (action === 'request_access') {
      if (!email || !adminEmail) {
        return NextResponse.json({ error: '이메일 정보가 누락되었습니다.' }, { status: 400 });
      }

      // 관리자 존재 여부 확인
      const normalizedAdminEmail = adminEmail === 'wjmals' ? MASTER_ADMIN.email : adminEmail;
      const adminQ = query(collection(db, USERS_COL), where('email', '==', normalizedAdminEmail));
      const adminSnap = await getDocs(adminQ);
      const isValidAdmin = normalizedAdminEmail === MASTER_ADMIN.email || !adminSnap.empty;

      if (!isValidAdmin) {
        return NextResponse.json({ error: `관리자 이메일 '${adminEmail}'을 찾을 수 없습니다.` }, { status: 404 });
      }

      // 유저 레코드 갱신
      const userQ = query(collection(db, USERS_COL), where('email', '==', email));
      const userSnap = await getDocs(userQ);
      if (!userSnap.empty) {
        await updateDoc(userSnap.docs[0].ref, {
          requestedAdminEmail: normalizedAdminEmail,
          updatedAt: new Date().toISOString(),
        });
      }

      // 접근 요청 생성
      const reqDoc = {
        userEmail: email,
        userName: name || email.split('@')[0],
        adminEmail: normalizedAdminEmail,
        status: 'PENDING',
        requestedAt: new Date().toISOString(),
      };
      await addDoc(collection(db, REQUESTS_COL), reqDoc);

      return NextResponse.json({ success: true, message: `'${normalizedAdminEmail}' 관리자에게 권한 요청을 보냈습니다.` });
    }

    // D. 관리자가 창고지기 승인 처리 (Approve Warehouse Keeper)
    if (action === 'approve_user') {
      if (!targetEmail || !adminEmail) {
        return NextResponse.json({ error: '대상 이메일과 관리자 이메일이 필요합니다.' }, { status: 400 });
      }

      // 관리자의 warehouseId 찾기
      let warehouseId = `wh_${adminEmail.split('@')[0]}`;
      if (adminEmail === MASTER_ADMIN.email || adminEmail === 'wjmals') {
        warehouseId = MASTER_ADMIN.warehouseId;
      } else {
        const adminQ = query(collection(db, USERS_COL), where('email', '==', adminEmail));
        const adminSnap = await getDocs(adminQ);
        if (!adminSnap.empty) {
          warehouseId = adminSnap.docs[0].data().warehouseId || warehouseId;
        }
      }

      // 1. 유저 상태 승인 처리
      const userQ = query(collection(db, USERS_COL), where('email', '==', targetEmail));
      const userSnap = await getDocs(userQ);
      if (!userSnap.empty) {
        await updateDoc(userSnap.docs[0].ref, {
          status: 'APPROVED',
          adminEmail,
          warehouseId,
          approvedAt: new Date().toISOString(),
        });
      }

      // 2. 요청 레코드 승인 처리
      if (requestId) {
        await updateDoc(doc(db, REQUESTS_COL, requestId), {
          status: 'APPROVED',
          approvedAt: new Date().toISOString(),
        });
      }

      return NextResponse.json({ success: true, targetEmail, warehouseId });
    }

    // E. 관리자가 창고지기 이메일을 직접 입력하여 초대 및 즉시 승인 (Invite & Auto-Approve)
    if (action === 'invite_user') {
      if (!targetEmail || !adminEmail) {
        return NextResponse.json({ error: '초대할 창고지기 이메일이 필요합니다.' }, { status: 400 });
      }

      let warehouseId = `wh_${adminEmail.split('@')[0]}`;
      if (adminEmail === MASTER_ADMIN.email || adminEmail === 'wjmals') {
        warehouseId = MASTER_ADMIN.warehouseId;
      }

      const userQ = query(collection(db, USERS_COL), where('email', '==', targetEmail));
      const userSnap = await getDocs(userQ);

      if (!userSnap.empty) {
        // 기존 회원이면 즉시 승인 및 소속 전환
        await updateDoc(userSnap.docs[0].ref, {
          status: 'APPROVED',
          adminEmail,
          warehouseId,
          approvedAt: new Date().toISOString(),
        });
      } else {
        // 미가입 회원이면 사전 승인 계정 생성
        await addDoc(collection(db, USERS_COL), {
          email: targetEmail,
          name: targetEmail.split('@')[0],
          role: '창고지기',
          status: 'APPROVED',
          adminEmail,
          warehouseId,
          password: '123456(초기비밀번호)',
          createdAt: new Date().toISOString(),
        });
      }

      return NextResponse.json({ success: true, message: `'${targetEmail}' 창고지기가 이 창고로 승인 등록되었습니다.` });
    }

    // F. 마스터 관리자가 신청 관리자 승인 (Approve Admin Request)
    if (action === 'approve_admin') {
      if (!targetEmail) {
        return NextResponse.json({ error: '대상 이메일이 필요합니다.' }, { status: 400 });
      }
      const userQ = query(collection(db, USERS_COL), where('email', '==', targetEmail));
      const userSnap = await getDocs(userQ);
      if (!userSnap.empty) {
        await updateDoc(userSnap.docs[0].ref, {
          status: 'APPROVED',
          warehouseId: `wh_${targetEmail.split('@')[0]}`,
          approvedAt: new Date().toISOString(),
        });
      }
      return NextResponse.json({ success: true, targetEmail });
    }

    return NextResponse.json({ error: '유효하지 않은 요청입니다.' }, { status: 400 });
  } catch (err: unknown) {
    console.error('Users POST error:', err);
    const message = err instanceof Error ? err.message : '처리 중 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
