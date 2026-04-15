export function meetingTranscriptPrompt(content: string): string {
  return `You are analyzing a raw meeting transcript. Meeting transcripts contain a mix of
business discussion and casual conversation (small talk, personal stories, weather,
sports, real estate, family, furniture, commute, etc).

Your job is to extract ONLY the business-relevant content.

STRICT RULES:
1. IGNORE all small talk, personal anecdotes, off-topic tangents, and social chatter
2. IGNORE greetings, goodbyes, and scheduling logistics
3. IDENTIFY participants and their roles from context clues
4. EXTRACT only business-relevant segments
5. GROUP them into distinct topics/themes
6. For each topic, capture decisions, facts, and open questions
7. Capture action items with owners and deadlines
8. Short relevant quotes that capture specific commitments or concerns (max 15 words each)

Transcript:
---
${content}
---

Respond with ONLY this JSON (no markdown, no explanation):
{
  "participants": [
    { "name": "...", "role": "...", "organization": "...", "inferredFrom": "..." }
  ],
  "sections": [
    {
      "topic": "Marketing Budget Planning",
      "summary": "Discussed 2025 marketing budget allocation...",
      "keyFacts": [
        "Last year budget was $135k, actual spend was $144k including rebranding",
        "Current Google Ads spend is approximately $20k/year"
      ],
      "decisions": ["Will prioritize website refresh and pillar content strategy"],
      "openQuestions": ["How to reallocate Google Ad spend vs organic"],
      "sentiment": "neutral",
      "relevantQuotes": ["we budgeted 135 and came in at 144"]
    }
  ],
  "actionItems": [
    { "owner": "agency", "action": "Send customizable proposal with pricing options", "deadline": "next 2 weeks", "status": "open" }
  ]
}`;
}
