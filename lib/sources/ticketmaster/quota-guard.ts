import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  TicketmasterQuotaCorruptionError,
  TicketmasterQuotaExceededError,
  TicketmasterQuotaLockError,
  TicketmasterQuotaPersistenceError,
} from './errors';

export const TICKETMASTER_DAILY_LIMIT = 5000;
export const TICKETMASTER_WARNING_THRESHOLD = 4000;
export const TICKETMASTER_CIRCUIT_BREAKER_THRESHOLD = 4750;

export interface QuotaGuardOptions {
  dailyLimit?: number;
  warningThreshold?: number;
  circuitBreakerThreshold?: number;
  initialCount?: number;
  getCurrentDate?: () => Date;
  persistFilePath?: string | null;
  lockWaitMs?: number;
  onWarning?: (status: TicketmasterQuotaStatus) => void;
  onCircuitBreaker?: (status: TicketmasterQuotaStatus) => void;
}

export interface TicketmasterQuotaStatus {
  count: number;
  dailyLimit: number;
  remaining: number;
  warningThreshold: number;
  circuitBreakerThreshold: number;
  isWarning: boolean;
  isCircuitBroken: boolean;
  isCorrupted?: boolean;
  dateKey: string;
  resetAtUtc: string;
  providerResetAtUtc?: string;
  persistedFilePath?: string;
}

export interface RecordRequestOptions {
  isEssential?: boolean;
}

export interface ProviderQuotaHeaders {
  limit?: number;
  available?: number;
  reset?: number;
}

/**
 * Tracks Ticketmaster Discovery API daily request quota, enforces warning threshold,
 * trips circuit breaker at 4,750 requests (blocking non-essential sync), and automatically
 * resets at UTC midnight or when provider reset window occurs.
 *
 * Supports cross-process shared state via atomic file locking and provider header reconciliation.
 * Implements strict FAIL-CLOSED safety: lock acquisition failures and corrupted state throw errors
 * rather than allowing uncoordinated requests or restoring full budgets.
 */
export class TicketmasterQuotaGuard {
  readonly dailyLimit: number;
  readonly warningThreshold: number;
  readonly circuitBreakerThreshold: number;
  private count: number;
  private currentDateKey: string;
  private warningEmitted: boolean = false;
  private circuitBreakerEmitted: boolean = false;
  private isCorrupted: boolean = false;
  private corruptionReason?: string;
  private getCurrentDate: () => Date;
  private persistFilePath: string | null;
  private lockWaitMs: number;
  private providerResetAtUtc?: string;
  private onWarning?: (status: TicketmasterQuotaStatus) => void;
  private onCircuitBreaker?: (status: TicketmasterQuotaStatus) => void;
  private activeLockId: string | null = null;

  constructor(options?: QuotaGuardOptions) {
    this.dailyLimit = options?.dailyLimit ?? TICKETMASTER_DAILY_LIMIT;
    this.warningThreshold =
      options?.warningThreshold ?? TICKETMASTER_WARNING_THRESHOLD;
    this.circuitBreakerThreshold =
      options?.circuitBreakerThreshold ??
      TICKETMASTER_CIRCUIT_BREAKER_THRESHOLD;
    this.getCurrentDate = options?.getCurrentDate ?? (() => new Date());
    this.lockWaitMs = options?.lockWaitMs ?? 5000;
    this.count = options?.initialCount ?? 0;
    this.onWarning = options?.onWarning;
    this.onCircuitBreaker = options?.onCircuitBreaker;

    // Use explicit path or env var; otherwise null for pure in-memory isolation
    if (options?.persistFilePath !== undefined) {
      this.persistFilePath = options.persistFilePath;
    } else if (process.env.TM_QUOTA_FILE) {
      this.persistFilePath = process.env.TM_QUOTA_FILE;
    } else {
      this.persistFilePath = null;
    }

    const initialDate = this.getCurrentDate();
    this.currentDateKey = this.getUtcDateKey(initialDate);

    // Note: Do NOT perform unlocked loadPersistedState() in constructor to prevent
    // TOCTOU race conditions with concurrent processes. All state hydration occurs
    // safely inside withFileLock() during guarded method calls.
  }

