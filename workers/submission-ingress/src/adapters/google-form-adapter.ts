import type { CanonicalIntakeRequest } from "../contracts/canonical-intake";
import {
  baseCanonicalRequest,
  mappedText,
  requireNativeEnvelope,
  resolveSubmissionUuid,
  type ExplicitFieldMapping,
} from "./adapter-helpers";

export const GOOGLE_FORM_APPLICATION_V1_MAPPING: ExplicitFieldMapping = {
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
  resume: ["Resume File ID", "Google Drive File ID", "Resume", "📄 Resume"],
};

export async function adaptGoogleFormEvent(
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
    sourceSystem: "google_form",
    sourceRecordId: envelope.sourceRecordId,
  });
  const rawReference = mappedText(envelope.fields, GOOGLE_FORM_APPLICATION_V1_MAPPING.resume);
  const fileId = rawReference
    ? rawReference.match(/[-\w]{20,}/)?.[0] ?? rawReference
    : null;
  const resume: CanonicalIntakeRequest["resume"] = fileId
    ? {
        kind: "pdf_reference",
        source: "google_drive",
        sourceUrl: null,
        sourceFileId: fileId,
        originalFileName: null,
        declaredMimeType: "application/pdf",
      }
    : { kind: "no_resume" };
  return baseCanonicalRequest({
    sourceSystem: "google_form",
    sourceSchemaVersion: options.sourceSchemaVersion,
    envelope,
    submissionUuid,
    sourceEventKey: envelope.sourceEventKey ?? `google_form:${envelope.sourceRecordId}`,
    mapping: GOOGLE_FORM_APPLICATION_V1_MAPPING,
    resume,
  });
}
