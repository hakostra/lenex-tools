import { useMemo, useRef, useState } from 'react';
import FileUpload, { acceptedLenexFileTypes } from './FileUpload';
import { decodeXmlFileText, downloadFile, sanitizeFileName } from './fileUtils';
import { createResultFilterCsv, filterResults, formatSwimmerName, parseResultFilterData, resultFilterColumns } from './resultFilter';
import type { ResultFilterData } from './resultFilter';

const ResultFilterTool = () => {
  const [data, setData] = useState<ResultFilterData | null>(null);
  const [club, setClub] = useState('');
  const [minimumAge, setMinimumAge] = useState('9');
  const [alphabetical, setAlphabetical] = useState(false);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const uploadSequence = useRef(0);

  const loadFile = async (file: File) => {
    const sequence = ++uploadSequence.current;
    setData(null);
    setClub('');
    setError(null);
    setFileName(file.name);
    setLoading(true);
    try {
      const decoded = await decodeXmlFileText(file);
      if (sequence !== uploadSequence.current) return;
      setData(parseResultFilterData(decoded.content));
    } catch (caught) {
      if (sequence === uploadSequence.current) setError(caught instanceof Error ? caught.message : 'Could not read Lenex file.');
    } finally {
      if (sequence === uploadSequence.current) setLoading(false);
    }
  };

  const age = minimumAge.trim() === '' ? 0 : Number(minimumAge);
  const ageError = Number.isInteger(age) && age >= 0 ? null : 'Minimum age must be a non-negative whole number.';

  const report = useMemo(
    () => (data && !ageError ? filterResults(data, { club, minimumAge: age, alphabetical }) : null),
    [data, ageError, club, age, alphabetical]
  );

  const onDownload = () => {
    if (!data || !report || report.rowCount === 0) return;
    const csv = createResultFilterCsv(report, data.meetName);
    const baseName = [data.meetName, club || 'all-clubs', 'results'].map(sanitizeFileName).filter(Boolean).join('-');
    downloadFile(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }), `${baseName}.csv`);
  };

  return (
    <div className="result-filter-tool">
      <section className="card">
        <h1>Result filter</h1>
        <p className="small-text">Create a CSV result list for one club or all clubs, optionally leaving out young swimmers.</p>
        <FileUpload accept={acceptedLenexFileTypes} label="Lenex result file" onFileSelected={loadFile} />
        <div className="file-summary" aria-live="polite">
          <p><strong>File:</strong> {fileName || 'No file selected'}{loading ? ' (loading)' : ''}</p>
          {data && <p><strong>Meet:</strong> {data.meetName}</p>}
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </section>

      {data && <section className="card">
        <h2>Filters</h2>
        <div className="meetsetup-fields">
          <label className="field-row" htmlFor="result-filter-club">Club
            <select id="result-filter-club" className="form-control" value={club} onChange={(event) => setClub(event.target.value)}>
              <option value="">All clubs</option>
              {data.clubs.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label className="field-row" htmlFor="result-filter-age">Include only swimmers from age (years) and upwards
            <input id="result-filter-age" className="form-control" type="number" min="0" step="1"
              value={minimumAge} onChange={(event) => setMinimumAge(event.target.value)} />
          </label>
        </div>
        <label htmlFor="result-filter-alphabetical">
          <input id="result-filter-alphabetical" type="checkbox" checked={alphabetical}
            onChange={(event) => setAlphabetical(event.target.checked)} /> Sort alphabetically by last name (rank is left empty)
        </label>
        {ageError && <p className="error" role="alert">{ageError}</p>}
        {data.relayResults > 0 && <p className="small-text">Relay results ({data.relayResults}) are not included.</p>}
        {report && report.unknownAgeCount > 0 && <p className="warning">
          {report.unknownAgeCount} results belong to swimmers with unknown age and are included.</p>}
        {report && <p aria-live="polite"><strong>Result:</strong> {report.rowCount} rows in {report.blocks.length} events</p>}
        <div className="button-row">
          <button type="button" className="button" disabled={!report || report.rowCount === 0} onClick={onDownload}>
            Download results (CSV)
          </button>
        </div>
      </section>}

      {report && report.rowCount > 0 && <section className="card">
        <h2>Preview</h2>
        {report.blocks.map(({ event, rows }) => (
          <div className="table-wrap" key={event.id}>
            <table aria-label={`Event ${event.number} results`}>
              <caption className="event-caption">Event {event.number}: {event.name}</caption>
              <thead><tr>{resultFilterColumns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
              <tbody>{rows.map((row, index) => <tr key={index}>
                <td>{row.rank}</td><td>{formatSwimmerName(row)}</td><td>{row.birthYear}</td>
                <td>{row.club}</td><td>{row.ageGroup}</td><td>{row.time}</td><td>{row.status}</td>
              </tr>)}</tbody>
            </table>
          </div>
        ))}
      </section>}
    </div>
  );
};

export default ResultFilterTool;