  private getUtcDateKey(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  private getNextUtcMidnightIso(d: Date): string {
    const nextMidnight = new Date(
      Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth(),
        d.getUTCDate() + 1,
        0,
        0,
        0,
        0,
      ),
    );
    return nextMidnight.toISOString();
  }

  private verifyLockOwnership(lockPath: string, expectedLockId: string): void {
    if (!fs.existsSync(lockPath)) {
      throw new TicketmasterQuotaLockError(
        `Lock ownership lost: lock file at ${lockPath} no longer exists.`,
        { lockPath },
      );
    }
    try {
      const content = fs.readFileSync(lockPath, 'utf8');
      const meta = JSON.parse(content);
      if (!meta || meta.lockId !== expectedLockId) {
        throw new TicketmasterQuotaLockError(
          `Lock ownership lost: lock file at ${lockPath} was overtaken by another process.`,
          { lockPath },
        );
      }
    } catch (err) {
      if (err instanceof TicketmasterQuotaLockError) throw err;
      throw new TicketmasterQuotaLockError(
        `Lock ownership lost: lock file at ${lockPath} is invalid or unreadable: ${(err as Error).message}`,
        { lockPath, cause: err },
      );
    }
  }

  /**
   * Executes a callback within an atomic process-safe file lock.
   * If persistFilePath is null, executes immediately without locking.
   *
   * FAIL-CLOSED:
   * - If lock cannot be acquired within timeout, throws TicketmasterQuotaLockError.
   * - If filesystem throws an unrecoverable error, throws TicketmasterQuotaLockError.
   * - Reclaims abandoned lock ONLY when the owning process is demonstrably dead (ESRCH).
   * - NEVER reclaims a lock while the owning process is alive, regardless of elapsed time.
   * - Safely releases only the lock matching the current process's lockId.
   */
  private withFileLock<T>(fn: () => T): T {
    if (!this.persistFilePath) {
      return fn();
    }

    const lockPath = `${this.persistFilePath}.lock`;
    const maxWaitMs = this.lockWaitMs;
    const start = Date.now();
    let fd: number | null = null;
    let acquired = false;
    const currentLockId = crypto.randomUUID();

    while (!acquired) {
      try {
        fd = fs.openSync(lockPath, 'wx');
        try {
          const lockMeta = JSON.stringify({
            pid: process.pid,
            lockId: currentLockId,
            createdAt: Date.now(),
          });
          fs.writeSync(fd, lockMeta, 0, 'utf8');
          fs.fsyncSync(fd);
        } catch (writeErr) {
          try {
            fs.closeSync(fd);
          } catch {}
          try {
            fs.unlinkSync(lockPath);
          } catch {}
          throw writeErr;
        }
        acquired = true;
        this.activeLockId = currentLockId;
      } catch (err: unknown) {
        const error = err as { code?: string; message?: string };
        if (error && error.code === 'EEXIST') {
          // Inspect lock file to check if holder is demonstrably dead
          try {
            if (fs.existsSync(lockPath)) {
              let isDeadProcess = false;
              let deadLockId: string | null = null;

              try {
                const content = fs.readFileSync(lockPath, 'utf8');
                if (content && content.trim().length > 0) {
                  const meta = JSON.parse(content);
                  if (
                    typeof meta.pid === 'number' &&
                    Number.isInteger(meta.pid) &&
                    meta.pid > 0 &&
                    typeof meta.lockId === 'string' &&
                    meta.lockId.trim().length > 0
                  ) {
                    try {
                      // Signal 0 tests process existence without terminating it
                      process.kill(meta.pid, 0);
                      // Process exists and is alive!
                      isDeadProcess = false;
                    } catch (killErr: unknown) {
                      const kErr = killErr as { code?: string };
                      if (kErr && kErr.code === 'ESRCH') {
                        // ESRCH: No such process. The holder is demonstrably dead.
                        isDeadProcess = true;
                        deadLockId = meta.lockId.trim();
                      } else if (kErr && kErr.code === 'EPERM') {
                        // EPERM: Process exists and is alive (different user/permissions).
                        isDeadProcess = false;
                      } else {
                        isDeadProcess = false;
                      }
                    }
                  }
                  // If meta.pid or meta.lockId is invalid, ownership cannot be established safely.
                  // FAIL-CLOSED: Do NOT reclaim or delete.
                }
              } catch {
                // If content is empty or unparseable, ownership cannot be established safely.
                // FAIL-CLOSED: Do NOT delete.
              }

              if (isDeadProcess && deadLockId) {
                // SAFE ATOMIC RECLAMATION PROTOCOL:
                // Prevent race conditions where multiple workers observe the same dead process lock.
                // If Worker A and Worker B both see deadLockId, Worker A unlinks it and acquires a
                // replacement lock; Worker B MUST NOT delete Worker A's fresh replacement lock.
                //
                // Coordinate reclamation using an exclusive token file keyed by deadLockId:
                const reclaimTokenPath = `${lockPath}.${deadLockId}.reclaim`;
                let tokenFd: number | null = null;
                try {
                  tokenFd = fs.openSync(reclaimTokenPath, 'wx');
                  // Only the single winning worker reaches here!
                  const tokenMeta = JSON.stringify({
                    pid: process.pid,
                    deadLockId,
                    createdAt: Date.now(),
                  });
                  fs.writeSync(tokenFd, tokenMeta, 0, 'utf8');
                  fs.fsyncSync(tokenFd);

                  // Double-check: does lockPath STILL exist and STILL have deadLockId?
                  if (fs.existsSync(lockPath)) {
                    try {
                      const currentContent = fs.readFileSync(lockPath, 'utf8');
                      const currentMeta = JSON.parse(currentContent);
                      if (currentMeta && currentMeta.lockId === deadLockId) {
                        fs.unlinkSync(lockPath);
                      }
                    } catch {
                      // Lock file already unlinked or modified
                    }
                  }
                } catch (tokenErr: unknown) {
                  // Another worker already won reclamation of deadLockId, OR token exists.
                  const tErr = tokenErr as { code?: string };
                  if (tErr && tErr.code === 'EEXIST') {
                    try {
                      if (fs.existsSync(reclaimTokenPath)) {
                        const tokenContent = fs.readFileSync(
                          reclaimTokenPath,
                          'utf8',
                        );
                        const tMeta = JSON.parse(tokenContent);
                        if (typeof tMeta.pid === 'number') {
                          try {
                            process.kill(tMeta.pid, 0);
                          } catch (killErr: unknown) {
                            if (
                              (killErr as { code?: string })?.code === 'ESRCH'
                            ) {
                              // Reclaimer process died mid-reclamation; remove orphaned token
                              try {
                                fs.unlinkSync(reclaimTokenPath);
                              } catch {}
                            }
                          }
                        }
                      }
                    } catch {
                      // ignore token cleanup error
                    }
                  }
                } finally {
                  if (tokenFd !== null) {
                    try {
                      fs.closeSync(tokenFd);
                    } catch {}
                    try {
                      fs.unlinkSync(reclaimTokenPath);
                    } catch {}
                  }
                }
                continue; // Retry lock acquisition immediately
              }
            }
          } catch {
            // Lock was released in the meantime
            continue;
          }

          if (Date.now() - start > maxWaitMs) {
            // FAIL-CLOSED: Refuse uncoordinated execution on lock timeout
            throw new TicketmasterQuotaLockError(
              `Failed to acquire Ticketmaster quota lock at ${lockPath} within ${maxWaitMs}ms. Refusing execution in fail-closed mode to prevent quota violations.`,
              { lockPath, waitMs: maxWaitMs },
            );
          }

          // Backoff with jitter before retry
          const backoffMs = 5 + Math.floor(Math.random() * 20);
          try {
            Atomics.wait(
              new Int32Array(new SharedArrayBuffer(4)),
              0,
              0,
              backoffMs,
            );
          } catch {
            const spinStart = Date.now();
            while (Date.now() - spinStart < backoffMs) {
              // brief synchronous spin
            }
          }
        } else {
          // FAIL-CLOSED: Other filesystem error (e.g. EACCES, ENOSPC, EROFS)
          throw new TicketmasterQuotaLockError(
            `Filesystem error accessing Ticketmaster quota lock at ${lockPath}: ${error?.message || String(err)}`,
            { lockPath, cause: err },
          );
        }
      }
    }

    try {
      return fn();
    } finally {
      this.activeLockId = null;
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch {
          // ignore
        }
      }
      if (acquired && currentLockId) {
        try {
          if (fs.existsSync(lockPath)) {
            const content = fs.readFileSync(lockPath, 'utf8');
            try {
              const meta = JSON.parse(content);
              if (meta && meta.lockId === currentLockId) {
                fs.unlinkSync(lockPath);
              }
            } catch {
              // If unparseable, do not delete to avoid clobbering another lock
            }
          }
        } catch {
          // ignore unlink errors
        }
      }
    }
  }

  /**
   * Loads persisted quota state from disk.
   * FAIL-CLOSED: Corrupted state sets isCorrupted flag, blocking subsequent requests
   * rather than silently resetting count to 0.
   */
  private loadPersistedState(): void {
    if (!this.persistFilePath) return;
    try {
      if (fs.existsSync(this.persistFilePath)) {
        const raw = fs.readFileSync(this.persistFilePath, 'utf8');
        let data: {
          dateKey?: unknown;
          count?: unknown;
          dailyLimit?: unknown;
          providerResetAtUtc?: unknown;
        };
        try {
          data = JSON.parse(raw);
        } catch (parseErr) {
          // FAIL-CLOSED: Corrupted state file must not silently reset budget to 0
          this.isCorrupted = true;
          this.corruptionReason = `JSON parse failed: ${(parseErr as Error).message}`;
          return;
        }

        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          this.isCorrupted = true;
          this.corruptionReason = 'State file contains non-object data';
          return;
        }

        if (
          data.count !== undefined &&
          (typeof data.count !== 'number' ||
            isNaN(data.count) ||
            data.count < 0 ||
            !Number.isInteger(data.count))
        ) {
          this.isCorrupted = true;
          this.corruptionReason = `State file contains invalid count value: ${JSON.stringify(data.count)}`;
          return;
        }

        if (
          data.dateKey !== undefined &&
          (typeof data.dateKey !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}$/.test(data.dateKey))
        ) {
          this.isCorrupted = true;
          this.corruptionReason = `State file contains invalid dateKey format: ${JSON.stringify(data.dateKey)}`;
          return;
        }

        this.isCorrupted = false;
        this.corruptionReason = undefined;

        if (typeof data.dateKey === 'string') {
          this.currentDateKey = data.dateKey;
        }
        if (typeof data.count === 'number') {
          // Synchronize to the authoritative count in the lock-guarded file
          this.count = data.count;
        }
        if (typeof data.providerResetAtUtc === 'string') {
          this.providerResetAtUtc = data.providerResetAtUtc;
        }
        this.warningEmitted = this.count >= this.warningThreshold;
        this.circuitBreakerEmitted = this.count >= this.circuitBreakerThreshold;
      }
    } catch (readErr) {
      // If file unreadable due to filesystem error, fail closed
      this.isCorrupted = true;
      this.corruptionReason = `Read error: ${(readErr as Error).message}`;
    }
  }

  /**
   * Saves updated quota count to disk atomically using temporary file rename.
   * FAIL-CLOSED: Throws TicketmasterQuotaPersistenceError on failure.
   */
  private savePersistedState(): void {
    if (!this.persistFilePath) return;
    if (this.activeLockId) {
      this.verifyLockOwnership(
        `${this.persistFilePath}.lock`,
        this.activeLockId,
      );
    }
    try {
      const payload = {
        dateKey: this.currentDateKey,
        count: this.count,
        dailyLimit: this.dailyLimit,
        providerResetAtUtc: this.providerResetAtUtc,
        updatedAt: new Date().toISOString(),
      };
      const tmpPath = `${this.persistFilePath}.tmp.${Date.now()}_${Math.random().toString(36).slice(2)}`;
      fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.persistFilePath);
    } catch (saveErr) {
      if (saveErr instanceof TicketmasterQuotaLockError) throw saveErr;
      throw new TicketmasterQuotaPersistenceError(
        `Failed to save persisted quota state to ${this.persistFilePath}: ${(saveErr as Error).message}`,
        { filePath: this.persistFilePath, cause: saveErr },
      );
    }
  }

  /**
   * Synchronizes quota usage directly from official Ticketmaster response headers:
   * - rate-limit (e.g. 5000)
   * - rate-limit-available (e.g. 4998)
   * - rate-limit-reset (timestamp in ms)
   */
  syncFromHeaders(headers: ProviderQuotaHeaders): void {
    this.withFileLock(() => {
      this.loadPersistedState();
      if (this.isCorrupted) {
        throw new TicketmasterQuotaCorruptionError(
          `Cannot sync from headers: Ticketmaster quota state is corrupted (${this.corruptionReason}). Failing closed.`,
          { filePath: this.persistFilePath || undefined },
        );
      }
      this.checkDateReset();
      if (
        typeof headers.limit === 'number' &&
        typeof headers.available === 'number'
      ) {
        const observedUsed = Math.max(0, headers.limit - headers.available);
        if (observedUsed > this.count) {
          this.count = observedUsed;
        }
        if (headers.available <= 0) {
          this.count = Math.max(this.count, this.dailyLimit);
        }
      }
      if (typeof headers.reset === 'number' && headers.reset > 0) {
        try {
          this.providerResetAtUtc = new Date(headers.reset).toISOString();
        } catch {
          // ignore invalid timestamp
        }
      }
      this.savePersistedState();
    });
  }

  /**
   * Checks if the date has crossed UTC midnight. If so, automatically resets counter,
   * UNLESS the provider indicates quota is still exhausted or providerResetAtUtc is in the future.
   */
  private checkDateReset(): void {
    if (this.isCorrupted) {
      return;
    }
    const now = this.getCurrentDate();
    const todayKey = this.getUtcDateKey(now);

    // If providerResetAtUtc is set and in the future, do NOT reset accounting to 0 upon crossing midnight
    if (this.providerResetAtUtc) {
      const resetTime = new Date(this.providerResetAtUtc).getTime();
      if (!isNaN(resetTime)) {
        if (now.getTime() < resetTime) {
          // Provider quota window is still in effect and exhausted
          return;
        } else {
          // Provider reset time has elapsed
          this.providerResetAtUtc = undefined;
        }
      } else {
        this.providerResetAtUtc = undefined;
      }
    }

    if (todayKey !== this.currentDateKey) {
      this.currentDateKey = todayKey;
      this.count = 0;
      this.warningEmitted = false;
      this.circuitBreakerEmitted = false;
      this.savePersistedState();
    }
  }

  private getStatusInternal(): TicketmasterQuotaStatus {
    const now = this.getCurrentDate();
    const remaining = Math.max(0, this.dailyLimit - this.count);
    const isWarning = this.count >= this.warningThreshold;
    const isCircuitBroken = this.count >= this.circuitBreakerThreshold;

    return {
      count: this.count,
      dailyLimit: this.dailyLimit,
      remaining,
      warningThreshold: this.warningThreshold,
      circuitBreakerThreshold: this.circuitBreakerThreshold,
      isWarning,
      isCircuitBroken,
      isCorrupted: this.isCorrupted,
      dateKey: this.currentDateKey,
      resetAtUtc: this.providerResetAtUtc || this.getNextUtcMidnightIso(now),
      providerResetAtUtc: this.providerResetAtUtc,
      persistedFilePath: this.persistFilePath || undefined,
    };
  }

  /**
   * Returns current status of quota budget.
   */
  getStatus(): TicketmasterQuotaStatus {
    return this.withFileLock(() => {
      this.loadPersistedState();
      this.checkDateReset();
      return this.getStatusInternal();
    });
  }

  /**
   * Determines if a request can be executed without exceeding budget or circuit breaker limits.
   * FAIL-CLOSED: Returns allowed: false if state file is corrupted.
   */
  canExecute(options?: RecordRequestOptions): {
    allowed: boolean;
    reason?: string;
  } {
    return this.withFileLock(() => {
      this.loadPersistedState();
      if (this.isCorrupted) {
        return {
          allowed: false,
          reason: `Ticketmaster quota state is corrupted (${this.corruptionReason}). Failing closed.`,
        };
      }

      this.checkDateReset();
      const isEssential = options?.isEssential ?? false;

      if (this.count >= this.dailyLimit) {
        return {
          allowed: false,
          reason: `Ticketmaster daily quota limit of ${this.dailyLimit} requests has been reached.`,
        };
      }

      if (!isEssential && this.count >= this.circuitBreakerThreshold) {
        return {
          allowed: false,
          reason: `Ticketmaster circuit breaker tripped at ${this.count}/${this.dailyLimit} requests. Non-essential requests refused.`,
        };
      }

      return { allowed: true };
    });
  }

  /**
   * Checks quota and records a request. Throws TicketmasterQuotaExceededError if limit is reached
   * or if non-essential request arrives when circuit breaker is tripped.
   * FAIL-CLOSED: Throws TicketmasterQuotaCorruptionError if state file is corrupted.
   */
  recordRequest(options?: RecordRequestOptions): TicketmasterQuotaStatus {
    return this.withFileLock(() => {
      this.loadPersistedState();
      if (this.isCorrupted) {
        throw new TicketmasterQuotaCorruptionError(
          `Ticketmaster quota state file at ${this.persistFilePath} is corrupted (${this.corruptionReason}). Failing closed to prevent exceeding daily request limit.`,
          { filePath: this.persistFilePath || undefined },
        );
      }

      this.checkDateReset();
      const isEssential = options?.isEssential ?? false;
      const now = this.getCurrentDate();
      const resetAtUtc =
        this.providerResetAtUtc || this.getNextUtcMidnightIso(now);

      if (this.count >= this.dailyLimit) {
        throw new TicketmasterQuotaExceededError(
          `Ticketmaster daily quota budget exhausted (${this.count}/${this.dailyLimit}). All requests blocked until reset at ${resetAtUtc}.`,
          {
            isCircuitBreaker: false,
            quotaCount: this.count,
            dailyLimit: this.dailyLimit,
          },
        );
      }

      if (!isEssential && this.count >= this.circuitBreakerThreshold) {
        const status = this.getStatusInternal();
        if (!this.circuitBreakerEmitted) {
          this.circuitBreakerEmitted = true;
          this.onCircuitBreaker?.(status);
        }
        throw new TicketmasterQuotaExceededError(
          `Ticketmaster circuit breaker tripped at ${this.count} requests (threshold: ${this.circuitBreakerThreshold}). Non-essential sync request refused until reset at ${resetAtUtc}.`,
          {
            isCircuitBreaker: true,
            quotaCount: this.count,
            dailyLimit: this.dailyLimit,
          },
        );
      }

      this.count++;
      this.savePersistedState();
      const status = this.getStatusInternal();

      if (this.count >= this.warningThreshold && !this.warningEmitted) {
        this.warningEmitted = true;
        this.onWarning?.(status);
      }

      if (
        this.count >= this.circuitBreakerThreshold &&
        !this.circuitBreakerEmitted
      ) {
        this.circuitBreakerEmitted = true;
        this.onCircuitBreaker?.(status);
      }

      return status;
    });
  }

  /**
   * Overrides current count (useful for testing or state hydration).
   */
  setCount(newCount: number): void {
    this.withFileLock(() => {
      this.loadPersistedState();
      if (this.isCorrupted) {
        throw new TicketmasterQuotaCorruptionError(
          `Cannot set count: Ticketmaster quota state is corrupted (${this.corruptionReason}). Failing closed.`,
          { filePath: this.persistFilePath || undefined },
        );
      }
      this.checkDateReset();
      this.count = Math.max(0, newCount);
      this.warningEmitted = this.count >= this.warningThreshold;
      this.circuitBreakerEmitted = this.count >= this.circuitBreakerThreshold;
      this.savePersistedState();
    });
  }

  /**
   * Resets counter and flags to 0. Clears any corrupted state flag.
   */
  reset(date?: Date): void {
    this.withFileLock(() => {
      if (date) {
        this.currentDateKey = this.getUtcDateKey(date);
      } else {
        this.currentDateKey = this.getUtcDateKey(this.getCurrentDate());
      }
      this.count = 0;
      this.warningEmitted = false;
      this.circuitBreakerEmitted = false;
      this.providerResetAtUtc = undefined;
      this.isCorrupted = false;
      this.corruptionReason = undefined;
      this.savePersistedState();
    });
  }

  getCount(): number {
    return this.getStatus().count;
  }

  getRemaining(): number {
    return this.getStatus().remaining;
  }
}

let globalQuotaGuard: TicketmasterQuotaGuard | null = null;

export function getGlobalTicketmasterQuotaGuard(): TicketmasterQuotaGuard {
  if (!globalQuotaGuard) {
    globalQuotaGuard = new TicketmasterQuotaGuard();
  }
  return globalQuotaGuard;
}

export function resetGlobalTicketmasterQuotaGuard(): void {
  globalQuotaGuard = null;
}
