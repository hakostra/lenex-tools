import { PdfDocument, fitText, measureText } from './simplePdf';
import { parseXmlDocument } from './xmlUtils';

export type HeatCardSession = {
  key: string;
  number: string;
  name: string;
  date: string;
  seededEntries: number;
};

export type HeatCardEntry = {
  sessionKey: string;
  eventNumber: string;
  eventName: string;
  heatNumber: string;
  lane: string;
};

export type HeatCardSwimmer = {
  athleteId: string;
  name: string;
  sortName: string;
  club: string;
  entries: HeatCardEntry[];
};

export type HeatCardData = {
  meetName: string;
  sessions: HeatCardSession[];
  swimmers: HeatCardSwimmer[];
  unseededEntries: number;
  relayEntries: number;
};

const attribute = (element: Element | null, name: string) => (element?.getAttribute(name) ?? '').trim();

export const parseHeatCardData = (xml: string): HeatCardData => {
  const document = parseXmlDocument(xml, 'The uploaded file is not valid XML.');
  const meet = document.querySelector('LENEX > MEETS > MEET');
  if (!meet) throw new Error('Could not find a MEET element in this Lenex file.');

  const sessions: HeatCardSession[] = [];
  const events = new Map<string, { sessionKey: string; order: number; number: string; name: string; heats: Map<string, string> }>();
  for (const [sessionIndex, sessionElement] of Array.from(meet.querySelectorAll(':scope > SESSIONS > SESSION')).entries()) {
    const key = String(sessionIndex);
    sessions.push({
      key,
      number: attribute(sessionElement, 'number') || String(sessionIndex + 1),
      name: attribute(sessionElement, 'name'),
      date: attribute(sessionElement, 'date'),
      seededEntries: 0
    });
    for (const eventElement of sessionElement.querySelectorAll(':scope > EVENTS > EVENT')) {
      const swimStyle = eventElement.querySelector(':scope > SWIMSTYLE');
      events.set(attribute(eventElement, 'eventid'), {
        sessionKey: key,
        order: events.size,
        number: attribute(eventElement, 'number'),
        name: attribute(swimStyle, 'name') || `${attribute(swimStyle, 'distance')}m ${attribute(swimStyle, 'stroke')}`.trim(),
        heats: new Map(
          Array.from(eventElement.querySelectorAll(':scope > HEATS > HEAT')).map((heat) => [attribute(heat, 'heatid'), attribute(heat, 'number')])
        )
      });
    }
  }
  const sessionsByKey = new Map(sessions.map((session) => [session.key, session]));

  const swimmers: HeatCardSwimmer[] = [];
  let unseededEntries = 0;
  for (const club of meet.querySelectorAll(':scope > CLUBS > CLUB')) {
    const clubName = attribute(club, 'name') || attribute(club, 'shortname');
    for (const athlete of club.querySelectorAll(':scope > ATHLETES > ATHLETE')) {
      const seen = new Set<string>();
      const entries: Array<HeatCardEntry & { order: number }> = [];
      for (const entry of athlete.querySelectorAll(':scope > ENTRIES > ENTRY')) {
        const eventId = attribute(entry, 'eventid');
        if (seen.has(eventId)) continue;
        seen.add(eventId);
        const event = events.get(eventId);
        const heatNumber = event?.heats.get(attribute(entry, 'heatid'));
        if (!event || !heatNumber) {
          unseededEntries++;
          continue;
        }
        sessionsByKey.get(event.sessionKey)!.seededEntries++;
        entries.push({
          order: event.order,
          sessionKey: event.sessionKey,
          eventNumber: event.number,
          eventName: event.name,
          heatNumber,
          lane: attribute(entry, 'lane')
        });
      }
      if (entries.length === 0) continue;
      entries.sort((a, b) => a.order - b.order);
      swimmers.push({
        athleteId: attribute(athlete, 'athleteid'),
        name: `${attribute(athlete, 'firstname')} ${attribute(athlete, 'lastname')}`.trim(),
        sortName: `${attribute(athlete, 'lastname')} ${attribute(athlete, 'firstname')}`.trim(),
        club: clubName,
        entries: entries.map(({ order: _order, ...rest }) => rest)
      });
    }
  }

  return {
    meetName: attribute(meet, 'name'),
    sessions,
    swimmers,
    unseededEntries,
    relayEntries: meet.querySelectorAll(':scope > CLUBS > CLUB > RELAYS > RELAY > ENTRIES > ENTRY').length
  };
};

