import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEventHandler, DragEventHandler } from 'react';
import { parseMedleyRecordsCsv } from './csvRecordsParser';
import { parseLenexMeet } from './lenexParser';
import { buildRecordLenexXml, createRecordListPreview, guessRecordType, makeRecordExportFileName } from './recordsLenexBuilder';
import { parseUniP } from './unipParser';
import type { CsvRecordRow, LenexEvent, LenexMeetSummary, UniPRow } from './types';

const acceptedFileTypes = '.lef,.xml,text/xml,application/xml';
const acceptedUniPFileTypes = '.txt,.csv,text/plain';
const acceptedCsvFileTypes = '.csv,text/csv,text/plain';
const xmlEncodingPattern = /<\?xml[^>]*encoding=["']([^"']+)["']/i;
type UniPEncoding = 'iso-8859-1' | 'utf-8';

const sourceRepositoryUrl = 'https://github.com/hakostra/lenex-tools';

const medleyRecordSources = [
  {
    label: 'Norwegian senior records',
    href: 'https://www.medley.no/rekorder.aspx?fraaar=1911&basseng=b&kjonn=b&fHC=1&rekordtype=2'
  },
  {
    label: 'Norwegian junior records',
    href: 'https://www.medley.no/rekorder.aspx?fraaar=1911&basseng=b&kjonn=b&fHC=1&rekordtype=1'
  }
];

type ToolId = 'unip-to-lenex' | 'csv-records-to-lenex';

type ToolDefinition = {
  id: ToolId;
  label: string;
  description: string;
  implemented: boolean;
};

const availableTools: ToolDefinition[] = [
  {
    id: 'unip-to-lenex',
    label: 'UNI_p to Lenex converter',
    description: 'Upload Lenex meet setup and UNI_p registrations, validate, and export entries.',
    implemented: true
  },
  {
    id: 'csv-records-to-lenex',
    label: 'CSV records to Lenex',
    description: 'Convert records and result data from CSV sources into Lenex structures.',
    implemented: true
  }
];

const normalizeEncoding = (encoding: string) => encoding.trim().toLowerCase().replace(/_/g, '-');

const getSupportedEncoding = (declaredEncoding: string | null): 'utf-8' | 'iso-8859-1' => {
  if (!declaredEncoding) {
    return 'utf-8';
  }

  const normalized = normalizeEncoding(declaredEncoding);
  if (normalized === 'utf-8' || normalized === 'utf8') {
    return 'utf-8';
  }

  if (normalized === 'iso-8859-1' || normalized === 'iso8859-1' || normalized === 'latin1' || normalized === 'latin-1') {
    return 'iso-8859-1';
  }

  throw new Error(`Unsupported XML encoding "${declaredEncoding}". Supported encodings are UTF-8 and ISO-8859-1.`);
};

const decodeXmlFileText = async (file: File): Promise<{ content: string; encoding: 'utf-8' | 'iso-8859-1' }> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const header = new TextDecoder('iso-8859-1').decode(bytes.slice(0, 512));
  const declaredEncoding = header.match(xmlEncodingPattern)?.[1] ?? null;
  const encoding = getSupportedEncoding(declaredEncoding);

  return {
    content: new TextDecoder(encoding).decode(bytes),
    encoding
  };
};

const decodePlainTextFile = async (file: File, encoding: UniPEncoding): Promise<string> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return new TextDecoder(encoding).decode(bytes);
};

const inferFullYearFromAgeGroup = (ageGroupCode: string): string | null => {
  const match = ageGroupCode.match(/^Born YY=(\d{2})$/);
  if (!match) {
    return null;
  }

  const yy = Number(match[1]);
  const currentYearShort = new Date().getFullYear() % 100;
  const fullYear = yy <= currentYearShort ? 2000 + yy : 1900 + yy;
  return String(fullYear);
};

const isParaClass = (value: string) => /^(S|SB|SM)(1[0-5]|[1-9])$/i.test(value);

type HandicapAttributeName = 'free' | 'breast' | 'medley';

const getHandicapFromClass = (value: string): { attribute: HandicapAttributeName; level: string } | null => {
  const match = value.trim().toUpperCase().match(/^(SB|SM|S)(1[0-5]|[1-9])$/);
  if (!match) {
    return null;
  }

  const prefix = match[1];
  const level = match[2];

  if (prefix === 'SB') {
    return { attribute: 'breast', level };
  }

  if (prefix === 'SM') {
    return { attribute: 'medley', level };
  }

  return { attribute: 'free', level };
};

const formatYearClassCell = (row: UniPRow): string => {
  const yearFromField7 = inferFullYearFromAgeGroup(row.ageGroupCode);

  if (row.relayCount > 1) {
    return row.birthYearOrClass || row.ageGroupCode;
  }

  if (isParaClass(row.birthYearOrClass)) {
    return yearFromField7 ? `${yearFromField7} (${row.birthYearOrClass})` : row.birthYearOrClass;
  }

  if (/^\d{4}$/.test(row.birthYearOrClass)) {
    return row.birthYearOrClass;
  }

  return yearFromField7 ?? row.birthYearOrClass;
};

const getRowKey = (row: UniPRow) => `${row.lineNumber}-${row.eventNumber ?? 'x'}-${row.lastName}-${row.firstName}`;

const mergeIssues = (baseIssues: string[], validationIssues: string[]) =>
  Array.from(new Set([...baseIssues, ...validationIssues]));

const forbiddenRegistrationRounds = new Set(['FIN', 'SEM', 'QUA', 'SOP', 'SOS', 'SOQ']);

const getAgeAtEventYear = (row: UniPRow, event: LenexEvent): number | null => {
  if (row.relayCount > 1) {
    return null;
  }

  const birthYear = inferBirthYear(row);
  if (!birthYear || !/^\d{4}$/.test(birthYear)) {
    return null;
  }

  const eventYearMatch = event.sessionDate.match(/^(\d{4})/);
  if (!eventYearMatch) {
    return null;
  }

  return Number(eventYearMatch[1]) - Number(birthYear);
};

const isAgeInAnyEventAgeGroup = (age: number, event: LenexEvent): boolean => {
  if (event.ageGroups.length === 0) {
    return true;
  }

  return event.ageGroups.some((ageGroup) => {
    const minOk = ageGroup.agemin < 0 || age >= ageGroup.agemin;
    const maxOk = ageGroup.agemax < 0 || age <= ageGroup.agemax;
    return minOk && maxOk;
  });
};

