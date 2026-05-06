import { create } from "zustand"
import type { DocumentClassification, RequirementKey, ConflictRecord } from "@/lib/api"

// ── Types ─────────────────────────────────────────────────────────

export interface ExtractionCardField {
  key: RequirementKey
  value: unknown
  confidence: number
  conflict?: ConflictRecord
}

export interface ExtractionCard {
  cardId: string
  namespace: string
  fileName: string
  classification: DocumentClassification
  extractedFields: ExtractionCardField[]
  knowledgeEntryCount: number
  highConfidenceCount: number
  lowConfidenceCount: number
  notFoundFields: RequirementKey[]
  expiresAt: string
  cardState: "pending" | "confirmed" | "discarded" | "expired"
  confirmedSummary?: { fieldsWritten: number }
  addedAt: number
}

// ── Store ─────────────────────────────────────────────────────────

interface ExtractionCardStore {
  cards: Record<string, ExtractionCard>
  addCard(payload: {
    cardId: string
    namespace: string
    fileName: string
    classification: DocumentClassification
    extractedFields: ExtractionCardField[]
    knowledgeEntryCount: number
    highConfidenceCount: number
    lowConfidenceCount: number
    notFoundFields: RequirementKey[]
    expiresAt: string
  }): void
  updateCardState(
    cardId: string,
    state: ExtractionCard["cardState"],
    summary?: ExtractionCard["confirmedSummary"],
  ): void
  loadRecoveryCards(cards: ExtractionCard[]): void
  getCardsForNamespace(namespace: string): ExtractionCard[]
}

export const useExtractionCardStore = create<ExtractionCardStore>((set, get) => ({
  cards: {},

  addCard(payload) {
    const card: ExtractionCard = {
      ...payload,
      cardState: "pending",
      addedAt: Date.now(),
    }
    set((state) => ({ cards: { ...state.cards, [card.cardId]: card } }))
  },

  updateCardState(cardId, state, summary) {
    set((s) => {
      const existing = s.cards[cardId]
      if (!existing) return s
      return {
        cards: {
          ...s.cards,
          [cardId]: { ...existing, cardState: state, ...(summary ? { confirmedSummary: summary } : {}) },
        },
      }
    })
  },

  loadRecoveryCards(cards) {
    set((s) => {
      const merged = { ...s.cards }
      for (const card of cards) {
        // Don't overwrite cards already in the store (live SSE takes precedence)
        if (!merged[card.cardId]) {
          merged[card.cardId] = card
        }
      }
      return { cards: merged }
    })
  },

  getCardsForNamespace(namespace) {
    return Object.values(get().cards).filter((c) => c.namespace === namespace)
  },
}))
