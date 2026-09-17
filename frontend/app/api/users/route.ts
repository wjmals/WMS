import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../lib/firebase';
import {
  collection,
  getDocs,
  addDoc,
  doc,
  query,
  where,
  updateDoc,
  deleteDoc,
  setDoc,
} from 'firebase/firestore';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const USERS_COL = 'users';
const REQUESTS_COL = 'warehouse_access_requests';
const LOCAL_JSON_PATH = path.join(process.cwd(), 'data', 'users.json');

// Master Super System Admin account credentials
const MASTER_ADMIN = {
  id: 'usr_wjmals',
  username: 'wjmals',
  email: 'wjmals@wms-smartstock.ai',
  password: 'wjdals99!',
  name: 'wjmals (총괄/서버 관리자)',
  role: '서버 관리자',
  status: 'APPROVED',
  warehouseId: 'wh_wjmals',
};

// Helper: Ensure local JSON file exists
function readLocalUsers(): any[] {
  try {
    if (!fs.existsSync(path.dirname(LOCAL_JSON_PATH))) {
      fs.mkdirSync(path.dirname(LOCAL_JSON_PATH), { recursive: true });
    }
    if (!fs.existsSync(LOCAL_JSON_PATH)) {
      const initial = [MASTER_ADMIN];
      fs.writeFileSync(LOCAL_JSON_PATH, JSON.stringify(initial, null, 2), 'utf-8');
      return initial;
    }
    const content = fs.readFileSync(LOCAL_JSON_PATH, 'utf-8');
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [MASTER_ADMIN];
  } catch (e) {
    return [MASTER_ADMIN];
  }
}

function writeLocalUsers(users: any[]) {
  try {
    if (!fs.existsSync(path.dirname(LOCAL_JSON_PATH))) {
      fs.mkdirSync(path.dirname(LOCAL_JSON_PATH), { recursive: true });
    }
    fs.writeFileSync(LOCAL_JSON_PATH, JSON.stringify(users, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to write local users.json:', e);
  }
}

// Timeout wrapper to prevent Firestore network hangs (max 1.2s timeout)
async function withTimeout<T>(promise: Promise<T>, timeoutMs = 1200): Promise<T | null> {
  let timeoutId: NodeJS.Timeout;
  const timeoutPromise = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (e) {
    clearTimeout(timeoutId!);
    return null;
  }
}

// Fetch all users safely (combines local JSON + Firestore)
async function getAllUsersList(): Promise<any[]> {
  const localList = readLocalUsers();
  
  // Try fetching from Firestore with fast 1.2s timeout
  const firestoreSnap = await withTimeout(getDocs(collection(db, USERS_COL)));
  if (firestoreSnap && !firestoreSnap.empty) {
    const fsItems = firestoreSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Merge firestore and local JSON, preferring firestore
    const map = new Map<string, any>();
    localList.forEach(u => map.set(u.email, u));
    fsItems.forEach((u: any) => map.set(u.email, u));
    if (!map.has(MASTER_ADMIN.email)) map.set(MASTER_ADMIN.email, MASTER_ADMIN);
    const merged = Array.from(map.values());
    writeLocalUsers(merged);
    return merged;
  }
  
  if (!localList.some(u => u.email === MASTER_ADMIN.email)) {
    localList.unshift(MASTER_ADMIN);
  }
  return localList;
}

async function updateFirestoreUser(email: string, updates: Record<string, any>) {
  const snap = await withTimeout(getDocs(query(collection(db, USERS_COL), where('email', '==', email))));
  if (snap && !snap.empty) {
    await updateDoc(doc(db, USERS_COL, snap.docs[0].id), updates);
  }
}

async function deleteFirestoreUser(email: string) {
  const snap = await withTimeout(getDocs(query(collection(db, USERS_COL), where('email', '==', email))));
  if (snap && !snap.empty) {
    await Promise.all(snap.docs.map(userDoc => deleteDoc(userDoc.ref)));
  }
}

// GET /api/users?action=...
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') || 'list';
  const email = searchParams.get('email') || '';
  const adminEmail = searchParams.get('adminEmail') || '';

  try {
    const allUsers = await getAllUsersList();

    // 1. 특정 사용자의 정보 조회
    if (action === 'get_user' && email) {
      if (email === 'wjmals' || email === MASTER_ADMIN.email) {
        return NextResponse.json(MASTER_ADMIN);
      }
      const found = allUsers.find(u => u.email === email);
      if (found) return NextResponse.json(found);
      return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 });
    }

    // 2. 관리자가 승인 대기 중인 요청 및 소속 창고지기 목록 조회
    if (action === 'list_requests' && adminEmail) {
      const teamMembers = allUsers.filter(u => u.adminEmail === adminEmail && u.status === 'APPROVED');
      
      // Access requests
      let pendingRequests: any[] = [];
      const reqSnap = await withTimeout(getDocs(query(collection(db, REQUESTS_COL), where('adminEmail', '==', adminEmail), where('status', '==', 'PENDING'))));
      if (reqSnap) {
        pendingRequests = reqSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      }
      return NextResponse.json({ pendingRequests, teamMembers });
    }

    // 3. 서버 관리자가 승인 대기 중인 창고 관리자 신청 목록 조회
    if (action === 'list_admin_requests') {
      const pendingAdmins = allUsers.filter(
        u => u.email !== MASTER_ADMIN.email && (u.status === 'PENDING_ADMIN' || (u.role === '관리자' && u.status !== 'APPROVED'))
      );
      return NextResponse.json(pendingAdmins);
    }

    // 기본: 전체 유저 목록
    return NextResponse.json(allUsers);
  } catch (err) {
    console.error('Users GET error:', err);
    return NextResponse.json(readLocalUsers());
  }
}

