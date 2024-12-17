import SqliteDb from "better-sqlite3";
import { randomBytes } from "crypto";
import e from "express";

import {
	Kysely,
	Migrator,
	SqliteDialect,
	Migration,
	MigrationProvider,
} from "kysely";
import { isNumber } from "util";

export type DatabaseSchema = {
	paste: Paste;
	comment: Comment;
	auth_state: AuthState;
	auth_session: AuthSession;
};

export type Paste = {
	uri: string;
	authorDid: string;
	shortUrl: string;
	code: string;
	lang: string;
	title: string;
	createdAt: string;
	indexedAt: string;
};

export type AuthSession = {
	key: string;
	session: AuthSessionJson;
};

export type AuthState = {
	key: string;
	state: AuthStateJson;
};

export type Comment = {
	uri: string;
	authorDid: string;
	body: string;
	createdAt: string;
	indexedAt: string;
	pasteUri: string;
	pasteCid: string;
};

type AuthSessionJson = string;
type AuthStateJson = string;

export type Schema = {
	paste: Paste;
	auth_session: AuthSession;
	auth_state: AuthState;
};

const migrations: Record<string, Migration> = {};

const migrationProvider: MigrationProvider = {
	async getMigrations() {
		return migrations;
	},
};

migrations["001"] = {
	async up(db: Kysely<unknown>) {
		await db.schema
			.createTable("paste")
			.addColumn("uri", "varchar", (col) => col.primaryKey())
			.addColumn("shortUrl", "varchar", (col) => col.notNull().unique())
			.addColumn("authorDid", "varchar", (col) => col.notNull())
			.addColumn("code", "varchar", (col) => col.notNull())
			.addColumn("lang", "varchar")
			.addColumn("title", "varchar", (col) => col.notNull())
			.addColumn("createdAt", "varchar", (col) => col.notNull())
			.addColumn("indexedAt", "varchar", (col) => col.notNull())
			.execute();

		await db.schema
			.createTable("auth_session")
			.addColumn("key", "varchar", (col) => col.primaryKey())
			.addColumn("session", "varchar", (col) => col.notNull())
			.execute();

		await db.schema
			.createTable("auth_state")
			.addColumn("key", "varchar", (col) => col.primaryKey())
			.addColumn("state", "varchar", (col) => col.notNull())
			.execute();
	},
	async down(db: Kysely<unknown>) {
		await db.schema.dropTable("auth_state").execute();
		await db.schema.dropTable("auth_session").execute();
		await db.schema.dropTable("paste").execute();
	},
};

migrations["002"] = {
	async up(db: Kysely<unknown>) {
		await db.schema
			.createTable("comment")
			.addColumn("uri", "varchar", (col) => col.primaryKey())
			.addColumn("authorDid", "varchar", (col) => col.notNull())
			.addColumn("body", "varchar", (col) => col.notNull())
			.addColumn("createdAt", "varchar", (col) => col.notNull())
			.addColumn("indexedAt", "varchar", (col) => col.notNull())
			.addColumn("pasteUri", "varchar", (col) => col.notNull())
			.addColumn("pasteCid", "varchar", (col) => col.notNull())
			.execute();
	},
	async down(db: Kysely<unknown>) {
		await db.schema.dropTable("comments").execute();
	},
};

function generateShortString(length: number): string {
	return randomBytes(length).toString("base64url").substring(0, length);
}

export async function newShortUrl(
	db: Database,
	length: number = 2,
): Promise<string> {
	let shortUrl: string;

	while (true) {
		shortUrl = generateShortString(length);

		try {
			let exists = await db
				.selectFrom("paste")
				.selectAll()
				.where("shortUrl", "=", shortUrl)
				.limit(1)
				.executeTakeFirst();
			if (!exists) {
				break; // Break the loop if insertion is successful
			}
		} catch (error) {
			// If we run out of options at the current length, increase the length
			if (await hasExhaustedShortUrls(db, length)) {
				length++;
			}
			throw error;
		}
	}

	return shortUrl;
}

// Check if all short URLs of the current length have been exhausted
async function hasExhaustedShortUrls(
	db: Database,
	length: number,
): Promise<boolean> {
	const totalPossible = Math.pow(64, length);
	const count = await db
		.selectFrom("paste")
		.select((e) => e.fn.count("uri").as("count"))
		.executeTakeFirst();
	if (isNumber(count)) {
		return count >= totalPossible;
	} else {
		return true;
	}
}

export const createDb = (location: string): Database => {
	return new Kysely<DatabaseSchema>({
		dialect: new SqliteDialect({
			database: new SqliteDb(location),
		}),
	});
};

export const migrateToLatest = async (db: Database) => {
	const migrator = new Migrator({ db, provider: migrationProvider });
	const { error } = await migrator.migrateToLatest();
	if (error) throw error;
};

export type Database = Kysely<DatabaseSchema>;