const validateRowAgainstLenex = (row: UniPRow, eventsByNumber: Map<string, LenexEvent[]>, hasLenex: boolean): string[] => {
  if (!hasLenex || row.eventNumber === null) {
    return [];
  }

  const candidates = eventsByNumber.get(String(row.eventNumber)) ?? [];
  if (candidates.length === 0) {
    return ['Invalid event'];
  }

  const issues: string[] = [];

  if (!candidates.some((event) => event.relayCount === row.relayCount)) {
    issues.push('Invalid length');
  }

  if (!candidates.some((event) => event.distance === row.distance)) {
    issues.push('Invalid distance');
  }

  if (row.stroke && !candidates.some((event) => event.stroke === row.stroke)) {
    issues.push('Invalid style');
  }

  if (row.gender && !candidates.some((event) => event.gender === row.gender)) {
    issues.push('Invalid gender');
  }

  const compatibleCandidates = candidates.filter((event) => {
    const relayMatches = event.relayCount === row.relayCount;
    const distanceMatches = event.distance === row.distance;
    const strokeMatches = !row.stroke || event.stroke === row.stroke;
    const genderMatches = !row.gender || event.gender === row.gender;

    return relayMatches && distanceMatches && strokeMatches && genderMatches;
  });

  if (compatibleCandidates.length > 0) {
    const allowedCandidateExists = compatibleCandidates.some((event) => !forbiddenRegistrationRounds.has(event.round));
    if (!allowedCandidateExists) {
      const warnedRounds = Array.from(new Set(compatibleCandidates.map((event) => event.round))).filter((round) =>
        forbiddenRegistrationRounds.has(round)
      );
      warnedRounds.forEach((round) => issues.push(`Registration for ${round}`));
    }

    const candidatesToCheckAge = compatibleCandidates.filter((event) => !forbiddenRegistrationRounds.has(event.round));
    const ageCheckCandidates = candidatesToCheckAge.length > 0 ? candidatesToCheckAge : compatibleCandidates;
    const swimmerAge = getAgeAtEventYear(row, ageCheckCandidates[0]);

    if (swimmerAge !== null && !ageCheckCandidates.some((event) => isAgeInAnyEventAgeGroup(swimmerAge, event))) {
      issues.push(`Invalid age group (age ${swimmerAge} not allowed for event ${row.eventNumber})`);
    }
  }

  return issues;
};

const toLenexEntryTime = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  const segments = trimmed.split(':');
  if (segments.length === 2) {
    return `00:${trimmed}`;
  }
  if (segments.length === 3) {
    return trimmed;
  }

  return null;
};

const toLenexDate = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const compact = value.trim();
  if (/^\d{8}$/.test(compact)) {
    return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  }

  return compact;
};

const inferBirthYear = (row: UniPRow): string | null => {
  if (/^\d{4}$/.test(row.birthYearOrClass)) {
    return row.birthYearOrClass;
  }

  return inferFullYearFromAgeGroup(row.ageGroupCode);
};

const findMatchingLenexEvent = (row: UniPRow, eventsByNumber: Map<string, LenexEvent[]>) => {
  if (row.eventNumber === null) {
    return null;
  }

  const candidates = eventsByNumber.get(String(row.eventNumber)) ?? [];
  return (
    candidates.find((event) => {
      const roundAllowed = !forbiddenRegistrationRounds.has(event.round);
      const relayMatches = event.relayCount === row.relayCount;
      const distanceMatches = event.distance === row.distance;
      const strokeMatches = row.stroke ? event.stroke === row.stroke : true;
      const genderMatches = row.gender ? event.gender === row.gender : true;
      return roundAllowed && relayMatches && distanceMatches && strokeMatches && genderMatches;
    }) ?? null
  );
};

const setAttributes = (element: Element, attributes: Record<string, string | null | undefined>) => {
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== undefined && value !== null && value !== '') {
      element.setAttribute(name, value);
    }
  }
};

const applyAppConstructorMetadata = (doc: Document) => {
  const lenexElement = doc.querySelector('LENEX');
  if (!lenexElement) {
    throw new Error('Could not find LENEX root element for export.');
  }
  lenexElement.setAttribute('version', '3.0');

  let constructorElement = doc.querySelector('LENEX > CONSTRUCTOR');
  if (!constructorElement) {
    constructorElement = doc.createElement('CONSTRUCTOR');
    lenexElement.insertBefore(constructorElement, lenexElement.firstChild);
  }

  // Reset existing constructor attributes from source files (for example registration).
  Array.from(constructorElement.attributes).forEach((attribute) => constructorElement.removeAttribute(attribute.name));

  setAttributes(constructorElement, {
    name: 'lenex-tools',
    version: '1'
  });

  constructorElement.replaceChildren();
  const constructorContact = doc.createElement('CONTACT');
  setAttributes(constructorContact, {
    name: 'Håkon Strandenes',
    email: 'haakon@hakostra.net'
  });
  constructorElement.appendChild(constructorContact);
};

const sanitizeFileName = (value: string) => value.replace(/[^a-zA-Z0-9_-]+/g, '-');

const formatXmlWithIndentation = (xml: string, indentUnit = '  ') => {
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

const sanitizeLenexXmlForEntries = (xml: string): string => {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    throw new Error('Could not parse Lenex file.');
  }

  // Remove dynamic race data so exported entries are generated from clean meet definitions.
  doc.querySelectorAll('EVENT > RESULTS').forEach((resultsElement) => resultsElement.remove());
  doc.querySelectorAll('EVENT > HEATS').forEach((heatsElement) => heatsElement.remove());

  const serialized = new XMLSerializer().serializeToString(doc).trimStart();
  return serialized.startsWith('<?xml') ? serialized : `<?xml version="1.0" encoding="UTF-8"?>\n${serialized}`;
};

const stripNonRegistrableEventsFromLenexXml = (xml: string): string => {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    throw new Error('Could not parse Lenex meet file for filtering.');
  }

  doc.querySelectorAll('EVENT').forEach((eventElement) => {
    const round = (eventElement.getAttribute('round') ?? '').trim().toUpperCase();
    if (forbiddenRegistrationRounds.has(round)) {
      eventElement.remove();
    }
  });

  applyAppConstructorMetadata(doc);

  const serialized = new XMLSerializer().serializeToString(doc).trimStart();
  const normalized = serialized.startsWith('<?xml')
    ? serialized.replace(/^<\?xml[^>]*\?>/, '<?xml version="1.0" encoding="UTF-8"?>')
    : `<?xml version="1.0" encoding="UTF-8"?>\n${serialized}`;

  return formatXmlWithIndentation(normalized, '  ');
};

