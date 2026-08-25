export interface CompletionRequest { system: string; messages: { role: string; content: string }[]; supportsGrammar: boolean; responseSchema?: unknown; }
export interface ModelClient { complete<T>(req: CompletionRequest): Promise<T>; }