// POST /api/users
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, email, username, password, name, role, adminEmail, targetEmail, requestId } = body;

    const allUsers = await getAllUsersList();

    // A. 로그인 처리 (Login)
    if (action === 'login') {
      const inputId = (username || email || '').trim();

      if ((inputId === 'wjmals' || inputId === MASTER_ADMIN.email) && password === MASTER_ADMIN.password) {
        return NextResponse.json({ success: true, user: MASTER_ADMIN });
      }

      const user = allUsers.find(u => u.email === inputId || u.username === inputId);
      if (!user) {
        return NextResponse.json({ error: '등록되지 않은 계정입니다. 회원가입 후 이용하세요.' }, { status: 404 });
      }

      if (user.password && user.password !== password) {
        return NextResponse.json({ error: '비밀번호가 일치하지 않습니다.' }, { status: 401 });
      }

      return NextResponse.json({ success: true, user });
    }

    // B. 회원가입 처리 (Signup)
    if (action === 'signup') {
      if (!email || !password || !name) {
        return NextResponse.json({ error: '모든 항목(이메일, 비밀번호, 이름)을 입력해주세요.' }, { status: 400 });
      }

      const isRequestedAdmin = role === '관리자';
      if (!isRequestedAdmin && !adminEmail) {
        return NextResponse.json({ error: '창고지기 신청에는 승인할 창고 관리자 이메일이 필요합니다.' }, { status: 400 });
      }

      const exists = allUsers.some(u => u.email === email);
      if (exists) {
        return NextResponse.json({ error: '이미 존재하는 이메일입니다.' }, { status: 400 });
      }

      const userDoc = {
        id: `usr_${Date.now()}`,
        email,
        password,
        name,
        role: role || '창고지기',
        status: isRequestedAdmin ? 'PENDING_ADMIN' : 'PENDING_WAREHOUSE',
        warehouseId: isRequestedAdmin ? `wh_${Date.now()}` : null,
        adminEmail: isRequestedAdmin ? email : adminEmail,
        createdAt: new Date().toISOString(),
      };

      // Save locally immediately
      allUsers.push(userDoc);
      writeLocalUsers(allUsers);

      // Async write to Firestore background
      withTimeout(addDoc(collection(db, USERS_COL), userDoc));

      return NextResponse.json({ success: true, user: userDoc });
    }

    // C. 창고지기 권한 요청 (Request Access)
    if (action === 'request_access') {
      if (!email || !adminEmail) {
        return NextResponse.json({ error: '이메일 정보가 누락되었습니다.' }, { status: 400 });
      }

      const normalizedAdminEmail = adminEmail === 'wjmals' ? MASTER_ADMIN.email : adminEmail;
      
      // Local update
      const uIdx = allUsers.findIndex(u => u.email === email);
      if (uIdx !== -1) {
        allUsers[uIdx].requestedAdminEmail = normalizedAdminEmail;
        writeLocalUsers(allUsers);
      }

      // 사용자 관계 정보와 승인 요청을 모두 Firestore에 기록
      await updateFirestoreUser(email, { requestedAdminEmail: normalizedAdminEmail });
      await withTimeout(addDoc(collection(db, REQUESTS_COL), {
        userEmail: email,
        userName: name || email.split('@')[0],
        adminEmail: normalizedAdminEmail,
        status: 'PENDING',
        requestedAt: new Date().toISOString(),
      }));

      return NextResponse.json({ success: true, message: `'${normalizedAdminEmail}' 관리자에게 권한 요청을 보냈습니다.` });
    }

    // D. 창고지기 승인 처리 (Approve Warehouse Keeper)
    if (action === 'approve_user') {
      if (!targetEmail || !adminEmail) {
        return NextResponse.json({ error: '대상 이메일과 관리자 이메일이 필요합니다.' }, { status: 400 });
      }

      let warehouseId = `wh_${adminEmail.split('@')[0]}`;
      const adminUser = allUsers.find(u => u.email === adminEmail);
      if (adminUser?.warehouseId) warehouseId = adminUser.warehouseId;

      const uIdx = allUsers.findIndex(u => u.email === targetEmail);
      if (uIdx !== -1) {
        allUsers[uIdx].status = 'APPROVED';
        allUsers[uIdx].adminEmail = adminEmail;
        allUsers[uIdx].warehouseId = warehouseId;
        allUsers[uIdx].approvedAt = new Date().toISOString();
        writeLocalUsers(allUsers);
      }

      await updateFirestoreUser(targetEmail, {
        status: 'APPROVED',
        adminEmail,
        warehouseId,
        approvedAt: new Date().toISOString(),
        requestedAdminEmail: null,
      });

      if (requestId) {
        await deleteDoc(doc(db, REQUESTS_COL, requestId));
      } else {
        const requestSnap = await withTimeout(getDocs(query(
          collection(db, REQUESTS_COL),
          where('userEmail', '==', targetEmail),
          where('status', '==', 'PENDING')
        )));
        if (requestSnap) {
          await Promise.all(requestSnap.docs.map(request => deleteDoc(request.ref)));
        }
      }

      return NextResponse.json({ success: true, targetEmail, warehouseId });
    }

    // E. 창고지기 초대 및 즉시 승인 (Invite & Auto-Approve)
    if (action === 'invite_user') {
      if (!targetEmail || !adminEmail) {
        return NextResponse.json({ error: '초대할 창고지기 이메일이 필요합니다.' }, { status: 400 });
      }

      let warehouseId = `wh_${adminEmail.split('@')[0]}`;
      const adminUser = allUsers.find(u => u.email === adminEmail);
      if (adminUser?.warehouseId) warehouseId = adminUser.warehouseId;

      const uIdx = allUsers.findIndex(u => u.email === targetEmail);
      if (uIdx !== -1) {
        allUsers[uIdx].status = 'APPROVED';
        allUsers[uIdx].adminEmail = adminEmail;
        allUsers[uIdx].warehouseId = warehouseId;
      } else {
        allUsers.push({
          id: `usr_${Date.now()}`,
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
      writeLocalUsers(allUsers);

      // Async Firestore push
      withTimeout(addDoc(collection(db, USERS_COL), {
        email: targetEmail,
        name: targetEmail.split('@')[0],
        role: '창고지기',
        status: 'APPROVED',
        adminEmail,
        warehouseId,
        createdAt: new Date().toISOString(),
      }));

      return NextResponse.json({ success: true, message: `'${targetEmail}' 창고지기가 이 창고로 승인 등록되었습니다.` });
    }

    // F. 마스터 서버 관리자가 창고 관리자 신청 승인 (Approve Admin Request)
    if (action === 'approve_admin') {
      if (!targetEmail) {
        return NextResponse.json({ error: '대상 이메일이 필요합니다.' }, { status: 400 });
      }

      const uIdx = allUsers.findIndex(u => u.email === targetEmail);
      if (uIdx !== -1) {
        allUsers[uIdx].role = '관리자';
        allUsers[uIdx].status = 'APPROVED';
        allUsers[uIdx].warehouseId = `wh_${targetEmail.split('@')[0]}`;
        allUsers[uIdx].approvedAt = new Date().toISOString();
        writeLocalUsers(allUsers);
      }

      // Async Firestore update
      withTimeout(getDocs(query(collection(db, USERS_COL), where('email', '==', targetEmail)))).then(snap => {
        if (snap && !snap.empty) {
          updateDoc(doc(db, USERS_COL, snap.docs[0].id), {
            role: '관리자',
            status: 'APPROVED',
            warehouseId: `wh_${targetEmail.split('@')[0]}`,
            approvedAt: new Date().toISOString(),
          });
        }
      });

      return NextResponse.json({ success: true, targetEmail });
    }

    // G. 계정 삭제 (Delete User by email)
    if (action === 'delete_user') {
      if (!targetEmail) {
        return NextResponse.json({ error: '삭제할 대상 이메일이 필요합니다.' }, { status: 400 });
      }

      if (targetEmail === MASTER_ADMIN.email || targetEmail === 'wjmals') {
        return NextResponse.json({ error: '총괄 서버 관리자 계정은 삭제할 수 없습니다.' }, { status: 403 });
      }

      const updatedList = allUsers.filter(u => u.email !== targetEmail);
      writeLocalUsers(updatedList);

      await deleteFirestoreUser(targetEmail);

      return NextResponse.json({ success: true, deletedEmail: targetEmail });
    }

    return NextResponse.json({ error: '유효하지 않은 요청입니다.' }, { status: 400 });
  } catch (err: unknown) {
    console.error('Users POST error:', err);
    const message = err instanceof Error ? err.message : '처리 중 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/users?email=xxx
export async function DELETE(req: NextRequest) {
  const email = new URL(req.url).searchParams.get('email');
  if (!email) {
    return NextResponse.json({ error: 'email 파라미터가 필요합니다.' }, { status: 400 });
  }

  if (email === MASTER_ADMIN.email || email === 'wjmals') {
    return NextResponse.json({ error: '서버 관리자 계정은 삭제할 수 없습니다.' }, { status: 403 });
  }

  try {
    const allUsers = readLocalUsers();
    const updated = allUsers.filter(u => u.email !== email);
    writeLocalUsers(updated);

    await deleteFirestoreUser(email);

    return NextResponse.json({ success: true, deletedEmail: email });
  } catch (err) {
    return NextResponse.json({ error: '삭제 중 오류 발생' }, { status: 500 });
  }
}
