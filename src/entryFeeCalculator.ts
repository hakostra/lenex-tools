import { parseXmlDocument } from './xmlUtils';

export type SwimmerPaymentSummary = {
  athleteId: string;
  swimmerName: string;
  birthYear: number | null;
  entryCount: number;
  baseAmount: number;
  finalAmount: number;
  youthFlatFeeApplied: boolean;
};

export type ClubPaymentSummary = {
  clubName: string;
  swimmers: SwimmerPaymentSummary[];
  relays: Array<{
    relayName: string;
    entryCount: number;
    amount: number;
  }>;
  totalAmount: number;
};

export type LenexPaymentReport = {
  meetName: string;
  ageReferenceYear: number;
  youthAgeLimit: number;
  youthFlatFee: number;
  clubs: ClubPaymentSummary[];
  totalAmount: number;
  warnings: string[];
};

const getAttribute = (element: Element | null | undefined, name: string) => (element?.getAttribute(name) ?? '').trim();

const parseBirthYear = (athleteElement: Element): number | null => {
  const birthdate = getAttribute(athleteElement, 'birthdate');
  if (!birthdate) {
    return null;
  }

  const yearMatch = birthdate.match(/^(\d{4})/);
  if (!yearMatch) {
    return null;
  }

  const year = Number.parseInt(yearMatch[1], 10);
  return Number.isNaN(year) ? null : year;
};

const resolveAgeReferenceYear = (meetElement: Element): number => {
  const ageDateValue = getAttribute(meetElement.querySelector(':scope > AGEDATE'), 'value');
  const ageDateYear = ageDateValue.match(/^(\d{4})/)?.[1];
  if (ageDateYear) {
    return Number.parseInt(ageDateYear, 10);
  }

  const firstSessionDate = getAttribute(meetElement.querySelector(':scope > SESSIONS > SESSION'), 'date');
  const sessionYear = firstSessionDate.match(/^(\d{4})/)?.[1];
  if (sessionYear) {
    return Number.parseInt(sessionYear, 10);
  }

  return new Date().getUTCFullYear();
};

const toRoundedMajorCurrency = (minorCurrency: number): number => {
  return Math.round(minorCurrency / 100);
};

const buildEventFeeMap = (meetElement: Element, warnings: string[]): Map<string, number> => {
  const eventFeeById = new Map<string, number>();
  const eventElements = Array.from(meetElement.querySelectorAll(':scope > SESSIONS > SESSION > EVENTS > EVENT'));

  for (const eventElement of eventElements) {
    const eventId = getAttribute(eventElement, 'eventid');
    if (!eventId) {
      continue;
    }

    const feeRaw = getAttribute(eventElement.querySelector(':scope > FEE'), 'value');
    const parsedFee = Number.parseInt(feeRaw, 10);
    const feeInMinorCurrency = Number.isNaN(parsedFee) ? 0 : parsedFee;

    if (feeRaw && Number.isNaN(parsedFee)) {
      warnings.push(`Event ${eventId} has invalid fee value "${feeRaw}". Treated as 0.`);
    }

    const existing = eventFeeById.get(eventId);
    if (existing !== undefined && existing !== feeInMinorCurrency) {
      warnings.push(
        `Event ${eventId} has multiple fee values (${existing} and ${feeInMinorCurrency}). Using latest value.`
      );
    }

    eventFeeById.set(eventId, feeInMinorCurrency);
  }

  return eventFeeById;
};

const sumEntriesMinorCurrency = (
  entryElements: Element[],
  eventFeeById: Map<string, number>,
  warnings: string[],
  contextLabel: string
): number => {
  let amountMinorCurrency = 0;

  for (const entryElement of entryElements) {
    const eventId = getAttribute(entryElement, 'eventid');
    if (!eventId) {
      continue;
    }

    const fee = eventFeeById.get(eventId);
    if (fee === undefined) {
      warnings.push(`Missing fee definition for event ${eventId} used by ${contextLabel}. Treated as 0.`);
      continue;
    }

    amountMinorCurrency += fee;
  }

  return amountMinorCurrency;
};

