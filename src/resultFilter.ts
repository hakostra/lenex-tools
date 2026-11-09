import { parseXmlDocument } from './xmlUtils';

export type ResultFilterEvent = {
  id: string;
  number: string;
  name: string;
};

type RankingRef = { groupIndex: number; groupName: string; order: number; place: number };

type ParsedResult = {
  order: number;
  eventId: string;
  resultId: string;
  club: string;
  lastName: string;
  firstName: string;
  birthYear: string;
  age: number | null;
  time: string;
  status: string;
};

export type ResultFilterData = {
  meetName: string;
  clubs: string[];
  events: ResultFilterEvent[];
  results: ParsedResult[];
  rankings: Map<string, RankingRef[]>;
  relayResults: number;
};

export type ResultFilterOptions = {
  club: string;
  minimumAge: number;
  alphabetical: boolean;
};

export type ResultFilterRow = {
  rank: string;
  lastName: string;
  firstName: string;
  birthYear: string;
  club: string;
  ageGroup: string;
  time: string;
  status: string;
};

export type ResultFilterBlock = { event: ResultFilterEvent; rows: ResultFilterRow[] };

export type ResultFilterReport = { blocks: ResultFilterBlock[]; rowCount: number; unknownAgeCount: number };

const attribute = (element: Element | null, name: string) => (element?.getAttribute(name) ?? '').trim();

// Swimmers who did not start have no result to list.
const excludedStatuses = new Set(['DNS', 'WDR']);

