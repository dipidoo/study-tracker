import { useEffect, useState } from 'preact/hooks';
import { authorize, clearToken, getToken, handleCallback, setToken, verifyToken } from './auth';
import { loadConfig, resolveConfig, type AppConfig } from './config';
import { loadTracks, type Track, type TrackItem } from './tracks';
import { findProjectByTitle, getDraftContentId, listProgress, type ProgressRecord, type ProjectMeta, saveResumePoint, upsertProgress } from './progress';

type View = 'dashboard' | 'track' | 'settings';

// Pre-click access labels (see AccessKind in tracks.ts).
const ACCESS_LABEL: Record<string, string> = {
  signin: 'sign-in',
  paywall: 'paywall',
  index: 'find on page',
};
const ACCESS_HINT: Record<string, string> = {
  signin: 'Free to view, but you must sign in or create an account first',
  paywall: 'Paid — the content is behind a paywall',
  index: 'Opens a course/landing page — scroll or click through to reach this specific item',
};

// ---- Video resume helpers ----
// A YouTube "copy link at current time" looks like
//   https://youtu.be/<id>?t=754   or   https://www.youtube.com/watch?v=<id>&t=754s
function extractVideoId(url?: string): string | undefined {
  if (!url) return undefined;
  const m =
    url.match(/[?&]v=([A-Za-z0-9_-]{11})/) ||
    url.match(/(?:youtu\.be|\/live|\/embed|\/shorts)\/([A-Za-z0-9_-]{11})/);
  return m ? m[1] : undefined;
}

function parseTimeToken(tok: string): number | null {
  if (/^\d+s?$/.test(tok)) return parseInt(tok, 10);
  const m = tok.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

// Parse a clipboard string → { videoId?, seconds }. Returns null if no timestamp present.
function parseClipboardTimestamp(text: string): { videoId?: string; seconds: number } | null {
  if (!text) return null;
  const t = text.match(/[?&](?:t|start)=([0-9hms]+)/i);
  if (!t) return null;
  const seconds = parseTimeToken(t[1]);
  if (seconds == null) return null;
  return { videoId: extractVideoId(text), seconds };
}

// Parse a manually typed time: mm:ss, h:mm:ss, or token forms like 1h2m3s / 12m / 90s / 754.
function parseTypedTime(s: string): number | null {
  const colon = s.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (colon) {
    const a = Number(colon[1]);
    const b = Number(colon[2]);
    const c = colon[3] != null ? Number(colon[3]) : null;
    if (c == null) return b > 59 ? null : a * 60 + b; // mm:ss
    return b > 59 || c > 59 ? null : a * 3600 + b * 60 + c; // h:mm:ss
  }
  return parseTimeToken(s);
}

// Manual-entry fallback: accept a typed time, or a pasted link / share text that carries a timestamp.
function parseManualEntry(input: string): number | null {
  const s = input.trim();
  if (!s) return null;
  const fromUrl = parseClipboardTimestamp(s);
  if (fromUrl) return fromUrl.seconds;
  return parseTypedTime(s);
}

// Prompt for a resume time (typed or pasted link). Returns seconds, or null if cancelled/invalid.
function promptResumeTime(): number | null {
  const input = prompt('Enter a time to resume from — e.g. 12:34, 1:02:03, or 12m34s. You can also paste a video link that has a timestamp.');
  if (input == null) return null; // cancelled
  const secs = parseManualEntry(input);
  if (secs == null) {
    alert(`Could not read "${input}" as a time. Use mm:ss, h:mm:ss, or forms like 12m34s / 90s.`);
    return null;
  }
  return secs;
}

// Append/replace the YouTube resume time on a URL, preserving list & index params.
function withTimestamp(url: string, seconds: number): string {
  try {
    const u = new URL(url);
    u.searchParams.delete('t');
    u.searchParams.delete('start');
    u.searchParams.set('t', `${seconds}s`);
    return u.toString();
  } catch {
    const base = url.replace(/([?&])(?:t|start)=[^&]*/gi, '$1').replace(/[?&]$/, '');
    return base + (base.includes('?') ? '&' : '?') + `t=${seconds}s`;
  }
}

function fmtTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

interface AppState {
  config: AppConfig;
  token: string;
  viewer: string;
  tracks: Track[];
  progress: ProgressRecord[];
  meta: ProjectMeta | null;
}

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('dashboard');
  const [selectedTrack, setSelectedTrack] = useState<string | null>(null);
  const [patInput, setPatInput] = useState('');

  useEffect(() => {
    bootstrap().then(setState).catch((e) => setError(String(e)));
  }, []);

  if (error) {
    return (
      <div class="root">
        <header><h1>study-tracker</h1></header>
        <p class="err">{error}</p>
        <button onClick={() => { clearToken(); location.reload(); }}>sign out & reload</button>
      </div>
    );
  }

  if (!state) {
    if (getToken()) return <div class="root">loading…</div>;
    return (
      <div class="root">
        <header><h1>study-tracker</h1></header>
        <button onClick={async () => { const cfg = await loadConfig(); authorize(cfg); }}>sign in with GitHub</button>
        <details style={{ marginTop: '1rem' }}>
          <summary class="dim">or paste a personal access token</summary>
          <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem' }}>
            <input
              type="password"
              placeholder="ghp_… or github_pat_…"
              value={patInput}
              onInput={(e) => setPatInput((e.target as HTMLInputElement).value)}
            />
            <button
              onClick={() => {
                if (!patInput.trim()) return;
                setToken(patInput.trim());
                location.reload();
              }}
            >use token</button>
          </div>
          <p class="dim" style={{ fontSize: '0.8rem' }}>Needs <code>Contents: Read</code> + <code>Projects: Read and write</code> (fine-grained PAT).</p>
        </details>
      </div>
    );
  }

  return (
    <div class="root">
      <header>
        <h1>study-tracker</h1>
        <nav>
          <button onClick={() => setView('dashboard')}>dashboard</button>
          <button onClick={() => setView('settings')}>settings</button>
          <span class="who">{state.viewer}</span>
          <button onClick={() => { clearToken(); location.reload(); }}>sign out</button>
        </nav>
      </header>
      {view === 'dashboard' && (
        <Dashboard state={state} onSelectTrack={(id) => { setSelectedTrack(id); setView('track'); }} />
      )}
      {view === 'track' && selectedTrack && (
        <TrackDetail
          state={state}
          trackId={selectedTrack}
          onBack={() => setView('dashboard')}
          onApplyPatch={(updated) => {
            // Merge the patched record into local progress cache without refetching the board.
            const next = state.progress.filter((r) => r.itemId !== updated.itemId);
            next.push(updated);
            setState({ ...state, progress: next });
          }}
        />
      )}
      {view === 'settings' && (
        <Settings projectMissing={!state.meta} prefix={state.config.projectPrefix} tracksPath={state.config.contentSource.tracksPath} />
      )}
    </div>
  );
}

