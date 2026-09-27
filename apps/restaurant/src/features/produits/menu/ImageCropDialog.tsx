// Recadrage d'une photo au format 4:3 : déplacement au pointeur ou aux flèches, zoom.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Crop, Minus, Move, Plus, RotateCcw } from 'lucide-react';
import { Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, IconButton, Slider } from '@golink/ui';
import { CROP_ASPECT, type CropArea } from './images';

interface Props {
  /** URL objet de l'image choisie ; null = fenêtre fermée. */
  source: { url: string; image: HTMLImageElement } | null;
  onCancel: () => void;
  onConfirm: (area: CropArea) => Promise<void> | void;
  title?: string;
}

interface View {
  zoom: number;
  x: number;
  y: number;
}

export function ImageCropDialog({ source, onCancel, onConfirm, title = 'Recadrer la photo' }: Props) {
  const frame = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; view: View } | null>(null);

  // Taille du cadre (responsive) : observée dès que le cadre est monté dans la fenêtre.
  const observer = useRef<ResizeObserver | null>(null);
  const frameRef = useCallback((element: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    frame.current = element;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    observer.current = new ResizeObserver(measure);
    observer.current.observe(element);
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);

  const image = source?.image;
  const base = image && size.width ? Math.max(size.width / image.naturalWidth, size.height / image.naturalHeight) : 1;
  const scale = base * view.zoom;
  const displayed = image ? { width: image.naturalWidth * scale, height: image.naturalHeight * scale } : { width: 0, height: 0 };

  const clamp = useCallback(
    (next: View): View => {
      if (!image || !size.width) return next;
      const s = base * next.zoom;
      const minX = size.width - image.naturalWidth * s;
      const minY = size.height - image.naturalHeight * s;
      return { zoom: next.zoom, x: Math.min(0, Math.max(minX, next.x)), y: Math.min(0, Math.max(minY, next.y)) };
    },
    [base, image, size],
  );

  // Centrage initial.
  useEffect(() => {
    if (!image || !size.width) return;
    const s = base;
    setView({ zoom: 1, x: (size.width - image.naturalWidth * s) / 2, y: (size.height - image.naturalHeight * s) / 2 });
  }, [image, size.width, size.height, base]);

  function zoomTo(zoom: number) {
    setView((current) => {
      const z = Math.min(4, Math.max(1, zoom));
      // Zoom centré sur le milieu du cadre.
      const cx = size.width / 2;
      const cy = size.height / 2;
      const ratio = z / current.zoom;
      return clamp({ zoom: z, x: cx - (cx - current.x) * ratio, y: cy - (cy - current.y) * ratio });
    });
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, view };
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    setView(clamp({ ...state.view, x: state.view.x + event.clientX - state.x, y: state.view.y + event.clientY - state.y }));
  }
  function onPointerUp() {
    drag.current = null;
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 40 : 10;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      setView((current) => clamp({ ...current, x: current.x + move[0], y: current.y + move[1] }));
    } else if (event.key === '+' || event.key === '=') zoomTo(view.zoom + 0.2);
    else if (event.key === '-') zoomTo(view.zoom - 0.2);
  }

  async function confirm() {
    if (!image || !size.width) return;
    setSaving(true);
    try {
      await onConfirm({ x: -view.x / scale, y: -view.y / scale, width: size.width / scale, height: size.height / scale });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={Boolean(source)} onOpenChange={(open) => !open && !saving && onCancel()}>
      <DialogContent size="lg">
        <DialogHeader icon={<Crop />} title={title} description="Cadrez le plat au centre : c’est ce que verront vos clients dans l’app GoLink." />
        <DialogBody className="space-y-4">
          <div
            ref={frameRef}
            role="application"
            aria-label="Zone de recadrage : faites glisser l’image ou utilisez les flèches, + et − pour zoomer"
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={onKeyDown}
            className="relative w-full cursor-grab touch-none overflow-hidden rounded-xl bg-surface-3 outline-none ring-offset-2 ring-offset-surface focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
            style={{ aspectRatio: String(CROP_ASPECT) }}
          >
            {source && (
              <img
                src={source.url}
                alt=""
                draggable={false}
                className="pointer-events-none absolute left-0 top-0 max-w-none select-none"
                style={{ width: displayed.width, height: displayed.height, transform: `translate(${view.x}px, ${view.y}px)` }}
              />
            )}
            {/* Grille des tiers */}
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
              {Array.from({ length: 9 }, (_, index) => (
                <div key={index} className="border border-white/25" />
              ))}
            </div>
            <div className="pointer-events-none absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-2xs font-medium text-white">
              <Move className="size-3" aria-hidden="true" /> Glisser pour cadrer
            </div>
          </div>
          <div className="flex items-center gap-3">
            <IconButton label="Dézoomer" variant="ghost" size="sm" onClick={() => zoomTo(view.zoom - 0.25)} disabled={view.zoom <= 1}>
              <Minus />
            </IconButton>
            <Slider
              aria-label="Zoom"
              min={1}
              max={4}
              step={0.01}
              value={[view.zoom]}
              onValueChange={([value]) => value !== undefined && zoomTo(value)}
              className="flex-1"
              formatValue={(value) => `${Math.round(value * 100)} %`}
            />
            <IconButton label="Zoomer" variant="ghost" size="sm" onClick={() => zoomTo(view.zoom + 0.25)} disabled={view.zoom >= 4}>
              <Plus />
            </IconButton>
            <IconButton label="Réinitialiser le cadrage" variant="ghost" size="sm" onClick={() => zoomTo(1)}>
              <RotateCcw />
            </IconButton>
          </div>
          <p className="text-xs text-fg-subtle">Format 4:3, compressé automatiquement (1 200 × 900 px et vignette) avant l’envoi.</p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            Annuler
          </Button>
          <Button variant="primary" onClick={() => void confirm()} loading={saving}>
            Utiliser cette photo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
