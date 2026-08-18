export type SubmissionSourceSystem = "airtable" | "google_form";

export type TechnicalRedeliveryMechanism =
  | "initial_delivery"
  | "network_retry"
  | "webhook_redelivery"
  | "queue_retry"
  | "poller_replay"
  | "worker_restart_recovery"
  | "unknown_technical_redelivery";

export interface SourceIdentity {
  sourceSystem: SubmissionSourceSystem;
  sourceRecordId: string;
  sourceEventKey: string;
  submissionUuid: string;
  sourceSubmittedAt: string | null;
}

export interface TechnicalDeliveryContext {
  mechanism: TechnicalRedeliveryMechanism;
  causeCode: string | null;
  deliveredAt: string;
}

export interface SelectedCatalogValues {
  companyId: number | null;
  companyName: string | null;
  companyWorkModeId: number | null;
  companyWorkModeName: string | null;
  positionId: number | null;
  positionName: string | null;
}

export interface RawApplicantValues {
  personName: string | null;
  personEmailAddress: string | null;
  personPhone: string | null;
  startWorkingDate: string | null;
  endWorkingDate: string | null;
  workDuration: string | null;
}

export interface PdfResumeReference {
  kind: "pdf_reference";
  source: "airtable_attachment" | "google_drive";
  sourceUrl: string | null;
  sourceFileId: string | null;
  originalFileName: string | null;
  declaredMimeType: string | null;
}

export interface NoResumeReference {
  kind: "no_resume";
}

export type ResumeReference = PdfResumeReference | NoResumeReference;

export interface CanonicalIntakeRequest {
  schemaVersion: "canonical-intake-v1";
  source: SourceIdentity;
  technicalDelivery: TechnicalDeliveryContext;
  catalog: SelectedCatalogValues;
  applicant: RawApplicantValues;
  resume: ResumeReference;
  sourceFieldSnapshot: Record<string, unknown>;
}
