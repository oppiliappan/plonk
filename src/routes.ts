import path from "node:path";
import express from "express";
import { Ctx } from "./";
import { env } from "#/lib";
import { getIronSession } from "iron-session";
import { isValidHandle, AtUri } from "@atproto/syntax";
import { IncomingMessage, ServerResponse } from "node:http";
import { Agent } from "@atproto/api";
import { getPds, DidResolver } from "@atproto/identity";
import { TID } from "@atproto/common";
import { Agent } from "@atproto/api";
import { newShortUrl } from "#/db";

import * as Paste from "#/lexicons/types/ovh/plonk/paste";
import * as Comment from "#/lexicons/types/ovh/plonk/comment";
import { ComAtprotoRepoNS } from "#/lexicons";

type Session = {
	did: string;
};

async function getSessionAgent(
	req: IncomingMessage,
	res: ServerResponse<IncomingMessage>,
	ctx: Ctx,
) {
	const session = await getIronSession<Session>(req, res, {
		cookieName: "plonk-id",
		password: env.COOKIE_SECRET,
	});
	if (!session.did) return null;
	try {
		const oauthSession = await ctx.oauthClient.restore(session.did);
		return oauthSession ? new Agent(oauthSession) : null;
	} catch (err) {
		ctx.logger.warn({ err }, "oauth restore failed");
		session.destroy();
		return null;
	}
}

