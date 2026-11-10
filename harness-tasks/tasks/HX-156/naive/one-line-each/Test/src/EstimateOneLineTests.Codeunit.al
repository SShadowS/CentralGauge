codeunit 80632 "CGR Estimate One Line Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        OneLineSession: Codeunit "CGR Repair Estimate Session";

    [Test]
    procedure SingleLineTotal()
    begin
        OneLineSession.Reset();
        Assert.AreEqual(1, OneLineSession.AddEstimateLine('HX156-N1A', 'Brakes', 100), 'Line No.');
        Assert.AreEqual(100, OneLineSession.Total('HX156-N1A'), 'Total');
    end;

    [Test]
    procedure SingleLineDeletedThroughRecord()
    var
        Lines: Record "CGR Repair Estimate Line" temporary;
        Again: Record "CGR Repair Estimate Line" temporary;
    begin
        OneLineSession.Reset();
        OneLineSession.AddEstimateLine('HX156-N1B', 'Brakes', 100);
        OneLineSession.GetEstimateLines(Lines);
        Lines.FindFirst();
        Lines.Delete();
        OneLineSession.GetEstimateLines(Again);
        Assert.AreEqual(0, Again.Count(), 'Deleted line is gone');
    end;

    [Test]
    procedure SingleLineGetsWorkDate()
    var
        Lines: Record "CGR Repair Estimate Line" temporary;
    begin
        OneLineSession.Reset();
        WorkDate(20260115D);
        OneLineSession.AddEstimateLine('HX156-N1C', 'Brakes', 100);
        OneLineSession.GetEstimateLines(Lines);
        Lines.FindFirst();
        Assert.AreEqual(20260115D, Lines."Created On", 'Work date');
    end;

    [Test]
    procedure SingleLineApplied()
    var
        Approved: Record "CGR Repair Estimate Line";
    begin
        OneLineSession.Reset();
        Approved.SetRange("Vehicle No.", 'HX156-N1D');
        Approved.DeleteAll();
        Lib.CreateVehicle('HX156-N1D', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Commit();
        OneLineSession.AddEstimateLine('HX156-N1D', 'Brakes', 100);
        Assert.IsTrue(OneLineSession.Apply('HX156-N1D'), 'Applied');
        Assert.AreEqual(1, Approved.Count(), 'One approved row');
        Assert.AreEqual(0, OneLineSession.Total('HX156-N1D'), 'Session empty');
    end;

    [Test]
    procedure SingleLineRefused()
    var
        Approved: Record "CGR Repair Estimate Line";
        Spy: Codeunit "CGR Estimate One Line Spy";
    begin
        OneLineSession.Reset();
        Approved.SetRange("Vehicle No.", 'HX156-N1E');
        Approved.DeleteAll();
        Lib.CreateVehicle('HX156-N1E', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Commit();
        OneLineSession.AddEstimateLine('HX156-N1E', 'Brakes', 100);
        Spy.RefuseOneLineEstimate('HX156-N1E');
        BindSubscription(Spy);
        Assert.IsFalse(OneLineSession.Apply('HX156-N1E'), 'Refused');
        UnbindSubscription(Spy);
        Assert.AreEqual(0, Approved.Count(), 'Nothing approved');
        Assert.AreEqual(100, OneLineSession.Total('HX156-N1E'), 'Estimate kept');
    end;
}
