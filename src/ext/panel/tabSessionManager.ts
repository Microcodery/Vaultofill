/**
 * Tracks one review session per browser tab and swaps which one is on screen as
 * the user switches tabs — so several forms can be mid-review at once, each in
 * its own tab, sharing the single model. The manager is view-agnostic: it owns
 * the tabId→session map and the "which tab is showing" pointer, and calls back to
 * mount/unmount/destroy the caller's DOM. Only the active tab's session is
 * mounted; the rest keep their state detached in memory.
 */
export interface TabSessionManagerOpts<S> {
  /** Build a fresh session for a tab (does not mount it). */
  create: (tabId: number) => S;
  /** Make this session the visible one. Called for the active tab's session. */
  mount: (session: S) => void;
  /** Hide the previously-active session (its state is kept for later). */
  unmount: (session: S) => void;
  /** The active tab has no session yet — show a placeholder. */
  onEmpty?: (tabId: number) => void;
  /** Tear down a session's resources when its tab closes. */
  destroy?: (session: S) => void;
}

export class TabSessionManager<S> {
  private readonly sessions = new Map<number, S>();
  private activeTabId?: number;

  constructor(private readonly opts: TabSessionManagerOpts<S>) {}

  get(tabId: number): S | undefined {
    return this.sessions.get(tabId);
  }

  has(tabId: number): boolean {
    return this.sessions.has(tabId);
  }

  /** The session for a tab, creating a bare one on first use. Does not change
   *  what's mounted — call activate() to show it. */
  ensure(tabId: number): S {
    let session = this.sessions.get(tabId);
    if (!session) {
      session = this.opts.create(tabId);
      this.sessions.set(tabId, session);
    }
    return session;
  }

  currentTabId(): number | undefined {
    return this.activeTabId;
  }

  isActive(tabId: number): boolean {
    return this.activeTabId === tabId;
  }

  tabIds(): number[] {
    return [...this.sessions.keys()];
  }

  /** Show the given tab: unmount the previously-active session, then mount this
   *  tab's session (or show the placeholder if it has none yet). Mounting the
   *  already-active tab is a no-op re-mount, used to reveal a just-created
   *  session for the tab being read. */
  activate(tabId: number): void {
    const prev = this.active();
    if (prev && this.activeTabId !== tabId) this.opts.unmount(prev);
    this.activeTabId = tabId;
    const next = this.sessions.get(tabId);
    if (next) this.opts.mount(next);
    else this.opts.onEmpty?.(tabId);
  }

  /** Drop a tab's session (its tab closed). If it was on screen, unmount it
   *  first; the next activate() (from the browser's tab switch) shows the new
   *  active tab. */
  remove(tabId: number): void {
    const session = this.sessions.get(tabId);
    if (!session) return;
    if (this.activeTabId === tabId) {
      this.opts.unmount(session);
      this.activeTabId = undefined;
    }
    this.opts.destroy?.(session);
    this.sessions.delete(tabId);
  }

  private active(): S | undefined {
    return this.activeTabId !== undefined ? this.sessions.get(this.activeTabId) : undefined;
  }
}
