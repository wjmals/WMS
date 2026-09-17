# AI 및 관련 라이선스 안내

이 문서는 WMS 프로젝트에서 사용하는 AI 모델과 관련 SDK의 라이선스 및 상업적 사용 조건을 정리한 것입니다.
법률 자문이 아니며, 실제 서비스 출시 전에는 사용 지역, 고객 데이터, 계약 요금제에 맞는 별도 법률 검토가 필요합니다.

## 1. 프로젝트에서 사용하는 AI

### Meta Llama 4 Scout

- 사용 모델: `meta-llama/llama-4-scout-17b-16e-instruct`
- 사용 위치: `frontend/app/api/monitor/route.ts`
- 사용 방식: Groq API를 통한 서버 측 멀티모달 이미지 분석
- 공식 라이선스: [Llama 4 Community License](https://developer.meta.com/ai/llama4/license/)
- 공식 사용 정책: [Llama 4 Acceptable Use Policy](https://developer.meta.com/ai/llama4/use-policy/)

Llama 4 Community License는 조건을 준수하는 경우 상업적 사용, 복제, 수정 및 배포를 허용합니다. 이 프로젝트는 Llama 모델 파일이나 가중치를 직접 배포하지 않고 Groq API를 통해 모델을 호출합니다.

### 주요 조건

1. Llama 4 및 관련 결과물을 법률과 Acceptable Use Policy에 맞게 사용해야 합니다.
2. Llama 자료, 파생 모델 또는 이를 포함한 제품이나 서비스를 배포하는 경우 라이선스 사본을 제공해야 할 수 있습니다.
3. 관련 웹사이트, 사용자 인터페이스, 블로그, 제품 문서 등에 다음 문구를 표시해야 합니다.

```text
Built with Llama 4
```

4. Llama 자료 자체를 배포하는 경우 다음 고지를 포함해야 합니다.

```text
Llama 4 is licensed under the Llama 4 Community License,
Copyright © Meta Platforms, Inc. All Rights Reserved.
```

5. 모델을 사용하거나 개선하여 새 AI 모델을 배포하는 경우 모델 이름 앞에 `Llama`를 포함해야 하는 조건이 적용될 수 있습니다.
6. 모델 출시일 기준 월간 활성 사용자가 7억 명을 초과하는 제품이나 서비스는 Meta의 별도 라이선스가 필요합니다.
7. Meta의 상표권은 일반적인 설명에 필요한 범위를 제외하고 별도로 허가되지 않습니다.

현재 서비스 규모는 7억 월간 활성 사용자 기준과 거리가 있지만, 서비스가 크게 성장하면 해당 조건을 다시 검토해야 합니다.

## 2. Groq API 및 SDK

### Groq TypeScript SDK

- 패키지: `groq-sdk`
- 사용 위치: `frontend/app/api/monitor/route.ts`
- 패키지 라이선스: [Apache License 2.0](https://github.com/groq/groq-typescript/blob/main/LICENSE)

Apache License 2.0은 상업적 사용, 수정, 배포 및 특허 사용을 허용합니다. 배포 시 라이선스 및 저작권 고지를 보존하고, 수정한 파일이 있으면 변경 사실을 표시해야 합니다.

### Groq API 서비스

SDK 라이선스와 API 서비스 이용 조건은 별개입니다. API를 상업 서비스에서 사용하려면 GroqCloud 계정에 적용되는 최신 서비스 약관, 요금제, 사용량 제한, 금지 콘텐츠 정책을 따라야 합니다.

- [Groq 법률 정책](https://groq.com/legal/)
- [Groq 이용약관](https://groq.com/terms-of-use/)

Groq API 키는 서버 환경변수 `GROQ_API_KEY`로만 보관해야 하며, 브라우저 코드나 Git 저장소에 포함하면 안 됩니다.

## 3. 이 프로젝트에서의 상업적 사용 판단

현재 구조만 기준으로 하면 다음 조건을 지키는 경우 상업 서비스에 사용할 수 있습니다.

- GroqCloud의 상업적 API 사용 조건과 요금제 준수
- Llama 4 Community License 준수
- `Built with Llama 4` 고지 추가
- Llama 자료나 가중치를 직접 재배포하지 않기
- 금지된 용도나 불법적인 이미지 분석에 사용하지 않기
- API 키를 서버에서만 사용하고 비밀로 관리하기
- CCTV 이미지와 재고 데이터에 대한 개인정보 및 보안 의무 준수

## 4. 이미지 및 개인정보 주의사항

`/api/monitor`는 카메라 이미지를 Groq API로 전송합니다. 사람 얼굴, 작업자 식별정보, 차량번호 등 개인정보가 포함될 수 있다면 다음을 별도로 검토해야 합니다.

- 촬영 사실과 AI 분석 사실에 대한 고지
- 개인정보 수집·이용 및 제3자 제공 또는 처리위탁 근거
- 국외 이전 여부와 이용자 고지
- 데이터 보관 기간과 삭제 절차
- 고객 또는 근로자의 영상 사용 권리
- Groq 및 배포 인프라의 데이터 처리 조건

업무용 창고 영상이라도 개인정보가 포함될 수 있으므로, 실제 상용 운영 전 개인정보 처리방침과 내부 접근 권한을 준비해야 합니다.

## 5. 프론트엔드 라이브러리 참고

AI 자체는 아니지만 현재 사용 중인 주요 라이브러리는 다음과 같습니다.

- `groq-sdk`: Apache License 2.0
- `lucide-react`: ISC/MIT 계열 라이선스 고지 조건 확인 필요
- `recharts`: MIT License
- `framer-motion`: MIT License
- `Next.js`, `React`, `Firebase`: 각 프로젝트의 Apache 2.0 또는 MIT 계열 라이선스 및 약관 적용

정확한 배포 고지를 위해 릴리스 전에 `npm license-checker` 등으로 전체 의존성 라이선스 목록을 생성하는 것을 권장합니다.

## 6. 배포 전 체크리스트

- [ ] 제품 문서 또는 웹사이트에 `Built with Llama 4` 추가
- [ ] 최신 Llama 4 Community License와 Acceptable Use Policy 재확인
- [ ] GroqCloud 상업 사용 요금제 및 서비스 약관 확인
- [ ] `GROQ_API_KEY`를 Vercel 환경변수로만 등록
- [ ] Git history와 공개 저장소에 Groq API 키가 없는지 확인
- [ ] CCTV 이미지 개인정보 처리방침 및 접근 권한 준비
- [ ] 전체 npm 의존성 라이선스 목록 검토

> 라이선스와 서비스 약관은 변경될 수 있으므로, 상용 출시 시점에 공식 원문을 다시 확인하세요.
