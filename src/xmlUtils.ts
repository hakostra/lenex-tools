import { APP_CONSTRUCTOR, LENEX_VERSION, UTF8_XML_DECLARATION } from './lenexConstants';

export const setAttributes = (
  element: Element,
  attributes: Record<string, string | null | undefined>
) => {
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== undefined && value !== null && value !== '') {
      element.setAttribute(name, value);
    }
  }
};

export const parseXmlDocument = (xmlText: string, errorMessage: string): Document => {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    throw new Error(errorMessage);
  }

  return doc;
};

export const withUtf8XmlDeclaration = (xml: string): string => {
  const trimmed = xml.trimStart();
  return trimmed.startsWith('<?xml')
    ? trimmed.replace(/^<\?xml[^>]*\?>/, UTF8_XML_DECLARATION)
    : `${UTF8_XML_DECLARATION}\n${trimmed}`;
};

export const serializeXmlWithUtf8Declaration = (doc: Document): string => {
  const serialized = new XMLSerializer().serializeToString(doc);
  return withUtf8XmlDeclaration(serialized);
};

export const formatXmlWithIndentation = (xml: string, indentUnit = '  ') => {
  const tokens = xml
    .replace(/>\s+</g, '><')
    .replace(/(>)(<)(\/*)/g, '$1\n$2$3')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  let indentLevel = 0;
  const formatted: string[] = [];

  for (const token of tokens) {
    const isClosingTag = /^<\//.test(token);
    const isSelfClosingTag = /\/>$/.test(token);
    const isXmlDeclaration = /^<\?xml/.test(token);
    const isComment = /^<!--/.test(token);
    const isCData = /^<!\[CDATA\[/.test(token);
    const isDoctype = /^<!DOCTYPE/.test(token);

    if (isClosingTag) {
      indentLevel = Math.max(indentLevel - 1, 0);
    }

    const shouldIndent = !isXmlDeclaration;
    formatted.push(`${shouldIndent ? indentUnit.repeat(indentLevel) : ''}${token}`);

    const isOpeningTag = /^<[^!?/][^>]*>$/.test(token);
    if (isOpeningTag && !isSelfClosingTag && !isComment && !isCData && !isDoctype) {
      indentLevel += 1;
    }
  }

  return formatted.join('\n');
};

export const applyAppConstructorMetadata = (doc: Document) => {
  const lenexElement = doc.querySelector('LENEX');
  if (!lenexElement) {
    throw new Error('Could not find LENEX root element for export.');
  }
  lenexElement.setAttribute('version', LENEX_VERSION);

  let constructorElement = doc.querySelector('LENEX > CONSTRUCTOR');
  if (!constructorElement) {
    constructorElement = doc.createElement('CONSTRUCTOR');
    lenexElement.insertBefore(constructorElement, lenexElement.firstChild);
  }

  Array.from(constructorElement.attributes).forEach((attribute) => constructorElement.removeAttribute(attribute.name));

  setAttributes(constructorElement, {
    name: APP_CONSTRUCTOR.name,
    version: APP_CONSTRUCTOR.version
  });

  constructorElement.replaceChildren();
  const constructorContact = doc.createElement('CONTACT');
  setAttributes(constructorContact, APP_CONSTRUCTOR.contact);
  constructorElement.appendChild(constructorContact);
};
