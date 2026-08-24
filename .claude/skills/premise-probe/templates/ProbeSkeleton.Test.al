codeunit 8009N "CG <Slug> Probe Test"
{
    Subtype = Test;
    // Add `TestPermissions = Restrictive;` ONLY for permission premises.

    // Premise probe: <state the falsifiable claim here>.
    // Results come back via Error('RESULTS-...') text - the runner reads
    // measurements from FAILURE output, so every probe test must end in
    // Error, never a passing assert.

    [Test]
    procedure P1_Measure()
    var
        Result: Text;
    begin
        // Arrange + measure. Prefer a matrix: loop the case family and
        // concatenate labeled observations into one Result string, e.g.
        //   Result += 'CASE1[' + Format(Observed) + '] ';
        // For SQL-counter premises (decisions entry 8): seed, one warm-up
        // call, snapshot SessionInformation.SqlStatementsExecuted /
        // .SqlRowsRead into BigInteger locals, act, report the deltas.

        Error('RESULTS-%1', Result);
    end;
}
