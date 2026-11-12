// Single source: t14's existing finite catalog. No cloned business definitions.
import {SCHEMAS, ASSET_ROOT, GENERATION} from './schema.mjs';
export {ASSET_ROOT};
export const CATALOG_VERSION = GENERATION;
export const catalog = SCHEMAS.map(c => ({
  ...c,
  services: c.services.map((v, i) => ({id: `service-${i}`, ...v})),
  staff: c.staff.map(p => ({id: p.image.replace('.jpg',''), ...p})),
}));
