# Python Processor Template

This plugin demonstrates how to bridge Python scripts into the AI Engine pipeline.

## How It Works

1. The TypeScript wrapper (`src/index.ts`) implements the Processor interface
2. It delegates processing to a Python script (`processor.py`)
3. The Python script receives JSON via stdin and outputs JSON via stdout

## Python Script Contract

### Input (stdin)

```json
{
  "document": {
    "type": "string",
    "source": "string",
    "content": "string",
    "metadata": {},
    "createdAt": "ISO8601 string"
  },
  "context": {
    "runId": "string",
    "workingDirectory": "string"
  }
}
```

### Output (stdout)

```json
{
  "document": {
    "type": "string",
    "source": "string",
    "content": "string",
    "metadata": {},
    "createdAt": "ISO8601 string"
  }
}
```

### Error Handling

On error, the Python script must:
1. Write a JSON error object to stderr
2. Exit with a non-zero exit code

```json
{
  "error": "Error message",
  "type": "ErrorType"
}
```

## Usage

Build the plugin:

```bash
pnpm --filter @ai-engine/plugin-python-processor build
```

Use in a pipeline:

```bash
ai-engine run pipeline.json input.pdf --plugins plugins/python-processor-template
```

## Modifying the Template

Edit `processor.py` to implement your custom processing logic. The example appends `[python-processed]` to the document content.

No external Python dependencies are required for this template, but you can add them as needed for your use case.