export const formatSwimTime = (value: string): string => {
  const match = /^(\d+):(\d+):(\d+)\.(\d+)$/.exec(value);
  if (!match) return '';
  const [hours, minutes, seconds, fraction] = [Number(match[1]), Number(match[2]), match[3], match[4]];
  if (hours === 0 && minutes === 0 && Number(seconds) === 0 && Number(fraction) === 0) return '';
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${seconds}.${fraction}`;
  if (minutes > 0) return `${minutes}:${seconds}.${fraction}`;
  return `${Number(seconds)}.${fraction}`;
};

export const parseResultFilterData = (xml: string): ResultFilterData => {
  const document = parseXmlDocument(xml, 'The uploaded file is not valid XML.');
  const meet = document.querySelector('LENEX > MEETS > MEET');
  if (!meet) throw new Error('Could not find a MEET element in this Lenex file.');

  const ageDate = meet.querySelector(':scope > AGEDATE');
  const reference = attribute(ageDate, 'value') || attribute(meet.querySelector(':scope > SESSIONS > SESSION'), 'date');
  const ageType = attribute(ageDate, 'type') || 'YEAR';
  const referenceYear = /^\d{4}/.test(reference) ? Number(reference.slice(0, 4)) : NaN;
  const calculateAge = (birthdate: string): number | null => {
    if (!/^\d{4}/.test(birthdate) || !Number.isFinite(referenceYear)) return null;
    const age = referenceYear - Number(birthdate.slice(0, 4));
    return ageType === 'DATE' && /^\d{4}-\d{2}-\d{2}$/.test(birthdate) && birthdate.slice(5) > reference.slice(5) ? age - 1 : age;
  };

  const events: ResultFilterEvent[] = [];
  const rankings = new Map<string, RankingRef[]>();
  for (const eventElement of meet.querySelectorAll(':scope > SESSIONS > SESSION > EVENTS > EVENT')) {
    const swimStyle = eventElement.querySelector(':scope > SWIMSTYLE');
    events.push({
      id: attribute(eventElement, 'eventid'),
      number: attribute(eventElement, 'number'),
      name: attribute(swimStyle, 'name') || `${attribute(swimStyle, 'distance')}m ${attribute(swimStyle, 'stroke')}`.trim()
    });
    for (const [groupIndex, group] of Array.from(eventElement.querySelectorAll(':scope > AGEGROUPS > AGEGROUP')).entries()) {
      for (const ranking of group.querySelectorAll(':scope > RANKINGS > RANKING')) {
        const resultId = attribute(ranking, 'resultid');
        const refs = rankings.get(resultId) ?? [];
        refs.push({
          groupIndex,
          groupName: attribute(group, 'name'),
          order: Number(attribute(ranking, 'order')) || 0,
          place: Number(attribute(ranking, 'place')) || -1
        });
        rankings.set(resultId, refs);
      }
    }
  }

  const clubs: string[] = [];
  const results: ParsedResult[] = [];
  for (const club of meet.querySelectorAll(':scope > CLUBS > CLUB')) {
    const clubName = attribute(club, 'name') || attribute(club, 'shortname');
    clubs.push(clubName);
    for (const athlete of club.querySelectorAll(':scope > ATHLETES > ATHLETE')) {
      const birthdate = attribute(athlete, 'birthdate');
      for (const result of athlete.querySelectorAll(':scope > RESULTS > RESULT')) {
        const status = attribute(result, 'status').toUpperCase();
        results.push({
          order: results.length,
          eventId: attribute(result, 'eventid'),
          resultId: attribute(result, 'resultid'),
          club: clubName,
          lastName: attribute(athlete, 'lastname'),
          firstName: attribute(athlete, 'firstname'),
          birthYear: /^\d{4}/.test(birthdate) ? birthdate.slice(0, 4) : '',
          age: calculateAge(birthdate),
          time: status ? '' : formatSwimTime(attribute(result, 'swimtime')),
          status
        });
      }
    }
  }
  if (results.length === 0) throw new Error('No individual results found. Upload a Lenex result file.');

  return {
    meetName: attribute(meet, 'name'),
    clubs: [...new Set(clubs)].sort((a, b) => a.localeCompare(b, 'nb')),
    events,
    results,
    rankings,
    relayResults: meet.querySelectorAll(':scope > CLUBS > CLUB > RELAYS > RELAY > RESULTS > RESULT').length
  };
};

type SortableRow = { row: ResultFilterRow; group: number; order: number; docOrder: number };

export const filterResults = (data: ResultFilterData, options: ResultFilterOptions): ResultFilterReport => {
  const rowsByEvent = new Map<string, SortableRow[]>();
  let unknownAgeCount = 0;

  for (const result of data.results) {
    if (options.club && result.club !== options.club) continue;
    if (excludedStatuses.has(result.status)) continue;
    if (result.age === null) unknownAgeCount++;
    else if (result.age < options.minimumAge) continue;

    const base = {
      lastName: result.lastName,
      firstName: result.firstName,
      birthYear: result.birthYear,
      club: result.club,
      time: result.time,
      status: result.status
    };
    const refs = data.rankings.get(result.resultId) ?? [];
    const rows = rowsByEvent.get(result.eventId) ?? [];
    rowsByEvent.set(result.eventId, rows);

    if (options.alphabetical) {
      const ageGroup = [...new Set(refs.map((ref) => ref.groupName))].join('; ');
      rows.push({ row: { ...base, rank: '', ageGroup }, group: 0, order: 0, docOrder: result.order });
    } else if (refs.length === 0) {
      rows.push({ row: { ...base, rank: '', ageGroup: '' }, group: Infinity, order: 0, docOrder: result.order });
    } else {
      for (const ref of refs) {
        rows.push({
          row: { ...base, rank: ref.place > 0 ? String(ref.place) : '', ageGroup: ref.groupName },
          group: ref.groupIndex,
          order: ref.order,
          docOrder: result.order
        });
      }
    }
  }

  const blocks: ResultFilterBlock[] = [];
  let rowCount = 0;
  for (const event of data.events) {
    const rows = rowsByEvent.get(event.id);
    if (!rows?.length) continue;
    rows.sort((a, b) =>
      options.alphabetical
        ? a.row.lastName.localeCompare(b.row.lastName, 'nb') || a.row.firstName.localeCompare(b.row.firstName, 'nb') || a.docOrder - b.docOrder
        : (a.group === b.group ? 0 : a.group < b.group ? -1 : 1) || a.order - b.order || a.docOrder - b.docOrder
    );
    blocks.push({ event, rows: rows.map(({ row }) => row) });
    rowCount += rows.length;
  }

  return { blocks, rowCount, unknownAgeCount };
};

export const formatSwimmerName = (row: Pick<ResultFilterRow, 'firstName' | 'lastName'>): string =>
  `${row.firstName} ${row.lastName}`.trim();

const escapeCsvField = (value: string): string => (/[,"\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

export const resultFilterColumns = ['Rank', 'Name', 'Born', 'Club', 'Age group', 'Time', 'Status'];

export const createResultFilterCsv = (report: ResultFilterReport): string => {
  const lines: string[] = [];
  for (const [index, { event, rows }] of report.blocks.entries()) {
    if (index > 0) lines.push('');
    lines.push([`Event ${event.number}`, event.name].map(escapeCsvField).join(','));
    lines.push(resultFilterColumns.map(escapeCsvField).join(','));
    for (const row of rows) {
      lines.push(
        [row.rank, formatSwimmerName(row), row.birthYear, row.club, row.ageGroup, row.time, row.status].map(escapeCsvField).join(',')
      );
    }
  }
  return lines.join('\n');
};
