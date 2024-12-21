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

import * as Paste from "#/lexicons/types/li/plonk/paste";
import * as Comment from "#/lexicons/types/li/plonk/comment";
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
		password: env.PLONK_COOKIE_SECRET,
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
				password: env.PLONK_COOKIE_SECRET,
			});
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
			password: env.PLONK_COOKIE_SECRET,
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
			pastes.map((s) => s.authorDid).concat(agent ? [agent.assertDid] : []),
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
		const pastes = await ctx.db
			.selectFrom("paste")
			.selectAll()
			.where("authorDid", "=", authorDid)
			.execute();
		let didHandleMap = {};
		didHandleMap[authorDid] = await ctx.resolver.resolveDidToHandle(authorDid);
		const ownAgent = await getSessionAgent(req, res, ctx);
		if (!ownAgent) {
			return res.render("user", { pastes, authorDid, didHandleMap });
		} else {
			const ownDid = ownAgent.assertDid;
			didHandleMap[ownDid] = await ctx.resolver.resolveDidToHandle(ownDid);
			return res.render("user", { pastes, authorDid, ownDid, didHandleMap });
		}
	});

	router.get("/p/:shortUrl", async (req, res) => {
		const { shortUrl } = req.params;
		const ret = await ctx.db
			.selectFrom("paste")
			.leftJoin("comment", "comment.pasteUri", "paste.uri")
			.select([
				"paste.uri as pasteUri",
				"comment.pasteCid as pasteCid",
				"paste.authorDid as pasteAuthorDid",
				"paste.code as pasteCode",
				"paste.lang as pasteLang",
				"paste.title as pasteTitle",
				"paste.createdAt as pasteCreatedAt",
				"comment.uri as commentUri",
				"comment.authorDid as commentAuthorDid",
				"comment.body as commentBody",
				"comment.createdAt as commentCreatedAt",
			])
			.where("shortUrl", "=", shortUrl)
			.execute();
		if (ret.length === 0) {
			return res.status(404);
		}
		const {
			pasteAuthorDid,
			pasteUri,
			pasteCode,
			pasteLang,
			pasteTitle,
			pasteCreatedAt,
		} = ret[0];
		let didHandleMap = await ctx.resolver.resolveDidsToHandles(
			[ret[0].pasteAuthorDid].concat(
				ret.flatMap((row) =>
					row.commentAuthorDid ? [row.commentAuthorDid] : [],
				),
			),
		);

		const paste = {
			uri: pasteUri,
			code: pasteCode,
			title: pasteTitle,
			lang: pasteLang,
			shortUrl,
			createdAt: pasteCreatedAt,
			authorDid: pasteAuthorDid,
		};

		const comments = ret.map((row) => {
			return {
				uri: row.commentUri,
				authorDid: row.commentAuthorDid,
				body: row.commentBody,
				createdAt: row.commentCreatedAt,
			};
		});

		const ownAgent = await getSessionAgent(req, res, ctx);
		if (!ownAgent) {
			return res.render("paste", {
				paste,
				didHandleMap,
				comments,
			});
		} else {
			const ownDid = ownAgent.assertDid;
			didHandleMap[ownDid] = await ctx.resolver.resolveDidToHandle(ownDid);
			return res.render("paste", {
				paste,
				ownDid,
				didHandleMap,
				comments,
			});
		}
	});

	router.get("/p/:shortUrl/raw", async (req, res) => {
		res.redirect(`/r/${req.params.shortUrl}`);
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
			return res.redirect("/");
		}
		const response = await agent.com.atproto.repo.listRecords({
			repo: agent.assertDid,
			collection: "li.plonk.paste",
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
		return res.redirect("/");
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
			$type: "li.plonk.paste",
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
				collection: "li.plonk.paste",
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
			rkey: aturi.rkey,
		});
		const pasteCid = pasteResponse.data.cid;
		if (!pasteCid) {
			return res.status(401).type("html").send("invalid paste");
		}

		const rkey = TID.nextStr();
		const record = {
			$type: "li.plonk.comment",
			content: req.body?.comment,
			post: {
				uri: pasteUri,
				cid: pasteCid,
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
				collection: "li.plonk.comment",
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
			const originalPaste = await ctx.db
				.selectFrom("paste")
				.selectAll()
				.where("uri", "=", pasteUri)
				.executeTakeFirst();
			return res.redirect(
				`/p/${originalPaste.shortUrl}#${encodeURIComponent(uri)}`,
			);
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