export const selectHeatCards = (data: HeatCardData, sessionKeys: ReadonlySet<string>): HeatCardSwimmer[] =>
  data.swimmers
    .map((swimmer) => ({ ...swimmer, entries: swimmer.entries.filter((entry) => sessionKeys.has(entry.sessionKey)) }))
    .filter((swimmer) => swimmer.entries.length > 0)
    .sort((a, b) => a.club.localeCompare(b.club, 'nb') || a.sortName.localeCompare(b.sortName, 'nb'));

// Layout constants in PDF points (A4 portrait, 2 x 4 cards).
// Cards tile the whole page: cutting along the interior lines leaves every card with centered content.
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const COLUMNS = 2;
const ROWS = 4;
const CARD_WIDTH = PAGE_WIDTH / COLUMNS;
const CARD_HEIGHT = PAGE_HEIGHT / ROWS;
const PADDING = 16;
const MARK_LENGTH = 8;
const EDGE_MARK_INSET = 12;
const EDGE_MARK_LENGTH = 10;
const ROW_HEIGHT = 13;
const ROW_FONT_SIZE = 10;

const LABELS = { event: 'Event', heat: 'Heat', lane: 'Lane', card: 'card' };

type CardLine = { kind: 'session'; text: string } | { kind: 'entry'; entry: HeatCardEntry };

const buildLines = (swimmer: HeatCardSwimmer, sessions: Map<string, HeatCardSession>): CardLine[] => {
  const showSessions = new Set(swimmer.entries.map((entry) => entry.sessionKey)).size > 1;
  const lines: CardLine[] = [];
  let previous = '';
  for (const entry of swimmer.entries) {
    if (showSessions && entry.sessionKey !== previous) {
      const session = sessions.get(entry.sessionKey);
      lines.push({ kind: 'session', text: [session?.name, session?.date].filter(Boolean).join(' - ') || `Session ${session?.number ?? ''}` });
      previous = entry.sessionKey;
    }
    lines.push({ kind: 'entry', entry });
  }
  return lines;
};

const HEADER_OFFSET = PADDING + 26 + 16;
const FIRST_ROW_OFFSET = HEADER_OFFSET + ROW_HEIGHT + 1;
const LINES_PER_CARD = Math.floor((CARD_HEIGHT - FIRST_ROW_OFFSET - PADDING - 8) / ROW_HEIGHT);

type Card = { swimmer: HeatCardSwimmer; lines: CardLine[]; part: number; parts: number };

// Each club starts on a new page.
const paginateCards = (data: HeatCardData, swimmers: HeatCardSwimmer[]): Card[][] => {
  const sessions = new Map(data.sessions.map((session) => [session.key, session]));
  const pages: Card[][] = [];
  let previousClub: string | null = null;
  for (const swimmer of swimmers) {
    const lines = buildLines(swimmer, sessions);
    const parts = Math.ceil(lines.length / LINES_PER_CARD);
    for (let start = 0; start < lines.length; start += LINES_PER_CARD) {
      const card = { swimmer, lines: lines.slice(start, start + LINES_PER_CARD), part: start / LINES_PER_CARD + 1, parts };
      const lastPage = pages[pages.length - 1];
      if (!lastPage || lastPage.length >= COLUMNS * ROWS || swimmer.club !== previousClub) pages.push([card]);
      else lastPage.push(card);
      previousClub = swimmer.club;
    }
  }
  return pages;
};

export const countHeatCardPages = (data: HeatCardData, swimmers: HeatCardSwimmer[]): number =>
  paginateCards(data, swimmers).length;

