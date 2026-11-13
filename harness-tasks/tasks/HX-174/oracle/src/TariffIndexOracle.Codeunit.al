codeunit 88570 "HX174 Tariff Index Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        TariffIndexation: Codeunit "CGR Tariff Indexation";

    [Test]
    procedure RaiseStopsAtCeiling()
    begin
        ResetHX174Tariffs();
        AddHX174Tariff('HX174-A1', 190);
        AddHX174Tariff('HX174-A2', 200);
        AddHX174Tariff('HX174-A3', 250);

        Assert.AreEqual(1, TariffIndexation.IndexDailyRates(10, 200), 'Only the tariff below the ceiling is raised');

        AssertHX174Rate('HX174-A1', 200, 'A raise above the ceiling stops at the ceiling');
        AssertHX174Rate('HX174-A2', 200, 'A tariff at the ceiling keeps its rate');
        AssertHX174Rate('HX174-A3', 250, 'A tariff above the ceiling keeps its rate');
        AssertHX174EntryCount(1);
        AssertHX174Entry(1, 'HX174-A1', 190, 200);
    end;

    [Test]
    procedure EveryTariffRaisedOnce()
    begin
        ResetHX174Tariffs();
        AddHX174Tariff('HX174-B1', 100);
        AddHX174Tariff('HX174-B2', 101);
        AddHX174Tariff('HX174-B3', 102.03);

        Assert.AreEqual(3, TariffIndexation.IndexDailyRates(10, 200), 'Every tariff below the ceiling is raised and counted once');

        AssertHX174Rate('HX174-B1', 110, 'B1 is raised once by 10 percent');
        AssertHX174Rate('HX174-B2', 111.1, 'B2 is raised once by 10 percent');
        AssertHX174Rate('HX174-B3', 112.23, 'B3 is raised once by 10 percent, rounded to the amount precision');
        AssertHX174EntryCount(3);
    end;

    [Test]
    procedure EntriesFollowOldRates()
    begin
        ResetHX174Tariffs();
        AddHX174Tariff('HX174-C1', 120);
        AddHX174Tariff('HX174-C2', 110);
        AddHX174Tariff('HX174-C3', 100);

        Assert.AreEqual(3, TariffIndexation.IndexDailyRates(10, 200), 'Three tariffs are raised');

        AssertHX174EntryCount(3);
        AssertHX174Entry(1, 'HX174-C3', 100, 110);
        AssertHX174Entry(2, 'HX174-C2', 110, 121);
        AssertHX174Entry(3, 'HX174-C1', 120, 132);
        AssertHX174Rate('HX174-C1', 132, 'C1 is raised once');
        AssertHX174Rate('HX174-C2', 121, 'C2 is raised once');
        AssertHX174Rate('HX174-C3', 110, 'C3 is raised once');
    end;

    [Test]
    procedure CeilingTariffsKeepRates()
    begin
        ResetHX174Tariffs();
        AddHX174Tariff('HX174-D1', 200);
        AddHX174Tariff('HX174-D2', 250);

        Assert.AreEqual(0, TariffIndexation.IndexDailyRates(10, 200), 'No tariff is below the ceiling');

        AssertHX174Rate('HX174-D1', 200, 'A tariff at the ceiling keeps its rate');
        AssertHX174Rate('HX174-D2', 250, 'A tariff above the ceiling keeps its rate');
        AssertHX174EntryCount(0);
    end;

    local procedure ResetHX174Tariffs()
    var
        Setup: Record "CGR Setup";
        Tariff: Record "CGR Rental Tariff";
        IndexEntry: Record "CGR Tariff Index Entry";
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20240301D);
        Setup.GetOrCreate();
        Setup."Amount Rounding Precision" := 0.01;
        Setup.Modify();
        SessionContext.Reset();
        IndexEntry.DeleteAll();
        Tariff.DeleteAll();
    end;

    local procedure AddHX174Tariff(TariffCode: Code[20]; DailyRate: Decimal)
    var
        Tariff: Record "CGR Rental Tariff";
    begin
        Tariff.Init();
        Tariff.Code := TariffCode;
        Tariff.Description := 'HX174 ' + TariffCode;
        Tariff."Daily Rate" := DailyRate;
        Tariff.Insert();
    end;

    local procedure AssertHX174Rate(TariffCode: Code[20]; Expected: Decimal; What: Text)
    var
        Tariff: Record "CGR Rental Tariff";
    begin
        Tariff.Get(TariffCode);
        Assert.AreEqual(Expected, Tariff."Daily Rate", What);
    end;

    local procedure AssertHX174EntryCount(Expected: Integer)
    var
        IndexEntry: Record "CGR Tariff Index Entry";
    begin
        Assert.AreEqual(Expected, IndexEntry.Count(), 'One index entry per raised tariff');
    end;

    local procedure AssertHX174Entry(Position: Integer; TariffCode: Code[20]; OldRate: Decimal; NewRate: Decimal)
    var
        IndexEntry: Record "CGR Tariff Index Entry";
        Index: Integer;
    begin
        IndexEntry.SetCurrentKey("Entry No.");
        Assert.IsTrue(IndexEntry.FindSet(), 'The run wrote index entries');
        for Index := 2 to Position do
            Assert.AreEqual(1, IndexEntry.Next(), 'Index entry ' + Format(Index) + ' exists');
        Assert.AreEqual(TariffCode, IndexEntry."Tariff Code", 'Index entry ' + Format(Position) + ': tariff');
        Assert.AreEqual(OldRate, IndexEntry."Old Rate", 'Index entry ' + Format(Position) + ': old rate');
        Assert.AreEqual(NewRate, IndexEntry."New Rate", 'Index entry ' + Format(Position) + ': new rate');
    end;
}
