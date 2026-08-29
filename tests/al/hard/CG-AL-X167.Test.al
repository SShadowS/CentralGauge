codeunit 89387 "CG-AL-X167 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods, so
    // every test clears the two ledger tables before seeding its own rows.
    // The audit result is a caller-owned buffer, not persisted state, so
    // each test declares its own fresh one.

    local procedure ClearAll()
    var
        ImportEntry: Record "CG X167 Import Entry";
        PostedEntry: Record "CG X167 Posted Entry";
    begin
        ImportEntry.DeleteAll();
        PostedEntry.DeleteAll();
    end;

    local procedure SeedImport(EntryNo: Integer; ExternalRef: Code[30]; Amt: Decimal; SourceCode: Code[20])
    var
        ImportEntry: Record "CG X167 Import Entry";
    begin
        ImportEntry.Init();
        ImportEntry."Entry No." := EntryNo;
        ImportEntry."External Ref" := ExternalRef;
        ImportEntry.Amount := Amt;
        ImportEntry."Source Code" := SourceCode;
        ImportEntry.Insert();
    end;

    local procedure SeedPosted(EntryNo: Integer; ExternalRef: Code[30]; Amt: Decimal)
    var
        PostedEntry: Record "CG X167 Posted Entry";
    begin
        PostedEntry.Init();
        PostedEntry."Entry No." := EntryNo;
        PostedEntry."External Ref" := ExternalRef;
        PostedEntry.Amount := Amt;
        PostedEntry.Insert();
    end;

    local procedure FlushDataCache()
    begin
        // The fixture-seeding loops above leave the session's data cache
        // warm, and a cache-served read costs zero in the counters below -
        // the graded call would then measure nothing. A write to unrelated
        // rows, followed by SelectLatestVersion, forces real reads again for
        // the measured call.
        SeedPosted(900001, 'REF-FLUSH', 1);
        SeedImport(900002, 'REF-FLUSH', 1, 'SRC-FLUSH');
        SelectLatestVersion();
    end;

    local procedure MaxStatements(): Integer
    begin
        exit(13);
    end;

    [Test]
    procedure NewWhenNoPostedMatchRecordsZeroPostedAmount()
    var
        DuplicateAuditor: Codeunit "CG X167 Duplicate Auditor";
        AuditResult: Record "CG X167 Audit Result" temporary;
    begin
        ClearAll();
        SeedImport(1, 'REF-N1', 100, 'SRC-A');

        DuplicateAuditor.RunAudit('SRC-A', AuditResult);

        AuditResult.Get('REF-N1');
        Assert.AreEqual(AuditResult.Status::New, AuditResult.Status,
            'Expected an imported entry with no matching posted entry to come back as new');
        Assert.AreEqual(100, AuditResult."Import Amount",
            'Expected the imported amount to be recorded exactly as imported');
        Assert.AreEqual(0, AuditResult."Posted Amount",
            'Expected no posted amount to be recorded when there is no posted entry to match against');
    end;

    [Test]
    procedure AlreadyPostedWhenAmountsMatchRecordsBothAmounts()
    var
        DuplicateAuditor: Codeunit "CG X167 Duplicate Auditor";
        AuditResult: Record "CG X167 Audit Result" temporary;
    begin
        ClearAll();
        SeedPosted(3, 'REF-M1', 250);
        SeedImport(2, 'REF-M1', 250, 'SRC-A');

        DuplicateAuditor.RunAudit('SRC-A', AuditResult);

        AuditResult.Get('REF-M1');
        Assert.AreEqual(AuditResult.Status::"Already Posted", AuditResult.Status,
            'Expected a matching reference with the same amount on both sides to come back as already posted');
        Assert.AreEqual(250, AuditResult."Import Amount",
            'Expected the imported amount to be recorded exactly as imported');
        Assert.AreEqual(250, AuditResult."Posted Amount",
            'Expected the posted amount to be recorded exactly as posted');
    end;

    [Test]
    procedure AmountDiffersWhenPostedAmountDoesNotMatch()
    var
        DuplicateAuditor: Codeunit "CG X167 Duplicate Auditor";
        AuditResult: Record "CG X167 Audit Result" temporary;
    begin
        ClearAll();
        SeedPosted(4, 'REF-D1', 275.50);
        SeedImport(3, 'REF-D1', 300, 'SRC-A');

        DuplicateAuditor.RunAudit('SRC-A', AuditResult);

        AuditResult.Get('REF-D1');
        Assert.AreEqual(AuditResult.Status::"Amount Differs", AuditResult.Status,
            'Expected a matching reference whose posted amount does not equal the imported amount to be flagged as differing');
        Assert.AreEqual(300, AuditResult."Import Amount",
            'Expected the imported amount to be recorded exactly as imported');
        Assert.AreEqual(275.50, AuditResult."Posted Amount",
            'Expected the posted amount to be recorded exactly as posted, not the imported amount');
    end;

    [Test]
    procedure DuplicateRefWithinBatchKeepsOnlyTheLastEntry()
    var
        DuplicateAuditor: Codeunit "CG X167 Duplicate Auditor";
        AuditResult: Record "CG X167 Audit Result" temporary;
    begin
        ClearAll();
        SeedImport(10, 'REF-DUP', 50, 'SRC-DUP');
        SeedImport(11, 'REF-DUP', 90, 'SRC-DUP');

        DuplicateAuditor.RunAudit('SRC-DUP', AuditResult);

        AuditResult.SetRange("External Ref", 'REF-DUP');
        Assert.AreEqual(1, AuditResult.Count(),
            'Expected only one recorded result for a reference that appears twice in the same batch, not one per import entry');
        AuditResult.Get('REF-DUP');
        Assert.AreEqual(90, AuditResult."Import Amount",
            'Expected the recorded result to reflect the later of the two import entries sharing the same reference');
    end;

    [Test]
    procedure OtherSourcesEntriesAreNeverAuditedOrListed()
    var
        DuplicateAuditor: Codeunit "CG X167 Duplicate Auditor";
        AuditResult: Record "CG X167 Audit Result" temporary;
    begin
        ClearAll();
        SeedImport(20, 'REF-A1', 10, 'SRC-A');
        SeedImport(21, 'REF-B1', 20, 'SRC-B');

        DuplicateAuditor.RunAudit('SRC-A', AuditResult);

        Assert.IsTrue(AuditResult.Get('REF-A1'),
            'Expected the audited source''s own entry to produce a recorded result');
        Assert.IsFalse(AuditResult.Get('REF-B1'),
            'Expected an entry belonging to a different source to never produce a recorded result when auditing this source');
    end;

    [Test]
    procedure PostedLedgerIsNeverModifiedByAnAudit()
    var
        DuplicateAuditor: Codeunit "CG X167 Duplicate Auditor";
        PostedEntry: Record "CG X167 Posted Entry";
        AuditResult: Record "CG X167 Audit Result" temporary;
    begin
        ClearAll();
        SeedPosted(1, 'REF-P1', 500);
        SeedImport(30, 'REF-P1', 500, 'SRC-A');

        DuplicateAuditor.RunAudit('SRC-A', AuditResult);

        Assert.AreEqual(1, PostedEntry.Count(),
            'Expected the posted ledger to hold exactly the entries seeded before the audit, with none added or removed');
        PostedEntry.Get(1);
        Assert.AreEqual(500, PostedEntry.Amount,
            'Expected a posted entry''s amount to be exactly what it was before the audit ran');
    end;

    [Test]
    procedure ARepeatedCallReflectsCurrentStateNotTheEarlierVerdict()
    var
        DuplicateAuditor: Codeunit "CG X167 Duplicate Auditor";
        PostedEntry: Record "CG X167 Posted Entry";
        AuditResult: Record "CG X167 Audit Result" temporary;
    begin
        ClearAll();
        SeedPosted(2, 'REF-R1', 60);
        SeedImport(40, 'REF-R1', 60, 'SRC-A');

        DuplicateAuditor.RunAudit('SRC-A', AuditResult);
        AuditResult.Get('REF-R1');
        Assert.AreEqual(AuditResult.Status::"Already Posted", AuditResult.Status,
            'Expected the first call to record a match between the imported and posted amounts');

        PostedEntry.Get(2);
        PostedEntry.Amount := 75;
        PostedEntry.Modify();

        DuplicateAuditor.RunAudit('SRC-A', AuditResult);
        Assert.AreEqual(1, AuditResult.Count(),
            'Expected the repeated call to leave exactly one result for this reference, with no stale row left behind from the earlier call');
        AuditResult.Get('REF-R1');
        Assert.AreEqual(AuditResult.Status::"Amount Differs", AuditResult.Status,
            'Expected a repeated call to reflect the posted amount as it now stands, not the verdict from the first call');
        Assert.AreEqual(75, AuditResult."Posted Amount",
            'Expected the repeated call to report the updated posted amount, not the stale one');
    end;

    [Test]
    procedure EmptySourceProducesNoResultsWithoutError()
    var
        DuplicateAuditor: Codeunit "CG X167 Duplicate Auditor";
        AuditResult: Record "CG X167 Audit Result" temporary;
    begin
        ClearAll();

        DuplicateAuditor.RunAudit('SRC-NONE', AuditResult);

        Assert.IsTrue(AuditResult.IsEmpty(),
            'Expected no recorded results, and no error, when the audited source has no import entries at all');
    end;

    [Test]
    procedure CallArgumentIsDiscardedAndRebuilt()
    var
        DuplicateAuditor: Codeunit "CG X167 Duplicate Auditor";
        AuditResult: Record "CG X167 Audit Result" temporary;
    begin
        ClearAll();
        SeedImport(50, 'REF-FRESH', 15, 'SRC-A');

        AuditResult.Init();
        AuditResult."External Ref" := 'LEFTOVER';
        AuditResult.Status := AuditResult.Status::New;
        AuditResult.Insert();

        DuplicateAuditor.RunAudit('SRC-A', AuditResult);

        Assert.AreEqual(1, AuditResult.Count(),
            'Expected whatever the buffer held before the call to be discarded and rebuilt from scratch');
        Assert.IsFalse(AuditResult.Get('LEFTOVER'),
            'Expected a pre-existing entry in the caller''s buffer to be discarded, not merged into the rebuilt result');
        Assert.IsTrue(AuditResult.Get('REF-FRESH'),
            'Expected only the real result of this call to remain after the buffer is rebuilt');
    end;

    [Test]
    procedure AuditingASeventyEntryBatchCostsAboutTheSameAsATinyOne()
    var
        DuplicateAuditor: Codeunit "CG X167 Duplicate Auditor";
        WarmAuditResult: Record "CG X167 Audit Result" temporary;
        AuditResult: Record "CG X167 Audit Result" temporary;
        StatementsBefore: BigInteger;
        StatementsUsed: BigInteger;
        Ref: Code[30];
        i: Integer;
        ImportCount: Integer;
        PostedCount: Integer;
    begin
        ClearAll();

        // Warm up on an unrelated, single-entry source first, so first-touch
        // metadata/plan loading lands outside the measurement window below.
        SeedImport(1, 'REF-WARM', 5, 'SRC-WARM');
        DuplicateAuditor.RunAudit('SRC-WARM', WarmAuditResult);
        ClearAll();

        ImportCount := 70;
        PostedCount := 200;
        for i := 1 to PostedCount do begin
            Ref := CopyStr(StrSubstNo('REF-BUSY-%1', i), 1, MaxStrLen(Ref));
            SeedPosted(i, Ref, i);
        end;
        for i := 1 to ImportCount do begin
            Ref := CopyStr(StrSubstNo('REF-BUSY-%1', i), 1, MaxStrLen(Ref));
            SeedImport(1000 + i, Ref, i, 'SRC-BUSY');
        end;

        FlushDataCache();
        StatementsBefore := SessionInformation.SqlStatementsExecuted();
        DuplicateAuditor.RunAudit('SRC-BUSY', AuditResult);
        StatementsUsed := SessionInformation.SqlStatementsExecuted() - StatementsBefore;

        AuditResult.Get('REF-BUSY-1');
        Assert.AreEqual(AuditResult.Status::"Already Posted", AuditResult.Status,
            'Expected the correct result on the first entry of a large batch before judging its cost');
        AuditResult.Get('REF-BUSY-70');
        Assert.AreEqual(AuditResult.Status::"Already Posted", AuditResult.Status,
            'Expected the correct result on the last entry of a large batch before judging its cost');
        Assert.IsTrue(StatementsUsed <= MaxStatements(),
            StrSubstNo('Expected auditing a 70-entry batch to cost about the same as a tiny one: budget %1, actual %2 against %3 entries', MaxStatements(), StatementsUsed, ImportCount));
    end;

    [Test]
    procedure AuditingABiggerBatchCostsAboutTheSameToo()
    var
        DuplicateAuditor: Codeunit "CG X167 Duplicate Auditor";
        WarmAuditResult: Record "CG X167 Audit Result" temporary;
        AuditResult: Record "CG X167 Audit Result" temporary;
        StatementsBefore: BigInteger;
        StatementsUsed: BigInteger;
        Ref: Code[30];
        i: Integer;
        ImportCount: Integer;
        PostedCount: Integer;
    begin
        ClearAll();

        SeedImport(1, 'REF-WARM2', 5, 'SRC-WARM2');
        DuplicateAuditor.RunAudit('SRC-WARM2', WarmAuditResult);
        ClearAll();

        ImportCount := 120;
        PostedCount := 200;
        for i := 1 to PostedCount do begin
            Ref := CopyStr(StrSubstNo('REF-BIG-%1', i), 1, MaxStrLen(Ref));
            SeedPosted(i, Ref, i);
        end;
        for i := 1 to ImportCount do begin
            Ref := CopyStr(StrSubstNo('REF-BIG-%1', i), 1, MaxStrLen(Ref));
            SeedImport(1000 + i, Ref, i, 'SRC-BIG');
        end;

        FlushDataCache();
        StatementsBefore := SessionInformation.SqlStatementsExecuted();
        DuplicateAuditor.RunAudit('SRC-BIG', AuditResult);
        StatementsUsed := SessionInformation.SqlStatementsExecuted() - StatementsBefore;

        AuditResult.Get('REF-BIG-1');
        Assert.AreEqual(AuditResult.Status::"Already Posted", AuditResult.Status,
            'Expected the correct result on the first entry of a larger batch before judging its cost');
        AuditResult.Get('REF-BIG-120');
        Assert.AreEqual(AuditResult.Status::"Already Posted", AuditResult.Status,
            'Expected the correct result on the last entry of a larger batch before judging its cost');
        Assert.IsTrue(StatementsUsed <= MaxStatements(),
            StrSubstNo('Expected auditing a 120-entry batch to cost about the same as a tiny one: budget %1, actual %2 against %3 entries', MaxStatements(), StatementsUsed, ImportCount));
    end;

    [Test]
    procedure ALargePostedLedgerAloneDoesNotMakeAuditingCostMore()
    var
        DuplicateAuditor: Codeunit "CG X167 Duplicate Auditor";
        WarmAuditResult: Record "CG X167 Audit Result" temporary;
        AuditResult: Record "CG X167 Audit Result" temporary;
        StatementsBefore: BigInteger;
        StatementsUsed: BigInteger;
        Ref: Code[30];
        i: Integer;
        ImportCount: Integer;
        PostedCount: Integer;
    begin
        ClearAll();

        SeedImport(1, 'REF-WARM3', 5, 'SRC-WARM3');
        DuplicateAuditor.RunAudit('SRC-WARM3', WarmAuditResult);
        ClearAll();

        ImportCount := 70;
        PostedCount := 800;
        for i := 1 to PostedCount do begin
            Ref := CopyStr(StrSubstNo('REF-WIDE-%1', i), 1, MaxStrLen(Ref));
            SeedPosted(i, Ref, i);
        end;
        for i := 1 to ImportCount do begin
            Ref := CopyStr(StrSubstNo('REF-WIDE-%1', i), 1, MaxStrLen(Ref));
            SeedImport(1000 + i, Ref, i, 'SRC-WIDE');
        end;

        FlushDataCache();
        StatementsBefore := SessionInformation.SqlStatementsExecuted();
        DuplicateAuditor.RunAudit('SRC-WIDE', AuditResult);
        StatementsUsed := SessionInformation.SqlStatementsExecuted() - StatementsBefore;

        AuditResult.Get('REF-WIDE-1');
        Assert.AreEqual(AuditResult.Status::"Already Posted", AuditResult.Status,
            'Expected the correct result on the first entry of this batch before judging its cost');
        AuditResult.Get('REF-WIDE-70');
        Assert.AreEqual(AuditResult.Status::"Already Posted", AuditResult.Status,
            'Expected the correct result on the last entry of this batch before judging its cost');
        Assert.IsTrue(StatementsUsed <= MaxStatements(),
            StrSubstNo('Expected auditing a batch to cost the same whether the posted ledger is small or large: budget %1, actual %2 against %3 entries and a much larger posted ledger', MaxStatements(), StatementsUsed, ImportCount));
    end;
}
