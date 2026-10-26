import type { ProfileSettings } from '../../config/appConfig.js';
import type { DatabaseConnection } from '../database.js';

export interface ProfileRecord extends ProfileSettings {
  createdAt: string;
  updatedAt: string;
}

export function saveProfile(
  db: DatabaseConnection,
  profile: ProfileSettings,
  now: Date = new Date(),
): void {
  db.prepare(
    `INSERT INTO profile
       (id, display_name, locale, timezone, age_band, preferences_json, created_at, updated_at)
     VALUES (1, ?, ?, ?, ?, '{}', ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       display_name = excluded.display_name,
       locale = excluded.locale,
       timezone = excluded.timezone,
       age_band = excluded.age_band,
       updated_at = excluded.updated_at`,
  ).run(
    profile.displayName,
    profile.locale,
    profile.timezone,
    profile.ageBand,
    now.toISOString(),
    now.toISOString(),
  );
}

export function getProfile(db: DatabaseConnection): ProfileRecord | null {
  const row = db
    .prepare(
      'SELECT display_name, locale, timezone, age_band, created_at, updated_at FROM profile WHERE id = 1',
    )
    .get() as
    | {
        display_name: string;
        locale: string;
        timezone: string;
        age_band: string;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  if (!row) {
    return null;
  }
  return {
    displayName: row.display_name,
    locale: 'zh-CN',
    timezone: row.timezone,
    ageBand: row.age_band as ProfileSettings['ageBand'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
