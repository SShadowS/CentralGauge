codeunit 80616 "CGR Hourly No Loyalty Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure PartHourCountsWhole()
    var
        Bill: Record "CGR Hourly Bill";
        HourlyBilling: Codeunit "CGR Hourly Billing";
        ContractNo: Code[20];
    begin
        ContractNo := NoLoyaltyContract('HX154-NB1', 10, 090000T, 115900T);
        Commit();
        Assert.IsTrue(HourlyBilling.BillHourly(ContractNo), 'Billed');
        Bill.SetRange("Contract No.", ContractNo);
        Bill.FindFirst();
        Assert.AreEqual(3, Bill.Hours, 'Three hours');
        Assert.AreEqual(30, Bill.Amount, 'Amount is hours x rate');
    end;

    [Test]
    procedure WholeHoursStay()
    var
        Bill: Record "CGR Hourly Bill";
        HourlyBilling: Codeunit "CGR Hourly Billing";
        ContractNo: Code[20];
    begin
        ContractNo := NoLoyaltyContract('HX154-NB2', 10, 090000T, 110000T);
        Commit();
        Assert.IsTrue(HourlyBilling.BillHourly(ContractNo), 'Billed');
        Bill.SetRange("Contract No.", ContractNo);
        Bill.FindFirst();
        Assert.AreEqual(2, Bill.Hours, 'Two hours');
    end;

    [Test]
    procedure SecondOverCountsAnHour()
    var
        Bill: Record "CGR Hourly Bill";
        HourlyBilling: Codeunit "CGR Hourly Billing";
        ContractNo: Code[20];
    begin
        ContractNo := NoLoyaltyContract('HX154-NB3', 12.5, 090000T, 110001T);
        Commit();
        Assert.IsTrue(HourlyBilling.BillHourly(ContractNo), 'Billed');
        Bill.SetRange("Contract No.", ContractNo);
        Bill.FindFirst();
        Assert.AreEqual(3, Bill.Hours, 'Three hours');
        Assert.AreEqual(37.5, Bill.Amount, '3 x 12.5');
    end;

    [Test]
    procedure RefusalLeavesNoBill()
    var
        Bill: Record "CGR Hourly Bill";
        Spy: Codeunit "CGR Hourly No Loyalty Spy";
        HourlyBilling: Codeunit "CGR Hourly Billing";
        ContractNo: Code[20];
        Billed: Boolean;
    begin
        ContractNo := NoLoyaltyContract('HX154-NB4', 10, 090000T, 110000T);
        Spy.SetNoLoyaltyRefusal(ContractNo);
        BindSubscription(Spy);
        Commit();
        Billed := HourlyBilling.BillHourly(ContractNo);
        UnbindSubscription(Spy);
        Assert.IsFalse(Billed, 'Refused');
        Bill.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(0, Bill.Count(), 'No row');
    end;

    [Test]
    procedure BilledOnlyOnce()
    var
        Bill: Record "CGR Hourly Bill";
        HourlyBilling: Codeunit "CGR Hourly Billing";
        ContractNo: Code[20];
    begin
        ContractNo := NoLoyaltyContract('HX154-NB5', 10, 090000T, 110000T);
        Commit();
        Assert.IsTrue(HourlyBilling.BillHourly(ContractNo), 'First call bills');
        Commit();
        Assert.IsFalse(HourlyBilling.BillHourly(ContractNo), 'Second call does not');
        Bill.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, Bill.Count(), 'One row');
    end;

    local procedure NoLoyaltyContract(VehicleNo: Code[20]; HourlyRate: Decimal; PickedUpTime: Time; ReturnedTime: Time): Code[20]
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
