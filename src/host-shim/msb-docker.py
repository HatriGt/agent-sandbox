#!/usr/bin/env python3
"""
msb-docker: the `msb` the controller drives, on a host that has Docker but no KVM.

microsandbox boots each box as a microVM, which needs /dev/kvm. A machine that cannot offer it
(an Instabox sandbox is itself a Firecracker microVM with no nested virtualisation) can still run
the box images as Docker containers: the images are plain OCI images (the bake is a docker build),
and every call the controller makes goes through one `msb <verb>` over SSH (src/msb.ts). So this
file is an `msb` with the same verbs, flags and output shapes, backed by the docker CLI. It is
installed by the controller as the host's msb binary (src/host-providers.ts, `prepare`), and the
host row points `msb` at it.

What is the same: run / exec / ls --format json / start / stop / rm / copy / status / metrics /
snapshot create|ls|rm / image inspect|ls / load / save / modify, their exit codes, and the ls JSON
and metrics table the controller parses (src/monitor.ts).

What is not: a box is a container, so it shares the host's kernel (the host is a VM of its own,
so the tenancy boundary is the host, not the box); `--root-disk` is accepted and ignored (the
container writes to the host's disk); the egress allowlist (`--net-default-egress deny`,
`--net-rule`) is accepted and ignored, boxes have the host's open egress (the controller runs with
EGRESS_ALLOW_ALL in that mode anyway); `--idle-timeout` is ignored (the controller's own nap stops
a quiet box); `--max-duration` is kept by a watchdog that stops the container.

src/host-providers.ts reads this file beside the compiled controller and sends it over SSH on prepare.
"""
import datetime
import json
import os
import re
import subprocess
import sys
import time

SHIM_VERSION = "2"
LABEL = "agent-sandbox.msb"
IMAGE_LABEL = "agent-sandbox.image"
SNAP_REPO = "asb-snap"
STOP_SECONDS = "5"
TMPFS = "/tmp:rw,size=256m,mode=1777"
# `start` leaves a marker here; an `exec` that booted a stopped box for its command stops it again
# afterwards UNLESS a start landed meanwhile. Seen live 2026-11-20 on instabox-b: the controller's
# wake (start) arrived while a sweep's read had the box up for its own exec, the start was a no-op
# on a running container, the read's clean-up stopped it, and the reply two seconds later found
# "container … is not running". Lives in /tmp like the containers' own state: a reboot clears both.
WANTED_DIR = "/tmp/msb-docker/wanted"


def wanted_path(name):
    return os.path.join(WANTED_DIR, name)


def mark_wanted(name):
    try:
        os.makedirs(WANTED_DIR, exist_ok=True)
        with open(wanted_path(name), "w") as f:
            f.write("%f\n" % time.time())
    except OSError:
        pass


def unmark_wanted(name):
    try:
        os.remove(wanted_path(name))
    except OSError:
        pass


def wanted_since(name):
    """When `start` last asked for the box (epoch seconds), None when nobody did since the last stop."""
    try:
        return os.path.getmtime(wanted_path(name))
    except OSError:
        return None


def die(msg, code=1):
    sys.stderr.write("msb-docker: " + msg + "\n")
    sys.exit(code)


