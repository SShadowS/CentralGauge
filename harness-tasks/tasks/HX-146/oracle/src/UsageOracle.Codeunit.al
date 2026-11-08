codeunit 88150 "HX146 Usage Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure RentedVehicleSums()
    var
        Buffer: Record "CGR Monthly Usage Buffer" temporary;
    begin
        Prepare();
        InitRentedInPeriod('HX146-1A', false);

        FillMarch(Buffer);
        AssertLine(Buffer, 'HX146-1A', 150, 500, 2);
    end;

    [Test]
    procedure NotRentedVehicleListed()
    var
        Buffer: Record "CGR Monthly Usage Buffer" temporary;
    begin
        Prepare();
        InitVehicle('HX146-2A', false);

        FillMarch(Buffer);
        AssertLine(Buffer, 'HX146-2A', 0, 0, 0);
    end;

    [Test]
    procedure RentedOutsideOnlyListed()
    var
        Buffer: Record "CGR Monthly Usage Buffer" temporary;
    begin
        Prepare();
        InitRentedOutsidePeriod('HX146-3A');

        FillMarch(Buffer);
        AssertLine(Buffer, 'HX146-3A', 0, 0, 0);
    end;

    [Test]
    procedure BlockedVehicleNotListed()
    var
        Buffer: Record "CGR Monthly Usage Buffer" temporary;
    begin
        Prepare();
        InitBlockedRented('HX146-4A');
        InitVehicle('HX146-4B', true);

        FillMarch(Buffer);
        Assert.IsFalse(Buffer.Get('HX146-4A'), 'A Blocked vehicle rented in the period is not listed');
        Assert.IsFalse(Buffer.Get('HX146-4B'), 'A Blocked vehicle without rentals is not listed');
    end;

    [Test]
    procedure MixedFleetOneFill()
    var
        Buffer: Record "CGR Monthly Usage Buffer" temporary;
    begin
        Prepare();
        InitRentedInPeriod('HX146-5A', false);
        InitVehicle('HX146-5B', false);
        InitRentedOutsidePeriod('HX146-5C');
        InitBlockedRented('HX146-5D');
        InitVehicle('HX146-5E', true);

        FillMarch(Buffer);
        Buffer.SetFilter("Vehicle No.", 'HX146-5*');
        Assert.AreEqual(3, Buffer.Count(), 'One row per vehicle that is not Blocked');
        Buffer.Reset();
        AssertLine(Buffer, 'HX146-5A', 150, 500, 2);
        AssertLine(Buffer, 'HX146-5B', 0, 0, 0);
        AssertLine(Buffer, 'HX146-5C', 0, 0, 0);
    end;

    [Test]
    procedure SecondFillReplacesFirst()
    var
        Buffer: Record "CGR Monthly Usage Buffer" temporary;
        Runner: Codeunit "HX146 Usage Runner";
    begin
        Prepare();
        InitRentedInPeriod('HX146-6A', false);
        InitVehicle('HX146-6B', false);
        InitRentedOutsidePeriod('HX146-6C');
        Runner.AddSentinel('HX146-6OLD');

        RunFill(Runner, 20270301D, 20270331D, Buffer);
        RunFill(Runner, 20261201D, 20261231D, Buffer);
        Assert.IsFalse(Buffer.Get('HX146-6OLD'), 'A row that is not of the latest fill is gone');
        Buffer.SetFilter("Vehicle No.", 'HX146-6*');
        Assert.AreEqual(3, Buffer.Count(), 'The buffer holds the rows of the December fill only');
        Buffer.Reset();
        AssertLine(Buffer, 'HX146-6A', 70, 900, 1);
        AssertLine(Buffer, 'HX146-6B', 0, 0, 0);
        AssertLine(Buffer, 'HX146-6C', 40, 60, 1);
    end;

    local procedure FillMarch(var Buffer: Record "CGR Monthly Usage Buffer" temporary)
    var
        Runner: Codeunit "HX146 Usage Runner";
    begin
        RunFill(Runner, 20270301D, 20270331D, Buffer);
    end;

    local procedure RunFill(var Runner: Codeunit "HX146 Usage Runner"; FromDate: Date; ToDate: Date; var Buffer: Record "CGR Monthly Usage Buffer" temporary)
    var
        Ok: Boolean;
    begin
        Commit();
        Runner.SetPeriod(FromDate, ToDate);
        Ok := Runner.Run();
        Assert.IsTrue(Ok, StrSubstNo('FillMonthlyUsage(%1, %2) succeeds: %3', FromDate, ToDate, GetLastErrorText()));
        Runner.CopyBuffer(Buffer);
    end;

    local procedure AssertLine(var Buffer: Record "CGR Monthly Usage Buffer" temporary; VehicleNo: Code[20]; Revenue: Decimal; KmDriven: Integer; Rentals: Integer)
    begin
        Assert.IsTrue(Buffer.Get(VehicleNo), StrSubstNo('The buffer has a row for %1', VehicleNo));
        Assert.AreEqual(Revenue, Buffer.Revenue, StrSubstNo('Revenue of %1', VehicleNo));
        Assert.AreEqual(KmDriven, Buffer."Km Driven", StrSubstNo('Km Driven of %1', VehicleNo));
        Assert.AreEqual(Rentals, Buffer.Rentals, StrSubstNo('Rentals of %1', VehicleNo));
    end;

    local procedure Prepare()
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20270301D);
        Setup.GetOrCreate();
        Setup."Amount Rounding Precision" := 0.01;
        Setup.Modify();
        SessionContext.Reset();
    end;

    local procedure InitRentedInPeriod(VehicleNo: Code[20]; IsBlocked: Boolean)
    begin
        InitVehicle(VehicleNo, IsBlocked);
        AddEntry(VehicleNo, 20270305D, 100, 300);
        AddEntry(VehicleNo, 20270320D, 50, 200);
        AddEntry(VehicleNo, 20261210D, 70, 900);
        AddEntry(VehicleNo, 20270402D, 30, 40);
    end;

    local procedure InitRentedOutsidePeriod(VehicleNo: Code[20])
    begin
        InitVehicle(VehicleNo, false);
        AddEntry(VehicleNo, 20261215D, 40, 60);
        AddEntry(VehicleNo, 20270410D, 25, 35);
    end;

    local procedure InitBlockedRented(VehicleNo: Code[20])
    begin
        InitVehicle(VehicleNo, true);
        AddEntry(VehicleNo, 20270308D, 80, 120);
    end;

    local procedure InitVehicle(VehicleNo: Code[20]; IsBlocked: Boolean)
    var
        Vehicle: Record "CGR Vehicle";
        LedgerEntry: Record "CGR Rental Ledger Entry";
    begin
        LedgerEntry.SetRange("Vehicle No.", VehicleNo);
        LedgerEntry.DeleteAll();
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Blocked := IsBlocked;
        Vehicle.Insert();
    end;

    local procedure AddEntry(VehicleNo: Code[20]; PostingDate: Date; Amount: Decimal; KmDriven: Integer)
    var
        LedgerEntry: Record "CGR Rental Ledger Entry";
    begin
        LedgerEntry.Init();
        LedgerEntry."Vehicle No." := VehicleNo;
        LedgerEntry."Posting Date" := PostingDate;
        LedgerEntry.Amount := Amount;
        LedgerEntry."Km Driven" := KmDriven;
        LedgerEntry.Insert();
    end;
}
