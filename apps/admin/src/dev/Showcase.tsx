import { useCallback, useMemo, useState } from 'react';
import {
  ArrowRight,
  Ban,
  Bike,
  ClipboardList,
  Download,
  Euro,
  Mail,
  MoreHorizontal,
  PauseCircle,
  Pencil,
  Plus,
  Search,
  Settings,
  ShoppingBag,
  Store,
  Trash2,
  UserRound,
  Users,
} from 'lucide-react';
import {
  AppShell,
  AreaChart,
  Avatar,
  AvatarGroup,
  Badge,
  BarChart,
  Button,
  Calendar,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  ChartLegend,
  Checkbox,
  Combobox,
  CommandPalette,
  ConfirmDialog,
  DataTable,
  DatePicker,
  DateRangePicker,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
  DonutChart,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  FileUpload,
  FormField,
  IconButton,
  Input,
  Logo,
  LogoMark,
  MapContainer,
  NotificationsButton,
  ORDER_STATUS,
  ACCOUNT_STATUS,
  PageContainer,
  PageHeader,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ProgressBar,
  RadioGroup,
  Section,
  SegmentedControl,
  Select,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTrigger,
  Skeleton,
  Slider,
  Sparkline,
  StatCard,
  StatusBadge,
  StatusPill,
  Stepper,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  TimeInput,
  Timeline,
  Toaster,
  Tooltip,
  UserMenu,
  applyTheme,
  createColumnHelper,
  formatEUR,
  formatNumber,
  formatPercent,
  toast,
  useCommandShortcut,
  type DateRange,
} from '@golink/ui';
import {
  adminNav,
  alerts,
  cityOrders,
  orderChannels,
  restaurantNav,
  restaurants,
  revenueSeries,
  sparkDown,
  sparkFlat,
  sparkUp,
  type DemoRestaurant,
} from './showcase-data';

type ThemeChoice = 'admin' | 'restaurant' | 'restaurant-dark';

function readThemeChoice(): ThemeChoice {
  const value = new URLSearchParams(window.location.search).get('theme');
  return value === 'restaurant' || value === 'restaurant-dark' ? value : 'admin';
}

function applyChoice(choice: ThemeChoice) {
  applyTheme(choice === 'admin' ? 'admin' : 'restaurant');
  if (choice === 'restaurant-dark') document.documentElement.dataset.mode = 'dark';
  else delete document.documentElement.dataset.mode;
  const url = new URL(window.location.href);
  url.searchParams.set('theme', choice);
  window.history.replaceState(null, '', url);
}

const column = createColumnHelper<DemoRestaurant>();

const planTone = { Essentiel: 'neutral', Pro: 'info', Premium: 'brand' } as const;

