namespace: defillama

environment_vars:
  DATADOG_API_KEY: <DATADOG_API_KEY>
  DD_API_KEY: <DATADOG_API_KEY>
  DD_APP_KEY: <DATADOG_APP_KEY>
  TABLE_ARN: <DYNAMO_DB_TABLE_ARN>
  STREAM_ARN: <DYNAMO_DB_STREAM_ARN>
  ETHEREUM_RPC: <RPC_LIST>
  DD_ENV: prod
  DD_LOGS_INJECTION: 'true'
  DD_PROFILING_ENABLED: 'true'
  NODE_ENV: prod
  AWS_DEFAULT_REGION: <AWS_REGION>
  REDIS_URL: <REDIS_URL>

secrets:
  AWS_ACCESS_KEY_ID: <SECRET>
  AWS_SECRET_ACCESS_KEY: <SECRET>
  OPENSEA_API_KEY: <SECRET>
  SECONDARY_OPENSEA_API_KEY: <SECRET>

image:
  repo: <ECR_REPO>
  release: <ECR_REPO_IMAGE_TAG>

node_selector: m5.2xlarge

adapter_env:
  REDIS_URL: <REDIS_URL>
  TABLE_NAME: <TABLE_NAME>
  AWS_REGION: <AWS_REGION>
  EVENT_BLOCK_RANGE: 500
  EVENT_RECEIPT_PARALLELISM: 12

adapters:
  - name: opensea
    suspend: false
    env: []
    resources:
      limits:
        cpu: 7000m
        memory: 25Gi
  - name: looksrare
    suspend: false
    env: []
    resources:
      limits:
        cpu: 7000m
        memory: 25Gi

cron_defaults:
  suspend: true
  schedule: "@hourly"
  env: {}
  image:
    release: onchain-release-22

crons:
  - name: collectionDiscovery
  - name: setRecordState
  - name: updateStatistics