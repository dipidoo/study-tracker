/**
 * Loads track YAML files from `learning/tracker/tracks/*.yaml` in Agent.PD.
 * One file per track; one entry under `items:` per atomic study unit.
 */
import yaml from 'js-yaml';
import { fetchFileContent, listDirectory } from './gh';

export type ItemKind =
  | 'video'
  | 'book-chapter'
  | 'paper'
  | 'problem-set'
  | 'lecture-notes'
  | 'course-module'
  | 'other';

export interface TrackItem {
  id: string;
  kind: ItemKind;
  title: string;
  section?: string;
  url?: string;
  duration?: string;
  pages?: string;
  notes?: string;
  deprecated?: boolean;
}

export interface TrackSection {
  id: string;
  title: string;
}

export interface Track {
  id: string;
  title: string;
  purpose?: string;
  priority?: number;
  estimatedHours?: number;
  relevantTo?: string[];
  sections?: TrackSection[];
  items: TrackItem[];
}

export async function loadTracks(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  tracksPath: string,
): Promise<Track[]> {
  const entries = await listDirectory(token, owner, repo, branch, tracksPath);
  const files = entries.filter(
    (e) => e.type === 'file' && /\.ya?ml$/.test(e.name) && !e.name.startsWith('_'),
  );
  const tracks = await Promise.all(
    files.map((f) =>
      fetchFileContent(token, owner, repo, branch, f.path).then((text) => {
        try {
          const parsed = yaml.load(text) as Track | undefined;
          if (!parsed || !parsed.id || !Array.isArray(parsed.items)) return null;
          return parsed;
        } catch {
          return null;
        }
      }),
    ),
  );
  return tracks
    .filter((t): t is Track => t !== null)
    .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
}
