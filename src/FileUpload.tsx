import { useRef, useState } from 'react';

export const acceptedLenexFileTypes = '.lef,.xml,text/xml,application/xml';

type FileUploadProps = {
  accept: string;
  label: string;
  onFileSelected: (file: File) => void | Promise<void>;
  disabled?: boolean;
};

const FileUpload = ({ accept, label, onFileSelected, disabled = false }: FileUploadProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div
      className={`drop-zone ${dragging ? 'dragging' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files.item(0);
        if (file && !disabled) void onFileSelected(file);
      }}
    >
      <p>Drag and drop your {label} here</p>
      <p className="small-text">or</p>
      <button type="button" className="button" disabled={disabled} onClick={() => inputRef.current?.click()}>
        Choose file
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        aria-label={label}
        disabled={disabled}
        className="hidden-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void onFileSelected(file);
        }}
      />
    </div>
  );
};

export default FileUpload;