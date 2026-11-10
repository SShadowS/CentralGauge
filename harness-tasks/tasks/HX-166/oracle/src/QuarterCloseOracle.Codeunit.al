codeunit 88450 "HX166 Quarter Close Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure ZeroValueVehiclePaysNothing()
    var
        Premium: Record "CGR Insurance Premium";
        Allocator: Codeunit "CGR Premium Allocator";
    begin
        NewPremiumHX166('HX166-ZERO', 100);
        AddShareHX166('HX166-ZERO', 10000, 'HX166-A', 1, 0);
        AddShareHX166('HX166-ZERO', 20000, 'HX166-B', 1, 0);
        AddShareHX166('HX166-ZERO', 30000, 'HX166-C', 1, 0);
        AddShareHX166('HX166-ZERO', 40000, 'HX166-D', 0, 0);

        Allocator.AllocatePremium('HX166-ZERO');

        Assert.AreEqual(0, ShareOfHX166('HX166-ZERO', 'HX166-D'), 'A vehicle with no insured value pays nothing when another vehicle has insured value');
        Assert.AreEqual(100, Allocator.PremiumSharedTotal('HX166-ZERO'), 'Shares add up exactly to the premium''s Total Amount');
        Premium.Get('HX166-ZERO');
        Assert.IsTrue(Premium.Allocated, 'A premium that was shared is flagged Allocated');
    end;

    [Test]
    procedure SevenEqualSharesStayWithinCent()
    var
        Allocator: Codeunit "CGR Premium Allocator";
        Index: Integer;
        Amount: Decimal;
    begin
        NewPremiumHX166('HX166-SEVEN', 100);
        for Index := 1 to 7 do
            AddShareHX166('HX166-SEVEN', Index * 10000, 'HX166-S' + Format(Index), 5000, 0);

        Allocator.AllocatePremium('HX166-SEVEN');

        for Index := 1 to 7 do begin
            Amount := ShareOfHX166('HX166-SEVEN', 'HX166-S' + Format(Index));
            Assert.IsTrue(Amount in [14.28, 14.29], 'A share is less than one cent away from 100/7, got ' + Format(Amount));
        end;
        Assert.AreEqual(100, Allocator.PremiumSharedTotal('HX166-SEVEN'), 'Shares add up exactly to the premium''s Total Amount');
    end;

    [Test]
    procedure EntryOrderDoesNotChangeShares()
    var
        Allocator: Codeunit "CGR Premium Allocator";
        Vehicles: array[5] of Code[20];
        Values: array[5] of Decimal;
        Index: Integer;
        Amount: Decimal;
    begin
        Vehicles[1] := 'HX166-T1';
        Vehicles[2] := 'HX166-T2';
        Vehicles[3] := 'HX166-T3';
        Vehicles[4] := 'HX166-T4';
        Vehicles[5] := 'HX166-T5';
        Values[1] := 3;
        Values[2] := 3;
        Values[3] := 3;
        Values[4] := 3;
        Values[5] := 1;
        NewPremiumHX166('HX166-ORDER1', 10);
        NewPremiumHX166('HX166-ORDER2', 10);
        for Index := 1 to 5 do begin
            AddShareHX166('HX166-ORDER1', Index * 10000, Vehicles[Index], Values[Index], 0);
            AddShareHX166('HX166-ORDER2', (6 - Index) * 7000, Vehicles[Index], Values[Index], 0);
        end;

        Allocator.AllocatePremium('HX166-ORDER1');
        Allocator.AllocatePremium('HX166-ORDER2');

        for Index := 1 to 5 do begin
            Amount := ShareOfHX166('HX166-ORDER1', Vehicles[Index]);
            Assert.AreEqual(Amount, ShareOfHX166('HX166-ORDER2', Vehicles[Index]), 'A share never depends on the order or the line numbers under which the vehicles were entered: ' + Vehicles[Index]);
            Assert.AreEqual(Round(Amount, 0.01), Amount, 'Shares are whole cents');
            Assert.IsTrue(Abs(Amount - 10 * Values[Index] / 13) < 0.01, 'A share is less than one cent away from its exact proportional amount: ' + Vehicles[Index]);
        end;
        Assert.AreEqual(10, Allocator.PremiumSharedTotal('HX166-ORDER1'), 'Shares add up exactly to the premium''s Total Amount');
        Assert.AreEqual(10, Allocator.PremiumSharedTotal('HX166-ORDER2'), 'Shares add up exactly to the premium''s Total Amount');
    end;

    [Test]
    procedure NoInsuredValueLeftUnchanged()
    var
        Premium: Record "CGR Insurance Premium";
        Allocator: Codeunit "CGR Premium Allocator";
    begin
        NewPremiumHX166('HX166-NOVALUE', 100);
        AddShareHX166('HX166-NOVALUE', 10000, 'HX166-A', 0, 7.77);
        AddShareHX166('HX166-NOVALUE', 20000, 'HX166-B', 0, 8.88);

        Allocator.AllocatePremium('HX166-NOVALUE');

        Assert.AreEqual(7.77, ShareOfHX166('HX166-NOVALUE', 'HX166-A'), 'A premium on which no vehicle has insured value is left exactly as it is');
        Assert.AreEqual(8.88, ShareOfHX166('HX166-NOVALUE', 'HX166-B'), 'A premium on which no vehicle has insured value is left exactly as it is');
        Premium.Get('HX166-NOVALUE');
        Assert.IsFalse(Premium.Allocated, 'A premium with nothing to share is not flagged Allocated');
    end;

    [Test]
    procedure ExactlyFifteenHundredOverIsStandard()
    begin
        NewVehicleHX166('HX166-EXACT');
        AddReadingHX166('HX166-EXACT', 20191215D, 10000);
        AddReadingHX166('HX166-EXACT', 20200110D, 11000);
        AddReadingHX166('HX166-EXACT', 20200320D, 13500);

        SettleOneHX166('HX166-EXACT', 20200101D, 20200331D, 2000);

        AssertChargeHX166('HX166-EXACT', 20200101D, 3500, 1500, 'STANDARD', 150);
    end;

    [Test]
    procedure TariffBandsAroundBoundary()
    var
        Vehicle: Record "CGR Vehicle";
        Settlement: Codeunit "CGR Usage Settlement";
    begin
        NewVehicleHX166('HX166-HEAVY');
        NewVehicleHX166('HX166-ONE');
        NewVehicleHX166('HX166-UNDER');
        AddReadingHX166('HX166-HEAVY', 20181215D, 10000);
        AddReadingHX166('HX166-HEAVY', 20190320D, 13501);
        AddReadingHX166('HX166-ONE', 20181215D, 10000);
        AddReadingHX166('HX166-ONE', 20190320D, 12001);
        AddReadingHX166('HX166-UNDER', 20181215D, 10000);
        AddReadingHX166('HX166-UNDER', 20190320D, 11000);

        Vehicle.SetFilter("No.", '%1|%2|%3', 'HX166-HEAVY', 'HX166-ONE', 'HX166-UNDER');
        Settlement.SettleUsagePeriod(Vehicle, 20190101D, 20190331D, 2000);

        AssertChargeHX166('HX166-HEAVY', 20190101D, 3501, 1501, 'HEAVY', 400);
        AssertChargeHX166('HX166-ONE', 20190101D, 2001, 1, 'STANDARD', 150);
        AssertChargeHX166('HX166-UNDER', 20190101D, 1000, 0, 'NONE', 0);
    end;

    [Test]
    procedure FirstReadingsOpenAtFirstKm()
    var
        Runner: Codeunit "HX166 Settle Runner";
        Ok: Boolean;
    begin
        NewVehicleHX166('HX166-FIRST');
        AddReadingHX166('HX166-FIRST', 20150110D, 2000);
        AddReadingHX166('HX166-FIRST', 20150320D, 6100);

        Runner.SetSettleHX166('HX166-FIRST', 20150101D, 20150331D, 1000);
        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'A vehicle with no reading before the period is settled: ' + GetLastErrorText());
        Assert.AreEqual(1, Runner.ResultHX166(), 'The vehicle is settled');
        AssertChargeHX166('HX166-FIRST', 20150101D, 4100, 3100, 'HEAVY', 400);
    end;

    [Test]
    procedure OpeningKmStopsAtFourHundredDays()
    var
        Vehicle: Record "CGR Vehicle";
        Settlement: Codeunit "CGR Usage Settlement";
    begin
        NewVehicleHX166('HX166-IN400');
        NewVehicleHX166('HX166-OUT401');
        AddReadingHX166('HX166-IN400', 20160101D - 500, 100);
        AddReadingHX166('HX166-IN400', 20160101D - 400, 500);
        AddReadingHX166('HX166-IN400', 20160110D, 700);
        AddReadingHX166('HX166-IN400', 20160320D, 1000);
        AddReadingHX166('HX166-OUT401', 20160101D - 401, 500);
        AddReadingHX166('HX166-OUT401', 20160110D, 700);
        AddReadingHX166('HX166-OUT401', 20160320D, 1000);

        Vehicle.SetFilter("No.", '%1|%2', 'HX166-IN400', 'HX166-OUT401');
        Settlement.SettleUsagePeriod(Vehicle, 20160101D, 20160331D, 10000);

        AssertChargeHX166('HX166-IN400', 20160101D, 500, 0, 'NONE', 0);
        AssertChargeHX166('HX166-OUT401', 20160101D, 300, 0, 'NONE', 0);
    end;

    [Test]
    procedure SelectionOnlyIsSettled()
    var
        Vehicle: Record "CGR Vehicle";
        Charge: Record "CGR Usage Charge";
        Settlement: Codeunit "CGR Usage Settlement";
        Settled: Integer;
    begin
        NewVehicleHX166('HX166-SEL1');
        NewVehicleHX166('HX166-SEL2');
        NewVehicleHX166('HX166-SEL3');
        AddReadingHX166('HX166-SEL1', 20161215D, 1000);
        AddReadingHX166('HX166-SEL1', 20170320D, 3000);
        AddReadingHX166('HX166-SEL2', 20161215D, 1000);
        AddReadingHX166('HX166-SEL2', 20170320D, 3000);
        AddReadingHX166('HX166-SEL3', 20161215D, 1000);
        AddReadingHX166('HX166-SEL3', 20170320D, 3000);

        Vehicle.SetFilter("No.", '%1|%2', 'HX166-SEL1', 'HX166-SEL3');
        Settled := Settlement.SettleUsagePeriod(Vehicle, 20170101D, 20170331D, 5000);

        Assert.AreEqual(2, Settled, 'SettleUsagePeriod returns the number of vehicles settled, of the selection only');
        Assert.IsTrue(Charge.Get('HX166-SEL1', 20170101D), 'A selected vehicle gets a charge row');
        Assert.IsTrue(Charge.Get('HX166-SEL3', 20170101D), 'A selected vehicle gets a charge row');
        Assert.IsFalse(Charge.Get('HX166-SEL2', 20170101D), 'A vehicle outside the selection gets no charge row');
    end;

    [Test]
    procedure NoReadingInPeriodIsNotSettled()
    var
        Vehicle: Record "CGR Vehicle";
        Charge: Record "CGR Usage Charge";
        Settlement: Codeunit "CGR Usage Settlement";
        Settled: Integer;
    begin
        NewVehicleHX166('HX166-NOREAD');
        AddReadingHX166('HX166-NOREAD', 20091215D, 1000);
        AddReadingHX166('HX166-NOREAD', 20100615D, 3000);

        Vehicle.SetRange("No.", 'HX166-NOREAD');
        Settled := Settlement.SettleUsagePeriod(Vehicle, 20100101D, 20100331D, 100);

        Assert.AreEqual(0, Settled, 'A vehicle with no reading in the period is not counted as settled');
        Assert.IsFalse(Charge.Get('HX166-NOREAD', 20100101D), 'A vehicle with no reading in the period gets no charge row');
    end;

    [Test]
    procedure SettlingAgainReplacesCharge()
    var
        Charge: Record "CGR Usage Charge";
    begin
        NewVehicleHX166('HX166-AGAIN');
        AddReadingHX166('HX166-AGAIN', 20171215D, 0);
        AddReadingHX166('HX166-AGAIN', 20180110D, 1000);

        SettleOneHX166('HX166-AGAIN', 20180101D, 20180331D, 100);
        AssertChargeHX166('HX166-AGAIN', 20180101D, 1000, 900, 'STANDARD', 150);

        AddReadingHX166('HX166-AGAIN', 20180320D, 4000);
        SettleOneHX166('HX166-AGAIN', 20180101D, 20180331D, 100);

        Charge.SetRange("Vehicle No.", 'HX166-AGAIN');
        Charge.SetRange("Period Start", 20180101D);
        Assert.AreEqual(1, Charge.Count(), 'Settling the same period again replaces the row');
        AssertChargeHX166('HX166-AGAIN', 20180101D, 4000, 3900, 'HEAVY', 400);
    end;

    [Test]
    procedure MixedFileAcceptsGoodLinesOnly()
    var
        FuelLine: Record "CGR Fuel Card Line";
        Runner: Codeunit "HX166 Feed Runner";
        Codes: List of [Code[20]];
        Vehicles: List of [Code[20]];
        Amounts: List of [Text];
        Ok: Boolean;
    begin
        ClearFuelLinesHX166('HX166-G*');
        NewVehicleHX166('HX166-F1');
        DeleteVehicleHX166('HX166-NOTHERE');
        AddFileLineHX166(Codes, Vehicles, Amounts, 'HX166-G1', 'HX166-F1', '12.50');
        AddFileLineHX166(Codes, Vehicles, Amounts, 'HX166-GBAD', 'HX166-F1', 'twelve');
        AddFileLineHX166(Codes, Vehicles, Amounts, 'HX166-GNEG', 'HX166-F1', '-5');
        AddFileLineHX166(Codes, Vehicles, Amounts, 'HX166-GUNK', 'HX166-NOTHERE', '7');
        AddFileLineHX166(Codes, Vehicles, Amounts, 'HX166-G2', 'HX166-F1', '3.25');

        Runner.SetFileHX166(Codes, Vehicles, Amounts);
        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'A line that is not accepted raises nothing to the caller: ' + GetLastErrorText());
        Assert.AreEqual(2, Runner.ResultHX166(), 'ImportFuelCardFile returns how many lines it accepted');
        Assert.IsTrue(FuelLine.Get('HX166-G1'), 'An accepted line leaves one fuel-card row');
        Assert.AreEqual(12.5, FuelLine.Amount, 'The accepted amount');
        Assert.AreEqual('HX166-F1', FuelLine."Vehicle No.", 'The accepted vehicle');
        Assert.IsTrue(FuelLine.Get('HX166-G2'), 'A line after rejected lines is still imported');
        Assert.AreEqual(3.25, FuelLine.Amount, 'The accepted amount');
        Assert.IsFalse(FuelLine.Get('HX166-GBAD'), 'A malformed amount leaves no row');
        Assert.IsFalse(FuelLine.Get('HX166-GNEG'), 'A negative amount leaves no row');
        Assert.IsFalse(FuelLine.Get('HX166-GUNK'), 'An unknown vehicle leaves no row');
    end;

    [Test]
    procedure RepeatedEntryCodesCountOnce()
    var
        FuelLine: Record "CGR Fuel Card Line";
        Runner: Codeunit "HX166 Feed Runner";
        SecondRunner: Codeunit "HX166 Feed Runner";
        Codes: List of [Code[20]];
        Vehicles: List of [Code[20]];
        Amounts: List of [Text];
        LaterCodes: List of [Code[20]];
        LaterVehicles: List of [Code[20]];
        LaterAmounts: List of [Text];
        Ok: Boolean;
    begin
        ClearFuelLinesHX166('HX166-R*');
        NewVehicleHX166('HX166-F2');
        AddFileLineHX166(Codes, Vehicles, Amounts, 'HX166-R1', 'HX166-F2', '1');
        AddFileLineHX166(Codes, Vehicles, Amounts, 'HX166-R2', 'HX166-F2', '2');
        AddFileLineHX166(Codes, Vehicles, Amounts, 'HX166-R1', 'HX166-F2', '99');
        AddFileLineHX166(Codes, Vehicles, Amounts, 'HX166-R3', 'HX166-F2', '3');

        Runner.SetFileHX166(Codes, Vehicles, Amounts);
        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'A repeated entry code raises nothing to the caller: ' + GetLastErrorText());
        Assert.AreEqual(3, Runner.ResultHX166(), 'A repeated entry code in the same file is not counted');
        FuelLine.Get('HX166-R1');
        Assert.AreEqual(1, FuelLine.Amount, 'The first accepted row is kept');
        Assert.IsTrue(FuelLine.Get('HX166-R3'), 'The line after a repeated entry code is still imported');

        AddFileLineHX166(LaterCodes, LaterVehicles, LaterAmounts, 'HX166-R2', 'HX166-F2', '77');
        AddFileLineHX166(LaterCodes, LaterVehicles, LaterAmounts, 'HX166-R4', 'HX166-F2', '4');

        SecondRunner.SetFileHX166(LaterCodes, LaterVehicles, LaterAmounts);
        Commit();
        Ok := SecondRunner.Run();

        Assert.IsTrue(Ok, 'An entry code accepted in an earlier file raises nothing to the caller: ' + GetLastErrorText());
        Assert.AreEqual(1, SecondRunner.ResultHX166(), 'An entry code accepted in an earlier file is not counted');
        FuelLine.Get('HX166-R2');
        Assert.AreEqual(2, FuelLine.Amount, 'The row of the earlier file is kept');
        Assert.IsTrue(FuelLine.Get('HX166-R4'), 'The line after a repeated entry code is still imported');
    end;

    [Test]
    procedure ImportStaysInCallerTransaction()
    var
        Marker: Record "CGR Vehicle";
        FuelLine: Record "CGR Fuel Card Line";
        Feed: Codeunit "CGR Fuel Card Feed";
        Codes: List of [Code[20]];
        Vehicles: List of [Code[20]];
        Amounts: List of [Text];
        Accepted: Integer;
    begin
        ClearFuelLinesHX166('HX166-C*');
        NewVehicleHX166('HX166-F3');
        DeleteVehicleHX166('HX166-MARKER');
        AddFileLineHX166(Codes, Vehicles, Amounts, 'HX166-C1', 'HX166-F3', '5');
        AddFileLineHX166(Codes, Vehicles, Amounts, 'HX166-C2', 'HX166-F3', '6');
        Commit();

        Marker.Init();
        Marker."No." := 'HX166-MARKER';
        Marker.Insert();

        Accepted := Feed.ImportFuelCardFile(Codes, Vehicles, Amounts);
        Assert.AreEqual(2, Accepted, 'ImportFuelCardFile returns how many lines it accepted');

        asserterror Error('HX166 caller failed');

        Assert.IsFalse(Marker.Get('HX166-MARKER'), 'The import commits nothing: the caller''s own row rolls back with the caller''s transaction');
        Assert.IsFalse(FuelLine.Get('HX166-C1'), 'The import runs inside the caller''s transaction: its rows roll back');
        Assert.IsFalse(FuelLine.Get('HX166-C2'), 'The import runs inside the caller''s transaction: its rows roll back');
    end;

    local procedure NewPremiumHX166(PremiumNo: Code[20]; TotalAmount: Decimal)
    var
        Premium: Record "CGR Insurance Premium";
        Share: Record "CGR Premium Share";
    begin
        Share.SetRange("Premium No.", PremiumNo);
        Share.DeleteAll();
        if Premium.Get(PremiumNo) then
            Premium.Delete();
        Premium.Init();
        Premium."No." := PremiumNo;
        Premium."Period Start" := 20200101D;
        Premium."Total Amount" := TotalAmount;
        Premium.Insert();
    end;

    local procedure AddShareHX166(PremiumNo: Code[20]; LineNo: Integer; VehicleNo: Code[20]; InsuredValue: Decimal; SentinelAmount: Decimal)
    var
        Share: Record "CGR Premium Share";
    begin
        Share.Init();
        Share."Premium No." := PremiumNo;
        Share."Line No." := LineNo;
        Share."Vehicle No." := VehicleNo;
        Share."Insured Value" := InsuredValue;
        Share."Share Amount" := SentinelAmount;
        Share.Insert();
    end;

    local procedure ShareOfHX166(PremiumNo: Code[20]; VehicleNo: Code[20]): Decimal
    var
        Share: Record "CGR Premium Share";
    begin
        Share.SetRange("Premium No.", PremiumNo);
        Share.SetRange("Vehicle No.", VehicleNo);
        Share.FindFirst();
        exit(Share."Share Amount");
    end;

    local procedure DeleteVehicleHX166(VehicleNo: Code[20])
    var
        Vehicle: Record "CGR Vehicle";
        Reading: Record "CGR Usage Reading";
        Charge: Record "CGR Usage Charge";
    begin
        Reading.SetRange("Vehicle No.", VehicleNo);
        Reading.DeleteAll();
        Charge.SetRange("Vehicle No.", VehicleNo);
        Charge.DeleteAll();
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
    end;

    local procedure NewVehicleHX166(VehicleNo: Code[20])
    var
        Vehicle: Record "CGR Vehicle";
    begin
        DeleteVehicleHX166(VehicleNo);
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Insert();
    end;

    local procedure AddReadingHX166(VehicleNo: Code[20]; ReadingDate: Date; Km: Integer)
    var
        Reading: Record "CGR Usage Reading";
    begin
        Reading.Init();
        Reading."Vehicle No." := VehicleNo;
        Reading."Reading Date" := ReadingDate;
        Reading.Km := Km;
        Reading.Insert();
    end;

    local procedure SettleOneHX166(VehicleNo: Code[20]; FromDate: Date; ToDate: Date; AllowanceKm: Integer)
    var
        Vehicle: Record "CGR Vehicle";
        Settlement: Codeunit "CGR Usage Settlement";
    begin
        Vehicle.SetRange("No.", VehicleNo);
        Settlement.SettleUsagePeriod(Vehicle, FromDate, ToDate, AllowanceKm);
    end;

    local procedure AssertChargeHX166(VehicleNo: Code[20]; PeriodStart: Date; KmDriven: Integer; KmOver: Integer; BandCode: Code[10]; Fee: Decimal)
    var
        Charge: Record "CGR Usage Charge";
    begin
        Assert.IsTrue(Charge.Get(VehicleNo, PeriodStart), 'The vehicle has a charge row for the period: ' + VehicleNo);
        Assert.AreEqual(KmDriven, Charge."Km Driven", 'Km driven: ' + VehicleNo);
        Assert.AreEqual(KmOver, Charge."Km Over", 'Km over: ' + VehicleNo);
        Assert.AreEqual(BandCode, Charge."Band Code", 'Band of the insurer''s tariff: ' + VehicleNo);
        Assert.AreEqual(Fee, Charge.Fee, 'Flat fee of the insurer''s tariff: ' + VehicleNo);
    end;

    local procedure ClearFuelLinesHX166(EntryCodeFilter: Text)
    var
        FuelLine: Record "CGR Fuel Card Line";
    begin
        FuelLine.SetFilter("Entry Code", EntryCodeFilter);
        FuelLine.DeleteAll();
    end;

    local procedure AddFileLineHX166(var Codes: List of [Code[20]]; var Vehicles: List of [Code[20]]; var Amounts: List of [Text]; EntryCode: Code[20]; VehicleNo: Code[20]; AmountText: Text)
    begin
        Codes.Add(EntryCode);
        Vehicles.Add(VehicleNo);
        Amounts.Add(AmountText);
    end;
}
