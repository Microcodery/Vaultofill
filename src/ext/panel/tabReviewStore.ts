import { FilledEntry, SubmitSpec } from "../../core/types";
import { StorageArea } from "../storage/storageArea";
import { createMutex, Mutex } from "./mutex";

/** A tab's review, persisted so it survives closing/reopening the panel within
 *  a browser session. `submit` lets a restored source commit without re-reading;
 *  `status` restores the last status line. */
export interface SerializedTabReview {
  domain: string;
  entries: FilledEntry[];
  submit?: SubmitSpec;
  status?: string;
}

const TAB_REVIEWS_KEY = "vaultofill:tabReviews";

/**
 * Persists per-tab reviews as one blob keyed by tabId. Backed by a
 * browser.storage.session-shaped area (session-scoped: cleared when the browser
 * session ends), so open reviews come back on panel reopen but not across a
 * browser restart. Only the single panel document writes here, so there's no
 * cross-context write contention.
 */
export class TabReviewStore {
  // Every mutation is a read-modify-write of one shared blob. Panel reads/fills
  // now run per-tab (no global lock), so two saves can be in flight at once;
  // serialize the RMW cycles here so a concurrent save can't clobber another
  // tab's entry.
  private readonly mutex: Mutex = createMutex();
  constructor(private readonly area: StorageArea) {}

  private async readAll(): Promise<Record<string, SerializedTabReview>> {
    const stored = await this.area.get(TAB_REVIEWS_KEY);
    const raw = stored[TAB_REVIEWS_KEY];
    if (typeof raw !== "string") return {};
    try {
      return JSON.parse(raw) as Record<string, SerializedTabReview>;
    } catch {
      return {};
    }
  }

  private async writeAll(all: Record<string, SerializedTabReview>): Promise<void> {
    await this.area.set({ [TAB_REVIEWS_KEY]: JSON.stringify(all) });
  }

  /** Every persisted review, keyed by numeric tabId. */
  async loadAll(): Promise<Map<number, SerializedTabReview>> {
    const all = await this.readAll();
    return new Map(Object.entries(all).map(([k, v]) => [Number(k), v]));
  }

  async save(tabId: number, review: SerializedTabReview): Promise<void> {
    await this.mutex.run(async () => {
      const all = await this.readAll();
      all[tabId] = review;
      await this.writeAll(all);
    });
  }

  async remove(tabId: number): Promise<void> {
    await this.mutex.run(async () => {
      const all = await this.readAll();
      if (!(tabId in all)) return;
      delete all[tabId];
      await this.writeAll(all);
    });
  }

  /** Drop persisted reviews for tabs that no longer exist (called on panel open
   *  after querying live tabs), so closed-while-panel-shut tabs don't linger. */
  async pruneTo(liveTabIds: Iterable<number>): Promise<void> {
    const live = new Set([...liveTabIds].map(String));
    await this.mutex.run(async () => {
      const all = await this.readAll();
      let changed = false;
      for (const key of Object.keys(all)) {
        if (!live.has(key)) {
          delete all[key];
          changed = true;
        }
      }
      if (changed) await this.writeAll(all);
    });
  }
}
