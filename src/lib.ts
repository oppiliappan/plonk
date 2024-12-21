import dotenv from "dotenv";
import { cleanEnv, host, port, str, testOnly } from "envalid";

dotenv.config();

export const env = cleanEnv(process.env, {
	PLONK_NODE_ENV: str({
		devDefault: testOnly("test"),
		choices: ["development", "production", "test"],
	}),
	PLONK_HOST: host({ devDefault: testOnly("localhost") }),
	PLONK_PORT: port({ devDefault: testOnly(3000) }),
	PLONK_PUBLIC_URL: str({}),
	PLONK_DB_PATH: str({ devDefault: ":memory:" }),
	PLONK_COOKIE_SECRET: str({ devDefault: "00000000000000000000000000000000" }),
});