async function bootstrap(): Promise<AppState | null> {
  const base = await loadConfig();
  const cb = await handleCallback(base);
  if (cb.kind === 'error') throw new Error(cb.error ?? 'auth callback failed');
  const token = getToken();
  if (!token) return null;
  const viewer = await verifyToken(token);
  if (!viewer) {
    clearToken();
    return null;
  }
  const config = resolveConfig(base, viewer.login);
  const tracks = await loadTracks(
    token,
    config.contentSource.owner,
    config.contentSource.repo,
    config.contentSource.branch,
    config.contentSource.tracksPath,
  );
  const meta = await findProjectByTitle(token, viewer.login, `${config.projectPrefix}progress`);
  const progress = meta ? await listProgress(token, meta) : [];
  return { config, token, viewer: viewer.login, tracks, progress, meta };
}

function progressForTrack(track: Track, progress: ProgressRecord[]): { done: number; total: number } {
  const itemIds = new Set(track.items.filter((i) => !i.deprecated).map((i) => i.id));
  let done = 0;
  for (const r of progress) {
    if (r.status === 'completed' && itemIds.has(r.unitId)) done += 1;
  }
  return { done, total: itemIds.size };
}

function Dashboard({ state, onSelectTrack }: { state: AppState; onSelectTrack: (id: string) => void }) {
  return (
    <div>
      {!state.meta && (
        <p class="warn">
          ProjectV2 board <code>{state.config.projectPrefix}progress</code> not found on @{state.viewer}.{' '}
          See <a href="https://github.com/dipidoo/Agent.PD/blob/main/learning/tracker/SYNC-DESIGN.md" target="_blank">SYNC-DESIGN.md §7</a> to create it. Dashboard reads work but check-offs won't persist until the board exists.
        </p>
      )}
      <section>
        <h2>Tracks</h2>
        {state.tracks.length === 0 && <p class="dim">No tracks found at <code>{state.config.contentSource.tracksPath}</code>.</p>}
        <ul class="tracks">
          {state.tracks.map((t) => {
            const p = progressForTrack(t, state.progress);
            const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
            return (
              <li key={t.id} class="track-row" onClick={() => onSelectTrack(t.id)}>
                <span class="priority">{t.priority ?? '·'}</span>
                <span class="title">
                  <strong>{t.title}</strong>
                  {t.purpose && <><br /><span class="dim">{t.purpose}</span></>}
                </span>
                <span class="bar"><span style={{ width: `${pct}%` }} /></span>
                <span class="count">{p.done}/{p.total}</span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function TrackDetail({
  state,
  trackId,
  onBack,
  onApplyPatch,
}: {
  state: AppState;
  trackId: string;
  onBack: () => void;
  onApplyPatch: (updated: ProgressRecord) => void;
}) {
  const track = state.tracks.find((t) => t.id === trackId);
  if (!track) return <p>not found <button onClick={onBack}>back</button></p>;

  const byItem = new Map(state.progress.map((r) => [r.unitId, r]));
  const sectionTitle = new Map((track.sections ?? []).map((s) => [s.id, s.title]));
  const sectionOrder = (track.sections ?? []).map((s) => s.id);

  const grouped = new Map<string, TrackItem[]>();
  for (const id of sectionOrder) grouped.set(id, []);
  for (const item of track.items) {
    if (item.deprecated) continue;
    const sec = item.section ?? '__';
    if (!grouped.has(sec)) grouped.set(sec, []);
    grouped.get(sec)!.push(item);
  }

  // Save a resume point for a video. Prefers a YouTube "copy link at current time"
  // from the clipboard; if the clipboard has no usable timestamp (or can't be read),
  // falls back to letting the user type a time manually.
  async function setResume(item: TrackItem) {
    if (!track || !item.url) return;

    let clip = '';
    try {
      clip = await navigator.clipboard.readText();
    } catch {
      clip = ''; // clipboard blocked or empty — fall through to manual entry
    }
    const fromClip = parseClipboardTimestamp(clip);

    let seconds: number | null;
    if (fromClip) {
      const vid = extractVideoId(item.url);
      const mismatch = !!(vid && fromClip.videoId && vid !== fromClip.videoId);
      if (mismatch && !confirm('The clipboard link is a different video than this item. Save its timestamp here anyway? (Cancel to type a time instead.)')) {
        seconds = promptResumeTime();
      } else {
        seconds = fromClip.seconds;
      }
    } else {
      // Nothing useful in the clipboard — let the user type a timestamp.
      seconds = promptResumeTime();
    }
    if (seconds == null) return; // cancelled or unparseable

    if (!state.meta) {
      alert(`ProjectV2 board "${state.config.projectPrefix}progress" not found. Create it first to save progress.`);
      return;
    }
    const rec = byItem.get(item.id);
    try {
      let itemId = rec?.itemId;
      let contentId = rec?.contentId;
      if (!itemId) {
        const ensured = await upsertProgress(
          state.token,
          state.meta,
          item.id,
          track.id,
          `${track.id} :: ${item.title}`,
          { status: 'in-progress' },
        );
        itemId = ensured.itemId;
        contentId = ensured.contentId;
      }
      if (!contentId) contentId = await getDraftContentId(state.token, itemId);
      if (!contentId) {
        alert('Could not locate the progress record to save into.');
        return;
      }
      const newBody = await saveResumePoint(state.token, contentId, seconds, rec?.notes);
      onApplyPatch({
        itemId,
        unitId: item.id,
        status: rec?.status ?? 'in-progress',
        confidence: rec?.confidence,
        minutesSpent: rec?.minutesSpent,
        completedAt: rec?.completedAt,
        notes: newBody,
        contentId,
        resumeSeconds: seconds,
      });
    } catch (e) {
      alert('Failed to save resume point: ' + String(e));
    }
  }

  return (
    <div>
      <button onClick={onBack}>← back</button>
      <h2>{track.title}</h2>
      {track.purpose && <p class="dim">{track.purpose}</p>}
      {track.estimatedHours && <p class="dim">Estimated total: {track.estimatedHours}h</p>}
      {[...grouped.entries()].map(([secId, items]) => (
        <section key={secId}>
          {secId !== '__' && <h3>{sectionTitle.get(secId) ?? secId}</h3>}
          <ul class="items">
            {items.map((item) => {
              const rec = byItem.get(item.id);
              const done = rec?.status === 'completed';
              const isVideo = item.kind === 'video' && !!item.url;
              const resumeSeconds = rec?.resumeSeconds;
              const href = isVideo && resumeSeconds != null ? withTimestamp(item.url!, resumeSeconds) : item.url;
              return (
                <li key={item.id} class={done ? 'item done' : 'item'}>
                  <input
                    type="checkbox"
                    checked={done}
                    onChange={async (e) => {
                      if (!state.meta) {
                        alert(`ProjectV2 board "${state.config.projectPrefix}progress" not found. Create it first.`);
                        (e.currentTarget as HTMLInputElement).checked = false;
                        return;
                      }
                      const checked = (e.currentTarget as HTMLInputElement).checked;
                      const updated = await upsertProgress(
                        state.token,
                        state.meta,
                        item.id,
                        track.id,
                        `${track.id} :: ${item.title}`,
                        {
                          status: checked ? 'completed' : 'in-progress',
                          completedAt: checked ? new Date().toISOString().slice(0, 10) : undefined,
                        },
                        rec?.itemId, // pass cached itemId if known — no board scan
                      );
                      onApplyPatch(updated);
                    }}
                  />
                  <span class={`kind kind-${item.kind}`}>{item.kind}</span>
                  <span class="item-title">
                    {item.url ? (
                      <a href={href} target="_blank" rel="noreferrer">{item.title}</a>
                    ) : (
                      item.title
                    )}
                    {item.access && ACCESS_LABEL[item.access] && (
                      <> <span class={`access access-${item.access}`} title={ACCESS_HINT[item.access]}>{ACCESS_LABEL[item.access]}</span></>
                    )}
                    {isVideo && (
                      <><br />
                        <span class="resume-row">
                          {resumeSeconds != null && (
                            <a
                              class="resume-chip"
                              href={withTimestamp(item.url!, resumeSeconds)}
                              target="_blank"
                              rel="noreferrer"
                              title="Open the video at your saved resume time"
                            >▶ {fmtTime(resumeSeconds)}</a>
                          )}
                          <button
                            class="resume-btn"
                            type="button"
                            onClick={() => setResume(item)}
                            title='Reads a copied YouTube link with a timestamp (Share → "Start at", or right-click → "Copy video URL at current time"). If the clipboard has none, you can type a time like 12:34.'
                          >{resumeSeconds != null ? 'update resume point' : 'set resume point'}</button>
                        </span>
                      </>
                    )}
                    {item.notes && <><br /><span class="dim">{item.notes}</span></>}
                  </span>
                  <span class="duration dim">{item.duration ?? ''}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Settings({ projectMissing, prefix, tracksPath }: { projectMissing: boolean; prefix: string; tracksPath: string }) {
  return (
    <section>
      <h2>Settings</h2>
      {projectMissing && (
        <p class="warn">
          Create ProjectV2 board <code>{prefix}progress</code> on your account. Schema in{' '}
          <a href="https://github.com/dipidoo/Agent.PD/blob/main/learning/tracker/SYNC-DESIGN.md" target="_blank">SYNC-DESIGN.md §7</a>.
        </p>
      )}
      <p>
        Content source: <code>{tracksPath}/*.yaml</code>. Each YAML file = one track of atomic items.
      </p>
      <p>
        OAuth App is <strong>shared with anki-client</strong>. The OAuth App's callback URL must be{' '}
        <code>https://dipidoo.github.io/</code> (origin-only) so both <code>/anki-client/</code> and{' '}
        <code>/study-tracker/</code> work.
      </p>
      <p class="dim">
        Override <code>config.json</code> via <code>localStorage["study-tracker:config"]</code>. PAT override:{' '}
        <code>localStorage["study-tracker:gh_token"]</code>.
      </p>
    </section>
  );
}
