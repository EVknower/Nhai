/**
 * SyncService.js
 * NHAI Face Recognition System
 *
 * Background sync of auth logs from SQLite to AWS Lambda.
 * - Monitors network via NetInfo
 * - Auto-syncs when connectivity restores
 * - Exponential backoff on failure
 */

import NetInfo from '@react-native-community/netinfo';
import axios from 'axios';
import DatabaseService from './DatabaseService';

// Set your Lambda Function URL from CloudFormation Outputs.SyncEndpointUrl
const SYNC_ENDPOINT = process.env.NHAI_SYNC_ENDPOINT || 'https://YOUR_LAMBDA_URL.lambda-url.ap-south-1.on.aws/';

const SYNC_BATCH_SIZE = 100;
const INITIAL_RETRY_DELAY_MS = 2000;
const MAX_RETRY_DELAY_MS = 60000;
const MAX_RETRY_ATTEMPTS = 5;
const SYNC_TIMEOUT_MS = 15000;

class SyncService {
  constructor() {
    this._isConnected = false;
    this._isSyncing = false;
    this._retryAttempt = 0;
    this._retryTimer = null;
    this._netInfoUnsubscribe = null;
    this._syncListeners = [];
    this._deviceId = null;
  }

  async start(deviceId) {
    this._deviceId = deviceId;
    console.log('[Sync] Service starting for device:', deviceId);

    const state = await NetInfo.fetch();
    this._isConnected = state.isConnected && state.isInternetReachable;

    this._netInfoUnsubscribe = NetInfo.addEventListener(this._onConnectivityChange.bind(this));

    if (this._isConnected) {
      this._scheduleSync(1000);
    }

    console.log('[Sync] Service started. Connected:', this._isConnected);
  }

  stop() {
    if (this._netInfoUnsubscribe) {
      this._netInfoUnsubscribe();
      this._netInfoUnsubscribe = null;
    }
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
    this._syncListeners = [];
    console.log('[Sync] Service stopped');
  }

  _onConnectivityChange(state) {
    const wasConnected = this._isConnected;
    this._isConnected = state.isConnected && state.isInternetReachable;

    console.log('[Sync] Connectivity changed:', wasConnected, '→', this._isConnected);

    if (!wasConnected && this._isConnected) {
      console.log('[Sync] Network restored, triggering sync...');
      this._retryAttempt = 0;
      this._scheduleSync(500);
    }

    this._notifyListeners({ connected: this._isConnected });
  }

  async syncNow() {
    if (!this._isConnected) {
      console.log('[Sync] No network — skipping sync');
      return { written: 0, failed: 0, total: 0, error: 'No network' };
    }
    return this._performSync();
  }

  _scheduleSync(delayMs = 0) {
    if (this._retryTimer) clearTimeout(this._retryTimer);
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      this._performSync();
    }, delayMs);
  }

  async _performSync() {
    if (this._isSyncing) {
      console.log('[Sync] Already syncing, skipping');
      return { written: 0, failed: 0, total: 0 };
    }

    this._isSyncing = true;
    this._notifyListeners({ syncing: true });
    let totalWritten = 0;
    let totalFailed = 0;

    try {
      const unsyncedLogs = await DatabaseService.getUnsyncedLogs();
      console.log(`[Sync] ${unsyncedLogs.length} unsynced log(s) to upload`);

      if (unsyncedLogs.length === 0) {
        this._retryAttempt = 0;
        return { written: 0, failed: 0, total: 0 };
      }

      for (let i = 0; i < unsyncedLogs.length; i += SYNC_BATCH_SIZE) {
        const batch = unsyncedLogs.slice(i, i + SYNC_BATCH_SIZE);
        const { written, failed, failedIds } = await this._uploadBatch(batch);

        totalWritten += written;
        totalFailed += failed;

        const successIds = batch
          .filter((r) => !failedIds.includes(r.id))
          .map((r) => r.id);

        if (successIds.length > 0) {
          await DatabaseService.markSynced(successIds);
        }
      }

      this._retryAttempt = 0;
      console.log(`[Sync] Complete: ${totalWritten} written, ${totalFailed} failed`);
      this._notifyListeners({ syncing: false, lastSyncAt: new Date().toISOString(), written: totalWritten });
      return { written: totalWritten, failed: totalFailed, total: unsyncedLogs.length };

    } catch (err) {
      console.error('[Sync] Sync failed:', err.message);
      this._scheduleRetry();
      this._notifyListeners({ syncing: false, error: err.message });
      return { written: totalWritten, failed: -1, total: -1, error: err.message };
    } finally {
      this._isSyncing = false;
    }
  }

  async _uploadBatch(records) {
    const payload = {
      records: records.map((r) => ({
        ...r,
        deviceId: r.deviceId || this._deviceId,
      })),
    };

    try {
      const response = await axios.post(SYNC_ENDPOINT, payload, {
        timeout: SYNC_TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Id': this._deviceId,
          'X-App-Version': '1.0.0',
        },
        validateStatus: (status) => status >= 200 && status < 300,
      });

      const { written = 0, failed = 0, failedIds = [] } = response.data;
      console.log(`[Sync] Batch: ${written} written, ${failed} failed`);
      return { written, failed, failedIds };

    } catch (err) {
      if (err.response) {
        console.error('[Sync] HTTP error:', err.response.status, err.response.data);
        if (err.response.status === 422) {
          const failedIds = err.response.data?.invalidIds || records.map((r) => r.id);
          return { written: 0, failed: records.length, failedIds };
        }
      }
      throw err;
    }
  }

  _scheduleRetry() {
    if (this._retryAttempt >= MAX_RETRY_ATTEMPTS) {
      console.warn('[Sync] Max retry attempts reached. Will retry on next connectivity event.');
      this._retryAttempt = 0;
      return;
    }

    const delay = Math.min(
      INITIAL_RETRY_DELAY_MS * Math.pow(2, this._retryAttempt),
      MAX_RETRY_DELAY_MS
    );
    this._retryAttempt++;

    console.log(`[Sync] Retry ${this._retryAttempt}/${MAX_RETRY_ATTEMPTS} in ${delay}ms`);
    this._scheduleSync(delay);
  }

  get isConnected() {
    return this._isConnected;
  }

  get isSyncing() {
    return this._isSyncing;
  }

  async getPendingCount() {
    return DatabaseService.getUnsyncedCount();
  }

  subscribe(listener) {
    this._syncListeners.push(listener);
    return () => {
      this._syncListeners = this._syncListeners.filter((l) => l !== listener);
    };
  }

  _notifyListeners(update) {
    const state = {
      connected: this._isConnected,
      syncing: this._isSyncing,
      retryAttempt: this._retryAttempt,
      ...update,
    };
    this._syncListeners.forEach((l) => {
      try {
        l(state);
      } catch (err) {
        console.error('[Sync] Listener error:', err);
      }
    });
  }
}

export default new SyncService();
export { SYNC_ENDPOINT };