const buildLenexEntriesXml = ({
  baseXml,
  clubName,
  rows,
  eventsByNumber
}: {
  baseXml: string;
  clubName: string;
  rows: UniPRow[];
  eventsByNumber: Map<string, LenexEvent[]>;
}): { xml: string; skippedDuringBuild: number } => {
  const sanitizedBaseXml = sanitizeLenexXmlForEntries(baseXml);
  const doc = new DOMParser().parseFromString(sanitizedBaseXml, 'application/xml');
  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    throw new Error('Could not parse Lenex meet file for export.');
  }

  const meetElement = doc.querySelector('LENEX > MEETS > MEET');
  if (!meetElement) {
    throw new Error('Could not find MEET element for export.');
  }

  applyAppConstructorMetadata(doc);

  let clubsElement = meetElement.querySelector(':scope > CLUBS');
  if (!clubsElement) {
    clubsElement = doc.createElement('CLUBS');
    meetElement.appendChild(clubsElement);
  }
  clubsElement.replaceChildren();

  const clubElement = doc.createElement('CLUB');
  setAttributes(clubElement, { name: clubName || 'Unknown Club' });

  const athletesElement = doc.createElement('ATHLETES');
  const relaysElement = doc.createElement('RELAYS');

  const athleteByKey = new Map<string, { athleteElement: Element; entriesElement: Element; handicapElement: Element | null }>();
  let nextAthleteId = 1;
  let nextRelayNumber = 1;
  let skippedDuringBuild = 0;

  for (const row of rows) {
    const lenexEvent = findMatchingLenexEvent(row, eventsByNumber);
    if (!lenexEvent) {
      skippedDuringBuild += 1;
      continue;
    }

    const entryTime = toLenexEntryTime(row.qualificationTime);
    const meetInfoDate = toLenexDate(row.qualificationDate);

    const createEntryElement = () => {
      const entryElement = doc.createElement('ENTRY');
      setAttributes(entryElement, {
        eventid: lenexEvent.eventId,
        entrytime: entryTime,
        entrycourse: row.poolCourse
      });

      const hasQualificationLocationData = Boolean(meetInfoDate || row.qualificationPlace);
      if (hasQualificationLocationData) {
        const meetInfoElement = doc.createElement('MEETINFO');
        setAttributes(meetInfoElement, {
          course: row.poolCourse,
          date: meetInfoDate,
          city: row.qualificationPlace
        });
        entryElement.appendChild(meetInfoElement);
      }

      return entryElement;
    };

    if (row.relayCount > 1) {
      const relayElement = doc.createElement('RELAY');
      setAttributes(relayElement, {
        number: String(nextRelayNumber),
        name: row.lastName,
        agemin: '-1',
        agemax: '-1',
        agetotalmin: '-1',
        agetotalmax: '-1',
        gender: row.gender
      });
      nextRelayNumber += 1;

      const entriesElement = doc.createElement('ENTRIES');
      entriesElement.appendChild(createEntryElement());
      relayElement.appendChild(entriesElement);
      relaysElement.appendChild(relayElement);
      continue;
    }

    const birthYear = inferBirthYear(row);
    const athleteKey = `${row.lastName}|${row.firstName}|${row.gender}|${birthYear ?? ''}`;

    if (!athleteByKey.has(athleteKey)) {
      const athleteElement = doc.createElement('ATHLETE');
      setAttributes(athleteElement, {
        athleteid: String(nextAthleteId),
        birthdate: birthYear ? `${birthYear}-01-01` : null,
        firstname: row.firstName,
        lastname: row.lastName,
        gender: row.gender
      });
      nextAthleteId += 1;

      const entriesElement = doc.createElement('ENTRIES');
      athleteElement.appendChild(entriesElement);
      athletesElement.appendChild(athleteElement);

      athleteByKey.set(athleteKey, { athleteElement, entriesElement, handicapElement: null });
    }

    const athleteRecord = athleteByKey.get(athleteKey);
    if (!athleteRecord) {
      continue;
    }

    const handicap = getHandicapFromClass(row.birthYearOrClass);
    if (handicap) {
      let handicapElement = athleteRecord.handicapElement;
      if (!handicapElement) {
        handicapElement = doc.createElement('HANDICAP');
        athleteRecord.athleteElement.appendChild(handicapElement);
        athleteRecord.handicapElement = handicapElement;
      }
      handicapElement.setAttribute(handicap.attribute, handicap.level);
    }

    athleteRecord.entriesElement.appendChild(createEntryElement());
  }

  clubElement.appendChild(athletesElement);
  clubElement.appendChild(relaysElement);
  clubsElement.appendChild(clubElement);

  const serialized = new XMLSerializer().serializeToString(doc).trimStart();
  const normalized = serialized.startsWith('<?xml')
    ? serialized.replace(/^<\?xml[^>]*\?>/, '<?xml version="1.0" encoding="UTF-8"?>')
    : `<?xml version="1.0" encoding="UTF-8"?>\n${serialized}`;
  const xml = formatXmlWithIndentation(normalized, '  ');
  return { xml, skippedDuringBuild };
};

