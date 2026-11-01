import { parseXmlDocument } from './xmlUtils';

export type PrizeEventSummary = {
  eventId: string;
  number: string;
  name: string;
  relayCount: number;
  participants: number;
  unassigned: number;
  prizes: number;
  paraParticipants: number;
  paraPrizes: number;
  medals: number;
};

export type PrizesReport = {
  meetName: string;
  events: PrizeEventSummary[];
  placingTotals: number[];
  totalPrizes: number;
  medalTotals: number[];
  totalMedals: number;
  participationPrizes: number;
  warnings: string[];
};

export type PrizesOptions = {
  minimumPrizeAge: number;
  participationMaximumAge: number;
  useParaClass: boolean;
};

const attribute = (element: Element | null, name: string) => (element?.getAttribute(name) ?? '').trim();

export const estimateLenexPrizes = (xml: string, options: Partial<PrizesOptions> = {}): PrizesReport => {
  const minimumPrizeAge = options.minimumPrizeAge ?? 11;
  const participationMaximumAge = options.participationMaximumAge ?? 12;
  const useParaClass = options.useParaClass ?? true;
  if (![minimumPrizeAge, participationMaximumAge].every((age) => Number.isInteger(age) && age >= 0)) {
    throw new Error('Award age limits must be non-negative whole years.');
  }
  const document = parseXmlDocument(xml, 'The uploaded file is not valid XML.');
  const meet = document.querySelector('LENEX > MEETS > MEET');
  if (!meet) throw new Error('Could not find a MEET element in this Lenex file.');
  const warnings = new Set<string>();
  const ageDate = meet.querySelector(':scope > AGEDATE');
  const reference = attribute(ageDate, 'value') || attribute(meet.querySelector(':scope > SESSIONS > SESSION'), 'date');
  const ageType = attribute(ageDate, 'type') || 'YEAR';
  if (!['YEAR', 'DATE'].includes(ageType)) throw new Error(`Unsupported age calculation: ${ageType}.`);
  const referenceYear = /^\d{4}(?:-|$)/.test(reference) ? Number(reference.slice(0, 4)) : NaN;
  if (!Number.isFinite(referenceYear)) throw new Error('Missing age reference date or session date.');
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (ageType === 'DATE' && !validDate(reference)) throw new Error('Invalid age reference date.');

  const definitions = Array.from(meet.querySelectorAll(':scope > SESSIONS > SESSION > EVENTS > EVENT')).map((element) => {
    const groups = Array.from(element.querySelectorAll(':scope > AGEGROUPS > AGEGROUP'));
    const summary: PrizeEventSummary = {
      eventId: attribute(element, 'eventid'), number: attribute(element, 'number'),
      name: attribute(element.querySelector(':scope > SWIMSTYLE'), 'name') ||
        `${attribute(element.querySelector(':scope > SWIMSTYLE'), 'distance')}m ${attribute(element.querySelector(':scope > SWIMSTYLE'), 'stroke')} ${attribute(element, 'gender')}`,
      relayCount: Math.max(1, Number(attribute(element.querySelector(':scope > SWIMSTYLE'), 'relaycount')) || 1),
      participants: 0, unassigned: 0, prizes: 0, medals: 0, paraParticipants: 0, paraPrizes: 0
    };
    return { summary, groups, counts: new Array<number>((groups.length || 1) + 1).fill(0) };
  });
  const byId = new Map(definitions.map((definition) => [definition.summary.eventId, definition]));
  if (definitions.some((definition) => !definition.summary.eventId) || byId.size !== definitions.length) {
    throw new Error('Every event must have a unique event ID.');
  }

  const entrants = meet.querySelectorAll(':scope > CLUBS > CLUB > ATHLETES > ATHLETE, :scope > CLUBS > CLUB > RELAYS > RELAY');
  const participationSwimmers = new Set<string | Element>();
  for (const entrant of entrants) {
    const handicap = entrant.querySelector(':scope > HANDICAP');
    const isPara = useParaClass && ['free', 'breast', 'medley'].some((classification) => Number(attribute(handicap, classification)) > 0);
    const birthdate = attribute(entrant, 'birthdate');
    let age = /^\d{4}(?:-|$)/.test(birthdate) ? referenceYear - Number(birthdate.slice(0, 4)) : NaN;
    if (ageType === 'DATE') {
      if (!validDate(birthdate)) age = NaN;
      else if (birthdate.slice(5) > reference.slice(5)) age--;
    }
    const seen = new Set<string>();
    for (const entry of entrant.querySelectorAll(':scope > ENTRIES > ENTRY')) {
      const eventId = attribute(entry, 'eventid');
      if (seen.has(eventId)) continue;
      seen.add(eventId);
      const definition = byId.get(eventId);
      if (!definition) {
        warnings.add(`Entries reference unknown event ${eventId || '(missing ID)'}. These entries are excluded.`);
        continue;
      }
      const { summary, groups, counts } = definition;
      summary.participants++;
      if (entrant.tagName === 'RELAY') {
        const explicitGroup = attribute(entry, 'agegroupid');
        const groupIndex = groups.findIndex((group) => explicitGroup && attribute(group, 'agegroupid') === explicitGroup);
        if (groups.length <= 1 || groupIndex >= 0) {
          counts[Math.max(0, groupIndex)]++;
          continue;
        }
        summary.unassigned++;
        warnings.add(`Event ${summary.number}: relay teams with unresolved age groups are excluded from medal totals.`);
        continue;
      }
      if (isPara && summary.relayCount === 1) summary.paraParticipants++;
      if (!Number.isFinite(age) || age < 0) {
        summary.unassigned++;
        warnings.add(`Event ${summary.number}: entries with missing or invalid ages are excluded from individual and participation prize totals.`);
        continue;
      }
      if (age <= participationMaximumAge) participationSwimmers.add(attribute(entrant, 'athleteid') || entrant);
      if (age < minimumPrizeAge) continue;
      if (isPara && summary.relayCount === 1) {
        counts[counts.length - 1]++;
        continue;
      }
      if (!groups.length) {
        counts[0]++;
        warnings.add(`Event ${summary.number}: no age groups defined; counted as one open age group.`);
        continue;
      }
      const explicitGroup = attribute(entry, 'agegroupid');
      const matches = groups.map((group, index) => ({ group, index })).filter(({ group }) => {
        if (explicitGroup && explicitGroup !== '-1') return attribute(group, 'agegroupid') === explicitGroup;
        const minimum = attribute(group, 'agemin');
        const maximum = attribute(group, 'agemax');
        return Number.isFinite(age) && age >= 0 && minimum !== '' && maximum !== '' &&
          (Number(minimum) === -1 || age >= Number(minimum)) &&
          (Number(maximum) === -1 || age <= Number(maximum));
      });
      if (!matches.length) {
        summary.unassigned++;
        warnings.add(`Event ${summary.number}: entries with missing or unmatched ages/age groups are excluded from prize totals.`);
      }
      for (const { index } of matches) counts[index]++;
    }
  }
  const placingTotals: number[] = [];
  const medalTotals = [0, 0, 0];
  for (const { summary, counts } of definitions) {
    for (const [index, participants] of counts.entries()) {
      if (summary.relayCount > 1) {
        const awardedTeams = Math.min(3, participants);
        summary.medals += awardedTeams * summary.relayCount;
        for (let placing = 0; placing < awardedTeams; placing++) medalTotals[placing] += summary.relayCount;
        continue;
      }
      const prizes = Math.ceil(participants / 3);
      summary.prizes += prizes;
      if (index === counts.length - 1) summary.paraPrizes += prizes;
      for (let placing = 0; placing < prizes; placing++) placingTotals[placing] = (placingTotals[placing] || 0) + 1;
    }
  }
  return {
    meetName: attribute(meet, 'name') || 'Unknown meet', events: definitions.map(({ summary }) => summary),
    placingTotals, totalPrizes: placingTotals.reduce((total, quantity) => total + quantity, 0),
    medalTotals, totalMedals: medalTotals.reduce((total, quantity) => total + quantity, 0),
    participationPrizes: participationSwimmers.size, warnings: [...warnings]
  };
};

export const prizeLabel = (placing: number): string => {
  const suffix = placing % 100 >= 11 && placing % 100 <= 13 ? 'th' :
    ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[placing % 10] || 'th';
  return `${placing}${suffix} prize`;
};