const columns = [
  column.accessor('name', {
    header: 'Restaurant',
    cell: (info) => (
      <div className="flex items-center gap-3">
        <Avatar name={info.getValue()} square size="sm" />
        <div className="min-w-0">
          <p className="truncate font-medium text-fg">{info.getValue()}</p>
          <p className="text-xs text-fg-subtle">{info.row.original.city}</p>
        </div>
      </div>
    ),
  }),
  column.accessor('plan', {
    header: 'Formule',
    cell: (info) => <Badge tone={planTone[info.getValue()]}>{info.getValue()}</Badge>,
  }),
  column.accessor('status', {
    header: 'Statut',
    cell: (info) => <StatusBadge status={info.getValue()} map={ACCOUNT_STATUS} />,
  }),
  column.accessor('orders', {
    header: 'Commandes',
    meta: { align: 'right' },
    cell: (info) => <span className="font-mono text-sm num">{formatNumber(info.getValue())}</span>,
  }),
  column.accessor('revenue', {
    header: 'CA 30 j',
    meta: { align: 'right' },
    cell: (info) => <span className="font-mono text-sm num">{formatEUR(info.getValue())}</span>,
  }),
  column.accessor('cancelRate', {
    header: 'Annulation',
    meta: { align: 'right' },
    cell: (info) => (
      <span className={info.getValue() > 0.05 ? 'font-mono text-sm text-danger num' : 'font-mono text-sm text-fg-muted num'}>
        {formatPercent(info.getValue())}
      </span>
    ),
  }),
  column.display({
    id: 'actions',
    meta: { align: 'right', className: 'w-12' },
    cell: () => (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label="Actions" size="sm" onClick={(event) => event.stopPropagation()}>
            <MoreHorizontal />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem icon={<Pencil />}>Modifier</DropdownMenuItem>
          <DropdownMenuItem icon={<Mail />}>Contacter</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem icon={<Ban />} destructive>
            Suspendre
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  }),
];

const cityOptions = [...new Set(restaurants.map((r) => r.city))].map((city) => ({ value: city, label: city }));

/** Vitrine du kit @golink/ui : tous les composants en situation, dans les deux thèmes. */
export function Showcase() {
  const [theme, setTheme] = useState<ThemeChoice>(() => {
    const initial = readThemeChoice();
    applyChoice(initial);
    return initial;
  });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [period, setPeriod] = useState('30j');
  const [range, setRange] = useState<DateRange | undefined>();
  const [date, setDate] = useState<Date | undefined>(new Date(2026, 8, 25));
  const [city, setCity] = useState<string | undefined>('Luxembourg');
  const [cuisines, setCuisines] = useState<string[]>(['sushi', 'ramen']);
  const [files, setFiles] = useState<File[]>([]);
  const [radius, setRadius] = useState([4.5]);
  const [opening, setOpening] = useState('11:30');
  const [commission, setCommission] = useState('pro');
  const [autoAccept, setAutoAccept] = useState(true);

  const isAdmin = theme === 'admin';
  const togglePalette = useCallback(() => setPaletteOpen((open) => !open), []);
  useCommandShortcut(togglePalette);

  function changeTheme(value: string) {
    const next = value as ThemeChoice;
    applyChoice(next);
    setTheme(next);
  }

  const commandGroups = useMemo(
    () => [
      {
        heading: 'Navigation',
        items: adminNav.flatMap((group) =>
          group.items.slice(0, 2).map((item) => ({ id: item.id, label: item.label, icon: item.icon, onSelect: () => toast(item.label) })),
        ),
      },
      {
        heading: 'Actions rapides',
        items: [
          { id: 'new-restaurant', label: 'Inviter un restaurant', icon: <Plus />, shortcut: 'N', onSelect: () => toast.success('Invitation préparée') },
          { id: 'export', label: 'Exporter les commandes du mois', icon: <Download />, onSelect: () => toast('Export lancé') },
        ],
      },
    ],
    [],
  );

  return (
    <>
      <AppShell
        brand={<Logo size={30} caption={isAdmin ? 'Super admin' : 'Restaurant'} className="text-sidebar-fg" />}
        brandCollapsed={<LogoMark size={30} />}
        nav={isAdmin ? adminNav : restaurantNav}
        activeId="dashboard"
        sidebarSearch={isAdmin}
        sidebarHeader={
          isAdmin ? undefined : (
            <div className="rounded-xl border border-sidebar-border bg-white/[0.04] p-2.5">
              <p className="mb-1.5 px-1 font-mono text-3xs uppercase tracking-eyebrow text-sidebar-muted">Établissement</p>
              <button type="button" className="flex w-full items-center gap-2.5 rounded-lg p-1 text-left hover:bg-sidebar-hover">
                <Avatar name="Mina Kitchen" square size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-sidebar-fg">Mina Kitchen</span>
                  <span className="flex items-center gap-1.5 text-2xs text-sidebar-muted">
                    <span className="size-1.5 rounded-full bg-sage-400" /> Ouvert · Paris 11e
                  </span>
                </span>
              </button>
            </div>
          )
        }
        sidebarFooter={
          <div className="rounded-xl border border-sidebar-border bg-white/[0.03] p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-sidebar-fg">{isAdmin ? 'Plateforme' : 'Formule Premium'}</p>
              <span className="flex items-center gap-1.5 text-2xs text-sidebar-muted">
                <span className="size-1.5 rounded-full bg-sage-400" /> {isAdmin ? 'Opérationnelle' : 'Active'}
              </span>
            </div>
            <p className="mt-1 text-2xs text-sidebar-muted">{isAdmin ? 'Tous les services répondent · 99,98 %' : 'Commission 12 % · renouvellement le 1ᵉʳ oct.'}</p>
          </div>
        }
        breadcrumbs={[{ label: isAdmin ? 'Pilotage' : 'Mina Kitchen', href: '#' }, { label: 'Tableau de bord' }]}
        onSearch={() => setPaletteOpen(true)}
        searchPlaceholder={isAdmin ? 'Restaurant, commande, client…' : 'Commande, produit, client…'}
        topbarActions={
          <SegmentedControl
            size="sm"
            aria-label="Thème"
            value={theme}
            onValueChange={changeTheme}
            className="hidden sm:inline-flex"
            options={[
              { value: 'admin', label: 'Admin' },
              { value: 'restaurant', label: 'Restaurant' },
              { value: 'restaurant-dark', label: 'Sombre' },
            ]}
          />
        }
        notifications={
          <NotificationsButton
            onMarkAllRead={() => toast.success('Notifications lues')}
            onViewAll={() => toast('Centre de notifications')}
            items={alerts.map((alert, index) => ({ ...alert, unread: index < 2 }))}
          />
        }
        userMenu={
          <UserMenu
            user={{ name: 'Camille Laurent', email: 'camille@golink.fr', role: isAdmin ? 'Super administratrice' : 'Gérante' }}
            onSignOut={() => toast('Déconnexion')}
          >
            <DropdownMenuItem icon={<UserRound />}>Mon profil</DropdownMenuItem>
            <DropdownMenuItem icon={<Settings />} shortcut="⌘,">
              Préférences
            </DropdownMenuItem>
          </UserMenu>
        }
      >
        <PageContainer wide>
          <PageHeader
            eyebrow="Vendredi 25 septembre 2026"
            title={isAdmin ? 'Bonjour Camille' : 'Service du soir'}
            description={
              isAdmin
                ? 'Vue d’ensemble du réseau GoLink en France et au Luxembourg. Seules les anomalies remontent ici.'
                : '18 commandes en cours, ticket le plus rapide à 14 minutes.'
            }
            actions={
              <>
                <DateRangePicker value={range} onChange={setRange} placeholder="30 derniers jours" />
                <Button variant="secondary" leftIcon={<Download />}>
                  Exporter
                </Button>
                <Button variant="primary" leftIcon={<Plus />}>
                  {isAdmin ? 'Inviter un restaurant' : 'Nouvelle commande'}
                </Button>
              </>
            }
          />

          <div className="space-y-10">
            {/* Indicateurs clés */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Volume d’affaires"
                value={formatEUR(1_482_310, { compact: true })}
                delta={0.142}
                deltaLabel="vs août"
                icon={<Euro />}
                tone="brand"
                chart={<Sparkline data={sparkUp} />}
              />
              <StatCard
                label="Commandes"
                value={formatNumber(23_410)}
                delta={0.087}
                deltaLabel="vs août"
                icon={<ShoppingBag />}
                tone="teal"
                chart={<Sparkline data={sparkFlat} />}
              />
              <StatCard
                label="Livreurs en ligne"
                value="184"
                delta={-0.034}
                deltaLabel="vs hier même heure"
                icon={<Bike />}
                tone="plum"
                chart={<Sparkline data={sparkFlat} variant="line" />}
              />
              <StatCard
                label="Taux d’annulation"
                value={formatPercent(0.018)}
                delta={-0.21}
                invertDelta
                deltaLabel="vs août"
                icon={<Ban />}
                tone="success"
                chart={<Sparkline data={sparkDown} />}
              />
            </div>

            {/* Graphiques */}
            <div className="grid gap-4 xl:grid-cols-3">
              <Card className="xl:col-span-2">
                <CardHeader
                  title="Volume d’affaires et commissions"
                  description="Montants TTC encaissés, tous pays"
                  actions={
                    <SegmentedControl
                      size="sm"
                      value={period}
                      onValueChange={setPeriod}
                      aria-label="Période"
                      options={[
                        { value: '7j', label: '7 j' },
                        { value: '30j', label: '30 j' },
                        { value: '12m', label: '12 mois' },
                      ]}
                    />
                  }
                />
                <CardContent className="pt-2">
                  <ChartLegend
                    className="mb-3"
                    series={[
                      { key: 'gmv', label: 'Volume d’affaires' },
                      { key: 'commissions', label: 'Commissions GoLink' },
                    ]}
                  />
                  <AreaChart
                    data={revenueSeries}
                    xKey="day"
                    height={260}
                    series={[
                      { key: 'gmv', label: 'Volume d’affaires' },
                      { key: 'commissions', label: 'Commissions GoLink' },
                    ]}
                    valueFormatter={(value) => formatEUR(value)}
                    axisFormatter={(value) => formatEUR(value, { compact: true })}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader title="Moyens de paiement" description="Répartition du mois" />
                <CardContent className="pt-4">
                  <DonutChart data={orderChannels} height={160} centerValue="30,3 k" centerLabel="commandes" />
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 xl:grid-cols-3">
              <Card>
                <CardHeader title="Commandes par ville" description="30 derniers jours" />
                <CardContent>
                  <BarChart data={cityOrders} xKey="city" horizontal height={220} series={[{ key: 'orders', label: 'Commandes' }]} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader
                  title="À traiter"
                  description="Anomalies détectées automatiquement"
                  actions={<Badge tone="danger">3</Badge>}
                  divided
                />
                <ul className="divide-y divide-border">
                  {alerts.map((alert) => (
                    <li key={alert.id} className={`tone-${alert.tone} flex gap-3 px-5 py-3.5`}>
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-(--tone-bg) text-(--tone-fg) [&_svg]:size-4">
                        {alert.icon}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-fg">{alert.title}</p>
                        <p className="mt-0.5 text-xs text-fg-muted">{alert.description}</p>
                      </div>
                      <span className="shrink-0 font-mono text-2xs text-fg-subtle">{alert.time}</span>
                    </li>
                  ))}
                </ul>
                <CardFooter>
                  <span>Mis à jour il y a 2 min</span>
                  <Button variant="link" size="sm" rightIcon={<ArrowRight />}>
                    Tout voir
                  </Button>
                </CardFooter>
              </Card>
              <Card>
                <CardHeader title="Suivi de la commande #GL-20418" description="Kumo Ramen → Kirchberg" divided />
                <CardContent className="pt-5">
                  <Timeline
                    items={[
                      { id: '1', title: 'Commande passée', description: '2 × Tonkotsu, 1 × Gyoza', time: '19:02', tone: 'neutral' },
                      { id: '2', title: 'Acceptée par le restaurant', time: '19:03', tone: 'info' },
                      { id: '3', title: 'Récupérée par Yanis', description: 'Vélo électrique · 2,1 km', time: '19:18', tone: 'plum' },
                      { id: '4', title: 'En livraison', description: 'Arrivée estimée 19:27', time: 'maintenant', tone: 'brand', icon: <Bike /> },
                    ]}
                  />
                </CardContent>
              </Card>
            </div>

            {/* Tableau */}
            <Section title="Restaurants" description="Tri, recherche, filtres à facettes, sélection multiple et actions groupées.">
              <DataTable
                data={restaurants}
                columns={columns}
                getRowId={(row) => row.id}
                itemLabel="restaurants"
                searchPlaceholder="Rechercher un restaurant…"
                pageSize={6}
                onRowClick={(row) => toast(row.name, { description: `${row.city} · ${row.plan}` })}
                filters={[
                  {
                    id: 'status',
                    label: 'Statut',
                    getValue: (row) => row.status,
                    options: ['active', 'paused', 'onboarding', 'suspended'].map((value) => ({
                      value,
                      label: ACCOUNT_STATUS[value]?.label ?? value,
                    })),
                  },
                  { id: 'city', label: 'Ville', getValue: (row) => row.city, options: cityOptions },
                ]}
                bulkActions={[
                  { label: 'Écrire', icon: <Mail />, onClick: (rows) => toast(`Message à ${rows.length} restaurants`) },
                  { label: 'Mettre en pause', icon: <PauseCircle />, onClick: (rows, clear) => { toast(`${rows.length} restaurants en pause`); clear(); } },
                  { label: 'Suspendre', icon: <Ban />, destructive: true, onClick: () => setConfirmOpen(true) },
                ]}
                toolbar={
                  <Button size="sm" variant="secondary" leftIcon={<Download />}>
                    Exporter CSV
                  </Button>
                }
              />
            </Section>

            {/* Formulaires */}
            <Section title="Formulaires" description="Champs, sélecteurs, dates, fichiers et interrupteurs.">
              <Card>
                <CardContent className="grid gap-x-6 gap-y-5 py-6 md:grid-cols-2 xl:grid-cols-3">
                  <FormField label="Nom commercial" required hint="Affiché dans l’application client.">
                    <Input defaultValue="Kumo Ramen" />
                  </FormField>
                  <FormField label="E-mail de contact" error="Adresse e-mail invalide.">
                    <Input defaultValue="contact@kumo" leading={<Mail />} />
                  </FormField>
                  <FormField label="Recherche" aside="⌘K">
                    <Input placeholder="Rechercher…" leading={<Search />} />
                  </FormField>
                  <FormField label="Pays">
                    <Select
                      defaultValue="lu"
                      options={[
                        { value: 'fr', label: 'France' },
                        { value: 'lu', label: 'Luxembourg' },
                        { value: 'be', label: 'Belgique', description: 'Ouverture prévue en 2027', disabled: true },
                      ]}
                    />
                  </FormField>
                  <FormField label="Ville">
                    <Combobox
                      value={city}
                      onChange={setCity}
                      placeholder="Choisir une ville"
                      options={cityOptions}
                    />
                  </FormField>
                  <FormField label="Cuisines">
                    <Combobox
                      multiple
                      value={cuisines}
                      onChange={setCuisines}
                      options={[
                        { value: 'sushi', label: 'Sushi' },
                        { value: 'ramen', label: 'Ramen' },
                        { value: 'burger', label: 'Burger' },
                        { value: 'pizza', label: 'Pizza' },
                        { value: 'vegan', label: 'Végétarien' },
                      ]}
                    />
                  </FormField>
                  <FormField label="Date d’ouverture">
                    <DatePicker value={date} onChange={setDate} />
                  </FormField>
                  <FormField label="Ouverture du midi">
                    <TimeInput value={opening} onChange={setOpening} />
                  </FormField>
                  <FormField label="Rayon de livraison" aside={<span className="font-mono num">{radius[0]?.toLocaleString('fr-FR')} km</span>}>
                    <div className="flex h-9 items-center">
                      <Slider value={radius} onValueChange={setRadius} min={1} max={10} step={0.5} formatValue={(v) => `${v.toLocaleString('fr-FR')} km`} />
                    </div>
                  </FormField>
                  <FormField label="Description" className="md:col-span-2 xl:col-span-2">
                    <Textarea placeholder="Présentez votre établissement en quelques lignes…" rows={3} />
                  </FormField>
                  <div className="space-y-4">
                    <Switch label="Acceptation automatique" description="Les commandes sont acceptées sans action." checked={autoAccept} onCheckedChange={setAutoAccept} />
                    <Checkbox label="Retrait sur place" description="Le client récupère sa commande." defaultChecked />
                  </div>
                  <div className="md:col-span-2">
                    <p className="mb-2 text-sm font-medium">Formule de commission</p>
                    <RadioGroup
                      variant="cards"
                      value={commission}
                      onValueChange={setCommission}
                      options={[
                        { value: 'essentiel', label: 'Essentiel · 18 %', description: 'Sans abonnement, livraison incluse' },
                        { value: 'pro', label: 'Pro · 12 %', description: '49 € / mois, mise en avant locale' },
                      ]}
                    />
                  </div>
                  <FormField label="Photos de l’établissement" className="xl:row-span-2">
                    <FileUpload
                      value={files}
                      onChange={setFiles}
                      multiple
                      accept="image/*"
                      maxSize={5 * 1024 * 1024}
                      hint="JPG ou PNG"
                      onReject={(message) => toast.error(message)}
                    />
                  </FormField>
                </CardContent>
                <CardFooter>
                  <span>Dernière modification le 24 sept. à 18:12</span>
                  <div className="flex gap-2">
                    <Button variant="ghost">Annuler</Button>
                    <Button variant="primary" onClick={() => toast.success('Modifications enregistrées')}>
                      Enregistrer
                    </Button>
                  </div>
                </CardFooter>
              </Card>
            </Section>

            {/* Boutons, statuts, surcouches */}
            <div className="grid gap-4 xl:grid-cols-2">
              <Card>
                <CardHeader title="Boutons et actions" />
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="primary">Principal</Button>
                    <Button variant="contrast">Contraste</Button>
                    <Button variant="secondary">Secondaire</Button>
                    <Button variant="soft">Doux</Button>
                    <Button variant="ghost">Discret</Button>
                    <Button variant="danger">Supprimer</Button>
                    <Button variant="primary" loading>
                      Envoi
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="xs">Très petit</Button>
                    <Button size="sm">Petit</Button>
                    <Button size="md">Moyen</Button>
                    <Button size="lg" variant="primary" rightIcon={<ArrowRight />}>
                      Grand
                    </Button>
                    <IconButton label="Modifier" variant="secondary">
                      <Pencil />
                    </IconButton>
                    <IconButton label="Supprimer" variant="danger">
                      <Trash2 />
                    </IconButton>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button>Fenêtre modale</Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader icon={<Store />} title="Inviter un restaurant" description="Un e-mail d’inscription sera envoyé au gérant." />
                        <DialogBody className="space-y-4">
                          <FormField label="Nom de l’établissement" required>
                            <Input placeholder="Ex. Kumo Ramen" />
                          </FormField>
                          <FormField label="E-mail du gérant" required>
                            <Input type="email" placeholder="gerant@exemple.fr" />
                          </FormField>
                        </DialogBody>
                        <DialogFooter>
                          <Button variant="ghost">Annuler</Button>
                          <Button variant="primary">Envoyer l’invitation</Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                    <Sheet>
                      <SheetTrigger asChild>
                        <Button>Tiroir latéral</Button>
                      </SheetTrigger>
                      <SheetContent>
                        <SheetHeader title="Commande #GL-20418" description="Kumo Ramen · 42,50 €" />
                        <SheetBody className="space-y-4">
                          <StatusBadge status="delivering" />
                          <Stepper
                            orientation="vertical"
                            current={3}
                            steps={[
                              { id: 'a', label: 'Commande reçue', description: '19:02' },
                              { id: 'b', label: 'En préparation', description: '19:03' },
                              { id: 'c', label: 'Récupérée', description: '19:18' },
                              { id: 'd', label: 'En livraison', description: 'Arrivée 19:27' },
                              { id: 'e', label: 'Livrée' },
                            ]}
                          />
                        </SheetBody>
                        <SheetFooter>
                          <Button variant="danger-soft">Rembourser</Button>
                          <Button variant="primary">Contacter le livreur</Button>
                        </SheetFooter>
                      </SheetContent>
                    </Sheet>
                    <Button onClick={() => setConfirmOpen(true)}>Confirmation</Button>
                    <Button onClick={() => toast.success('Reversement programmé', { description: '12 restaurants · 48 210,40 €' })}>
                      Notification
                    </Button>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button>Popover</Button>
                      </PopoverTrigger>
                      <PopoverContent>
                        <p className="font-display text-sm font-semibold">Calendrier</p>
                        <Calendar mode="single" selected={date} onSelect={setDate} className="mt-2" />
                      </PopoverContent>
                    </Popover>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button rightIcon={<MoreHorizontal />}>Menu</Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuLabel>Restaurant</DropdownMenuLabel>
                        <DropdownMenuItem icon={<Pencil />} shortcut="E">
                          Modifier
                        </DropdownMenuItem>
                        <DropdownMenuItem icon={<Users />}>Se connecter en tant que</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem icon={<Trash2 />} destructive>
                          Supprimer
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Tooltip content="Infobulle d’aide">
                      <Button variant="ghost">Infobulle</Button>
                    </Tooltip>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader title="Statuts et étiquettes" />
                <CardContent className="space-y-5">
                  <div>
                    <p className="eyebrow mb-2">Commandes</p>
                    <div className="flex flex-wrap gap-2">
                      {Object.keys(ORDER_STATUS).map((status) => (
                        <StatusBadge key={status} status={status} />
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="eyebrow mb-2">Comptes</p>
                    <div className="flex flex-wrap gap-2">
                      {['active', 'online', 'paused', 'onboarding', 'trial', 'suspended', 'past_due'].map((status) => (
                        <StatusBadge key={status} status={status} map={ACCOUNT_STATUS} />
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="eyebrow mb-2">Badges</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="brand">Premium</Badge>
                      <Badge tone="info">Pro</Badge>
                      <Badge>Essentiel</Badge>
                      <Badge tone="success" variant="outline">
                        Vérifié
                      </Badge>
                      <Badge tone="danger" variant="solid">
                        Urgent
                      </Badge>
                      <StatusPill tone="teal">Personnalisé</StatusPill>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 border-t border-border pt-4">
                    <Avatar name="Yanis Benali" status="online" />
                    <Avatar name="Sofia Marques" size="lg" status="busy" />
                    <Avatar name="Kumo Ramen" square size="lg" />
                    <AvatarGroup names={['Léa Martin', 'Hugo Petit', 'Inès Diallo', 'Tom Muller', 'Nora Weber', 'Paul Schmit']} />
                  </div>
                  <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
                    <ProgressBar label="Objectif mensuel" valueLabel="72 %" value={72} />
                    <ProgressBar label="Dossiers complets" valueLabel="9 / 12" value={9} max={12} tone="success" />
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 xl:grid-cols-3">
              <Card>
                <CardHeader title="Parcours d’inscription" />
                <CardContent className="py-6">
                  <Stepper
                    current={2}
                    steps={[
                      { id: '1', label: 'Compte' },
                      { id: '2', label: 'Documents' },
                      { id: '3', label: 'Carte' },
                      { id: '4', label: 'Mise en ligne' },
                    ]}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader title="Onglets" />
                <CardContent>
                  <Tabs defaultValue="all">
                    <TabsList>
                      <TabsTrigger value="all" count={23}>
                        Toutes
                      </TabsTrigger>
                      <TabsTrigger value="late" count={2}>
                        En retard
                      </TabsTrigger>
                      <TabsTrigger value="done">Terminées</TabsTrigger>
                    </TabsList>
                    <TabsContent value="all" className="space-y-2.5 pt-4">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-4 w-1/2" />
                      <Skeleton className="h-4 w-2/3" />
                    </TabsContent>
                    <TabsContent value="late" className="pt-4 text-sm text-fg-muted">
                      2 commandes dépassent le délai promis.
                    </TabsContent>
                    <TabsContent value="done" className="pt-4 text-sm text-fg-muted">
                      Historique des commandes terminées.
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
              <Card>
                <EmptyState
                  icon={<ClipboardList />}
                  title="Aucune commande en attente"
                  description="Les nouvelles commandes apparaîtront ici en temps réel."
                  action={<Button size="sm" variant="primary">Ouvrir le restaurant</Button>}
                />
              </Card>
            </div>

            <div className="grid gap-4 xl:grid-cols-3">
              <Card className="xl:col-span-2">
                <CardHeader title="Carte des livraisons" description="Composant MapContainer (Google Maps)" />
                <CardContent>
                  <MapContainer
                    apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}
                    center={{ lat: 49.6116, lng: 6.1319 }}
                    zoom={12}
                    dark={theme !== 'restaurant'}
                    height={300}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader title="Identité" description="Logo et symbole GoLink" />
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-center rounded-xl bg-cream-100 p-6 text-petrol-900">
                    <Logo size={36} />
                  </div>
                  <div className="flex items-center justify-center rounded-xl bg-petrol-950 p-6 text-cream-100">
                    <Logo size={36} caption="Super admin" />
                  </div>
                  <div className="flex items-center justify-center gap-4">
                    <LogoMark size={48} />
                    <LogoMark size={32} />
                    <LogoMark size={24} />
                    <span className="text-fg">
                      <LogoMark size={32} variant="mono" />
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </PageContainer>
      </AppShell>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} groups={commandGroups} />
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        destructive
        requireReason
        title="Suspendre ces restaurants ?"
        description="Ils ne recevront plus de commandes jusqu’à leur réactivation."
        confirmLabel="Suspendre"
        onConfirm={() => {
          toast.success('Restaurants suspendus');
        }}
      />
      <Toaster theme={theme === 'restaurant' ? 'light' : 'dark'} />
    </>
  );
}
