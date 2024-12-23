import { NodeOAuthClient } from "@atproto/oauth-client-node";
import type { Database } from "#/db";
import { env } from "#/lib";
import { SessionStore, StateStore } from "./storage";

export const createClient = async (db: Database) => {
	const publicUrl = env.PLONK_PUBLIC_URL;
	const url = publicUrl || `http://127.0.0.1:${env.PLONK_PORT}`;
	const enc = encodeURIComponent;
	return new NodeOAuthClient({
		clientMetadata: {
			client_name: "plonk.li",
			client_id: publicUrl
				? `${url}/client-metadata.json`
				: `http://${env.PLONK_HOST}?redirect_uri=${enc(`${url}/oauth/callback`)}&scope=${enc("atproto transition:generic")}`,
			client_uri: url,
			redirect_uris: [`${url}/oauth/callback`],
			scope: "atproto transition:generic",
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			application_type: "web",
			token_endpoint_auth_method: "none",
			dpop_bound_access_tokens: true,
		},
		stateStore: new StateStore(db),
		sessionStore: new SessionStore(db),
	});
};
