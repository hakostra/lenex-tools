import { sanitizeFileName } from './fileUtils';
import type { CsvRecordRow } from './types';
import { isBlockingCsvRecordIssue } from './csvRecordsParser';
import {
  applyAppConstructorMetadata,
  formatXmlWithIndentation,
  serializeXmlWithUtf8Declaration,
  setAttributes
} from './xmlUtils';

export type PoolCourse = 'SCM' | 'LCM';

export type RecordTypeGuess = {
  label: string;
  shortName: string;
  nation: string;
  ageMin: number;
  ageMax: number;
  typeValue: string;
};

export type RecordListPreviewItem = {
  key: string;
  gender: string;
  paraClass: string | null;
  handicap: string | null;
  listName: string;
  recordCount: number;
};

const strokeDisplayName: Record<string, string> = {
  FREE: 'Freestyle',
  BREAST: 'Breaststroke',
  BACK: 'Backstroke',
  FLY: 'Butterfly',
  MEDLEY: 'Medley'
};

const parseParaHandicap = (value: string): { classCode: string; handicap: string } | null => {
  const match = value.trim().toUpperCase().match(/^(S|SB|SM)([1-9]|1[0-4])$/);
  if (!match) {
    return null;
  }

  return {
    classCode: `${match[1]}${match[2]}`,
    handicap: match[2]
  };
};

const getGenderOrder = (gender: string) => {
  if (gender === 'F') {
    return 0;
  }
  if (gender === 'M') {
    return 1;
  }
  if (gender === 'X') {
    return 2;
  }
  return 9;
};

const getParaClassOrder = (classCode: string) => {
  if (/^S(\d+)$/.test(classCode)) {
    return 0;
  }
  if (/^SB(\d+)$/.test(classCode)) {
    return 1;
  }
  if (/^SM(\d+)$/.test(classCode)) {
    return 2;
  }
  return 9;
};

const formatParaClassLabel = (handicap: string) => `S${handicap}/SB${handicap}/SM${handicap}`;

type ParaRecordGroup = {
  gender: string;
  handicap: string;
  classCodes: Set<string>;
  rows: CsvRecordRow[];
};

const splitSwimmerName = (fullName: string): { firstname: string; lastname: string } => {
  const trimmed = fullName.trim();
  if (!trimmed) {
    return { firstname: '', lastname: '' };
  }

  if (trimmed.includes(',')) {
    const [last, first] = trimmed.split(',', 2).map((segment) => segment.trim());
    return { firstname: first ?? '', lastname: last ?? '' };
  }

  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return { firstname: '', lastname: parts[0] };
  }

  return {
    firstname: parts.slice(0, -1).join(' '),
    lastname: parts[parts.length - 1]
  };
};

const toSwimstyleName = (row: CsvRecordRow) => {
  const strokeName = strokeDisplayName[row.stroke] ?? row.stroke;
  if (!row.distance) {
    return row.eventText || strokeName;
  }

  if (row.relayCount > 1) {
    return `${row.relayCount}x${row.distance}m ${strokeName}`;
  }

  return `${row.distance}m ${strokeName}`;
};

export const guessRecordType = (rows: CsvRecordRow[]): RecordTypeGuess => {
  const hasParaClass = rows.some((row) => Boolean(row.paraClass));

  if (hasParaClass) {
    return {
      label: 'Norwegian record',
      shortName: 'NR',
      nation: 'NOR',
      ageMin: 11,
      ageMax: -1,
      typeValue: 'Norwegian record'
    };
  }

  return {
    label: 'Norwegian junior record',
    shortName: 'NJR',
    nation: 'NOR',
    ageMin: 11,
    ageMax: 18,
    typeValue: 'Norwegian junior record'
  };
};

const groupRowsByRecordList = (rows: CsvRecordRow[], poolCourse: PoolCourse) => {
  const sourceRows = rows.filter(
    (row) => row.poolCourse === poolCourse && !row.issues.some((issue) => isBlockingCsvRecordIssue(issue))
  );

  const regularRowsByGender = new Map<string, CsvRecordRow[]>();
  const paraRowsByGenderAndHandicap = new Map<string, ParaRecordGroup>();

  for (const row of sourceRows) {
    if (row.paraClass) {
      const parsedPara = parseParaHandicap(row.paraClass);
      const handicap = parsedPara?.handicap ?? row.paraClass;
      const classCode = parsedPara?.classCode ?? row.paraClass;
      const key = `${row.gender}|${handicap}`;

      const existing = paraRowsByGenderAndHandicap.get(key);
      if (!existing) {
        paraRowsByGenderAndHandicap.set(key, {
          gender: row.gender,
          handicap,
          classCodes: new Set([classCode]),
          rows: [row]
        });
      } else {
        existing.classCodes.add(classCode);
        existing.rows.push(row);
      }
      continue;
    }

    const existing = regularRowsByGender.get(row.gender) ?? [];
    existing.push(row);
    regularRowsByGender.set(row.gender, existing);
  }

  return {
    regularRowsByGender,
    paraRowsByGenderAndHandicap
  };
};

