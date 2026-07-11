import { giteaApi, type Api } from "gitea-js";
import type { RepoContext } from "./context.js";

export type GiteaClient = Api<unknown>;

export function createClient(context: RepoContext): GiteaClient {
  return giteaApi(context.apiUrl, {
    token: context.token || undefined,
  });
}