def docker(args, stdin=None, input_bytes=None, check=True, quiet=False):
    """One docker CLI call; stdout captured, stderr captured (shown on failure unless quiet)."""
    p = subprocess.run(["docker"] + args, stdin=stdin, input=input_bytes, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    out = p.stdout.decode("utf-8", "replace")
    err = p.stderr.decode("utf-8", "replace")
    if check and p.returncode != 0:
        if not quiet:
            sys.stderr.write(err)
        sys.exit(p.returncode or 1)
    return p.returncode, out, err


def inspect(name):
    code, out, _ = docker(["inspect", "--type", "container", name], check=False, quiet=True)
    if code != 0:
        return None
    arr = json.loads(out)
    return arr[0] if arr else None


def running(info):
    return bool(info) and info.get("State", {}).get("Status") == "running"


def parse_time(s):
    """Docker's RFC3339 with nanoseconds ('2026-11-19T12:00:00.123456789Z') to a UTC datetime."""
    if not s or s.startswith("0001-"):
        return None
    s = re.sub(r"\.(\d{6})\d*", r".\1", s).replace("Z", "+00:00")
    try:
        return datetime.datetime.fromisoformat(s)
    except ValueError:
        return None


def fmt_dur(seconds):
    seconds = int(max(0, seconds))
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    if h:
        return "%dh%dm%ds" % (h, m, s)
    if m:
        return "%dm%ds" % (m, s)
    return "%ds" % s


def parse_duration(s):
    """msb durations ('15m', '1h', '90s', '1h30m', '2d') to seconds; None when unreadable."""
    total = 0
    for num, unit in re.findall(r"(\d+)([smhd])", s or ""):
        total += int(num) * {"s": 1, "m": 60, "h": 3600, "d": 86400}[unit]
    return total or None


def fmt_bytes(n):
    units = ["B", "KiB", "MiB", "GiB", "TiB"]
    f = float(n)
    i = 0
    while f >= 1024 and i < len(units) - 1:
        f /= 1024
        i += 1
    return ("%d %s" if i == 0 else "%.1f %s") % (f, units[i])


def parse_size(s):
    """'1G', '512M', '2.5g' to bytes (docker takes the same strings, so this only checks them)."""
    m = re.match(r"^\s*(\d+(?:\.\d+)?)\s*([kmgt]?)i?b?\s*$", s or "", re.I)
    if not m:
        return None
    return int(float(m.group(1)) * (1024 ** {"": 0, "k": 1, "m": 2, "g": 3, "t": 4}[m.group(2).lower()]))


def take_value(argv, i, flag):
    if i + 1 >= len(argv):
        die("%s needs a value" % flag, 2)
    return argv[i + 1]


# ----- run ---------------------------------------------------------------------------------------

def cmd_run(argv):
    name = None
    memory = None
    cpus = None
    mounts = []
    workdir = None
    copy_dir = None
    snapshot = None
    max_duration = None
    pull = "missing"
    image = None
    command = None
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--":
            command = argv[i + 1:]
            break
        if a == "-d" or a == "--detach":
            pass
        elif a == "--name":
            name = take_value(argv, i, a)
            i += 1
        elif a in ("-m", "--memory"):
            memory = take_value(argv, i, a)
            i += 1
        elif a == "--max-memory":
            # The hotplug ceiling; a container has none, the cap is the cap.
            take_value(argv, i, a)
            i += 1
        elif a in ("-c", "--cpus"):
            cpus = take_value(argv, i, a)
            i += 1
        elif a == "--root-disk":
            take_value(argv, i, a)
            i += 1
        elif a == "--mount-dir":
            mounts.append(take_value(argv, i, a))
            i += 1
        elif a in ("--net", "--net-default-egress", "--net-rule", "--idle-timeout", "--pull"):
            v = take_value(argv, i, a)
            if a == "--pull":
                pull = v
            i += 1
        elif a == "--max-duration":
            max_duration = take_value(argv, i, a)
            i += 1
        elif a in ("-w", "--workdir"):
            workdir = take_value(argv, i, a)
            i += 1
        elif a == "--copy-dir":
            copy_dir = take_value(argv, i, a)
            i += 1
        elif a == "--from-snapshot":
            snapshot = take_value(argv, i, a)
            i += 1
        elif a.startswith("-"):
            die("run: unknown flag %s" % a, 2)
        else:
            if image is not None:
                die("run: one image only (got %s and %s)" % (image, a), 2)
            image = a
        i += 1
    if not name:
        die("run: --name is required", 2)
    if snapshot:
        if image:
            die("run: --from-snapshot and an image are exclusive", 2)
        image = "%s:%s" % (SNAP_REPO, snapshot)
    if not image:
        die("run: an image or --from-snapshot is required", 2)
    if not command:
        command = ["sleep", "infinity"]
    code, _, _ = docker(["image", "inspect", image], check=False, quiet=True)
    if code != 0:
        if pull == "never":
            die("run: image %s is not on this host (and --pull never)" % image)
        docker(["pull", image])
    if inspect(name) is not None:
        die("run: a box named %s exists already" % name)
    args = ["run", "-d", "--name", name, "--init", "--stop-timeout", STOP_SECONDS,
            "--label", LABEL + "=1", "--label", IMAGE_LABEL + "=" + image,
            "--tmpfs", TMPFS]
    if memory:
        if parse_size(memory) is None:
            die("run: cannot read the memory size %s" % memory, 2)
        args += ["--memory", memory, "--memory-swap", memory]
    if cpus:
        args += ["--cpus", cpus]
    for m in mounts:
        parts = m.split(":")
        if len(parts) < 2:
            die("run: --mount-dir wants host:box[:ro]", 2)
        args += ["-v", m]
    if workdir:
        args += ["-w", workdir]
    args += [image] + command
    docker(args)
    if copy_dir:
        src, _, dest = copy_dir.partition(":")
        if not dest:
            die("run: --copy-dir wants host:box", 2)
        copy_into(name, src, dest)
    mark_wanted(name)
    secs = parse_duration(max_duration) if max_duration else None
    if secs:
        cid = (inspect(name) or {}).get("Id", "")
        # Stops THIS container when its time is up; a later box under the same name is not touched.
        script = ("sleep %d; [ \"$(docker inspect -f '{{.Id}}' %s 2>/dev/null)\" = '%s' ] && docker stop -t %s %s >/dev/null 2>&1"
                  % (secs, name, cid, STOP_SECONDS, name))
        subprocess.Popen(["sh", "-c", script], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    sys.stdout.write(name + "\n")


def copy_into(name, src, dest):
    if not os.path.isdir(src):
        die("copy: %s is not a directory on the host" % src)
    info = inspect(name)
    if info is None:
        die("copy: no box named %s" % name)
    exists = False
    if running(info):
        code, _, _ = docker(["exec", name, "test", "-d", dest], check=False, quiet=True)
        exists = code == 0
    # `docker cp DIR box:DEST` makes DEST as a copy of DIR when DEST is absent; `DIR/.` fills an existing one.
    docker(["cp", (src.rstrip("/") + "/.") if exists else src.rstrip("/") or "/", name + ":" + dest])


# ----- exec --------------------------------------------------------------------------------------

def cmd_exec(argv):
    env = []
    i = 0
    name = None
    command = None
    while i < len(argv):
        a = argv[i]
        if a == "--":
            command = argv[i + 1:]
            break
        if a in ("-e", "--env"):
            env += ["-e", take_value(argv, i, a)]
            i += 1
        elif a.startswith("-e") and len(a) > 2:
            env += ["-e", a[2:]]
        elif a.startswith("-"):
            die("exec: unknown flag %s" % a, 2)
        elif name is None:
            name = a
        else:
            # msb takes the command without `--` too.
            command = argv[i:]
            break
        i += 1
    if not name:
        die("exec: a box name is required", 2)
    if not command:
        die("exec: a command is required", 2)
    info = inspect(name)
    if info is None:
        die("exec: no box named %s" % name)
    booted = False
    booted_at = None
    if not running(info):
        # msb boots a stopped box for the command and stops it again; the same here.
        booted_at = time.time()
        docker(["start", name])
        booted = True
    p = subprocess.run(["docker", "exec", "-i"] + env + [name] + command)
    # A `start` that landed while the box was up for this command wants it to stay up.
    if booted and (wanted_since(name) or 0) < booted_at - 1:
        docker(["stop", "-t", STOP_SECONDS, name], check=False, quiet=True)
    sys.exit(p.returncode)


# ----- ls / status / metrics ---------------------------------------------------------------------

def list_boxes():
    _, out, _ = docker(["ps", "-a", "-q", "--filter", "label=" + LABEL + "=1"])
    ids = out.split()
    if not ids:
        return []
    _, out, _ = docker(["inspect"] + ids)
    rows = []
    for c in json.loads(out):
        state = c.get("State", {})
        status = "running" if state.get("Status") == "running" else "stopped"
        labels = c.get("Config", {}).get("Labels") or {}
        created = parse_time(c.get("Created"))
        rows.append({
            "name": c.get("Name", "").lstrip("/"),
            "status": status,
            "image": labels.get(IMAGE_LABEL) or c.get("Config", {}).get("Image"),
            "created_at": created.strftime("%Y-%m-%dT%H:%M:%SZ") if created else None,
            "_raw": c,
        })
    rows.sort(key=lambda r: r["created_at"] or "")
    return rows


def cmd_ls(argv):
    fmt = "table"
    i = 0
    while i < len(argv):
        if argv[i] == "--format":
            fmt = take_value(argv, i, argv[i])
            i += 1
        elif argv[i] in ("-a", "--all"):
            pass
        else:
            die("ls: unknown flag %s" % argv[i], 2)
        i += 1
    rows = list_boxes()
    if fmt == "json":
        sys.stdout.write(json.dumps([{k: v for k, v in r.items() if k != "_raw"} for r in rows]) + "\n")
        return
    sys.stdout.write("%-28s %-10s %-40s %s\n" % ("NAME", "STATUS", "IMAGE", "CREATED"))
    for r in rows:
        sys.stdout.write("%-28s %-10s %-40s %s\n" % (r["name"], r["status"], r["image"] or "", r["created_at"] or ""))


def cmd_status(argv):
    if not argv:
        die("status: a box name is required", 2)
    info = inspect(argv[0])
    if info is None:
        die("status: no box named %s" % argv[0])
    st = info.get("State", {})
    sys.stdout.write("Name: %s\nState: %s\nImage: %s\nStarted: %s\nFinished: %s\nExit code: %s\n" % (
        argv[0], st.get("Status"), (info.get("Config", {}).get("Labels") or {}).get(IMAGE_LABEL) or info.get("Config", {}).get("Image"),
        st.get("StartedAt"), st.get("FinishedAt"), st.get("ExitCode")))


def cmd_metrics(argv):
    if not argv:
        die("metrics: a box name is required", 2)
    name = argv[0]
    header = "%-28s %-10s %-12s %-24s %-16s %-16s %s" % ("NAME", "STATE", "CPU", "MEM", "DISK R/W /s", "NET RX/TX /s", "UPTIME")
    sys.stdout.write(header + "\n")
    info = inspect(name)
    if info is None:
        return
    st = info.get("State", {})
    now = datetime.datetime.now(datetime.timezone.utc)
    if running(info):
        _, out, _ = docker(["stats", "--no-stream", "--format", "{{json .}}", name], check=False, quiet=True)
        try:
            s = json.loads(out.strip().splitlines()[-1]) if out.strip() else {}
        except ValueError:
            s = {}
        pct = float((s.get("CPUPerc") or "0").rstrip("%") or 0)
        nano = info.get("HostConfig", {}).get("NanoCpus") or 0
        cores = nano / 1e9 if nano else (os.cpu_count() or 1)
        cpu = "%.2f / %gc" % (pct / 100.0, cores)
        mem = s.get("MemUsage") or ""
        mem = re.sub(r"(\d)([KMGT]i?B)", r"\1 \2", mem)
        started = parse_time(st.get("StartedAt"))
        up = fmt_dur((now - started).total_seconds()) if started else ""
        sys.stdout.write("%-28s %-10s %-12s %-24s %-16s %-16s %s\n" % (name, "running", cpu, mem, "0 B / 0 B", "0 B / 0 B", up))
    else:
        started = parse_time(st.get("StartedAt"))
        finished = parse_time(st.get("FinishedAt"))
        ran = fmt_dur((finished - started).total_seconds()) if started and finished and finished > started else "0s"
        limit = info.get("HostConfig", {}).get("Memory") or 0
        mem = "0 B / " + (fmt_bytes(limit) if limit else "0 B")
        sys.stdout.write("%-28s %-10s %-12s %-24s %-16s %-16s %s\n" % (name, "exited", "—", mem, "0 B / 0 B", "0 B / 0 B", "ran " + ran))


# ----- start / stop / rm / copy / modify ---------------------------------------------------------

def cmd_start(argv):
    if not argv:
        die("start: a box name is required", 2)
    info = inspect(argv[0])
    if info is None:
        die("start: no box named %s" % argv[0])
    mark_wanted(argv[0])
    if not running(info):
        docker(["start", argv[0]])


def cmd_stop(argv):
    if not argv:
        die("stop: a box name is required", 2)
    info = inspect(argv[0])
    if info is None:
        die("stop: no box named %s" % argv[0])
    unmark_wanted(argv[0])
    if running(info):
        docker(["stop", "-t", STOP_SECONDS, argv[0]])


def cmd_rm(argv):
    force = False
    names = []
    for a in argv:
        if a in ("-f", "--force"):
            force = True
        elif a.startswith("-"):
            die("rm: unknown flag %s" % a, 2)
        else:
            names.append(a)
    if not names:
        die("rm: a box name is required", 2)
    for n in names:
        info = inspect(n)
        if info is None:
            die("rm: no box named %s" % n)
        if running(info) and not force:
            die("rm: %s is running; stop it first or pass --force" % n)
        unmark_wanted(n)
        docker(["rm", "-f", "-v", n])


def cmd_copy(argv):
    if len(argv) != 2:
        die("copy: usage is copy SRC box:DEST or copy box:SRC DEST", 2)
    a, b = argv
    if ":" in b and not os.path.exists(b):
        name, _, dest = b.partition(":")
        copy_into(name, a, dest)
    elif ":" in a and not os.path.exists(a):
        name, _, src = a.partition(":")
        if inspect(name) is None:
            die("copy: no box named %s" % name)
        docker(["cp", name + ":" + src, b])
    else:
        die("copy: one side must be box:path", 2)


def cmd_modify(argv):
    name = None
    memory = None
    restart = False
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ("-m", "--memory"):
            memory = take_value(argv, i, a)
            i += 1
        elif a == "--max-memory":
            take_value(argv, i, a)
            i += 1
        elif a == "--root-disk":
            take_value(argv, i, a)
            i += 1
        elif a == "--restart":
            restart = True
        elif a.startswith("-"):
            die("modify: unknown flag %s" % a, 2)
        elif name is None:
            name = a
        else:
            die("modify: one box at a time", 2)
        i += 1
    if not name:
        die("modify: a box name is required", 2)
    if inspect(name) is None:
        die("modify: no box named %s" % name)
    if memory:
        if parse_size(memory) is None:
            die("modify: cannot read the memory size %s" % memory, 2)
        docker(["update", "--memory", memory, "--memory-swap", memory, name])
    if restart:
        docker(["restart", "-t", STOP_SECONDS, name])


# ----- snapshots and images ----------------------------------------------------------------------

def cmd_snapshot(argv):
    if not argv:
        die("snapshot: create | ls | rm", 2)
    sub, rest = argv[0], argv[1:]
    if sub == "create":
        src = None
        name = None
        i = 0
        while i < len(rest):
            a = rest[i]
            if a == "--from":
                src = take_value(rest, i, a)
                i += 1
            elif a in ("--force", "-f"):
                pass
            elif a.startswith("-"):
                die("snapshot create: unknown flag %s" % a, 2)
            elif name is None:
                name = a
            else:
                die("snapshot create: one name", 2)
            i += 1
        if not src or not name:
            die("snapshot create: --from BOX and a NAME are required", 2)
        info = inspect(src)
        if info is None:
            die("snapshot create: no box named %s" % src)
        # The container's filesystem as an image; a running one is paused for the instant it takes.
        docker(["commit", "--change", "LABEL " + LABEL + "=", src, "%s:%s" % (SNAP_REPO, name)])
        sys.stdout.write(name + "\n")
    elif sub == "ls":
        _, out, _ = docker(["images", SNAP_REPO, "--format", "{{.Tag}}\t{{.Size}}\t{{.CreatedAt}}"])
        sys.stdout.write("%-32s %-10s %s\n" % ("NAME", "SIZE", "CREATED"))
        for line in out.splitlines():
            parts = line.split("\t")
            if len(parts) == 3 and parts[0] != "<none>":
                sys.stdout.write("%-32s %-10s %s\n" % (parts[0], parts[1], parts[2]))
    elif sub == "rm":
        names = [a for a in rest if not a.startswith("-")]
        if not names:
            die("snapshot rm: a name is required", 2)
        for n in names:
            code, _, err = docker(["rmi", "-f", "%s:%s" % (SNAP_REPO, n)], check=False, quiet=True)
            if code != 0:
                sys.stderr.write(err)
                sys.exit(code)
    else:
        die("snapshot: unknown subcommand %s" % sub, 2)


def cmd_image(argv):
    if not argv:
        die("image: inspect | ls | rm", 2)
    sub, rest = argv[0], argv[1:]
    if sub == "inspect":
        if not rest:
            die("image inspect: a reference is required", 2)
        ref = rest[0]
        code, out, err = docker(["image", "inspect", ref], check=False, quiet=True)
        if code != 0:
            die("image inspect: %s is not on this host" % ref)
        img = json.loads(out)[0]
        digests = img.get("RepoDigests") or []
        digest = digests[0].split("@", 1)[1] if digests and "@" in digests[0] else img.get("Id", "")
        sys.stdout.write("Reference: %s\nDigest: %s\nId: %s\nSize: %s\nCreated: %s\nArchitecture: %s\n" % (
            ref, digest, img.get("Id", ""), fmt_bytes(img.get("Size", 0)), img.get("Created", ""), img.get("Architecture", "")))
    elif sub == "ls":
        _, out, _ = docker(["images", "--format", "{{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.Size}}\t{{.CreatedAt}}"])
        sys.stdout.write("%-60s %-14s %-10s %s\n" % ("REFERENCE", "DIGEST", "SIZE", "CREATED"))
        for line in out.splitlines():
            p = line.split("\t")
            if len(p) == 4:
                sys.stdout.write("%-60s %-14s %-10s %s\n" % (p[0], p[1], p[2], p[3]))
    elif sub == "rm":
        docker(["rmi"] + [a for a in rest if not a.startswith("-")])
    else:
        die("image: unknown subcommand %s" % sub, 2)


def cmd_load(argv):
    tag = None
    i = 0
    src = None
    while i < len(argv):
        a = argv[i]
        if a in ("-t", "--tag"):
            tag = take_value(argv, i, a)
            i += 1
        elif a in ("-q", "--quiet"):
            pass
        elif a in ("-i", "--input"):
            src = take_value(argv, i, a)
            i += 1
        elif a.startswith("-"):
            die("load: unknown flag %s" % a, 2)
        else:
            src = a
        i += 1
    args = ["load", "-q"]
    if src:
        args += ["-i", src]
        _, out, _ = docker(args)
    else:
        _, out, _ = docker(args, stdin=sys.stdin.buffer)
    loaded = None
    for line in out.splitlines():
        m = re.match(r"Loaded image(?: ID)?:\s*(\S+)", line)
        if m:
            loaded = m.group(1)
    if tag and loaded and loaded != tag:
        docker(["tag", loaded, tag])
    sys.stdout.write((tag or loaded or "") + "\n")


def cmd_save(argv):
    out_path = None
    refs = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ("-o", "--output"):
            out_path = take_value(argv, i, a)
            i += 1
        elif a == "--format":
            take_value(argv, i, a)
            i += 1
        elif a.startswith("-"):
            die("save: unknown flag %s" % a, 2)
        else:
            refs.append(a)
        i += 1
    if not refs:
        die("save: a reference is required", 2)
    if out_path and out_path != "-":
        docker(["save", "-o", out_path] + refs)
    else:
        p = subprocess.run(["docker", "save"] + refs, stdout=sys.stdout.buffer)
        sys.exit(p.returncode)


def cmd_pull(argv):
    refs = [a for a in argv if not a.startswith("-")]
    if not refs:
        die("pull: a reference is required", 2)
    docker(["pull"] + refs)


def main():
    argv = sys.argv[1:]
    if not argv or argv[0] in ("-h", "--help", "help"):
        sys.stdout.write("msb-docker %s: run exec ls start stop rm copy status metrics snapshot image load save pull modify\n" % SHIM_VERSION)
        return
    verb, rest = argv[0], argv[1:]
    if verb in ("--version", "version"):
        sys.stdout.write("msb-docker shim %s (microsandbox-compatible verbs, Docker backend)\n" % SHIM_VERSION)
        return
    handlers = {
        "run": cmd_run, "exec": cmd_exec, "ls": cmd_ls, "start": cmd_start, "stop": cmd_stop, "rm": cmd_rm,
        "copy": cmd_copy, "cp": cmd_copy, "status": cmd_status, "metrics": cmd_metrics, "snapshot": cmd_snapshot,
        "image": cmd_image, "load": cmd_load, "save": cmd_save, "pull": cmd_pull, "modify": cmd_modify,
    }
    h = handlers.get(verb)
    if not h:
        die("unknown verb %s" % verb, 2)
    h(rest)


if __name__ == "__main__":
    main()
