import { Checkbox, cn } from '@golink/ui';
import type { RestaurantPermission } from '@golink/shared';
import { PERMISSION_GROUPS } from './permissions-catalog';

/**
 * Grille des permissions groupées par domaine. `grantable` limite les cases
 * modifiables aux droits que le membre connecté possède lui-même.
 */
export function PermissionMatrix({
  value,
  onChange,
  readOnly,
  grantable,
  compact,
}: {
  value: RestaurantPermission[];
  onChange?: (value: RestaurantPermission[]) => void;
  readOnly?: boolean;
  grantable?: (permission: RestaurantPermission) => boolean;
  compact?: boolean;
}) {
  const set = new Set(value);
  const toggle = (permission: RestaurantPermission, on: boolean) => {
    if (!onChange) return;
    onChange(on ? [...value, permission] : value.filter((p) => p !== permission));
  };
  const toggleGroup = (keys: RestaurantPermission[], on: boolean) => {
    if (!onChange) return;
    const allowed = keys.filter((k) => !grantable || grantable(k));
    onChange(on ? [...new Set([...value, ...allowed])] : value.filter((p) => !allowed.includes(p)));
  };

  return (
    <div className={cn('grid gap-4', !compact && 'lg:grid-cols-2')}>
      {PERMISSION_GROUPS.map((group) => {
        const keys = group.permissions.map((p) => p.key);
        const count = keys.filter((k) => set.has(k)).length;
        const state = count === 0 ? false : count === keys.length ? true : 'indeterminate';
        return (
          <fieldset key={group.id} className="rounded-xl border border-border bg-surface">
            <legend className="sr-only">{group.label}</legend>
            <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-2 px-4 py-2.5">
              {readOnly ? (
                <p className="text-sm font-medium text-fg">{group.label}</p>
              ) : (
                <Checkbox
                  checked={state}
                  onCheckedChange={(v) => toggleGroup(keys, v === true)}
                  label={group.label}
                  aria-label={`Tout le domaine ${group.label}`}
                />
              )}
              <span className="font-mono text-2xs text-fg-subtle num">
                {count}/{keys.length}
              </span>
            </div>
            <ul className="divide-y divide-border">
              {group.permissions.map((permission) => {
                const locked = readOnly || (grantable ? !grantable(permission.key) : false);
                return (
                  <li key={permission.key} className="px-4 py-2.5">
                    {readOnly ? (
                      <div className={cn('flex items-start gap-2.5 text-sm', !set.has(permission.key) && 'opacity-45')}>
                        <span className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', set.has(permission.key) ? 'bg-success' : 'bg-border-strong')} />
                        <div>
                          <p className="font-medium text-fg">{permission.label}</p>
                          <p className="text-xs text-fg-subtle">{permission.description}</p>
                        </div>
                      </div>
                    ) : (
                      <Checkbox
                        checked={set.has(permission.key)}
                        disabled={locked}
                        onCheckedChange={(v) => toggle(permission.key, v === true)}
                        label={permission.label}
                        description={locked ? `${permission.description} Vous ne disposez pas de ce droit.` : permission.description}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </fieldset>
        );
      })}
    </div>
  );
}
