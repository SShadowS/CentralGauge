# SPIKE (throwaway): harness bench M0
# Usage: python scripts/spikes/harness/laya_classify.py <calls.jsonl> <laya.jsonl>
# Classifies the calls the rules left unclassified (category null) with Laya's
# "choice" decision. One JSON line per call: index, choice, probability, ms.
import json
import sys
import time

from laya import Router

CATEGORIES = {
    "compile": "building or compiling AL code",
    "test": "running tests",
    "publish": "publishing or deploying an app",
    "symbols": "downloading or inspecting symbol packages",
    "read": "reading a file's contents",
    "search": "listing files or searching file contents",
    "edit": "creating or changing files",
    "vcs": "git or other version control",
    "other": "anything else",
}
QUESTIONS = {
    "category": {
        "type": "choice",
        "instructions": "What kind of work does this coding-agent tool call do?",
        "criteria": CATEGORIES,
    }
}


def main(calls_path: str, out_path: str) -> None:
    router = Router()
    with open(calls_path, encoding="utf-8") as f:
        calls = [json.loads(line) for line in f if line.strip()]
    # Warm-up so the first timed call does not include checkpoint loading.
    router.predict(json.dumps({"tool": "Read", "command": None}), QUESTIONS)
    with open(out_path, "w", encoding="utf-8") as out:
        for index, call in enumerate(calls):
            if call.get("category") is not None:
                continue
            state = json.dumps({"tool": call["tool"], "command": call.get("command")})
            t0 = time.perf_counter()
            result = router.predict(state, QUESTIONS)
            answer = result["answers"]["category"]
            ms = (time.perf_counter() - t0) * 1000
            out.write(json.dumps({
                "index": index,
                "choice": answer["choice"],
                "probability": answer["probabilities"][answer["choice"]],
                "model": result["routing"]["model"],
                "ms": round(ms, 1),
            }) + "\n")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
