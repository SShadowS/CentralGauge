codeunit 89358 "CG-AL-X138 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    // The reference-normalization cases are driven from a table of
    // (raw, expected) pairs rather than one named test each - the pairs ARE
    // the spec, and a failing sweep discloses one case rather than the whole
    // rule (decisions entry 21).

    var
        Assert: Codeunit Assert;

    local procedure ClearFixture()
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
    local procedure CaseCount(): Integer
    begin
        exit(12);
    end;

    local procedure CaseRaw(Index: Integer): Text[100]
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

    local procedure CaseExpected(Index: Integer): Code[20]
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
        ClearFixture();

        for Index := 1 to CaseCount() do
            Assert.AreEqual(CaseExpected(Index), Matcher.PreviewMatchKey(CaseRaw(Index)),
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
        ClearFixture();

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
        ClearFixture();
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
        ClearFixture();
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
        ClearFixture();
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
        ClearFixture();
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
        ClearFixture();

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
        ClearFixture();
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
        ClearFixture();
        Matcher.ImportInboundDoc('DOC-070', 'INV-2024-070', 100);

        Matcher.TryMatchIncoming('inv 2024 070');
        Matcher.TryMatchIncoming('INV-2024-071');
        Matcher.TryMatchIncoming('inv/2024/070');

        Assert.AreEqual(3, MatchLog.Count(), 'Expected one log entry per match attempt');
        MatchLog.FindLast();
        Assert.AreEqual('inv/2024/070', MatchLog."Incoming Ref",
            'Expected the most recent log entry to describe the most recent attempt');
    end;
}
