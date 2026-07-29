// Renamed to `ai.ts` when the AI provider was switched from Gemini
// (`@google-cloud/vertexai`, retired) to Mistral Medium 3 on Vertex AI
// Model Garden. Kept as a re-export shim in case anything still imports
// from this path directly.
export * from './ai';
