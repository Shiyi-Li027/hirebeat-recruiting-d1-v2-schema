export interface IngressEnv {
  DB: D1Database;
  hirebeat_hr_raw_resumes_pdf_r2_v1: R2Bucket;

  DEPLOYMENT_STAGE: string;
  SOURCE_SCHEMA_VERSION: string;
  SUBMISSION_UUID_NAMESPACE: string;
  PARSER_SERVICE_URL: string;

  SUBMISSION_HMAC_KEY_V1: string;
  INGRESS_INTERNAL_AUTH_TOKEN: string;
  GOOGLE_SERVICE_ACCOUNT_JSON: string;
  CLOUD_RUN_INVOKER_SERVICE_ACCOUNT_JSON: string;
  PARSER_SERVICE_AUTH_TOKEN: string;
}
