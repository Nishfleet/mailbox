// Prints the version `wrangler deployments status --json` reports as serving: the
// one with the greatest traffic share among the deployed versions. Fails when the
// status holds no serving version at all (an empty or first-ever deploy status),
// so the caller treats that as a failed check.
import { readFileSync } from "node:fs";

const deployment = JSON.parse(readFileSync(process.argv[2], "utf8"));
const serving = (deployment.versions ?? [])
	.filter((version) => version.percentage > 0)
	.sort((a, b) => b.percentage - a.percentage)[0];
if (!serving) {
	console.error(
		`No serving version in the deployment status: ${JSON.stringify(deployment)}`,
	);
	process.exit(1);
}
console.log(serving.version_id);
