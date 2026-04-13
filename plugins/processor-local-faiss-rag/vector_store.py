"""Vector store abstraction and FAISS implementation."""

import json
import os
from abc import ABC, abstractmethod

import numpy as np
import faiss


class VectorStore(ABC):
    """Abstract interface for vector storage and retrieval.

    Implementations handle persistence, indexing, and similarity search.
    The processor layer depends only on this interface, never on a
    concrete backend like FAISS directly.
    """

    @abstractmethod
    def add(self, texts, embeddings):
        """Add texts with their corresponding embedding vectors.

        Args:
            texts: List of chunk strings.
            embeddings: List of embedding vectors (each a list of floats).
        """

    @abstractmethod
    def search(self, query_embedding, top_k):
        """Retrieve the top-k most similar chunk texts.

        Args:
            query_embedding: A single embedding vector (list of floats).
            top_k: Maximum number of results to return.

        Returns:
            List of chunk text strings, ordered by relevance.
        """

    @abstractmethod
    def persist(self):
        """Save the current index and chunk data to disk."""

    @abstractmethod
    def load(self):
        """Load index and chunk data from disk if they exist."""

    @property
    @abstractmethod
    def size(self):
        """Return the total number of vectors currently stored."""


class FaissVectorStore(VectorStore):
    """FAISS-backed vector store using IndexFlatIP with L2-normalized vectors (cosine similarity)."""

    INDEX_FILENAME = "index.faiss"
    CHUNKS_FILENAME = "chunks.json"

    def __init__(self, storage_dir):
        self._storage_dir = storage_dir
        self._index = None
        self._chunks = []

    @property
    def size(self):
        if self._index is None:
            return 0
        return int(self._index.ntotal)

    def load(self):
        index_path = os.path.join(self._storage_dir, self.INDEX_FILENAME)
        chunks_path = os.path.join(self._storage_dir, self.CHUNKS_FILENAME)

        if not os.path.isfile(index_path) or not os.path.isfile(chunks_path):
            self._index = None
            self._chunks = []
            return

        try:
            self._index = faiss.read_index(index_path)
        except Exception as exc:
            raise RuntimeError(
                f"Failed to load FAISS index from {index_path}: {exc}"
            ) from exc

        try:
            with open(chunks_path, "r", encoding="utf-8") as f:
                self._chunks = json.load(f)
        except Exception as exc:
            raise RuntimeError(
                f"Failed to load chunks from {chunks_path}: {exc}"
            ) from exc

        if not isinstance(self._chunks, list):
            raise ValueError(
                f"chunks.json must contain a JSON array, got {type(self._chunks).__name__}"
            )

        if self._index.ntotal != len(self._chunks):
            raise ValueError(
                f"Index/chunks mismatch: index has {self._index.ntotal} vectors "
                f"but chunks.json has {len(self._chunks)} entries"
            )

    @staticmethod
    def _chunk_text(entry):
        """Extract plain text from a chunk entry (string or {text, document} object)."""
        if isinstance(entry, dict):
            return entry.get("text", "")
        return entry

    @staticmethod
    def _chunk_document(entry):
        """Extract document name from a chunk entry; returns None for plain strings."""
        if isinstance(entry, dict):
            return entry.get("document")
        return None

    def add(self, texts, embeddings):
        """Add chunks with their embeddings.

        Args:
            texts: List of chunk strings OR list of {"text": str, "document": str} dicts.
            embeddings: List of embedding vectors (each a list of floats).
        """
        vectors = np.array(embeddings, dtype=np.float32)

        if vectors.ndim != 2 or vectors.shape[0] != len(texts):
            raise ValueError(
                f"Shape mismatch: {len(texts)} texts but embeddings shape {vectors.shape}"
            )

        dim = vectors.shape[1]

        if self._index is None:
            self._index = faiss.IndexFlatIP(dim)
            self._chunks = []
        elif self._index.d != dim:
            raise ValueError(
                f"Embedding dimension mismatch: index has d={self._index.d}, "
                f"new embeddings have d={dim}"
            )

        faiss.normalize_L2(vectors)
        self._index.add(vectors)
        self._chunks.extend(texts)

    def search(self, query_embedding, top_k):
        if self._index is None or self._index.ntotal == 0:
            return []

        k = min(top_k, self._index.ntotal)
        query_vec = np.array([query_embedding], dtype=np.float32)
        faiss.normalize_L2(query_vec)

        _scores, indices = self._index.search(query_vec, k)

        results = []
        for idx in indices[0]:
            if 0 <= idx < len(self._chunks):
                results.append(self._chunk_text(self._chunks[idx]))
        return results

    def search_with_scores(self, query_embedding, top_k):
        """Return top-k chunks as dicts with 'text', 'score', and optional 'document' keys.

        Scores are cosine-similarity values in [-1, 1] (IndexFlatIP on
        L2-normalised vectors).  Higher is more similar.

        The 'document' field is present when chunks were ingested with source metadata
        (new format).  It is absent for legacy plain-string chunks.

        Returns:
            List of {"text": str, "score": float, "document"?: str} dicts.
        """
        if self._index is None or self._index.ntotal == 0:
            return []

        k = min(top_k, self._index.ntotal)
        query_vec = np.array([query_embedding], dtype=np.float32)
        faiss.normalize_L2(query_vec)

        scores, indices = self._index.search(query_vec, k)

        results = []
        for score, idx in zip(scores[0], indices[0]):
            if 0 <= idx < len(self._chunks):
                entry = self._chunks[idx]
                result = {"text": self._chunk_text(entry), "score": float(score)}
                doc = self._chunk_document(entry)
                if doc:
                    result["document"] = doc
                results.append(result)
        return results

    def persist(self):
        index_path = os.path.join(self._storage_dir, self.INDEX_FILENAME)
        chunks_path = os.path.join(self._storage_dir, self.CHUNKS_FILENAME)

        if self._index is None:
            return

        try:
            faiss.write_index(self._index, index_path)
        except Exception as exc:
            raise RuntimeError(
                f"Failed to save FAISS index to {index_path}: {exc}"
            ) from exc

        try:
            with open(chunks_path, "w", encoding="utf-8") as f:
                json.dump(self._chunks, f, ensure_ascii=False)
        except Exception as exc:
            raise RuntimeError(
                f"Failed to save chunks to {chunks_path}: {exc}"
            ) from exc
