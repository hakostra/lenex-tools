import type { CsvRecordParseResult, CsvRecordRow } from './types';
import cities from './cities.json';

const strokeMap: Record<string, string> = {
  fri: 'FREE',
  free: 'FREE',
  bryst: 'BREAST',
  breast: 'BREAST',
  rygg: 'BACK',
  back: 'BACK',
  butterfly: 'FLY',
  fly: 'FLY',
  'individuell medley': 'MEDLEY',
  'lag medley': 'MEDLEY',
  medley: 'MEDLEY',
  im: 'MEDLEY',
  med: 'MEDLEY'
};

const genderMap: Record<string, 'M' | 'F' | 'X'> = {
  herrer: 'M',
  damer: 'F',
  mixed: 'X'
};

const poolMap: Record<string, 'SCM' | 'LCM'> = {
  '25m': 'SCM',
  '50m': 'LCM'
};

const cityToNationMap = cities as Record<string, { country: string; nation: string }>;

const canonicalCityMap = new Map<string, string>(
  Object.entries(cityToNationMap).map(([cityName, meta]) => [cityName.trim().toLowerCase(), meta.nation])
);

export const unknownCityIssuePrefix = 'Unknown city:';

export const isBlockingCsvRecordIssue = (issue: string) => !issue.startsWith(`${unknownCityIssuePrefix} `);

const resolveNationFromCity = (city: string): string | null => {
  const trimmedCity = normalizeField(city);
  if (!trimmedCity) {
    return null;
  }

  const exact = cityToNationMap[trimmedCity]?.nation;
  if (exact) {
    return exact;
  }

  return canonicalCityMap.get(trimmedCity.toLowerCase()) ?? null;
};

const normalizeField = (value: string | undefined) => (value ?? '').trim();

const extractEventDescriptorFromFirstColumn = (value: string): string => {
  const trimmed = normalizeField(value);
  if (!trimmed) {
    return '';
  }

  const [eventPart] = trimmed.split(',');
  return normalizeField(eventPart);
};

const normalizeStrokeKey = (value: string): { strokeKey: string; relayHint: boolean } => {
  const key = value.trim().toLowerCase();
  const relayHint = /lag\s+medley/.test(key);

  if (/individuell\s+medley/.test(key)) {
    return { strokeKey: 'individuell medley', relayHint: false };
  }

  if (relayHint) {
    return { strokeKey: 'lag medley', relayHint: true };
  }

  return { strokeKey: key, relayHint: false };
};

const parseDistanceAndStroke = (value: string): { relayCount: number; distance: number | null; stroke: string; issues: string[] } => {
  const trimmed = normalizeField(value);
  if (!trimmed) {
    return { relayCount: 1, distance: null, stroke: '', issues: ['Distance/event column is missing'] };
  }

  const relayMatch = trimmed.match(/^(\d+)\s*[x*]\s*(\d+)\s*m?\s*(.+)$/i);
  if (relayMatch) {
    const normalized = normalizeStrokeKey(relayMatch[3]);
    const stroke = strokeMap[normalized.strokeKey] ?? '';
    const issues = stroke ? [] : [`Unknown stroke "${relayMatch[3].trim()}"`];
    return {
      relayCount: Number(relayMatch[1]),
      distance: Number(relayMatch[2]),
      stroke,
      issues
    };
  }

  const singleMatch = trimmed.match(/^(\d+)\s*m?\s*(.+)$/i);
  if (!singleMatch) {
    return { relayCount: 1, distance: null, stroke: '', issues: [`Could not parse distance/event "${trimmed}"`] };
  }

  const normalized = normalizeStrokeKey(singleMatch[2]);
  const stroke = strokeMap[normalized.strokeKey] ?? '';
  const issues = stroke ? [] : [`Unknown stroke "${singleMatch[2].trim()}"`];

  return {
    relayCount: normalized.relayHint ? 4 : 1,
    distance: Number(singleMatch[1]),
    stroke,
    issues
  };
};

