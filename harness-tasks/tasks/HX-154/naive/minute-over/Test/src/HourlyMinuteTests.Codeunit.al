codeunit 80613 "CGR Hourly Minute Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure TwoHoursFiftyNineIsThree()
    var
        Bill: Record "CGR Hourly Bill";
        ContractNo: Code[20];
    begin
        ContractNo := MinuteContract('HX154-NA1', 10, 090000T, 115900T);
        MinuteBill(ContractNo, true);
        Bill.SetRange("Contract No.", ContractNo);
        Bill.FindFirst();
        Assert.AreEqual(3, Bill.Hours, 'Three started hours');
        Assert.AreEqual(30, Bill.Amount, 'Amount');
    end;

    [Test]
    procedure ExactlyTwoHoursIsTwo()
    var
        Bill: Record "CGR Hourly Bill";
        ContractNo: Code[20];
    begin
        ContractNo := MinuteContract('HX154-NA2', 10, 090000T, 110000T);
        MinuteBill(ContractNo, true);
        Bill.SetRange("Contract No.", ContractNo);
        Bill.FindFirst();
        Assert.AreEqual(2, Bill.Hours, 'Two hours');
    end;

    [Test]
    procedure OneMinuteOverIsThree()
    var
        Bill: Record "CGR Hourly Bill";
        ContractNo: Code[20];
    begin
        ContractNo := MinuteContract('HX154-NA3', 10, 090000T, 110100T);
        MinuteBill(ContractNo, true);
        Bill.SetRange("Contract No.", ContractNo);
        Bill.FindFirst();
        Assert.AreEqual(3, Bill.Hours, 'A minute more is another hour');
    end;

    [Test]
    procedure DiscountApplied()
    var
        Bill: Record "CGR Hourly Bill";
        Spy: Codeunit "CGR Hourly Minute Spy";
        ContractNo: Code[20];
    begin
        ContractNo := MinuteContract('HX154-NA4', 10, 090000T, 120000T);
        Spy.SetMinuteDiscount(20);
        BindSubscription(Spy);
        MinuteBill(ContractNo, true);
        UnbindSubscription(Spy);
        Bill.SetRange("Contract No.", ContractNo);
        Bill.FindFirst();
        Assert.AreEqual(24, Bill.Amount, '3 x 10 less 20 %');
    end;

    [Test]
    procedure RefusedReturnsFalse()
    var
        Bill: Record "CGR Hourly Bill";
        Spy: Codeunit "CGR Hourly Minute Spy";
        ContractNo: Code[20];
    begin
        ContractNo := MinuteContract('HX154-NA5', 10, 090000T, 110000T);
        Spy.SetMinuteRefusal(ContractNo);
        BindSubscription(Spy);
        MinuteBill(ContractNo, false);
        UnbindSubscription(Spy);
        Bill.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(0, Bill.Count(), 'No row');
    end;

    [Test]
    procedure SecondCallReturnsFalse()
    var
        Bill: Record "CGR Hourly Bill";
        ContractNo: Code[20];
    begin
        ContractNo := MinuteContract('HX154-NA6', 10, 090000T, 110000T);
        MinuteBill(ContractNo, true);
        MinuteBill(ContractNo, false);
        Bill.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, Bill.Count(), 'One row');
    end;

    local procedure MinuteBill(ContractNo: Code[20]; Expected: Boolean)
    var
        Runner: Codeunit "CGR Hourly Minute Runner";
        Ok: Boolean;
    begin
        Runner.SetMinuteContract(ContractNo);
        Commit();
        Ok := Runner.Run();
        Assert.IsTrue(Ok, 'Billing finishes: ' + GetLastErrorText());
        Assert.AreEqual(Expected, Runner.GetMinuteResult(), 'BillHourly result');
    end;

    local procedure MinuteContract(VehicleNo: Code[20]; HourlyRate: Decimal; PickedUpTime: Time; ReturnedTime: Time): Code[20]
    var
        Vehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
        Bill: Record "CGR Hourly Bill";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        Vehicle.Get(VehicleNo);
        Vehicle."Hourly Rate" := HourlyRate;
        Vehicle.Modify();
        ContractNo := Lib.CreateContract(VehicleNo);
        Contract.Get(ContractNo);
        Contract."Picked Up At" := CreateDateTime(20270301D, PickedUpTime);
        Contract."Returned At" := CreateDateTime(20270301D, ReturnedTime);
        Contract.Modify();
        Bill.SetRange("Contract No.", ContractNo);
        Bill.DeleteAll();
        exit(ContractNo);
    end;
}
