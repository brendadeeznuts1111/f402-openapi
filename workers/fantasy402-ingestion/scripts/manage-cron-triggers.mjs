import fs from "node:fs";

const accountId = "7a470541a704caaf91e71efccc78fd36";
const workerName = "fantasy402-ingestion";
const desiredSchedules = ["*/15 * * * *", "0 */6 * * *"];
const accountScheduleLimit = 5;
const args = new Set(process.argv.slice(2));
const mode = args.has("--enable") ? "enable" : args.has("--disable") ? "disable" : "status";
const token = readWranglerOauthToken();

const scripts = await api(`/accounts/${accountId}/workers/scripts`);
const scriptNames = (Array.isArray(scripts) ? scripts : scripts.items ?? [])
  .map((script) => script.id || script.script_name || script.name)
  .filter(Boolean)
  .sort();

const scheduledWorkers = [];
for (const name of scriptNames) {
  const schedules = await getSchedules(name);
  if (schedules.length > 0) scheduledWorkers.push({ name, schedules });
}

const currentSchedules = scheduledWorkers.find((worker) => worker.name === workerName)?.schedules ?? [];
const otherScheduleCount = scheduledWorkers
  .filter((worker) => worker.name !== workerName)
  .reduce((count, worker) => count + worker.schedules.length, 0);
const totalSchedules = scheduledWorkers.reduce((count, worker) => count + worker.schedules.length, 0);
const capacityAfterEnable = otherScheduleCount + desiredSchedules.length;

if (mode === "enable") {
  if (capacityAfterEnable > accountScheduleLimit) {
    console.log(
      JSON.stringify(
        {
          status: "blocked",
          reason: "account cron trigger limit would be exceeded",
          accountScheduleLimit,
          otherScheduleCount,
          desiredSchedules,
          scheduledWorkers,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  await putSchedules(workerName, desiredSchedules);
}

if (mode === "disable") {
  await putSchedules(workerName, []);
}

const updatedSchedules = mode === "status" ? currentSchedules : await getSchedules(workerName);
console.log(
  JSON.stringify(
    {
      status: "ok",
      mode,
      workerName,
      desiredSchedules,
      currentSchedules: updatedSchedules,
      accountScheduleLimit,
      totalSchedules: mode === "status" ? totalSchedules : otherScheduleCount + updatedSchedules.length,
      freeSlots: accountScheduleLimit - otherScheduleCount - updatedSchedules.length,
      canEnableDesiredSchedules: capacityAfterEnable <= accountScheduleLimit,
      scheduledWorkers,
    },
    null,
    2,
  ),
);

async function getSchedules(name) {
  const result = await api(`/accounts/${accountId}/workers/scripts/${encodeURIComponent(name)}/schedules`);
  const schedules = Array.isArray(result) ? result : result.schedules ?? [];
  return schedules.map((schedule) => schedule.cron || schedule).filter(Boolean);
}

async function putSchedules(name, schedules) {
  await api(`/accounts/${accountId}/workers/scripts/${encodeURIComponent(name)}/schedules`, {
    method: "PUT",
    body: JSON.stringify(schedules.map((cron) => ({ cron }))),
  });
}

async function api(path, init = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { text };
  }
  if (!response.ok || body.success === false) {
    throw new Error(
      JSON.stringify(
        {
          status: response.status,
          path,
          errors: body.errors ?? [],
          message: body.text,
        },
        null,
        2,
      ),
    );
  }
  return body.result;
}

function readWranglerOauthToken() {
  const configPath = `${process.env.HOME}/.wrangler/config/default.toml`;
  const config = fs.readFileSync(configPath, "utf8");
  const match = config.match(/oauth_token\s*=\s*"([^"]+)"/);
  if (!match?.[1]) throw new Error(`No Wrangler OAuth token found in ${configPath}. Run wrangler login first.`);
  return match[1];
}