const parseRecordTime = (value: string): { raw: string; lenex: string | null; issues: string[] } => {
  const raw = normalizeField(value);
  if (!raw) {
    return { raw, lenex: null, issues: ['Time is missing'] };
  }

  const minuteSecondMatch = raw.match(/^(\d+)\.(\d{1,2}),(\d{1,2})$/);
  if (minuteSecondMatch) {
    const minutes = Number(minuteSecondMatch[1]);
    const seconds = Number(minuteSecondMatch[2]);
    const hundredths = minuteSecondMatch[3].padEnd(2, '0').slice(0, 2);
    if (seconds >= 60) {
      return { raw, lenex: null, issues: [`Invalid seconds value in time "${raw}"`] };
    }
    return {
      raw,
      lenex: `00:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${hundredths}`,
      issues: []
    };
  }

  const secondMatch = raw.match(/^(\d{1,2}),(\d{1,2})$/);
  if (secondMatch) {
    const seconds = Number(secondMatch[1]);
    const hundredths = secondMatch[2].padEnd(2, '0').slice(0, 2);
    return {
      raw,
      lenex: `00:00:${String(seconds).padStart(2, '0')}.${hundredths}`,
      issues: []
    };
  }

  return { raw, lenex: null, issues: [`Unsupported time format "${raw}"`] };
};

const parseRecordDate = (value: string): { value: string | null; issues: string[] } => {
  const raw = normalizeField(value);
  if (!raw) {
    return { value: null, issues: ['Date is missing'] };
  }

  const unknownDayAndMonthMatch = raw.match(/^00\.00\.(\d{4})$/);
  if (unknownDayAndMonthMatch) {
    return { value: `${unknownDayAndMonthMatch[1]}-01-01`, issues: [] };
  }

  const match = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) {
    return { value: null, issues: [`Unsupported date format "${raw}"`] };
  }

  const dd = Number(match[1]);
  const mm = Number(match[2]);
  const yyyy = Number(match[3]);

  if (dd < 1 || dd > 31 || mm < 1 || mm > 12) {
    return { value: null, issues: [`Invalid date value "${raw}"`] };
  }

  return { value: `${yyyy}-${match[2]}-${match[1]}`, issues: [] };
};

export const parseMedleyRecordsCsv = (content: string): CsvRecordParseResult => {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    throw new Error('CSV file is empty.');
  }

  const rows: CsvRecordRow[] = [];

  for (let index = 1; index < lines.length; index += 1) {
    const sourceLine = lines[index];
    const columns = sourceLine.split(';');

    const eventColumn = extractEventDescriptorFromFirstColumn(columns[0]) || normalizeField(columns[1]);
    const timeColumn = normalizeField(columns[2]);
    const swimmerName = normalizeField(columns[4]);
    const clubName = normalizeField(columns[5]);
    const dateColumn = normalizeField(columns[6]);
    const place = normalizeField(columns[7]);
    const genderColumn = normalizeField(columns[8]).toLowerCase();
    const poolColumn = normalizeField(columns[9]).toLowerCase();
    const paraClassRaw = normalizeField(columns[10]).toUpperCase();

    const distanceAndStroke = parseDistanceAndStroke(eventColumn);
    const timeInfo = parseRecordTime(timeColumn);
    const dateInfo = parseRecordDate(dateColumn);
    const gender = genderMap[genderColumn] ?? '';
    const poolCourse = poolMap[poolColumn] ?? null;
    const meetNation = resolveNationFromCity(place);

    const issues: string[] = [...distanceAndStroke.issues, ...timeInfo.issues, ...dateInfo.issues];

    if (!swimmerName) {
      issues.push('Swimmer name is missing');
    }

    if (!clubName) {
      issues.push('Club is missing');
    }

    if (!place) {
      issues.push('Place is missing');
    } else if (!meetNation) {
      issues.push(`${unknownCityIssuePrefix} ${place}`);
    }

    if (!gender) {
      issues.push(`Unknown gender "${normalizeField(columns[8])}"`);
    }

    if (!poolCourse) {
      issues.push(`Unknown pool length "${normalizeField(columns[9])}"`);
    }

    const paraClass = paraClassRaw || null;
    if (paraClass && !/^(S|SB|SM)([1-9]|1[0-4])$/.test(paraClass)) {
      issues.push(`Invalid para class "${paraClassRaw}"`);
    }

    rows.push({
      lineNumber: index + 1,
      eventText: eventColumn,
      relayCount: distanceAndStroke.relayCount,
      distance: distanceAndStroke.distance,
      stroke: distanceAndStroke.stroke,
      recordTimeRaw: timeInfo.raw,
      recordTimeLenex: timeInfo.lenex,
      swimmerName,
      clubName,
      recordDate: dateInfo.value,
      place,
      meetNation,
      gender,
      poolCourse,
      paraClass,
      issues
    });
  }

  return { rows };
};
