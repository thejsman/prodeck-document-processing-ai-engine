#!/usr/bin/env python3
import sys
import json
import math
import urllib.request
import urllib.error

OLLAMA_BASE_URL = 'http://localhost:11434'
GENERATION_MODEL = 'mistral'
EMBEDDING_MODEL = 'nomic-embed-text'
CHUNK_SIZE = 500
TOP_K = 3
QUERY = 'Summarize the key points of this document'


def ollama_post(path, payload):
    url = OLLAMA_BASE_URL + path
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(
        url,
        data=data,
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(req) as resp:
            body = resp.read().decode('utf-8')
            return json.loads(body)
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        raise RuntimeError(f'Ollama {path} returned HTTP {e.code}: {body}') from e
    except urllib.error.URLError as e:
        raise ConnectionError(
            f'Cannot reach Ollama at {url}: {e.reason}'
        ) from e


def split_chunks(text, chunk_size):
    chunks = []
    for start in range(0, len(text), chunk_size):
        chunk = text[start:start + chunk_size]
        stripped = chunk.strip()
        if stripped:
            chunks.append(stripped)
    return chunks


def get_embedding(text):
    result = ollama_post('/api/embeddings', {
        'model': EMBEDDING_MODEL,
        'prompt': text,
    })
    if 'embedding' not in result:
        raise ValueError('Ollama embeddings response missing "embedding" field')
    return result['embedding']


def get_embeddings_batch(texts):
    return [get_embedding(text) for text in texts]


def cosine_similarity(vec_a, vec_b):
    dot = 0.0
    norm_a = 0.0
    norm_b = 0.0
    for a, b in zip(vec_a, vec_b):
        dot += a * b
        norm_a += a * a
        norm_b += b * b
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (math.sqrt(norm_a) * math.sqrt(norm_b))


def retrieve_top_k(query_embedding, chunk_embeddings, chunks, k):
    scored = []
    for i, chunk_emb in enumerate(chunk_embeddings):
        score = cosine_similarity(query_embedding, chunk_emb)
        scored.append((score, i))
    scored.sort(key=lambda x: x[0], reverse=True)
    top_indices = [idx for _, idx in scored[:k]]
    top_indices.sort()
    return [chunks[i] for i in top_indices]


def generate(prompt):
    result = ollama_post('/api/generate', {
        'model': GENERATION_MODEL,
        'prompt': prompt,
        'stream': False,
    })
    if 'response' not in result:
        raise ValueError('Ollama generate response missing "response" field')
    return result['response']


def build_rag_prompt(retrieved_chunks):
    context_block = '\n\n'.join(retrieved_chunks)
    return (
        'Using the context below, summarize the document in 5 bullet points.\n\n'
        'Context:\n'
        + context_block
    )


def process_document(document):
    content = document['content']

    chunks = split_chunks(content, CHUNK_SIZE)
    if not chunks:
        raise ValueError('Document content produced no chunks after splitting')

    if len(chunks) <= TOP_K:
        retrieved = chunks
    else:
        chunk_embeddings = get_embeddings_batch(chunks)
        query_embedding = get_embedding(QUERY)
        retrieved = retrieve_top_k(query_embedding, chunk_embeddings, chunks, TOP_K)

    prompt = build_rag_prompt(retrieved)
    summary = generate(prompt)

    document['content'] = summary
    return document


def main():
    try:
        input_data = json.load(sys.stdin)

        if 'document' not in input_data:
            raise ValueError('Missing "document" field in input')

        document = input_data['document']

        if not isinstance(document.get('content'), str):
            raise ValueError('document.content must be a string')

        processed = process_document(document)

        json.dump({'document': processed}, sys.stdout)
        sys.stdout.flush()

    except Exception as e:
        error_output = {
            'error': str(e),
            'type': type(e).__name__,
        }
        json.dump(error_output, sys.stderr)
        sys.stderr.flush()
        sys.exit(1)


if __name__ == '__main__':
    main()
