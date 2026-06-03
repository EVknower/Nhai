/**
 * NHAI Face Recognition System
 * Lambda Sync Handler - Receives auth logs from mobile app and persists to DynamoDB
 *
 * POST /sync
 * Body: { records: AuthLogRecord[] }
 *
 * AuthLogRecord {
 *   id: string        (UUID)
 *   timestamp: string (ISO 8601)
 *   result: 'MATCH' | 'NO_MATCH' | 'LIVENESS_FAIL'
 *   matchedId: string | null
 *   confidence: number | null
 *   deviceId: string
 *   location: string | null
 * }
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');

const TABLE_NAME = process.env.AUTH_LOGS_TABLE || 'NhaiAuthLogs';
const MAX_BATCH_SIZE = 25; // DynamoDB BatchWrite limit

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'ap-south-1' });
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

/**
 * Splits an array into chunks of a given size.
 */
function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Validates a single log record.
 */
function validateRecord(record) {
  const VALID_RESULTS = ['MATCH', 'NO_MATCH', 'LIVENESS_FAIL'];
  if (!record.id || typeof record.id !== 'string') return false;
  if (!record.timestamp || isNaN(Date.parse(record.timestamp))) return false;
  if (!VALID_RESULTS.includes(record.result)) return false;
  if (!record.deviceId || typeof record.deviceId !== 'string') return false;
  return true;
}

/**
 * Builds a DynamoDB PutRequest item from a log record.
 */
function buildPutRequest(record) {
  return {
    PutRequest: {
      Item: {
        logId: record.id,
        timestamp: record.timestamp,
        result: record.result,
        matchedId: record.matchedId || null,
        confidence: record.confidence !== undefined ? record.confidence : null,
        deviceId: record.deviceId,
        location: record.location || null,
        receivedAt: new Date().toISOString(),
        ttl: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365, // 1 year TTL
      },
    },
  };
}

/**
 * Main Lambda handler.
 */
exports.handler = async (event) => {
  console.log('Received sync event:', JSON.stringify({ ...event, body: '[REDACTED]' }));

  // Support both API Gateway proxy and direct Lambda URL invocations
  let body;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body || event;
  } catch (err) {
    console.error('Failed to parse request body:', err.message);
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    };
  }

  const { records } = body;

  if (!Array.isArray(records) || records.length === 0) {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Request body must contain a non-empty "records" array' }),
    };
  }

  if (records.length > 500) {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Batch size exceeds maximum of 500 records' }),
    };
  }

  // Validate all records
  const invalidRecords = records.filter((r) => !validateRecord(r));
  if (invalidRecords.length > 0) {
    console.warn(`Rejected ${invalidRecords.length} invalid records`);
    return {
      statusCode: 422,
      headers: corsHeaders(),
      body: JSON.stringify({
        error: `${invalidRecords.length} records failed validation`,
        invalidIds: invalidRecords.map((r) => r.id || 'UNKNOWN'),
      }),
    };
  }

  // Batch write to DynamoDB in chunks of 25
  const chunks = chunkArray(records, MAX_BATCH_SIZE);
  let totalWritten = 0;
  const errors = [];

  for (const chunk of chunks) {
    const requestItems = chunk.map(buildPutRequest);
    try {
      const response = await docClient.send(
        new BatchWriteCommand({
          RequestItems: { [TABLE_NAME]: requestItems },
        })
      );

      // Handle unprocessed items (DynamoDB throttling)
      const unprocessed = response.UnprocessedItems?.[TABLE_NAME];
      if (unprocessed && unprocessed.length > 0) {
        console.warn(`${unprocessed.length} unprocessed items in this batch — will be retried by client`);
        errors.push(...unprocessed.map((u) => u.PutRequest?.Item?.logId));
      } else {
        totalWritten += chunk.length;
      }
    } catch (err) {
      console.error('DynamoDB batch write error:', err.message);
      errors.push(...chunk.map((r) => r.id));
    }
  }

  console.log(`Sync complete: ${totalWritten} written, ${errors.length} errors`);

  if (errors.length > 0) {
    return {
      statusCode: 207, // Multi-status
      headers: corsHeaders(),
      body: JSON.stringify({
        written: totalWritten,
        failed: errors.length,
        failedIds: errors,
      }),
    };
  }

  return {
    statusCode: 200,
    headers: corsHeaders(),
    body: JSON.stringify({
      written: totalWritten,
      message: 'All records synced successfully',
    }),
  };
};

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };
}
