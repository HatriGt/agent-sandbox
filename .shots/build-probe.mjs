// Builds .shots/probe.sh: a guest-side script that lays down a LIVE fake run under /tmp/asbt,
// drops the page cache (re-creating /proc/1's inode), then runs the NEW run-state fragment
// (read-only when live) and the OLD one (which heals), printing both verdicts.
// Before running: git show 44c6c36~1:src/msb.ts > src/msb-old.ts (delete it afterwards). Then
// node --experimental-strip-types .shots/build-probe.mjs and run probe.sh as root inside a box.
import { writeFileSync } from "node:fs";
import { RUN_STATE_SH as NEW } from "../src/msb.ts";
import { RUN_STATE_SH as OLD } from "../src/msb-old.ts";

const dir = "/tmp/asbt/";
const sub = (s) => s.replaceAll("/workspace/", dir);
const script = `#!/bin/bash
d=${dir}; rm -rf $d; mkdir -p $d
cat > /tmp/asb-new.sh <<'ASB_FRAG'
${sub(NEW)}
ASB_FRAG
cat > /tmp/asb-old.sh <<'ASB_FRAG'
${sub(OLD)}
ASB_FRAG
sleep 300 >/dev/null 2>&1 &
echo $! > $d.agent.pid
cat /proc/sys/kernel/random/boot_id > $d.agent.boot
cut -d' ' -f1 /proc/uptime > $d.agent.start
touch $d.agent.running
echo "proc1 before: $(stat -c %y /proc/1)"
echo "pid mark:     $(stat -c %y $d.agent.pid)"
sleep 2; sync; echo 3 > /proc/sys/vm/drop_caches; sleep 1
echo "proc1 after:  $(stat -c %y /proc/1)"
echo "NEW verdict: $(sh /tmp/asb-new.sh)"
echo "OLD verdict: $(sh /tmp/asb-old.sh)"
echo "log after old: $(cat $d.agent.log 2>/dev/null)"
kill $(cat $d.agent.pid) 2>/dev/null; rm -rf $d /tmp/asb-new.sh /tmp/asb-old.sh
`;
writeFileSync(".shots/probe.sh", script);
console.log("probe.sh bytes", script.length);
