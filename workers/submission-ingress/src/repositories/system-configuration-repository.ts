import type {
  RequiredOutboxKey,
  RequiredSubmissionIngressKey,
  SubmissionIngressConfiguration,
} from "../config/runtime-configuration";
import {
  REQUIRED_OUTBOX_KEYS,
  REQUIRED_SUBMISSION_INGRESS_KEYS,
} from "../config/runtime-configuration";
import { IngressError } from "../errors/ingress-error";

interface ConfigurationRow {
  configuration_release_id: number;
  configuration_release_key: string;
  release_version: number;
  configuration_scope: string;
  configuration_key: string;
  configuration_value_json: string;
}

const CONFIGURATION_SELECT = `
  SELECT
    release.id AS configuration_release_id,
    release.configuration_release_key,
    release.release_version,
    configuration.configuration_scope,
    configuration.configuration_key,
    configuration.configuration_value_json
  FROM system_configuration_release AS release
  INNER JOIN system_configuration AS configuration
    ON configuration.configuration_release_id = release.id
`;

const ACTIVE_CONFIGURATION_QUERY = `${CONFIGURATION_SELECT}
  WHERE release.release_status = 'active'
    AND configuration.configuration_scope IN ('submission_ingress', 'outbox')
  ORDER BY configuration.configuration_key`;

const CONFIGURATION_BY_RELEASE_QUERY = `${CONFIGURATION_SELECT}
  WHERE release.id = ?1
    AND configuration.configuration_scope IN ('submission_ingress', 'outbox')
  ORDER BY configuration.configuration_key`;

function configurationError(message: string): IngressError {
  return new IngressError({
    kind: "configuration",
    safeCode: "invalid_active_ingress_configuration",
    message,
    httpStatus: 503,
  });
}

function parsePositiveInteger(
  key: RequiredSubmissionIngressKey | RequiredOutboxKey,
  valueJson: string,
): number {
  let parsed: unknown;

  try {
    parsed = JSON.parse(valueJson);
  } catch (cause) {
    throw new IngressError({
      kind: "configuration",
      safeCode: "invalid_active_ingress_configuration",
      message: `Configuration ${key} is not valid JSON.`,
      httpStatus: 503,
      cause,
    });
  }

  if (!Number.isSafeInteger(parsed) || (parsed as number) <= 0) {
    throw configurationError(
      `Configuration ${key} must be a positive safe integer.`,
    );
  }

  return parsed as number;
}

function buildConfiguration(
  rows: ConfigurationRow[],
): SubmissionIngressConfiguration {
  if (rows.length === 0) {
    throw configurationError("No matching Ingress configuration was found.");
  }

  const first = rows[0];
  if (
    !Number.isSafeInteger(first.configuration_release_id) ||
    first.configuration_release_id <= 0 ||
    !Number.isSafeInteger(first.release_version) ||
    first.release_version <= 0 ||
    first.configuration_release_key.length === 0
  ) {
    throw configurationError("The configuration release is invalid.");
  }

  const values = new Map<RequiredSubmissionIngressKey, number>();
  const outboxValues = new Map<RequiredOutboxKey, number>();

  for (const row of rows) {
    if (
      row.configuration_release_id !== first.configuration_release_id ||
      row.configuration_release_key !== first.configuration_release_key ||
      row.release_version !== first.release_version
    ) {
      throw configurationError(
        "More than one configuration release was returned.",
      );
    }

    if (row.configuration_scope === "outbox") {
      if (
        !REQUIRED_OUTBOX_KEYS.includes(
          row.configuration_key as RequiredOutboxKey,
        )
      ) {
        continue;
      }
      const key = row.configuration_key as RequiredOutboxKey;
      if (outboxValues.has(key)) {
        throw configurationError(`Configuration outbox.${key} is duplicated.`);
      }
      outboxValues.set(
        key,
        parsePositiveInteger(key, row.configuration_value_json),
      );
      continue;
    }

    if (row.configuration_scope !== "submission_ingress") continue;
    if (
      !REQUIRED_SUBMISSION_INGRESS_KEYS.includes(
        row.configuration_key as RequiredSubmissionIngressKey,
      )
    ) continue;

    const key = row.configuration_key as RequiredSubmissionIngressKey;
    if (values.has(key)) {
      throw configurationError(`Configuration ${key} is duplicated.`);
    }
    values.set(key, parsePositiveInteger(key, row.configuration_value_json));
  }

  for (const key of REQUIRED_SUBMISSION_INGRESS_KEYS) {
    if (!values.has(key)) {
      throw configurationError(`Required configuration ${key} is missing.`);
    }
  }
  for (const key of REQUIRED_OUTBOX_KEYS) {
    if (!outboxValues.has(key)) {
      throw configurationError(`Required configuration outbox.${key} is missing.`);
    }
  }

  return Object.freeze({
    release: Object.freeze({
      id: first.configuration_release_id,
      key: first.configuration_release_key,
      version: first.release_version,
    }),
    parserTimeoutMs: values.get("parser_timeout_ms")!,
    activeStaleSeconds: values.get("active_stale_seconds")!,
    maxAttempts: values.get("max_attempts")!,
    maxResumeFileSizeBytes: values.get("max_resume_file_size_bytes")!,
    outboxMaxDeliveryAttempts: outboxValues.get("max_delivery_attempts")!,
  });
}

export class SystemConfigurationRepository {
  constructor(private readonly database: D1Database) {}

  async loadActiveSubmissionIngressConfiguration(): Promise<SubmissionIngressConfiguration> {
    try {
      const result = await this.database
        .prepare(ACTIVE_CONFIGURATION_QUERY)
        .all<ConfigurationRow>();
      return buildConfiguration(result.results);
    } catch (cause) {
      if (cause instanceof IngressError) {
        throw cause;
      }
      throw new IngressError({
        kind: "retryable",
        safeCode: "configuration_read_failed",
        message: "Unable to read the active Ingress configuration.",
        httpStatus: 503,
        cause,
      });
    }
  }

  async loadSubmissionIngressConfigurationByReleaseId(
    configurationReleaseId: number,
  ): Promise<SubmissionIngressConfiguration> {
    if (
      !Number.isSafeInteger(configurationReleaseId) ||
      configurationReleaseId <= 0
    ) {
      throw configurationError("Configuration release ID is invalid.");
    }

    try {
      const result = await this.database
        .prepare(CONFIGURATION_BY_RELEASE_QUERY)
        .bind(configurationReleaseId)
        .all<ConfigurationRow>();
      return buildConfiguration(result.results);
    } catch (cause) {
      if (cause instanceof IngressError) {
        throw cause;
      }
      throw new IngressError({
        kind: "retryable",
        safeCode: "configuration_read_failed",
        message: "Unable to read the frozen Ingress configuration.",
        httpStatus: 503,
        cause,
      });
    }
  }
}
