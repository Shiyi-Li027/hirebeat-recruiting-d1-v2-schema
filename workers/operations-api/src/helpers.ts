export function normalize(value:unknown):string{
  return String(value??"").normalize("NFKC").trim().replace(/\s+/g," ").toLowerCase();
}
export async function sha256(value:string):Promise<string>{
  const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map((byte)=>byte.toString(16).padStart(2,"0")).join("");
}
export function commandKey(body:Record<string,unknown>):string{
  const key=String(body.idempotency_key??"").trim();
  if(key.length<8||key.length>200)throw new Error("idempotency_key_invalid");
  return key;
}
export async function jsonBody(request:Request):Promise<Record<string,unknown>>{
  if(!request.headers.get("content-type")?.includes("application/json"))throw new Error("json_content_type_required");
  const value=await request.json();if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("json_object_required");
  return value as Record<string,unknown>;
}
export function response(value:unknown,status=200):Response{
  return Response.json(value,{status,headers:{"cache-control":"no-store"}});
}
export function requirePositiveInteger(value:unknown,name:string):number{
  const parsed=Number(value);if(!Number.isSafeInteger(parsed)||parsed<=0)throw new Error(`${name}_invalid`);return parsed;
}
