codeunit 89364 "CG-AL-X144 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // ================================================================
    // Glue: intake pipeline (live symptom observed here, downstream of
    // the line-validation step)
    // ================================================================

    // The default test isolation persists writes between test methods, so
    // every glue test clears everything the pipeline touches - its own
    // staging/log tables plus the reference-matching module's tables the
    // pipeline imports through - before seeding its own data.
    local procedure ClearIntakeFixture()
    var
        IntakeLine: Record "CG X144 Intake Line";
        IntakeLog: Record "CG X144 Intake Log";
        ImportLine: Record "CG X131 Import Line";
        InboundDoc: Record "CG X138 Inbound Doc";
        DocIndex: Record "CG X138 Doc Index";
        MatchLog: Record "CG X138 Match Log";
    begin
        IntakeLine.DeleteAll();
        IntakeLog.DeleteAll();
        ImportLine.DeleteAll();
        InboundDoc.DeleteAll();
        DocIndex.DeleteAll();
        MatchLog.DeleteAll();
    end;

    local procedure AddIntakeLine(DocumentNo: Code[20]; LineNo: Integer; ItemNo: Code[20]; NewQuantity: Decimal; NewUnitCost: Decimal)
    var
        IntakeLine: Record "CG X144 Intake Line";
    begin
        IntakeLine.Init();
        IntakeLine."Document No." := DocumentNo;
        IntakeLine."Line No." := LineNo;
        IntakeLine."Item No." := ItemNo;
        IntakeLine.Quantity := NewQuantity;
        IntakeLine."Unit Cost" := NewUnitCost;
        IntakeLine.Insert();
    end;

    [Test]
    procedure PipelineImportsAndStagesACleanDocumentWithoutProblems()
    var
        IntakeLog: Record "CG X144 Intake Log";
        InboundDoc: Record "CG X138 Inbound Doc";
        DocIndex: Record "CG X138 Doc Index";
        Pipeline: Codeunit "CG X144 Intake Pipeline";
    begin
        ClearIntakeFixture();
        AddIntakeLine('DOC-CLEAN-1', 10000, 'ITEM-1', 5, 10);
        AddIntakeLine('DOC-CLEAN-1', 20000, 'ITEM-2', 3, 0);

        Pipeline.ProcessDocument('DOC-CLEAN-1', 'inv 2024 501', 250);

        Assert.IsTrue(InboundDoc.Get('DOC-CLEAN-1'), 'Expected the document to be imported');
        Assert.AreEqual('inv 2024 501', InboundDoc."External Ref", 'Expected the imported document to keep its raw reference');
        Assert.AreEqual(250.0, InboundDoc.Amount, 'Expected the imported document to keep its amount');
        Assert.IsTrue(DocIndex.Get('INV2024501'), 'Expected the document to be indexed under its normalized reference');

        IntakeLog.SetRange("Document No.", 'DOC-CLEAN-1');
        Assert.AreEqual(0, IntakeLog.Count(), 'Expected a document whose lines satisfy every rule to produce no intake-log entries');
    end;

    [Test]
    procedure PipelineReportsExactlyOneLogEntryForALineBreakingSeveralRules()
    var
        IntakeLog: Record "CG X144 Intake Log";
        Pipeline: Codeunit "CG X144 Intake Pipeline";
    begin
        ClearIntakeFixture();
        AddIntakeLine('DOC-FLOOD-1', 10000, '', 0, -5);

        Pipeline.ProcessDocument('DOC-FLOOD-1', 'ref-flood-1', 400);

        IntakeLog.SetRange("Document No.", 'DOC-FLOOD-1');
        Assert.AreEqual(1, IntakeLog.Count(),
            'Expected exactly one intake-log entry for a line breaking several rules, not one entry per rule it breaks');
        IntakeLog.FindFirst();
        Assert.AreEqual('Line 10000: Item No. is missing.', IntakeLog.Message,
            'Expected the single logged entry to carry the first of the three rules that the line breaks');
    end;

    [Test]
    procedure PipelineKeepsEachDocumentsLogEntriesSeparate()
    var
        IntakeLog: Record "CG X144 Intake Log";
        Pipeline: Codeunit "CG X144 Intake Pipeline";
    begin
        ClearIntakeFixture();
        AddIntakeLine('DOC-ISO-A', 10000, '', 5, 10);
        AddIntakeLine('DOC-ISO-B', 10000, 'ITEM-1', 0, 10);

        Pipeline.ProcessDocument('DOC-ISO-A', 'ref-iso-a', 100);
        Pipeline.ProcessDocument('DOC-ISO-B', 'ref-iso-b', 200);

        IntakeLog.SetRange("Document No.", 'DOC-ISO-A');
        Assert.AreEqual(1, IntakeLog.Count(), 'Expected DOC-ISO-A to have exactly its own one problem logged');
        IntakeLog.FindFirst();
        Assert.AreEqual('Line 10000: Item No. is missing.', IntakeLog.Message, 'Expected DOC-ISO-A''s own message');

        IntakeLog.SetRange("Document No.", 'DOC-ISO-B');
        Assert.AreEqual(1, IntakeLog.Count(), 'Expected DOC-ISO-B to have exactly its own one problem logged, not DOC-ISO-A''s leaking in');
        IntakeLog.FindFirst();
        Assert.AreEqual('Line 10000: Quantity must be greater than zero.', IntakeLog.Message, 'Expected DOC-ISO-B''s own message, not DOC-ISO-A''s');

        IntakeLog.SetRange("Document No.");
        Assert.AreEqual(2, IntakeLog.Count(), 'Expected exactly two log entries total across both documents, no extras');
    end;

    [Test]
    procedure ADocumentWithThreeProblemLinesLogsEachOfThemOnce()
    var
        IntakeLog: Record "CG X144 Intake Log";
        Pipeline: Codeunit "CG X144 Intake Pipeline";
    begin
        ClearIntakeFixture();
        AddIntakeLine('DOC-THREE-1', 10000, '', 5, 10);
        AddIntakeLine('DOC-THREE-1', 20000, 'ITEM-2', 0, 10);
        AddIntakeLine('DOC-THREE-1', 30000, 'ITEM-3', 5, -5);

        Pipeline.ProcessDocument('DOC-THREE-1', 'ref-three-1', 300);

        IntakeLog.SetRange("Document No.", 'DOC-THREE-1');
        Assert.AreEqual(3, IntakeLog.Count(), 'Expected one log entry for each of the three problem lines, not fewer');

        IntakeLog.SetRange(Message, 'Line 10000: Item No. is missing.');
        Assert.AreEqual(1, IntakeLog.Count(), 'Expected the missing-item-number line to have its own logged entry');

        IntakeLog.SetRange(Message, 'Line 20000: Quantity must be greater than zero.');
        Assert.AreEqual(1, IntakeLog.Count(), 'Expected the non-positive-quantity line to have its own logged entry');

        IntakeLog.SetRange(Message, 'Line 30000: Unit Cost cannot be negative.');
        Assert.AreEqual(1, IntakeLog.Count(), 'Expected the negative-unit-cost line to have its own logged entry');
    end;

    // ================================================================
    // Donor: CG-AL-X131 line-validation module (live symptom source)
    // ================================================================

    // The default test isolation persists writes between test methods, so
    // every test that seeds rows clears the table first. A second,
    // unrelated batch is seeded with nonzero sentinel values wherever
    // isolation is under test, so "untouched" and "wiped" stay
    // distinguishable.

    local procedure MakeLine(var ImportLine: Record "CG X131 Import Line"; BatchCode: Code[20]; LineNo: Integer; ItemNo: Code[20]; NewQuantity: Decimal; NewUnitCost: Decimal)
    begin
        ImportLine.Init();
        ImportLine."Batch Code" := BatchCode;
        ImportLine."Line No." := LineNo;
        ImportLine."Item No." := ItemNo;
        ImportLine.Quantity := NewQuantity;
        ImportLine."Unit Cost" := NewUnitCost;
    end;

    local procedure InsertLine(BatchCode: Code[20]; LineNo: Integer; ItemNo: Code[20]; NewQuantity: Decimal; NewUnitCost: Decimal)
    var
        ImportLine: Record "CG X131 Import Line";
    begin
        MakeLine(ImportLine, BatchCode, LineNo, ItemNo, NewQuantity, NewUnitCost);
        ImportLine.Insert();
    end;

    [Test]
    procedure CheckLineAcceptsAFullyValidLine()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        LineMessages: List of [Text];
    begin
        MakeLine(ImportLine, 'ONE-OFF', 10000, 'ITEM-1', 5, 10);

        Checker.CheckLine(ImportLine, LineMessages);

        Assert.AreEqual(0, LineMessages.Count(), 'A line satisfying every rule should report no problems');
    end;

    [Test]
    procedure CheckLineAcceptsAZeroUnitCost()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        LineMessages: List of [Text];
    begin
        MakeLine(ImportLine, 'ONE-OFF', 10000, 'ITEM-1', 5, 0);

        Checker.CheckLine(ImportLine, LineMessages);

        Assert.AreEqual(0, LineMessages.Count(), 'A Unit Cost of exactly 0 is allowed - only a negative cost is a problem');
    end;

    [Test]
    procedure CheckLineAcceptsAQuantityJustAboveZero()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        LineMessages: List of [Text];
    begin
        MakeLine(ImportLine, 'ONE-OFF', 10000, 'ITEM-1', 0.01, 10);

        Checker.CheckLine(ImportLine, LineMessages);

        Assert.AreEqual(0, LineMessages.Count(), 'A Quantity just above zero is allowed - only zero or below is a problem');
    end;

    [Test]
    procedure CheckLineReportsAMissingItemNo()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        LineMessages: List of [Text];
    begin
        MakeLine(ImportLine, 'ONE-OFF', 10000, '', 5, 10);

        Checker.CheckLine(ImportLine, LineMessages);

        Assert.AreEqual(1, LineMessages.Count(), 'A blank Item No. is the only problem on this line');
        Assert.AreEqual('Line 10000: Item No. is missing.', LineMessages.Get(1), 'Expected the missing-item message with the line''s own number');
    end;

    [Test]
    procedure CheckLineReportsAZeroQuantity()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        LineMessages: List of [Text];
    begin
        MakeLine(ImportLine, 'ONE-OFF', 20000, 'ITEM-1', 0, 10);

        Checker.CheckLine(ImportLine, LineMessages);

        Assert.AreEqual(1, LineMessages.Count(), 'A zero Quantity is the only problem on this line');
        Assert.AreEqual('Line 20000: Quantity must be greater than zero.', LineMessages.Get(1), 'Expected the quantity message with the line''s own number');
    end;

    [Test]
    procedure CheckLineReportsANegativeQuantity()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        LineMessages: List of [Text];
    begin
        MakeLine(ImportLine, 'ONE-OFF', 20000, 'ITEM-1', -3, 10);

        Checker.CheckLine(ImportLine, LineMessages);

        Assert.AreEqual(1, LineMessages.Count(), 'A negative Quantity is the only problem on this line');
        Assert.AreEqual('Line 20000: Quantity must be greater than zero.', LineMessages.Get(1), 'Expected the quantity message with the line''s own number');
    end;

    [Test]
    procedure CheckLineReportsAUnitCostJustBelowZero()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        LineMessages: List of [Text];
    begin
        MakeLine(ImportLine, 'ONE-OFF', 30000, 'ITEM-1', 5, -0.01);

        Checker.CheckLine(ImportLine, LineMessages);

        Assert.AreEqual(1, LineMessages.Count(), 'A Unit Cost just below zero is the only problem on this line');
        Assert.AreEqual('Line 30000: Unit Cost cannot be negative.', LineMessages.Get(1), 'Expected the unit cost message with the line''s own number');
    end;

    [Test]
    procedure CheckLineReportsOnlyTheFirstRuleWhenAllThreeAreBroken()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        LineMessages: List of [Text];
    begin
        MakeLine(ImportLine, 'ONE-OFF', 40000, '', 0, -5);

        Checker.CheckLine(ImportLine, LineMessages);

        Assert.AreEqual(1, LineMessages.Count(), 'A line breaking every rule must still report exactly one problem - its first broken rule');
        Assert.AreEqual('Line 40000: Item No. is missing.', LineMessages.Get(1), 'Expected the FIRST rule in the order (Item No., then Quantity, then Unit Cost) to be the one reported');
    end;

    [Test]
    procedure CheckLineReportsTheQuantityRuleWhenItemIsValidButQuantityAndCostAreBroken()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        LineMessages: List of [Text];
    begin
        MakeLine(ImportLine, 'ONE-OFF', 50000, 'ITEM-1', 0, -5);

        Checker.CheckLine(ImportLine, LineMessages);

        Assert.AreEqual(1, LineMessages.Count(), 'A line with a valid Item No. but two broken rules must still report exactly one problem');
        Assert.AreEqual('Line 50000: Quantity must be greater than zero.', LineMessages.Get(1), 'Expected Quantity - the earlier rule of the two remaining - to be the one reported, not Unit Cost');
    end;

    [Test]
    procedure CheckBatchReportsOneMessagePerProblemLine()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        Problems: List of [Text];
    begin
        ImportLine.DeleteAll();
        InsertLine('BATCH-A', 10000, 'ITEM-1', 5, 10);
        InsertLine('BATCH-A', 20000, 'ITEM-2', 0, 10);
        InsertLine('BATCH-A', 30000, '', 0, -5);
        InsertLine('BATCH-A', 40000, 'ITEM-4', 3, 8);

        Checker.CheckBatch('BATCH-A', Problems);

        Assert.AreEqual(2, Problems.Count(), 'Expected exactly one problem per problem line - two lines are broken, not more entries for the line breaking several rules');
        Assert.AreEqual('Line 20000: Quantity must be greater than zero.', Problems.Get(1), 'Expected the first problem to belong to line 20000, in line order');
        Assert.AreEqual('Line 30000: Item No. is missing.', Problems.Get(2), 'Expected the second problem to be line 30000''s FIRST broken rule, not one entry per rule it breaks');
    end;

    [Test]
    procedure CheckBatchIgnoresLinesOfOtherBatches()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        Problems: List of [Text];
    begin
        ImportLine.DeleteAll();
        InsertLine('BATCH-B1', 10000, '', 5, 10);
        InsertLine('BATCH-B2', 20000, '', 7, 20);

        Checker.CheckBatch('BATCH-B1', Problems);

        Assert.AreEqual(1, Problems.Count(), 'The other batch''s broken line must not leak into this batch''s result');
        Assert.AreEqual('Line 10000: Item No. is missing.', Problems.Get(1), 'Expected the reported problem to belong to the requested batch');

        ImportLine.Get('BATCH-B2', 20000);
        Assert.AreEqual('', ImportLine."Item No.", 'The other batch''s line must be left exactly as seeded');
        Assert.AreEqual(7, ImportLine.Quantity, 'The other batch''s Quantity must survive untouched');
        Assert.AreEqual(20, ImportLine."Unit Cost", 'The other batch''s Unit Cost must survive untouched');
    end;

    [Test]
    procedure CheckBatchReturnsAnEmptyListForACleanBatch()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        Problems: List of [Text];
    begin
        ImportLine.DeleteAll();
        InsertLine('BATCH-C', 10000, 'ITEM-1', 5, 10);
        InsertLine('BATCH-C', 20000, 'ITEM-2', 3, 0);

        Checker.CheckBatch('BATCH-C', Problems);

        Assert.AreEqual(0, Problems.Count(), 'A batch where every line passes every rule must report no problems');
    end;

    [Test]
    procedure CheckBatchReplacesEarlierListContents()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        Problems: List of [Text];
    begin
        ImportLine.DeleteAll();
        InsertLine('BATCH-D', 10000, '', 5, 10);
        InsertLine('BATCH-D', 20000, 'ITEM-2', 0, 10);

        Checker.CheckBatch('BATCH-D', Problems);
        Checker.CheckBatch('BATCH-D', Problems);

        Assert.AreEqual(2, Problems.Count(), 'A second run must replace the first run''s findings, not add to them');
        Assert.AreEqual('Line 10000: Item No. is missing.', Problems.Get(1), 'Expected the first problem of the second run to still be line 10000');
        Assert.AreEqual('Line 20000: Quantity must be greater than zero.', Problems.Get(2), 'Expected the second problem of the second run to still be line 20000');
    end;

    // ================================================================
    // Distractor: CG-AL-X138 reference-matching module (correct both
    // sides; wired into the glue pipeline upstream of the live symptom)
    // ================================================================

    // The reference-normalization cases are driven from a table of
    // (raw, expected) pairs rather than one named test each - the pairs ARE
    // the spec, and a failing sweep discloses one case rather than the whole
    // rule (decisions entry 21).

    local procedure ClearMatcherFixture()
    var
        DocIndex: Record "CG X138 Doc Index";
        InboundDoc: Record "CG X138 Inbound Doc";
        MatchLog: Record "CG X138 Match Log";
    begin
        DocIndex.DeleteAll();
        InboundDoc.DeleteAll();
        MatchLog.DeleteAll();
    end;

    // The graded pairs. Each row is (raw reference, expected key), with the
    // expected value written out rather than derived, so the sweep grades
    // the spec and not whatever the implementation happens to compute.
    local procedure MatcherCaseCount(): Integer
    begin
        exit(12);
    end;

    local procedure MatcherCaseRaw(Index: Integer): Text[100]
    begin
        case Index of
            1:
                exit('INV-2024-001');
            2:
                exit('inv 2024 001');
            3:
                exit('INV_2024_001');
            4:
                exit('  Inv 2024 001  ');
            5:
                exit('ORD-ALPHA-1001');
            6:
                exit('ord alpha 1001');
            7:
                exit('ORD-BRAVO-2002');
            8:
                exit('');
            9:
                exit('   ---   ');
            10:
                exit('PO-2024-ALPHA-BRAVO-CHARLIE-DELTA');
            11:
                exit('PO-2024-ZULU-YANKEE-XRAY-WHISKEY');
        end;
        exit('INV-2029/099');
    end;

    local procedure MatcherCaseExpected(Index: Integer): Code[20]
    begin
        case Index of
            1:
                exit('INV2024001');
            2:
                exit('INV2024001');
            3:
                exit('INV2024001');
            4:
                exit('INV2024001');
            5:
                exit('ORDALPHA1001');
            6:
                exit('ORDALPHA1001');
            7:
                exit('ORDBRAVO2002');
            8:
                exit('');
            9:
                exit('');
            10:
                exit('PO2024ALPHABRAVOCHAR');
            11:
                exit('PO2024ZULUYANKEEXRAY');
        end;
        exit('INV2029099');
    end;

    [Test]
    procedure PreviewedKeysMatchTheGradedSet()
    var
        Matcher: Codeunit "CG X138 Doc Matcher";
        Index: Integer;
    begin
        // [SCENARIO] Every raw reference in the graded set previews to its expected key
        ClearMatcherFixture();

        for Index := 1 to MatcherCaseCount() do
            Assert.AreEqual(MatcherCaseExpected(Index), Matcher.PreviewMatchKey(MatcherCaseRaw(Index)),
                StrSubstNo('Expected the previewed key for graded case %1 to match', Index));
    end;

    [Test]
    procedure ImportingPreservesTheOriginalReference()
    var
        InboundDoc: Record "CG X138 Inbound Doc";
        DocIndex: Record "CG X138 Doc Index";
        Matcher: Codeunit "CG X138 Doc Matcher";
    begin
        // [SCENARIO] An imported document keeps its raw reference on file
        ClearMatcherFixture();

        Matcher.ImportInboundDoc('DOC-001', 'inv-2024-777', 555.50);

        Assert.IsTrue(InboundDoc.Get('DOC-001'), 'Expected the imported document to exist');
        Assert.AreEqual('inv-2024-777', InboundDoc."External Ref",
            'Expected the document to keep the reference exactly as it was received');
        Assert.AreEqual(555.50, InboundDoc.Amount, 'Expected the document to keep its amount');
        Assert.IsTrue(DocIndex.Get('INV2024777'), 'Expected the document to be indexed under its normalized key');
        Assert.AreEqual('DOC-001', DocIndex."Doc No.", 'Expected the index entry to point at the imported document');
    end;

    [Test]
    procedure MatchingFindsADifferentlyFormattedReference()
    var
        MatchLog: Record "CG X138 Match Log";
        Matcher: Codeunit "CG X138 Doc Matcher";
        Matched: Boolean;
    begin
        // [SCENARIO] An incoming remittance names the same document with different formatting
        ClearMatcherFixture();
        Matcher.ImportInboundDoc('DOC-050', 'INV-2024-050', 100);

        Matched := Matcher.TryMatchIncoming('inv 2024 050');

        Assert.IsTrue(Matched, 'Expected a differently formatted reference to still match');
        Assert.IsTrue(MatchLog.FindLast(), 'Expected the match attempt to be logged');
        Assert.AreEqual('inv 2024 050', MatchLog."Incoming Ref",
            'Expected the log to keep the incoming reference exactly as it was received');
        Assert.AreEqual('INV2024050', MatchLog."Match Key Used", 'Expected the log to record the key used to match');
        Assert.AreEqual('DOC-050', MatchLog."Matched Doc No.", 'Expected the log to record which document was matched');
    end;

    [Test]
    procedure MatchingAnUnindexedReferenceFindsNothing()
    var
        MatchLog: Record "CG X138 Match Log";
        Matcher: Codeunit "CG X138 Doc Matcher";
        Matched: Boolean;
    begin
        // [SCENARIO] The incoming reference was never imported
        ClearMatcherFixture();
        Matcher.ImportInboundDoc('DOC-060', 'INV-2024-060', 100);

        Matched := Matcher.TryMatchIncoming('INV-2024-999');

        Assert.IsFalse(Matched, 'Expected an unindexed reference not to match');
        Assert.IsTrue(MatchLog.FindLast(), 'Expected the failed match attempt to be logged too');
        Assert.AreEqual('', MatchLog."Matched Doc No.", 'Expected no document to be recorded for a failed match');
        Assert.AreEqual('INV-2024-999', MatchLog."Incoming Ref",
            'Expected the log to keep the incoming reference exactly as it was received');
    end;

    [Test]
    procedure DistinctReferencesStayDistinctThroughMatching()
    var
        InboundDoc: Record "CG X138 Inbound Doc";
        Matcher: Codeunit "CG X138 Doc Matcher";
        Matched: Boolean;
    begin
        // [SCENARIO] Two unrelated documents are imported and matched independently
        ClearMatcherFixture();
        Matcher.ImportInboundDoc('DOC-A', 'ORD-ALPHA-1001', 111);
        Matcher.ImportInboundDoc('DOC-B', 'ORD-BRAVO-2002', 222);

        Matched := Matcher.TryMatchIncoming('ord alpha 1001');
        Assert.IsTrue(Matched, 'Expected the first document''s reference to match');

        InboundDoc.Get('DOC-B');
        Assert.AreEqual('ORD-BRAVO-2002', InboundDoc."External Ref",
            'Expected the untouched document to keep its own reference');
        Assert.AreEqual(222.0, InboundDoc.Amount, 'Expected the untouched document to keep its own amount');

        Matched := Matcher.TryMatchIncoming('ORD-BRAVO-2002');
        Assert.IsTrue(Matched, 'Expected the second document''s own reference to match too');
    end;

    [Test]
    procedure OverlongReferencesTruncateWithoutColliding()
    var
        DocIndexA: Record "CG X138 Doc Index";
        DocIndexB: Record "CG X138 Doc Index";
        Matcher: Codeunit "CG X138 Doc Matcher";
    begin
        // [SCENARIO] Two long references that only diverge after the key's length limit
        ClearMatcherFixture();
        Matcher.ImportInboundDoc('DOC-LONG-A', 'PO-2024-ALPHA-BRAVO-CHARLIE-DELTA', 10);
        Matcher.ImportInboundDoc('DOC-LONG-B', 'PO-2024-ZULU-YANKEE-XRAY-WHISKEY', 20);

        Assert.IsTrue(DocIndexA.Get('PO2024ALPHABRAVOCHAR'),
            'Expected the first long reference to be indexed under its truncated key');
        Assert.AreEqual('DOC-LONG-A', DocIndexA."Doc No.", 'Expected the first index entry to point at its own document');
        Assert.IsTrue(DocIndexB.Get('PO2024ZULUYANKEEXRAY'),
            'Expected the second long reference to be indexed under its own truncated key');
        Assert.AreEqual('DOC-LONG-B', DocIndexB."Doc No.", 'Expected the second index entry to point at its own document');
    end;

    [Test]
    procedure BlankReferenceStillImportsCleanly()
    var
        InboundDoc: Record "CG X138 Inbound Doc";
        DocIndex: Record "CG X138 Doc Index";
        Matcher: Codeunit "CG X138 Doc Matcher";
    begin
        // [SCENARIO] A document arrives with no external reference at all
        ClearMatcherFixture();

        Matcher.ImportInboundDoc('DOC-BLANK', '', 42);

        Assert.IsTrue(InboundDoc.Get('DOC-BLANK'), 'Expected the document to be imported even with a blank reference');
        Assert.AreEqual('', InboundDoc."External Ref", 'Expected the blank reference to stay blank');
        Assert.IsTrue(DocIndex.Get(''), 'Expected a blank reference to still be indexed under a blank key');
    end;

    [Test]
    procedure MatchingByDocumentNumberNeedsNoReferenceAtAll()
    var
        InboundDoc: Record "CG X138 Inbound Doc";
        Matcher: Codeunit "CG X138 Doc Matcher";
    begin
        // [SCENARIO] Some callers only ever look a document up by its own number
        ClearMatcherFixture();
        InboundDoc.Init();
        InboundDoc."No." := 'DOC-DIRECT';
        InboundDoc."External Ref" := 'whatever-arrived';
        InboundDoc.Amount := 999;
        InboundDoc.Insert();

        Assert.IsTrue(Matcher.MatchByDocNo('DOC-DIRECT'), 'Expected a direct lookup by document number to succeed');
        Assert.IsFalse(Matcher.MatchByDocNo('DOC-NOPE'), 'Expected a direct lookup for an unknown document number to fail cleanly');
    end;

    [Test]
    procedure RepeatedMatchAttemptsAreEachLoggedInOrder()
    var
        MatchLog: Record "CG X138 Match Log";
        Matcher: Codeunit "CG X138 Doc Matcher";
    begin
        // [SCENARIO] Several match attempts against the same document are each logged
        ClearMatcherFixture();
        Matcher.ImportInboundDoc('DOC-070', 'INV-2024-070', 100);

        Matcher.TryMatchIncoming('inv 2024 070');
        Matcher.TryMatchIncoming('INV-2024-071');
        Matcher.TryMatchIncoming('inv/2024/070');

        Assert.AreEqual(3, MatchLog.Count(), 'Expected one log entry per match attempt');
        MatchLog.FindLast();
        Assert.AreEqual('inv/2024/070', MatchLog."Incoming Ref",
            'Expected the most recent log entry to describe the most recent attempt');
    end;

    // ================================================================
    // Distractor: CG-AL-X132 balance-review module (correct both sides;
    // coupling-zero, present for scale and vagueness)
    // ================================================================

    // The default test isolation persists writes between test methods, so
    // every test clears the real table before seeding its own rows - even
    // tests that only exercise a working copy, which never touches the
    // database at all.

    local procedure SeedReal(EntryNo: Integer; AccountNo: Code[20]; InitialAmount: Decimal)
    var
        BalanceLine: Record "CG X132 Balance Line";
    begin
        BalanceLine.Init();
        BalanceLine."Entry No." := EntryNo;
        BalanceLine."Account No." := AccountNo;
        BalanceLine.Amount := InitialAmount;
        BalanceLine.Reviewed := false;
        BalanceLine.Insert();
    end;

    local procedure SeedWorkingCopy(var TempBalanceLine: Record "CG X132 Balance Line" temporary; EntryNo: Integer; AccountNo: Code[20]; InitialAmount: Decimal)
    begin
        TempBalanceLine.Init();
        TempBalanceLine."Entry No." := EntryNo;
        TempBalanceLine."Account No." := AccountNo;
        TempBalanceLine.Amount := InitialAmount;
        TempBalanceLine.Reviewed := false;
        TempBalanceLine.Insert();
    end;

    local procedure RealAmount(EntryNo: Integer): Decimal
    var
        BalanceLine: Record "CG X132 Balance Line";
    begin
        BalanceLine.Get(EntryNo);
        exit(BalanceLine.Amount);
    end;

    local procedure RealReviewed(EntryNo: Integer): Boolean
    var
        BalanceLine: Record "CG X132 Balance Line";
    begin
        BalanceLine.Get(EntryNo);
        exit(BalanceLine.Reviewed);
    end;

    [Test]
    procedure ProcessBufferMarksWorkingCopyLinesAndReturnsTheTotal()
    var
        BalanceLine: Record "CG X132 Balance Line";
        TempBalanceLine: Record "CG X132 Balance Line" temporary;
        Buffer: Codeunit "CG X132 Balance Buffer";
        Total: Decimal;
    begin
        BalanceLine.DeleteAll();
        SeedWorkingCopy(TempBalanceLine, 1, 'ACC-A', 10);
        SeedWorkingCopy(TempBalanceLine, 2, 'ACC-A', 25);
        SeedWorkingCopy(TempBalanceLine, 3, 'ACC-B', 7);

        Total := Buffer.ProcessBuffer(TempBalanceLine);

        Assert.AreEqual(42.0, Total, 'Expected the total across every working-copy line');
        TempBalanceLine.Reset();
        TempBalanceLine.FindSet();
        repeat
            Assert.IsTrue(TempBalanceLine.Reviewed, 'Expected every working-copy line to be marked reviewed');
        until TempBalanceLine.Next() = 0;
    end;

    [Test]
    procedure ProcessBufferReturnsZeroForAnEmptyWorkingCopy()
    var
        BalanceLine: Record "CG X132 Balance Line";
        TempBalanceLine: Record "CG X132 Balance Line" temporary;
        Buffer: Codeunit "CG X132 Balance Buffer";
    begin
        BalanceLine.DeleteAll();

        Assert.AreEqual(0.0, Buffer.ProcessBuffer(TempBalanceLine), 'Expected an empty working copy to total zero, not raise an error');
    end;

    [Test]
    procedure ProcessBufferRefusesTheRealTable()
    var
        BalanceLine: Record "CG X132 Balance Line";
        Buffer: Codeunit "CG X132 Balance Buffer";
    begin
        BalanceLine.DeleteAll();
        SeedReal(100, 'ACC-A', 55);
        SeedReal(200, 'ACC-B', 91);
        Commit();

        BalanceLine.SetRange("Account No.", 'ACC-A');
        asserterror Buffer.ProcessBuffer(BalanceLine);
        Assert.ExpectedError('working copy of balance lines');

        Assert.AreEqual(55.0, RealAmount(100), 'Expected the real ACC-A row to be untouched after the refusal');
        Assert.IsFalse(RealReviewed(100), 'Expected the real ACC-A row to stay unreviewed after the refusal');
        Assert.AreEqual(91.0, RealAmount(200), 'Expected the unrelated real ACC-B row to be untouched after the refusal');
        Assert.IsFalse(RealReviewed(200), 'Expected the unrelated real ACC-B row to stay unreviewed after the refusal');
    end;

    [Test]
    procedure ProcessBufferRefusesTheEmptyRealTable()
    var
        BalanceLine: Record "CG X132 Balance Line";
        Buffer: Codeunit "CG X132 Balance Buffer";
    begin
        BalanceLine.DeleteAll();

        asserterror Buffer.ProcessBuffer(BalanceLine);
        Assert.ExpectedError('working copy of balance lines');
    end;

    [Test]
    procedure ArchiveBufferClearsWorkingCopyLinesAndMarksThemReviewed()
    var
        BalanceLine: Record "CG X132 Balance Line";
        TempBalanceLine: Record "CG X132 Balance Line" temporary;
        Buffer: Codeunit "CG X132 Balance Buffer";
    begin
        BalanceLine.DeleteAll();
        SeedWorkingCopy(TempBalanceLine, 1, 'ACC-A', 10);
        SeedWorkingCopy(TempBalanceLine, 2, 'ACC-A', 25);

        Buffer.ArchiveBuffer(TempBalanceLine);

        TempBalanceLine.Reset();
        TempBalanceLine.FindSet();
        repeat
            Assert.AreEqual(0.0, TempBalanceLine.Amount, 'Expected every working-copy line to be cleared to zero');
            Assert.IsTrue(TempBalanceLine.Reviewed, 'Expected every working-copy line to be marked reviewed');
        until TempBalanceLine.Next() = 0;
    end;

    [Test]
    procedure ArchiveBufferOnAnEmptyWorkingCopyCompletesWithoutError()
    var
        BalanceLine: Record "CG X132 Balance Line";
        TempBalanceLine: Record "CG X132 Balance Line" temporary;
        Buffer: Codeunit "CG X132 Balance Buffer";
    begin
        BalanceLine.DeleteAll();

        Buffer.ArchiveBuffer(TempBalanceLine);

        Assert.AreEqual(0, TempBalanceLine.Count(), 'Expected an empty working copy to stay empty after archiving');
    end;

    [Test]
    procedure ArchiveBufferOnAWorkingCopyLimitedToOneAccountOnlyTouchesThatAccount()
    var
        BalanceLine: Record "CG X132 Balance Line";
        TempBalanceLine: Record "CG X132 Balance Line" temporary;
        Buffer: Codeunit "CG X132 Balance Buffer";
    begin
        BalanceLine.DeleteAll();
        SeedWorkingCopy(TempBalanceLine, 1, 'ACC-A', 10);
        SeedWorkingCopy(TempBalanceLine, 2, 'ACC-B', 40);
        TempBalanceLine.Reset();
        TempBalanceLine.SetRange("Account No.", 'ACC-A');

        Buffer.ArchiveBuffer(TempBalanceLine);

        TempBalanceLine.Reset();
        TempBalanceLine.Get(1);
        Assert.AreEqual(0.0, TempBalanceLine.Amount, 'Expected the selected ACC-A working-copy line to be cleared');
        Assert.IsTrue(TempBalanceLine.Reviewed, 'Expected the selected ACC-A working-copy line to be marked reviewed');
        TempBalanceLine.Get(2);
        Assert.AreEqual(40.0, TempBalanceLine.Amount, 'Expected the ACC-B working-copy line outside the selection to be untouched');
        Assert.IsFalse(TempBalanceLine.Reviewed, 'Expected the ACC-B working-copy line outside the selection to stay unreviewed');
    end;

    [Test]
    procedure ArchiveBufferRefusesTheRealTableWhenLimitedToOneAccount()
    var
        BalanceLine: Record "CG X132 Balance Line";
        Buffer: Codeunit "CG X132 Balance Buffer";
    begin
        BalanceLine.DeleteAll();
        SeedReal(100, 'ACC-A', 55);
        SeedReal(101, 'ACC-A', 12);
        SeedReal(200, 'ACC-B', 91);
        Commit();

        BalanceLine.SetRange("Account No.", 'ACC-A');
        asserterror Buffer.ArchiveBuffer(BalanceLine);
        Assert.ExpectedError('working copy of balance lines');

        Assert.AreEqual(55.0, RealAmount(100), 'Expected the real ACC-A row to be untouched after the refusal');
        Assert.IsFalse(RealReviewed(100), 'Expected the real ACC-A row to stay unreviewed after the refusal');
        Assert.AreEqual(12.0, RealAmount(101), 'Expected the second real ACC-A row to be untouched after the refusal');
        Assert.AreEqual(91.0, RealAmount(200), 'Expected the unrelated real ACC-B row to be untouched after the refusal');
        Assert.IsFalse(RealReviewed(200), 'Expected the unrelated real ACC-B row to stay unreviewed after the refusal');
    end;

    [Test]
    procedure ArchiveBufferRefusesTheWholeRealTable()
    var
        BalanceLine: Record "CG X132 Balance Line";
        Buffer: Codeunit "CG X132 Balance Buffer";
    begin
        BalanceLine.DeleteAll();
        SeedReal(100, 'ACC-A', 55);
        SeedReal(200, 'ACC-B', 91);
        Commit();

        BalanceLine.Reset();
        asserterror Buffer.ArchiveBuffer(BalanceLine);
        Assert.ExpectedError('working copy of balance lines');

        Assert.AreEqual(55.0, RealAmount(100), 'Expected the real ACC-A row to be untouched after the refusal');
        Assert.IsFalse(RealReviewed(100), 'Expected the real ACC-A row to stay unreviewed after the refusal');
        Assert.AreEqual(91.0, RealAmount(200), 'Expected the real ACC-B row to be untouched after the refusal');
        Assert.IsFalse(RealReviewed(200), 'Expected the real ACC-B row to stay unreviewed after the refusal');
    end;

    [Test]
    procedure ArchiveBufferRefusesTheEmptyRealTable()
    var
        BalanceLine: Record "CG X132 Balance Line";
        Buffer: Codeunit "CG X132 Balance Buffer";
    begin
        BalanceLine.DeleteAll();

        asserterror Buffer.ArchiveBuffer(BalanceLine);
        Assert.ExpectedError('working copy of balance lines');
    end;

    // ================================================================
    // Distractor: CG-AL-X136 payment-terms module (correct both sides;
    // coupling-zero, present for scale and vagueness). The hidden
    // deterministic sweep is carried over intact.
    // ================================================================

    // The default test isolation persists writes between test methods
    // (measured 2026-08-20, SOAP runner), so every test clears the table
    // before seeding its own records.

    local procedure ClearAllTerms()
    var
        Terms: Record "CG X136 Payment Terms";
    begin
        Terms.DeleteAll();
    end;

    local procedure SeedTerms(TermsCode: Code[10]; DueDateFormulaText: Text; DiscountDateFormulaText: Text)
    var
        Terms: Record "CG X136 Payment Terms";
        DueFormula: DateFormula;
        DiscountFormula: DateFormula;
    begin
        if DueDateFormulaText <> '' then
            Evaluate(DueFormula, DueDateFormulaText);
        if DiscountDateFormulaText <> '' then
            Evaluate(DiscountFormula, DiscountDateFormulaText);

        Terms.Init();
        Terms."Code" := TermsCode;
        Terms."Due Date Calculation" := DueFormula;
        Terms."Discount Date Calculation" := DiscountFormula;
        Terms.Insert();
    end;

    // ---- Shown examples (disclosed in the task description) ----

    [Test]
    procedure PaymentOnTheDiscountDateQualifies()
    var
        Calculator: Codeunit "CG X136 Terms Calculator";
    begin
        ClearAllTerms();
        SeedTerms('NET8', '', '<8D>');

        Assert.IsTrue(
            Calculator.QualifiesForDiscount('NET8', DMY2Date(10, 6, 2026), DMY2Date(18, 6, 2026)),
            'Expected a payment on 18-06-2026 to qualify under NET8 (<8D> over 10-06-2026), got false');
    end;

    [Test]
    procedure PaymentTheDayAfterTheDiscountDateDoesNotQualify()
    var
        Calculator: Codeunit "CG X136 Terms Calculator";
    begin
        ClearAllTerms();
        SeedTerms('NET8', '', '<8D>');

        Assert.IsFalse(
            Calculator.QualifiesForDiscount('NET8', DMY2Date(10, 6, 2026), DMY2Date(19, 6, 2026)),
            'Expected a payment on 19-06-2026 to no longer qualify under NET8 (<8D> over 10-06-2026), got true');
    end;

    [Test]
    procedure TermOrderCM10QualifiesOnTheComputedDate()
    var
        Calculator: Codeunit "CG X136 Terms Calculator";
    begin
        ClearAllTerms();
        SeedTerms('CM10', '', '<CM+10D>');

        Assert.IsTrue(
            Calculator.QualifiesForDiscount('CM10', DMY2Date(15, 2, 2024), DMY2Date(10, 3, 2024)),
            'Expected a payment on 10-03-2024 to qualify under CM10 (<CM+10D> over 15-02-2024), got false');
    end;

    [Test]
    procedure TermOrder10CMDoesNotQualifyOnTheSameDate()
    var
        Calculator: Codeunit "CG X136 Terms Calculator";
    begin
        ClearAllTerms();
        SeedTerms('10CM', '', '<10D+CM>');

        Assert.IsFalse(
            Calculator.QualifiesForDiscount('10CM', DMY2Date(15, 2, 2024), DMY2Date(10, 3, 2024)),
            'Expected a payment on 10-03-2024 to not qualify under 10CM (<10D+CM> over 15-02-2024), got true');
    end;

    // ---- Hidden: the untouched due-date contract still holds (the starter passes this) ----

    [Test]
    procedure DueDateAppliesTheFormulaFromTheDocumentDate()
    var
        Calculator: Codeunit "CG X136 Terms Calculator";
        DueDate: Date;
    begin
        ClearAllTerms();
        SeedTerms('NET14', '<14D>', '');

        DueDate := Calculator.CalcDueDate('NET14', DMY2Date(6, 3, 2026));

        Assert.AreEqual(DMY2Date(20, 3, 2026), DueDate, 'Expected NET14 (<14D> over 06-03-2026) to fall due on 20-03-2026');
    end;

    // ---- Hidden: cross-entity isolation and mutation safety ----

    [Test]
    procedure EachTermsRecordIsEvaluatedIndependently()
    var
        Calculator: Codeunit "CG X136 Terms Calculator";
        GammaDocumentDate: Date;
        GammaDueBefore: Date;
        GammaDueAfter: Date;
        GammaQualifiesBefore: Boolean;
        GammaQualifiesAfter: Boolean;
        DocumentDate: Date;
        PaymentDate: Date;
    begin
        ClearAllTerms();
        SeedTerms('ALPHA', '', '<5D>');
        SeedTerms('BETA', '', '<20D>');
        SeedTerms('GAMMA', '<30D>', '<3D>');

        GammaDocumentDate := DMY2Date(1, 1, 2026);
        GammaDueBefore := Calculator.CalcDueDate('GAMMA', GammaDocumentDate);
        GammaQualifiesBefore := Calculator.QualifiesForDiscount('GAMMA', GammaDocumentDate, DMY2Date(4, 1, 2026));

        DocumentDate := DMY2Date(1, 6, 2026);
        PaymentDate := DMY2Date(15, 6, 2026);

        Assert.IsFalse(
            Calculator.QualifiesForDiscount('ALPHA', DocumentDate, PaymentDate),
            'Expected ALPHA (<5D> over 01-06-2026) to no longer qualify a payment on 15-06-2026');
        Assert.IsTrue(
            Calculator.QualifiesForDiscount('BETA', DocumentDate, PaymentDate),
            'Expected BETA (<20D> over 01-06-2026) to still qualify a payment on 15-06-2026');

        GammaDueAfter := Calculator.CalcDueDate('GAMMA', GammaDocumentDate);
        GammaQualifiesAfter := Calculator.QualifiesForDiscount('GAMMA', GammaDocumentDate, DMY2Date(4, 1, 2026));

        Assert.AreEqual(GammaDueBefore, GammaDueAfter, 'Expected GAMMA''s own due-date formula to be unaffected by evaluating ALPHA and BETA');
        Assert.AreEqual(GammaQualifiesBefore, GammaQualifiesAfter, 'Expected GAMMA''s own discount formula to be unaffected by evaluating ALPHA and BETA');
        Assert.AreEqual(DMY2Date(31, 1, 2026), GammaDueAfter, 'Expected GAMMA (<30D> over 01-01-2026) to fall due on 31-01-2026');
        Assert.IsTrue(GammaQualifiesAfter, 'Expected GAMMA (<3D> over 01-01-2026) to qualify a payment on 04-01-2026');
    end;

    // ---- Hidden: deterministic sweep across many (formula, document date, payment date) triples ----
    // Each formula group is graded on-the-computed-date and one day after it; the on-date rows
    // are exactly where the two candidate comparisons in QualifiesForDiscount disagree.

    [Test]
    procedure QualifiesForDiscountMatchesTheComputedDateAcrossManyFormulasAndDates()
    var
        Terms: Record "CG X136 Payment Terms";
        Calculator: Codeunit "CG X136 Terms Calculator";
        Formulas: List of [Text];
        DocDates: List of [Date];
        PayDates: List of [Date];
        Expected: List of [Boolean];
        Contexts: List of [Text];
        DiscountFormula: DateFormula;
        Idx: Integer;
        Actual: Boolean;
    begin
        ClearAllTerms();
        Terms.Init();
        Terms."Code" := 'SWEEP';
        Terms.Insert();

        // Plain day offset
        Formulas.Add('<5D>');
        DocDates.Add(DMY2Date(1, 4, 2026));
        PayDates.Add(DMY2Date(6, 4, 2026));
        Expected.Add(true);
        Contexts.Add('<5D> from 01-04-2026, payment on the computed date');

        Formulas.Add('<5D>');
        DocDates.Add(DMY2Date(1, 4, 2026));
        PayDates.Add(DMY2Date(7, 4, 2026));
        Expected.Add(false);
        Contexts.Add('<5D> from 01-04-2026, payment one day after the computed date');

        // Plain week offset
        Formulas.Add('<2W>');
        DocDates.Add(DMY2Date(3, 1, 2026));
        PayDates.Add(DMY2Date(17, 1, 2026));
        Expected.Add(true);
        Contexts.Add('<2W> from 03-01-2026, payment on the computed date');

        Formulas.Add('<2W>');
        DocDates.Add(DMY2Date(3, 1, 2026));
        PayDates.Add(DMY2Date(18, 1, 2026));
        Expected.Add(false);
        Contexts.Add('<2W> from 03-01-2026, payment one day after the computed date');

        // Month-end jump, common year
        Formulas.Add('<CM>');
        DocDates.Add(DMY2Date(5, 1, 2026));
        PayDates.Add(DMY2Date(31, 1, 2026));
        Expected.Add(true);
        Contexts.Add('<CM> from 05-01-2026, payment on the computed date');

        Formulas.Add('<CM>');
        DocDates.Add(DMY2Date(5, 1, 2026));
        PayDates.Add(DMY2Date(1, 2, 2026));
        Expected.Add(false);
        Contexts.Add('<CM> from 05-01-2026, payment one day after the computed date');

        // Month-end jump, leap February
        Formulas.Add('<CM>');
        DocDates.Add(DMY2Date(10, 2, 2024));
        PayDates.Add(DMY2Date(29, 2, 2024));
        Expected.Add(true);
        Contexts.Add('<CM> from 10-02-2024, payment on the computed date (leap February)');

        Formulas.Add('<CM>');
        DocDates.Add(DMY2Date(10, 2, 2024));
        PayDates.Add(DMY2Date(1, 3, 2024));
        Expected.Add(false);
        Contexts.Add('<CM> from 10-02-2024, payment one day after the computed date (leap February)');

        // Month step clamping into a common-year February
        Formulas.Add('<1M>');
        DocDates.Add(DMY2Date(31, 1, 2026));
        PayDates.Add(DMY2Date(28, 2, 2026));
        Expected.Add(true);
        Contexts.Add('<1M> from 31-01-2026, payment on the clamped computed date');

        Formulas.Add('<1M>');
        DocDates.Add(DMY2Date(31, 1, 2026));
        PayDates.Add(DMY2Date(1, 3, 2026));
        Expected.Add(false);
        Contexts.Add('<1M> from 31-01-2026, payment one day after the clamped computed date');

        // Month step clamping into a leap-year February
        Formulas.Add('<1M>');
        DocDates.Add(DMY2Date(31, 1, 2024));
        PayDates.Add(DMY2Date(29, 2, 2024));
        Expected.Add(true);
        Contexts.Add('<1M> from 31-01-2024, payment on the clamped computed date (leap February)');

        Formulas.Add('<1M>');
        DocDates.Add(DMY2Date(31, 1, 2024));
        PayDates.Add(DMY2Date(1, 3, 2024));
        Expected.Add(false);
        Contexts.Add('<1M> from 31-01-2024, payment one day after the clamped computed date (leap February)');

        // Year step off a leap day, clamping into a common year
        Formulas.Add('<1Y>');
        DocDates.Add(DMY2Date(29, 2, 2024));
        PayDates.Add(DMY2Date(28, 2, 2025));
        Expected.Add(true);
        Contexts.Add('<1Y> from the leap day 29-02-2024, payment on the clamped computed date');

        Formulas.Add('<1Y>');
        DocDates.Add(DMY2Date(29, 2, 2024));
        PayDates.Add(DMY2Date(1, 3, 2025));
        Expected.Add(false);
        Contexts.Add('<1Y> from the leap day 29-02-2024, payment one day after the clamped computed date');

        // Three chained terms, one order
        Formulas.Add('<CM+1M-10D>');
        DocDates.Add(DMY2Date(18, 4, 2026));
        PayDates.Add(DMY2Date(20, 5, 2026));
        Expected.Add(true);
        Contexts.Add('<CM+1M-10D> from 18-04-2026, payment on the computed date');

        Formulas.Add('<CM+1M-10D>');
        DocDates.Add(DMY2Date(18, 4, 2026));
        PayDates.Add(DMY2Date(21, 5, 2026));
        Expected.Add(false);
        Contexts.Add('<CM+1M-10D> from 18-04-2026, payment one day after the computed date');

        // Same three terms, different order - lands on a different date
        Formulas.Add('<1M-10D+CM>');
        DocDates.Add(DMY2Date(18, 4, 2026));
        PayDates.Add(DMY2Date(31, 5, 2026));
        Expected.Add(true);
        Contexts.Add('<1M-10D+CM> from 18-04-2026, payment on the computed date');

        Formulas.Add('<1M-10D+CM>');
        DocDates.Add(DMY2Date(18, 4, 2026));
        PayDates.Add(DMY2Date(1, 6, 2026));
        Expected.Add(false);
        Contexts.Add('<1M-10D+CM> from 18-04-2026, payment one day after the computed date');

        // Weekday jump, forward, from a date not already on that weekday
        Formulas.Add('<WD5>');
        DocDates.Add(DMY2Date(4, 3, 2026));
        PayDates.Add(DMY2Date(6, 3, 2026));
        Expected.Add(true);
        Contexts.Add('<WD5> from Wednesday 04-03-2026, payment on the computed date');

        Formulas.Add('<WD5>');
        DocDates.Add(DMY2Date(4, 3, 2026));
        PayDates.Add(DMY2Date(7, 3, 2026));
        Expected.Add(false);
        Contexts.Add('<WD5> from Wednesday 04-03-2026, payment one day after the computed date');

        // Weekday jump, forward, from a date already on that weekday (moves a full week)
        Formulas.Add('<WD5>');
        DocDates.Add(DMY2Date(6, 3, 2026));
        PayDates.Add(DMY2Date(13, 3, 2026));
        Expected.Add(true);
        Contexts.Add('<WD5> from Friday 06-03-2026, payment on the computed date');

        Formulas.Add('<WD5>');
        DocDates.Add(DMY2Date(6, 3, 2026));
        PayDates.Add(DMY2Date(14, 3, 2026));
        Expected.Add(false);
        Contexts.Add('<WD5> from Friday 06-03-2026, payment one day after the computed date');

        // Weekday jump, backward
        Formulas.Add('<-WD2>');
        DocDates.Add(DMY2Date(10, 3, 2026));
        PayDates.Add(DMY2Date(3, 3, 2026));
        Expected.Add(true);
        Contexts.Add('<-WD2> from Tuesday 10-03-2026, payment on the computed date');

        Formulas.Add('<-WD2>');
        DocDates.Add(DMY2Date(10, 3, 2026));
        PayDates.Add(DMY2Date(4, 3, 2026));
        Expected.Add(false);
        Contexts.Add('<-WD2> from Tuesday 10-03-2026, payment one day after the computed date');

        for Idx := 1 to Formulas.Count() do begin
            Terms.Get('SWEEP');
            Evaluate(DiscountFormula, Formulas.Get(Idx));
            Terms."Discount Date Calculation" := DiscountFormula;
            Terms.Modify();

            Actual := Calculator.QualifiesForDiscount('SWEEP', DocDates.Get(Idx), PayDates.Get(Idx));

            Assert.AreEqual(Expected.Get(Idx), Actual, StrSubstNo('%1: expected qualifies=%2, got %3', Contexts.Get(Idx), Format(Expected.Get(Idx)), Format(Actual)));
        end;
    end;
}
