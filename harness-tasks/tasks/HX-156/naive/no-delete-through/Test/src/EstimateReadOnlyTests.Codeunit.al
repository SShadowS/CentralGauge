codeunit 80634 "CGR Estimate Read Only Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        ReadOnlySession: Codeunit "CGR Repair Estimate Session";

    [Test]
    procedure TwoLinesAreHandedOver()
    var
        Lines: Record "CGR Repair Estimate Line" temporary;
    begin
        ReadOnlySession.Reset();
        Assert.AreEqual(1, ReadOnlySession.AddEstimateLine('HX156-N2A', 'Brakes', 100), 'First Line No.');
        Assert.AreEqual(2, ReadOnlySession.AddEstimateLine('HX156-N2A', 'Tyres', 20), 'Second Line No.');
        ReadOnlySession.GetEstimateLines(Lines);
        Assert.AreEqual(2, Lines.Count(), 'Both lines handed over');
        Assert.AreEqual(120, ReadOnlySession.Total('HX156-N2A'), 'Total');
    end;

    [Test]
    procedure HandedLineCarriesWorkDate()
    var
        Lines: Record "CGR Repair Estimate Line" temporary;
    begin
        ReadOnlySession.Reset();
        WorkDate(20260115D);
        ReadOnlySession.AddEstimateLine('HX156-N2B', 'Brakes', 100);
        ReadOnlySession.GetEstimateLines(Lines);
        Lines.FindFirst();
        Assert.AreEqual(20260115D, Lines."Created On", 'Work date');
    end;

    [Test]
    procedure TwoLinesApplied()
    var
        Approved: Record "CGR Repair Estimate Line";
    begin
        ReadOnlySession.Reset();
        Approved.SetRange("Vehicle No.", 'HX156-N2C');
        Approved.DeleteAll();
        Lib.CreateVehicle('HX156-N2C', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Commit();
        ReadOnlySession.AddEstimateLine('HX156-N2C', 'Brakes', 100);
        ReadOnlySession.AddEstimateLine('HX156-N2C', 'Tyres', 20);
        Assert.IsTrue(ReadOnlySession.Apply('HX156-N2C'), 'Applied');
        Assert.AreEqual(2, Approved.Count(), 'Two approved rows');
        Assert.AreEqual(0, ReadOnlySession.Total('HX156-N2C'), 'Session empty');
    end;

    [Test]
    procedure TwoLinesRefused()
    var
        Approved: Record "CGR Repair Estimate Line";
        Spy: Codeunit "CGR Estimate Read Only Spy";
    begin
        ReadOnlySession.Reset();
        Approved.SetRange("Vehicle No.", 'HX156-N2D');
        Approved.DeleteAll();
        Lib.CreateVehicle('HX156-N2D', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Commit();
        ReadOnlySession.AddEstimateLine('HX156-N2D', 'Brakes', 100);
        ReadOnlySession.AddEstimateLine('HX156-N2D', 'Tyres', 20);
        Spy.RefuseReadOnlyEstimate('HX156-N2D');
        BindSubscription(Spy);
        Assert.IsFalse(ReadOnlySession.Apply('HX156-N2D'), 'Refused');
        UnbindSubscription(Spy);
        Assert.AreEqual(0, Approved.Count(), 'Nothing approved');
        Assert.AreEqual(120, ReadOnlySession.Total('HX156-N2D'), 'Estimate kept');
    end;
}
