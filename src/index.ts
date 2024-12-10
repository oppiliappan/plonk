import type http from "node:http";
import path from "node:path";

import express from "express";
import { OAuthClient } from "@atproto/oauth-client-node";
import { pino } from "pino";
import { Firehose } from "@atproto/sync";
import { createRouter } from "#/routes";
import {
	createIdResolver,
	createBidirectionalResolver,
	BidirectionalResolver,
} from "#/id-resolver";
import { createIngester } from "#/ingester";
import { createClient } from "#/auth/client";
import { Database, createDb, migrateToLatest } from "#/db";
import { env } from "#/lib";

export type Ctx = {
	ingester: Firehose;
	logger: pino.Logger;
	oauthClient: OAuthClient;
	resolver: BidirectionalResolver;
	db: Database;
};

export class Server {
	constructor(
		public app: express.Application,
		public server: http.Server,
		public ctx: Ctx,
	) {}

	static async create() {
		const db: Database = createDb(env.DB_PATH);
		await migrateToLatest(db);
		const idResolver = createIdResolver();
		const ctx: Ctx = {
			ingester: createIngester(db, idResolver),
			logger: pino({ name: "server start" }),
			oauthClient: await createClient(db),
			resolver: createBidirectionalResolver(idResolver),
			db: db,
		};

		const app = express();
		app.set("trust proxy", true);
		app.use(express.static(path.join(__dirname, "public")));
		app.set("views", path.join(__dirname, "views"));
		app.set("view engine", "pug");

		const router = createRouter(ctx);
		app.use(express.json());
		app.use(express.urlencoded({ extended: true }));
		app.use(router);
		app.use((_req, res) => res.sendStatus(404));

		const server = app.listen(env.PORT);

		return new Server(app, server, ctx);
	}

	async close() {
		this.ctx.logger.info("shutting down");
		await this.ctx.ingester.destroy();
		return new Promise<void>((resolve) => {
			this.server.close(() => {
				this.ctx.logger.info("server closed");
				resolve();
			});
		});
	}
}

const run = async () => {
	const server = await Server.create();

	const onCloseSignal = async () => {
		setTimeout(() => process.exit(1), 10000).unref(); // Force shutdown after 10s
		await server.close();
		process.exit();
	};

	process.on("SIGINT", onCloseSignal);
	process.on("SIGTERM", onCloseSignal);
};

run();
