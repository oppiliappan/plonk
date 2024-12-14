import pino from "pino";
import { IdResolver } from "@atproto/identity";
import { Firehose } from "@atproto/sync";
import type { Database } from "#/db";
import * as Paste from "#/lexicons/types/ovh/plonk/paste";
import * as Comment from "#/lexicons/types/ovh/plonk/comment";

export function createIngester(db: Database, idResolver: IdResolver) {
	const logger = pino({ name: "firehose ingestion" });
	return new Firehose({
		idResolver,
		handleEvent: async (evt) => {
			// Watch for write events
			if (evt.event === "create" || evt.event === "update") {
				const now = new Date();
				const record = evt.record;

				// If the write is a valid status update
				if (
					evt.collection === "ovh.plonk.paste" &&
					Paste.isRecord(record) &&
					Paste.validateRecord(record).success
				) {
					await db
						.insertInto("paste")
						.values({
							uri: evt.uri.toString(),
							shortUrl: record.shortUrl,
							authorDid: evt.did,
							code: record.code,
							lang: record.lang,
							title: record.title,
							createdAt: record.createdAt,
							indexedAt: now.toISOString(),
						})
						.onConflict((oc) =>
							oc.column("uri").doUpdateSet({
								code: record.code,
								lang: record.lang,
								title: record.title,
								indexedAt: now.toISOString(),
							}),
						)
						.execute();
				} else if (
					evt.collection === "ovh.plonk.comment" &&
					Comment.isRecord(record) &&
					Comment.validateRecord(record).success
				) {
					await db
						.insertInto("comment")
						.values({
							uri: evt.uri.toString(),
							authorDid: evt.did,
							body: record.content,
							pasteUri: record.post.uri,
							pasteCid: record.post.cid,
							createdAt: record.createdAt,
							indexedAt: now.toISOString(),
						})
						.onConflict((oc) =>
							oc.column("uri").doUpdateSet({
								body: record.content,
								pasteUri: record.post.uri,
								pasteCid: record.post.cid,
								indexedAt: now.toISOString(),
							}),
						)
						.execute();
				}
			} else if (
				evt.event === "delete" &&
				evt.collection === "ovh.plonk.paste"
			) {
				// Remove the status from our SQLite
				await db
					.deleteFrom("paste")
					.where("uri", "=", evt.uri.toString())
					.execute();
			} else if (
				evt.event === "delete" &&
				evt.collection === "ovh.plonk.comment"
			) {
				// Remove the status from our SQLite
				await db
					.deleteFrom("comment")
					.where("uri", "=", evt.uri.toString())
					.execute();
			} 
		},
		onError: (err) => {
			logger.error({ err }, "error on firehose ingestion");
		},
		filterCollections: ["ovh.plonk.paste"],
		excludeIdentity: true,
		excludeAccount: true,
	});
}
