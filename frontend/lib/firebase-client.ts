'use client';

const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
const identityToolkitUrl = 'https://identitytoolkit.googleapis.com/v1/accounts';

async function requestFirebaseAuth(endpoint: string, body: Record<string, unknown>) {
  const response = await fetch(`${identityToolkitUrl}:${endpoint}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error?.message || 'Firebase Authentication 요청에 실패했습니다.');
    (error as Error & { code?: string }).code = data.error?.message;
    throw error;
  }
  return data;
}

const firebaseSignup = (email: string, password: string) =>
  requestFirebaseAuth('signUp', { email, password, returnSecureToken: true });

const firebaseLogin = (email: string, password: string) =>
  requestFirebaseAuth('signInWithPassword', { email, password, returnSecureToken: true });

const firebaseSendPasswordReset = (email: string) =>
  requestFirebaseAuth('sendOobCode', { requestType: 'PASSWORD_RESET', email });

export { firebaseSignup, firebaseLogin, firebaseSendPasswordReset };