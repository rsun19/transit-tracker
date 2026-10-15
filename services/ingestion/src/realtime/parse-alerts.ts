import { transit_realtime } from 'gtfs-realtime-bindings';
import type { AlertInformedEntity, ServiceAlert } from '@transit-tracker/shared';
import { has, optionalEpoch, optionalInt, optionalString } from './proto';

/** Parent/child relationships from static stops.txt. */
export type StopHierarchy = {
  parentOf: ReadonlyMap<string, string>;
  childrenOf: ReadonlyMap<string, readonly string[]>;
};

/**
 * Parses a GTFS-RT Alerts feed.
 *
 * @param stops used to widen each alert's `stopIds` to the parent station and
 *   child platforms of every informed stop. Pass null to keep exact stop ids.
 */
export function parseAlerts(
  feed: transit_realtime.IFeedMessage,
  stops: StopHierarchy | null,
): ServiceAlert[] {
  const alerts: ServiceAlert[] = [];

  for (const entity of feed.entity ?? []) {
    const alert = entity.alert;
    if (!alert || entity.isDeleted) continue;

    const informedEntities: AlertInformedEntity[] = (alert.informedEntity ?? []).map((ie) => ({
      routeId: optionalString(ie, 'routeId') ?? optionalString(ie.trip, 'routeId'),
      routeType: optionalInt(ie, 'routeType'),
      stopId: optionalString(ie, 'stopId'),
      tripId: optionalString(ie.trip, 'tripId'),
    }));

    const stopIds = new Set<string>();
    for (const ie of informedEntities) {
      if (!ie.stopId) continue;
      stopIds.add(ie.stopId);
      if (!stops) continue;
      const parent = stops.parentOf.get(ie.stopId);
      if (parent) stopIds.add(parent);
      for (const child of stops.childrenOf.get(ie.stopId) ?? []) stopIds.add(child);
    }

    alerts.push({
      alertId: entity.id ?? '',
      headerText: englishText(alert.headerText),
      descriptionText: englishText(alert.descriptionText),
      effect: enumName(transit_realtime.Alert.Effect, alert, 'effect', 'UNKNOWN_EFFECT'),
      cause: enumName(transit_realtime.Alert.Cause, alert, 'cause', 'UNKNOWN_CAUSE'),
      activePeriods: (alert.activePeriod ?? []).map((p) => ({
        start: optionalEpoch(p, 'start'),
        end: optionalEpoch(p, 'end'),
      })),
      informedEntities,
      routeIds: unique(informedEntities.map((ie) => ie.routeId)),
      stopIds: [...stopIds],
      tripIds: unique(informedEntities.map((ie) => ie.tripId)),
    });
  }

  return alerts;
}

/** Picks the English translation (language "en" or unset), never just the first one. */
function englishText(text: transit_realtime.ITranslatedString | null | undefined): string {
  const translations = text?.translation ?? [];
  const english =
    translations.find((t) => optionalString(t, 'language')?.toLowerCase() === 'en') ??
    translations.find((t) => !optionalString(t, 'language'));
  return english?.text ?? '';
}

function enumName<T extends object>(
  values: Record<number, string>,
  msg: T,
  field: keyof T,
  fallback: string,
): string {
  if (!has(msg, field)) return fallback;
  return values[msg[field] as unknown as number] ?? fallback;
}

function unique(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => v !== null))];
}
