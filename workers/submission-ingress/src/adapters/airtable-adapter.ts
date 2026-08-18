import type { CanonicalIntakeRequest } from "../contracts/canonical-intake";
import {
  baseCanonicalRequest,
  mappedValue,
  optionalString,
  requireNativeEnvelope,
  resolveSubmissionUuid,
  type ExplicitFieldMapping,
} from "./adapter-helpers";

export const AIRTABLE_APPLICATION_V1_MAPPING: ExplicitFieldMapping = {
  companyId: ["Company ID", "company_id"],
  companyName: ["Company Name", "Company", "🏢 Company"],
  companyWorkModeId: ["Company Work Mode ID", "company_work_mode_id"],
  companyWorkModeName: ["Company Work Mode", "Work Mode", "work_mode"],
  positionId: ["Position ID", "Role ID", "position_id"],
  positionName: ["Position Name", "Position", "Role", "💼 Position"],
  personName: ["Candidate Name", "Name", "Full Name", "👤 Name"],
  personEmailAddress: ["Email Address", "Email", "📧 Email"],
  personPhone: ["Phone Number", "Phone", "☎ Phone"],
  startWorkingDate: ["Start Working Date", "Start Date", "start_working_date"],
  endWorkingDate: ["End Working Date", "End Date", "end_working_date"],
  workDuration: ["Work Duration", "Duration", "work_duration"],
  resume: ["Resume", "Resume PDF", "CV", "📄 Resume"],
};

export async function adaptAirtableEvent(
  input: unknown,
  options: {
    uuidNamespace: string;
    sourceSchemaVersion: "canonical-intake-v1";
  },
): Promise<CanonicalIntakeRequest> {
  const envelope = requireNativeEnvelope(input);
  const submissionUuid = await resolveSubmissionUuid({
    supplied: envelope.submissionUuid,
    namespace: options.uuidNamespace,
    sourceSystem: "airtable",
    sourceRecordId: envelope.sourceRecordId,
  });
  const attachmentValue = mappedValue(envelope.fields, AIRTABLE_APPLICATION_V1_MAPPING.resume);
  const attachment = Array.isArray(attachmentValue) ? attachmentValue[0] : attachmentValue;
  const item = typeof attachment === "object" && attachment !== null
    ? attachment as Record<string, unknown>
    : null;
  const sourceUrl = optionalString(item?.url ?? attachment);
  const resume: CanonicalIntakeRequest["resume"] = sourceUrl
    ? {
        kind: "pdf_reference",
        source: "airtable_attachment",
        sourceUrl,
        sourceFileId: optionalString(item?.id),
        originalFileName: optionalString(item?.filename),
        declaredMimeType: optionalString(item?.type),
      }
    : { kind: "no_resume" };
  return baseCanonicalRequest({
    sourceSystem: "airtable",
    sourceSchemaVersion: options.sourceSchemaVersion,
    envelope,
    submissionUuid,
    sourceEventKey: envelope.sourceEventKey ?? `airtable:${envelope.sourceRecordId}`,
    mapping: AIRTABLE_APPLICATION_V1_MAPPING,
    resume,
  });
}
