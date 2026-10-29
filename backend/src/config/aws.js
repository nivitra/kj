const { S3Client } = require('@aws-sdk/client-s3');
const { RekognitionClient } = require('@aws-sdk/client-rekognition');

// Only use explicit keys when both are non-empty (local dev).
// Production: leave unset → default provider chain → EC2 instance role / IMDS.
const accessKey = (process.env.AWS_ACCESS_KEY_ID || '').trim();
const secretKey = (process.env.AWS_SECRET_ACCESS_KEY || '').trim();
const hasCreds = !!(accessKey && secretKey);

const awsConfig = {
  region: process.env.AWS_REGION || 'ap-south-1',
  ...(hasCreds
    ? { credentials: { accessKeyId: accessKey, secretAccessKey: secretKey } }
    : {}),
};

const s3Client = new S3Client(awsConfig);
const rekognitionClient = new RekognitionClient(awsConfig);

const S3_BUCKET = process.env.AWS_S3_BUCKET;
const CLOUDFRONT_DOMAIN = process.env.AWS_CLOUDFRONT_DOMAIN;

module.exports = { s3Client, rekognitionClient, S3_BUCKET, CLOUDFRONT_DOMAIN, awsConfig };
