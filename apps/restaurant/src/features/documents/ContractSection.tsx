import { useEffect, useState } from 'react';
import { BookOpenText, FileSignature, PenLine, ShieldCheck } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  FormField,
  Input,
  Skeleton,
  formatDate,
} from '@golink/ui';
import type { LegalDocument, WithId } from '@golink/shared';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { errorMessage, toDate, useMutation } from '@/lib/firestore';
import { acceptPartnerContract } from '../parametres/kit/api';
import { LoadError, Notice } from '../parametres/kit/ui';
import { usePartnerContract, useRestaurantLegal } from './hooks';

/** Contrat partenaire : version en vigueur, acceptation (signature simple) par le propriétaire. */
export function ContractSection() {
  const { member } = useRestaurantAccess();
  const contract = usePartnerContract();
  const legal = useRestaurantLegal();
  const [reading, setReading] = useState<'read' | 'sign' | null>(null);
  const isOwner = member.role === 'owner';

  if (contract.error || legal.error) return <LoadError message={errorMessage(contract.error ?? legal.error)} />;
  if (contract.loading || legal.loading) return <Skeleton className="h-32 w-full rounded-xl" />;

  const latest = contract.latest;
  const accepted = legal.data?.partnerTermsVersion ?? null;
  const upToDate = Boolean(latest && accepted === latest.version);
  const acceptedAt = toDate(legal.data?.partnerTermsAcceptedAt);
  const effectiveAt = toDate(latest?.effectiveAt ?? latest?.publishedAt);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-5 p-5 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary-soft-fg">
            <FileSignature className="size-6" />
          </div>
          <div className="min-w-0">
            <p className="eyebrow">Contrat partenaire</p>
            <h2 className="mt-1 font-display text-lg font-semibold tracking-tight text-fg">{latest?.title.fr ?? 'Conditions partenaires'}</h2>
            {!latest ? (
              <p className="mt-1 text-sm text-fg-muted">Aucune version publiée pour votre pays : GoLink vous contactera.</p>
            ) : upToDate ? (
              <p className="mt-1 text-sm text-fg-muted">
                Version {latest.version} acceptée{acceptedAt ? ` le ${formatDate(acceptedAt)}` : ''}
                {legal.data?.partnerTermsSignatureName ? ` par ${legal.data.partnerTermsSignatureName}` : ''}.
              </p>
            ) : (
              <p className="mt-1 text-sm text-fg-muted">
                Version {latest.version}
                {effectiveAt ? `, en vigueur depuis le ${formatDate(effectiveAt)}` : ''}.{' '}
                {accepted ? `Vous avez accepté la version ${accepted}.` : 'Pas encore acceptée.'}
              </p>
            )}
            {latest?.changeSummary && !upToDate && <p className="mt-1 text-xs text-fg-subtle">Changements : {latest.changeSummary}</p>}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {latest && (upToDate ? <Badge tone="success">Signé</Badge> : <Badge tone="amber">À signer</Badge>)}
          {latest && (
            <Button variant="secondary" leftIcon={<BookOpenText />} onClick={() => setReading('read')}>
              Lire le contrat
            </Button>
          )}
          {latest && !upToDate && (
            <Button variant="primary" leftIcon={<PenLine />} disabled={!isOwner} onClick={() => setReading('sign')}>
              Lire et signer
            </Button>
          )}
        </div>
      </div>
      {latest && !upToDate && !isOwner && (
        <div className="border-t border-border bg-surface-2 px-5 py-3 text-xs text-fg-muted">Seul le propriétaire, représentant légal, peut signer le contrat.</div>
      )}
      {latest && <ContractDialog doc={latest} mode={reading} onClose={() => setReading(null)} />}
    </Card>
  );
}

function ContractDialog({ doc, mode, onClose }: { doc: WithId<LegalDocument>; mode: 'read' | 'sign' | null; onClose: () => void }) {
  const { restaurantId, restaurant } = useRestaurantAccess();
  const [agree, setAgree] = useState(false);
  const [signature, setSignature] = useState('');
  const sign = useMutation(acceptPartnerContract, { success: (r) => `Contrat version ${r.version} signé. Une preuve est conservée par GoLink.` });

  useEffect(() => {
    if (mode) {
      setAgree(false);
      setSignature('');
    }
  }, [mode]);

  const submit = async () => {
    const result = await sign.mutate({ restaurantId, documentId: doc.id, signatureName: signature.trim(), accept: true });
    if (result) onClose();
  };

  return (
    <Dialog open={mode !== null} onOpenChange={(open) => !open && !sign.loading && onClose()}>
      <DialogContent size="lg">
        <DialogHeader icon={<FileSignature />} title={doc.title.fr} description={`Version ${doc.version} · ${restaurant.countryId === 'LU' ? 'Luxembourg' : 'France'}`} />
        <DialogBody className="space-y-5">
          <div className="max-h-[45vh] overflow-y-auto rounded-xl border border-border bg-surface-2 p-5 text-sm leading-6 text-fg">
            {doc.content.fr.split(/\n{2,}/).map((paragraph, i) => (
              <p key={i} className="mb-3 whitespace-pre-line last:mb-0">
                {paragraph}
              </p>
            ))}
          </div>
          {mode === 'sign' && (
            <>
              <Checkbox
                checked={agree}
                onCheckedChange={(v) => setAgree(v === true)}
                label="J’ai lu et j’accepte les conditions partenaires"
                description={`Au nom de ${restaurant.name}, en qualité de représentant légal.`}
              />
              <FormField label="Signature" required hint="Saisissez vos prénom et nom : ils valent signature électronique simple.">
                <Input value={signature} maxLength={80} autoComplete="name" placeholder="Prénom Nom" onChange={(e) => setSignature(e.target.value)} />
              </FormField>
              <Notice tone="neutral" icon={<ShieldCheck />}>
                La date, l’heure, votre identifiant et une empreinte de connexion sont enregistrés comme preuve d’acceptation.
              </Notice>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={sign.loading}>
            {mode === 'sign' ? 'Annuler' : 'Fermer'}
          </Button>
          {mode === 'sign' && (
            <Button variant="primary" leftIcon={<PenLine />} loading={sign.loading} disabled={!agree || signature.trim().length < 3} onClick={() => void submit()}>
              Signer le contrat
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
