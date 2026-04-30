export type TextEncoding = 'iso-8859-1' | 'utf-8';

const xmlEncodingPattern = /<\?xml[^>]*encoding=["']([^"']+)["']/i;

const normalizeEncoding = (encoding: string) => encoding.trim().toLowerCase().replace(/_/g, '-');

const getSupportedEncoding = (declaredEncoding: string | null): TextEncoding => {
  if (!declaredEncoding) {
    return 'utf-8';
  }

  const normalized = normalizeEncoding(declaredEncoding);
  if (normalized === 'utf-8' || normalized === 'utf8') {
    return 'utf-8';
  }

  if (
    normalized === 'iso-8859-1' ||
    normalized === 'iso8859-1' ||
    normalized === 'latin1' ||
    normalized === 'latin-1'
  ) {
    return 'iso-8859-1';
  }

  throw new Error(
    `Unsupported XML encoding "${declaredEncoding}". Supported encodings are UTF-8 and ISO-8859-1.`
  );
};

export const decodeXmlFileText = async (file: File): Promise<{ content: string; encoding: TextEncoding }> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const header = new TextDecoder('iso-8859-1').decode(bytes.slice(0, 512));
  const declaredEncoding = header.match(xmlEncodingPattern)?.[1] ?? null;
  const encoding = getSupportedEncoding(declaredEncoding);

  return {
    content: new TextDecoder(encoding).decode(bytes),
    encoding
  };
};

export const decodePlainTextFile = async (file: File, encoding: TextEncoding): Promise<string> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return new TextDecoder(encoding).decode(bytes);
};

export const sanitizeFileName = (value: string) =>
  value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
