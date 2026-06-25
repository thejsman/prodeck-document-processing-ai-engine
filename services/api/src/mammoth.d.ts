declare module 'mammoth' {
  interface Result {
    value: string;
    messages: unknown[];
  }
  export function extractRawText(input: { buffer: Buffer }): Promise<Result>;
  export function convertToHtml(input: { buffer: Buffer }): Promise<Result>;
}
