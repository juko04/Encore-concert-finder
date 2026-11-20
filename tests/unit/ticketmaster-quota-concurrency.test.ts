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

    it('fails closed with TicketmasterQuotaLockError when lock acquisition times out', () => {
      const lockPath = `${quotaFilePath}.lock`;

      // Simulate an active lock held by the CURRENT live process (not stale)
      fs.writeFileSync(
        lockPath,
        JSON.stringify({ pid: process.pid, createdAt: Date.now() }),
        'utf8',
      );

      const guard = new TicketmasterQuotaGuard({
        persistFilePath: quotaFilePath,
        lockWaitMs: 30, // 30ms timeout for fast unit test
      });

      // Must fail closed: throw TicketmasterQuotaLockError rather than proceeding uncoordinated
      expect(() => guard.recordRequest()).toThrow(TicketmasterQuotaLockError);

      // Clean up our manual lock
      try {
        fs.unlinkSync(lockPath);
      } catch {
        // ignore
      }
    });

    it('detects and breaks stale lock files left by crashed processes', () => {
      const lockPath = `${quotaFilePath}.lock`;

      // Create a stale lock file with an mtime 20 seconds in the past
      fs.writeFileSync(lockPath, 'stale-pid-9999', 'utf8');
      const oldTime = (Date.now() - 20000) / 1000;
      fs.utimesSync(lockPath, oldTime, oldTime);

      const guard = new TicketmasterQuotaGuard({
        persistFilePath: quotaFilePath,
      });

      // Should break stale lock and succeed
      const status = guard.recordRequest();
      expect(status.count).toBe(1);

      // Lock file is cleaned up
      expect(fs.existsSync(lockPath)).toBe(false);
    });
  });
});
