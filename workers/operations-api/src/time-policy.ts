export interface SystemTimePolicy {
  configurationReleaseId:number;
  configurationReleaseKey:string;
  releaseVersion:number;
  storageTimeZone:"UTC";
  businessTimeZone:"America/New_York";
}

export async function loadSystemTimePolicy(db:D1Database):Promise<SystemTimePolicy>{
  const rows=await db.prepare(
    `SELECT release.id configuration_release_id,
            release.configuration_release_key,
            release.release_version,
            config.configuration_key,
            config.configuration_value_json
     FROM system_configuration_release release
     JOIN system_configuration config ON config.configuration_release_id=release.id
       AND config.configuration_scope='localization'
       AND config.configuration_key IN ('storage_timezone','business_timezone')
     WHERE release.release_status='active'
     ORDER BY config.configuration_key`,
  ).all<{configuration_release_id:number;configuration_release_key:string;release_version:number;configuration_key:string;configuration_value_json:string}>();
  if(rows.results.length!==2)throw new Error("system_time_policy_missing");
  const values=new Map<string,unknown>();
  for(const row of rows.results){
    try{values.set(row.configuration_key,JSON.parse(row.configuration_value_json));}
    catch{throw new Error("system_time_policy_invalid");}
  }
  if(values.get("storage_timezone")!=="UTC"||values.get("business_timezone")!=="America/New_York"){
    throw new Error("system_time_policy_invalid");
  }
  const release=rows.results[0];
  return{
    configurationReleaseId:release.configuration_release_id,
    configurationReleaseKey:release.configuration_release_key,
    releaseVersion:release.release_version,
    storageTimeZone:"UTC",
    businessTimeZone:"America/New_York",
  };
}

export function publicTimePolicy(policy:SystemTimePolicy):Record<string,unknown>{
  return{
    configuration_release_id:policy.configurationReleaseId,
    configuration_release_key:policy.configurationReleaseKey,
    configuration_release_version:policy.releaseVersion,
    storage_timezone:policy.storageTimeZone,
    business_timezone:policy.businessTimeZone,
    storage_format:"RFC3339_UTC",
    human_display_timezone:policy.businessTimeZone,
  };
}
