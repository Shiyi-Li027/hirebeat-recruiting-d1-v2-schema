interface AccessClaims { aud:string|string[];email?:string;sub:string;iss:string;exp:number;nbf?:number; }

function decode(value:string):Uint8Array{
  const normalized=value.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(value.length/4)*4,"=");
  return Uint8Array.from(atob(normalized),(character)=>character.charCodeAt(0));
}

export async function authenticateAccess(request:Request,teamDomain:string,expectedAud:string):Promise<{actor:string;claims:AccessClaims}>{
  const jwt=request.headers.get("cf-access-jwt-assertion");
  if(!jwt)throw new Error("access_jwt_missing");
  const parts=jwt.split(".");if(parts.length!==3)throw new Error("access_jwt_malformed");
  const header=JSON.parse(new TextDecoder().decode(decode(parts[0]))) as {kid?:string;alg?:string};
  const claims=JSON.parse(new TextDecoder().decode(decode(parts[1]))) as AccessClaims;
  if(header.alg!=="RS256"||!header.kid)throw new Error("access_jwt_algorithm_invalid");
  const domain=teamDomain.replace(/\/$/,"");
  const response=await fetch(`${domain}/cdn-cgi/access/certs`,{cf:{cacheTtl:300,cacheEverything:true}});
  if(!response.ok)throw new Error("access_jwks_unavailable");
  const keys=await response.json<{keys:JsonWebKey[]}>();
  const jwk=keys.keys.find((candidate)=>(candidate as JsonWebKey & {kid?:string}).kid===header.kid);
  if(!jwk)throw new Error("access_jwt_kid_unknown");
  const key=await crypto.subtle.importKey("jwk",jwk,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
  const verified=await crypto.subtle.verify("RSASSA-PKCS1-v1_5",key,decode(parts[2]),new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  const now=Math.floor(Date.now()/1000);const audiences=Array.isArray(claims.aud)?claims.aud:[claims.aud];
  if(!verified||!audiences.includes(expectedAud)||claims.exp<=now||(claims.nbf??0)>now||claims.iss.replace(/\/$/,"")!==domain)throw new Error("access_jwt_claims_invalid");
  return{actor:claims.email??claims.sub,claims};
}
