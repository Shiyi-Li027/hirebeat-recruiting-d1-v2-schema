export interface OfferDeadlinePolicy {
  configurationReleaseId:number;
  configurationReleaseKey:string;
  releaseVersion:number;
  defaultResponseWindowDays:number;
}

const RFC3339_PATTERN=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;
const LOCAL_TIMESTAMP_PATTERN=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/;

function validParts(parts:number[]):boolean{
  const [year,month,day,hour,minute,second,millisecond]=parts;
  if(month<1||month>12||hour>23||minute>59||second>59)return false;
  const date=new Date(0);date.setUTCFullYear(year,month-1,day);date.setUTCHours(hour,minute,second,millisecond);
  return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day;
}

function zonedParts(instant:Date,timeZone:string):number[]{
  let values:Record<string,string>;
  try{
    values=Object.fromEntries(new Intl.DateTimeFormat("en-US",{
      timeZone,calendar:"gregory",numberingSystem:"latn",hourCycle:"h23",
      year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",
    }).formatToParts(instant).filter((part)=>part.type!=="literal").map((part)=>[part.type,part.value]));
  }catch{throw new Error("response_due_at_timezone_invalid");}
  return["year","month","day","hour","minute","second"].map((key)=>Number(values[key]));
}

export function localTimestampInTimeZone(value:string,timeZone:string):string{
  const match=value.trim().match(LOCAL_TIMESTAMP_PATTERN);
  if(!match)throw new Error("response_due_at_invalid_local_datetime");
  const parts=[Number(match[1]),Number(match[2]),Number(match[3]),Number(match[4]),Number(match[5]),Number(match[6]),Number((match[7]??"").padEnd(3,"0"))];
  if(!validParts(parts))throw new Error("response_due_at_invalid_local_datetime");
  const wallClock=new Date(0);wallClock.setUTCFullYear(parts[0],parts[1]-1,parts[2]);wallClock.setUTCHours(parts[3],parts[4],parts[5],parts[6]);
  const wallClockUtc=wallClock.getTime();
  const candidates:string[]=[];
  for(let offsetMinutes=-14*60;offsetMinutes<=14*60;offsetMinutes+=15){
    const candidate=new Date(wallClockUtc-offsetMinutes*60_000);
    const displayed=zonedParts(candidate,timeZone);
    if(displayed.every((part,index)=>part===parts[index]))candidates.push(candidate.toISOString());
  }
  const unique=[...new Set(candidates)];
  if(unique.length===0)throw new Error("response_due_at_nonexistent_local_time");
  if(unique.length>1)throw new Error("response_due_at_ambiguous_local_time");
  return unique[0];
}

export function parseResponseDueAt(value:unknown,timeZone?:string|null):string|null{
  if(value===undefined||value===null||value==="")return null;
  if(typeof value!=="string")throw new Error("response_due_at_invalid_rfc3339");
  const input=value.trim();const match=input.match(RFC3339_PATTERN);
  if(!match&&timeZone)return localTimestampInTimeZone(input,timeZone);
  if(!match)throw new Error("response_due_at_invalid_rfc3339");
  const [,yearText,monthText,dayText,hourText,minuteText,secondText,fraction="",zone]=match;
  const year=Number(yearText);const month=Number(monthText);const day=Number(dayText);
  const hour=Number(hourText);const minute=Number(minuteText);const second=Number(secondText);
  const millisecond=Number((fraction+"000").slice(0,3));
  if(month<1||month>12||hour>23||minute>59||second>59)throw new Error("response_due_at_invalid_rfc3339");
  const local=new Date(0);local.setUTCFullYear(year,month-1,day);local.setUTCHours(hour,minute,second,millisecond);
  if(local.getUTCFullYear()!==year||local.getUTCMonth()!==month-1||local.getUTCDate()!==day)throw new Error("response_due_at_invalid_rfc3339");
  let offsetMinutes=0;
  if(zone!=="Z"){
    const offsetHour=Number(zone.slice(1,3));const offsetMinute=Number(zone.slice(4,6));
    if(offsetHour>23||offsetMinute>59)throw new Error("response_due_at_invalid_rfc3339");
    offsetMinutes=(offsetHour*60+offsetMinute)*(zone[0]==="+"?1:-1);
  }
  const instant=new Date(local.getTime()-offsetMinutes*60_000);
  if(!Number.isFinite(instant.getTime()))throw new Error("response_due_at_invalid_rfc3339");
  return instant.toISOString();
}

export function requireFutureResponseDueAt(value:unknown,boundary:Date,timeZone?:string|null):string|null{
  const dueAt=parseResponseDueAt(value,timeZone);
  if(dueAt!==null&&Date.parse(dueAt)<=boundary.getTime())throw new Error("response_due_at_must_be_future");
  return dueAt;
}

export function responseDueAtFromDays(sentAt:Date,days:number):string{
  if(!Number.isSafeInteger(days)||days<1||days>365)throw new Error("offer_default_response_window_days_invalid");
  return new Date(sentAt.getTime()+days*86_400_000).toISOString();
}

export async function loadOfferDeadlinePolicy(db:D1Database):Promise<OfferDeadlinePolicy>{
  const row=await db.prepare(
    `SELECT release.id configuration_release_id,
            release.configuration_release_key,
            release.release_version,
            config.configuration_value_json
     FROM system_configuration_release release
     JOIN system_configuration config ON config.configuration_release_id=release.id
       AND config.configuration_scope='offer'
       AND config.configuration_key='default_response_window_days'
     WHERE release.release_status='active'
     LIMIT 1`,
  ).first<{configuration_release_id:number;configuration_release_key:string;release_version:number;configuration_value_json:string}>();
  if(!row)throw new Error("offer_default_response_window_days_missing");
  let value:unknown;
  try{value=JSON.parse(row.configuration_value_json);}catch{throw new Error("offer_default_response_window_days_invalid");}
  if(!Number.isSafeInteger(value)||Number(value)<1||Number(value)>365)throw new Error("offer_default_response_window_days_invalid");
  return{
    configurationReleaseId:row.configuration_release_id,
    configurationReleaseKey:row.configuration_release_key,
    releaseVersion:row.release_version,
    defaultResponseWindowDays:Number(value),
  };
}