export const createRecordListPreview = ({
  rows,
  poolCourse,
  guess
}: {
  rows: CsvRecordRow[];
  poolCourse: PoolCourse;
  guess: RecordTypeGuess;
}): RecordListPreviewItem[] => {
  const { regularRowsByGender, paraRowsByGenderAndHandicap } = groupRowsByRecordList(rows, poolCourse);
  const preview: RecordListPreviewItem[] = [];

  for (const gender of ['F', 'M', 'X']) {
    const genderRows = regularRowsByGender.get(gender);
    if (!genderRows || genderRows.length === 0) {
      continue;
    }

    preview.push({
      key: `${gender}|regular`,
      gender,
      paraClass: null,
      handicap: null,
      listName: guess.label,
      recordCount: genderRows.length
    });
  }

  const paraGroups = Array.from(paraRowsByGenderAndHandicap.values()).sort((left, right) => {
    const genderDiff = getGenderOrder(left.gender) - getGenderOrder(right.gender);
    if (genderDiff !== 0) {
      return genderDiff;
    }

    return Number(left.handicap) - Number(right.handicap);
  });

  for (const group of paraGroups) {
    const paraClassLabel = formatParaClassLabel(group.handicap);

    preview.push({
      key: `${group.gender}|${group.handicap}`,
      gender: group.gender,
      paraClass: paraClassLabel,
      handicap: group.handicap,
      listName: guess.label,
      recordCount: group.rows.length
    });
  }

  return preview;
};

const createRecordElement = (doc: Document, row: CsvRecordRow, poolCourse: PoolCourse, recordNation: string): Element => {
  const recordElement = doc.createElement('RECORD');
  setAttributes(recordElement, {
    swimtime: row.recordTimeLenex
  });

  const swimstyleElement = doc.createElement('SWIMSTYLE');
  setAttributes(swimstyleElement, {
    distance: row.distance !== null ? String(row.distance) : null,
    stroke: row.stroke,
    name: toSwimstyleName(row),
    relaycount: String(row.relayCount)
  });
  recordElement.appendChild(swimstyleElement);

  if (row.relayCount > 1) {
    const relayElement = doc.createElement('RELAY');
    setAttributes(relayElement, {
      gender: row.gender,
      name: row.swimmerName || row.clubName
    });
    recordElement.appendChild(relayElement);
  } else {
    const { firstname, lastname } = splitSwimmerName(row.swimmerName);
    const athleteElement = doc.createElement('ATHLETE');
    setAttributes(athleteElement, {
      firstname,
      lastname,
      gender: row.gender,
      nation: recordNation
    });

    const clubElement = doc.createElement('CLUB');
    setAttributes(clubElement, {
      name: row.clubName
    });
    athleteElement.appendChild(clubElement);

    recordElement.appendChild(athleteElement);
  }

  const meetInfoElement = doc.createElement('MEETINFO');
  setAttributes(meetInfoElement, {
    city: row.place,
    course: poolCourse,
    date: row.recordDate,
    name: '',
    nation: row.meetNation
  });
  recordElement.appendChild(meetInfoElement);

  return recordElement;
};

export const buildRecordLenexXml = ({
  rows,
  poolCourse,
  producedDate,
  guess
}: {
  rows: CsvRecordRow[];
  poolCourse: PoolCourse;
  producedDate: string;
  guess: RecordTypeGuess;
}): string => {
  const doc = document.implementation.createDocument('', '', null);

  const lenex = doc.createElement('LENEX');
  doc.appendChild(lenex);
  applyAppConstructorMetadata(doc);

  const recordListsElement = doc.createElement('RECORDLISTS');
  lenex.appendChild(recordListsElement);

  const { regularRowsByGender, paraRowsByGenderAndHandicap } = groupRowsByRecordList(rows, poolCourse);

  let recordListId = 1;

  const createRecordList = ({
    gender,
    listName,
    handicap,
    listRows
  }: {
    gender: string;
    listName: string;
    handicap?: string;
    listRows: CsvRecordRow[];
  }) => {
    const recordList = doc.createElement('RECORDLIST');
    setAttributes(recordList, {
      recordlistid: String(recordListId),
      course: poolCourse,
      gender,
      handicap,
      name: listName,
      'wingrodan.abbreviation': guess.shortName,
      updated: producedDate
    });
    recordListId += 1;

    const ageGroup = doc.createElement('AGEGROUP');
    setAttributes(ageGroup, {
      agegroupid: '1',
      agemin: String(guess.ageMin),
      agemax: String(guess.ageMax)
    });
    recordList.appendChild(ageGroup);

    const recordsElement = doc.createElement('RECORDS');
    for (const row of listRows) {
      recordsElement.appendChild(createRecordElement(doc, row, poolCourse, guess.nation));
    }

    recordList.appendChild(recordsElement);
    recordListsElement.appendChild(recordList);
  };

  for (const gender of ['F', 'M', 'X']) {
    const genderRows = regularRowsByGender.get(gender);
    if (!genderRows || genderRows.length === 0) {
      continue;
    }

    createRecordList({
      gender,
      listName: guess.label,
      listRows: genderRows
    });
  }

  const paraGroups = Array.from(paraRowsByGenderAndHandicap.values()).sort((left, right) => {
    const genderDiff = getGenderOrder(left.gender) - getGenderOrder(right.gender);
    if (genderDiff !== 0) {
      return genderDiff;
    }

    return Number(left.handicap) - Number(right.handicap);
  });

  for (const group of paraGroups) {
    createRecordList({
      gender: group.gender,
      listName: guess.label,
      handicap: group.handicap,
      listRows: group.rows
    });
  }

  return formatXmlWithIndentation(serializeXmlWithUtf8Declaration(doc), '  ');
};

export const makeRecordExportFileName = ({
  guess,
  poolCourse,
  producedDate
}: {
  guess: RecordTypeGuess;
  poolCourse: PoolCourse;
  producedDate: string;
}) => {
  return `${sanitizeFileName(guess.label.toLowerCase())}-${poolCourse.toLowerCase()}-${producedDate}.lef`;
};
