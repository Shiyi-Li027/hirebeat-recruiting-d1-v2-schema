import { authenticateAccess } from "./access-auth";
import { catalogOptions, catalogRevisionOptions, createCompany, createCompanyWorkMode, createPosition, publishCatalogRevision, updateCompany, updatePosition } from "./catalog";
import { jsonBody, requirePositiveInteger, response } from "./helpers";
import { transitionOffer } from "./offer-state";
import { requestMlRecommendation } from "./hiring-command";
import { createOfferVersion } from "./offer-version";
import { createReference, referenceTypes, setReferenceActive } from "./reference-importer";
import { catalogChildTypes, createCatalogChild, setCatalogChildActive } from "./catalog-child-importer";
import { beginCatalogSyncRun, reportCatalogSyncTargetResult } from "./catalog-sync-reporting";
import { requestIntakeRecovery } from "./intake-recovery";
import { loadSystemTimePolicy, publicTimePolicy } from "./time-policy";

interface Env { DB:D1Database;DEPLOYMENT_STAGE:string;ACCESS_TEAM_DOMAIN:string;ACCESS_AUD:string; }

function idFromPath(path:string,pattern:RegExp):number|null{
  const match=path.match(pattern);return match?requirePositiveInteger(match[1],"path_id"):null;
}

export default {
  async fetch(request:Request,env:Env):Promise<Response>{
    const url=new URL(request.url);
    if(request.method==="GET"&&url.pathname==="/health")return response({service:"hirebeat-operations-api",status:"running",stage:env.DEPLOYMENT_STAGE});
    try{
      const auth=await authenticateAccess(request,env.ACCESS_TEAM_DOMAIN,env.ACCESS_AUD);
      if(request.method==="GET"&&url.pathname==="/v1/reference/types")return response({reference_types:referenceTypes()});
      if(request.method==="GET"&&url.pathname==="/v1/system/time-policy")return response(publicTimePolicy(await loadSystemTimePolicy(env.DB)));
      const referenceCreate=url.pathname.match(/^\/v1\/reference\/([a-z0-9_]+)$/);
      if(request.method==="POST"&&referenceCreate)return response(await createReference(env.DB,referenceCreate[1],await jsonBody(request),auth.actor),201);
      const referenceState=url.pathname.match(/^\/v1\/reference\/([a-z0-9_]+)\/(\d+)\/active-state$/);
      if(request.method==="PATCH"&&referenceState)return response(await setReferenceActive(env.DB,referenceState[1],requirePositiveInteger(referenceState[2],"path_id"),await jsonBody(request),auth.actor));
      if(request.method==="GET"&&url.pathname==="/v1/catalog/child-types")return response({catalog_child_types:catalogChildTypes()});
      const childCreate=url.pathname.match(/^\/v1\/catalog\/children\/([a-z0-9_]+)$/);
      if(request.method==="POST"&&childCreate)return response(await createCatalogChild(env.DB,childCreate[1],await jsonBody(request),auth.actor),201);
      const childState=url.pathname.match(/^\/v1\/catalog\/children\/([a-z0-9_]+)\/(\d+)\/active-state$/);
      if(request.method==="PATCH"&&childState)return response(await setCatalogChildActive(env.DB,childState[1],requirePositiveInteger(childState[2],"path_id"),await jsonBody(request),auth.actor));
      if(request.method==="GET"&&url.pathname==="/v1/catalog/options")return response(await catalogOptions(env.DB));
      const revisionOptions=url.pathname.match(/^\/v1\/catalog\/revisions\/(\d+)\/options$/);
      if(request.method==="GET"&&revisionOptions)return response(await catalogRevisionOptions(env.DB,requirePositiveInteger(revisionOptions[1],"revision_number")));
      if(request.method==="POST"&&url.pathname==="/v1/catalog/companies")return response(await createCompany(env.DB,await jsonBody(request),auth.actor),201);
      const companyId=idFromPath(url.pathname,/^\/v1\/catalog\/companies\/(\d+)$/);
      if(request.method==="PATCH"&&companyId)return response(await updateCompany(env.DB,companyId,await jsonBody(request),auth.actor));
      if(request.method==="POST"&&url.pathname==="/v1/catalog/company-work-modes")return response(await createCompanyWorkMode(env.DB,await jsonBody(request),auth.actor),201);
      if(request.method==="POST"&&url.pathname==="/v1/catalog/positions")return response(await createPosition(env.DB,await jsonBody(request),auth.actor),201);
      const positionId=idFromPath(url.pathname,/^\/v1\/catalog\/positions\/(\d+)$/);
      if(request.method==="PATCH"&&positionId)return response(await updatePosition(env.DB,positionId,await jsonBody(request),auth.actor));
      if(request.method==="POST"&&url.pathname==="/v1/catalog/revisions")return response(await publishCatalogRevision(env.DB,await jsonBody(request),auth.actor),201);
      if(request.method==="POST"&&url.pathname==="/v1/catalog-sync-runs")return response(await beginCatalogSyncRun(
        env.DB,
        await jsonBody(request),
        auth.actor,
        auth.actorType,
      ),201);
      const catalogSyncTargetRunId=idFromPath(url.pathname,/^\/v1\/catalog-sync-target-runs\/(\d+)\/result$/);
      if(request.method==="POST"&&catalogSyncTargetRunId)return response(await reportCatalogSyncTargetResult(
        env.DB,
        catalogSyncTargetRunId,
        await jsonBody(request),
        auth.actor,
        auth.actorType,
      ));
      const mlApplicationId=idFromPath(url.pathname,/^\/v1\/applications\/(\d+)\/ml-recommendation$/);
      if(request.method==="POST"&&mlApplicationId)return response(await requestMlRecommendation(env.DB,mlApplicationId,await jsonBody(request),auth.actor),202);
      const intakeRunId=idFromPath(url.pathname,/^\/v1\/intake-runs\/(\d+)\/recover$/);
      if(request.method==="POST"&&intakeRunId)return response(await requestIntakeRecovery(env.DB,intakeRunId,await jsonBody(request),auth.actor),202);
      const offerId=idFromPath(url.pathname,/^\/v1\/offers\/(\d+)\/status$/);
      if(request.method==="POST"&&offerId)return response(await transitionOffer(env.DB,offerId,await jsonBody(request),auth.actor));
      const versionOfferId=idFromPath(url.pathname,/^\/v1\/offers\/(\d+)\/versions$/);
      if(request.method==="POST"&&versionOfferId)return response(await createOfferVersion(env.DB,versionOfferId,await jsonBody(request),auth.actor),201);
      return response({error:"not_found"},404);
    }catch(error){
      const code=error instanceof Error?error.message:"internal_error";
      const authentication=code.startsWith("access_");
      return response({error:authentication?"unauthorized":code},authentication?401:400);
    }
  },
} satisfies ExportedHandler<Env>;
