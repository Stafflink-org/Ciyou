import { useState, type ReactNode } from 'react';
import { Download, FileSpreadsheet, FileText, Sheet as SheetIcon } from 'lucide-react';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger, toast } from '@golink/ui';
import { errorMessage } from '@/lib/firestore';

export type ExportFormat = 'csv' | 'xlsx' | 'pdf';

const FORMATS: Array<{ value: ExportFormat; label: string; hint: string; icon: ReactNode }> = [
  { value: 'pdf', label: 'Rapport PDF', hint: 'Mise en page prête à imprimer', icon: <FileText /> },
  { value: 'xlsx', label: 'Classeur Excel', hint: 'Montants numériques, filtres', icon: <FileSpreadsheet /> },
  { value: 'csv', label: 'Fichier CSV', hint: 'Séparateur « ; », tableur français', icon: <SheetIcon /> },
];

/** Menu d'export : CSV, Excel, PDF. `onExport` produit et télécharge le fichier. */
export function ExportMenu({
  onExport,
  disabled,
  label = 'Exporter',
  formats = ['pdf', 'xlsx', 'csv'],
  size = 'md',
}: {
  onExport: (format: ExportFormat) => Promise<void> | void;
  disabled?: boolean;
  label?: string;
  formats?: ExportFormat[];
  size?: 'sm' | 'md';
}) {
  const [pending, setPending] = useState<ExportFormat | null>(null);

  async function run(format: ExportFormat) {
    setPending(format);
    try {
      await onExport(format);
      toast.success('Export téléchargé.');
    } catch (error) {
      toast.error(errorMessage(error, 'L’export n’a pas pu être généré. Réessayez.'));
    } finally {
      setPending(null);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled || pending !== null}>
        <Button variant="secondary" size={size} leftIcon={<Download />} loading={pending !== null}>
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64">
        <DropdownMenuLabel>Format du fichier</DropdownMenuLabel>
        {FORMATS.filter((format) => formats.includes(format.value)).map((format) => (
          <DropdownMenuItem key={format.value} icon={format.icon} onSelect={() => void run(format.value)}>
            <span className="flex flex-col">
              <span className="text-fg">{format.label}</span>
              <span className="text-xs text-fg-subtle">{format.hint}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
