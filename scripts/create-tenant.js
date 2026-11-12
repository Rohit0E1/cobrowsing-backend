require("dotenv").config();
const { parseArgs } = require("node:util");
const { pool, initDb } = require("../src/config/db");
const TenantService = require("../src/services/TenantService");
const UserService = require("../src/services/UserService");
const ProjectService = require("../src/services/ProjectService");

const USAGE = `Usage:
  TENANT_ADMIN_PASSWORD=... node scripts/create-tenant.js \\
    --slug tantra --name "Tantra Realty" --deck https://tantra-realty.vercel.app \\
    [--project "Vale of Dapoli"] [--admin-email a@b.com --admin-name "Jane Doe"]`;

async function main() {
    const { values } = parseArgs({
        options: {
            slug: { type: "string" },
            name: { type: "string" },
            deck: { type: "string" },
            project: { type: "string" },
            "admin-email": { type: "string" },
            "admin-name": { type: "string" },
        },
    });

    if (!values.slug || !values.name || !/^[a-z0-9-]+$/.test(values.slug)) {
        throw new Error(`--slug (lowercase, digits, dashes) and --name are required\n\n${USAGE}`);
    }
    if (values.deck && !/^https:\/\/[^\s/]+$/.test(values.deck.replace(/\/$/, ""))) {
        throw new Error("--deck must be an https origin, e.g. https://tantra-realty.vercel.app");
    }
    const adminEmail = values["admin-email"];
    const password = process.env.TENANT_ADMIN_PASSWORD;
    if (adminEmail && (!values["admin-name"] || !password || password.length < 8)) {
        throw new Error("--admin-email needs --admin-name and TENANT_ADMIN_PASSWORD (min 8 chars)");
    }

    await initDb();

    const tenant = await TenantService.upsert({
        slug: values.slug,
        name: values.name,
        deck_origin: values.deck ? values.deck.replace(/\/$/, "") : null,
    });
    console.log(`Tenant #${tenant.id} ${tenant.slug} → deck ${tenant.deck_origin || "(platform default)"}`);

    if (values.project) {
        const existing = (await ProjectService.getAll(tenant.id)).find((p) => p.name === values.project);
        const project = existing || (await ProjectService.create(tenant.id, { name: values.project }));
        console.log(`Project #${project.id} ${project.name}${existing ? " (already existed)" : ""}`);
    }

    if (adminEmail) {
        const user = await UserService.register(tenant.id, {
            name: values["admin-name"],
            email: adminEmail.trim().toLowerCase(),
            password,
        });
        console.log(`Admin user #${user.id} ${user.email}`);
    }
}

main()
    .catch((err) => {
        console.error(err.code === "23505" ? "That admin email is already registered" : err.message);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
