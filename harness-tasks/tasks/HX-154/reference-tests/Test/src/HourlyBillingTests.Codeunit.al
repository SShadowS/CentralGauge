codeunit 80610 "CGR Hourly Billing Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure StartedHourIsBilledAsAWholeHour()
    var
        Bill: Record "CGR Hourly Bill";
        Runner: Codeunit "CGR Hourly Billing Runner";
        ContractNo: Code[20];
        Ok: Boolean;
    begin
        ContractNo := HX154Contract('HX154-A1', 10, 090000T, 115900T);
        Runner.SetHourlyContract(ContractNo);

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'BillHourly finishes: ' + GetLastErrorText());
        Assert.IsTrue(Runner.HourlyBillResult(), 'BillHourly returns true');
        Bill.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, Bill.Count(), 'One hourly bill row');
        Bill.FindFirst();
        Assert.AreEqual(3, Bill.Hours, '2 h 59 min is 3 started hours');
        Assert.AreEqual(30, Bill.Amount, '3 hours x rate 10');
    end;

    [Test]
    procedure ExactHoursAreNotRoundedUp()
    var
        Bill: Record "CGR Hourly Bill";
        Runner: Codeunit "CGR Hourly Billing Runner";
        ContractNo: Code[20];
        Ok: Boolean;
    begin
        ContractNo := HX154Contract('HX154-B1', 10, 090000T, 110000T);
        Runner.SetHourlyContract(ContractNo);

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'BillHourly finishes: ' + GetLastErrorText());
        Assert.IsTrue(Runner.HourlyBillResult(), 'BillHourly returns true');
        Bill.SetRange("Contract No.", ContractNo);
        Bill.FindFirst();
        Assert.AreEqual(2, Bill.Hours, 'Exactly 2 hours is 2');
        Assert.AreEqual(20, Bill.Amount, '2 hours x rate 10');
    end;

    [Test]
    procedure OneSecondOverStartsAnotherHour()
    var
        Bill: Record "CGR Hourly Bill";
        Runner: Codeunit "CGR Hourly Billing Runner";
        ContractNo: Code[20];
        Ok: Boolean;
    begin
        ContractNo := HX154Contract('HX154-C1', 10, 090000T, 110001T);
        Runner.SetHourlyContract(ContractNo);

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'BillHourly finishes: ' + GetLastErrorText());
        Assert.IsTrue(Runner.HourlyBillResult(), 'BillHourly returns true');
        Bill.SetRange("Contract No.", ContractNo);
        Bill.FindFirst();
        Assert.AreEqual(3, Bill.Hours, '2 hours and 1 second is 3 started hours');
        Assert.AreEqual(30, Bill.Amount, '3 hours x rate 10');
    end;

    [Test]
    procedure LoyaltyDiscountIsDeductedAndRounded()
    var
        Bill: Record "CGR Hourly Bill";
        Spy: Codeunit "CGR Hourly Partner Spy";
        Runner: Codeunit "CGR Hourly Billing Runner";
        ContractNo: Code[20];
        Ok: Boolean;
    begin
        ContractNo := HX154Contract('HX154-D1', 10.35, 090000T, 120000T);
        Spy.GiveLoyaltyDiscount(15);
        BindSubscription(Spy);
        Runner.SetHourlyContract(ContractNo);

        Commit();
        Ok := Runner.Run();
        UnbindSubscription(Spy);

        Assert.IsTrue(Ok, 'BillHourly finishes: ' + GetLastErrorText());
        Assert.IsTrue(Runner.HourlyBillResult(), 'BillHourly returns true');
        Bill.SetRange("Contract No.", ContractNo);
        Bill.FindFirst();
        Assert.AreEqual(3, Bill.Hours, 'Exactly 3 hours');
        Assert.AreEqual(26.39, Bill.Amount, '3 x 10.35 less 15 %, rounded to 0.01');
    end;

    [Test]
    procedure RefusedBillWritesNothing()
    var
        Bill: Record "CGR Hourly Bill";
        Spy: Codeunit "CGR Hourly Partner Spy";
        Runner: Codeunit "CGR Hourly Billing Runner";
        ContractNo: Code[20];
        Ok: Boolean;
    begin
        ContractNo := HX154Contract('HX154-E1', 10, 090000T, 110000T);
        Spy.RefuseHourlyPayment(ContractNo);
        BindSubscription(Spy);
        Runner.SetHourlyContract(ContractNo);

        Commit();
        Ok := Runner.Run();
        UnbindSubscription(Spy);

        Assert.IsTrue(Ok, 'BillHourly does not raise the refusal: ' + GetLastErrorText());
        Assert.IsFalse(Runner.HourlyBillResult(), 'BillHourly returns false when the payment app refuses');
        Bill.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(0, Bill.Count(), 'A refused bill writes no row');
    end;

    [Test]
    procedure ContractIsBilledOnce()
    var
        Bill: Record "CGR Hourly Bill";
        Runner: Codeunit "CGR Hourly Billing Runner";
        ContractNo: Code[20];
        Ok: Boolean;
    begin
        ContractNo := HX154Contract('HX154-F1', 10, 090000T, 110000T);
        Runner.SetHourlyContract(ContractNo);
        Commit();
        Ok := Runner.Run();
        Assert.IsTrue(Ok, 'The first bill finishes: ' + GetLastErrorText());
        Assert.IsTrue(Runner.HourlyBillResult(), 'The first call returns true');

        Runner.SetHourlyContract(ContractNo);
        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'The second call finishes: ' + GetLastErrorText());
        Assert.IsFalse(Runner.HourlyBillResult(), 'The second call returns false');
        Bill.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, Bill.Count(), 'A contract is billed once');
    end;

    local procedure HX154Contract(VehicleNo: Code[20]; HourlyRate: Decimal; PickedUpTime: Time; ReturnedTime: Time): Code[20]
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
