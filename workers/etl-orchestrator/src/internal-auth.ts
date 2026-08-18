export async function requireInternalToken(request:Request,expected:string):Promise<void>{
  if(!expected||expected.length<32)throw new Error("orchestrator_internal_auth_not_configured");
  const supplied=request.headers.get("authorization")?.replace(/^Bearer\s+/,"")??"";
  const encoder=new TextEncoder();
  const [a,b]=await Promise.all([crypto.subtle.digest("SHA-256",encoder.encode(supplied)),crypto.subtle.digest("SHA-256",encoder.encode(expected))]);
  const aa=new Uint8Array(a);const bb=new Uint8Array(b);let different=aa.length^bb.length;
  for(let index=0;index<Math.max(aa.length,bb.length);index+=1)different|=(aa[index]??0)^(bb[index]??0);
  if(different!==0)throw new Error("orchestrator_internal_auth_invalid");
}
