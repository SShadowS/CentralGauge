// Fake lsp-probe for cg-inventory tests: exit code from CG_FAKE_PROBE_RC, stderr only.
import process from "node:process";
process.stderr.write("[fake] lsp-probe preflight\n");
process.exit(Number(process.env.CG_FAKE_PROBE_RC ?? "0"));
