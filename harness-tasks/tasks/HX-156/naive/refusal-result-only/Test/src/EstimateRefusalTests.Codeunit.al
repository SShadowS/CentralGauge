codeunit 80636 "CGR Estimate Refusal Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        ResultOnlySession: Codeunit "CGR Repair Estimate Session";

    [Test]
    procedure TwoLinesAddUp()
    var
        Lines: Record "CGR Repair Estimate Line" temporary;
    begin
        ResultOnlySession.Reset();
        ResultOnlySession.AddEstimateLine('HX156-N3A', 'Brakes', 100);
        ResultOnlySession.AddEstimateLine('HX156-N3A', 'Tyres', 20);
        ResultOnlySession.GetEstimateLines(Lines);
        Assert.AreEqual(2, Lines.Count(), 'Both lines');
        Assert.AreEqual(120, ResultOnlySession.Total('HX156-N3A'), 'Total');
    end;

    [Test]
    procedure DeletedLineLeavesTheSession()
    var
        Lines: Record "CGR Repair Estimate Line" temporary;
    begin
        ResultOnlySession.Reset();
        ResultOnlySession.AddEstimateLine('HX156-N3B', 'Brakes', 100);
        ResultOnlySession.AddEstimateLine('HX156-N3B', 'Tyres', 20);
        ResultOnlySession.GetEstimateLines(Lines);
        Lines.SetRange("Line No.", 1);
        Lines.FindFirst();
        Lines.Delete();
        Assert.AreEqual(20, ResultOnlySession.Total('HX156-N3B'), 'Deleted line left the total');
    end;

    [Test]
    procedure AddedLineCarriesWorkDate()
    var
        Lines: Record "CGR Repair Estimate Line" temporary;
    begin
        ResultOnlySession.Reset();
        WorkDate(20260115D);
        ResultOnlySession.AddEstimateLine('HX156-N3C', 'Brakes', 100);
        ResultOnlySession.GetEstimateLines(Lines);
        Lines.FindFirst();
        Assert.AreEqual(20260115D, Lines."Created On", 'Work date');
    end;

    [Test]
    procedure AppliedEstimateIsStored()
    var
        Approved: Record "CGR Repair Estimate Line";
    begin
        ResultOnlySession.Reset();
        Approved.SetRange("Vehicle No.", 'HX156-N3D');
        Approved.DeleteAll();
        Lib.CreateVehicle('HX156-N3D', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Commit();
        ResultOnlySession.AddEstimateLine('HX156-N3D', 'Brakes', 100);
        ResultOnlySession.AddEstimateLine('HX156-N3D', 'Tyres', 20);
        Assert.IsTrue(ResultOnlySession.Apply('HX156-N3D'), 'Applied');
        Assert.AreEqual(2, Approved.Count(), 'Two approved rows');
        Assert.AreEqual(0, ResultOnlySession.Total('HX156-N3D'), 'Session empty');
    end;

    [Test]
    procedure RefusedEstimateReturnsFalse()
    var
        Approved: Record "CGR Repair Estimate Line";
        Spy: Codeunit "CGR Estimate Refusal Spy";
    begin
        ResultOnlySession.Reset();
        Approved.SetRange("Vehicle No.", 'HX156-N3E');
        Approved.DeleteAll();
        Lib.CreateVehicle('HX156-N3E', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Commit();
        ResultOnlySession.AddEstimateLine('HX156-N3E', 'Brakes', 100);
        ResultOnlySession.AddEstimateLine('HX156-N3E', 'Tyres', 20);
        Spy.RefuseResultOnlyEstimate('HX156-N3E');
        BindSubscription(Spy);
        Assert.IsFalse(ResultOnlySession.Apply('HX156-N3E'), 'Refused');
        UnbindSubscription(Spy);
        Assert.AreEqual(0, Approved.Count(), 'Nothing approved');
    end;
}
