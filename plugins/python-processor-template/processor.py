#!/usr/bin/env python3
import sys
import json


def process_document(document):
    document['content'] = document['content'] + ' [python-processed]'
    return document


def main():
    try:
        input_data = json.load(sys.stdin)

        if 'document' not in input_data:
            raise ValueError('Missing "document" field in input')

        document = input_data['document']
        processed_document = process_document(document)

        output = {
            'document': processed_document
        }

        json.dump(output, sys.stdout)
        sys.stdout.flush()

    except Exception as e:
        error_output = {
            'error': str(e),
            'type': type(e).__name__
        }
        json.dump(error_output, sys.stderr)
        sys.stderr.flush()
        sys.exit(1)


if __name__ == '__main__':
    main()
