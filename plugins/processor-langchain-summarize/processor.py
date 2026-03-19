#!/usr/bin/env python3
import sys
import json
import os


def get_api_key():
    key = os.environ.get('OPENAI_API_KEY')
    if not key:
        raise RuntimeError('OPENAI_API_KEY environment variable is not set')
    return key


def summarize(content, api_key):
    from langchain_openai import ChatOpenAI
    from langchain_core.messages import HumanMessage

    llm = ChatOpenAI(
        model='gpt-4o-mini',
        temperature=0,
        api_key=api_key,
    )

    prompt = (
        'Summarize the following text in 5 bullet points:\n\n'
        + content
    )

    response = llm.invoke([HumanMessage(content=prompt)])
    return response.content


def main():
    try:
        api_key = get_api_key()

        input_data = json.load(sys.stdin)

        if 'document' not in input_data:
            raise ValueError('Missing "document" field in input')

        document = input_data['document']

        if not isinstance(document.get('content'), str):
            raise ValueError('document.content must be a string')

        summary = summarize(document['content'], api_key)

        document['content'] = summary

        output = {'document': document}

        json.dump(output, sys.stdout)
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
