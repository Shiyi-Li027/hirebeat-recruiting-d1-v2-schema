export function positionAllowsApplicationIntake(status:string|null,jd:string|null):boolean{
  return status==="active"&&(jd?.trim().length??0)>=10;
}

export type PositionAdmissionReason =
  | "submitted_position_missing"
  | "submitted_position_wrong_company"
  | "submitted_position_not_active"
  | "submitted_position_jd_not_ready";

export function positionAdmissionReason(input:{
  submittedPositionId:number|null;
  submittedCompanyId:number|null;
  positionCompanyId:number|null;
  positionStatus:string|null;
  positionJd:string|null;
}):PositionAdmissionReason|null{
  if(!input.submittedPositionId||input.positionStatus===null)return "submitted_position_missing";
  if(input.positionCompanyId!==input.submittedCompanyId)return "submitted_position_wrong_company";
  if(input.positionStatus!=="active")return "submitted_position_not_active";
  if(!positionAllowsApplicationIntake(input.positionStatus,input.positionJd))return "submitted_position_jd_not_ready";
  return null;
}

export function positionIsReadyForMl(status:string|null,jd:string|null):boolean{
  return status==="active"&&(jd?.trim().length??0)>=10;
}
