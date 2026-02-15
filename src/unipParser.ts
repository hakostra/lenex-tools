import type { UniPParseResult, UniPRow } from './types';

const strokeMap: Record<string, string> = {
  FR: 'FREE',
  BR: 'BREAST',
  RY: 'BACK',
  BU: 'FLY',
  IM: 'MEDLEY',
  LM: 'MEDLEY'
};

const genderMap: Record<string, string> = {
  M: 'M',
  K: 'F',
  X: 'X'
};

const ageGroupMap: Record<string, string> = {
  JR: 'Junior',
  SR: 'Senior',
  MA: 'Masters A',
  MB: 'Masters B',
  MC: 'Masters C',
  MD: 'Masters D',
  ME: 'Masters E',
  MF: 'Masters F',
  MG: 'Masters G',
  MH: 'Masters H',
  MI: 'Masters I',
  MJ: 'Masters J',
  MK: 'Masters K',
  ML: 'Masters L',
  MM: 'Masters M',
  MN: 'Masters N',
  MO: 'Masters O'
};

const relayClassMap: Record<string, string> = {
  JUNIOR: 'Junior',
  SENIOR: 'Senior',
  MASTERSA: 'Masters A',
  MASTERSB: 'Masters B',
  MASTERSC: 'Masters C',
  MASTERSD: 'Masters D',
  MASTERSE: 'Masters E',
  MASTERSF: 'Masters F',
  MASTERSG: 'Masters G',
  MASTERSH: 'Masters H',
  MASTERSI: 'Masters I',
  MASTERSJ: 'Masters J',
  MASTERSK: 'Masters K',
  MASTERSL: 'Masters L',
  MASTERSM: 'Masters M',
  MASTERSN: 'Masters N',
  MASTERSO: 'Masters O'
};

const normalizeField = (value: string | undefined) => (value ?? '').trim();

const parseParaClassPrefix = (value: string): 'S' | 'SB' | 'SM' | null => {
  const match = value.trim().toUpperCase().match(/^(S|SB|SM)(1[0-5]|[1-9])$/);
  if (!match) {
    return null;
  }

  const prefix = match[1];
  if (prefix === 'SB' || prefix === 'SM' || prefix === 'S') {
    return prefix;
  }

  return null;
};

const parseDistance = (value: string): { relayCount: number; distance: number | null; issues: string[] } => {
  const trimmed = normalizeField(value);
  const relayMatch = trimmed.match(/^(\d+)\s*\*\s*(\d+)$/);
  if (relayMatch) {
    return {
      relayCount: Number(relayMatch[1]),
      distance: Number(relayMatch[2]),
      issues: []
    };
  }

  if (/^\d+$/.test(trimmed)) {
    return {
      relayCount: 1,
      distance: Number(trimmed),
      issues: []
    };
  }

  return {
    relayCount: 1,
    distance: null,
    issues: ['Field 2 (distance) is invalid']
  };
};

const parseGenderAndAgeGroup = (value: string): { gender: string; ageGroupCode: string; issues: string[] } => {
  const trimmed = normalizeField(value).toUpperCase();
  if (!trimmed) {
    return { gender: '', ageGroupCode: '', issues: ['Field 7 (gender+agegroup) is missing'] };
  }

  const genderCode = trimmed[0];
  const gender = genderMap[genderCode] ?? '';
  const ageGroupCodeRaw = trimmed.slice(1);
  const ageGroupCode = /^\d{2}$/.test(ageGroupCodeRaw)
    ? `Born YY=${ageGroupCodeRaw}`
    : ageGroupMap[ageGroupCodeRaw] ?? ageGroupCodeRaw;

  const issues: string[] = [];
  if (!gender) {
    issues.push(`Unknown gender code "${genderCode}" in field 7`);
  }
  if (!ageGroupCodeRaw) {
    issues.push('Field 7 agegroup part is missing');
  }

  return { gender, ageGroupCode, issues };
};

const parseBirthYearOrClass = (
  value: string,
  isRelay: boolean,
  ageGroupFromField7: string
): { birthYearOrClass: string; issues: string[] } => {
  const trimmed = normalizeField(value).toUpperCase();
  if (!trimmed) {
    if (isRelay) {
      return { birthYearOrClass: ageGroupFromField7, issues: [] };
    }
    return { birthYearOrClass: '', issues: ['Field 8 (birth year/class) is missing'] };
  }

  if (/^\d{4}$/.test(trimmed)) {
    return { birthYearOrClass: trimmed, issues: [] };
  }

  if (relayClassMap[trimmed]) {
    return { birthYearOrClass: relayClassMap[trimmed], issues: [] };
  }

  if (/^(S|SB|SM)(1[0-5]|[1-9])$/.test(trimmed)) {
    return { birthYearOrClass: trimmed, issues: [] };
  }

  if (/^(S|SB|SM)\d+$/.test(trimmed)) {
    return {
      birthYearOrClass: trimmed,
      issues: [`Invalid para class "${trimmed}" (accepted: S1-S15, SB1-SB15, SM1-SM15)`]
    };
  }

  return { birthYearOrClass: trimmed, issues: [] };
};

