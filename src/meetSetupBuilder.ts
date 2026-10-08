import { FORBIDDEN_REGISTRATION_ROUNDS } from './lenexConstants';
import { parseLenexMeet } from './lenexParser';
import type { LenexEvent, LenexMeetSummary } from './types';
import { formatXmlWithIndentation, parseXmlDocument } from './xmlUtils';

export const competitionTypes = [
  { id: '4', label: 'Nasjonalt stevne m/internasjonal deltagelse' },
  { id: '15', label: 'Krets/region for 10 år oe. u/kval' },
  { id: '6', label: 'Uapprobert stevne' }
] as const;

export type MeetSetupOptions = {
  nsfMeetId: string;
  competitionTypeId: string;
  oldestJuniorAge: number;
  flatFeeAgeLimit: number;
  flatFee: number;
  individualFee: number;
  relayFee: number;
  individualLateFee: number | null;
  relayLateFee: number | null;
  entryDeadline: string;
  lanes: number;
};

export type MeetSetupEvent = {
  event: LenexEvent;
  sessionNumber: string;
  minimumAge: number | null;
  skipped: boolean;
};

export type MeetSetupSource = {
  summary: LenexMeetSummary;
  events: MeetSetupEvent[];
  year: number;
  organizer: string;
  individualFee: number | null;
  relayFee: number | null;
  entryDeadline: string;
  lanes: string;
  sessionTimes: Record<string, string>;
};

const strokeNames: Record<string, string> = {
  FREE: 'FREESTYLE', BACK: 'BACKSTROKE', BREAST: 'BREASTSTROKE',
  FLY: 'BUTTERFLY', MEDLEY: 'INDIVIDUALMEDLEY'
};

export const parseMeetSetupSource = (xml: string): MeetSetupSource => {
  const doc = parseXmlDocument(xml, 'The uploaded file is not valid XML.');
  if (doc.querySelectorAll('LENEX > MEETS > MEET').length !== 1) {
    throw new Error('Upload a Lenex file containing exactly one meet.');
  }
  const meet = doc.querySelector('LENEX > MEETS > MEET')!;
  const summary = parseLenexMeet(xml);
  const ageDate = meet.querySelector(':scope > AGEDATE');
  if (ageDate && ageDate.getAttribute('type') !== 'YEAR') {
    throw new Error('Only calendar-year age groups (AGEDATE type YEAR) can be converted to birth-year classes.');
  }
  const year = Number((ageDate?.getAttribute('value') || summary.sessions[0]?.date || '').slice(0, 4));
  if (!Number.isInteger(year) || year < 1900 || !summary.sessions.length) {
    throw new Error('The meet must have dated sessions and a valid age calculation year.');
  }
  const events = summary.sessions.flatMap((session) => session.events.map((event) => {
    const ages = event.ageGroups.map((group) => group.agemin).filter((age) => Number.isInteger(age) && age >= 0);
    return {
      event, sessionNumber: session.number,
      minimumAge: ages.length ? Math.min(...ages) : null,
      skipped: FORBIDDEN_REGISTRATION_ROUNDS.has(event.round.toUpperCase())
    };
  }));
  const feeFor = (relay: boolean) => {
    const values = Array.from(meet.querySelectorAll(':scope > SESSIONS > SESSION > EVENTS > EVENT'))
      .filter((element) => (Number(element.querySelector('SWIMSTYLE')?.getAttribute('relaycount')) > 1) === relay)
      .filter((element) => !FORBIDDEN_REGISTRATION_ROUNDS.has((element.getAttribute('round') || '').toUpperCase()))
      .map((element) => element.querySelector(':scope > FEE')?.getAttribute('value'))
      .filter((value): value is string => value !== null && value !== undefined && value !== '')
      .map((value) => Number(value) / 100);
    if (!values.length) return relay ? 200 : 100;
    return values.every((value) => Number.isFinite(value) && value === values[0]) ? values[0] : null;
  };
  const startDate = summary.sessions.map((session) => session.date).sort()[0];
  const deadline = new Date(`${startDate}T00:00:00Z`);
  if (!Number.isFinite(deadline.getTime())) throw new Error('The meet must have a valid start date.');
  const daysSinceMonday = (deadline.getUTCDay() + 6) % 7;
  deadline.setUTCDate(deadline.getUTCDate() - daysSinceMonday - 5);
  return {
    summary, events, year, organizer: meet.getAttribute('organizer') || '',
    individualFee: feeFor(false), relayFee: feeFor(true),
    entryDeadline: deadline.toISOString().slice(0, 10),
    lanes: meet.querySelector(':scope > POOL')?.getAttribute('lanemax') || '',
    sessionTimes: Object.fromEntries(Array.from(meet.querySelectorAll(':scope > SESSIONS > SESSION'))
      .map((session) => [session.getAttribute('number') || '', session.getAttribute('daytime') || '']))
  };
};