const App = () => {
  const [activeTool, setActiveTool] = useState<ToolId>('unip-to-lenex');
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [detectedEncoding, setDetectedEncoding] = useState<string | null>(null);
  const [lenexSourceXml, setLenexSourceXml] = useState<string | null>(null);
  const [lenexSummary, setLenexSummary] = useState<LenexMeetSummary | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [meetDefinitionError, setMeetDefinitionError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isUniPDragging, setIsUniPDragging] = useState(false);
  const [uniPEncoding, setUniPEncoding] = useState<UniPEncoding>('iso-8859-1');
  const [uniPFileName, setUniPFileName] = useState<string | null>(null);
  const [uniPClubName, setUniPClubName] = useState<string | null>(null);
  const [uniPRows, setUniPRows] = useState<UniPRow[]>([]);
  const [uniPErrorMessage, setUniPErrorMessage] = useState<string | null>(null);
  const [conversionWarning, setConversionWarning] = useState<string | null>(null);
  const [conversionError, setConversionError] = useState<string | null>(null);
  const [uniPSourceFile, setUniPSourceFile] = useState<File | null>(null);
  const uniPFileInputRef = useRef<HTMLInputElement | null>(null);
  const [isCsvDragging, setIsCsvDragging] = useState(false);
  const [csvEncoding, setCsvEncoding] = useState<UniPEncoding>('iso-8859-1');
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [csvRows, setCsvRows] = useState<CsvRecordRow[]>([]);
  const [csvErrorMessage, setCsvErrorMessage] = useState<string | null>(null);
  const [csvDownloadMessage, setCsvDownloadMessage] = useState<string | null>(null);
  const [csvRecordTypeLabelInput, setCsvRecordTypeLabelInput] = useState('');
  const [csvAgeMinInput, setCsvAgeMinInput] = useState('');
  const [csvAgeMaxInput, setCsvAgeMaxInput] = useState('');
  const [csvOverridesEdited, setCsvOverridesEdited] = useState(false);
  const [csvSourceFile, setCsvSourceFile] = useState<File | null>(null);
  const csvFileInputRef = useRef<HTMLInputElement | null>(null);

  const onPickClick = () => {
    fileInputRef.current?.click();
  };

  const onPickUniPClick = () => {
    uniPFileInputRef.current?.click();
  };

  const onPickCsvClick = () => {
    csvFileInputRef.current?.click();
  };

  const handleFile = async (file: File) => {
    setErrorMessage(null);
    setLenexSummary(null);
    setLenexSourceXml(null);
    setFileName(file.name);
    setDetectedEncoding(null);
    setMeetDefinitionError(null);
    setUniPFileName(null);
    setUniPClubName(null);
    setUniPRows([]);
    setUniPErrorMessage(null);
    setConversionWarning(null);
    setConversionError(null);
    setUniPSourceFile(null);

    try {
      const { content, encoding } = await decodeXmlFileText(file);
      const sanitizedContent = sanitizeLenexXmlForEntries(content);
      const parsed = parseLenexMeet(sanitizedContent);
      setLenexSourceXml(sanitizedContent);
      setDetectedEncoding(encoding);
      setLenexSummary(parsed);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not parse Lenex file.');
    }
  };

  const onDrop: DragEventHandler<HTMLDivElement> = async (event) => {
    event.preventDefault();
    setIsDragging(false);

    const file = event.dataTransfer.files.item(0);
    if (!file) {
      return;
    }

    await handleFile(file);
  };

  const onFileSelected: ChangeEventHandler<HTMLInputElement> = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    await handleFile(file);
  };

  const parseUniPFile = async (file: File, encoding: UniPEncoding) => {
    const content = await decodePlainTextFile(file, encoding);
    return parseUniP(content);
  };

  const handleUniPFile = async (file: File) => {
    setUniPErrorMessage(null);
    setConversionWarning(null);
    setConversionError(null);
    setUniPFileName(file.name);
    setUniPClubName(null);
    setUniPRows([]);
    setUniPSourceFile(file);

    try {
      const parsed = await parseUniPFile(file, uniPEncoding);
      setUniPClubName(parsed.clubName);
      setUniPRows(parsed.rows);
    } catch (error) {
      setUniPErrorMessage(error instanceof Error ? error.message : 'Could not parse UNI_p file.');
    }
  };

  const onUniPDrop: DragEventHandler<HTMLDivElement> = async (event) => {
    event.preventDefault();
    setIsUniPDragging(false);

    const file = event.dataTransfer.files.item(0);
    if (!file) {
      return;
    }

    await handleUniPFile(file);
  };

  const onUniPSelected: ChangeEventHandler<HTMLInputElement> = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    await handleUniPFile(file);
  };

  const parseCsvFile = async (file: File, encoding: UniPEncoding) => {
    const content = await decodePlainTextFile(file, encoding);
    return parseMedleyRecordsCsv(content);
  };

  const handleCsvFile = async (file: File) => {
    setCsvErrorMessage(null);
    setCsvDownloadMessage(null);
    setCsvOverridesEdited(false);
    setCsvFileName(file.name);
    setCsvRows([]);
    setCsvSourceFile(file);

    try {
      const parsed = await parseCsvFile(file, csvEncoding);
      setCsvRows(parsed.rows);
    } catch (error) {
      setCsvErrorMessage(error instanceof Error ? error.message : 'Could not parse CSV file.');
    }
  };

  const onCsvDrop: DragEventHandler<HTMLDivElement> = async (event) => {
    event.preventDefault();
    setIsCsvDragging(false);

    const file = event.dataTransfer.files.item(0);
    if (!file) {
      return;
    }

    await handleCsvFile(file);
  };

  const onCsvSelected: ChangeEventHandler<HTMLInputElement> = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    await handleCsvFile(file);
  };

  useEffect(() => {
    if (!csvSourceFile) {
      return;
    }

    let cancelled = false;

    const reload = async () => {
      try {
        const parsed = await parseCsvFile(csvSourceFile, csvEncoding);
        if (!cancelled) {
          setCsvErrorMessage(null);
          setCsvRows(parsed.rows);
        }
      } catch (error) {
        if (!cancelled) {
          setCsvErrorMessage(error instanceof Error ? error.message : 'Could not parse CSV file.');
        }
      }
    };

    void reload();

    return () => {
      cancelled = true;
    };
  }, [csvEncoding, csvSourceFile]);

  useEffect(() => {
    if (!uniPSourceFile) {
      return;
    }

    let cancelled = false;

    const reload = async () => {
      try {
        const parsed = await parseUniPFile(uniPSourceFile, uniPEncoding);
        if (!cancelled) {
          setUniPErrorMessage(null);
          setConversionWarning(null);
          setConversionError(null);
          setUniPClubName(parsed.clubName);
          setUniPRows(parsed.rows);
        }
      } catch (error) {
        if (!cancelled) {
          setUniPErrorMessage(error instanceof Error ? error.message : 'Could not parse UNI_p file.');
        }
      }
    };

    void reload();

    return () => {
      cancelled = true;
    };
  }, [uniPEncoding, uniPSourceFile]);

  const summaryText = useMemo(() => {
    if (!lenexSummary) {
      return 'Upload a Lenex meet definition (.lef or .xml) to view sessions and events.';
    }

    return `${lenexSummary.sessions.length} sessions · ${lenexSummary.totalEvents} events`;
  }, [lenexSummary]);

  const lenexEventsByNumber = useMemo(() => {
    const eventsByNumber = new Map<string, LenexEvent[]>();

    if (!lenexSummary) {
      return eventsByNumber;
    }

    for (const session of lenexSummary.sessions) {
      for (const event of session.events) {
        const existing = eventsByNumber.get(event.number) ?? [];
        existing.push(event);
        eventsByNumber.set(event.number, existing);
      }
    }

    return eventsByNumber;
  }, [lenexSummary]);

  const nonRegistrableEventsCount = useMemo(() => {
    if (!lenexSummary) {
      return 0;
    }

    return lenexSummary.sessions.reduce(
      (total, session) =>
        total + session.events.filter((event) => forbiddenRegistrationRounds.has(event.round.trim().toUpperCase())).length,
      0
    );
  }, [lenexSummary]);

  const mergedIssuesByRowKey = useMemo(() => {
    const map = new Map<string, string[]>();

    for (const row of uniPRows) {
      const validationIssues = validateRowAgainstLenex(row, lenexEventsByNumber, Boolean(lenexSummary));
      map.set(getRowKey(row), mergeIssues(row.issues, validationIssues));
    }

    return map;
  }, [uniPRows, lenexEventsByNumber, lenexSummary]);

  const exportableRows = useMemo(
    () => uniPRows.filter((row) => (mergedIssuesByRowKey.get(getRowKey(row)) ?? []).length === 0),
    [uniPRows, mergedIssuesByRowKey]
  );

  const skippedRowsWithIssues = uniPRows.length - exportableRows.length;

  const uniPSummaryText = useMemo(() => {
    if (uniPRows.length === 0) {
      return 'Upload a UNI_p file to inspect parsed registrations.';
    }

    const validRows = uniPRows.filter((row) => (mergedIssuesByRowKey.get(getRowKey(row)) ?? []).length === 0).length;
    return `${uniPRows.length} rows parsed · ${validRows} valid · ${uniPRows.length - validRows} with issues`;
  }, [uniPRows, mergedIssuesByRowKey]);

  const uniPGenderSummary = useMemo(() => {
    const genders: Array<'F' | 'M' | 'X'> = ['F', 'M', 'X'];

    const summaryByGender = genders.map((gender) => {
      const rowsForGender = uniPRows.filter((row) => row.gender === gender);
      const relayEntries = rowsForGender.filter((row) => row.relayCount > 1).length;
      const individualEntries = rowsForGender.filter((row) => row.relayCount <= 1).length;

      return {
        gender,
        total: individualEntries + relayEntries,
        individualEntries,
        relayEntries
      };
    });

    const totals = summaryByGender.reduce(
      (accumulator, item) => ({
        total: accumulator.total + item.total,
        individualEntries: accumulator.individualEntries + item.individualEntries,
        relayEntries: accumulator.relayEntries + item.relayEntries
      }),
      { total: 0, individualEntries: 0, relayEntries: 0 }
    );

    return [...summaryByGender, { gender: 'All', ...totals }];
  }, [uniPRows]);

  const uniPHasIssues = useMemo(
    () => uniPRows.some((row) => (mergedIssuesByRowKey.get(getRowKey(row)) ?? []).length > 0),
    [uniPRows, mergedIssuesByRowKey]
  );

  const csvSummaryText = useMemo(() => {
    if (csvRows.length === 0) {
      return 'Upload a CSV file to parse records.';
    }

    const validRows = csvRows.filter((row) => row.issues.length === 0).length;
    return `${csvRows.length} rows parsed · ${validRows} valid · ${csvRows.length - validRows} with issues`;
  }, [csvRows]);

  const validCsvRows = useMemo(() => csvRows.filter((row) => row.issues.length === 0), [csvRows]);

  const csvRecordTypeGuess = useMemo(() => guessRecordType(validCsvRows), [validCsvRows]);

  useEffect(() => {
    if (csvOverridesEdited) {
      return;
    }

    setCsvRecordTypeLabelInput(csvRecordTypeGuess.label);
    setCsvAgeMinInput(String(csvRecordTypeGuess.ageMin));
    setCsvAgeMaxInput(String(csvRecordTypeGuess.ageMax));
  }, [csvRecordTypeGuess, csvOverridesEdited]);

  const csvRecordTypeForExport = useMemo(() => {
    const parsedAgeMin = Number.parseInt(csvAgeMinInput.trim(), 10);
    const parsedAgeMax = Number.parseInt(csvAgeMaxInput.trim(), 10);

    const ageMin = Number.isNaN(parsedAgeMin) ? csvRecordTypeGuess.ageMin : parsedAgeMin;
    const ageMax = Number.isNaN(parsedAgeMax) ? csvRecordTypeGuess.ageMax : parsedAgeMax;
    const label = csvRecordTypeLabelInput.trim() || csvRecordTypeGuess.label;

    return {
      label,
      ageMin,
      ageMax,
      typeValue: label
    };
  }, [csvAgeMaxInput, csvAgeMinInput, csvRecordTypeGuess, csvRecordTypeLabelInput]);

  const validRowsByPool = useMemo(() => {
    const scm = validCsvRows.filter((row) => row.poolCourse === 'SCM').length;
    const lcm = validCsvRows.filter((row) => row.poolCourse === 'LCM').length;
    return { SCM: scm, LCM: lcm };
  }, [validCsvRows]);

  const csvRecordListPreviewByPool = useMemo(() => {
    return {
      SCM: createRecordListPreview({ rows: validCsvRows, poolCourse: 'SCM', guess: csvRecordTypeForExport }),
      LCM: createRecordListPreview({ rows: validCsvRows, poolCourse: 'LCM', guess: csvRecordTypeForExport })
    };
  }, [validCsvRows, csvRecordTypeForExport]);

  const buildTimeLabel = useMemo(() => {
    const parsed = new Date(__APP_BUILD_DATE__);
    if (Number.isNaN(parsed.getTime())) {
      return __APP_BUILD_DATE__;
    }

    const yyyy = String(parsed.getUTCFullYear());
    const mm = String(parsed.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(parsed.getUTCDate()).padStart(2, '0');
    const hh = String(parsed.getUTCHours()).padStart(2, '0');
    const min = String(parsed.getUTCMinutes()).padStart(2, '0');
    const ss = String(parsed.getUTCSeconds()).padStart(2, '0');

    return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
  }, []);

  const activeToolDefinition = useMemo(
    () => availableTools.find((tool) => tool.id === activeTool) ?? availableTools[0],
    [activeTool]
  );

  useEffect(() => {
    document.title = activeToolDefinition?.label || 'Lenex tools';
  }, [activeToolDefinition]);

  const onDownloadEntriesClick = () => {
    setConversionError(null);
    setConversionWarning(null);

    if (!lenexSourceXml || !lenexSummary) {
      setConversionError('Upload a Lenex meet definition before exporting entries.');
      return;
    }

    if (exportableRows.length === 0) {
      setConversionWarning('No valid UNI_p entries to export.');
      return;
    }

    try {
      const { xml, skippedDuringBuild } = buildLenexEntriesXml({
        baseXml: lenexSourceXml,
        clubName: uniPClubName ?? 'Unknown Club',
        rows: exportableRows,
        eventsByNumber: lenexEventsByNumber
      });

      const totalSkipped = skippedRowsWithIssues + skippedDuringBuild;
      if (totalSkipped > 0) {
        setConversionWarning(`Skipped ${totalSkipped} entries with issues.`);
      }

      const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const clubSegment = sanitizeFileName((uniPClubName ?? 'club').toLowerCase());
      const meetSegment = sanitizeFileName((lenexSummary.name || 'meet').toLowerCase());
      link.href = url;
      link.download = `${meetSegment}-${clubSegment}.lef`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      setConversionError(error instanceof Error ? error.message : 'Could not generate Lenex entries file.');
    }
  };

  const onDownloadRegistrationMeetClick = () => {
    setMeetDefinitionError(null);

    if (!lenexSourceXml || !lenexSummary) {
      setMeetDefinitionError('Upload a Lenex meet definition before downloading a filtered meet file.');
      return;
    }

    if (nonRegistrableEventsCount === 0) {
      return;
    }

    try {
      const filteredXml = stripNonRegistrableEventsFromLenexXml(lenexSourceXml);
      const blob = new Blob([filteredXml], { type: 'application/xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const meetSegment = sanitizeFileName((lenexSummary.name || 'meet').toLowerCase());
      link.href = url;
      link.download = `${meetSegment}-registration-events.lef`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      setMeetDefinitionError(error instanceof Error ? error.message : 'Could not generate filtered Lenex meet file.');
    }
  };

  const onDownloadCsvRecordsClick = (poolCourse: 'SCM' | 'LCM') => {
    setCsvDownloadMessage(null);

    if (validCsvRows.length === 0) {
      setCsvDownloadMessage('No valid CSV rows available for export.');
      return;
    }

    const rowsForPool = validCsvRows.filter((row) => row.poolCourse === poolCourse);
    if (rowsForPool.length === 0) {
      setCsvDownloadMessage(`No valid ${poolCourse === 'SCM' ? '25m' : '50m'} records found in the CSV data.`);
      return;
    }

    try {
      const producedDate = new Date().toISOString().slice(0, 10);
      const xml = buildRecordLenexXml({
        rows: validCsvRows,
        poolCourse,
        producedDate,
        guess: csvRecordTypeForExport
      });

      const fileName = makeRecordExportFileName({
        guess: csvRecordTypeForExport,
        poolCourse,
        producedDate
      });

      const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      setCsvDownloadMessage(error instanceof Error ? error.message : 'Could not generate LENEX record file.');
    }
  };

  const renderUniPToLenexTool = () => (
    <>
      <section className="card">
        <h1>UNI_p to Lenex converter</h1>
        <p className="subtitle">Upload and inspect Lenex meet definition files.</p>

        <div
          className={`drop-zone ${isDragging ? 'dragging' : ''}`}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
        >
          <p>Drag and drop your Lenex file here</p>
          <p className="small-text">or</p>
          <button type="button" onClick={onPickClick}>
            Choose file
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={acceptedFileTypes}
            onChange={onFileSelected}
            className="hidden-input"
          />
        </div>

        <div className="file-summary">
          <p>
            <strong>File:</strong> {fileName ?? 'No file selected'}
          </p>
          <p>
            <strong>Summary:</strong> {summaryText}
          </p>
          <p>
            <strong>Encoding:</strong> {detectedEncoding ?? 'N/A'}
          </p>
        </div>

        {errorMessage && <p className="error">{errorMessage}</p>}
      </section>

      {lenexSummary && (
        <>
          <section className="card">
            <h2>Meet Overview</h2>
            <p>
              <strong>Name:</strong> {lenexSummary.name}
            </p>
            <p>
              <strong>City/Nation:</strong> {lenexSummary.city} / {lenexSummary.nation}
            </p>
            <p>
              <strong>Course:</strong> {lenexSummary.course}
            </p>

            {lenexSummary.sessions.map((session) => (
              <article key={`${session.number}-${session.name}`} className="session-block">
                <h3>
                  Session {session.number}: {session.name}
                </h3>
                <p className="small-text">Date: {session.date}</p>

                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>No.</th>
                        <th>Name</th>
                        <th>Round</th>
                        <th>Stroke</th>
                        <th>Relay</th>
                        <th>Distance</th>
                        <th>Gender</th>
                      </tr>
                    </thead>
                    <tbody>
                      {session.events.map((event) => (
                        <tr key={`${session.number}-${event.eventId}`}>
                          <td>{event.number}</td>
                          <td>{event.name}</td>
                          <td>{event.round}</td>
                          <td>{event.stroke}</td>
                          <td>{event.relayCount}</td>
                          <td>{event.distance}</td>
                          <td>{event.gender}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
            ))}
          </section>

          <section className="card">
            <h2>Filtered Lenex meet file</h2>
            <p className="subtitle">
              Download a copy of the Lenex meet definition with non-registrable events removed ({' '}
              <code>FIN</code>, <code>SEM</code>, <code>QUA</code>, <code>SOP</code>, <code>SOS</code>, <code>SOQ</code>).{' '}
              {nonRegistrableEventsCount > 0
                ? `${nonRegistrableEventsCount} event${nonRegistrableEventsCount === 1 ? '' : 's'} will be removed.`
                : 'No such events are present in this meet definition.'}
            </p>
            <button type="button" onClick={onDownloadRegistrationMeetClick} disabled={nonRegistrableEventsCount === 0}>
              Download filtered Lenex meet file
            </button>
            {meetDefinitionError && <p className="error">{meetDefinitionError}</p>}
          </section>

          <section className="card">
            <h2>UNI_p Upload</h2>
            <p className="subtitle">Upload UNI_p club registration files to parse and verify fields before Lenex export.</p>

            <label className="encoding-row" htmlFor="unip-encoding-select">
              Text encoding
              <select
                id="unip-encoding-select"
                value={uniPEncoding}
                onChange={(event) => setUniPEncoding(event.target.value as UniPEncoding)}
              >
                <option value="iso-8859-1">ISO-8859-1 (default)</option>
                <option value="utf-8">UTF-8</option>
              </select>
            </label>

            <div
              className={`drop-zone ${isUniPDragging ? 'dragging' : ''}`}
              onDragOver={(event) => {
                event.preventDefault();
                setIsUniPDragging(true);
              }}
              onDragLeave={() => setIsUniPDragging(false)}
              onDrop={onUniPDrop}
            >
              <p>Drag and drop your UNI_p file here</p>
              <p className="small-text">or</p>
              <button type="button" onClick={onPickUniPClick}>
                Choose file
              </button>
              <input
                ref={uniPFileInputRef}
                type="file"
                accept={acceptedUniPFileTypes}
                onChange={onUniPSelected}
                className="hidden-input"
              />
            </div>

            <div className="file-summary">
              <p>
                <strong>File:</strong> {uniPFileName ?? 'No file selected'}
              </p>
              <p>
                <strong>Club:</strong> {uniPClubName ?? 'N/A'}
              </p>
              <p>
                <strong>Summary:</strong> {uniPSummaryText}
              </p>
              <p>
                <strong>Encoding:</strong> {uniPEncoding}
              </p>
            </div>

            {uniPErrorMessage && <p className="error">{uniPErrorMessage}</p>}
            {conversionError && <p className="error">{conversionError}</p>}
            {conversionWarning && <p className="warning">{conversionWarning}</p>}

            {uniPRows.length > 0 && (
              <>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Event</th>
                        <th>Relay</th>
                        <th>Dist</th>
                        <th>Stroke</th>
                        <th>Name</th>
                        <th>Gender</th>
                        <th>Class</th>
                        <th>Time</th>
                        <th>Issues</th>
                      </tr>
                    </thead>
                    <tbody>
                      {uniPRows.map((row) => (
                        <tr key={`${row.lineNumber}-${row.eventNumber ?? 'x'}-${row.lastName}-${row.firstName}`}>
                          <td>{row.eventNumber ?? ''}</td>
                          <td>{row.relayCount}</td>
                          <td>{row.distance ?? ''}</td>
                          <td>{row.stroke || row.strokeCode}</td>
                          <td>{[row.firstName, row.lastName].filter(Boolean).join(' ') || row.lastName}</td>
                          <td>{row.gender}</td>
                          <td>{formatYearClassCell(row)}</td>
                          <td>{row.qualificationTime ?? ''}</td>
                          <td className={(mergedIssuesByRowKey.get(getRowKey(row)) ?? []).length > 0 ? 'issue-cell' : ''}>
                            {(mergedIssuesByRowKey.get(getRowKey(row)) ?? []).join('; ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="table-wrap summary-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Gender</th>
                        <th>Total</th>
                        <th>Individual</th>
                        <th>Relay</th>
                      </tr>
                    </thead>
                    <tbody>
                      {uniPGenderSummary.map((item) => (
                        <tr key={item.gender}>
                          <td>{item.gender === 'All' ? <strong>{item.gender}</strong> : item.gender}</td>
                          <td>{item.gender === 'All' ? <strong>{item.total}</strong> : item.total}</td>
                          <td>{item.gender === 'All' ? <strong>{item.individualEntries}</strong> : item.individualEntries}</td>
                          <td>{item.gender === 'All' ? <strong>{item.relayEntries}</strong> : item.relayEntries}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

          </section>

          <section className="card">
            <h2>Lenex download</h2>
            {uniPRows.length > 0 && !uniPHasIssues && <p className="success-banner">UNI_p file passed all checks</p>}
            {uniPHasIssues && <p className="warning-banner">Given UNI_p file has issues - please fix manually. Entries with issues will not be in the Lenex download.</p>}

            <button type="button" onClick={onDownloadEntriesClick} disabled={!lenexSourceXml || uniPRows.length === 0}>
              Download Lenex entries
            </button>
          </section>

        </>
      )}

      <section className="card">
        <h2>Source &amp; build</h2>
        <p className="small-text">
          Original source repository:{' '}
          <a href={sourceRepositoryUrl} target="_blank" rel="noreferrer">
            {sourceRepositoryUrl}
          </a>
        </p>
        <p className="small-text">
          Build time (UTC): <strong>{buildTimeLabel}</strong>
        </p>
        <p className="small-text">
          Commit: <strong>{__APP_BUILD_COMMIT__}</strong>
        </p>
      </section>
    </>
  );

  const renderCsvRecordsTool = () => (
    <>
      <section className="card">
        <h1>CSV records to Lenex</h1>
        <p className="subtitle">Download records from Medley.no, parse CSV, and export pool-specific LENEX record files.</p>

        <div className="link-button-row">
          {medleyRecordSources.map((source) => (
            <a key={source.href} href={source.href} target="_blank" rel="noreferrer" className="link-button">
              {source.label}
            </a>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>CSV Upload</h2>
        <p className="subtitle">Download records from Medley.no as CSV and upload the file here.</p>

        <label className="encoding-row" htmlFor="csv-encoding-select">
          Text encoding
          <select id="csv-encoding-select" value={csvEncoding} onChange={(event) => setCsvEncoding(event.target.value as UniPEncoding)}>
            <option value="iso-8859-1">ISO-8859-1 (default)</option>
            <option value="utf-8">UTF-8</option>
          </select>
        </label>

        <div
          className={`drop-zone ${isCsvDragging ? 'dragging' : ''}`}
          onDragOver={(event) => {
            event.preventDefault();
            setIsCsvDragging(true);
          }}
          onDragLeave={() => setIsCsvDragging(false)}
          onDrop={onCsvDrop}
        >
          <p>Drag and drop your CSV file here</p>
          <p className="small-text">or</p>
          <button type="button" onClick={onPickCsvClick}>
            Choose file
          </button>
          <input
            ref={csvFileInputRef}
            type="file"
            accept={acceptedCsvFileTypes}
            onChange={onCsvSelected}
            className="hidden-input"
          />
        </div>

        <div className="file-summary">
          <p>
            <strong>File:</strong> {csvFileName ?? 'No file selected'}
          </p>
          <p>
            <strong>Summary:</strong> {csvSummaryText}
          </p>
          <p>
            <strong>Encoding:</strong> {csvEncoding}
          </p>
          <p>
            <strong>Valid rows by pool:</strong> 25m: {validRowsByPool.SCM} · 50m: {validRowsByPool.LCM}
          </p>
        </div>

        {csvErrorMessage && <p className="error">{csvErrorMessage}</p>}
        {csvDownloadMessage && <p className="warning">{csvDownloadMessage}</p>}

        {csvRows.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Relay</th>
                  <th>Dist</th>
                  <th>Stroke</th>
                  <th>Time</th>
                  <th>Name</th>
                  <th>Club</th>
                  <th>Date</th>
                  <th>Place</th>
                  <th>Gender</th>
                  <th>Pool</th>
                  <th>Para</th>
                  <th>Issues</th>
                </tr>
              </thead>
              <tbody>
                {csvRows.map((row) => (
                  <tr key={`${row.lineNumber}-${row.eventText}-${row.swimmerName}`}>
                    <td>{row.relayCount}</td>
                    <td>{row.distance ?? ''}</td>
                    <td>{row.stroke}</td>
                    <td>{row.recordTimeRaw}</td>
                    <td>{row.swimmerName}</td>
                    <td>{row.clubName}</td>
                    <td>{row.recordDate ?? ''}</td>
                    <td>{row.place}</td>
                    <td>{row.gender}</td>
                    <td>{row.poolCourse ?? ''}</td>
                    <td>{row.paraClass ?? ''}</td>
                    <td className={row.issues.length > 0 ? 'issue-cell' : ''}>{row.issues.join('; ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {csvSourceFile && (
        <section className="card">
          <h2>Record list presentation</h2>
          <p className="subtitle">Review or override the guessed record list name and age limits used for export.</p>

          <div className="file-summary">
            <p>
              <strong>Guessed record type:</strong> {csvRecordTypeGuess.label}
            </p>
            <p>
              <strong>Guessed age limits:</strong> {csvRecordTypeGuess.ageMin} to {csvRecordTypeGuess.ageMax} years
            </p>
          </div>

          <div className="link-button-row">
            <label className="encoding-row" htmlFor="csv-record-type-label-input">
              Record list name
              <input
                id="csv-record-type-label-input"
                type="text"
                value={csvRecordTypeLabelInput}
                onChange={(event) => {
                  setCsvOverridesEdited(true);
                  setCsvRecordTypeLabelInput(event.target.value);
                }}
              />
            </label>
            <label className="encoding-row" htmlFor="csv-age-min-input">
              Min age
              <input
                id="csv-age-min-input"
                type="number"
                value={csvAgeMinInput}
                onChange={(event) => {
                  setCsvOverridesEdited(true);
                  setCsvAgeMinInput(event.target.value);
                }}
              />
            </label>
            <label className="encoding-row" htmlFor="csv-age-max-input">
              Max age
              <input
                id="csv-age-max-input"
                type="number"
                value={csvAgeMaxInput}
                onChange={(event) => {
                  setCsvOverridesEdited(true);
                  setCsvAgeMaxInput(event.target.value);
                }}
              />
            </label>
          </div>

          <p className="small-text">
            Effective export settings: <strong>{csvRecordTypeForExport.label}</strong> ({csvRecordTypeForExport.ageMin} to{' '}
            {csvRecordTypeForExport.ageMax} years)
          </p>

          {validCsvRows.length > 0 && (
            <>
              <h3>Record list summary</h3>
              <p className="small-text">The tables below mirror the RECORDLIST blocks that will be written to each LENEX file.</p>

              <div className="table-wrap summary-table">
                <h4>25m file (SCM)</h4>
                {csvRecordListPreviewByPool.SCM.length === 0 ? (
                  <p className="small-text">No valid 25m records.</p>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>List name</th>
                        <th>Gender</th>
                        <th>Para class</th>
                        <th>Handicap</th>
                        <th>Records</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvRecordListPreviewByPool.SCM.map((item) => (
                        <tr key={`scm-${item.key}`}>
                          <td>{item.listName}</td>
                          <td>{item.gender}</td>
                          <td>{item.paraClass ?? ''}</td>
                          <td>{item.handicap ?? ''}</td>
                          <td>{item.recordCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="table-wrap summary-table">
                <h4>50m file (LCM)</h4>
                {csvRecordListPreviewByPool.LCM.length === 0 ? (
                  <p className="small-text">No valid 50m records.</p>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>List name</th>
                        <th>Gender</th>
                        <th>Para class</th>
                        <th>Handicap</th>
                        <th>Records</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvRecordListPreviewByPool.LCM.map((item) => (
                        <tr key={`lcm-${item.key}`}>
                          <td>{item.listName}</td>
                          <td>{item.gender}</td>
                          <td>{item.paraClass ?? ''}</td>
                          <td>{item.handicap ?? ''}</td>
                          <td>{item.recordCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}

          <div className="link-button-row csv-download-row">
            <button type="button" onClick={() => onDownloadCsvRecordsClick('SCM')} disabled={validRowsByPool.SCM === 0}>
              Download 25m records (SCM)
            </button>
            <button type="button" onClick={() => onDownloadCsvRecordsClick('LCM')} disabled={validRowsByPool.LCM === 0}>
              Download 50m records (LCM)
            </button>
          </div>
        </section>
      )}

      <section className="card">
        <h2>Source &amp; build</h2>
        <p className="small-text">
          Original source repository:{' '}
          <a href={sourceRepositoryUrl} target="_blank" rel="noreferrer">
            {sourceRepositoryUrl}
          </a>
        </p>
        <p className="small-text">
          Build time (UTC): <strong>{buildTimeLabel}</strong>
        </p>
        <p className="small-text">
          Commit: <strong>{__APP_BUILD_COMMIT__}</strong>
        </p>
      </section>
    </>
  );

  const renderUpcomingTool = () => (
    <section className="card tool-placeholder-card">
      <h1>{activeToolDefinition.label}</h1>
      <p className="subtitle">{activeToolDefinition.description}</p>
      <p className="tool-placeholder-note">
        This tool is not implemented yet. The app now supports a multi-tool layout, so this slot can be filled with a new
        converter or Lenex utility in a future update.
      </p>
    </section>
  );

  return (
    <main className="app-layout">
      <aside className="tool-menu card">
        <h2>Lenex toolbox</h2>
        <p className="small-text">Select an operation from the menu.</p>
        <nav className="tool-list" aria-label="Tool list">
          {availableTools.map((tool) => (
            <button
              key={tool.id}
              type="button"
              className={`tool-item ${tool.id === activeTool ? 'active' : ''}`}
              onClick={() => setActiveTool(tool.id)}
              aria-current={tool.id === activeTool ? 'page' : undefined}
            >
              <span className="tool-item-label">{tool.label}</span>
              {!tool.implemented && <span className="tool-item-badge">Coming soon</span>}
            </button>
          ))}
        </nav>
      </aside>

      <section className="tool-content">
        {activeTool === 'unip-to-lenex' && renderUniPToLenexTool()}
        {activeTool === 'csv-records-to-lenex' && renderCsvRecordsTool()}
        {activeTool !== 'unip-to-lenex' && activeTool !== 'csv-records-to-lenex' && renderUpcomingTool()}
      </section>
    </main>
  );
};

export default App;
