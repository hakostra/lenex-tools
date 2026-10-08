import { useRef, useState } from 'react';
import { decodeXmlFileText, downloadFile } from './fileUtils';
import FileUpload, { acceptedLenexFileTypes } from './FileUpload';
import { buildMeetSetupXml, competitionTypes, encodeMeetSetupXml, parseMeetSetupSource } from './meetSetupBuilder';
import type { MeetSetupSource } from './meetSetupBuilder';

const initialSettings = {
  nsfMeetId: '', competitionTypeId: '4', oldestJuniorAge: '18',
  flatFeeAgeLimit: '10', flatFee: '100', individualFee: '', relayFee: '',
  individualLateFee: '', relayLateFee: '', entryDeadline: '', lanes: '8'
};

const MeetSetupTool = () => {
  const [source, setSource] = useState<MeetSetupSource | null>(null);
  const [fileName, setFileName] = useState('');
  const [encoding, setEncoding] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState(initialSettings);
  const uploadSequence = useRef(0);

  const update = (key: keyof typeof settings, value: string) => {
    setSettings((previous) => ({ ...previous, [key]: value }));
    setError(null);
  };

  const loadFile = async (file: File) => {
    const sequence = ++uploadSequence.current;
    setLoading(true);
    setSource(null);
    setError(null);
    setFileName(file.name);
    setEncoding('');
    try {
      const decoded = await decodeXmlFileText(file);
      const parsed = parseMeetSetupSource(decoded.content);
      if (sequence !== uploadSequence.current) return;
      setSource(parsed);
      setEncoding(decoded.encoding);
      setSettings((previous) => ({
        ...previous, nsfMeetId: '', entryDeadline: parsed.entryDeadline,
        individualFee: parsed.individualFee === null ? '' : String(parsed.individualFee),
        relayFee: parsed.relayFee === null ? '' : String(parsed.relayFee),
        individualLateFee: '', relayLateFee: ''
      }));
    } catch (caught) {
      if (sequence === uploadSequence.current) setError(caught instanceof Error ? caught.message : 'Could not read Lenex file.');
    } finally {
      if (sequence === uploadSequence.current) setLoading(false);
    }
  };

  const numberField = (key: keyof typeof settings, label: string, options: { optional?: boolean; value?: string; age?: boolean; whole?: boolean; min?: number } = {}) => (
    <label className="field-row" htmlFor={`meetsetup-${key}`}>
      {label}
      <input id={`meetsetup-${key}`} className="form-control" type="number" min={options.min ?? 0}
        max={options.age ? 100 : undefined} step={options.age || options.whole ? '1' : '0.01'}
        required={!options.optional} value={options.value ?? settings[key]}
        onChange={(event) => update(key, event.target.value)} />
    </label>
  );

  const doubledFee = (ordinary: string) => ordinary.trim() === '' ? '' : String(Number(ordinary) * 2);
  const individualLateFee = settings.individualLateFee || doubledFee(settings.individualFee);
  const relayLateFee = settings.relayLateFee || doubledFee(settings.relayFee);

  const download = () => {
    if (!source) return;
    setError(null);
    try {
      const numeric = (value: string, label: string) => {
        if (!value.trim()) throw new Error(`Enter ${label}.`);
        return Number(value);
      };
      const xml = buildMeetSetupXml(source, {
        nsfMeetId: settings.nsfMeetId, competitionTypeId: settings.competitionTypeId,
        oldestJuniorAge: numeric(settings.oldestJuniorAge, 'oldest age junior'),
        flatFeeAgeLimit: numeric(settings.flatFeeAgeLimit, 'flat fee age limit'),
        flatFee: numeric(settings.flatFee, 'flat fee'),
        individualFee: numeric(settings.individualFee, 'individual entry fee'),
        relayFee: source.events.some((row) => !row.skipped && row.event.relayCount > 1)
          ? numeric(settings.relayFee, 'relay entry fee') : Number(settings.relayFee || '0'),
        individualLateFee: individualLateFee ? Number(individualLateFee) : null,
        relayLateFee: relayLateFee ? Number(relayLateFee) : null,
        entryDeadline: settings.entryDeadline,
        lanes: numeric(settings.lanes, 'number of lanes')
      });
      downloadFile(
        new Blob([encodeMeetSetupXml(xml)], { type: 'application/xml;charset=iso-8859-1' }),
        `Meetsetup_${fileName.replace(/\.[^.]+$/, '')}.xml`
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not generate meetsetup.xml.');
    }
  };

  return (
    <div className="meetsetup-tool">
      <section className="card">
        <h1>Lenex to meetsetup.xml</h1>
        <FileUpload accept={acceptedLenexFileTypes} label="Lenex file" onFileSelected={loadFile} />
        <div className="file-summary" aria-live="polite">
          <p><strong>File:</strong> {fileName || 'No file selected'}{loading ? ' (loading)' : ''}</p>
          {encoding && <p><strong>Source encoding:</strong> {encoding}</p>}
          {source && <p><strong>Meet:</strong> {source.summary.name} | {source.summary.city} | {source.summary.course}</p>}
        </div>
      </section>

      <form className="card meetsetup-settings" onSubmit={(event) => { event.preventDefault(); download(); }}>
        <h2>Registration settings</h2>
        <fieldset className="meetsetup-group">
          <legend>General</legend>
          <div className="meetsetup-fields">
            <label className="field-row" htmlFor="meetsetup-nsfMeetId">NSF meet ID
              <input id="meetsetup-nsfMeetId" className="form-control" inputMode="numeric" pattern="[0-9]{1,10}"
                maxLength={10} required value={settings.nsfMeetId} onChange={(event) => update('nsfMeetId', event.target.value)} />
            </label>
            <label className="field-row meetsetup-wide" htmlFor="meetsetup-competitionTypeId">Competition type
              <select id="meetsetup-competitionTypeId" className="form-control" value={settings.competitionTypeId}
                onChange={(event) => update('competitionTypeId', event.target.value)}>
                {competitionTypes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <label className="field-row" htmlFor="meetsetup-entryDeadline">Entry deadline (YYYY-MM-DD)
              <input id="meetsetup-entryDeadline" className="form-control" type="text" placeholder="YYYY-MM-DD"
                pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}" maxLength={10} value={settings.entryDeadline}
                onChange={(event) => update('entryDeadline', event.target.value)} />
            </label>
            {numberField('lanes', 'Number of lanes', { whole: true, min: 1 })}
            {numberField('oldestJuniorAge', 'Oldest age junior', { age: true })}
          </div>
        </fieldset>
        <fieldset className="meetsetup-group">
          <legend>Fees</legend>
          <div className="meetsetup-fields">
            {numberField('individualFee', 'Individual entry fee (kr)')}
            {numberField('relayFee', 'Relay entry fee (kr)', { optional: !source?.events.some((row) => !row.skipped && row.event.relayCount > 1) })}
            {numberField('individualLateFee', 'Late individual fee (kr)', { optional: true, value: individualLateFee })}
            {numberField('relayLateFee', 'Late relay fee (kr)', { optional: true, value: relayLateFee })}
            {numberField('flatFeeAgeLimit', 'Flat fee age limit (years)', { age: true })}
            {numberField('flatFee', 'Flat fee per swimmer (kr)')}
          </div>
        </fieldset>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="button" type="submit" disabled={!source || loading}>Download meetsetup.xml</button>
      </form>

      {source && <section className="card">
        <h2>Event summary</h2>
        <p className="small-text"><strong>{source.events.filter((row) => !row.skipped).length}</strong> included |{' '}
          <strong>{source.events.filter((row) => row.skipped).length}</strong> skipped</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Session</th><th>No.</th><th>Event</th><th>Round</th><th>Minimum age</th><th>Birth years</th><th>Status</th></tr></thead>
            <tbody>{source.events.map((row, index) => <tr key={`${row.sessionNumber}-${row.event.eventId}-${index}`}>
              <td>{row.sessionNumber}</td><td>{row.event.number}</td><td>{row.event.name || `${row.event.distance}m ${row.event.stroke}`}</td>
              <td>{row.event.round || 'TIM'}</td><td>{row.minimumAge ?? 'Not specified'}</td>
              <td>{row.skipped ? '-' : row.event.relayCount > 1 ? 'Senior' : row.minimumAge === null ? 'Not specified' :
                `${source.year - Number(settings.oldestJuniorAge)}-${source.year - row.minimumAge}, senior`}</td>
              <td>{row.skipped ? 'Skipped (non-registrable round)' : 'Included'}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>}
    </div>
  );
};

export default MeetSetupTool;
