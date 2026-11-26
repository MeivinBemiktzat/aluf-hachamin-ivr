'use strict';
// Hugging Face Storage Buckets S3 adapter, adapted from monopol-ivr.
// Uses conditional writes (ETag) to avoid silently overwriting concurrent game updates.
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { AsyncLocalStorage } = require('node:async_hooks');

const namespace = process.env.HF_NAMESPACE;
const bucket = process.env.HF_BUCKET;
const accessKeyId = process.env.HF_S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.HF_S3_SECRET_ACCESS_KEY;
const context = new AsyncLocalStorage();
let client;

function s3() {
  if (![namespace, bucket, accessKeyId, secretAccessKey].every(Boolean)) {
    throw new Error('Missing HF Storage configuration: HF_NAMESPACE, HF_BUCKET, HF_S3_ACCESS_KEY_ID, HF_S3_SECRET_ACCESS_KEY');
  }
  return client ||= new S3Client({
    endpoint: 'https://s3.hf.co/' + encodeURIComponent(namespace),
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    maxAttempts: 2
  });
}
const keyOf = key => 'aluf-hachamin/' + encodeURIComponent(key) + '.json';
const seen = () => context.getStore();
const runWithContext = fn => context.run(new Map(), fn);

function isConflict(e) {
  return e.$metadata?.httpStatusCode === 412 || e.$metadata?.httpStatusCode === 409 ||
    e.name === 'PreconditionFailed' || e.name === 'ConditionalRequestConflict';
}
async function get(key) {
  try {
    const result = await s3().send(new GetObjectCommand({ Bucket: bucket, Key: keyOf(key) }));
    const record = JSON.parse(await result.Body.transformToString());
    seen()?.set(key, result.ETag || null);
    return record.expiresAt && Date.now() >= record.expiresAt ? null : record.value;
  } catch (e) {
    if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) {
      seen()?.set(key, null);
      return null;
    }
    throw e;
  }
}
async function set(key, value, ttlSeconds) {
  const etag = seen()?.has(key) ? seen().get(key) : undefined;
  if (etag === undefined) throw Object.assign(new Error('Read before write is required'), { code: 'HF_READ_REQUIRED' });
  const body = JSON.stringify({
    value,
    expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null
  });
  const params = {
    Bucket: bucket, Key: keyOf(key), Body: body, ContentType: 'application/json'
  };
  if (etag === null) params.IfNoneMatch = '*';
  else params.IfMatch = etag;
  try {
    await s3().send(new PutObjectCommand(params));
    seen().delete(key);
  } catch (e) {
    if (isConflict(e)) throw Object.assign(new Error('Concurrent storage update; retry'), { code: 'HF_CONFLICT' });
    throw e;
  }
}
module.exports = { get, set, runWithContext };