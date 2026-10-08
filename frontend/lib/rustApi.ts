export class RustApiConfigurationError extends Error {
  constructor() {
    super('백엔드 주소가 설정되지 않았습니다. 배포 환경변수 RUST_API_URL에 공개 HTTPS Rust API 주소를 설정해주세요.');
    this.name = 'RustApiConfigurationError';
  }
}

export function getRustApiUrl(): string {
  const configuredUrl = process.env.RUST_API_URL?.trim();
  if (configuredUrl) return configuredUrl.replace(/\/+$/, '');
  if (process.env.NODE_ENV === 'production') throw new RustApiConfigurationError();
  return 'http://localhost:8080';
}

export function backendUnavailableResponse(error: unknown, fallbackMessage = '백엔드 서버에 연결할 수 없습니다.') {
  const message = error instanceof Error ? error.message : fallbackMessage;
  return Response.json({ error: message }, { status: 503 });
}
