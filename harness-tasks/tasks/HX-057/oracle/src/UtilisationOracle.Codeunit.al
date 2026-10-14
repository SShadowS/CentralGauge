codeunit 86600 "HX057 Utilisation Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure IdleVehicleListed()
    var
        Buffer: Record "CGR Utilisation Buffer" temporary;
    begin
        Prepare();
        InitVehicle('HX057-1A');
        InitVehicle('HX057-1B');
        AddEntry('HX057-1A', 100);
        AddEntry('HX057-1A', 50);

        Fill('HX057-1*', Buffer);
        Assert.AreEqual(2, Buffer.Count(), 'One line per vehicle in the filter, also the vehicle that was never rented');
        AssertLine(Buffer, 'HX057-1A', 2, 150);
        AssertLine(Buffer, 'HX057-1B', 0, 0);
    end;

    [Test]
    procedure ZeroAmountRentalCounts()
    var
        Buffer: Record "CGR Utilisation Buffer" temporary;
    begin
        Prepare();
        InitVehicle('HX057-2A');
        AddEntry('HX057-2A', 0);

        Fill('HX057-2*', Buffer);
        Assert.AreEqual(1, Buffer.Count(), 'One line for the one vehicle in the filter');
        AssertLine(Buffer, 'HX057-2A', 1, 0);
    end;

    [Test]
    procedure RefundReducesRevenue()
    var
        Buffer: Record "CGR Utilisation Buffer" temporary;
    begin
        Prepare();
        InitVehicle('HX057-3A');
        AddEntry('HX057-3A', 100);
        AddEntry('HX057-3A', -30);

        Fill('HX057-3*', Buffer);
        Assert.AreEqual(1, Buffer.Count(), 'One line for the one vehicle in the filter');
        AssertLine(Buffer, 'HX057-3A', 2, 70);
    end;

    [Test]
    procedure BufferReplaced()
    var
        Buffer: Record "CGR Utilisation Buffer" temporary;
        Runner: Codeunit "HX057 Fill Runner";
        Ok: Boolean;
    begin
        Prepare();
        InitVehicle('HX057-4A');
        AddEntry('HX057-4A', 10);
        Runner.AddLine('HX057-OLD', 5, 500);
        Runner.CopyBuffer(Buffer);
        Assert.IsTrue(Buffer.Get('HX057-OLD'), 'Precondition: the buffer holds a line of an earlier fill');

        Commit();
        Runner.SetVehicleFilter('HX057-4*');
        Ok := Runner.Run();
        Assert.IsTrue(Ok, StrSubstNo('FillUtilisation for HX057-4* succeeds: %1', GetLastErrorText()));
        Runner.CopyBuffer(Buffer);
        Assert.IsFalse(Buffer.Get('HX057-OLD'), 'The line of the earlier fill is gone');
        Assert.AreEqual(1, Buffer.Count(), 'The buffer holds only the lines of the latest fill');
        AssertLine(Buffer, 'HX057-4A', 1, 10);
    end;

    [Test]
    procedure FilterExcludesOthers()
    var
        Buffer: Record "CGR Utilisation Buffer" temporary;
    begin
        Prepare();
        InitVehicle('HX057-5A');
        InitVehicle('HX057X-5');
        AddEntry('HX057-5A', 10);
        AddEntry('HX057X-5', 20);

        Fill('HX057-5*', Buffer);
        Assert.AreEqual(1, Buffer.Count(), 'Only the vehicle in the filter is listed');
        AssertLine(Buffer, 'HX057-5A', 1, 10);
        Assert.IsFalse(Buffer.Get('HX057X-5'), 'A vehicle outside the filter is not listed');
    end;

    [Test]
    procedure AllIdleVehicles()
    var
        Buffer: Record "CGR Utilisation Buffer" temporary;
    begin
        Prepare();
        InitVehicle('HX057-6A');
        InitVehicle('HX057-6B');
        InitVehicle('HX057-6C');

        Fill('HX057-6*', Buffer);
        Assert.AreEqual(3, Buffer.Count(), 'Every vehicle in the filter is listed when none was rented');
        AssertLine(Buffer, 'HX057-6A', 0, 0);
        AssertLine(Buffer, 'HX057-6B', 0, 0);
        AssertLine(Buffer, 'HX057-6C', 0, 0);
    end;

    [Test]
    procedure MixedFleet()
    var
        Buffer: Record "CGR Utilisation Buffer" temporary;
    begin
        Prepare();
        InitVehicle('HX057-7A');
        InitVehicle('HX057-7B');
        InitVehicle('HX057-7C');
        AddEntry('HX057-7A', 0);
        AddEntry('HX057-7C', 40);
        AddEntry('HX057-7C', -40);

        Fill('HX057-7*', Buffer);
        Assert.AreEqual(3, Buffer.Count(), 'One line per vehicle in the filter');
        AssertLine(Buffer, 'HX057-7A', 1, 0);
        AssertLine(Buffer, 'HX057-7B', 0, 0);
        AssertLine(Buffer, 'HX057-7C', 2, 0);
    end;

    local procedure Fill(VehicleFilter: Text; var Buffer: Record "CGR Utilisation Buffer" temporary)
    var
        Runner: Codeunit "HX057 Fill Runner";
        Ok: Boolean;
    begin
        Commit();
        Runner.SetVehicleFilter(VehicleFilter);
        Ok := Runner.Run();
        Assert.IsTrue(Ok, StrSubstNo('FillUtilisation for %1 succeeds: %2', VehicleFilter, GetLastErrorText()));
        Runner.CopyBuffer(Buffer);
    end;

    local procedure AssertLine(var Buffer: Record "CGR Utilisation Buffer" temporary; VehicleNo: Code[20]; Rentals: Integer; Revenue: Decimal)
    begin
        Assert.IsTrue(Buffer.Get(VehicleNo), StrSubstNo('The buffer has a line for %1', VehicleNo));
        Assert.AreEqual(Rentals, Buffer.Rentals, StrSubstNo('Rentals of %1', VehicleNo));
        Assert.AreEqual(Revenue, Buffer.Revenue, StrSubstNo('Revenue of %1', VehicleNo));
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

    local procedure InitVehicle(VehicleNo: Code[20])
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
        Vehicle.Insert();
    end;

    local procedure AddEntry(VehicleNo: Code[20]; Amount: Decimal)
    var
        LedgerEntry: Record "CGR Rental Ledger Entry";
    begin
        LedgerEntry.Init();
        LedgerEntry."Vehicle No." := VehicleNo;
        LedgerEntry."Posting Date" := 20270215D;
        LedgerEntry.Amount := Amount;
        LedgerEntry.Insert();
    end;
}
