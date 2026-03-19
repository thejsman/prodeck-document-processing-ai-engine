#!/usr/bin/env python3
import sys
import json
import urllib.request
import urllib.error

OLLAMA_URL = 'http://localhost:11434/api/generate'
DEFAULT_MODEL = 'mistral'


def call_ollama(prompt, model):
    payload = json.dumps({
        'model': model,
        'prompt': prompt,
        'stream': False,
    }).encode('utf-8')

    req = urllib.request.Request(
        OLLAMA_URL,
        data=payload,
        headers={'Content-Type': 'application/json'},
        method='POST',
    )

    try:
        with urllib.request.urlopen(req) as resp:
            if resp.status != 200:
                body = resp.read().decode('utf-8', errors='replace')
                raise RuntimeError(
                    f'Ollama returned HTTP {resp.status}: {body}'
                )
            return json.loads(resp.read().decode('utf-8'))
    except urllib.error.URLError as e:
        raise ConnectionError(
            f'Cannot reach Ollama at {OLLAMA_URL}: {e.reason}'
        ) from e
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        raise RuntimeError(
            f'Ollama returned HTTP {e.code}: {body}'
        ) from e


def call_ollama_streaming(prompt, model):
    """Call Ollama with streaming enabled. Yields token strings."""
    payload = json.dumps({
        'model': model,
        'prompt': prompt,
        'stream': True,
    }).encode('utf-8')

    req = urllib.request.Request(
        OLLAMA_URL,
        data=payload,
        headers={'Content-Type': 'application/json'},
        method='POST',
    )

    try:
        resp = urllib.request.urlopen(req)
    except urllib.error.URLError as e:
        raise ConnectionError(
            f'Cannot reach Ollama at {OLLAMA_URL}: {e.reason}'
        ) from e
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        raise RuntimeError(
            f'Ollama returned HTTP {e.code}: {body}'
        ) from e

    try:
        buf = b''
        while True:
            chunk = resp.read(1)
            if not chunk:
                break
            buf += chunk
            if chunk == b'\n':
                line = buf.decode('utf-8', errors='replace').strip()
                buf = b''
                if not line:
                    continue
                obj = json.loads(line)
                token = obj.get('response', '')
                if token:
                    yield token
                if obj.get('done', False):
                    break
    finally:
        resp.close()


def emit(msg):
    """Write a single NDJSON message to stdout."""
    sys.stdout.write(json.dumps(msg, ensure_ascii=False) + '\n')
    sys.stdout.flush()


def main():
    try:
        input_data = json.load(sys.stdin)

        if 'document' not in input_data:
            raise ValueError('Missing "document" field in input')

        document = input_data['document']

        if not isinstance(document.get('content'), str):
            raise ValueError('document.content must be a string')

        context = input_data.get('context', {})
        stream = context.get('stream', False)

        prompt = (
            'Summarize the following text in 5 bullet points:\n\n'
            + document['content']
        )

        if stream:
            emit({'type': 'start'})
            full_response = ''
            for token in call_ollama_streaming(prompt, DEFAULT_MODEL):
                full_response += token
                emit({'type': 'chunk', 'content': token})
            emit({'type': 'end'})
            document['content'] = full_response
            emit({'type': 'result', 'document': document})
        else:
            result = call_ollama(prompt, DEFAULT_MODEL)
            if 'response' not in result:
                raise ValueError('Ollama response missing "response" field')
            document['content'] = result['response']
            json.dump({'document': document}, sys.stdout)
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