export const createRouter = (ctx: Ctx) => {
	const router = express.Router();

	// Static assets
	router.use(
		"/public",
		express.static(path.join(__dirname, "pages", "public")),
	);

	// OAuth metadata
	router.get("/client-metadata.json", async (_req, res) => {
		return res.json(ctx.oauthClient.clientMetadata);
	});

	router.get("/oauth/callback", async (req, res) => {
		const params = new URLSearchParams(req.originalUrl.split("?")[1]);
		try {
			const { session } = await ctx.oauthClient.callback(params);
			const clientSession = await getIronSession<Session>(req, res, {
				cookieName: "plonk-id",
				password: env.COOKIE_SECRET,
			});
			ctx.logger.info(clientSession.did, "client session did");
			//assert(!clientSession.did, "session already exists");
			clientSession.did = session.did;
			await clientSession.save();
		} catch (err) {
			ctx.logger.error({ err }, "oauth callback failed");
			return res.redirect("/?error");
		}
		return res.redirect("/");
	});

	// GET login
	router.get("/login", async (req, res) => {
		return res.render("login");
	});
	router.post("/login", async (req, res) => {
		const agent = await getSessionAgent(req, res, ctx);
		if (agent) {
			return res.redirect("/");
		}
		const handle = req.body?.handle;
		if (typeof handle !== "string" || !isValidHandle(handle)) {
			return res.redirect("/login");
		}

		try {
			const url = await ctx.oauthClient.authorize(handle, {
				scope: "atproto transition:generic",
			});
			return res.redirect(url.toString());
		} catch (err) {
			ctx.logger.error({ err }, "oauth authorize failed");
			return res.redirect("/login");
		}
	});

	router.get("/logout", async (req, res) => {
		const session = await getIronSession<Session>(req, res, {
			cookieName: "plonk-id",
			password: env.COOKIE_SECRET,
		});
		session.destroy();
		return res.redirect("/");
	});

	router.get("/", async (req, res) => {
		const agent = await getSessionAgent(req, res, ctx);
		const pastes = await ctx.db
			.selectFrom("paste")
			.selectAll()
			.orderBy("indexedAt", "desc")
			.limit(25)
			.execute();

		// Map user DIDs to their domain-name handles
		const didHandleMap = await ctx.resolver.resolveDidsToHandles(
			pastes.map((s) => s.authorDid).concat(agent? [agent.assertDid]:[]),
		);

		if (!agent) {
			return res.render("index", { pastes, didHandleMap });
		}

		return res.render("index", {
			pastes,
			ownDid: agent.assertDid,
			didHandleMap,
		});
	});

	router.get("/u/:authorDid", async (req, res) => {
		const { authorDid } = req.params;
		const resolver = new DidResolver({});
		const didDocument = await resolver.resolve(authorDid);
		if (!didDocument) {
			return res.status(404);
		}
		const pds = getPds(didDocument);
		if (!pds) {
			return res.status(404);
		}
		const agent = new Agent(pds);
		const response = await agent.com.atproto.repo.listRecords({
			repo: authorDid,
			collection: 'ovh.plonk.paste',
			limit: 99,
		});
		const pastes = response.data.records;
		let didHandleMap = {};
		didHandleMap[authorDid] = await ctx.resolver.resolveDidToHandle(authorDid);
		return res.render("user", { pastes, authorDid, didHandleMap });
	});

	router.get("/p/:shortUrl", async (req, res) => {
		const { shortUrl } = req.params;
		const ret = await ctx.db
			.selectFrom("paste")
			.where("shortUrl", "=", shortUrl)
			.select(["authorDid", "uri"])
			.executeTakeFirst();
		if (!ret) {
			return res.status(404);
		}
		var comments = await ctx.db
			.selectFrom("comment")
			.selectAll()
			.where("pasteUri", '=', ret.uri)
			.execute();
		const { authorDid: did, uri } = ret;
		const didHandleMap = await ctx.resolver.resolveDidsToHandles(
			comments.map((c) => c.authorDid).concat([did]),
		)
		const resolver = new DidResolver({});
		const didDocument = await resolver.resolve(did);
		if (!didDocument) {
			return res.status(404);
		}
		const pds = getPds(didDocument);
		if (!pds) {
			return res.status(404);
		}
		const agent = new Agent(pds);
		const aturi = new AtUri(uri);
		const response = await agent.com.atproto.repo.getRecord({
			repo: aturi.hostname,
			collection: aturi.collection,
			rkey: aturi.rkey
		});

		const paste =
			Paste.isRecord(response.data.value) &&
			Paste.validateRecord(response.data.value).success
				? response.data.value
				: {};

		return res.render("paste", { paste, authorDid: did, uri: response.data.uri, didHandleMap, shortUrl, comments });
	});

	router.get("/p/:shortUrl/raw", async (req, res) => {
		res.redirect(`/r/${req.params.shortUrl}`)
	});
	router.get("/r/:shortUrl", async (req, res) => {
		const { shortUrl } = req.params;
		const ret = await ctx.db
			.selectFrom("paste")
			.where("shortUrl", "=", shortUrl)
			.select(["code"])
			.executeTakeFirst();
		if (!ret) {
			return res.status(404);
		}

		res.set("Content-Type", "text/plain; charset=utf-8");
		return res.send(ret.code);
	});

	router.get("/reset", async (req, res) => {
		const agent = await getSessionAgent(req, res, ctx);
		if (!agent) {
			return res.redirect('/');
		}
		const response = await agent.com.atproto.repo.listRecords({
			repo: agent.assertDid,
			collection: 'ovh.plonk.paste',
			limit: 10,
		});
		const vals = response.data.records;
		for (const v of vals) {
			const aturl = new AtUri(v.uri);
			await agent.com.atproto.repo.deleteRecord({
				repo: agent.assertDid,
				collection: aturl.collection,
				rkey: aturl.rkey,
			});
		}
		return res.redirect('/');
	});

	router.post("/paste", async (req, res) => {
		const agent = await getSessionAgent(req, res, ctx);
		if (!agent) {
			return res
				.status(401)
				.type("html")
				.send("<h1>Error: Session required</h1>");
		}

		const rkey = TID.nextStr();
		const shortUrl = await newShortUrl(ctx.db);
		const record = {
			$type: "ovh.plonk.paste",
			code: req.body?.code,
			lang: req.body?.lang,
			shortUrl,
			title: req.body?.title,
			createdAt: new Date().toISOString(),
		};

		if (!Paste.validateRecord(record).success) {
			return res
				.status(400)
				.type("html")
				.send("<h1>Error: Invalid status</h1>");
		}

		let uri;
		try {
			const res = await agent.com.atproto.repo.putRecord({
				repo: agent.assertDid,
				collection: "ovh.plonk.paste",
				rkey,
				record,
				validate: false,
			});
			uri = res.data.uri;
		} catch (err) {
			ctx.logger.warn({ err }, "failed to put record");
			return res
				.status(500)
				.type("html")
				.send("<h3>Error: Failed to write record</h1>");
		}

		try {
			const shortUrl = await newShortUrl(ctx.db);
			await ctx.db
				.insertInto("paste")
				.values({
					uri,
					shortUrl,
					authorDid: agent.assertDid,
					code: record.code,
					lang: record.lang,
					title: record.title,
					createdAt: record.createdAt,
					indexedAt: new Date().toISOString(),
				})
				.execute();
			ctx.logger.info(res, "wrote back to db");
			return res.redirect(`/p/${shortUrl}`);
		} catch (err) {
			ctx.logger.warn(
				{ err },
				"failed to update computed view; ignoring as it should be caught by the firehose",
			);
		}

		return res.redirect("/");
	});

	router.post("/:paste/comment", async (req, res) => {
		const agent = await getSessionAgent(req, res, ctx);

		if (!agent) {
			return res
				.status(401)
				.type("html")
				.send("<h1>Error: Session required</h1>");
		}
		
		const pasteUri = req.params.paste;
		const aturi = new AtUri(pasteUri);
		const pasteResponse = await agent.com.atproto.repo.getRecord({
			repo: aturi.hostname,
			collection: aturi.collection,
			rkey: aturi.rkey
		});
		const pasteCid = pasteResponse.data.cid;
		if (!pasteCid) {
			return res
				.status(401)
				.type("html")
				.send("invalid paste");
		}

		const rkey = TID.nextStr();
		const record = {
			$type: "ovh.plonk.comment",
			content: req.body?.comment,
			post: {
				uri: pasteUri,
				cid: pasteCid
			},
			createdAt: new Date().toISOString(),
		};

		if (!Comment.validateRecord(record).success) {
			return res
				.status(400)
				.type("html")
				.send("<h1>Error: Invalid status</h1>");
		}

		let uri;
		try {
			const res = await agent.com.atproto.repo.putRecord({
				repo: agent.assertDid,
				collection: "ovh.plonk.comment",
				rkey,
				record,
				validate: false,
			});
			uri = res.data.uri;
		} catch (err) {
			ctx.logger.warn({ err }, "failed to put record");
			return res
				.status(500)
				.type("html")
				.send("<h3>Error: Failed to write record</h1>");
		}

		try {
			await ctx.db
				.insertInto("comment")
				.values({
					uri,
					body: record.content,
					authorDid: agent.assertDid,
					pasteUri: record.post.uri,
					pasteCid: record.post.cid,
					createdAt: record.createdAt,
					indexedAt: new Date().toISOString(),
				})
				.execute();
			ctx.logger.info(res, "wrote back to db");
			const originalPaste = await ctx.db.selectFrom('paste').selectAll().where('uri', '=', pasteUri).executeTakeFirst();
			return res.redirect(`/p/${originalPaste.shortUrl}#${encodeURIComponent(uri)}`);
		} catch (err) {
			ctx.logger.warn(
				{ err },
				"failed to update computed view; ignoring as it should be caught by the firehose",
			);
		}

		return res.redirect("/");
	});

	return router;
};

// https://pds.icyphox.sh/xrpc/com.atproto.repo.getRecord?repo=did%3Aplc%3A3ft67n4xnawzq4qi7mcksxj5
// at://did:plc:3ft67n4xnawzq4qi7mcksxj5/ovh.plonk.paste/3lcs3lnslbk2d
// https://pds.icyphox.sh/xrpc/com.atproto.repo.getRecord?repo=did%3Aplc%3A3ft67n4xnawzq4qi7mcksxj5&collection=ovh.plonk.paste&rkey=3lcqt7newvc2c
