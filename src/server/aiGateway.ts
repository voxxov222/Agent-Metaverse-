import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

export interface AiGatewayMetrics {
  totalCalls: number;
  totalTokensMeasured: number;
  totalLatencyMs: number;
  errorCount: number;
}

export const aiMetrics: AiGatewayMetrics = {
  totalCalls: 0,
  totalTokensMeasured: 0,
  totalLatencyMs: 0,
  errorCount: 0,
};

export function isGeminiConfigured(): boolean {
  const key = process.env.GEMINI_API_KEY?.trim();
  return Boolean(key && key !== 'MY_GEMINI_API_KEY');
}

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY is not configured. Add a valid key in Settings > Secrets to enable AI reasoning.',
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export async function runCentralCommand(
  prompt: string,
  systemContext: string,
): Promise<{ reply: string; tokens: number; latencyMs: number }> {
  const ai = getClient();
  const started = Date.now();
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        systemInstruction:
          'You are the Central Intelligence Core of VCALABS, an autonomous AI operating system. Respond concisely, precisely, and operationally. Never invent fake credentials or pretend external unconfigured services succeeded.\n\nCurrent System Context:\n' +
          systemContext,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });
    const latencyMs = Date.now() - started;
    const tokens = response.usageMetadata?.totalTokenCount ?? 0;
    aiMetrics.totalCalls += 1;
    aiMetrics.totalTokensMeasured += tokens;
    aiMetrics.totalLatencyMs += latencyMs;
    return {
      reply: response.text ?? 'No textual output returned.',
      tokens,
      latencyMs,
    };
  } catch (err) {
    aiMetrics.errorCount += 1;
    throw err;
  }
}

export async function runAgentTurn(params: {
  agentName: string;
  agentRole: string;
  personality: string;
  systemPrompt: string;
  memoriesText: string;
  userMessage: string;
}): Promise<{ reply: string; tokens: number; latencyMs: number }> {
  const ai = getClient();
  const started = Date.now();
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: params.userMessage,
      config: {
        systemInstruction: [
          `You are ${params.agentName}, role: ${params.agentRole}.`,
          `Personality: ${params.personality}.`,
          `Operational directive: ${params.systemPrompt}`,
          params.memoriesText ? `Relevant Agent Memory:\n${params.memoriesText}` : '',
          'Be clear, technical, and honest about what requires approval or external credentials.',
        ]
          .filter(Boolean)
          .join('\n\n'),
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });
    const latencyMs = Date.now() - started;
    const tokens = response.usageMetadata?.totalTokenCount ?? 0;
    aiMetrics.totalCalls += 1;
    aiMetrics.totalTokensMeasured += tokens;
    aiMetrics.totalLatencyMs += latencyMs;
    return {
      reply: response.text ?? '',
      tokens,
      latencyMs,
    };
  } catch (err) {
    aiMetrics.errorCount += 1;
    throw err;
  }
}

export interface PlannedTaskDraft {
  title: string;
  description: string;
  requiredExpertise: string;
  dependsOnIndex: number[];
  priority: 'low' | 'medium' | 'high' | 'critical';
  requiresApproval: boolean;
  estimatedMinutes: number;
}

export async function decomposeProjectObjective(objective: string): Promise<{
  title: string;
  tasks: PlannedTaskDraft[];
  milestones: string[];
  tokens: number;
  latencyMs: number;
}> {
  const ai = getClient();
  const started = Date.now();
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Decompose this operational objective into 3 to 5 structured tasks with dependencies and milestones:\n\n${objective}`,
      config: {
        systemInstruction:
          'You are the VCALABS Planning Engine. Output a crisp JSON project plan. Keep task descriptions actionable and concise.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            milestones: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            tasks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                  requiredExpertise: { type: Type.STRING },
                  dependsOnIndex: {
                    type: Type.ARRAY,
                    items: { type: Type.INTEGER },
                  },
                  priority: { type: Type.STRING },
                  requiresApproval: { type: Type.BOOLEAN },
                  estimatedMinutes: { type: Type.INTEGER },
                },
                required: ['title', 'description', 'requiredExpertise', 'dependsOnIndex', 'priority', 'requiresApproval', 'estimatedMinutes'],
              },
            },
          },
          required: ['title', 'milestones', 'tasks'],
        },
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });
    const latencyMs = Date.now() - started;
    const tokens = response.usageMetadata?.totalTokenCount ?? 0;
    aiMetrics.totalCalls += 1;
    aiMetrics.totalTokensMeasured += tokens;
    aiMetrics.totalLatencyMs += latencyMs;

    const parsed = JSON.parse((response.text ?? '{}').trim()) as {
      title?: string;
      milestones?: string[];
      tasks?: PlannedTaskDraft[];
    };

    return {
      title: parsed.title || objective.slice(0, 48),
      milestones: parsed.milestones?.length ? parsed.milestones : ['Plan Validated', 'Execution Complete', 'Deliverable Verified'],
      tasks: Array.isArray(parsed.tasks) && parsed.tasks.length > 0 ? parsed.tasks : [],
      tokens,
      latencyMs,
    };
  } catch (err) {
    aiMetrics.errorCount += 1;
    throw err;
  }
}

export async function generateWorkspaceCode(params: {
  instruction: string;
  existingCode?: string;
  filePath: string;
}): Promise<{ code: string; summary: string; tokens: number; latencyMs: number }> {
  const ai = getClient();
  const started = Date.now();
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: [
        `Target file: ${params.filePath}`,
        `Instruction: ${params.instruction}`,
        params.existingCode ? `Existing contents:\n\`\`\`\n${params.existingCode}\n\`\`\`` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
      config: {
        systemInstruction:
          'Generate clean production-quality code for the target file. Return JSON with fields "code" (complete file contents) and "summary" (short 1-sentence description).',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            code: { type: Type.STRING },
            summary: { type: Type.STRING },
          },
          required: ['code', 'summary'],
        },
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });
    const latencyMs = Date.now() - started;
    const tokens = response.usageMetadata?.totalTokenCount ?? 0;
    aiMetrics.totalCalls += 1;
    aiMetrics.totalTokensMeasured += tokens;
    aiMetrics.totalLatencyMs += latencyMs;

    const parsed = JSON.parse((response.text ?? '{}').trim()) as { code?: string; summary?: string };
    return {
      code: parsed.code ?? '',
      summary: parsed.summary ?? 'Generated code update.',
      tokens,
      latencyMs,
    };
  } catch (err) {
    aiMetrics.errorCount += 1;
    throw err;
  }
}

export async function runWebResearchGrounded(query: string): Promise<{
  report: string;
  sources: Array<{ title: string; uri: string }>;
  tokens: number;
  latencyMs: number;
}> {
  const ai = getClient();
  const started = Date.now();
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Research the following topic with verified web sources, security/licensing notes, and concise actionable recommendations:\n\n${query}`,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });
    const latencyMs = Date.now() - started;
    const tokens = response.usageMetadata?.totalTokenCount ?? 0;
    aiMetrics.totalCalls += 1;
    aiMetrics.totalTokensMeasured += tokens;
    aiMetrics.totalLatencyMs += latencyMs;

    const rawChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    const sources: Array<{ title: string; uri: string }> = [];
    for (const chunk of rawChunks) {
      const web = (chunk as { web?: { uri?: string; title?: string } }).web;
      if (web?.uri) {
        sources.push({ title: web.title || web.uri, uri: web.uri });
      }
    }

    return {
      report: response.text ?? 'No research summary produced.',
      sources,
      tokens,
      latencyMs,
    };
  } catch (err) {
    aiMetrics.errorCount += 1;
    throw err;
  }
}
