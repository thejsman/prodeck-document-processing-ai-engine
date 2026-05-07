import { create } from "zustand"

export interface FileProgress {
  stage: string
  chunksProcessed?: number
  totalChunks?: number
  message?: string
}

interface IngestionProgressStore {
  progress: Record<string, FileProgress>
  setProgress: (fileName: string, p: FileProgress) => void
  clearProgress: (fileName: string) => void
}

export const useIngestionProgressStore = create<IngestionProgressStore>((set) => ({
  progress: {},
  setProgress: (fileName, p) =>
    set((state) => ({ progress: { ...state.progress, [fileName]: p } })),
  clearProgress: (fileName) =>
    set((state) => {
      const next = { ...state.progress }
      delete next[fileName]
      return { progress: next }
    }),
}))
