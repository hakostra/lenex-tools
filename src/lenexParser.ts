import type { LenexEvent, LenexMeetSummary, LenexSession } from './types';

const getRequiredAttribute = (element: Element, attributeName: string): string => {
  return element.getAttribute(attributeName) ?? '';
};

const parseEvent = (eventElement: Element, sessionDate: string): LenexEvent => {
  const swimStyle = eventElement.querySelector('SWIMSTYLE');
  const ageGroupElements = Array.from(eventElement.querySelectorAll(':scope > AGEGROUPS > AGEGROUP'));

  return {
    number: getRequiredAttribute(eventElement, 'number'),
    eventId: getRequiredAttribute(eventElement, 'eventid'),
    gender: getRequiredAttribute(eventElement, 'gender'),
    round: getRequiredAttribute(eventElement, 'round'),
    name: swimStyle ? getRequiredAttribute(swimStyle, 'name') : '',
    stroke: swimStyle ? getRequiredAttribute(swimStyle, 'stroke') : '',
    relayCount: Number(swimStyle ? getRequiredAttribute(swimStyle, 'relaycount') : 0),
    distance: Number(swimStyle ? getRequiredAttribute(swimStyle, 'distance') : 0),
    sessionDate,
    ageGroups: ageGroupElements.map((ageGroupElement) => ({
      agemin: Number(getRequiredAttribute(ageGroupElement, 'agemin')),
      agemax: Number(getRequiredAttribute(ageGroupElement, 'agemax')),
      name: getRequiredAttribute(ageGroupElement, 'name')
    }))
  };
};

const parseSession = (sessionElement: Element): LenexSession => {
  const eventElements = Array.from(sessionElement.querySelectorAll(':scope > EVENTS > EVENT'));

  return {
    number: getRequiredAttribute(sessionElement, 'number'),
    name: getRequiredAttribute(sessionElement, 'name'),
    date: getRequiredAttribute(sessionElement, 'date'),
    events: eventElements.map((eventElement) => parseEvent(eventElement, getRequiredAttribute(sessionElement, 'date')))
  };
};

export const parseLenexMeet = (xmlText: string): LenexMeetSummary => {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    throw new Error('The uploaded file is not valid XML.');
  }

  const meetElement = doc.querySelector('LENEX > MEETS > MEET');
  if (!meetElement) {
    throw new Error('Could not find a MEET element in this Lenex file.');
  }

  const sessionElements = Array.from(meetElement.querySelectorAll(':scope > SESSIONS > SESSION'));
  const sessions = sessionElements.map(parseSession);

  const totalEvents = sessions.reduce((sum, session) => sum + session.events.length, 0);

  return {
    name: getRequiredAttribute(meetElement, 'name'),
    city: getRequiredAttribute(meetElement, 'city'),
    nation: getRequiredAttribute(meetElement, 'nation'),
    course: getRequiredAttribute(meetElement, 'course'),
    sessions,
    totalEvents
  };
};
