export type LenexEvent = {
  number: string;
  eventId: string;
  gender: string;
  round: string;
  name: string;
  stroke: string;
  relayCount: number;
  distance: number;
  sessionDate: string;
  ageGroups: Array<{
    agemin: number;
    agemax: number;
    name: string;
  }>;
};

export type LenexSession = {
  number: string;
  name: string;
  date: string;
  events: LenexEvent[];
};

export type LenexMeetSummary = {
  name: string;
  city: string;
  nation: string;
  course: string;
  sessions: LenexSession[];
  totalEvents: number;
};

export type UniPRow = {
  lineNumber: number;
  eventNumber: number | null;
  relayCount: number;
  distance: number | null;
  strokeCode: string;
  stroke: string;
  lastName: string;
  firstName: string;
  gender: string;
  ageGroupCode: string;
  birthYearOrClass: string;
  qualificationTime: string | null;
  qualificationDate: string | null;
  qualificationPlace: string | null;
  poolCourse: string | null;
  issues: string[];
};

export type UniPParseResult = {
  clubName: string;
  rows: UniPRow[];
};