export const createHeatCardsPdf = (data: HeatCardData, swimmers: HeatCardSwimmer[]): Uint8Array<ArrayBuffer> => {
  const pdf = new PdfDocument(PAGE_WIDTH, PAGE_HEIGHT);
  const sessions = new Map(data.sessions.map((session) => [session.key, session]));

  for (const pageCards of paginateCards(data, swimmers)) {
    pdf.addPage();
    // Crosses where four cards meet; short marks at the paper edges show where each cut starts and ends.
    for (let column = 1; column < COLUMNS; column++) {
      const x = column * CARD_WIDTH;
      for (let row = 1; row < ROWS; row++) {
        const y = PAGE_HEIGHT - row * CARD_HEIGHT;
        pdf.line(x - MARK_LENGTH, y, x + MARK_LENGTH, y);
        pdf.line(x, y - MARK_LENGTH, x, y + MARK_LENGTH);
      }
      pdf.line(x, EDGE_MARK_INSET, x, EDGE_MARK_INSET + EDGE_MARK_LENGTH);
      pdf.line(x, PAGE_HEIGHT - EDGE_MARK_INSET - EDGE_MARK_LENGTH, x, PAGE_HEIGHT - EDGE_MARK_INSET);
    }
    for (let row = 1; row < ROWS; row++) {
      const y = PAGE_HEIGHT - row * CARD_HEIGHT;
      pdf.line(EDGE_MARK_INSET, y, EDGE_MARK_INSET + EDGE_MARK_LENGTH, y);
      pdf.line(PAGE_WIDTH - EDGE_MARK_INSET - EDGE_MARK_LENGTH, y, PAGE_WIDTH - EDGE_MARK_INSET, y);
    }

    for (const [index, card] of pageCards.entries()) {
      const left = (index % COLUMNS) * CARD_WIDTH + PADDING;
      const top = PAGE_HEIGHT - Math.floor(index / COLUMNS) * CARD_HEIGHT;
      const innerWidth = CARD_WIDTH - 2 * PADDING;
      const right = left + innerWidth;

      const title = card.parts > 1 ? `${card.swimmer.name} (${LABELS.card} ${card.part}/${card.parts})` : card.swimmer.name;
      let titleSize = 14;
      while (titleSize > 10 && measureText(title, 'bold', titleSize) > innerWidth) titleSize--;
      pdf.text(left, top - PADDING - 12, fitText(title, 'bold', titleSize, innerWidth), 'bold', titleSize);
      pdf.text(left, top - PADDING - 26, fitText(card.swimmer.club, 'regular', 10, innerWidth), 'regular', 10);

      const headerY = top - HEADER_OFFSET;
      const heatRight = right - 40;
      const nameLeft = left + 34;
      pdf.text(left, headerY, LABELS.event, 'bold', 8);
      pdf.text(heatRight - measureText(LABELS.heat, 'bold', 8), headerY, LABELS.heat, 'bold', 8);
      pdf.text(right - measureText(LABELS.lane, 'bold', 8), headerY, LABELS.lane, 'bold', 8);

      for (const [lineIndex, line] of card.lines.entries()) {
        const y = top - FIRST_ROW_OFFSET - lineIndex * ROW_HEIGHT;
        if (line.kind === 'session') {
          pdf.text(left, y, fitText(line.text, 'bold', 8, innerWidth), 'bold', 8);
          continue;
        }
        const { entry } = line;
        pdf.text(left, y, entry.eventNumber, 'regular', ROW_FONT_SIZE);
        pdf.text(nameLeft, y, fitText(entry.eventName, 'regular', ROW_FONT_SIZE, heatRight - nameLeft - 28), 'regular', ROW_FONT_SIZE);
        pdf.text(heatRight - measureText(entry.heatNumber, 'regular', ROW_FONT_SIZE), y, entry.heatNumber, 'regular', ROW_FONT_SIZE);
        pdf.text(right - measureText(entry.lane, 'regular', ROW_FONT_SIZE), y, entry.lane, 'regular', ROW_FONT_SIZE);
      }

      const footerSessions = [...new Set(card.lines.flatMap((line) => (line.kind === 'entry' ? [line.entry.sessionKey] : [])))]
        .map((key) => sessions.get(key))
        .map((session) => session?.name || `Session ${session?.number ?? ''}`.trim());
      const footer = [data.meetName, footerSessions.join(', ')].filter(Boolean).join(': ');
      pdf.text(left, top - CARD_HEIGHT + PADDING, fitText(footer, 'regular', 7, innerWidth), 'regular', 7);
    }
  }

  return pdf.toBytes();
};
