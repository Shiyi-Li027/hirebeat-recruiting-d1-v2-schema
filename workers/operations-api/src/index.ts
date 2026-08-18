import { authenticateAccess } from "./access-auth";
import { catalogOptions, createCompany, createCompanyWorkMode, createPosition, publishCatalogRevision, updateCompany, updatePosition } from "./catalog";
import { jsonBody, requirePositiveInteger, response } from "./helpers";
import { transitionOffer } from "./offer-state";
import { requestMlRecommendation } from "./hiring-command";
import { createOfferVersion } from "./offer-version";

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
      if(request.method==="GET"&&url.pathname==="/v1/catalog/options")return response(await catalogOptions(env.DB));
      if(request.method==="POST"&&url.pathname==="/v1/catalog/companies")return response(await createCompany(env.DB,await jsonBody(request),auth.actor),201);
      const companyId=idFromPath(url.pathname,/^\/v1\/catalog\/companies\/(\d+)$/);
      if(request.method==="PATCH"&&companyId)return response(await updateCompany(env.DB,companyId,await jsonBody(request),auth.actor));
      if(request.method==="POST"&&url.pathname==="/v1/catalog/company-work-modes")return response(await createCompanyWorkMode(env.DB,await jsonBody(request),auth.actor),201);
      if(request.method==="POST"&&url.pathname==="/v1/catalog/positions")return response(await createPosition(env.DB,await jsonBody(request),auth.actor),201);
      const positionId=idFromPath(url.pathname,/^\/v1\/catalog\/positions\/(\d+)$/);
      if(request.method==="PATCH"&&positionId)return response(await updatePosition(env.DB,positionId,await jsonBody(request),auth.actor));
      if(request.method==="POST"&&url.pathname==="/v1/catalog/revisions")return response(await publishCatalogRevision(env.DB,await jsonBody(request),auth.actor),201);
      const mlApplicationId=idFromPath(url.pathname,/^\/v1\/applications\/(\d+)\/ml-recommendation$/);
      if(request.method==="POST"&&mlApplicationId)return response(await requestMlRecommendation(env.DB,mlApplicationId,await jsonBody(request),auth.actor),202);
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
