import { useMemo, useRef, useState } from 'react';
import FileUpload, { acceptedLenexFileTypes } from './FileUpload';
import { decodeXmlFileText } from './fileUtils';
import { estimateLenexPrizes, prizeLabel } from './prizesEstimator';

const PrizesEstimatorTool = () => {
  const [sourceXml, setSourceXml] = useState<string | null>(null);
  const [minimumPrizeAge, setMinimumPrizeAge] = useState('11');
  const [participationMaximumAge, setParticipationMaximumAge] = useState('12');
  const [useParaClass, setUseParaClass] = useState(true);
  const [fileName, setFileName] = useState('');
  const [encoding, setEncoding] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const uploadSequence = useRef(0);

  const calculation = useMemo(() => {
    try {
      if (!minimumPrizeAge.trim() || !participationMaximumAge.trim()) throw new Error('Enter both award age limits.');
      const options = { minimumPrizeAge: Number(minimumPrizeAge), participationMaximumAge: Number(participationMaximumAge) };
      if (!Object.values(options).every((age) => Number.isInteger(age) && age >= 0)) {
        throw new Error('Award age limits must be non-negative whole years.');
      }
      return { report: sourceXml ? estimateLenexPrizes(sourceXml, { ...options, useParaClass }) : null, error: null };
    } catch (caught) {
      return { report: null, error: caught instanceof Error ? caught.message : 'Could not estimate prizes.' };
    }
  }, [sourceXml, minimumPrizeAge, participationMaximumAge, useParaClass]);
  const { report } = calculation;

  const loadFile = async (file: File) => {
    const sequence = ++uploadSequence.current;
    setSourceXml(null);
    setError(null);
    setFileName(file.name);
    setEncoding('');
    setLoading(true);
    try {
      const decoded = await decodeXmlFileText(file);
      if (sequence !== uploadSequence.current) return;
      setSourceXml(decoded.content);
      setEncoding(decoded.encoding);
    } catch (caught) {
      if (sequence === uploadSequence.current) setError(caught instanceof Error ? caught.message : 'Could not read Lenex file.');
    } finally {
      if (sequence === uploadSequence.current) setLoading(false);
    }
  };

  return (
    <div className="prizes-tool">
      <section className="card">
        <h1>Prizes estimator</h1>
        <FileUpload accept={acceptedLenexFileTypes} label="Lenex entries file" onFileSelected={loadFile} />
        <div className="file-summary" aria-live="polite">
          <p><strong>File:</strong> {fileName || 'No file selected'}{loading ? ' (loading)' : ''}</p>
          {encoding && <p><strong>Source encoding:</strong> {encoding}</p>}
          {report && <p><strong>Meet:</strong> {report.meetName}</p>}
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </section>

      <section className="card">
        <h2>Award ages</h2>
        <div className="meetsetup-fields">
          <label className="field-row" htmlFor="prizes-minimum-age">Award placing prizes from age (years)
            <input id="prizes-minimum-age" className="form-control" type="number" min="0" step="1"
              value={minimumPrizeAge} onChange={(event) => setMinimumPrizeAge(event.target.value)} />
          </label>
          <label className="field-row" htmlFor="prizes-participation-age">Award participation prizes up to age (years)
            <input id="prizes-participation-age" className="form-control" type="number" min="0" step="1"
              value={participationMaximumAge} onChange={(event) => setParticipationMaximumAge(event.target.value)} />
          </label>
        </div>
        <label htmlFor="prizes-use-para-class">
          <input id="prizes-use-para-class" type="checkbox" checked={useParaClass}
            onChange={(event) => setUseParaClass(event.target.checked)} /> Use para class
        </label>
        {calculation.error && <p className="error" role="alert">{calculation.error}</p>}
      </section>

      {report && <>
        <section className="card">
          <h2>Individual prizes</h2>
          <p className="small-text">Swimmers aged {minimumPrizeAge} and older. Top one third per event and age group, rounded up.</p>
          <p><strong>Total individual prizes:</strong> {report.totalPrizes}</p>
          {useParaClass && <p className="small-text"><strong>Para prizes included:</strong>{' '}
            {report.events.reduce((total, event) => total + event.paraPrizes, 0)}</p>}
          <div className="table-wrap">
            <table aria-label="Individual prize totals">
              <thead><tr><th>Prize</th><th>Quantity</th></tr></thead>
              <tbody>{report.placingTotals.map((quantity, index) => <tr key={index}>
                <td>{prizeLabel(index + 1)}</td><td>{quantity}</td>
              </tr>)}</tbody>
            </table>
          </div>
          {!report.totalPrizes && <p className="small-text">No individual prizes estimated.</p>}
        </section>

        <section className="card">
          <h2>Participation prizes</h2>
          <p className="small-text">One prize per registered swimmer aged {participationMaximumAge} and younger, regardless of number of events.</p>
          <p aria-live="polite"><strong>Total participation prizes:</strong> {report.participationPrizes}</p>
        </section>

        <section className="card">
          <h2>Relay medals</h2>
          <p className="small-text">Top three teams per event and age group. One medal per swimmer on each awarded team.</p>
          <p><strong>Total relay medals:</strong> {report.totalMedals}</p>
          <div className="table-wrap">
            <table aria-label="Relay medal totals">
              <thead><tr><th>Medal</th><th>Quantity</th></tr></thead>
              <tbody>{['Gold', 'Silver', 'Bronze'].map((medal, index) => <tr key={medal}>
                <td>{medal}</td><td>{report.medalTotals[index]}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </section>

        {report.warnings.length > 0 && <section className="card" aria-label="Estimation warnings">
          <h2>Warnings</h2>
          {report.warnings.map((warning) => <p className="warning" key={warning}>{warning}</p>)}
        </section>}

        <section className="card">
          <h2>Event summary</h2>
          <div className="table-wrap">
            <table aria-label="Event award summary">
              <thead><tr><th>No.</th><th>Event</th><th>Participants</th><th>Individual prizes</th>
                {useParaClass && <th>Para prizes (included)</th>}<th>Relay medals</th><th>Unassigned</th></tr></thead>
              <tbody>{report.events.map((event) => <tr key={event.eventId}>
                <td>{event.number}</td><td>{event.name}</td>
                <td>{event.participants} {event.relayCount > 1 ? 'teams' : 'swimmers'}
                  {event.paraParticipants > 0 && ` (${event.paraParticipants} Para)`}</td>
                <td>{event.prizes}</td>{useParaClass && <td>{event.paraPrizes}</td>}
                <td>{event.medals}</td><td>{event.unassigned}</td>
              </tr>)}</tbody>
              <tfoot><tr><th colSpan={2}>Total</th>
                <td>{report.events.reduce((total, event) => total + event.participants, 0)} entries</td>
                <td>{report.totalPrizes}</td>
                {useParaClass && <td>{report.events.reduce((total, event) => total + event.paraPrizes, 0)}</td>}
                <td>{report.totalMedals}</td>
                <td>{report.events.reduce((total, event) => total + event.unassigned, 0)}</td>
              </tr></tfoot>
            </table>
          </div>
        </section>
      </>}
    </div>
  );
};

export default PrizesEstimatorTool;
