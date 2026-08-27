# Platform defects found by mutation testing

Findings here are **Business Central platform defects**, not benchmark or
oracle problems. Mutation testing deploys deliberately-broken AL into a real
container thousands of times, which exercises the service tier far outside what
normal development reaches. When mutated AL can do something no AL should be
able to do, that is worth more than the mutation score the run was computing.

Report these to Microsoft. Do not simply restart the container and re-run - the
restart destroys the evidence of which mutant was in flight.

---

## PD-001: mutated AL takes down the whole Service Tier

**Severity:** availability. A single sandboxed extension stops
`MicrosoftDynamicsNavServer$BC`, which serves every tenant and session on that
instance, not just the offending one.

**Observed:** 2026-08-27, container Cronus282, during a LethAL sweep.

### What happened

`CG-AL-X117` scored 100% (19 killed) with exactly one mutant reporting `error`
after running for **73,056 ms**. Immediately afterwards the lane failed with:

```
ServerInstance 'MicrosoftDynamicsNavServer$BC' is not running.
```

and `(Get-NAVServerInstance -ServerInstance BC).State` returned `Stopped`. The
remaining 9 tasks in that lane could not run. The other two containers in the
same sweep, running the same LethAL version against different tasks, were
unaffected - so this is attributable to the mutant, not to the sweep.

### The mutant

Task `CG-AL-X117`, mutant `M0020`, operator `lethal.negate-conditional`, in
`CGX117OrderXmlExport.Codeunit.al` line 47, procedure `BuildLines`:

```al
- until OrderLine.Next() = 0;
+ until OrderLine.Next() <> 0;
```

Full loop as deployed:

```al
LinesElement := XmlElement.Create('Lines');
OrderLine.SetRange("Document No.", Order."No.");
if OrderLine.FindSet() then
    repeat
        LineElement := XmlElement.Create('Line');
        LineElement.SetAttribute('lineNo', Format(OrderLine."Line No.", 0, 9));
        LineElement.SetAttribute('no', OrderLine."No.");
        LineElement.SetAttribute('description', OrderLine.Description);
        LineElement.SetAttribute('quantity', Format(OrderLine.Quantity, 0, 9));
        LineElement.SetAttribute('unitPrice', Format(OrderLine."Unit Price", 0, 9));
        LinesElement.Add(LineElement);
    until OrderLine.Next() <> 0;      // was: = 0
exit(LinesElement);
```

### Why it is unbounded

On the last record `Next()` returns 0, so the mutated guard `0 <> 0` is false
and the loop does not terminate. Every further iteration calls `Next()`, gets 0
again, and allocates **another `XmlElement` and adds it to `LinesElement`**. The
XML document grows without bound for as long as the session is allowed to run.

The AL itself is legal, compiles clean, and is an ordinary off-by-one mistake -
inverting a loop guard is one of the most common bugs a developer can write.

### Why this is a platform defect

The session ran for 73 seconds and then took the service tier down with it.
Expected behaviour is that the platform's own governors bound it: the session
hits a memory or execution limit and aborts with an AL runtime error, leaving
the service tier serving everyone else. Instead a single extension's runaway
allocation stopped the instance.

Note this was running in the fenced test path - `GuiAllowed=No`,
`ClientType=ODataV4`, a web-service session - which is exactly the surface an
untrusted or third-party extension reaches in a shared environment.

### Reproduction

The container-side state is on disk at `scratch/lethal-t1/CG-AL-X117/`, and the
mutation is a one-character edit to the committed source. A deliberate re-run
would confirm it, at the cost of stopping the service tier again - do that on a
container nothing else needs, and expect to restart the NST afterwards:

```powershell
Invoke-ScriptInBcContainer -containerName <c> -scriptblock {
    Start-NAVServerInstance -ServerInstance BC
}
```

**Status:** observed once, single clean attribution, not yet deliberately
reproduced.
