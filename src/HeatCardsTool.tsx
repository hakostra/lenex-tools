import { useMemo, useRef, useState } from 'react';
import FileUpload, { acceptedLenexFileTypes } from './FileUpload';
import { decodeXmlFileText, downloadFile, sanitizeFileName } from './fileUtils';
import { countHeatCardPages, createHeatCardsPdf, parseHeatCardData, selectHeatCards } from './heatCards';
import type { HeatCardData } from './heatCards';

const HeatCardsTool = () => {
  const [data, setData] = useState<HeatCardData | null>(null);
  const [selectedSessions, setSelectedSessions] = useState<Set<string>>(new Set());
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const uploadSequence = useRef(0);

  const loadFile = async (file: File) => {
    const sequence = ++uploadSequence.current;
    setData(null);
    setSelectedSessions(new Set());
    setError(null);
    setFileName(file.name);
    setLoading(true);
    try {
      const decoded = await decodeXmlFileText(file);
      if (sequence !== uploadSequence.current) return;
      const parsed = parseHeatCardData(decoded.content);
      setData(parsed);
      setSelectedSessions(new Set(parsed.sessions.filter((session) => session.seededEntries > 0).map((session) => session.key)));
    } catch (caught) {
      if (sequence === uploadSequence.current) setError(caught instanceof Error ? caught.message : 'Could not read Lenex file.');
    } finally {
      if (sequence === uploadSequence.current) setLoading(false);
    }
  };

  const cards = useMemo(() => (data ? selectHeatCards(data, selectedSessions) : []), [data, selectedSessions]);
  const cardCount = cards.length;

  const toggleSession = (key: string, checked: boolean) =>
    setSelectedSessions((previous) => {
      const next = new Set(previous);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });

  const onDownload = () => {
    if (!data || cards.length === 0) return;
    const bytes = createHeatCardsPdf(data, cards);
    downloadFile(new Blob([bytes], { type: 'application/pdf' }), `${sanitizeFileName(data.meetName) || 'meet'}-heat-cards.pdf`);
  };

  return (
    <div className="heat-cards-tool">
      <section className="card">
        <h1>Heat cards</h1>
        <p className="small-text">Print swimmer cards (2 x 4 per A4 page) listing seeded heats. Requires a Lenex entries file with seeded heats.</p>
        <FileUpload accept={acceptedLenexFileTypes} label="Lenex entries file with seeded heats" onFileSelected={loadFile} />
        <div className="file-summary" aria-live="polite">
          <p><strong>File:</strong> {fileName || 'No file selected'}{loading ? ' (loading)' : ''}</p>
          {data && <p><strong>Meet:</strong> {data.meetName}</p>}
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </section>

      {data && <section className="card">
        <h2>Sessions</h2>
        <fieldset className="heat-cards-sessions">
          <legend className="small-text">Include sessions</legend>
          {data.sessions.map((session) => <div key={session.key}>
            <label htmlFor={`heat-cards-session-${session.key}`}>
              <input id={`heat-cards-session-${session.key}`} type="checkbox" checked={selectedSessions.has(session.key)}
                disabled={session.seededEntries === 0}
                onChange={(event) => toggleSession(session.key, event.target.checked)} />{' '}
              Session {session.number}{session.name ? ` - ${session.name}` : ''}{session.date ? ` (${session.date})` : ''}
              {' '}· {session.seededEntries} seeded entries
            </label>
          </div>)}
        </fieldset>
        {data.unseededEntries > 0 && <p className="warning">
          {data.unseededEntries} individual entries have no seeded heat and are not included.</p>}
        {data.relayEntries > 0 && <p className="small-text">Relay entries ({data.relayEntries}) are not included on cards.</p>}
        {data.swimmers.length === 0 && <p className="warning">No seeded heats were found in this file.</p>}
        <p aria-live="polite"><strong>Cards:</strong> {cardCount} swimmers · {data ? countHeatCardPages(data, cards) : 0} pages (each club starts on a new page)</p>
        <div className="button-row">
          <button type="button" className="button" disabled={cardCount === 0} onClick={onDownload}>Download cards (PDF)</button>
        </div>
      </section>}
    </div>
  );
};

export default HeatCardsTool;
