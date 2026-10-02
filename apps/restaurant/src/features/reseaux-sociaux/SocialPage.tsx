import { useEffect, useMemo, useRef, useState } from 'react';
import { limit, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore';
import QRCode from 'qrcode';
import {
  Check,
  Copy,
  Download,
  FileDown,
  Globe,
  ImageIcon,
  Link2,
  MessageCircle,
  QrCode,
  Share2,
  Smartphone,
  Sparkles,
} from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  FormField,
  Input,
  PageContainer,
  PageHeader,
  SegmentedControl,
  Select,
  Skeleton,
  Textarea,
  cn,
  formatEUR,
  toast,
} from '@golink/ui';
import {
  RESTAURANT_MARKETING_DOCS,
  SOCIAL_NETWORK_HOSTS,
  SOCIAL_NETWORK_LABELS,
  SOCIAL_NETWORKS,
  paths,
  restaurantAppDeepLink,
  restaurantPublicUrl,
  type Product,
  type RestaurantSocialProfile,
  type SocialNetwork,
} from '@golink/shared';
import { useAuth } from '@golink/web';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { collectionAt, docAt, errorMessage, useCollection, useDoc, useMutation } from '@/lib/firestore';
import { discountLabel, promotionName, useRestaurantPromotions } from '../promotions/lib';
import { VISUAL_SIZES, downloadCanvas, downloadPoster, downloadText, renderVisual, type VisualFormat, type VisualSubject } from './visuals';

const NETWORK_PLACEHOLDERS: Record<SocialNetwork, string> = {
  instagram: 'https://instagram.com/votre-restaurant',
  facebook: 'https://facebook.com/votre-restaurant',
  tiktok: 'https://tiktok.com/@votre-restaurant',
  google: 'https://g.page/votre-restaurant',
  website: 'https://www.votre-restaurant.fr',
  whatsapp: 'https://wa.me/33612345678',
};

function validateLink(network: SocialNetwork, value: string): string | null {
  if (!value.trim()) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return 'Adresse invalide : commencez par https://';
  }
  if (url.protocol !== 'https:') return 'Utilisez une adresse sécurisée (https://).';
  const hosts = SOCIAL_NETWORK_HOSTS[network];
  if (hosts.length && !hosts.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))) return `Ce lien ne correspond pas à ${SOCIAL_NETWORK_LABELS[network]}.`;
  return null;
}

function copy(text: string, what: string) {
  void navigator.clipboard.writeText(text).then(
    () => toast.success(`${what} copié.`),
    () => toast.error('Copie impossible : sélectionnez le texte manuellement.'),
  );
}

export function SocialPage() {
  const { restaurantId } = useRestaurantAccess();
  const state = useDoc<RestaurantSocialProfile>(docAt(`${paths.restaurantSub(restaurantId, 'marketing')}/${RESTAURANT_MARKETING_DOCS.social}`));

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Marketing"
        title="Réseaux sociaux"
        description="Vos comptes, votre lien de commande et des visuels prêts à publier pour faire connaître votre carte au-delà de l’application."
        breadcrumbs={[{ label: 'Marketing', href: '/marketing' }, { label: 'Réseaux sociaux' }]}
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <ShareLinkCard />
        <QrCard />
      </div>
      <div className="mt-6">
        <VisualStudio />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        {state.loading ? (
          <Skeleton className="h-96 rounded-xl" />
        ) : (
          <ProfileForm key={`profil-${state.data?.updatedAt?.toMillis?.() ?? 'vide'}`} saved={state.data} error={state.error ? errorMessage(state.error) : null} />
        )}
        {state.loading ? <Skeleton className="h-96 rounded-xl" /> : <ShareMessageCard key={`partage-${state.data?.updatedAt?.toMillis?.() ?? 'vide'}`} saved={state.data} />}
      </div>
    </PageContainer>
  );
}

// ------------------------------------------------------------------ Lien de partage

