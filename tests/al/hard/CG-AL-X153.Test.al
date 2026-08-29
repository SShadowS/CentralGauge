codeunit 89373 "CG-AL-X153 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods (see
    // tests/al/hard/CG-AL-X065.Test.al for the same note), so every test
    // clears the table before seeding its own rows.

    local procedure ClearAllServiceCalls()
    var
        ServiceCall: Record "CG X153 Service Call";
    begin
        ServiceCall.DeleteAll();
    end;

    local procedure SeedCall(SiteCode: Code[20]; TechnicianCode: Code[20])
    var
        ServiceCall: Record "CG X153 Service Call";
    begin
        ServiceCall.Init();
        ServiceCall."Site Code" := SiteCode;
        ServiceCall."Technician Code" := TechnicianCode;
        ServiceCall.Insert(true);
    end;

    local procedure InvalidateDataCache()
    var
        DecoyCall: Record "CG X153 Service Call";
    begin
        // The seeding above leaves the table's result sets in the server data
        // cache, and a cached read costs zero SQL - the graded call would
        // measure nothing. A write bumps the table's version and forces real
        // reads again; the decoy row belongs to a site no graded call asks
        // about.
        DecoyCall.Init();
        DecoyCall."Site Code" := 'Z-DECOY-SITE';
        DecoyCall."Technician Code" := 'Z-DECOY-TECH';
        DecoyCall.Insert(true);
        SelectLatestVersion();
    end;

    local procedure MaxRows(): Integer
    begin
        exit(300);
    end;

    local procedure TechCode(Seq: Integer): Code[20]
    var
        Digits: Text;
    begin
        Digits := Format(Seq);
        while StrLen(Digits) < 3 do
            Digits := '0' + Digits;
        exit('TCH-' + Digits);
    end;

    [Test]
    procedure DistinctListCollapsesRepeatsAndKeepsSingletons()
    var
        TechnicianDirectory: Codeunit "CG X153 Technician Directory";
        TechnicianCodes: List of [Code[20]];
    begin
        ClearAllServiceCalls();
        SeedCall('BASIC-1', 'TCH-A');
        SeedCall('BASIC-1', 'TCH-B');
        SeedCall('BASIC-1', 'TCH-B');
        SeedCall('BASIC-1', 'TCH-B');
        SeedCall('BASIC-1', 'TCH-B');
        SeedCall('BASIC-1', 'TCH-B');
        SeedCall('BASIC-1', 'TCH-C');

        TechnicianDirectory.GetTechnicianCodes('BASIC-1', TechnicianCodes);

        Assert.AreEqual(3, TechnicianCodes.Count(),
            'Expected exactly 3 technicians: one who worked a single call and one who worked five must each be listed exactly once, not once per call');
        Assert.IsTrue(TechnicianCodes.Contains('TCH-A'),
            'Expected the technician with a single logged call to still appear in the list');
        Assert.IsTrue(TechnicianCodes.Contains('TCH-B'),
            'Expected the technician with five logged calls to appear in the list exactly once, not five times');
        Assert.IsTrue(TechnicianCodes.Contains('TCH-C'),
            'Expected the technician with a single logged call to still appear in the list');
    end;

    [Test]
    procedure BlankTechnicianCodeIsIgnored()
    var
        TechnicianDirectory: Codeunit "CG X153 Technician Directory";
        TechnicianCodes: List of [Code[20]];
    begin
        ClearAllServiceCalls();
        SeedCall('BLANK-1', 'TCH-X');
        SeedCall('BLANK-1', '');
        SeedCall('BLANK-1', '');
        SeedCall('BLANK-1', 'TCH-Y');
        SeedCall('BLANK-1', '');

        TechnicianDirectory.GetTechnicianCodes('BLANK-1', TechnicianCodes);

        Assert.AreEqual(2, TechnicianCodes.Count(),
            StrSubstNo('Expected exactly 2 technicians, ignoring the malformed calls with no technician recorded - got %1', TechnicianCodes.Count()));
        Assert.IsTrue(TechnicianCodes.Contains('TCH-X'), 'Expected the properly recorded technician TCH-X to appear');
        Assert.IsTrue(TechnicianCodes.Contains('TCH-Y'), 'Expected the properly recorded technician TCH-Y to appear');
        Assert.IsFalse(TechnicianCodes.Contains(''), 'Expected the malformed calls with no technician recorded to never produce a blank entry in the list');
    end;

    [Test]
    procedure ResultComesBackSortedAscending()
    var
        TechnicianDirectory: Codeunit "CG X153 Technician Directory";
        TechnicianCodes: List of [Code[20]];
    begin
        ClearAllServiceCalls();
        // Inserted in an order hostile to "first seen": the technician who
        // sorts first is logged last.
        SeedCall('SORT-1', 'TCH-Z');
        SeedCall('SORT-1', 'TCH-M');
        SeedCall('SORT-1', 'TCH-B');
        SeedCall('SORT-1', 'TCH-A');

        TechnicianDirectory.GetTechnicianCodes('SORT-1', TechnicianCodes);

        Assert.AreEqual(4, TechnicianCodes.Count(), 'Expected all 4 technicians to be present before judging their order');
        Assert.AreEqual('TCH-A', TechnicianCodes.Get(1), 'Expected the list sorted ascending - TCH-A first');
        Assert.AreEqual('TCH-B', TechnicianCodes.Get(2), 'Expected the list sorted ascending - TCH-B second');
        Assert.AreEqual('TCH-M', TechnicianCodes.Get(3), 'Expected the list sorted ascending - TCH-M third');
        Assert.AreEqual('TCH-Z', TechnicianCodes.Get(4), 'Expected the list sorted ascending - TCH-Z last, even though it was logged first');
    end;

    [Test]
    procedure ListArgumentIsDiscardedAndRebuilt()
    var
        TechnicianDirectory: Codeunit "CG X153 Technician Directory";
        TechnicianCodes: List of [Code[20]];
    begin
        ClearAllServiceCalls();
        SeedCall('RESET-1', 'TCH-R');

        TechnicianCodes.Add('LEFTOVER-1');
        TechnicianCodes.Add('LEFTOVER-2');

        TechnicianDirectory.GetTechnicianCodes('RESET-1', TechnicianCodes);

        Assert.AreEqual(1, TechnicianCodes.Count(),
            StrSubstNo('Expected whatever the list held before the call to be discarded and the list rebuilt from scratch - got %1 entries', TechnicianCodes.Count()));
        Assert.AreEqual('TCH-R', TechnicianCodes.Get(1), 'Expected only the real technician to remain after the call rebuilds the list');
        Assert.IsFalse(TechnicianCodes.Contains('LEFTOVER-1'), 'Expected the pre-existing entry to be discarded, not merged into the rebuilt list');
        Assert.IsFalse(TechnicianCodes.Contains('LEFTOVER-2'), 'Expected the pre-existing entry to be discarded, not merged into the rebuilt list');
    end;

    [Test]
    procedure EmptyTableReturnsEmptyListWithoutError()
    var
        TechnicianDirectory: Codeunit "CG X153 Technician Directory";
        TechnicianCodes: List of [Code[20]];
    begin
        ClearAllServiceCalls();

        TechnicianDirectory.GetTechnicianCodes('EMPTY-1', TechnicianCodes);

        Assert.AreEqual(0, TechnicianCodes.Count(), 'Expected an empty list, and no error, when there is no call history at all');
    end;

    [Test]
    procedure ASecondSitesCallsAreNeitherReadNorListed()
    var
        TechnicianDirectory: Codeunit "CG X153 Technician Directory";
        OtherSiteCall: Record "CG X153 Service Call";
        TechnicianCodes: List of [Code[20]];
    begin
        ClearAllServiceCalls();
        SeedCall('ISO-A', 'TCH-1');
        SeedCall('ISO-A', 'TCH-2');
        SeedCall('ISO-B', 'TCH-2');
        SeedCall('ISO-B', 'TCH-9');

        TechnicianDirectory.GetTechnicianCodes('ISO-A', TechnicianCodes);

        Assert.AreEqual(2, TechnicianCodes.Count(),
            StrSubstNo('Expected exactly the 2 technicians who worked site ISO-A - got %1', TechnicianCodes.Count()));
        Assert.IsTrue(TechnicianCodes.Contains('TCH-1'), 'Expected TCH-1, who only worked site ISO-A, to appear');
        Assert.IsTrue(TechnicianCodes.Contains('TCH-2'), 'Expected TCH-2, who worked both sites, to appear for site ISO-A');
        Assert.IsFalse(TechnicianCodes.Contains('TCH-9'), 'Expected TCH-9, who only ever worked the other site, to never appear in ISO-A''s list');

        OtherSiteCall.SetRange("Site Code", 'ISO-B');
        Assert.AreEqual(2, OtherSiteCall.Count(),
            'Expected the other site''s own call history to be completely untouched by building this site''s technician list');
        OtherSiteCall.SetRange("Technician Code", 'TCH-9');
        Assert.IsTrue(OtherSiteCall.FindFirst(),
            'Expected the other site''s call for its own technician to still exist, unaffected by building a different site''s technician list');
    end;

    [Test]
    procedure RepeatedCallReflectsATechnicianAddedSinceTheLastCall()
    var
        TechnicianDirectory: Codeunit "CG X153 Technician Directory";
        TechnicianCodes: List of [Code[20]];
    begin
        ClearAllServiceCalls();
        SeedCall('FRESH-1', 'TCH-F1');

        TechnicianDirectory.GetTechnicianCodes('FRESH-1', TechnicianCodes);
        Assert.AreEqual(1, TechnicianCodes.Count(), 'Expected exactly the one technician logged so far');
        Assert.IsTrue(TechnicianCodes.Contains('TCH-F1'), 'Expected the technician logged so far to appear');

        SeedCall('FRESH-1', 'TCH-F2');

        TechnicianDirectory.GetTechnicianCodes('FRESH-1', TechnicianCodes);
        Assert.AreEqual(2, TechnicianCodes.Count(),
            'Expected the same check, asked again after a new technician logged a call, to reflect that call rather than repeat its earlier answer');
        Assert.IsTrue(TechnicianCodes.Contains('TCH-F1'), 'Expected the earlier technician to still appear on the repeated call');
        Assert.IsTrue(TechnicianCodes.Contains('TCH-F2'), 'Expected the technician added since the last call to appear on the repeated call');
    end;

    [Test]
    procedure TechnicianListCostsTheSameRegardlessOfCallHistoryVolume()
    var
        TechnicianDirectory: Codeunit "CG X153 Technician Directory";
        TechnicianCodes: List of [Code[20]];
        RowsBefore: BigInteger;
        RowsUsed: BigInteger;
        DistinctCount: Integer;
        CallsPerTechnician: Integer;
        i: Integer;
        j: Integer;
    begin
        ClearAllServiceCalls();

        // Warm up on an unrelated site first, and only seed the graded
        // site's call history afterward - the graded call must answer a
        // question this codeunit instance has never been asked before, not
        // repeat an answer it already computed.
        SeedCall('WARM-1', 'TCH-W1');
        SeedCall('WARM-1', 'TCH-W2');
        TechnicianDirectory.GetTechnicianCodes('WARM-1', TechnicianCodes);
        ClearAllServiceCalls();

        DistinctCount := 20;
        CallsPerTechnician := 200;
        for i := 1 to DistinctCount do
            for j := 1 to CallsPerTechnician do
                SeedCall('MAIN-1', TechCode(i));

        InvalidateDataCache();
        RowsBefore := SessionInformation.SqlRowsRead();
        TechnicianDirectory.GetTechnicianCodes('MAIN-1', TechnicianCodes);
        RowsUsed := SessionInformation.SqlRowsRead() - RowsBefore;

        Assert.AreEqual(DistinctCount, TechnicianCodes.Count(),
            StrSubstNo('Expected the exact technician list before judging its cost - cheap must not mean wrong - got %1', TechnicianCodes.Count()));
        Assert.AreEqual(TechCode(1), TechnicianCodes.Get(1), 'Expected the first technician in sorted order to be correct at volume');
        Assert.AreEqual(TechCode(DistinctCount), TechnicianCodes.Get(DistinctCount), 'Expected the last technician in sorted order to be correct at volume');
        Assert.IsTrue(RowsUsed <= MaxRows(),
            StrSubstNo('Expected building the technician list to cost about the same no matter how much call history the site holds: budget %1, actual %2 against %3 calls across %4 technicians', MaxRows(), RowsUsed, DistinctCount * CallsPerTechnician, DistinctCount));
    end;

    [Test]
    procedure TechnicianListCostsTheSameAtADifferentVolumeToo()
    var
        TechnicianDirectory: Codeunit "CG X153 Technician Directory";
        TechnicianCodes: List of [Code[20]];
        RowsBefore: BigInteger;
        RowsUsed: BigInteger;
        DistinctCount: Integer;
        CallsPerTechnician: Integer;
        i: Integer;
        j: Integer;
    begin
        ClearAllServiceCalls();

        // Warm up on an unrelated site first, and only seed the graded
        // site's call history afterward - same reasoning as the sibling
        // volume test, at a different distinct-technician count and a
        // different call volume, so a fix tuned to one specific size cannot
        // pass by coincidence.
        SeedCall('WARM-2', 'TCH-W3');
        TechnicianDirectory.GetTechnicianCodes('WARM-2', TechnicianCodes);
        ClearAllServiceCalls();

        DistinctCount := 25;
        CallsPerTechnician := 150;
        for i := 1 to DistinctCount do
            for j := 1 to CallsPerTechnician do
                SeedCall('MAIN-2', TechCode(i));

        InvalidateDataCache();
        RowsBefore := SessionInformation.SqlRowsRead();
        TechnicianDirectory.GetTechnicianCodes('MAIN-2', TechnicianCodes);
        RowsUsed := SessionInformation.SqlRowsRead() - RowsBefore;

        Assert.AreEqual(DistinctCount, TechnicianCodes.Count(),
            StrSubstNo('Expected the exact technician list before judging its cost - cheap must not mean wrong - got %1', TechnicianCodes.Count()));
        Assert.IsTrue(RowsUsed <= MaxRows(),
            StrSubstNo('Expected building the technician list to cost about the same no matter how much call history the site holds: budget %1, actual %2 against %3 calls across %4 technicians', MaxRows(), RowsUsed, DistinctCount * CallsPerTechnician, DistinctCount));
    end;
}
