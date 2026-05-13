/**
 * Gemini AI API 서비스
 * 모델: gemini-2.0-flash
 */

const API_KEY = process.env.REACT_APP_GEMINI_API_KEY || '';
const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

export interface GeminiResponse {
  text: string;
  parsed: any | null;
}

export async function callGemini(prompt: string): Promise<GeminiResponse> {
  if (!API_KEY) {
    throw new Error('Gemini API Key가 설정되지 않았습니다. .env에 REACT_APP_GEMINI_API_KEY를 추가하세요.');
  }

  const response = await fetch(`${API_URL}?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API 오류 (${response.status}): ${err}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // JSON 파싱 실패 시 텍스트 그대로
  }

  return { text, parsed };
}

/**
 * 참여율 최적화 프롬프트 생성 + API 호출
 */
export interface OptimizationInput {
  projects: { id: string; name: string; laborBudgetCash: number; laborBudgetInKind: number }[];
  employees: { name: string; position: string; salary: number; insurance: number; currentRates: Record<string, number>; remaining: number; respCount: number; coCount: number }[];
  goal: 'efficiency' | 'balanced' | 'priority';
  priorityProjectId?: string;
  constraints: string[];
}

export interface OptimizationResult {
  assignments: { employee: string; project: string; rate: number; role: string; monthlyCost: number }[];
  summary: { projectId: string; totalCash: number; totalInKind: number; budgetUsage: number }[];
  reasoning: string;
}

export async function optimizeParticipation(input: OptimizationInput): Promise<OptimizationResult> {
  const prompt = buildOptimizationPrompt(input);
  const { parsed } = await callGemini(prompt);

  if (!parsed || !parsed.assignments) {
    throw new Error('AI 응답을 파싱할 수 없습니다. 다시 시도해주세요.');
  }

  return parsed as OptimizationResult;
}

function buildOptimizationPrompt(input: OptimizationInput): string {
  const goalText = {
    efficiency: '예산 효율 최대화: 각 과제의 인건비 예산 한도를 최대한 활용하면서 초과하지 않도록',
    balanced: '참여율 균등 배분: 연구원별 총 참여율 부담을 균등하게 분배',
    priority: `특정 과제 우선: "${input.priorityProjectId}" 과제에 우수 인력을 집중 배치`,
  }[input.goal];

  return `당신은 국가연구개발 과제의 참여율 배분 전문가입니다.
아래 제약조건을 모두 만족하면서 최적의 참여율 배분을 추천해주세요.

## 과제 목록
${input.projects.map(p => `- ${p.name} (${p.id}): 인건비 예산 현금 ${p.laborBudgetCash.toLocaleString()}원, 현물 ${p.laborBudgetInKind.toLocaleString()}원`).join('\n')}

## 연구원 목록 (현재 참여 현황)
${input.employees.map(e => `- ${e.name} (${e.position}): 월급여 ${e.salary.toLocaleString()}원, 4대보험 ${e.insurance.toLocaleString()}원, 잔여참여율 ${e.remaining}%, 책임${e.respCount}/3, 공동${e.coCount}/5, 현재참여: ${JSON.stringify(e.currentRates)}`).join('\n')}

## 최적화 목표
${goalText}

## 제약조건
1. 개인 참여율 합계 100% 초과 금지
2. 책임연구원 동시 3개 과제 초과 금지 (3책)
3. 공동연구원 동시 5개 과제 초과 금지 (5공)
4. 각 과제의 인건비 예산 한도 초과 금지
5. 인건비 단가 = 월급여 + 4대보험회사부담 (퇴직금 미포함)
6. 과제 인건비 = 인건비단가 × 참여율(%)
${input.constraints.map((c, i) => `${i + 7}. ${c}`).join('\n')}

## 응답 형식 (반드시 이 JSON 구조로)
{
  "assignments": [
    { "employee": "이름", "project": "과제ID", "rate": 참여율숫자, "role": "책임연구원|연구원", "monthlyCost": 월인건비숫자 }
  ],
  "summary": [
    { "projectId": "과제ID", "totalCash": 현금합계, "totalInKind": 현물합계, "budgetUsage": 예산사용률퍼센트 }
  ],
  "reasoning": "배분 근거 설명 (한국어)"
}

참여율은 정수(%)로, 금액은 원 단위 정수로 응답하세요.
기존 참여율을 유지하면서 빈 슬롯에 최적 배분해주세요.`;
}
