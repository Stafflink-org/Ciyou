import { useEffect, useId, useMemo, useRef, useState, type DragEvent } from 'react';
import { FileText, ImageIcon, UploadCloud, X } from 'lucide-react';
import { cn } from '../lib/cn';
import { formatNumber } from '../lib/format';

export interface FileUploadProps {
  value: File[];
  onChange: (files: File[]) => void;
  /** Types acceptés, ex. "image/*,.pdf". */
  accept?: string;
  multiple?: boolean;
  /** Taille maximale par fichier, en octets. */
  maxSize?: number;
  maxFiles?: number;
  label?: string;
  hint?: string;
  disabled?: boolean;
  /** Appelé avec un message lorsqu'un fichier est refusé. */
  onReject?: (message: string) => void;
  className?: string;
  id?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${formatNumber(bytes / 1024, { decimals: true })} Ko`;
  return `${formatNumber(bytes / (1024 * 1024), { decimals: true })} Mo`;
}

function matchesAccept(file: File, accept?: string): boolean {
  if (!accept) return true;
  return accept.split(',').some((rule) => {
    const pattern = rule.trim().toLowerCase();
    if (!pattern) return false;
    if (pattern.startsWith('.')) return file.name.toLowerCase().endsWith(pattern);
    if (pattern.endsWith('/*')) return file.type.startsWith(pattern.slice(0, -1));
    return file.type === pattern;
  });
}

/** Aperçus d'images : URL objet créées et libérées avec la liste. */
function usePreviews(files: File[]): Map<File, string> {
  const previews = useMemo(() => {
    const map = new Map<File, string>();
    for (const file of files) if (file.type.startsWith('image/')) map.set(file, URL.createObjectURL(file));
    return map;
  }, [files]);
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);
  return previews;
}

/** Zone de dépôt de fichiers (glisser-déposer ou parcourir) avec aperçus. */
export function FileUpload({
  value,
  onChange,
  accept,
  multiple = false,
  maxSize,
  maxFiles,
  label = 'Glissez-déposez un fichier ou',
  hint,
  disabled,
  onReject,
  className,
  id,
}: FileUploadProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const previews = usePreviews(value);

  function addFiles(list: FileList | null) {
    if (!list || disabled) return;
    const accepted: File[] = [];
    for (const file of Array.from(list)) {
      if (!matchesAccept(file, accept)) {
        onReject?.(`« ${file.name} » : format non accepté.`);
      } else if (maxSize && file.size > maxSize) {
        onReject?.(`« ${file.name} » dépasse la taille maximale (${formatBytes(maxSize)}).`);
      } else {
        accepted.push(file);
      }
    }
    let next = multiple ? [...value, ...accepted] : accepted.slice(0, 1);
    if (maxFiles && next.length > maxFiles) {
      onReject?.(`${maxFiles} fichier${maxFiles > 1 ? 's' : ''} maximum.`);
      next = next.slice(0, maxFiles);
    }
    if (accepted.length > 0) onChange(next);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  }

  const showDropzone = multiple || value.length === 0;

  return (
    <div className={cn('relative flex flex-col gap-2.5', className)}>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        className="sr-only"
        onChange={(event) => {
          addFiles(event.target.files);
          event.target.value = '';
        }}
      />
      {showDropzone && (
        <label
          htmlFor={inputId}
          onDragOver={(event) => {
            event.preventDefault();
            if (!disabled) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={cn(
            'group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong bg-surface-2 px-6 py-7 text-center transition-colors',
            'hover:border-primary/60 hover:bg-primary-soft/30 [:focus-visible+&]:outline-2 [:focus-visible+&]:outline-ring',
            dragging && 'border-primary bg-primary-soft/50',
            disabled && 'pointer-events-none opacity-50',
          )}
        >
          <span
            className={cn(
              'grid size-10 place-items-center rounded-xl border border-border bg-surface text-fg-muted shadow-xs transition-transform',
              dragging && '-translate-y-0.5 text-primary',
            )}
          >
            <UploadCloud className="size-5" />
          </span>
          <span className="text-sm text-fg-muted">
            {label} <span className="font-semibold text-primary-soft-fg underline-offset-2 group-hover:underline">parcourez</span>
          </span>
          {(hint || maxSize) && (
            <span className="text-xs text-fg-subtle">
              {hint}
              {hint && maxSize ? ' · ' : ''}
              {maxSize ? `${formatBytes(maxSize)} max.` : ''}
            </span>
          )}
        </label>
      )}
      {value.length > 0 && (
        <ul className={cn('grid gap-2', multiple && 'sm:grid-cols-2')}>
          {value.map((file, index) => {
            const preview = previews.get(file);
            return (
              <li
                key={`${file.name}-${index}`}
                className="flex items-center gap-3 rounded-xl border border-border bg-surface p-2 pe-3 shadow-xs"
              >
                <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-surface-3 text-fg-subtle">
                  {preview ? (
                    <img src={preview} alt="" className="size-full object-cover" />
                  ) : file.type.startsWith('image/') ? (
                    <ImageIcon className="size-5" />
                  ) : (
                    <FileText className="size-5" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-fg">{file.name}</span>
                  <span className="font-mono text-2xs text-fg-subtle">{formatBytes(file.size)}</span>
                </span>
                <button
                  type="button"
                  aria-label={`Retirer ${file.name}`}
                  onClick={() => onChange(value.filter((_, i) => i !== index))}
                  className="grid size-7 place-items-center rounded-md text-fg-subtle hover:bg-danger-soft hover:text-danger-soft-fg"
                >
                  <X className="size-4" />
                </button>
              </li>
            );
          })}
          {!multiple && (
            <li>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="text-xs font-medium text-primary-soft-fg hover:underline"
              >
                Remplacer le fichier
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
