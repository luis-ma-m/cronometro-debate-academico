import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  save: vi.fn(),
  publish: vi.fn(),
  record: vi.fn(),
  ack: vi.fn(),
  status: vi.fn(),
}));

vi.mock('../api', () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string, public code = 'API_ERROR', public retryAfterMs = 0, public status = 0) { super(message); }
  },
  previewTabulationActa: mocks.preview,
  saveTabulationActa: mocks.save,
  publishTabulationRound: mocks.publish,
  recordSyncOperation: mocks.record,
  ackSyncOperation: mocks.ack,
  getTabulationSyncOperationStatus: mocks.status,
}));

import { ApiError } from '../api';
import type { PendingSyncOperation } from './syncOutbox';
import { createTabulationSyncDispatcher } from './syncDispatcher';

function operation(payload: unknown, operationId = 'acta-op-stable-01'): PendingSyncOperation {
  return {
    operationId, tournamentId: 'tournament-1', entityType: 'acta', entityId: 'assignment-1',
    operation: 'replace-acta', baseRevision: 0, payload, payloadHash: 'a'.repeat(64),
    status: 'sending', attempts: 1, createdAt: 100, workerId: 'worker', leaseUntil: 10_000,
  };
}

describe('Tabulation offline sync dispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.record.mockResolvedValue({ status: 'pending' });
    mocks.ack.mockResolvedValue({ status: 'committed' });
    mocks.status.mockResolvedValue({ found: false, response: null });
  });

  it('recovers a previously committed acta after an ambiguous timeout without writing twice', async () => {
    const response = { sourceId: 'committed-acta-version' };
    mocks.status.mockResolvedValue({ found: true, response });
    const dispatch = createTabulationSyncDispatcher({ token: 'manager-token' });
    const result = await dispatch(operation({ mode: 'first-save', assignmentId: 'assignment-1', source: {} }));
    expect(result).toEqual({ status: 'acknowledged', response });
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.status).toHaveBeenCalledOnce();
    expect(mocks.ack).toHaveBeenCalledWith('manager-token', 'acta-op-stable-01', 'a'.repeat(64), 'committed', response);
  });

  it('previews an offline first-save and only writes when no official version exists', async () => {
    const proposedSource = { sourceMode: 'judges', acta: { winnerTeamId: 'team-a' } };
    mocks.preview.mockResolvedValue({
      assignmentId: 'assignment-1', tournamentId: 'tournament-1', currentSourceId: null,
      proposedSource, settingsRevision: 8, changes: [],
    });
    mocks.save.mockResolvedValue({ sourceId: 'version-1' });
    const dispatch = createTabulationSyncDispatcher({ token: 'manager-token' });
    const result = await dispatch(operation({ mode: 'first-save', assignmentId: 'assignment-1', source: { sourceMode: 'judges' } }));
    expect(result).toEqual({ status: 'acknowledged', response: { sourceId: 'version-1' } });
    expect(mocks.save).toHaveBeenCalledWith('manager-token', {
      operationId: 'acta-op-stable-01', assignmentId: 'assignment-1', source: proposedSource,
      expectedCurrentSourceId: null, confirmReplace: false, expectedSettingsRevision: 8,
    });
  });

  it('never overwrites a different official acta from an offline first-save', async () => {
    mocks.preview.mockResolvedValue({
      assignmentId: 'assignment-1', tournamentId: 'tournament-1', currentSourceId: 'official-1',
      proposedSource: {}, settingsRevision: 8, changes: [{ path: 'winner', before: 'a', after: 'b' }],
    });
    const dispatch = createTabulationSyncDispatcher({ token: 'manager-token' });
    const result = await dispatch(operation({ mode: 'first-save', assignmentId: 'assignment-1', source: {} }));
    expect(result).toMatchObject({ status: 'conflict', error: { code: 'ACTA_REPLACEMENT_REVIEW_REQUIRED' } });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('treats an already-identical official acta as acknowledged without creating a rewrite', async () => {
    mocks.preview.mockResolvedValue({
      assignmentId: 'assignment-1', tournamentId: 'tournament-1', currentSourceId: 'official-1',
      proposedSource: {}, settingsRevision: 8, changes: [],
    });
    const dispatch = createTabulationSyncDispatcher({ token: 'manager-token' });
    const result = await dispatch(operation({ mode: 'first-save', assignmentId: 'assignment-1', source: {} }));
    expect(result).toMatchObject({ status: 'acknowledged', response: { alreadyCurrent: true, currentSourceId: 'official-1' } });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('replays an explicitly confirmed replacement with the exact operation id and expected source', async () => {
    const input = {
      operationId: 'acta-op-stable-01', assignmentId: 'assignment-1', source: { acta: { winnerTeamId: 'team-b' } },
      expectedCurrentSourceId: 'official-1', confirmReplace: true, expectedSettingsRevision: 9,
    };
    mocks.save.mockResolvedValue({ sourceId: 'version-2', replacedSourceId: 'official-1' });
    const dispatch = createTabulationSyncDispatcher({ token: 'manager-token' });
    const result = await dispatch(operation({ mode: 'confirmed', input }));
    expect(result).toEqual({ status: 'acknowledged', response: { sourceId: 'version-2', replacedSourceId: 'official-1' } });
    expect(mocks.save).toHaveBeenCalledWith('manager-token', input);
  });

  it('sends semantic 4xx errors to intervention and rate limits back to retry', async () => {
    mocks.preview.mockRejectedValueOnce(Object.assign(new Error('Acta inválida'), { code: 'ACTA_INVALID', status: 422 }));
    const failed = await createTabulationSyncDispatcher({ token: 'manager-token' })(
      operation({ mode: 'first-save', assignmentId: 'assignment-1', source: {} }),
    );
    expect(failed).toMatchObject({ status: 'failed', error: { code: 'ACTA_INVALID' } });

    mocks.preview.mockRejectedValueOnce(Object.assign(new Error('Rate limited'), { code: 'RATE_LIMITED', status: 429, retryAfterMs: 12_000 }));
    const retry = await createTabulationSyncDispatcher({ token: 'manager-token' })(
      operation({ mode: 'first-save', assignmentId: 'assignment-1', source: {} }),
    );
    expect(retry).toMatchObject({ status: 'retry', error: { code: 'RATE_LIMITED' }, retryAfterMs: 12_000 });
  });

  it('retries transient failures and pauses when the manager session expires', async () => {
    mocks.preview.mockRejectedValueOnce(new ApiError('Timeout', 'NETWORK_ERROR', 4000));
    const dispatch = createTabulationSyncDispatcher({ token: 'manager-token' });
    const retry = await dispatch(operation({ mode: 'first-save', assignmentId: 'assignment-1', source: {} }));
    expect(retry).toMatchObject({ status: 'retry', error: { code: 'NETWORK_ERROR' }, retryAfterMs: 4000 });

    const onUnauthorized = vi.fn();
    mocks.preview.mockRejectedValueOnce(new ApiError('Caducada', 'UNAUTHORIZED'));
    const unauthorized = await createTabulationSyncDispatcher({ token: 'expired', onUnauthorized })(
      operation({ mode: 'first-save', assignmentId: 'assignment-1', source: {} }),
    );
    expect(unauthorized).toMatchObject({ status: 'pause', error: { code: 'UNAUTHORIZED' } });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });
});
