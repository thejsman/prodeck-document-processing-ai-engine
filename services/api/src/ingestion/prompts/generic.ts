export function genericPrompt(content: string): string {
  return `You are analyzing a business document. Extract the key topics, facts, decisions,
and action items. Group related information by topic.

Document:
---
${content}
---

Respond with ONLY this JSON:
{
  "sections": [
    {
      "topic": "...",
      "summary": "...",
      "keyFacts": ["..."],
      "decisions": ["..."],
      "openQuestions": ["..."],
      "sentiment": "neutral",
      "relevantQuotes": []
    }
  ],
  "actionItems": []
}`;
}