const parsePoolCourse = (value: string): string | null => {
  const normalized = normalizeField(value).toUpperCase();
  if (normalized === 'K') {
    return 'SCM';
  }
  if (normalized === 'L') {
    return 'LCM';
  }
  return null;
};

export const parseUniP = (content: string): UniPParseResult => {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    throw new Error('UNI_p file is empty.');
  }

  const clubName = lines[0].trim();
  const rows: UniPRow[] = [];

  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const sourceLine = lines[lineIndex];
    const fields = sourceLine.split(',').map((part) => part ?? '');
    while (fields.length < 15) {
      fields.push('');
    }

    const eventNumberRaw = normalizeField(fields[0]);
    const distanceInfo = parseDistance(fields[1]);
    const strokeCode = normalizeField(fields[2]).toUpperCase();
    const stroke = strokeMap[strokeCode] ?? '';
    const lastName = normalizeField(fields[3]);
    const firstName = normalizeField(fields[4]);

    const genderInfo = parseGenderAndAgeGroup(fields[6]);
    const isRelay = distanceInfo.relayCount > 1;
    const birthInfo = parseBirthYearOrClass(fields[7], isRelay, genderInfo.ageGroupCode);
    const field7Raw = normalizeField(fields[6]).toUpperCase();

    const qualificationTime = normalizeField(fields[8]) || null;
    const qualificationDate = normalizeField(fields[10]) || null;
    const qualificationPlace = normalizeField(fields[11]) || null;
    const poolCourse = parsePoolCourse(fields[12]);

    const issues: string[] = [...distanceInfo.issues, ...genderInfo.issues, ...birthInfo.issues];

    const eventNumber = /^\d+$/.test(eventNumberRaw) ? Number(eventNumberRaw) : null;
    if (eventNumber === null) {
      issues.push('Field 1 (event number) is missing or invalid');
    }

    if (!stroke) {
      issues.push(`Field 3 (stroke) value "${strokeCode}" is unknown`);
    }

    if (!lastName) {
      issues.push('Field 4 (last name/team) is missing');
    }

    if (!isRelay && !firstName) {
      issues.push('Field 5 (first name) is missing for an individual event');
    }

    if (isRelay) {
      const mastersRelayClassMatch = field7Raw.match(/^[MKX]M(.)$/);
      if (mastersRelayClassMatch) {
        const mastersClassCode = mastersRelayClassMatch[1];
        const isAllowedMastersClass = /^[OA-G]$/.test(mastersClassCode);
        if (!isAllowedMastersClass) {
          issues.push(`Invalid masters relay class in field 7 "${field7Raw}" (allowed: O, A-G)`);
        }
      }
    }

    if (!isRelay && stroke) {
      const paraClassPrefix = parseParaClassPrefix(birthInfo.birthYearOrClass);
      if (paraClassPrefix) {
        const expectedPrefixByStroke: Record<string, 'S' | 'SB' | 'SM' | null> = {
          FR: 'S',
          BU: 'S',
          RY: 'S',
          BR: 'SB',
          IM: 'SM'
        };

        const expectedPrefix = expectedPrefixByStroke[strokeCode] ?? null;
        if (expectedPrefix && paraClassPrefix !== expectedPrefix) {
          issues.push(
            `Invalid para class "${birthInfo.birthYearOrClass}" for stroke ${strokeCode} (expected ${expectedPrefix} class)`
          );
        }
      }
    }

    rows.push({
      lineNumber: lineIndex + 1,
      eventNumber,
      relayCount: distanceInfo.relayCount,
      distance: distanceInfo.distance,
      strokeCode,
      stroke,
      lastName,
      firstName,
      gender: genderInfo.gender,
      ageGroupCode: genderInfo.ageGroupCode,
      birthYearOrClass: birthInfo.birthYearOrClass,
      qualificationTime,
      qualificationDate,
      qualificationPlace,
      poolCourse,
      issues
    });
  }

  return {
    clubName,
    rows
  };
};
