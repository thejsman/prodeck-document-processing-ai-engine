"""Qdrant-backed vector store implementation.

Implements the same VectorStore interface as FaissVectorStore so that
knowledge_store.py can swap backends transparently.

Each namespace maps to one Qdrant collection.  The server handles
persistence — persist() and load() are no-ops.

Qdrant must be reachable at the URL passed to the constructor
(default: http://localhost:6333).
"""

import uuid
from typing import Optional

from qdrant_client import QdrantClient
from qdrant_client.models import Distance, PointStruct, VectorParams

from vector_store import VectorStore


class QdrantVectorStore(VectorStore):
    """Vector store backed by a Qdrant server."""

    def __init__(self, url: str, namespace: str, api_key: Optional[str] = None):
        """
        Args:
            url:        Qdrant base URL, e.g. "http://localhost:6333".
            namespace:  Used as the Qdrant collection name.
            api_key:    Optional API key for Qdrant Cloud. Omit for local Docker.
        """
        self._url = url
        self._collection = namespace
        self._api_key = api_key
        self._client: Optional[QdrantClient] = None

    # ── Internal helpers ────────────────────────────────────────────

    def _get_client(self) -> QdrantClient:
        if self._client is None:
            self._client = QdrantClient(url=self._url, api_key=self._api_key)
        return self._client

    def _ensure_collection(self, dim: int) -> None:
        """Create the collection if it does not already exist."""
        client = self._get_client()
        try:
            info = client.get_collection(self._collection)
            existing_dim = info.config.params.vectors.size  # type: ignore[union-attr]
            if existing_dim != dim:
                raise ValueError(
                    f"Collection '{self._collection}' exists with dimension "
                    f"{existing_dim} but current embeddings have dimension {dim}. "
                    "Re-create the collection or switch to a matching embedding model."
                )
        except Exception as exc:
            if "Not found" in str(exc) or "doesn't exist" in str(exc) or "404" in str(exc):
                client.create_collection(
                    collection_name=self._collection,
                    vectors_config=VectorParams(size=dim, distance=Distance.COSINE),
                )
            else:
                raise

    # ── VectorStore interface ───────────────────────────────────────

    def load(self) -> None:
        """No-op: Qdrant server handles persistence."""

    def persist(self) -> None:
        """No-op: Qdrant server handles persistence."""

    @property
    def size(self) -> int:
        try:
            info = self._get_client().get_collection(self._collection)
            # points_count is the reliable field; vectors_count may lag optimization
            return int(info.points_count or 0)
        except Exception:
            return 0

    def add(self, texts: list, embeddings: list) -> None:
        """Upsert chunk texts and their embeddings into the Qdrant collection."""
        if not texts or not embeddings:
            return

        dim = len(embeddings[0])
        self._ensure_collection(dim)

        points = [
            PointStruct(
                id=str(uuid.uuid4()),
                vector=list(embeddings[i]),
                payload={"text": texts[i]},
            )
            for i in range(len(texts))
        ]

        self._get_client().upsert(
            collection_name=self._collection,
            points=points,
            wait=True,
        )

    def _query(self, query_embedding: list, top_k: int):
        """Run a vector search and return ScoredPoint objects."""
        response = self._get_client().query_points(
            collection_name=self._collection,
            query=query_embedding,
            limit=top_k,
            with_payload=True,
        )
        return response.points

    def search(self, query_embedding: list, top_k: int) -> list:
        """Return top-k chunk texts (no scores)."""
        try:
            return [r.payload.get("text", "") for r in self._query(query_embedding, top_k)]
        except Exception:
            return []

    def search_with_scores(self, query_embedding: list, top_k: int) -> list:
        """Return top-k chunks as dicts with 'text' and 'score' keys.

        Scores are cosine-similarity values in [0, 1] (Qdrant normalises
        to 0–1 for COSINE distance).  Higher is more similar.
        """
        try:
            return [
                {"text": r.payload.get("text", ""), "score": float(r.score)}
                for r in self._query(query_embedding, top_k)
            ]
        except Exception:
            return []

    def delete_collection(self) -> None:
        """Delete the entire Qdrant collection for this namespace."""
        try:
            self._get_client().delete_collection(self._collection)
        except Exception:
            pass

    def collection_exists(self) -> bool:
        """Return True if the collection exists and has at least one vector."""
        try:
            info = self._get_client().get_collection(self._collection)
            return (info.vectors_count or 0) > 0
        except Exception:
            return False
