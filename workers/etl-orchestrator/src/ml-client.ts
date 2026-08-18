export interface SimilarityResponse {
  match_score: number;
  similarity_metric: "cosine_similarity";
  model_name: "all-MiniLM-L6-v2";
  model_provider: "sentence_transformers";
  model_revision: string | null;
  resume_text_sha256: string;
  position_jd_sha256: string;
}

export async function calculateSimilarity(
  serviceUrl:string,authToken:string,resumeText:string,positionJd:string,timeoutMs=30_000,
):Promise<SimilarityResponse>{
  if(!serviceUrl||!authToken)throw new Error("ml_service_not_configured");
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort("ml_service_timeout"),timeoutMs);
  try{
    const response=await fetch(`${serviceUrl.replace(/\/$/,"")}/v1/similarity`,{
      method:"POST",
      headers:{"content-type":"application/json",authorization:`Bearer ${authToken}`},
      body:JSON.stringify({resume_text:resumeText,position_jd:positionJd}),
      signal:controller.signal,
    });
    if(!response.ok)throw new Error(`ml_service_http_${response.status}`);
    const value=await response.json<SimilarityResponse>();
    if(!Number.isFinite(value.match_score)||value.match_score < -1||value.match_score > 1)throw new Error("ml_service_response_invalid");
    if(value.model_name!=="all-MiniLM-L6-v2"||value.similarity_metric!=="cosine_similarity")throw new Error("ml_service_model_contract_mismatch");
    return value;
  }finally{clearTimeout(timer);}
}
