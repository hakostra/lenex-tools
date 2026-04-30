import { FORBIDDEN_REGISTRATION_ROUNDS } from './lenexConstants';
import type { LenexEvent, LenexMeetSummary, UniPRow } from './types';
import {
  applyAppConstructorMetadata,
  formatXmlWithIndentation,
  parseXmlDocument,
  serializeXmlWithUtf8Declaration,
  setAttributes
} from './xmlUtils';

type HandicapAttributeName = 'free' | 'breast' | 'medley';

export const inferFullYearFromAgeGroup = (ageGroupCode: string): string | null => {
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

export const formatYearClassCell = (row: UniPRow): string => {
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

export const getRowKey = (row: UniPRow) =>
  `${row.lineNumber}-${row.eventNumber ?? 'x'}-${row.lastName}-${row.firstName}`;

export const mergeIssues = (baseIssues: string[], validationIssues: string[]) =>
  Array.from(new Set([...baseIssues, ...validationIssues]));

export const countNonRegistrableEvents = (lenexSummary: LenexMeetSummary): number =>
  lenexSummary.sessions.reduce(
    (total, session) =>
      total +
      session.events.filter((event) => FORBIDDEN_REGISTRATION_ROUNDS.has(event.round.trim().toUpperCase())).length,
    0
  );

const inferBirthYear = (row: UniPRow): string | null => {
  if (/^\d{4}$/.test(row.birthYearOrClass)) {
    return row.birthYearOrClass;
  }

  return inferFullYearFromAgeGroup(row.ageGroupCode);
};

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

export const validateRowAgainstLenex = (
  row: UniPRow,
  eventsByNumber: Map<string, LenexEvent[]>,
  hasLenex: boolean
): string[] => {
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
    const allowedCandidateExists = compatibleCandidates.some(
      (event) => !FORBIDDEN_REGISTRATION_ROUNDS.has(event.round)
    );
    if (!allowedCandidateExists) {
      const warnedRounds = Array.from(new Set(compatibleCandidates.map((event) => event.round))).filter((round) =>
        FORBIDDEN_REGISTRATION_ROUNDS.has(round)
      );
      warnedRounds.forEach((round) => issues.push(`Registration for ${round}`));
    }

    const candidatesToCheckAge = compatibleCandidates.filter(
      (event) => !FORBIDDEN_REGISTRATION_ROUNDS.has(event.round)
    );
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

const findMatchingLenexEvent = (row: UniPRow, eventsByNumber: Map<string, LenexEvent[]>) => {
  if (row.eventNumber === null) {
    return null;
  }

  const candidates = eventsByNumber.get(String(row.eventNumber)) ?? [];
  return (
    candidates.find((event) => {
      const roundAllowed = !FORBIDDEN_REGISTRATION_ROUNDS.has(event.round);
      const relayMatches = event.relayCount === row.relayCount;
      const distanceMatches = event.distance === row.distance;
      const strokeMatches = row.stroke ? event.stroke === row.stroke : true;
      const genderMatches = row.gender ? event.gender === row.gender : true;
      return roundAllowed && relayMatches && distanceMatches && strokeMatches && genderMatches;
    }) ?? null
  );
};

export const sanitizeLenexXmlForEntries = (xml: string): string => {
  const doc = parseXmlDocument(xml, 'Could not parse Lenex file.');

  // Remove dynamic race data so exported entries are generated from clean meet definitions.
  doc.querySelectorAll('EVENT > RESULTS').forEach((resultsElement) => resultsElement.remove());
  doc.querySelectorAll('EVENT > HEATS').forEach((heatsElement) => heatsElement.remove());

  return serializeXmlWithUtf8Declaration(doc);
};

export const stripNonRegistrableEventsFromLenexXml = (xml: string): string => {
  const doc = parseXmlDocument(xml, 'Could not parse Lenex meet file for filtering.');

  doc.querySelectorAll('EVENT').forEach((eventElement) => {
    const round = (eventElement.getAttribute('round') ?? '').trim().toUpperCase();
    if (FORBIDDEN_REGISTRATION_ROUNDS.has(round)) {
      eventElement.remove();
    }
  });

  applyAppConstructorMetadata(doc);

  return formatXmlWithIndentation(serializeXmlWithUtf8Declaration(doc), '  ');
};

export const buildLenexEntriesXml = ({
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
  const doc = parseXmlDocument(sanitizedBaseXml, 'Could not parse Lenex meet file for export.');

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

  const athleteByKey = new Map<
    string,
    { athleteElement: Element; entriesElement: Element; handicapElement: Element | null }
  >();
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

  const xml = formatXmlWithIndentation(serializeXmlWithUtf8Declaration(doc), '  ');
  return { xml, skippedDuringBuild };
};