function ShareLinkCard() {
  const { restaurant } = useRestaurantAccess();
  const [source, setSource] = useState('lien');
  const url = restaurantPublicUrl(restaurant.slug, source === 'lien' ? undefined : source);
  const deepLink = restaurantAppDeepLink(restaurant.id);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  return (
    <Card>
      <CardHeader title="Lien de commande" icon={<Link2 />} description="À placer dans votre bio, vos publications et vos messages." />
      <CardContent className="space-y-4">
        <FormField label="Suivre la provenance des visites">
          <Select
            value={source}
            onValueChange={setSource}
            options={[
              { value: 'lien', label: 'Lien simple' },
              { value: 'instagram', label: 'Pour Instagram' },
              { value: 'facebook', label: 'Pour Facebook' },
              { value: 'tiktok', label: 'Pour TikTok' },
              { value: 'flyer', label: 'Pour vos flyers et affiches' },
            ]}
          />
        </FormField>
        <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-2 p-1.5 pl-3.5">
          <Globe className="size-4 shrink-0 text-fg-subtle" />
          <span className="min-w-0 flex-1 truncate font-mono text-sm text-fg" title={url}>
            {url}
          </span>
          <Button size="sm" variant="primary" leftIcon={<Copy />} onClick={() => copy(url, 'Lien')}>
            Copier
          </Button>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-border p-1.5 pl-3.5">
          <Smartphone className="size-4 shrink-0 text-fg-subtle" />
          <span className="min-w-0 flex-1">
            <span className="block text-xs text-fg-subtle">Lien direct vers l’app Ciyou Eats</span>
            <span className="block truncate font-mono text-xs text-fg-muted">{deepLink}</span>
          </span>
          <Button size="sm" variant="ghost" leftIcon={<Copy />} onClick={() => copy(deepLink, 'Lien de l’app')}>
            Copier
          </Button>
        </div>
        {canShare && (
          <Button
            variant="secondary"
            leftIcon={<Share2 />}
            onClick={() => void navigator.share({ title: restaurant.name, text: `Commandez chez ${restaurant.name} sur Ciyou Eats`, url }).catch(() => undefined)}
          >
            Partager depuis cet appareil
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------ QR code

function QrCard() {
  const { restaurant } = useRestaurantAccess();
  const url = restaurantPublicUrl(restaurant.slug, 'qr');
  const [svg, setSvg] = useState<string | null>(null);
  const [posterLoading, setPosterLoading] = useState(false);
  useEffect(() => {
    let active = true;
    void QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0b0f10', light: '#ffffff' } }).then((s) => active && setSvg(s));
    return () => {
      active = false;
    };
  }, [url]);
  const slug = restaurant.slug || restaurant.id;

  return (
    <Card>
      <CardHeader title="QR code de votre carte" icon={<QrCode />} description="Sur vos tables, votre vitrine ou vos sacs : un scan suffit pour commander." />
      <CardContent className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
        <div className="grid size-44 shrink-0 place-items-center rounded-2xl border border-border bg-white p-3 shadow-card">
          {svg ? <div className="size-full [&_svg]:size-full" role="img" aria-label={`QR code vers ${url}`} dangerouslySetInnerHTML={{ __html: svg }} /> : <Skeleton className="size-full" />}
        </div>
        <div className="w-full space-y-2.5">
          <p className="text-sm text-fg-muted">Le QR code ouvre votre page Ciyou Eats ; les visites sont comptées à part pour mesurer l’efficacité de vos supports imprimés.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              variant="secondary"
              leftIcon={<Download />}
              onClick={async () => {
                const canvas = document.createElement('canvas');
                await QRCode.toCanvas(canvas, url, { width: 1024, margin: 2, color: { dark: '#0b0f10', light: '#ffffff' } });
                downloadCanvas(canvas, `qr-${slug}.png`);
              }}
            >
              PNG
            </Button>
            <Button variant="secondary" leftIcon={<Download />} disabled={!svg} onClick={() => svg && downloadText(svg, `qr-${slug}.svg`, 'image/svg+xml')}>
              SVG (impression)
            </Button>
          </div>
          <Button
            variant="primary"
            block
            leftIcon={<FileDown />}
            loading={posterLoading}
            onClick={async () => {
              setPosterLoading(true);
              try {
                await downloadPoster({
                  restaurantName: restaurant.name,
                  url,
                  tagline: restaurant.description ?? 'Vos plats préférés, livrés ou à emporter.',
                  fileName: `affichette-${slug}.pdf`,
                });
              } catch (error) {
                toast.error(errorMessage(error));
              } finally {
                setPosterLoading(false);
              }
            }}
          >
            Affichette A5 à imprimer (PDF)
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------ Visuels

function VisualStudio() {
  const { restaurantId, restaurant } = useRestaurantAccess();
  const products = useCollection<Product>(query(collectionAt(paths.restaurantSub(restaurantId, 'products')), orderBy('salesCount', 'desc'), limit(40)));
  const promotions = useRestaurantPromotions();
  const offers = promotions.data.filter((p) => p.status === 'active');
  const [format, setFormat] = useState<VisualFormat>('square');
  const [kind, setKind] = useState<VisualSubject['kind']>('restaurant');
  const [productId, setProductId] = useState('');
  const [offerId, setOfferId] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const product = products.data.find((p) => p.id === productId) ?? products.data.find((p) => p.available && p.image) ?? products.data[0];
  const offer = offers.find((p) => p.id === offerId) ?? offers[0];

  const subject = useMemo<VisualSubject | null>(() => {
    if (kind === 'restaurant') {
      return {
        kind,
        title: restaurant.name,
        subtitle: restaurant.description ?? 'Commandez vos plats préférés en quelques secondes.',
        rating: restaurant.rating.count > 0 ? `${restaurant.rating.average.toLocaleString('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} ★` : null,
        imageUrl: restaurant.cover?.url ?? null,
      };
    }
    if (kind === 'product') {
      if (!product) return null;
      return { kind, title: product.name, subtitle: product.description ?? `À découvrir chez ${restaurant.name}.`, price: formatEUR(product.priceCents, { cents: true }), imageUrl: product.image?.url ?? restaurant.cover?.url ?? null };
    }
    if (!offer) return null;
    return {
      kind,
      title: offer.title.fr,
      subtitle: offer.description?.fr ?? `Offre valable chez ${restaurant.name} sur Ciyou Eats.`,
      discount: offer.kind === 'free_delivery' ? 'Livraison offerte' : `−${discountLabel(offer)}`,
      code: offer.code ?? null,
      imageUrl: restaurant.cover?.url ?? null,
    };
  }, [kind, product, offer, restaurant]);

  useEffect(() => {
    if (!subject) {
      setPreview(null);
      return;
    }
    let active = true;
    setRendering(true);
    void renderVisual({ format, subject, restaurantName: restaurant.name, accent: restaurant.accent, url: restaurantPublicUrl(restaurant.slug, 'visuel') })
      .then((canvas) => {
        if (!active) return;
        canvasRef.current = canvas;
        try {
          setPreview(canvas.toDataURL('image/jpeg', 0.82));
        } catch {
          setPreview(null);
          toast.error('Une image n’a pas pu être intégrée au visuel.');
        }
      })
      .finally(() => active && setRendering(false));
    return () => {
      active = false;
    };
  }, [format, subject, restaurant.name, restaurant.accent, restaurant.slug]);

  const empty = kind === 'product' ? products.data.length === 0 : kind === 'offer' ? offers.length === 0 : false;

  return (
    <Card>
      <CardHeader
        title="Visuels prêts à publier"
        icon={<ImageIcon />}
        description="Générés à partir de votre fiche, de votre carte et de vos offres, avec votre QR code."
        actions={
          <Button
            variant="primary"
            leftIcon={<Download />}
            disabled={!preview || rendering}
            onClick={() => canvasRef.current && downloadCanvas(canvasRef.current, `golink-${restaurant.slug}-${kind}-${format}.png`)}
          >
            Télécharger
          </Button>
        }
      />
      <CardContent className="grid gap-6 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <div className="space-y-4">
          <FormField label="Sujet">
            <SegmentedControl
              value={kind}
              onValueChange={(v) => setKind(v as VisualSubject['kind'])}
              options={[
                { value: 'restaurant', label: 'Établissement' },
                { value: 'product', label: 'Plat' },
                { value: 'offer', label: 'Offre' },
              ]}
            />
          </FormField>
          <FormField label="Format">
            <Select value={format} onValueChange={(v) => setFormat(v as VisualFormat)} options={(Object.keys(VISUAL_SIZES) as VisualFormat[]).map((f) => ({ value: f, label: VISUAL_SIZES[f].label }))} />
          </FormField>
          {kind === 'product' && products.data.length > 0 && (
            <FormField label="Plat mis en avant" hint="Classés par ventes.">
              <Select value={product?.id ?? ''} onValueChange={setProductId} options={products.data.map((p) => ({ value: p.id, label: p.name, description: formatEUR(p.priceCents, { cents: true }) }))} />
            </FormField>
          )}
          {kind === 'offer' && offers.length > 0 && (
            <FormField label="Offre">
              <Select value={offer?.id ?? ''} onValueChange={setOfferId} options={offers.map((p) => ({ value: p.id, label: `${promotionName(p)} · ${discountLabel(p)}` }))} />
            </FormField>
          )}
          <p className="flex items-start gap-2 text-xs text-fg-subtle">
            <Sparkles className="mt-px size-3.5 shrink-0" />
            Astuce : publiez la story le jour même d’une offre, et le visuel carré dans votre fil pour la mettre en avant toute la semaine.
          </p>
        </div>
        <div className={cn('flex min-h-72 items-center justify-center rounded-2xl border border-dashed border-border-strong bg-surface-2 p-4')}>
          {empty ? (
            <p className="max-w-xs text-center text-sm text-fg-muted">
              {kind === 'offer' ? 'Aucune offre en ligne : créez-en une dans Codes promo pour générer son visuel.' : 'Ajoutez des plats à votre carte pour générer leurs visuels.'}
            </p>
          ) : rendering && !preview ? (
            <Skeleton className={format === 'story' ? 'h-[420px] w-[236px]' : 'size-72'} />
          ) : preview ? (
            <img
              src={preview}
              alt="Aperçu du visuel généré"
              className={cn('rounded-xl shadow-lg transition-opacity', format === 'story' ? 'max-h-[460px] w-auto' : 'w-full max-w-[380px]', rendering && 'opacity-60')}
            />
          ) : (
            <p className="text-sm text-fg-muted">Aperçu indisponible.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------ Comptes sociaux

function ProfileForm({ saved, error }: { saved: RestaurantSocialProfile | null; error: string | null }) {
  const { user } = useAuth();
  const { restaurantId } = useRestaurantAccess();
  const [links, setLinks] = useState<Partial<Record<SocialNetwork, string>>>(saved?.links ?? {});
  const errors = Object.fromEntries(SOCIAL_NETWORKS.map((n) => [n, validateLink(n, links[n] ?? '')])) as Record<SocialNetwork, string | null>;
  const dirty = JSON.stringify(links) !== JSON.stringify(saved?.links ?? {});
  const save = useMutation(
    async () => {
      const clean = Object.fromEntries(SOCIAL_NETWORKS.filter((n) => links[n]?.trim()).map((n) => [n, links[n]!.trim()]));
      await setDoc(docAt(`${paths.restaurantSub(restaurantId, 'marketing')}/${RESTAURANT_MARKETING_DOCS.social}`), {
        links: clean,
        shareMessage: saved?.shareMessage ?? '',
        hashtags: saved?.hashtags ?? [],
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid ?? '',
      });
      return true;
    },
    { success: 'Comptes enregistrés : ils apparaissent sur votre fiche Ciyou Eats.' },
  );
  const invalid = Object.values(errors).some(Boolean);

  return (
    <Card>
      <CardHeader title="Vos comptes" icon={<Globe />} description="Affichés sur votre fiche dans l’application pour que vos clients vous suivent." />
      <CardContent className="space-y-3.5">
        {error && <p className="text-sm text-danger-soft-fg">{error}</p>}
        <div className="grid gap-3.5 sm:grid-cols-2">
          {SOCIAL_NETWORKS.map((network) => (
            <FormField key={network} label={SOCIAL_NETWORK_LABELS[network]} error={errors[network] ?? undefined}>
              <Input
                type="url"
                inputMode="url"
                placeholder={NETWORK_PLACEHOLDERS[network]}
                value={links[network] ?? ''}
                onChange={(e) => setLinks((l) => ({ ...l, [network]: e.target.value }))}
              />
            </FormField>
          ))}
        </div>
        <div className="flex justify-end gap-2 pt-1">
          {dirty && (
            <Button variant="ghost" onClick={() => setLinks(saved?.links ?? {})} disabled={save.loading}>
              Annuler
            </Button>
          )}
          <Button variant="primary" leftIcon={<Check />} disabled={!dirty || invalid} loading={save.loading} onClick={() => void save.mutate()}>
            Enregistrer
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------ Texte de partage

function ShareMessageCard({ saved }: { saved: RestaurantSocialProfile | null }) {
  const { user } = useAuth();
  const { restaurantId, restaurant } = useRestaurantAccess();
  const url = restaurantPublicUrl(restaurant.slug);
  const defaultMessage = `Envie de ${restaurant.tags[0]?.toLowerCase() ?? 'bien manger'} ? Commandez chez ${restaurant.name} sur Ciyou Eats, livré chez vous ou à emporter.`;
  const [message, setMessage] = useState(saved?.shareMessage || defaultMessage);
  const [hashtags, setHashtags] = useState((saved?.hashtags ?? []).join(' ') || `#${restaurant.name.replace(/[^\p{L}\p{N}]/gu, '')} #${restaurant.address.city.replace(/[^\p{L}\p{N}]/gu, '')} #Ciyou Eats`);
  const tags = hashtags
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (t.startsWith('#') ? t : `#${t}`))
    .slice(0, 10);
  const full = `${message.trim()}\n\n${url}\n${tags.join(' ')}`.trim();
  const save = useMutation(
    async () => {
      await setDoc(docAt(`${paths.restaurantSub(restaurantId, 'marketing')}/${RESTAURANT_MARKETING_DOCS.social}`), {
        links: saved?.links ?? {},
        shareMessage: message.trim().slice(0, 280),
        hashtags: tags,
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid ?? '',
      });
      return true;
    },
    { success: 'Texte de partage enregistré.' },
  );
  return (
    <Card>
      <CardHeader title="Texte de partage" icon={<MessageCircle />} description="Prêt à coller avec votre lien sous une publication ou dans un message." />
      <CardContent className="space-y-3.5">
        <FormField label="Message" aside={`${message.length}/280`}>
          <Textarea rows={3} maxLength={280} value={message} onChange={(e) => setMessage(e.target.value)} />
        </FormField>
        <FormField label="Hashtags" hint="10 au maximum, séparés par des espaces.">
          <Input value={hashtags} onChange={(e) => setHashtags(e.target.value)} />
        </FormField>
        <div className="rounded-xl border border-border bg-surface-2 p-3.5">
          <p className="whitespace-pre-line text-sm text-fg">{full}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" leftIcon={<Check />} loading={save.loading} onClick={() => void save.mutate()}>
            Enregistrer
          </Button>
          <Button variant="primary" leftIcon={<Copy />} onClick={() => copy(full, 'Texte')}>
            Copier le texte
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