export const calculateLenexPaymentReport = (
  xmlText: string,
  options: { youthAgeLimit: number; youthFlatFee: number }
): LenexPaymentReport => {
  const doc = parseXmlDocument(xmlText, 'The uploaded file is not valid XML.');

  const meetElement = doc.querySelector('LENEX > MEETS > MEET');
  if (!meetElement) {
    throw new Error('Could not find a MEET element in this Lenex file.');
  }

  const warnings: string[] = [];
  const ageReferenceYear = resolveAgeReferenceYear(meetElement);
  const eventFeeById = buildEventFeeMap(meetElement, warnings);

  const clubElements = Array.from(meetElement.querySelectorAll(':scope > CLUBS > CLUB'));

  const clubs = clubElements.map((clubElement): ClubPaymentSummary => {
    const clubName = getAttribute(clubElement, 'name') || 'Unknown club';
    const athleteElements = Array.from(clubElement.querySelectorAll(':scope > ATHLETES > ATHLETE'));

    const swimmers = athleteElements.map((athleteElement): SwimmerPaymentSummary => {
      const athleteId = getAttribute(athleteElement, 'athleteid');
      const firstName = getAttribute(athleteElement, 'firstname');
      const lastName = getAttribute(athleteElement, 'lastname');
      const swimmerName = [firstName, lastName].filter(Boolean).join(' ') || lastName || firstName || 'Unknown swimmer';

      const birthYear = parseBirthYear(athleteElement);
      const age = birthYear === null ? null : ageReferenceYear - birthYear;

      const entryElements = Array.from(athleteElement.querySelectorAll(':scope > ENTRIES > ENTRY'));
      const entryCount = entryElements.length;
      const baseAmountMinorCurrency = sumEntriesMinorCurrency(
        entryElements,
        eventFeeById,
        warnings,
        `swimmer ${swimmerName} in club ${clubName}`
      );

      const baseAmount = toRoundedMajorCurrency(baseAmountMinorCurrency);
      const youthFlatFeeApplied = entryCount > 0 && age !== null && age <= options.youthAgeLimit;
      const finalAmount = youthFlatFeeApplied ? options.youthFlatFee : baseAmount;

      return {
        athleteId,
        swimmerName,
        birthYear,
        entryCount,
        baseAmount,
        finalAmount,
        youthFlatFeeApplied
      };
    });

    const relayElements = Array.from(clubElement.querySelectorAll(':scope > RELAYS > RELAY'));
    const relays = relayElements.map((relayElement) => {
      const relayName = getAttribute(relayElement, 'name') || 'Unnamed relay';
      const relayEntryElements = Array.from(relayElement.querySelectorAll(':scope > ENTRIES > ENTRY'));
      const relayAmountMinorCurrency = sumEntriesMinorCurrency(
        relayEntryElements,
        eventFeeById,
        warnings,
        `relay ${relayName} in club ${clubName}`
      );

      return {
        relayName,
        entryCount: relayEntryElements.length,
        amount: toRoundedMajorCurrency(relayAmountMinorCurrency)
      };
    });

    const totalAmount =
      swimmers.reduce((sum, swimmer) => sum + swimmer.finalAmount, 0) + relays.reduce((sum, relay) => sum + relay.amount, 0);

    return {
      clubName,
      swimmers,
      relays,
      totalAmount
    };
  });

  return {
    meetName: getAttribute(meetElement, 'name') || 'Unknown meet',
    ageReferenceYear,
    youthAgeLimit: options.youthAgeLimit,
    youthFlatFee: options.youthFlatFee,
    clubs,
    totalAmount: clubs.reduce((sum, club) => sum + club.totalAmount, 0),
    warnings
  };
};

export const createLenexPaymentReportText = (report: LenexPaymentReport): string => {
  const lines: string[] = [];

  lines.push(`Meet: ${report.meetName}`);
  lines.push(`Age reference year: ${report.ageReferenceYear}`);
  lines.push(
    `Special rule: swimmers ${report.youthAgeLimit} years and younger pay ${report.youthFlatFee} (rounded major currency).`
  );
  lines.push('');

  for (const club of report.clubs) {
    lines.push(`Club: ${club.clubName}`);
    lines.push('Swimmer; Birth year; Amount');

    for (const swimmer of club.swimmers) {
      lines.push(`${swimmer.swimmerName}; ${swimmer.birthYear ?? '-'}; ${swimmer.finalAmount}`);
    }

    for (const relay of club.relays) {
      lines.push(`${relay.relayName}; -; ${relay.amount}`);
    }

    lines.push(`Club total: ${club.totalAmount}`);
    lines.push('');
  }

  lines.push(`Grand total: ${report.totalAmount}`);

  if (report.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    for (const warning of report.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  return lines.join('\n');
};

const escapeCsvField = (value: string | number | null | undefined): string => {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[,"\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
};

const toCsvRow = (fields: Array<string | number | null | undefined>): string => {
  return fields.map((field) => escapeCsvField(field)).join(',');
};

export const createLenexPaymentReportCsv = (report: LenexPaymentReport): string => {
  const lines: string[] = [];

  lines.push(toCsvRow(['Meet', report.meetName]));
  lines.push(toCsvRow(['Age reference year', report.ageReferenceYear]));
  lines.push(toCsvRow(['Youth age limit', report.youthAgeLimit]));
  lines.push(toCsvRow(['Youth flat fee', report.youthFlatFee]));
  lines.push('');

  lines.push(toCsvRow(['Club', 'Name', 'Birth year', 'Entries', 'Amount', 'Type']));

  for (const club of report.clubs) {
    for (const swimmer of club.swimmers) {
      lines.push(
        toCsvRow([club.clubName, swimmer.swimmerName, swimmer.birthYear ?? '', swimmer.entryCount, swimmer.finalAmount, 'Swimmer'])
      );
    }

    for (const relay of club.relays) {
      lines.push(toCsvRow([club.clubName, relay.relayName, '', relay.entryCount, relay.amount, 'Relay']));
    }

    lines.push(toCsvRow([club.clubName, 'Club total', '', '', club.totalAmount, 'Total']));
    lines.push('');
  }

  lines.push(toCsvRow(['', 'Grand total', '', '', report.totalAmount, 'Total']));

  if (report.warnings.length > 0) {
    lines.push('');
    lines.push(toCsvRow(['Warnings']));
    for (const warning of report.warnings) {
      lines.push(toCsvRow([warning]));
    }
  }

  return lines.join('\n');
};
