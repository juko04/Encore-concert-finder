import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  TicketmasterQuotaGuard,
  TICKETMASTER_DAILY_LIMIT,
  resetGlobalTicketmasterQuotaGuard,
} from '@/lib/sources/ticketmaster/quota-guard';
import {
  TicketmasterQuotaCorruptionError,
  TicketmasterQuotaExceededError,
  TicketmasterQuotaLockError,
} from '@/lib/sources/ticketmaster/errors';

describe('Ticketmaster Quota Guard: Concurrency, Persistence & Provider Reconciliation', () => {
  let tmpDir: string;
  let quotaFilePath: string;

  beforeEach(() => {
    resetGlobalTicketmasterQuotaGuard();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-quota-test-'));
    quotaFilePath = path.join(tmpDir, 'quota-state.json');
  });

  afterEach(() => {
    resetGlobalTicketmasterQuotaGuard();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe('Concurrent Workers & Atomic File Locking', () => {
    it('ensures concurrent workers never clobber each others quota counts', async () => {
      // Simulate 5 separate worker instances pointing to the exact same persistence file
      const workerCount = 5;
      const requestsPerWorker = 10;
      const workers: TicketmasterQuotaGuard[] = [];

      for (let i = 0; i < workerCount; i++) {
        workers.push(
          new TicketmasterQuotaGuard({
            persistFilePath: quotaFilePath,
          }),
        );
      }

      // Execute requests concurrently across all workers
      const tasks: Promise<void>[] = [];
      for (let req = 0; req < requestsPerWorker; req++) {
        for (let w = 0; w < workerCount; w++) {
          tasks.push(
            (async (workerIndex: number) => {
              // Introduce slight random micro-jitter to simulate real concurrent processes
              await new Promise((r) => setTimeout(r, Math.random() * 5));
              workers[workerIndex].recordRequest();
            })(w),
          );
        }
      }

      await Promise.all(tasks);

      // Total expected requests = 5 * 10 = 50
      const finalGuard = new TicketmasterQuotaGuard({
        persistFilePath: quotaFilePath,
      });
      const finalStatus = finalGuard.getStatus();

      expect(finalStatus.count).toBe(workerCount * requestsPerWorker);
      expect(finalStatus.remaining).toBe(
        TICKETMASTER_DAILY_LIMIT - workerCount * requestsPerWorker,
      );

      // Verify file on disk matches exact count
      const fileContent = JSON.parse(fs.readFileSync(quotaFilePath, 'utf8'));
      expect(fileContent.count).toBe(workerCount * requestsPerWorker);
    });

    it('recovers state across process restarts', () => {
      // Process 1: Record 42 requests and exit
      const process1 = new TicketmasterQuotaGuard({
        persistFilePath: quotaFilePath,
      });
      for (let i = 0; i < 42; i++) {
        process1.recordRequest();
      }
      expect(process1.getCount()).toBe(42);

      // Process 2: Starts up later, reading from same file
      const process2 = new TicketmasterQuotaGuard({
        persistFilePath: quotaFilePath,
      });
      expect(process2.getCount()).toBe(42);
      expect(process2.getRemaining()).toBe(TICKETMASTER_DAILY_LIMIT - 42);

      // Process 2 continues recording requests
      process2.recordRequest();
      expect(process2.getCount()).toBe(43);

      // Process 3: Starts up, sees 43
      const process3 = new TicketmasterQuotaGuard({
        persistFilePath: quotaFilePath,
      });
      expect(process3.getCount()).toBe(43);
    });
  });

  describe('Provider Response Headers & Quota Window Reconciliation', () => {
    it('syncs usage from rate-limit and rate-limit-available headers', () => {
      const guard = new TicketmasterQuotaGuard({
        persistFilePath: quotaFilePath,
      });
      expect(guard.getCount()).toBe(0);

      // Provider indicates limit: 5000, available: 4800 (used: 200)
      guard.syncFromHeaders({
        limit: 5000,
        available: 4800,
        reset: Date.now() + 3600000,
      });

      expect(guard.getCount()).toBe(200);
      expect(guard.getRemaining()).toBe(4800);

      // Persisted file reflects synced count
      const fileData = JSON.parse(fs.readFileSync(quotaFilePath, 'utf8'));
      expect(fileData.count).toBe(200);
      expect(fileData.providerResetAtUtc).toBeDefined();
    });

    it('does NOT reset accounting to 0 upon crossing midnight while provider indicates quota is still exhausted', () => {
      let simulatedTime = new Date('2026-11-20T23:50:00Z');
      const getCurrentDate = () => simulatedTime;

      const guard = new TicketmasterQuotaGuard({
        persistFilePath: quotaFilePath,
        getCurrentDate,
      });

      // Provider signals quota exhausted (available: 0), reset scheduled for 04:00 UTC tomorrow
      const providerResetTime = new Date('2026-11-21T04:00:00Z').getTime();
      guard.syncFromHeaders({
        limit: 5000,
        available: 0,
        reset: providerResetTime,
      });

      expect(guard.getCount()).toBe(5000);
      expect(guard.getStatus().isCircuitBroken).toBe(true);

      // Advance time past local/UTC midnight to 00:05 UTC (before provider reset at 04:00 UTC)
      simulatedTime = new Date('2026-11-21T00:05:00Z');

      const midnightStatus = guard.getStatus();
      // Crucial: Must NOT reset count to 0 because provider is still exhausted until 04:00 UTC!
      expect(midnightStatus.count).toBe(5000);
      expect(midnightStatus.remaining).toBe(0);
      expect(midnightStatus.isCircuitBroken).toBe(true);

      // Requests must still be refused
      expect(() => guard.recordRequest({ isEssential: false })).toThrow(
        TicketmasterQuotaExceededError,
      );

      // Advance time past provider reset to 04:01 UTC
      simulatedTime = new Date('2026-11-21T04:01:00Z');

      const afterResetStatus = guard.getStatus();
      // Now that provider window has elapsed, count resets to 0
      expect(afterResetStatus.count).toBe(0);
      expect(afterResetStatus.remaining).toBe(5000);
      expect(afterResetStatus.isCircuitBroken).toBe(false);

      // Requests can proceed
      expect(guard.recordRequest().count).toBe(1);
    });
  });

  describe('Resilience, Corrupt State & Stale Locks', () => {
    it('fails closed when quota state file is corrupt and recovers after explicit reset', () => {
      // Write corrupted JSON to quota state file
      fs.writeFileSync(
        quotaFilePath,
        '{ "count": 100, invalid_json!!! }',
        'utf8',
      );

      const guard = new TicketmasterQuotaGuard({
        persistFilePath: quotaFilePath,
      });

      // Fail-closed: refuses to execute requests on corrupt state
      const check = guard.canExecute();
      expect(check.allowed).toBe(false);
      expect(check.reason).toMatch(/corrupted/i);

      // Throws explicit TicketmasterQuotaCorruptionError rather than silently granting a full budget
      expect(() => guard.recordRequest()).toThrow();

      // Status reflects corruption
      expect(guard.getStatus().isCorrupted).toBe(true);

      // Explicit administrative reset safely recovers functionality
      guard.reset();
      expect(guard.getStatus().isCorrupted).toBe(false);
      expect(guard.getCount()).toBe(0);

      // Now recording requests succeeds normally
      const status = guard.recordRequest();
      expect(status.count).toBe(1);

      const parsed = JSON.parse(fs.readFileSync(quotaFilePath, 'utf8'));
      expect(parsed.count).toBe(1);
    });

    it('fails closed and NEVER steals lock from a live worker even after 15+ seconds', () => {
      const lockPath = `${quotaFilePath}.lock`;

      // Adversarial test: Live worker (current PID) held lock for 20 seconds
      fs.writeFileSync(
        lockPath,
        JSON.stringify({
          pid: process.pid,
          lockId: 'live-worker-lock-uuid',
          createdAt: Date.now() - 20000,
        }),
        'utf8',
      );

      const competingGuard = new TicketmasterQuotaGuard({
        persistFilePath: quotaFilePath,
        lockWaitMs: 40, // 40ms fast timeout
      });

      // MUST NOT steal lock while owner is demonstrably alive!
      expect(() => competingGuard.recordRequest()).toThrow(
        TicketmasterQuotaLockError,
      );

      // Verify the original lock was NOT deleted or stolen
      expect(fs.existsSync(lockPath)).toBe(true);
      const content = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      expect(content.lockId).toBe('live-worker-lock-uuid');

      fs.unlinkSync(lockPath);
    });

    it('safely reclaims lock when owner process is demonstrably dead (ESRCH)', () => {
      const lockPath = `${quotaFilePath}.lock`;

      // Find an unused PID that definitely returns ESRCH
      let deadPid = 9999999;
      while (deadPid > 100000) {
        try {
          process.kill(deadPid, 0);
          deadPid--;
        } catch (err: unknown) {
          if ((err as { code?: string })?.code === 'ESRCH') {
            break;
          }
          deadPid--;
        }
      }

      // Write lock owned by demonstrably dead PID
      fs.writeFileSync(
        lockPath,
        JSON.stringify({
          pid: deadPid,
          lockId: 'dead-process-lock',
          createdAt: Date.now() - 5000,
        }),
        'utf8',
      );

      const guard = new TicketmasterQuotaGuard({
        persistFilePath: quotaFilePath,
        lockWaitMs: 100,
      });

      // Dead owner -> safely reclaimed!
      const status = guard.recordRequest();
      expect(status.count).toBe(1);

      // Lock file is cleaned up after successful completion
      expect(fs.existsSync(lockPath)).toBe(false);
    });

    it('prevents an old owner from deleting another process replacement lock upon exit', () => {
      const lockPath = `${quotaFilePath}.lock`;

      // Process A acquired lock with lockId A
      const lockIdA = 'process-a-lock-uuid';
      fs.writeFileSync(
        lockPath,
        JSON.stringify({
          pid: process.pid,
          lockId: lockIdA,
          createdAt: Date.now(),
        }),
        'utf8',
      );

      // Process B replaces the lock with lockId B
      const lockIdB = 'process-b-lock-uuid';
      fs.writeFileSync(
        lockPath,
        JSON.stringify({
          pid: process.pid,
          lockId: lockIdB,
          createdAt: Date.now(),
        }),
        'utf8',
      );

      // Process A exits its lock release routine
      // Verify that if current lock file has lockIdB, Process A's release logic does NOT unlink it!
      const guardA = new TicketmasterQuotaGuard({
        persistFilePath: quotaFilePath,
      });
      // Simulate release with lockIdA
      const content = fs.readFileSync(lockPath, 'utf8');
      const meta = JSON.parse(content);
      if (meta.lockId === lockIdA) {
        fs.unlinkSync(lockPath);
      }

      // Lock B remains untouched!
      expect(fs.existsSync(lockPath)).toBe(true);
      const remainingMeta = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      expect(remainingMeta.lockId).toBe(lockIdB);

      fs.unlinkSync(lockPath);
    });

    it('fails closed when lock metadata is missing or malformed', () => {
      const lockPath = `${quotaFilePath}.lock`;

      // Corrupted or unparseable lock file
      fs.writeFileSync(lockPath, 'NOT_VALID_JSON_METADATA', 'utf8');

      const guard = new TicketmasterQuotaGuard({
        persistFilePath: quotaFilePath,
        lockWaitMs: 40,
      });

      // Ownership cannot be safely established -> MUST fail closed!
      expect(() => guard.recordRequest()).toThrow(TicketmasterQuotaLockError);
      expect(fs.existsSync(lockPath)).toBe(true);

      fs.unlinkSync(lockPath);
    });

    it('rejects invalid count or invalid dateKey in persisted state file without resetting budget', () => {
      // Invalid count (negative)
      fs.writeFileSync(
        quotaFilePath,
        JSON.stringify({ count: -10, dateKey: '2026-11-20' }),
        'utf8',
      );

      const guard = new TicketmasterQuotaGuard({
        persistFilePath: quotaFilePath,
      });

      expect(guard.getStatus().isCorrupted).toBe(true);
      expect(guard.canExecute().allowed).toBe(false);
      expect(() => guard.recordRequest()).toThrow();

      // Invalid dateKey format
      fs.writeFileSync(
        quotaFilePath,
        JSON.stringify({ count: 10, dateKey: 'not-a-valid-date' }),
        'utf8',
      );

      const guard2 = new TicketmasterQuotaGuard({
        persistFilePath: quotaFilePath,
      });

      expect(guard2.getStatus().isCorrupted).toBe(true);
      expect(guard2.canExecute().allowed).toBe(false);
      expect(() => guard2.recordRequest()).toThrow();
    });
  });
});
