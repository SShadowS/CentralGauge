codeunit 80630 "CGR Estimate Session Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        EstimateSession: Codeunit "CGR Repair Estimate Session";

    [Test]
    procedure LineNumbersRunPerVehicleAndNothingIsStored()
    begin
        EstimateSession.Reset();
        ClearApproved('HX156-A1');
        ClearApproved('HX156-A2');

        Assert.AreEqual(1, EstimateSession.AddEstimateLine('HX156-A1', 'Brakes', 100), 'First line of vehicle A1');
        Assert.AreEqual(2, EstimateSession.AddEstimateLine('HX156-A1', 'Tyres', 20), 'Second line of vehicle A1');
        Assert.AreEqual(1, EstimateSession.AddEstimateLine('HX156-A2', 'Glass', 7), 'First line of vehicle A2');
        Assert.AreEqual(3, EstimateSession.AddEstimateLine('HX156-A1', 'Oil', 3), 'Third line of vehicle A1');

        Assert.AreEqual(0, ApprovedCount('HX156-A1'), 'Nothing is stored while building');
        Assert.AreEqual(0, ApprovedCount('HX156-A2'), 'Nothing is stored while building');
    end;

    [Test]
    procedure EveryLineAddedStaysOnTheEstimate()
    var
        Lines: Record "CGR Repair Estimate Line" temporary;
    begin
        EstimateSession.Reset();
        EstimateSession.AddEstimateLine('HX156-B1', 'Brakes', 100);
        EstimateSession.AddEstimateLine('HX156-B1', 'Tyres', 20);

        EstimateSession.GetEstimateLines(Lines);

        Lines.SetRange("Vehicle No.", 'HX156-B1');
        Assert.AreEqual(2, Lines.Count(), 'Both lines are on the estimate');
        Lines.SetRange("Line No.", 1);
        Lines.FindFirst();
        Assert.AreEqual(100, Lines.Amount, 'The first line keeps its amount');
        Lines.SetRange("Line No.", 2);
        Lines.FindFirst();
        Assert.AreEqual(20, Lines.Amount, 'The second line keeps its amount');
    end;

    [Test]
    procedure NewLineGetsTheWorkDate()
    var
        Lines: Record "CGR Repair Estimate Line" temporary;
    begin
        EstimateSession.Reset();
        WorkDate(20260115D);
        EstimateSession.AddEstimateLine('HX156-C1', 'Brakes', 100);

        EstimateSession.GetEstimateLines(Lines);

        Lines.FindFirst();
        Assert.AreEqual(20260115D, Lines."Created On", 'A new line gets the work date');
    end;

    [Test]
    procedure TotalIsTheSessionLinesOfThatVehicleOnly()
    var
        Approved: Record "CGR Repair Estimate Line";
    begin
        EstimateSession.Reset();
        ClearApproved('HX156-D1');
        Approved.Init();
        Approved."Entry No." := 0;
        Approved."Vehicle No." := 'HX156-D1';
        Approved."Line No." := 1;
        Approved.Amount := 999;
        Approved.Insert(true);
        EstimateSession.AddEstimateLine('HX156-D1', 'Brakes', 100);
        EstimateSession.AddEstimateLine('HX156-D1', 'Tyres', 20);
        EstimateSession.AddEstimateLine('HX156-D2', 'Glass', 7);

        Assert.AreEqual(120, EstimateSession.Total('HX156-D1'), 'Only the session lines of the vehicle count');
        Assert.AreEqual(7, EstimateSession.Total('HX156-D2'), 'The other vehicle has its own total');
    end;

    [Test]
    procedure LineDeletedThroughTheHandedRecordIsGone()
    var
        Lines: Record "CGR Repair Estimate Line" temporary;
    begin
        EstimateSession.Reset();
        EstimateSession.AddEstimateLine('HX156-E1', 'Brakes', 100);
        EstimateSession.AddEstimateLine('HX156-E1', 'Tyres', 20);
        EstimateSession.GetEstimateLines(Lines);
        Lines.SetRange("Line No.", 1);
        Lines.FindFirst();

        Lines.Delete();

        Assert.AreEqual(1, SessionLineCount('HX156-E1'), 'The deleted line is gone from the estimate');
        Assert.AreEqual(20, EstimateSession.Total('HX156-E1'), 'The total no longer holds the deleted line');
    end;

    [Test]
    procedure ApplyStoresTheLinesAndEmptiesTheSessionForThatVehicle()
    var
        Approved: Record "CGR Repair Estimate Line";
    begin
        EstimateSession.Reset();
        NewVehicle('HX156-F1');
        Commit();
        EstimateSession.AddEstimateLine('HX156-F1', 'Brakes', 100);
        EstimateSession.AddEstimateLine('HX156-F1', 'Tyres', 20);
        EstimateSession.AddEstimateLine('HX156-F2', 'Glass', 7);

        Assert.IsTrue(EstimateSession.Apply('HX156-F1'), 'Apply returns true');

        Approved.SetRange("Vehicle No.", 'HX156-F1');
        Assert.AreEqual(2, Approved.Count(), 'One approved row per line');
        Approved.SetRange("Line No.", 1);
        Approved.FindFirst();
        Assert.AreEqual(100, Approved.Amount, 'Line 1 is stored with its amount');
        Approved.SetRange("Line No.", 2);
        Approved.FindFirst();
        Assert.AreEqual(20, Approved.Amount, 'Line 2 is stored with its amount');
        Assert.AreEqual(0, EstimateSession.Total('HX156-F1'), 'The session has no lines left for the vehicle');
        Assert.AreEqual(0, SessionLineCount('HX156-F1'), 'The session has no lines left for the vehicle');
        Assert.AreEqual(7, EstimateSession.Total('HX156-F2'), 'Another vehicle keeps its lines');
    end;

    [Test]
    procedure RefusedApplyKeepsTheEstimateForAnotherTry()
    var
        Spy: Codeunit "CGR Estimate Workshop Spy";
    begin
        EstimateSession.Reset();
        NewVehicle('HX156-G1');
        Commit();
        EstimateSession.AddEstimateLine('HX156-G1', 'Brakes', 100);
        EstimateSession.AddEstimateLine('HX156-G1', 'Tyres', 20);
        Spy.RefuseEstimateOf('HX156-G1');
        BindSubscription(Spy);

        Assert.IsFalse(EstimateSession.Apply('HX156-G1'), 'Apply returns false when the workshop app refuses');
        UnbindSubscription(Spy);

        Assert.AreEqual(0, ApprovedCount('HX156-G1'), 'No approved line is stored');
        Assert.AreEqual(120, EstimateSession.Total('HX156-G1'), 'The estimate is still in the session');
        Assert.AreEqual(2, SessionLineCount('HX156-G1'), 'The estimate is still in the session');

        Commit();
        Assert.IsTrue(EstimateSession.Apply('HX156-G1'), 'The clerk can try again');
        Assert.AreEqual(2, ApprovedCount('HX156-G1'), 'The second try stores the lines');
    end;

    [Test]
    procedure ResetEmptiesTheSession()
    begin
        EstimateSession.Reset();
        EstimateSession.AddEstimateLine('HX156-H1', 'Brakes', 100);

        EstimateSession.Reset();

        Assert.AreEqual(0, SessionLineCount('HX156-H1'), 'Reset empties the session');
        Assert.AreEqual(0, EstimateSession.Total('HX156-H1'), 'Reset empties the session');
    end;

    local procedure NewVehicle(VehicleNo: Code[20])
    begin
        ClearApproved(VehicleNo);
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
    end;

    local procedure ClearApproved(VehicleNo: Code[20])
    var
        Approved: Record "CGR Repair Estimate Line";
    begin
        Approved.SetRange("Vehicle No.", VehicleNo);
        Approved.DeleteAll();
    end;

    local procedure ApprovedCount(VehicleNo: Code[20]): Integer
    var
        Approved: Record "CGR Repair Estimate Line";
    begin
        Approved.SetRange("Vehicle No.", VehicleNo);
        exit(Approved.Count());
    end;

    local procedure SessionLineCount(VehicleNo: Code[20]): Integer
    var
        Lines: Record "CGR Repair Estimate Line" temporary;
    begin
        EstimateSession.GetEstimateLines(Lines);
        Lines.SetRange("Vehicle No.", VehicleNo);
        exit(Lines.Count());
    end;
}
