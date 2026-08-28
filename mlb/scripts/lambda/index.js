/**
 * MLB standings snapshot — Lambda handler.
 *
 * Runs daily via EventBridge Scheduler (see
 * ../../../terraform/modules/lambda_snapshot), replacing the old GitHub
 * Actions cron trigger. Uses the same fetch/shape logic as the CLI script
 * (../snapshot.js) via ../lib/standings.js, then uploads straight to S3 and
 * invalidates CloudFront — no /tmp intermediate file needed.
 *
 * Deployed as a plain zip (this file + ../lib/standings.js) with no
 * node_modules: @aws-sdk/client-s3 and @aws-sdk/client-cloudfront ship
 * built into the Node.js 20.x Lambda runtime.
 *
 * Required environment variables:
 *   BUCKET_NAME        - S3 bucket to upload to
 *   SNAPSHOT_PREFIX     - key prefix, e.g. "mlb/data"
 * Optional:
 *   CF_DISTRIBUTION_ID - if set, invalidates "/${SNAPSHOT_PREFIX}/*" after upload
 */

const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { CloudFrontClient, CreateInvalidationCommand } = require("@aws-sdk/client-cloudfront");
const { fetchStandingsSnapshot } = require("../lib/standings");

const s3 = new S3Client({});
const cloudfront = new CloudFrontClient({});

exports.handler = async () => {
  const { date, teamCount, snapshot } = await fetchStandingsSnapshot();

  const bucket = process.env.BUCKET_NAME;
  const prefix = process.env.SNAPSHOT_PREFIX;
  if (!bucket || !prefix) {
    throw new Error("BUCKET_NAME and SNAPSHOT_PREFIX environment variables are required");
  }

  const key = `${prefix}/${date}.json`;
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(snapshot),
      ContentType: "application/json",
      CacheControl: "public, max-age=3600",
    })
  );
  console.log(`Wrote s3://${bucket}/${key} (${teamCount} teams)`);

  const distributionId = process.env.CF_DISTRIBUTION_ID;
  if (distributionId) {
    const invalidation = await cloudfront.send(
      new CreateInvalidationCommand({
        DistributionId: distributionId,
        InvalidationBatch: {
          CallerReference: `mlb-snapshot-${date}-${Date.now()}`,
          Paths: { Quantity: 1, Items: [`/${prefix}/*`] },
        },
      })
    );
    console.log(`Created CloudFront invalidation ${invalidation.Invalidation.Id}`);
  }

  return { date, teamCount };
};