export const buildMeetSetupXml = (source: MeetSetupSource, options: MeetSetupOptions): string => {
  if (!/^\d{1,10}$/.test(options.nsfMeetId.trim())) throw new Error('Enter a numeric NSF meet ID (up to 10 digits).');
  const competition = competitionTypes.find((item) => item.id === options.competitionTypeId);
  if (!competition) throw new Error('Select a competition type.');
  if (!Number.isInteger(options.lanes) || options.lanes < 1) throw new Error('Number of lanes must be a positive whole number.');
  for (const age of [options.oldestJuniorAge, options.flatFeeAgeLimit]) {
    if (!Number.isInteger(age) || age < 0 || age > 100) throw new Error('Ages must be whole numbers between 0 and 100.');
  }
  for (const fee of [options.flatFee, options.individualFee, options.relayFee, options.individualLateFee, options.relayLateFee]) {
    if (fee !== null && (!Number.isFinite(fee) || fee < 0)) throw new Error('Fees must be non-negative numbers.');
  }
  const compactDate = (date: string) => {
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      throw new Error(`Invalid date: ${date || '(missing)'}.`);
    }
    return date.replace(/-/g, '');
  };
  const dates = source.summary.sessions.map((session) => session.date).sort();
  const startDate = compactDate(dates[0]);
  const endDate = compactDate(dates[dates.length - 1]);
  const start = new Date(`${dates[0]}T00:00:00Z`);
  const end = new Date(`${dates[dates.length - 1]}T00:00:00Z`);
  const monthName = (date: Date) => date.toLocaleString('nb-NO', { month: 'long', timeZone: 'UTC' });
  const fullDate = (date: Date) => `${date.getUTCDate()}. ${monthName(date)} ${date.getUTCFullYear()}`;
  const meetDate = startDate === endDate ? fullDate(start)
    : start.getUTCFullYear() === end.getUTCFullYear() && start.getUTCMonth() === end.getUTCMonth()
      ? `${start.getUTCDate()}.-${end.getUTCDate()}. ${monthName(start)} ${start.getUTCFullYear()}`
      : `${fullDate(start)} - ${fullDate(end)}`;
  const course = source.summary.course;
  if (course !== 'SCM' && course !== 'LCM') throw new Error('Only 25m and 50m pools are supported.');
  const included = source.events.filter((row) => !row.skipped);
  if (!included.length) throw new Error('No registrable events found.');
  const seen = new Set<string>();
  for (const { event, minimumAge } of included) {
    if (!/^\d+$/.test(event.number) || seen.has(event.number)) throw new Error(`Invalid or duplicate registrable event number ${event.number}.`);
    seen.add(event.number);
    if (minimumAge === null) throw new Error(`Event ${event.number} has no minimum age. Add age groups in the Lenex file.`);
    if (!['PRE', 'TIM', ''].includes(event.round.toUpperCase())) throw new Error(`Unsupported round ${event.round} in event ${event.number}.`);
    if (!strokeNames[event.stroke] || !['M', 'F', 'X'].includes(event.gender)) throw new Error(`Unsupported stroke or gender in event ${event.number}.`);
    if (!Number.isInteger(event.distance) || event.distance <= 0 || !Number.isInteger(event.relayCount) || event.relayCount < 1) {
      throw new Error(`Invalid distance or relay count in event ${event.number}.`);
    }
  }
  const doc = document.implementation.createDocument('', 'MeetSetUp', null);
  const root = doc.documentElement;
  const add = (parent: Element, name: string, value: string | number) => {
    const element = doc.createElement(name);
    element.textContent = String(value);
    parent.appendChild(element);
    return element;
  };
  const minimumAge = Math.min(...included.map((row) => row.minimumAge!));
  const fields: Record<string, string | number> = {
    NsfVersion: 'MEETSETUP 1.0', Creator: 'Lenex tools', NSFMeetId: options.nsfMeetId.trim(),
    MeetName: source.summary.name, MeetDate: meetDate, MeetPlace: source.summary.city, PoolCategory: 'METERS',
    PoolLength: course === 'SCM' ? 25 : 50, StartWithLane: 1, Lanes: options.lanes,
    IndividualPrice: options.individualFee, TeamPrice: options.relayFee,
    OnePriceAll: options.flatFee,
    AustralianModel: 'TRUE', AustralianRank: 'PERCENT', AustralianWorldRecord: 'SAME', HCSingleAgeGroup: 'TRUE',
    WomenSenior: source.year - options.oldestJuniorAge - 1,
    MenSenior: source.year - options.oldestJuniorAge - 1,
    WomenJunior: source.year - minimumAge,
    MenJunior: source.year - minimumAge,
    WomenYoungestFinal: source.year - minimumAge,
    MenYoungestFinal: source.year - minimumAge,
    StartDate: startDate, EndDate: endDate,
    CompetitionTypeId: competition.id, CompetitionType: competition.label,
    Prizes: 3,
    GeneralSenior: 'TRUE', GeneralJunior: 'TRUE', GeneralHC: 'TRUE', PrimaryMasters: 'FALSE', GeneralMasters: 'TRUE'
  };
  if (source.organizer) fields.HostClub = source.organizer;
  if (options.entryDeadline) {
    fields.FinalEntryDate = compactDate(options.entryDeadline);
    const deadline = new Date(`${options.entryDeadline}T00:00:00Z`);
    const firstEntryDate = new Date(deadline.getTime());
    firstEntryDate.setUTCFullYear(deadline.getUTCFullYear() - 1);
    if (firstEntryDate.getUTCMonth() !== deadline.getUTCMonth()) firstEntryDate.setUTCDate(0);
    firstEntryDate.setUTCDate(firstEntryDate.getUTCDate() + 1);
    fields.FirstEntryDate = compactDate(firstEntryDate.toISOString().slice(0, 10));
    fields.LastEntryDate = compactDate(options.entryDeadline);
  }
  if (options.individualLateFee !== null) fields.IndividualPrice2 = options.individualLateFee;
  if (options.relayLateFee !== null) fields.TeamPrice2 = options.relayLateFee;
  Object.entries(fields).forEach(([name, value]) => add(root, name, value));
  const classes = add(root, 'OnePriceAllClasses', '');
  for (let age = minimumAge; age <= options.flatFeeAgeLimit; age += 1) add(classes, 'OnePriceAllClass', source.year - age);
  const sessions = add(root, 'Sessions', '');
  source.summary.sessions.forEach((session) => {
    const element = add(sessions, 'Session', '');
    add(element, 'SessionId', session.number);
    add(element, 'SessionName', session.name);
    add(element, 'SessionDate', compactDate(session.date));
    const time = source.sessionTimes[session.number];
    if (time) add(element, 'SessionStartTime', time.slice(0, 5).replace(':', ''));
  });
  const events = add(root, 'Events', '');
  included.forEach(({ event, sessionNumber, minimumAge }) => {
    const element = add(events, 'Event', '');
    element.setAttribute('ID', event.number);
    const eventFields: Record<string, string | number> = {
      EventNumber: event.number,
      EventDescription: `Øvelse ${event.number}. ${event.name || `${event.distance}m ${event.stroke}`}`,
      EventLength: event.relayCount > 1 ? `${event.relayCount}*${event.distance}` : event.distance,
      Eventart: event.stroke === 'MEDLEY' && event.relayCount > 1 ? 'MEDLEYRELAY' : strokeNames[event.stroke],
      Sex: event.gender === 'M' ? 'MALE' : event.gender === 'F' ? 'FEMALE' : 'MIXED',
      Senior: 'TRUE', Junior: 'FALSE', JuniorOlder: 'FALSE', JuniorYounger: 'FALSE',
      ...(event.relayCount > 1 ? {} : {
        Youngest: source.year - minimumAge!, Oldest: source.year - options.oldestJuniorAge
      }),
      EventPoolLength: course === 'SCM' ? 25 : 50, Date: compactDate(event.sessionDate),
      Sorting: event.round.toUpperCase() === 'PRE' ? 'PRELIMINARY' : 'FINAL',
      Round: event.round.toUpperCase() === 'PRE' ? 'PRELIMINARY' : 'DIRECTFINAL', SesId: sessionNumber,
      LenexEventId: event.eventId, LenexEventNo: event.number
    };
    Object.entries(eventFields).forEach(([name, value]) => add(element, name, value));
  });
  return formatXmlWithIndentation(`<?xml version="1.0" encoding="ISO-8859-1"?>\n${new XMLSerializer().serializeToString(doc)}`);
};

export const encodeMeetSetupXml = (xml: string): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(xml.length);
  for (let index = 0; index < xml.length; index += 1) {
    const code = xml.charCodeAt(index);
    if (code > 255) throw new Error('The meet contains characters that cannot be exported as ISO-8859-1.');
    bytes[index] = code;
  }
  return bytes;
};
